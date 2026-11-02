"""Deterministic text-to-mock-voice orchestration for offline tests only.

This module reuses ConversationController and the provider Protocols. It does
not initialize SDKs, open media devices, make network requests, persist state,
or enable real providers. Future STT/LLM/TTS adapters belong behind the
existing provider interfaces and require a separate approval.
"""
import asyncio
import hashlib
import re
import time
from dataclasses import dataclass
from typing import Callable, Literal

from .conversation import ConversationController, ConversationEvent
from .providers import AudioChunk, ConversationMessage, ProviderBundle, ResponseChunk, TranscriptChunk
from .runtime import RuntimeConfig

PipelineState = Literal["ready", "active", "interrupted", "cancelled", "stopped", "ended", "failed"]
PipelineEventKind = Literal["session", "transcript", "response", "speech", "lifecycle"]
MAX_SYNTHETIC_TEXT = 1_000


class PipelineError(RuntimeError):
    """A fail-closed offline pipeline rejection with a stable reason."""

    def __init__(self, code: Literal["unauthorized", "expired", "session_limit", "invalid_input", "provider_disabled", "ended", "stopped", "turn_active", "duplicate_event", "stale_event"], message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PipelineSessionRequest:
    session_id: str
    organization_id: str
    agent_id: str
    actor_id: str
    expires_at_ms: int


@dataclass(frozen=True)
class PipelineIdentity:
    authenticated: bool
    actor_id: str | None = None
    organization_id: str | None = None
    agent_id: str | None = None


@dataclass(frozen=True)
class SpeechOutputMetadata:
    provider: Literal["mock"]
    format: Literal["mock-text-bytes"]
    byte_length: int
    sha256_prefix: str


@dataclass(frozen=True)
class PipelineEvent:
    sequence: int
    session_id: str
    turn_id: int
    kind: PipelineEventKind
    state: PipelineState
    metadata: dict[str, object]


@dataclass(frozen=True)
class PipelineTurnResult:
    turn_id: int
    transcript: str
    response: str
    speech: SpeechOutputMetadata


class OfflineSessionRegistry:
    """Process-local, nonpersistent single-session guard for offline tests."""

    def __init__(self) -> None:
        self._active_session_id: str | None = None

    def claim(self, session_id: str) -> bool:
        if self._active_session_id is not None and self._active_session_id != session_id:
            return False
        self._active_session_id = session_id
        return True

    def release(self, session_id: str) -> None:
        if self._active_session_id == session_id:
            self._active_session_id = None

    @property
    def active_session_id(self) -> str | None:
        return self._active_session_id


def _bounded_text(text: str) -> str:
    if not isinstance(text, str):
        raise PipelineError("invalid_input", "synthetic input must be text")
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized or len(normalized) > MAX_SYNTHETIC_TEXT:
        raise PipelineError("invalid_input", "synthetic input is empty or oversized")
    return normalized


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


class _SyntheticInputSTT:
    """Mock STT that deterministically transcribes the current text fixture."""

    def __init__(self, delay: float = 0.0, failure: bool = False) -> None:
        self.text = ""
        self.delay = delay
        self.failure = failure

    async def transcribe(self, audio: bytes) -> str:
        return self.text

    async def stream_transcript(self, audio: bytes, language: str):
        if self.failure:
            raise RuntimeError("synthetic STT failure")
        midpoint = max(1, len(self.text) // 2)
        if self.delay:
            await asyncio.sleep(self.delay)
        yield TranscriptChunk(self.text[:midpoint], False)
        yield TranscriptChunk(self.text, True)


class _SyntheticLLM:
    def __init__(self, delay: float = 0.0, failure: bool = False) -> None:
        self.delay = delay
        self.failure = failure

    async def respond(self, instructions: str, transcript: str) -> str:
        return "This is a deterministic local mock response."

    async def stream_response(self, messages: tuple[ConversationMessage, ...], knowledge_context: tuple[str, ...]):
        if self.failure:
            raise RuntimeError("synthetic LLM failure")
        if self.delay:
            await asyncio.sleep(self.delay)
        yield ResponseChunk("This is a deterministic ")
        if self.delay:
            await asyncio.sleep(self.delay)
        yield ResponseChunk("local mock response.")


class _SyntheticTTS:
    def __init__(self, delay: float = 0.0, failure: bool = False) -> None:
        self.delay = delay
        self.failure = failure

    async def speak(self, text: str, voice_id: str | None = None) -> bytes:
        return text.encode("utf-8")

    async def stream_audio(self, text: str, voice_id: str | None = None):
        if self.failure:
            raise RuntimeError("synthetic TTS failure")
        if self.delay:
            await asyncio.sleep(self.delay)
        yield AudioChunk(text.encode("utf-8"), True)


class OfflineRealtimeVoicePipeline:
    """Tenant-bound, session-local STT -> LLM -> TTS mock pipeline."""

    def __init__(
        self,
        request: PipelineSessionRequest,
        config: RuntimeConfig,
        *,
        now_ms: Callable[[], int] | None = None,
        registry: OfflineSessionRegistry | None = None,
        on_event: Callable[[PipelineEvent], None] | None = None,
        synthetic_delay: float = 0.0,
        provider_mode: Literal["mock", "real"] = "mock",
        mock_failure_stage: Literal["none", "stt", "llm", "tts"] = "none",
        agent_archived: bool = False,
    ) -> None:
        if provider_mode != "mock":
            raise PipelineError("provider_disabled", "real voice providers are disabled for the offline pipeline")
        if not all((request.session_id, request.organization_id, request.agent_id, request.actor_id)):
            raise PipelineError("unauthorized", "session identity is incomplete")
        if request.organization_id != config.organization_id or request.agent_id != config.agent_id:
            raise PipelineError("unauthorized", "session is not scoped to the agent tenant")
        if agent_archived:
            raise PipelineError("unauthorized", "archived agents cannot start a voice session")
        if request.expires_at_ms <= 0:
            raise PipelineError("expired", "session expiry is invalid")
        if not config.instructions or not config.language:
            raise PipelineError("unauthorized", "agent voice configuration is incomplete")
        self.request = request
        self.config = config
        self._now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.registry = registry or OfflineSessionRegistry()
        self.on_event = on_event
        self.state: PipelineState = "ready"
        self._turn_id = 0
        self._sequence = 0
        self._turn_task: asyncio.Task[bytes] | None = None
        if synthetic_delay < 0:
            raise PipelineError("invalid_input", "synthetic delay is invalid")
        if mock_failure_stage not in ("none", "stt", "llm", "tts"):
            raise PipelineError("invalid_input", "synthetic failure stage is invalid")
        self._stt = _SyntheticInputSTT(synthetic_delay, mock_failure_stage == "stt")
        self._events: list[PipelineEvent] = []
        self._event_fingerprints: dict[int, str] = {}
        self._controller = ConversationController(
            config,
            ProviderBundle(self._stt, _SyntheticLLM(synthetic_delay, mock_failure_stage == "llm"), _SyntheticTTS(synthetic_delay, mock_failure_stage == "tts")),
            on_event=self._project_event,
        )

    @property
    def events(self) -> tuple[PipelineEvent, ...]:
        return tuple(self._events)

    def start(self, identity: PipelineIdentity) -> None:
        self._authorize(identity)
        self._check_expiry()
        if self.state != "ready":
            raise PipelineError("ended", "pipeline has already started")
        if not self.registry.claim(self.request.session_id):
            raise PipelineError("session_limit", "another offline voice session is active")
        self.state = "active"
        self._emit("session", "active", {"action": "started", "simulation_only": True})

    async def run_turn(self, identity: PipelineIdentity, text: str) -> PipelineTurnResult:
        self._authorize(identity)
        self._check_expiry()
        if self.state in ("stopped", "cancelled", "ended"):
            raise PipelineError(self.state if self.state in ("stopped", "cancelled") else "ended", "pipeline is no longer active")
        if self.state != "active":
            raise PipelineError("ended", "pipeline must be started before a turn")
        if self._turn_task and not self._turn_task.done():
            raise PipelineError("turn_active", "a synthetic turn is already active")
        bounded = _bounded_text(text)
        self._turn_id += 1
        turn_id = self._turn_id
        self._stt.text = bounded
        self._turn_task = asyncio.create_task(self._controller.run_turn(self.request.organization_id, self.request.agent_id, bounded.encode("utf-8")))
        try:
            output = await self._turn_task
        except asyncio.CancelledError:
            if self.state not in ("cancelled", "stopped"):
                self.state = "interrupted"
            raise
        except Exception:
            self.state = "failed"
            raise
        self.state = "active"
        response = "This is a deterministic local mock response."
        return PipelineTurnResult(turn_id, bounded, response, SpeechOutputMetadata("mock", "mock-text-bytes", len(output), _digest(response)))

    async def interrupt(self) -> bool:
        interrupted = await self._controller.interrupt()
        if interrupted:
            self.state = "interrupted"
            self._emit("lifecycle", "interrupted", {"action": "interrupt", "simulation_only": True})
        return interrupted

    async def cancel(self) -> None:
        if self.state in ("cancelled", "ended", "stopped"):
            return
        self.state = "cancelled"
        await self._end_controller_safely()
        self._emit("lifecycle", "cancelled", {"action": "cancel", "simulation_only": True})

    async def emergency_stop(self) -> None:
        if self.state == "stopped":
            return
        self.state = "stopped"
        await self._end_controller_safely()
        self._emit("lifecycle", "stopped", {"action": "emergency_stop", "simulation_only": True})

    async def cleanup(self) -> None:
        await self._end_controller_safely()
        if self.state not in ("cancelled", "stopped"):
            self.state = "ended"
        self._emit("lifecycle", self.state, {"action": "cleanup", "simulation_only": True})

    async def _end_controller_safely(self) -> None:
        try:
            await self._controller.end()
        except Exception:
            # Provider failures are already surfaced by run_turn. Cleanup must
            # still release the local session slot and never leak raw errors.
            pass
        finally:
            self.registry.release(self.request.session_id)

    def accept_event(self, event: PipelineEvent) -> bool:
        if event.session_id != self.request.session_id:
            raise PipelineError("unauthorized", "event session binding does not match")
        if event.sequence <= 0 or event.turn_id < 0:
            raise PipelineError("invalid_input", "event sequence is invalid")
        fingerprint = repr(event)
        previous = self._event_fingerprints.get(event.sequence)
        if previous is not None:
            if previous != fingerprint:
                raise PipelineError("duplicate_event", "conflicting duplicate event")
            return False
        if event.sequence < self._sequence:
            raise PipelineError("stale_event", "event sequence is stale")
        self._event_fingerprints[event.sequence] = fingerprint
        self._sequence = event.sequence
        return True

    def _authorize(self, identity: PipelineIdentity) -> None:
        if not identity.authenticated or identity.actor_id != self.request.actor_id or identity.organization_id != self.request.organization_id or (identity.agent_id is not None and identity.agent_id != self.request.agent_id):
            raise PipelineError("unauthorized", "voice session identity is not authorized")

    def _check_expiry(self) -> None:
        if self.request.expires_at_ms <= self._now_ms():
            self.state = "ended"
            self.registry.release(self.request.session_id)
            raise PipelineError("expired", "voice session has expired")

    def _project_event(self, event: ConversationEvent) -> None:
        kind: PipelineEventKind = "transcript" if "transcript" in event.kind else "response" if "response" in event.kind else "speech" if "audio" in event.kind else "lifecycle"
        metadata: dict[str, object] = {"simulation_only": True}
        if event.kind == "state":
            metadata["stage"] = event.state
        if event.text:
            metadata.update({"text_length": len(event.text), "text_sha256_prefix": _digest(event.text)})
        self._emit(kind, self.state, metadata, event.turn_id)

    def _emit(self, kind: PipelineEventKind, state: PipelineState, metadata: dict[str, object], turn_id: int | None = None) -> None:
        self._sequence += 1
        event = PipelineEvent(self._sequence, self.request.session_id, self._turn_id if turn_id is None else turn_id, kind, state, metadata)
        self._event_fingerprints[event.sequence] = repr(event)
        self._events.append(event)
        if self.on_event:
            try:
                self.on_event(event)
            except Exception:
                pass
