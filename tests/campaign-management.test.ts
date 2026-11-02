import { describe, expect, it } from "vitest";
import { campaignSchema } from "@/lib/schemas";
import { isAssignableAgentRecord } from "@/app/api/campaigns/route";

describe("campaign management safety", () => {
  it("rejects archived agents from campaign assignment", () => {
    expect(isAssignableAgentRecord({ status: "draft" })).toBe(true);
    expect(isAssignableAgentRecord({ status: "active" })).toBe(true);
    expect(isAssignableAgentRecord({ status: "archived" })).toBe(false);
    expect(isAssignableAgentRecord(null)).toBe(false);
  });
  it("validates draft campaign configuration and calling hours", () => {
    expect(campaignSchema.safeParse({ name: "Outbound prep", timezone: "UTC", start_hour: 9, end_hour: 17, consent_required: true, agent_id: null, status: "draft" }).success).toBe(true);
    expect(campaignSchema.safeParse({ name: "x", timezone: "UTC", start_hour: 17, end_hour: 9, consent_required: true }).success).toBe(false);
  });
});
