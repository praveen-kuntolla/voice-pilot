import { randomUUID } from "node:crypto";
import { signAdmission, type SignedAdmissionClaims, type SignedAdmission } from "./signed-admission";

/** Test-only issuer. It deliberately cannot run in production or without an explicit local flag. */
export function issueOfflineSandboxAssertion(input: Omit<SignedAdmissionClaims, "version" | "assertionId" | "providerActivationEnabled"> & { secret: string }): SignedAdmission {
  if (process.env.NODE_ENV === "production" || process.env.VOICE_OFFLINE_ADMISSION_TEST_ENABLED !== "true") throw new Error("Offline admission test issuer is disabled");
  const { secret, ...rest } = input;
  const claims: SignedAdmissionClaims = { ...rest, version: 1, assertionId: randomUUID(), providerActivationEnabled: false };
  return { claims, signature: signAdmission(claims, secret) };
}
