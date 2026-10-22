"""Offline STT -> LLM -> TTS simulation. Never opens media devices or networks."""
import asyncio
from dataclasses import dataclass
from typing import Callable, Literal
from .providers import ProviderBundle, ProviderConfig, build_provider_bundle
from .runtime import RuntimeConfig

TurnState = Literal["idle", "listening", "transcribing", "thinking", "speaking", "ended", "error"]

@dataclass(frozen=True)
class TranscriptEvent:
    state: TurnState
    text: str

class MockVoicePipeline:
    def __init__(self, config: RuntimeConfig, providers: ProviderBundle | None = None,
                 provider_timeout: float = 3.0, on_event: Callable[[TranscriptEvent], None] | None = None):
        if not config.organization_id or not config.agent_id or not config.instructions or not config.language:
            raise ValueError("tenant-bound voice configuration is incomplete")
        if provider_timeout <= 0:
            raise ValueError("provider timeout must be positive")
        self.config = config
        self.providers = providers or build_provider_bundle(ProviderConfig("mock", "mock", "mock"))
        self.provider_timeout = provider_timeout
        self.on_event = on_event
        self.events: list[TranscriptEvent] = []
        self.state: TurnState = "idle"
        self._task: asyncio.Task[bytes] | None = None
        self._cancelled = False

    def _emit(self, state: TurnState, text: str = "") -> None:
        self.state = state
        event = TranscriptEvent(state, text)
        self.events.append(event)
        if self.on_event:
            try:
                self.on_event(event)
            except Exception:
                # An observer must not interrupt provider cleanup or tenant checks.
                pass

    async def run_turn(self, organization_id: str, agent_id: str, audio: bytes) -> bytes:
        if organization_id != self.config.organization_id or agent_id != self.config.agent_id:
            raise PermissionError("voice session tenant mismatch")
        if self._cancelled:
            raise RuntimeError("voice session has ended")
        if self._task and not self._task.done():
            raise RuntimeError("voice turn is already active")
        if not isinstance(audio, bytes) or not audio or len(audio) > 1024 * 1024:
            raise ValueError("mock audio input is invalid")
        async def turn() -> bytes:
            try:
                self._emit("listening")
                self._emit("transcribing")
                transcript = await asyncio.wait_for(self.providers.stt.transcribe(audio), self.provider_timeout)
                if not isinstance(transcript, str) or not transcript:
                    raise ValueError("mock transcript is empty")
                self._emit("thinking", transcript)
                response = await asyncio.wait_for(self.providers.llm.respond(self.config.instructions, transcript), self.provider_timeout)
                if not isinstance(response, str) or not response:
                    raise ValueError("mock response is empty")
                self._emit("speaking", response)
                output = await asyncio.wait_for(self.providers.tts.speak(response, self.config.voice_id), self.provider_timeout)
                if not isinstance(output, bytes):
                    raise ValueError("mock audio output is invalid")
                self._emit("ended")
                return output
            except asyncio.CancelledError:
                self._emit("ended")
                raise
            except Exception:
                self._emit("error", "Mock provider step failed")
                self._emit("ended")
                raise
        self._task = asyncio.create_task(turn())
        return await self._task

    async def stop(self) -> None:
        self._cancelled = True
        task = self._task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        if self.state != "ended":
            self._emit("ended")
