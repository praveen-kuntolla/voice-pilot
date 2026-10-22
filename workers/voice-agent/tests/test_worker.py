import asyncio
import hashlib
import hmac
import json
import time
import pytest
from voice_agent.config import load_config, validate_connectivity_config
from voice_agent.runtime import RuntimeConfig
from voice_agent.service_client import runtime_config_from_response, signed_config_request, validate_config_endpoint
from voice_agent.worker import build_worker_plan, create_livekit_server, load_runtime_config, parse_room_name, run_connectivity_session

ORG = "11111111-1111-4111-8111-111111111111"
AGENT = "22222222-2222-4222-8222-222222222222"
SESSION = "33333333-3333-4333-8333-333333333333"
ROOM = f"voicepilot:{ORG}:{AGENT}:{SESSION}"

def enabled_config():
    return load_config({
        "VOICE_WORKER_ENABLED": "true",
        "VOICE_REALTIME_ENABLED": "true",
        "LIVEKIT_URL": "wss://isolated.example",
        "LIVEKIT_API_KEY": "key",
        "LIVEKIT_API_SECRET": "secret",
        "VOICE_STT_PROVIDER": "approved-stt",
        "VOICE_LLM_PROVIDER": "approved-llm",
        "VOICE_TTS_PROVIDER": "approved-tts",
        "VOICE_WORKER_SHARED_SECRET": "test-secret",
        "VOICE_PROVIDER_MODE": "real",
        "VOICE_PROVIDER_ACTIVATION_ENABLED": "true",
    })

def test_room_name_is_strictly_tenant_scoped():
    room = parse_room_name(ROOM)
    assert room.organization_id == ORG
    assert room.agent_id == AGENT
    assert room.session_id == SESSION
    with pytest.raises(ValueError): parse_room_name("other:org:agent")

def test_worker_plan_fails_closed_when_disabled():
    with pytest.raises(RuntimeError, match="disabled"):
        build_worker_plan(load_config({}), ROOM)

def test_enabled_worker_plan_accepts_strict_room():
    assert build_worker_plan(enabled_config(), ROOM).agent_id == AGENT

def test_configuration_loader_must_match_room_tenant():
    async def loader(org, agent, room): return RuntimeConfig(org, agent, "en-US", "Be safe", session_id=SESSION)
    config = asyncio.run(load_runtime_config(loader, ROOM))
    assert config.agent_id == AGENT

    async def wrong_loader(org, agent, room): return RuntimeConfig("wrong-org", agent, "en-US", "bad", session_id=SESSION)
    with pytest.raises(PermissionError): asyncio.run(load_runtime_config(wrong_loader, ROOM))

def test_service_response_is_minimal_and_tenant_bound():
    result = runtime_config_from_response({"agent": {"id": AGENT, "organization_id": ORG, "language": "en", "instructions": "Be safe", "voice_id": "mock"}}, ORG, AGENT)
    assert result.voice_id == "mock"
    with pytest.raises(PermissionError):
        runtime_config_from_response({"id": AGENT, "organization_id": "wrong", "language": "en", "instructions": "x"}, ORG, AGENT)
    scoped = {"agent": {"id": AGENT, "organization_id": ORG, "session_id": SESSION,
                        "session_expires_at": int(time.time()*1000)+60000,
                        "authorized_browser_identity": "browser", "language": "en", "instructions": "Safe"}}
    assert runtime_config_from_response(scoped, ORG, AGENT, SESSION).session_id == SESSION
    with pytest.raises(PermissionError):
        runtime_config_from_response(scoped, ORG, AGENT, "other-session")

def connectivity_config(**overrides):
    values = {
        "VOICE_WORKER_ENABLED": "true", "VOICE_REALTIME_ENABLED": "false",
        "VOICE_CONNECTIVITY_TEST_ENABLED": "true", "VOICE_OUTBOUND_ENABLED": "false",
        "VOICE_PROVIDER_MODE": "mock", "LIVEKIT_URL": "wss://isolated-test.livekit.cloud",
        "LIVEKIT_TEST_PROJECT_HOST": "isolated-test.livekit.cloud", "LIVEKIT_API_KEY": "test-key",
        "LIVEKIT_API_SECRET": "test-secret", "VOICE_WORKER_SHARED_SECRET": "test-service-secret",
    }
    values.update(overrides)
    return load_config(values)

def test_connectivity_configuration_rejects_outbound_and_wrong_project():
    validate_connectivity_config(connectivity_config())
    with pytest.raises(RuntimeError, match="forbids"):
        validate_connectivity_config(connectivity_config(VOICE_OUTBOUND_ENABLED="true"))
    with pytest.raises(RuntimeError, match="test project"):
        validate_connectivity_config(connectivity_config(LIVEKIT_URL="wss://other.livekit.cloud"))
    with pytest.raises(RuntimeError, match="disabled"):
        validate_connectivity_config(connectivity_config(VOICE_CONNECTIVITY_TEST_ENABLED="false"))

def test_connectivity_config_endpoint_must_be_local_and_fixed_path():
    validate_config_endpoint("http://127.0.0.1:3001/api/internal/voice-agent/config", True)
    with pytest.raises(RuntimeError):
        validate_config_endpoint("https://example.com/api/internal/voice-agent/config", True)
    with pytest.raises(RuntimeError):
        validate_config_endpoint("http://localhost:3001/other", True)

def test_connectivity_session_checks_tenant_before_join_and_cleans_up(capsys):
    class Room:
        name = ROOM
        callbacks = {}
        remote_participants = {}
        disconnects = 0
        def on(self, event, callback): self.callbacks[event] = callback
        def off(self, event, callback):
            if self.callbacks.get(event) is callback: del self.callbacks[event]
        async def disconnect(self): self.disconnects += 1
    class Context:
        room = Room()
        joins = 0
        async def connect(self, *, auto_subscribe):
            self.joins += 1
            assert auto_subscribe == "none"
            self.room.callbacks["participant_disconnected"](type("Participant", (), {"identity":"browser"})())
    context = Context()
    async def loader(org, agent, room): return RuntimeConfig(org, agent, "en", "Safe local fixture", authorized_browser_identity="browser", session_id=SESSION, session_expires_at=int(time.time()*1000)+60000)
    asyncio.run(run_connectivity_session(context, loader, "none"))
    assert context.joins == 1
    assert context.room.callbacks == {}
    assert context.room.disconnects == 1
    assert "VOICEPILOT_CONNECTIVITY_WORKER_JOINED" in capsys.readouterr().out

    async def wrong_loader(org, agent, room): return RuntimeConfig("wrong", agent, "en", "Bad fixture", session_id=SESSION)
    with pytest.raises(PermissionError):
        asyncio.run(run_connectivity_session(context, wrong_loader, "none"))
    assert context.joins == 1

def test_connectivity_worker_registration_has_no_media_permissions(monkeypatch):
    import livekit.agents
    captured = {}
    class FakeServer:
        def __init__(self, **kwargs): captured.update(kwargs)
        def rtc_session(self):
            return lambda fn: fn
    monkeypatch.setattr(livekit.agents, "AgentServer", FakeServer)
    async def loader(org, agent, room): return RuntimeConfig(org, agent, "en", "Safe fixture", session_id=SESSION)
    server, _ = create_livekit_server(connectivity_config(), loader)
    assert isinstance(server, FakeServer)
    assert captured["permissions"].can_publish is False
    assert captured["permissions"].can_subscribe is False
    assert captured["permissions"].can_publish_data is False
    assert captured["permissions"].can_update_metadata is False

def test_signed_configuration_request_binds_exact_room_and_body(monkeypatch):
    import urllib.request
    captured = {}
    class Response:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_args): return False
        def read(self): return json.dumps({"agent": {"id": AGENT, "organization_id": ORG}}).encode()
    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    endpoint = "http://127.0.0.1:3001/api/internal/voice-agent/config"
    assert signed_config_request(connectivity_config(), endpoint, ORG, AGENT, ROOM)["agent"]["id"] == AGENT
    request = captured["request"]
    body = request.data.decode()
    assert json.loads(body)["room_name"] == ROOM
    assert request.get_method() == "POST"
    assert captured["timeout"] == 5.0
    headers = {key.lower(): value for key, value in request.header_items()}
    canonical = "\n".join(("POST", "/api/internal/voice-agent/config", headers["x-voice-worker-timestamp"], headers["x-voice-worker-nonce"], body))
    expected = hmac.new(b"test-service-secret", canonical.encode(), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(headers["x-voice-worker-signature"], expected)
