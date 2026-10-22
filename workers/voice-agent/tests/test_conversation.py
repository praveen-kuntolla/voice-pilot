import asyncio
import pytest
from voice_agent.conversation import ConversationController
from voice_agent.providers import ProviderBundle, ProviderConfig, build_provider_bundle
from voice_agent.runtime import RuntimeConfig

CFG=RuntimeConfig("org-a","agent-a","en-US","Stay concise","mock-voice")

def test_streaming_mock_flow_is_bounded_and_tenant_scoped():
    async def scenario():
        controller=ConversationController(CFG,build_provider_bundle(ProviderConfig("mock","mock","mock")),max_events=8)
        output=await controller.run_turn("org-a","agent-a",b"local")
        assert output == b"This is a deterministic local mock response."
        assert any(event.kind == "partial_transcript" for event in controller.events)
        assert any(event.kind == "final_transcript" for event in controller.events)
        assert any(event.kind == "audio_chunk" for event in controller.events)
        assert len(controller.events) == 8
        with pytest.raises(PermissionError): await controller.run_turn("org-b","agent-a",b"local")
    asyncio.run(scenario())

def test_interruption_cancels_stale_output_and_end_prevents_future_turns():
    async def scenario():
        entered=asyncio.Event()
        class SlowSTT:
            async def transcribe(self,a): return "unused"
            async def stream_transcript(self,a,l):
                entered.set(); await asyncio.Event().wait(); yield None
        normal=build_provider_bundle(ProviderConfig("mock","mock","mock"))
        controller=ConversationController(CFG,ProviderBundle(SlowSTT(),normal.llm,normal.tts))
        task=asyncio.create_task(controller.run_turn("org-a","agent-a",b"local"))
        await entered.wait(); assert await controller.interrupt() is True
        with pytest.raises(asyncio.CancelledError): await task
        assert controller.state == "idle"
        await controller.end(); assert controller.state == "ended"
        with pytest.raises(RuntimeError,match="ended"): await controller.run_turn("org-a","agent-a",b"later")
    asyncio.run(scenario())

def test_provider_timeout_and_tool_requests_fail_or_stay_local():
    async def scenario():
        class SlowSTT:
            async def transcribe(self,a): return "unused"
            async def stream_transcript(self,a,l): await asyncio.Event().wait(); yield None
        normal=build_provider_bundle(ProviderConfig("mock","mock","mock"))
        controller=ConversationController(CFG,ProviderBundle(SlowSTT(),normal.llm,normal.tts),timeout=.01)
        with pytest.raises(asyncio.TimeoutError): await controller.run_turn("org-a","agent-a",b"local")
        assert controller.state == "failed"
    asyncio.run(scenario())
