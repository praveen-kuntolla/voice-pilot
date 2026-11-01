import assert from "node:assert/strict";
import { loadSyntheticFixtureIdentity } from "./disposable-voice-gateway.mjs";
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222", c = "33333333-3333-4333-8333-333333333333", d = "44444444-4444-4444-8444-444444444444";
const valid = { users: [{ id: a, organization_id: b, agent_id: c }, { id: d, organization_id: "55555555-5555-4555-8555-555555555555" }] };
assert.deepEqual(loadSyntheticFixtureIdentity(valid), { actorId: a, organizationId: b, agentId: c, otherOrganizationId: "55555555-5555-4555-8555-555555555555" });
assert.throws(() => loadSyntheticFixtureIdentity({ users: [{ id: "bad", organization_id: b, agent_id: c }] }), /Invalid disposable fixture actorId/);
assert.throws(() => loadSyntheticFixtureIdentity({ users: [{ id: a, organization_id: b }] }), /Invalid disposable fixture agentId/);
assert.throws(() => loadSyntheticFixtureIdentity({ users: [{ id: a, organization_id: b, agent_id: c }, { id: d, organization_id: b }] }), /different organization/);
console.log("DISPOSABLE_FIXTURE_BINDING_OK 4 cases passed");
