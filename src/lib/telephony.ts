import { z } from "zod";

export const telephonyConfigSchema = z.object({
  provider: z.enum(["mock", "twilio", "telnyx"]).default("mock"),
  mode: z.enum(["disabled", "sandbox", "production"]).default("disabled"),
  accountReference: z.string().trim().min(1).max(120).optional(),
  fromNumber: z.string().trim().max(32).optional(),
});

export type TelephonyConfig = z.infer<typeof telephonyConfigSchema>;
export type TelephonyReadiness = "disabled" | "sandbox" | "production";

export function validateTelephonyConfig(input: unknown) {
  const parsed = telephonyConfigSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, errors: parsed.error.issues.map((issue) => issue.message) };
  if (parsed.data.mode !== "disabled" && parsed.data.provider === "mock") {
    return { ok: false as const, errors: ["Mock telephony cannot be activated outside disabled mode."] };
  }
  return { ok: true as const, config: parsed.data };
}

export function telephonyReadiness(config: TelephonyConfig = { provider: "mock", mode: "disabled" }): TelephonyReadiness {
  return config.mode;
}

/** Deliberately fail-closed: this phase has no call-capable adapter. */
export function assertTelephonyActivationAllowed(config: TelephonyConfig): never {
  throw new Error(config.mode === "disabled" ? "Telephony is disabled." : "Live telephony activation is not available in simulation mode.");
}
