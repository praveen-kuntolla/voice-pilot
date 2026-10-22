"""Bounded, provider-neutral local conversation orchestration; no network or media devices."""
import asyncio
from dataclasses import dataclass
from typing import Callable, Literal
from .providers import AudioChunk, ConversationMessage, ProviderBundle, TranscriptChunk
from .runtime import RuntimeConfig

ConversationState = Literal["idle", "listening", "transcribing", "thinking", "speaking", "interrupted", "ending", "ended", "failed"]
EventKind = Literal["state", "partial_transcript", "final_transcript", "response_chunk", "audio_chunk", "diagnostic"]

@dataclass(frozen=True)
class ConversationEvent:
    sequence: int
    turn_id: int
    state: ConversationState
    kind: EventKind
    text: str = ""

class ConversationController:
    """Tenant-bound controller that suppresses stale/cancelled turns and retains bounded history."""
    def __init__(self, config: RuntimeConfig, providers: ProviderBundle, *, timeout: float = 3.0,
                 max_events: int = 200, on_event: Callable[[ConversationEvent], None] | None = None):
        if not config.organization_id or not config.agent_id or not config.instructions or not config.language: raise ValueError("tenant-bound voice configuration is incomplete")
        if timeout <= 0 or max_events < 1: raise ValueError("conversation bounds are invalid")
        self.config, self.providers, self.timeout, self.max_events, self.on_event = config, providers, timeout, max_events, on_event
        self.events: list[ConversationEvent] = []; self.state: ConversationState = "idle"; self._sequence = 0; self._turn = 0; self._ended = False; self._task: asyncio.Task[bytes] | None = None

    def _emit(self, state: ConversationState, kind: EventKind = "state", text: str = "", turn: int | None = None) -> None:
        self.state = state; self._sequence += 1; event = ConversationEvent(self._sequence, self._turn if turn is None else turn, state, kind, text)
        self.events.append(event); del self.events[:-self.max_events]
        if self.on_event:
            try: self.on_event(event)
            except Exception: pass
    def _current(self, turn: int) -> bool: return not self._ended and turn == self._turn
    def _assert_tenant(self, organization_id: str, agent_id: str) -> None:
        if organization_id != self.config.organization_id or agent_id != self.config.agent_id: raise PermissionError("voice session tenant mismatch")

    async def run_turn(self, organization_id: str, agent_id: str, audio: bytes) -> bytes:
        self._assert_tenant(organization_id, agent_id)
        if self._ended: raise RuntimeError("voice session has ended")
        if self._task and not self._task.done(): raise RuntimeError("voice turn is already active")
        if not isinstance(audio, bytes) or not audio or len(audio) > 1024 * 1024: raise ValueError("mock audio input is invalid")
        self._turn += 1; turn = self._turn
        async def execute() -> bytes:
            try:
                self._emit("listening", "state", "Local mock listening", turn); self._emit("transcribing", "state", "", turn)
                final = ""
                async for item in self._stream(self.providers.stt.stream_transcript(audio, self.config.language)):
                    if not self._current(turn): raise asyncio.CancelledError()
                    final = item.text; self._emit("transcribing", "final_transcript" if item.is_final else "partial_transcript", item.text, turn)
                if not final: raise ValueError("mock transcript is empty")
                self._emit("thinking", "state", "", turn); response = ""
                messages = (ConversationMessage("system", self.config.instructions), ConversationMessage("user", final))
                async for item in self._stream(self.providers.llm.stream_response(messages, self.config.knowledge_source_ids)):
                    if item.tool_name: self._emit("thinking", "diagnostic", "Tool call requested but blocked in local simulation", turn); continue
                    response += item.text; self._emit("thinking", "response_chunk", item.text, turn)
                if not response: raise ValueError("mock response is empty")
                self._emit("speaking", "state", "", turn); chunks: list[bytes] = []
                async for item in self._stream(self.providers.tts.stream_audio(response, self.config.voice_id)):
                    if not self._current(turn): raise asyncio.CancelledError()
                    chunks.append(item.data); self._emit("speaking", "audio_chunk", "Mock audio chunk", turn)
                if not chunks: raise ValueError("mock audio output is empty")
                self._emit("idle", "diagnostic", "Turn complete", turn); return b"".join(chunks)
            except asyncio.CancelledError: self._emit("interrupted", "diagnostic", "Turn cancelled", turn); self._emit("idle", "diagnostic", "Ready", turn); raise
            except Exception: self._emit("failed", "diagnostic", "Mock provider step failed", turn); raise
        self._task = asyncio.create_task(execute()); return await self._task
    async def _stream(self, iterator):
        while True:
            try: yield await asyncio.wait_for(iterator.__anext__(), self.timeout)
            except StopAsyncIteration: return
    async def interrupt(self) -> bool:
        if not self._task or self._task.done(): return False
        self._turn += 1; self._task.cancel()
        try: await self._task
        except asyncio.CancelledError: pass
        return True
    async def end(self) -> None:
        if self._ended: return
        self._ended = True; self._turn += 1; self._emit("ending", "diagnostic", "Session ending")
        if self._task and not self._task.done(): self._task.cancel();
        if self._task:
            try: await self._task
            except asyncio.CancelledError: pass
        self._emit("ended", "diagnostic", "Session ended")
