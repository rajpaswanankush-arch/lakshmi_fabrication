import { test } from "node:test";
import assert from "node:assert/strict";
import { initialData, ledgerDeletionGroup, unlinkWorkerLedgerEntries, validateBackup, type Ledger } from "../src/lib/model";
import { createBackup, readBackup } from "../src/lib/backup";

const originalId = "9f9bb253-7abb-406d-a4a4-c963d10032f8";
const reversalId = "4405f261-36b7-4bd3-852e-f83deba25f3d";
const sundayWorker = { id: "0002", name: "SUNDAY", phone: "", role: "Labour" as const, status: "Active" as const, wageType: "Monthly" as const, monthlyWage: 0, dailyWage: 0 };
const original: Ledger = { id: originalId, date: "2026-10-01", kind: "Labour payment", description: "SUNDAY", amount: 500, workerId: "0002", status: "Reversed", approvedBy: "Owner", adjustmentReason: "PAID" };
const reversal: Ledger = { id: reversalId, date: "2026-10-16", kind: "Labour payment", description: "Reversal: SUNDAY", amount: 500, workerId: "0002", status: "Reversed", reversalOf: originalId, approvedBy: "Owner", adjustmentReason: "PAID" };

test("SUNDAY ₹500 deletion removes the linked reversal and keeps backup export and restore valid", async () => {
  const unrelated: Ledger = { id: "family", date: "2026-10-15", kind: "Family transfer", description: "TO ARTI DEVI", amount: 90000 };
  const linked = ledgerDeletionGroup([unrelated, original, reversal], original.id);
  assert.deepEqual(linked.map(entry => entry.id), [original.id, reversal.id]);
  assert.equal(linked.filter(entry => entry.status !== "Reversed").reduce((sum, entry) => sum + entry.amount, 0), 0);

  const repaired = validateBackup({ ...initialData, workers: [sundayWorker], ledger: [unrelated] });
  assert.deepEqual(repaired.ledger, [unrelated]);
  assert.deepEqual((await readBackup(await createBackup(repaired))).ledger, [unrelated]);
});

test("reported orphan reversal identifies both IDs and refuses restore without changing the backup", () => {
  const orphanBackup = { ...initialData, workers: [sundayWorker], ledger: [reversal] };
  const before = JSON.stringify(orphanBackup);
  assert.throws(
    () => validateBackup(orphanBackup),
    new RegExp(`Backup contains reversal ${reversalId} with no original transaction ${originalId}\\. No records were changed\\. Reload the latest shared workspace\\.`),
  );
  assert.equal(JSON.stringify(orphanBackup), before);
});

test("deleting a worker keeps cashbook entries that have no worker link", () => {
  const familyTransfer: Ledger = { id: "family", date: "2026-10-15", kind: "Family transfer", description: "TO ARTI DEVI", amount: 90000 };
  const workerPayment: Ledger = { id: "pay", date: "2026-10-15", kind: "Labour payment", description: "Wage", amount: 500, workerId: "0001" };
  assert.deepEqual(unlinkWorkerLedgerEntries([familyTransfer, workerPayment], "0001"), [
    familyTransfer,
    { id: "pay", date: "2026-10-15", kind: "Labour payment", description: "Wage", amount: 500 },
  ]);
});
