import asyncio
import pytest
from voice_agent.mock_pipeline import MockVoicePipeline
from voice_agent.providers import ProviderBundle, ProviderConfig, ProviderInitializationError, build_provider_bundle
from voice_agent.runtime import RuntimeConfig

CFG = RuntimeConfig("org-a", "agent-a", "en-US", "Be concise", "mock-voice")

def test_complete_mock_pipeline_transcript_and_audio_are_deterministic():
    async def scenario():
        events = []
        pipeline = MockVoicePipeline(CFG, on_event=events.append)
        output = await pipeline.run_turn("org-a", "agent-a", b"local-bytes")
        assert output == b"This is a deterministic local mock response."
        assert [event.state for event in events] == ["listening", "transcribing", "thinking", "speaking", "ended"]
        assert events[2].text == "mock user speech"
        assert pipeline.state == "ended"
        await pipeline.stop()
    asyncio.run(scenario())

def test_tenant_mismatch_and_provider_configuration_fail_closed():
    async def scenario():
        pipeline = MockVoicePipeline(CFG)
        with pytest.raises(PermissionError):
            await pipeline.run_turn("org-b", "agent-a", b"local")
        with pytest.raises(PermissionError):
            await pipeline.run_turn("org-a", "agent-b", b"local")
        assert pipeline.events == []
    asyncio.run(scenario())
    with pytest.raises(ProviderInitializationError, match="mock adapters"):
        build_provider_bundle(ProviderConfig("external", "mock", "mock"), mode="mock")

@pytest.mark.parametrize("stage", ["stt", "llm", "tts"])
def test_cancellation_during_each_provider_stage(stage):
    async def scenario():
        entered = asyncio.Event()
        class STT:
            async def transcribe(self, audio):
                if stage == "stt":
                    entered.set(); await asyncio.Event().wait()
                return "local speech"
        class LLM:
            async def respond(self, instructions, transcript):
                if stage == "llm":
                    entered.set(); await asyncio.Event().wait()
                return "local response"
        class TTS:
            async def speak(self, text, voice_id=None):
                if stage == "tts":
                    entered.set(); await asyncio.Event().wait()
                return b"local output"
        pipeline = MockVoicePipeline(CFG, ProviderBundle(STT(), LLM(), TTS()))
        task = asyncio.create_task(pipeline.run_turn("org-a", "agent-a", b"local"))
        await asyncio.wait_for(entered.wait(), 1)
        await pipeline.stop()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert pipeline.state == "ended"
        assert pipeline.events[-1].state == "ended"
    asyncio.run(scenario())

def test_provider_failure_recovers_on_next_local_turn():
    async def scenario():
        class FlakyLLM:
            calls = 0
            async def respond(self, instructions, transcript):
                self.calls += 1
                if self.calls == 1: raise RuntimeError("fixture failure")
                return "recovered"
        bundle = build_provider_bundle(ProviderConfig("mock", "mock", "mock"))
        pipeline = MockVoicePipeline(CFG, ProviderBundle(bundle.stt, FlakyLLM(), bundle.tts))
        with pytest.raises(RuntimeError):
            await pipeline.run_turn("org-a", "agent-a", b"local")
        assert [event.state for event in pipeline.events[-2:]] == ["error", "ended"]
        assert await pipeline.run_turn("org-a", "agent-a", b"local") == b"recovered"
    asyncio.run(scenario())

def test_provider_timeout_ends_turn_without_external_calls():
    async def scenario():
        class SlowSTT:
            async def transcribe(self, audio):
                await asyncio.Event().wait()
        bundle = build_provider_bundle(ProviderConfig("mock", "mock", "mock"))
        pipeline = MockVoicePipeline(CFG, ProviderBundle(SlowSTT(), bundle.llm, bundle.tts), provider_timeout=.01)
        with pytest.raises(asyncio.TimeoutError):
            await pipeline.run_turn("org-a", "agent-a", b"local")
        assert pipeline.state == "ended"
        assert [event.state for event in pipeline.events[-2:]] == ["error", "ended"]
    asyncio.run(scenario())
