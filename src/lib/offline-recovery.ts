export const offlineRecoveryStates = ["termination_requested", "cleanup_failed", "termination_unconfirmed", "awaiting_reconciliation", "confirmed_cleanup", "released"] as const;
export type OfflineRecoveryState = typeof offlineRecoveryStates[number];
const labels: Record<OfflineRecoveryState, string> = { termination_requested: "Termination requested", cleanup_failed: "Cleanup failed", termination_unconfirmed: "Termination unconfirmed", awaiting_reconciliation: "Awaiting reconciliation", confirmed_cleanup: "Cleanup confirmed", released: "Released" };
export function offlineRecoveryStateLabel(value: unknown): string { return typeof value === "string" && value in labels ? labels[value as OfflineRecoveryState] : "Unknown recovery state"; }
export function isOfflineRecoveryState(value: unknown): value is OfflineRecoveryState { return typeof value === "string" && offlineRecoveryStates.includes(value as OfflineRecoveryState); }
