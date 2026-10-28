import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authorizeTrustedActor, organizationRoles, type AuthoritativeMembership, type TrustedOperation } from "@/lib/trusted-authorization";

if (typeof window !== "undefined") throw new Error("Trusted authorization is server-only");

export async function authorizeCurrentServerActor(input: {
  organizationId?: string;
  operation: TrustedOperation;
  claimedActorId?: string;
  now?: number;
}) {
  const supabase = await createSupabaseServerClient();
  const organizationId = input.organizationId ?? (await cookies()).get("voicepilot_org")?.value ?? "";
  return authorizeTrustedActor({
    async getVerifiedIdentity() {
      const [{ data: userData, error: userError }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
      ]);
      if (userError || !userData.user || !sessionData.session || sessionData.session.user.id !== userData.user.id) return null;
      const expiresAt = sessionData.session?.expires_at;
      return typeof expiresAt === "number" ? { id: userData.user.id, expiresAt: expiresAt * 1000 } : null;
    },
    async getMembership(userId, requestedOrganizationId) {
      const { data, error } = await supabase.from("organization_members")
        .select("organization_id,user_id,role")
        .eq("organization_id", requestedOrganizationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("membership lookup unavailable");
      if (!data || !organizationRoles.includes(data.role)) return null;
      return { organizationId: data.organization_id, userId: data.user_id, role: data.role } as AuthoritativeMembership;
    },
  }, { organizationId, operation: input.operation, claimedActorId: input.claimedActorId }, input.now ?? Date.now());
}
