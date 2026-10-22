"""LiveKit Agents integration boundary.

The module is safe to import without livekit-agents installed. Framework imports
and server startup occur only after both worker and realtime flags are enabled.
"""
from dataclasses import dataclass
from typing import Protocol
import asyncio
import json
import re
import time
from .connectivity_lifecycle import ConnectivityLifecycle, SessionState
from .config import WorkerConfig, validate_connectivity_config, validate_realtime_config
from .providers import ProviderConfig, build_provider_bundle
from .runtime import RuntimeConfig

class ConfigLoader(Protocol):
    async def __call__(self, organization_id: str, agent_id: str, room_name: str) -> RuntimeConfig: ...

@dataclass(frozen=True)
class RoomConfig:
    organization_id: str
    agent_id: str
    session_id: str

def parse_room_name(name: str) -> RoomConfig:
    parts = name.split(":")
    uuid = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
    if len(parts) != 4 or parts[0] != "voicepilot" or any(not uuid.fullmatch(part) for part in parts[1:]):
        raise ValueError("invalid VoicePilot room name")
    return RoomConfig(parts[1], parts[2], parts[3])

def build_worker_plan(config: WorkerConfig, room_name: str) -> RoomConfig:
    validate_realtime_config(config)
    if config.provider_mode != "real":
        raise RuntimeError("mock provider mode cannot start a LiveKit worker")
    return parse_room_name(room_name)

async def load_runtime_config(loader: ConfigLoader, room_name: str) -> RuntimeConfig:
    room = parse_room_name(room_name)
    runtime = await loader(room.organization_id, room.agent_id, room_name)
    if runtime.organization_id != room.organization_id or runtime.agent_id != room.agent_id or runtime.session_id != room.session_id:
        raise PermissionError("worker configuration tenant mismatch")
    return runtime

def create_livekit_server(config: WorkerConfig, loader: ConfigLoader):
    """Create the official AgentServer only when explicit realtime config is valid.

    This function is not called by local mock mode. The API shape follows the
    current LiveKit Agents 1.x AgentServer/AgentSession lifecycle.
    """
    connectivity = config.connectivity_test_enabled
    if connectivity:
        validate_connectivity_config(config)
    else:
        validate_realtime_config(config)
        # No approved real provider adapters exist yet. Fail before registering
        # a job so a worker cannot connect and then fail during session setup.
        build_provider_bundle(ProviderConfig(config.stt_provider or "", config.llm_provider or "", config.tts_provider or ""), mode="real")
    try:
        from livekit.agents import Agent, AgentServer, AgentSession, AutoSubscribe, WorkerPermissions, cli
    except ImportError as exc:
        raise RuntimeError("livekit-agents is not installed; install the worker dependencies") from exc

    if connectivity:
        permissions = WorkerPermissions(can_publish=False, can_subscribe=False,
                                        can_publish_data=False, can_update_metadata=False)
        server = AgentServer(ws_url=config.livekit_url, api_key=config.api_key,
                             api_secret=config.api_secret, permissions=permissions)
    else:
        server = AgentServer(ws_url=config.livekit_url, api_key=config.api_key,
                             api_secret=config.api_secret)

    @server.rtc_session()
    async def entrypoint(ctx):
        if connectivity:
            await run_connectivity_session(ctx, loader, AutoSubscribe.SUBSCRIBE_NONE)
            return
        runtime = await load_runtime_config(loader, ctx.room.name)
        providers = build_provider_bundle(
            ProviderConfig(stt=config.stt_provider or "", llm=config.llm_provider or "", tts=config.tts_provider or ""),
            mode=config.provider_mode,
        )
        session = AgentSession(stt=providers.stt, llm=providers.llm, tts=providers.tts)
        agent = Agent(instructions=runtime.instructions)
        await session.start(room=ctx.room, agent=agent)
        await session.generate_reply(instructions=f"Greet the user in {runtime.language}.")

    return server, cli

async def run_connectivity_session(ctx, loader: ConfigLoader, auto_subscribe) -> None:
    """Join only after tenant-bound configuration is verified; publish nothing."""
    runtime = await load_runtime_config(loader, ctx.room.name)
    if not runtime.authorized_browser_identity or not runtime.session_expires_at or runtime.session_expires_at <= int(time.time()*1000):
        raise PermissionError("authorized browser session unavailable or expired")
    print("VOICEPILOT_CONNECTIVITY_CONFIG_VERIFIED", flush=True)
    lifecycle = ConnectivityLifecycle(ctx.room, runtime.authorized_browser_identity, expires_at=runtime.session_expires_at)
    loop = asyncio.get_running_loop()
    def joined(participant):
        loop.call_soon_threadsafe(lifecycle.participant_joined, participant)
    def left(participant):
        loop.call_soon_threadsafe(lifecycle.participant_left, participant)
    def disconnected(*_args):
        loop.call_soon_threadsafe(lifecycle.room_disconnected)
    handlers = (("participant_connected", joined), ("participant_disconnected", left), ("disconnected", disconnected))
    for event, callback in handlers:
        ctx.room.on(event, callback)
    try:
        lifecycle.state = SessionState.CONNECTING
        await ctx.connect(auto_subscribe=auto_subscribe)
        for participant in ctx.room.remote_participants.values():
            lifecycle.participant_joined(participant)
        lifecycle.state = SessionState.ACTIVE
        print("VOICEPILOT_CONNECTIVITY_WORKER_JOINED", flush=True)
        await lifecycle.wait()
    except asyncio.CancelledError:
        lifecycle.request_stop("worker_cancelled")
        raise
    finally:
        for event, callback in handlers:
            ctx.room.off(event, callback)
        await lifecycle.cleanup()
        print("VOICEPILOT_CONNECTIVITY_LIFECYCLE " + json.dumps({"state":lifecycle.state.value,"reason":lifecycle.stop_reason or "worker_shutdown","cleanup_error":lifecycle.cleanup_error}), flush=True)
        if lifecycle.state is SessionState.STOPPED:
            print("VOICEPILOT_CONNECTIVITY_WORKER_DISCONNECTED", flush=True)
