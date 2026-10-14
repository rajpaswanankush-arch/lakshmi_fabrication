import { AppData, validateBackup } from "./model";
export type BackupEnvelope = { app: "Lakshmi Fabrication"; schemaVersion: 1; createdAt: string; sha256: string; data: AppData };
const encoder = new TextEncoder();
function canonical(data: AppData) { return JSON.stringify({ ...data, updatedAt: new Date(data.updatedAt).toISOString() }); }
export async function createBackup(data: AppData): Promise<string> {
  const encoded = canonical(data);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(encoded));
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const envelope: BackupEnvelope = { app: "Lakshmi Fabrication", schemaVersion: 1, createdAt: new Date().toISOString(), sha256, data: JSON.parse(encoded) as AppData };
  return JSON.stringify(envelope, null, 2);
}
export async function readBackup(text: string): Promise<AppData> {
  if (text.length > 50 * 1024 * 1024) throw new Error("Backup file exceeds the 50 MB safety limit.");
  let x: unknown; try { x = JSON.parse(text); } catch { throw new Error("Backup file is not valid JSON."); }
  if (!x || typeof x !== "object") throw new Error("Backup file is invalid.");
  const e = x as Partial<BackupEnvelope>;
  if (e.app !== "Lakshmi Fabrication" || e.schemaVersion !== 1 || typeof e.sha256 !== "string" || !e.data) throw new Error("Backup format or version is not supported.");
  const raw = e.data as AppData;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonical(raw)));
  const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  if (actual !== e.sha256) throw new Error("Backup integrity check failed. No records were changed.");
  return validateBackup(raw);
}
