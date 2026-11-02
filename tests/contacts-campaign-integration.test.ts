import { describe, expect, it } from "vitest";
import { contactSchema } from "@/lib/schemas";
import { eligibleContacts } from "@/lib/campaign-simulation";
const campaign = { id: "c", organization_id: "org-a", agent_id: "agent-a", status: "draft", consent_required: true } as const;
describe("contacts and campaign consent integration", () => {
  it("validates contact identity fields and consent values", () => {
    expect(contactSchema.safeParse({ name: "A contact", phone: "+15550000001", email: "a@example.test", consent_status: "granted" }).success).toBe(true);
    expect(contactSchema.safeParse({ name: "A contact", phone: "not-a-phone", consent_status: "granted" }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "x", email: "not-an-email", consent_status: "granted" }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "A contact", consent_status: "unknown" }).success).toBe(true);
  });
  it("fails closed for unknown, revoked, opted-out and cross-tenant contacts", () => {
    expect(eligibleContacts(campaign, { id: "1", name: "Unknown", organization_id: "org-a", consent_status: "unknown" })).toMatchObject({ eligible: false, reason: "Consent is unknown." });
    expect(eligibleContacts(campaign, { id: "2", name: "Revoked", organization_id: "org-a", consent_status: "revoked" })).toMatchObject({ eligible: false });
    expect(eligibleContacts(campaign, { id: "3", name: "Opted out", organization_id: "org-a", consent_status: "granted", opted_out_at: "2026-01-01" })).toMatchObject({ eligible: false });
    expect(eligibleContacts(campaign, { id: "4", name: "Other tenant", organization_id: "org-b", consent_status: "granted" })).toMatchObject({ eligible: false });
  });
});
