from voice_agent.offline_admission import OfflineAdmissionWorkflow
from voice_agent.signed_admission import canonical_admission
import hashlib, hmac

def assertion():
    claims={"version":1,"keyId":"test-key-1","assertionId":"22222222-2222-4222-8222-222222222222","organizationId":"org-a","agentId":"agent-a","actorId":"user-a","sessionId":"11111111-1111-4111-8111-111111111111","issuedAt":1000,"expiresAt":2000,"capability":"voice_sandbox","maxDurationSeconds":60,"usageLimit":{"inputCharacters":100,"outputCharacters":200},"providerActivationEnabled":False}
    return {"claims":claims,"signature":hmac.new(b"offline-test-signing-key",canonical_admission(claims).encode(),hashlib.sha256).hexdigest()}

def test_offline_worker_admits_once_and_cleans_terminal_state():
    value=assertion(); flow=OfflineAdmissionWorkflow(lambda key:"offline-test-signing-key" if key=="test-key-1" else None,1500,set(),set(),set())
    assert flow.admit(value,organization_id="org-a",agent_id="agent-a",actor_id="user-a")
    assert not flow.admit(value,organization_id="org-a",agent_id="agent-a",actor_id="user-a")
    flow.complete(value["claims"]["sessionId"],value["claims"]["assertionId"])
    assert value["claims"]["sessionId"] not in flow.active

def test_offline_worker_rejects_tenant_and_policy_changes():
    value=assertion(); flow=OfflineAdmissionWorkflow(lambda _:"offline-test-signing-key",1500,set(),set(),set())
    assert not flow.admit(value,organization_id="org-b",agent_id="agent-a",actor_id="user-a")
    assert not flow.admit(value,organization_id="org-a",agent_id="agent-a",actor_id="user-a",emergency_stop=True)
