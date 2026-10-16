import { test } from "node:test";
import assert from "node:assert/strict";
import { initialData, ledgerDeletionGroup, unlinkWorkerLedgerEntries, validateBackup } from "../src/lib/model";
import { createBackup, readBackup } from "../src/lib/backup";

test("SUNDAY ₹500 deletion removes its linked reversal and keeps backup restore valid", async () => {
  const original={id:"9f9bb253-7abb-406d-a4a4-c963d10032f8",date:"2026-10-01",kind:"Labour payment" as const,description:"SUNDAY",amount:500,workerId:"0002",status:"Reversed" as const,approvedBy:"Owner",adjustmentReason:"PAID"};
  const reversal={id:"4405f261-36b7-4bd3-852e-f83deba25f3d",date:"2026-10-16",kind:"Labour payment" as const,description:"Reversal: SUNDAY",amount:500,workerId:"0002",status:"Reversed" as const,reversalOf:original.id,approvedBy:"Owner",adjustmentReason:"PAID"};
  const unrelated={id:"family",date:"2026-10-15",kind:"Family transfer" as const,description:"TO ARTI DEVI",amount:90000};

  const linked=ledgerDeletionGroup([unrelated,original,reversal],original.id);
  assert.deepEqual(linked.map(entry=>entry.id),[original.id,reversal.id]);
  assert.equal(linked.filter(entry=>entry.status!=="Reversed").reduce((sum,entry)=>sum+entry.amount,0),0);

  const repaired=validateBackup({...initialData,ledger:[unrelated]});
  assert.deepEqual(repaired.ledger,[unrelated]);
  assert.deepEqual((await readBackup(await createBackup(repaired))).ledger,[unrelated]);
});

test("deleting a worker keeps cashbook entries that have no worker link", () => {
  const familyTransfer={id:"family",date:"2026-10-15",kind:"Family transfer" as const,description:"TO ARTI DEVI",amount:90000};
  const workerPayment={id:"pay",date:"2026-10-15",kind:"Labour payment" as const,description:"Wage",amount:500,workerId:"0001"};
  assert.deepEqual(unlinkWorkerLedgerEntries([familyTransfer,workerPayment],"0001"),[
    familyTransfer,
    {id:"pay",date:"2026-10-15",kind:"Labour payment",description:"Wage",amount:500},
  ]);
});

