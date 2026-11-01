import json
from pathlib import Path
from voice_agent.signed_admission import verify_signed_admission

VECTOR = json.loads(Path(__file__).parents[2].parent.joinpath("tests/fixtures/signed-admission-vector.json").read_text())

def test_python_verifies_shared_vector():
    assert verify_signed_admission(VECTOR, lambda key: VECTOR["secret"] if key == "test-key-1" else None, now_ms=1500, organization_id="org-a", agent_id="agent-a", actor_id="user-a")

def test_python_rejects_tamper_and_security_state():
    value = {**VECTOR, "claims": {**VECTOR["claims"], "actorId": "user-b"}}
    assert not verify_signed_admission(value, lambda _: VECTOR["secret"], now_ms=1500, organization_id="org-a", agent_id="agent-a", actor_id="user-a")
    assert not verify_signed_admission(VECTOR, lambda _: VECTOR["secret"], now_ms=1500, organization_id="org-a", agent_id="agent-a", actor_id="user-a", replayed=True)
