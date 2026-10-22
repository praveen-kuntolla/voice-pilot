"""Provider-neutral contracts. Implementations in this module are local deterministic mocks only."""
import asyncio
from dataclasses import dataclass
from typing import AsyncIterator, Literal, Protocol

ProviderName = Literal["mock", "deepgram", "openai", "elevenlabs"]

@dataclass(frozen=True)
class TranscriptChunk:
    text: str
    is_final: bool = False

@dataclass(frozen=True)
class ResponseChunk:
    text: str
    tool_name: str | None = None

@dataclass(frozen=True)
class AudioChunk:
    data: bytes
    is_final: bool = False

@dataclass(frozen=True)
class ConversationMessage:
    role: Literal["system", "user", "assistant"]
    content: str

class STT(Protocol):
    async def transcribe(self, audio: bytes) -> str: ...
    async def stream_transcript(self, audio: bytes, language: str) -> AsyncIterator[TranscriptChunk]: ...
class LLM(Protocol):
    async def respond(self, instructions: str, transcript: str) -> str: ...
    async def stream_response(self, messages: tuple[ConversationMessage, ...], knowledge_context: tuple[str, ...]) -> AsyncIterator[ResponseChunk]: ...
class TTS(Protocol):
    async def speak(self, text: str, voice_id: str | None = None) -> bytes: ...
    async def stream_audio(self, text: str, voice_id: str | None = None) -> AsyncIterator[AudioChunk]: ...

@dataclass(frozen=True)
class ProviderConfig:
    stt: ProviderName
    llm: ProviderName
    tts: ProviderName
    language: str = "en-US"
    voice_id: str | None = None

class MockSTT:
    async def transcribe(self, audio: bytes) -> str: return "mock user speech"
    async def stream_transcript(self, audio: bytes, language: str) -> AsyncIterator[TranscriptChunk]:
        yield TranscriptChunk("mock user", False); yield TranscriptChunk("mock user speech", True)
class MockLLM:
    async def respond(self, instructions: str, transcript: str) -> str: return "This is a deterministic local mock response."
    async def stream_response(self, messages: tuple[ConversationMessage, ...], knowledge_context: tuple[str, ...]) -> AsyncIterator[ResponseChunk]:
        yield ResponseChunk("This is a deterministic "); yield ResponseChunk("local mock response.")
class MockTTS:
    async def speak(self, text: str, voice_id: str | None = None) -> bytes: return text.encode("utf-8")
    async def stream_audio(self, text: str, voice_id: str | None = None) -> AsyncIterator[AudioChunk]:
        yield AudioChunk(text.encode("utf-8"), True)

class ProviderInitializationError(RuntimeError): pass
@dataclass(frozen=True)
class ProviderBundle:
    stt: STT
    llm: LLM
    tts: TTS

def validate_provider_config(config: ProviderConfig, *, mode: str = "mock") -> None:
    if not config.language or len(config.language) > 20: raise ProviderInitializationError("provider language is invalid")
    if config.voice_id is not None and (not config.voice_id or len(config.voice_id) > 120): raise ProviderInitializationError("provider voice is invalid")
    if mode == "mock" and (config.stt, config.llm, config.tts) != ("mock", "mock", "mock"): raise ProviderInitializationError("mock mode requires mock adapters only")
    if mode not in ("mock", "real"): raise ProviderInitializationError("provider mode is invalid")

def build_provider_bundle(config: ProviderConfig, *, mode: str = "mock") -> ProviderBundle:
    """Never imports SDKs or contacts a provider; future IDs are validation-only."""
    validate_provider_config(config, mode=mode)
    if mode == "mock": return ProviderBundle(MockSTT(), MockLLM(), MockTTS())
    raise ProviderInitializationError("real voice providers are not enabled")
