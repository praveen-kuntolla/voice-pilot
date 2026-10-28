export const organizationRoles = ["owner", "admin", "member", "viewer"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];
export type TrustedOperation = "view" | "simulate" | "manage_safety" | "execute_privileged";

export type VerifiedIdentity = {
  id: string;
  expiresAt: number;
  revoked?: boolean;
};

export type AuthoritativeMembership = {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
};

export type AuthorizationDenial =
  | "unauthenticated"
  | "session_expired"
  | "session_revoked"
  | "invalid_organization"
  | "membership_not_found"
  | "membership_unavailable"
  | "role_not_permitted"
  | "spoofed_actor";

export type TrustedAuthorizationResult =
  | { ok: true; actorId: string; organizationId: string; role: OrganizationRole; operation: TrustedOperation }
  | { ok: false; reason: AuthorizationDenial };

export interface TrustedIdentitySource {
  getVerifiedIdentity(): Promise<VerifiedIdentity | null>;
  getMembership(userId: string, organizationId: string): Promise<AuthoritativeMembership | null>;
}
const allowed: Record<OrganizationRole, ReadonlySet<TrustedOperation>> = {
  owner: new Set(["view", "simulate", "manage_safety", "execute_privileged"]),
  admin: new Set(["view", "simulate", "manage_safety", "execute_privileged"]),
  member: new Set(["view", "simulate"]),
  viewer: new Set(["view"]),
};

const validId = (value: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 128;

export async function authorizeTrustedActor(
  source: TrustedIdentitySource,
  request: { organizationId: string; operation: TrustedOperation; claimedActorId?: string },
  now: number,
): Promise<TrustedAuthorizationResult> {
  if (!validId(request.organizationId) || !Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid_organization" };
  let identity: VerifiedIdentity | null;
  try { identity = await source.getVerifiedIdentity(); }
  catch { return { ok: false, reason: "unauthenticated" }; }
  if (!identity || !validId(identity.id)) return { ok: false, reason: "unauthenticated" };
  if (identity.revoked === true) return { ok: false, reason: "session_revoked" };
  if (!Number.isSafeInteger(identity.expiresAt) || identity.expiresAt <= now) return { ok: false, reason: "session_expired" };
  if (request.claimedActorId !== undefined && request.claimedActorId !== identity.id) return { ok: false, reason: "spoofed_actor" };
  let membership: AuthoritativeMembership | null;
  try { membership = await source.getMembership(identity.id, request.organizationId); }
  catch { return { ok: false, reason: "membership_unavailable" }; }
  if (!membership) return { ok: false, reason: "membership_not_found" };
  if (membership.userId !== identity.id || membership.organizationId !== request.organizationId || !organizationRoles.includes(membership.role)) return { ok: false, reason: "membership_not_found" };
  if (!allowed[membership.role].has(request.operation)) return { ok: false, reason: "role_not_permitted" };
  return { ok: true, actorId: identity.id, organizationId: membership.organizationId, role: membership.role, operation: request.operation };
}
