import asyncio
import time
from types import SimpleNamespace

from voice_agent.connectivity_lifecycle import ConnectivityLifecycle, SessionState
from voice_agent.runtime import RuntimeConfig
from voice_agent.worker import run_connectivity_session


class Room:
    def __init__(self, *, fail=False, hang=False):
        self.calls = 0
        self.fail = fail
        self.hang = hang
        self.connected = True

    async def disconnect(self):
        self.calls += 1
        if self.fail:
            raise RuntimeError("local cleanup failure")
        if self.hang:
            await asyncio.Event().wait()
        self.connected = False


def participant(identity):
    return SimpleNamespace(identity=identity)


def test_authorized_departure_stops_and_cleans_up_once():
    async def scenario():
        room = Room()
        lifecycle = ConnectivityLifecycle(room, "browser")
        lifecycle.state = SessionState.ACTIVE
        lifecycle.participant_joined(participant("worker"))
        assert not lifecycle.authorized_present
        lifecycle.participant_joined(participant("browser"))
        assert lifecycle.authorized_present
        lifecycle.participant_left(participant("unrelated"))
        assert lifecycle.stop_reason is None
        lifecycle.participant_left(participant("browser"))
        lifecycle.participant_left(participant("browser"))
        await lifecycle.wait()
        await lifecycle.cleanup()
        await lifecycle.cleanup()
        assert lifecycle.stop_reason == "last_authorized_browser_left"
        assert lifecycle.state is SessionState.STOPPED
        assert room.calls == lifecycle.cleanup_attempts == 1
        assert not room.connected
    asyncio.run(scenario())


def test_departure_during_initialization_and_abrupt_room_loss():
    async def scenario():
        early = ConnectivityLifecycle(Room(), "browser")
        early.participant_left(participant("browser"))
        await early.wait()
        assert early.stop_reason == "last_authorized_browser_left"
        lost = ConnectivityLifecycle(Room(), "browser")
        lost.participant_joined(participant("browser"))
        lost.room_disconnected()
        await lost.wait()
        await lost.cleanup()
        assert lost.stop_reason == "room_disconnected"
        assert lost.state is SessionState.STOPPED
    asyncio.run(scenario())


def test_no_authorized_browser_times_out():
    async def scenario():
        lifecycle = ConnectivityLifecycle(Room(), "browser")
        await lifecycle.wait(arrival_timeout=0.001)
        assert lifecycle.stop_reason == "authorized_browser_absent"
        await lifecycle.cleanup()
        assert lifecycle.state is SessionState.STOPPED
    asyncio.run(scenario())


def test_authorized_session_expiration_terminates_even_if_browser_stays():
    async def scenario():
        lifecycle = ConnectivityLifecycle(Room(), "browser", expires_at=int(time.time()*1000)+20)
        lifecycle.participant_joined(participant("browser"))
        await lifecycle.wait()
        assert lifecycle.stop_reason == "session_expired"
        await lifecycle.cleanup()
        assert lifecycle.state is SessionState.STOPPED
    asyncio.run(scenario())


def test_cleanup_timeout_failure_and_already_disconnected():
    async def scenario():
        timed = ConnectivityLifecycle(Room(hang=True), "browser", cleanup_timeout=0.001)
        await timed.cleanup()
        assert timed.state is SessionState.CLEANUP_FAILED
        assert timed.cleanup_error == "TimeoutError"
        failed = ConnectivityLifecycle(Room(fail=True), "browser")
        await failed.cleanup()
        assert failed.state is SessionState.CLEANUP_FAILED
        assert failed.cleanup_error == "RuntimeError"
        disconnected = Room()
        disconnected.connected = False
        lifecycle = ConnectivityLifecycle(disconnected, "browser")
        await lifecycle.cleanup()
        assert lifecycle.state is SessionState.STOPPED
    asyncio.run(scenario())


def test_worker_cancellation_can_still_cleanup():
    async def scenario():
        room = Room()
        lifecycle = ConnectivityLifecycle(room, "browser")
        task = asyncio.create_task(lifecycle.wait())
        await asyncio.sleep(0)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            lifecycle.request_stop("worker_cancelled")
        await lifecycle.cleanup()
        assert lifecycle.stop_reason == "worker_cancelled"
        assert lifecycle.state is SessionState.STOPPED
        assert room.calls == 1
    asyncio.run(scenario())


def test_connectivity_worker_cancel_cleans_room_and_handlers():
    class EventRoom(Room):
        name = "voicepilot:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333"
        remote_participants = {}
        def __init__(self):
            super().__init__()
            self.handlers = {}
        def on(self, event, handler):
            self.handlers[event] = handler
        def off(self, event, handler):
            if self.handlers.get(event) is handler:
                del self.handlers[event]
    class Context:
        room = EventRoom()
        joined = asyncio.Event()
        async def connect(self, *, auto_subscribe):
            self.joined.set()
    async def loader(org, agent, room):
        return RuntimeConfig(org, agent, "en", "local only", authorized_browser_identity="browser", session_id="33333333-3333-4333-8333-333333333333", session_expires_at=int(time.time()*1000)+60000)
    async def scenario():
        context = Context()
        task = asyncio.create_task(run_connectivity_session(context, loader, "none"))
        await context.joined.wait()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert context.room.calls == 1
        assert context.room.handlers == {}
    asyncio.run(scenario())
