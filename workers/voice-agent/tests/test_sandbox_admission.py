import time
import pytest
from voice_agent.sandbox_admission import validate_worker_admission

CLAIMS = {"organization_id": "org-a", "agent_id": "agent-a", "actor_id": "user-a", "session_id": "11111111-1111-4111-8111-111111111111", "issued_at": 1000, "expires_at": 2000, "capability": "voice_sandbox", "max_duration_seconds": 60, "max_concurrent_sessions": 1, "provider_activation_enabled": False, "emergency_stop": False}

def test_worker_accepts_only_matching_offline_admission():
    result = validate_worker_admission(CLAIMS, organization_id="org-a", agent_id="agent-a", actor_id="user-a", now_ms=1500)
    assert result.session_id == CLAIMS["session_id"]

@pytest.mark.parametrize("kwargs", [{"organization_id": "org-b"}, {"agent_id": "agent-b"}, {"actor_id": "user-b"}, {"replayed": True}, {"revoked": True}, {"emergency_stop": True}, {"concurrency_available": False}, {"provider_activation_enabled": True}])
def test_worker_rejects_spoofed_or_unavailable_admission(kwargs):
    base = {"organization_id": "org-a", "agent_id": "agent-a", "actor_id": "user-a", "now_ms": 1500}
    base.update(kwargs)
    with pytest.raises(PermissionError):
        validate_worker_admission(CLAIMS, **base)

def test_worker_rejects_expired_or_malformed_claims():
    with pytest.raises(PermissionError):
        validate_worker_admission({**CLAIMS, "expires_at": 1000}, organization_id="org-a", agent_id="agent-a", actor_id="user-a", now_ms=1000)
    with pytest.raises(PermissionError):
        validate_worker_admission({**CLAIMS, "session_id": "not-a-uuid"}, organization_id="org-a", agent_id="agent-a", actor_id="user-a", now_ms=1500)
