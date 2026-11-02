import asyncio

import pytest

from voice_agent.offline_realtime_pipeline import (
    OfflineRealtimeVoicePipeline,
    OfflineSessionRegistry,
    PipelineError,
    PipelineEvent,
    PipelineIdentity,
    PipelineSessionRequest,
)
from voice_agent.runtime import RuntimeConfig


CFG = RuntimeConfig("org-a", "agent-a", "en-US", "Be concise", "mock-voice")


def request(expires_at=10_000):
    return PipelineSessionRequest("session-a", "org-a", "agent-a", "actor-a", expires_at)


def identity():
    return PipelineIdentity(True, "actor-a", "org-a", "agent-a")


def test_authorized_deterministic_turn_and_privacy_safe_events():
    async def scenario():
        pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000)
        pipeline.start(identity())
        result = await pipeline.run_turn(identity(), "  hello   offline  ")
        assert result.transcript == "hello offline"
        assert result.response == "This is a deterministic local mock response."
        assert result.speech.provider == "mock"
        assert result.speech.byte_length == len(result.response.encode())
        assert all("text" not in event.metadata for event in pipeline.events)
        assert any(event.kind == "transcript" for event in pipeline.events)
        await pipeline.cleanup()
    asyncio.run(scenario())


def test_authorization_expiry_input_and_provider_disabled_behavior():
    async def scenario():
        with pytest.raises(PipelineError, match="providers are disabled"):
            OfflineRealtimeVoicePipeline(request(), CFG, provider_mode="real")
        with pytest.raises(PipelineError, match="not authorized"):
            OfflineRealtimeVoicePipeline(request(), CFG).start(PipelineIdentity(False))
        with pytest.raises(PipelineError, match="expired"):
            OfflineRealtimeVoicePipeline(request(100), CFG, now_ms=lambda: 100).start(identity())
        with pytest.raises(PipelineError, match="oversized"):
            pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000)
            pipeline.start(identity())
            await pipeline.run_turn(identity(), "x" * 1001)
    asyncio.run(scenario())


def test_single_active_session_and_duplicate_events():
    async def scenario():
        registry = OfflineSessionRegistry()
        first = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000, registry=registry)
        second = OfflineRealtimeVoicePipeline(PipelineSessionRequest("session-b", "org-a", "agent-a", "actor-b", 10_000), CFG, now_ms=lambda: 1_000, registry=registry)
        first.start(identity())
        with pytest.raises(PipelineError, match="another offline"):
            second.start(PipelineIdentity(True, "actor-b", "org-a", "agent-a"))
        event = PipelineEvent(99, "session-a", 1, "lifecycle", "active", {"simulation_only": True})
        assert first.accept_event(event) is True
        assert first.accept_event(event) is False
        with pytest.raises(PipelineError, match="conflicting"):
            first.accept_event(PipelineEvent(99, "session-a", 1, "lifecycle", "ended", {"simulation_only": True}))
        with pytest.raises(PipelineError, match="stale"):
            first.accept_event(PipelineEvent(98, "session-a", 1, "lifecycle", "active", {"simulation_only": True}))
        with pytest.raises(PipelineError, match="binding"):
            first.accept_event(PipelineEvent(100, "other-session", 1, "lifecycle", "active", {"simulation_only": True}))
        await first.cleanup()
        second.start(PipelineIdentity(True, "actor-b", "org-a", "agent-a"))
        await second.cancel()
    asyncio.run(scenario())


def test_concurrent_session_starts_have_one_winner():
    async def scenario():
        registry = OfflineSessionRegistry()
        first = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000, registry=registry)
        second = OfflineRealtimeVoicePipeline(PipelineSessionRequest("session-b", "org-a", "agent-a", "actor-b", 10_000), CFG, now_ms=lambda: 1_000, registry=registry)
        results = await asyncio.gather(
            asyncio.to_thread(first.start, identity()),
            asyncio.to_thread(second.start, PipelineIdentity(True, "actor-b", "org-a", "agent-a")),
            return_exceptions=True,
        )
        assert sum(isinstance(result, PipelineError) for result in results) == 1
        assert registry.active_session_id in {"session-a", "session-b"}
        await first.cleanup()
        await second.cleanup()
    asyncio.run(scenario())


def test_cross_tenant_archived_and_changed_actor_authorization_fail_closed():
    with pytest.raises(PipelineError, match="archived"):
        OfflineRealtimeVoicePipeline(request(), CFG, agent_archived=True)
    pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000)
    pipeline.start(identity())
    with pytest.raises(PipelineError, match="not authorized"):
        asyncio.run(pipeline.run_turn(PipelineIdentity(True, "actor-b", "org-a", "agent-a"), "blocked"))
    with pytest.raises(PipelineError, match="not authorized"):
        asyncio.run(pipeline.run_turn(PipelineIdentity(True, "actor-a", "org-b", "agent-a"), "blocked"))
    asyncio.run(pipeline.cleanup())


def test_out_of_order_turn_and_repeated_cleanup_release_resources():
    async def scenario():
        registry = OfflineSessionRegistry()
        pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000, registry=registry, synthetic_delay=0.1)
        pipeline.start(identity())
        active = asyncio.create_task(pipeline.run_turn(identity(), "first"))
        await asyncio.sleep(0.005)
        with pytest.raises(PipelineError, match="already active"):
            await pipeline.run_turn(identity(), "second")
        await pipeline.interrupt()
        with pytest.raises(asyncio.CancelledError):
            await active
        await pipeline.cleanup()
        await pipeline.cleanup()
        assert registry.active_session_id is None
    asyncio.run(scenario())


@pytest.mark.parametrize("stage", ["stt", "llm", "tts"])
def test_each_mock_provider_failure_is_bounded(stage):
    async def scenario():
        pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000, mock_failure_stage=stage)
        pipeline.start(identity())
        with pytest.raises(RuntimeError, match="synthetic"):
            await pipeline.run_turn(identity(), "failure fixture")
        assert pipeline.state == "failed"
        await pipeline.cleanup()
    asyncio.run(scenario())


@pytest.mark.parametrize("stage", ["transcribing", "thinking", "speaking"])
def test_interruption_during_each_mock_stage(stage):
    async def scenario():
        reached = asyncio.Event()

        def observe(event):
            if event.metadata.get("stage") == stage:
                reached.set()

        pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000, synthetic_delay=0.05, on_event=observe)
        pipeline.start(identity())
        task = asyncio.create_task(pipeline.run_turn(identity(), "interrupt fixture"))
        await asyncio.wait_for(reached.wait(), 1)
        assert await pipeline.interrupt() is True
        with pytest.raises(asyncio.CancelledError):
            await task
        assert pipeline.state == "interrupted"
        await pipeline.cleanup()
    asyncio.run(scenario())


def test_emergency_stop_during_active_turn_preserves_stopped_state():
    async def scenario():
        pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000, synthetic_delay=0.1)
        pipeline.start(identity())
        task = asyncio.create_task(pipeline.run_turn(identity(), "stop fixture"))
        await asyncio.sleep(0.005)
        await pipeline.emergency_stop()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert pipeline.state == "stopped"
        assert pipeline.registry.active_session_id is None
        await pipeline.emergency_stop()
    asyncio.run(scenario())


def test_empty_malformed_and_expired_turns_are_rejected():
    async def scenario():
        pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000)
        pipeline.start(identity())
        for value in ("", "   ", None, 42):
            with pytest.raises(PipelineError, match="synthetic input"):
                await pipeline.run_turn(identity(), value)  # type: ignore[arg-type]
        expired = OfflineRealtimeVoicePipeline(request(1_000), CFG, now_ms=lambda: 1_001)
        with pytest.raises(PipelineError, match="expired"):
            expired.start(identity())
        await pipeline.cleanup()
    asyncio.run(scenario())


def test_interruption_cancellation_emergency_stop_and_cleanup():
    async def scenario():
        registry = OfflineSessionRegistry()
        pipeline = OfflineRealtimeVoicePipeline(request(), CFG, now_ms=lambda: 1_000, registry=registry, synthetic_delay=0.1)
        pipeline.start(identity())
        # The deterministic pipeline remains synchronous enough to exercise
        # cancellation through its explicit lifecycle methods.
        task = asyncio.create_task(pipeline.run_turn(identity(), "interrupt me"))
        await asyncio.sleep(0.005)
        await pipeline.interrupt()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert pipeline.state == "interrupted"
        await pipeline.emergency_stop()
        assert pipeline.state == "stopped"
        assert registry.active_session_id is None
        await pipeline.cleanup()
    asyncio.run(scenario())
