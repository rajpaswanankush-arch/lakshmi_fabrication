import type { AppData } from "./model";

export type CloudSnapshot = { revision: string; snapshot: AppData };
export type PendingWorkspace = { baseRevision: string | null };
export type InitialWorkspaceResolution =
  | { kind: "cloud"; snapshot: AppData; preserveLocal: boolean }
  | { kind: "cloud-with-recovery"; snapshot: AppData; preserveLocal: boolean }
  | { kind: "pending"; snapshot: AppData; preserveLocal: boolean }
  | { kind: "conflict"; snapshot: AppData; preserveLocal: boolean }
  | { kind: "create-from-local"; snapshot: AppData; preserveLocal: false };

const hasRecords = (data: AppData) => data.workers.length + data.contracts.length + data.attendance.length + data.ledger.length + data.equipment.length + data.maintenance.length + data.wageHistory.length > 0;

/** The cloud wins over an unmarked browser cache. Only explicitly marked pending edits may compete. */
export function resolveInitialWorkspace(local: AppData, cloud: CloudSnapshot | null, pending: PendingWorkspace | null): InitialWorkspaceResolution {
  if (!cloud) return { kind: "create-from-local", snapshot: local, preserveLocal: false };
  const localDiffers = JSON.stringify(local) !== JSON.stringify(cloud.snapshot);
  if (!localDiffers) return { kind: "cloud", snapshot: cloud.snapshot, preserveLocal: false };
  if (!pending) return { kind: "cloud-with-recovery", snapshot: cloud.snapshot, preserveLocal: hasRecords(local) };
  if (pending.baseRevision === cloud.revision) return { kind: "pending", snapshot: local, preserveLocal: false };
  return { kind: "conflict", snapshot: cloud.snapshot, preserveLocal: true };
}

export type RemoteSnapshotDecision = "unchanged" | "apply-cloud" | "conflict";
export function decideRemoteSnapshot(current: AppData, lastSynced: AppData | null, currentRevision: string | null, next: CloudSnapshot): RemoteSnapshotDecision {
  if (next.revision === currentRevision) return "unchanged";
  return lastSynced && JSON.stringify(current) === JSON.stringify(lastSynced) ? "apply-cloud" : "conflict";
}

export type WorkspaceWriteResult = { status: "saved"; revision: string; snapshot?: AppData } | { status: "conflict"; revision: string; snapshot: AppData };
export function parseWorkspaceWriteResult(result: unknown): WorkspaceWriteResult {
  if (!result || typeof result !== "object") throw new Error("Cloud did not confirm the save.");
  const value = result as { status?: unknown; revision?: unknown; snapshot?: unknown };
  if (value.status === "saved" && typeof value.revision === "string") return { status: "saved", revision: value.revision, snapshot: value.snapshot as AppData | undefined };
  if (value.status === "conflict" && typeof value.revision === "string" && value.snapshot && typeof value.snapshot === "object") return { status: "conflict", revision: value.revision, snapshot: value.snapshot as AppData };
  throw new Error("Cloud did not confirm the save.");
}

export function canConfirmWorkerDeletion(role: string | null, typedText: string, reason: string): boolean {
  return role === "owner" && typedText === "DELETE" && reason.trim().length >= 3;
}

export function canConfirmWorkspaceReset(role: string | null, typedText: string, reason: string): boolean {
  return role === "owner" && typedText === "RESET WORKSPACE" && reason.trim().length >= 3;
}

/** Block autosaves and remote refreshes while an audited destructive mutation is in flight. */
export function mayStartWorkspaceSync(mutationInFlight: boolean): boolean {
  return !mutationInFlight;
}

