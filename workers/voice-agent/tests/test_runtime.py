import pytest
from voice_agent.config import load_config, validate_realtime_config
from voice_agent.runtime import RuntimeConfig, conversation
from voice_agent.security import authorize_agent
from voice_agent.service_client import signed_config_request
from voice_agent.providers import ProviderConfig, ProviderInitializationError, build_provider_bundle

CFG=RuntimeConfig("org-1","agent-1","en-US","Be concise")
def test_mock_flow_is_deterministic():
    assert [state for state,_ in conversation(CFG)] == ["greeting","listening","understanding","responding","speaking","ended"]
def test_disabled_by_default():
    with pytest.raises(RuntimeError, match="disabled"): validate_realtime_config(load_config({}))
def test_missing_credentials():
    with pytest.raises(RuntimeError, match="incomplete"): validate_realtime_config(load_config({"VOICE_WORKER_ENABLED":"true","VOICE_REALTIME_ENABLED":"true"}))
def test_tenant_mismatch_rejected():
    with pytest.raises(PermissionError): authorize_agent(authenticated_user_id="u",requested_organization_id="org-1",requested_agent_id="a",membership_organization_id="org-1",agent_organization_id="org-2")
def test_service_secret_required():
    with pytest.raises(RuntimeError, match="secret"):
        signed_config_request(load_config({}), "http://127.0.0.1:1", "org-1", "agent-1", "voicepilot:org-1:agent-1:session")
def test_mock_provider_bundle_is_deterministic():
    bundle=build_provider_bundle(ProviderConfig("mock","mock","mock"))
    assert bundle.stt.__class__.__name__ == "MockSTT"
def test_real_provider_bundle_fails_closed():
    with pytest.raises(ProviderInitializationError, match="not enabled"):
        build_provider_bundle(ProviderConfig("real","real","real"), mode="real")

def test_real_provider_mode_needs_a_server_side_activation_gate():
    with pytest.raises(RuntimeError, match="activation"):
        validate_realtime_config(load_config({"VOICE_WORKER_ENABLED":"true","VOICE_REALTIME_ENABLED":"true","LIVEKIT_URL":"wss://isolated.example","LIVEKIT_API_KEY":"key","LIVEKIT_API_SECRET":"secret","VOICE_STT_PROVIDER":"deepgram","VOICE_LLM_PROVIDER":"openai","VOICE_TTS_PROVIDER":"elevenlabs","VOICE_PROVIDER_MODE":"real"}))
