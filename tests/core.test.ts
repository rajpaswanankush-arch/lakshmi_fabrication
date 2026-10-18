import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceUnits, initialData, payrollSummary, unpaidMonthlyWages, validateBackup, workerDeletionBlockers, overtimeMonthSummary, upsertAttendance, workerFinancialSummary } from "../src/lib/model";
import { createBackup, readBackup } from "../src/lib/backup";
import { buildBackupTables, createExcelBackupBuffer, createPdfBackupBuffer } from "../src/lib/backup-exports";
import { canConfirmWorkerDeletion, canConfirmWorkspaceReset, mayStartWorkspaceSync, decideRemoteSnapshot, parseWorkspaceWriteResult, resolveInitialWorkspace } from "../src/lib/workspace-sync";

test("report backups include worker, site, attendance, cashbook, and audit records while excluding reversed amounts from totals", () => {
  const data={...initialData,
    workers:[{id:"1001",name:"Mantosh Test Worker",phone:"9000000000",role:"Labour" as const,status:"Active" as const,wageType:"Daily" as const,monthlyWage:0,dailyWage:700}],
    companies:[{id:"co-1",name:"Example Company",phone:"9000000001"}],
    contracts:[{id:"site-1",company:"Example Company",companyId:"co-1",title:"Workshop",location:"Hyderabad",value:5000,received:1000,status:"Active" as const,instruments:2}],
    attendance:[{id:"att-1",workerId:"1001",date:"2026-10-01",regularHours:8,overtimeHours:2,status:"P" as const,approvedBy:"Owner"}],
    ledger:[
      {id:"receipt-1",date:"2026-10-01",kind:"Receipt" as const,description:"Site advance",amount:1000,contractId:"site-1"},
      {id:"expense-1",date:"2026-10-02",kind:"Project expense" as const,description:"Materials",amount:250,contractId:"site-1"},
      {id:"reversal-1",date:"2026-10-03",kind:"Project expense" as const,description:"Reversal: Materials",amount:250,contractId:"site-1",status:"Reversed" as const,reversalOf:"expense-1"},
    ],
    auditTrail:[{id:"audit-1",actor:"Owner",action:"added" as const,recordType:"transaction",recordId:"expense-1",occurredAt:"2026-10-02T12:00:00.000Z"}],
  };
  const tables=buildBackupTables(data);
  const byName=new Map(tables.map(table=>[table.name,table]));
  assert.ok(byName.get("Workers")?.rows.some(row=>row[1]==="Mantosh Test Worker"));
  assert.ok(byName.get("Sites & contracts")?.rows.some(row=>row[3]==="Workshop"));
  assert.ok(byName.get("Attendance")?.rows.some(row=>row[0]==="2026-10-01"));
  assert.equal(byName.get("Cashbook")?.rows.length,3);
  assert.ok(byName.get("Cashbook")?.rows.some(row=>row[0]==="2026-10-03"&&row[13]==="expense-1"));
  assert.equal(byName.get("Overview")?.rows.find(row=>row[0]==="Receipts, excluding reversed records (₹)")?.[1],1000);
  assert.equal(byName.get("Overview")?.rows.find(row=>row[0]==="Cash outflow, excluding reversed records (₹)")?.[1],250);
  assert.ok(byName.get("Audit history")?.rows.some(row=>row[4]==="expense-1"));
});

test("Excel and PDF report backups generate readable files", async () => {
  const data={...initialData,workers:[{id:"1001",name:"Export check",phone:"9000000000",role:"Labour" as const,status:"Active" as const,wageType:"Daily" as const,monthlyWage:0,dailyWage:500}]};
  const excelBuffer=await createExcelBackupBuffer(data);
  const ExcelJS=(await import("exceljs")).default;
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(excelBuffer);
  assert.equal(workbook.getWorksheet("Workers")?.getCell("B2").value,"Export check");
  assert.ok(workbook.getWorksheet("Cashbook"));
  const pdfBuffer=await createPdfBackupBuffer(data);
  assert.equal(new TextDecoder().decode(pdfBuffer.slice(0,5)),"%PDF-");
  assert.ok(pdfBuffer.byteLength>1000);
});

test("cloud snapshot replaces an unmarked stale browser cache and retains a recovery copy", () => {
  const cloud={...initialData,workers:[{id:"1001",name:"Cloud worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:10000,dailyWage:0}]};
  const local={...initialData,workers:[{id:"1002",name:"Old local worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:9000,dailyWage:0}]};
  const result=resolveInitialWorkspace(local,{revision:"cloud-r2",snapshot:cloud},null);
  assert.equal(result.kind,"cloud-with-recovery");
  assert.deepEqual(result.snapshot,cloud);
  assert.equal(result.preserveLocal,true);
});

test("only pending edits based on the current cloud revision auto-retry", () => {
  const local={...initialData,workers:[{id:"1002",name:"Offline worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:9000,dailyWage:0}]};
  const cloud={...initialData};
  assert.equal(resolveInitialWorkspace(local,{revision:"r1",snapshot:cloud},{baseRevision:"r1"}).kind,"pending");
  assert.equal(resolveInitialWorkspace(local,{revision:"r2",snapshot:cloud},{baseRevision:"r1"}).kind,"conflict");
});

test("remote snapshots apply only when this device has no unsaved edits", () => {
  const synced={...initialData};
  const cloud={...initialData,workers:[{id:"1001",name:"Remote",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:10000,dailyWage:0}]};
  assert.equal(decideRemoteSnapshot(synced,synced,"r1",{revision:"r2",snapshot:cloud}),"apply-cloud");
  assert.equal(decideRemoteSnapshot({...synced,updatedAt:"local-edit"},synced,"r1",{revision:"r2",snapshot:cloud}),"conflict");
  assert.equal(decideRemoteSnapshot(synced,synced,"r2",{revision:"r2",snapshot:cloud}),"unchanged");
});

test("a cloud mutation is successful only after the RPC confirms a saved revision", () => {
  assert.equal(parseWorkspaceWriteResult({status:"saved",revision:"r2"}).status,"saved");
  assert.throws(()=>parseWorkspaceWriteResult({status:"pending"}),/did not confirm/i);
  assert.throws(()=>parseWorkspaceWriteResult({status:"saved"}),/did not confirm/i);
  assert.equal(parseWorkspaceWriteResult({status:"conflict",revision:"r2",snapshot:initialData}).status,"conflict");
});

test("permanent deletion requires Owner role, a short reason, and exact DELETE text", () => {
  assert.equal(canConfirmWorkerDeletion("owner","DELETE","duplicate profile"),true);
  assert.equal(canConfirmWorkerDeletion("viewer","DELETE","duplicate profile"),false);
  assert.equal(canConfirmWorkerDeletion("owner","delete","duplicate profile"),false);
  assert.equal(canConfirmWorkerDeletion("owner","DELETE"," "),false);
});

test("worker deletion/reset mutation lock blocks overlapping autosaves", () => {
  assert.equal(mayStartWorkspaceSync(false), true);
  assert.equal(mayStartWorkspaceSync(true), false);
});

test("client workspace reset requires Owner, reason, and exact phrase", () => {
  assert.equal(canConfirmWorkspaceReset("owner","RESET WORKSPACE","clear test data"), true);
  assert.equal(canConfirmWorkspaceReset("viewer","RESET WORKSPACE","clear test data"), false);
  assert.equal(canConfirmWorkspaceReset("owner","reset workspace","clear test data"), false);
  assert.equal(canConfirmWorkspaceReset("owner","RESET WORKSPACE",""), false);
});

test("linked worker history is preserved but does not block an Owner's confirmed test-profile deletion", () => {
  const data={...initialData,
    workers:[{id:"1001",name:"Test Labour",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Daily" as const,monthlyWage:0,dailyWage:500}],
    attendance:[{id:"att-1",workerId:"1001",date:"2026-10-01",regularHours:8,overtimeHours:0,status:"P" as const,approvedBy:"Owner"}],
  };
  assert.deepEqual(workerDeletionBlockers(data,"1001"),["attendance"]);
  assert.equal(canConfirmWorkerDeletion("owner","DELETE","test profile cleanup"),true);
  assert.equal(canConfirmWorkerDeletion("owner","DELETE",""),false);
});

test("attendance counts regular presence and only complete overtime blocks", () => {
  assert.equal(attendanceUnits({ id:"1",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:7.5,status:"P",approvedBy:"Owner" }), 1);
  assert.equal(attendanceUnits({ id:"2",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:8,status:"P",approvedBy:"Owner" }), 2);
  assert.equal(attendanceUnits({ id:"3",workerId:"1001",date:"2026-10-14",regularHours:0,overtimeHours:0,status:"A",approvedBy:"Owner" }), 0);
});

test("overtime remainder carries between workdays", () => {
  const day1={id:"1",workerId:"1001",date:"2026-10-13",regularHours:8,overtimeHours:5,status:"P" as const,approvedBy:"Owner"};
  const day2={id:"2",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:3,status:"P" as const,approvedBy:"Owner"};
  assert.equal(attendanceUnits(day1),1);
  assert.equal(attendanceUnits(day2,5),2);
  assert.equal(attendanceUnits({...day2,overtimeHours:0.1},7.9),2);
});

test("monthly overtime converts complete 8-hour blocks and carries the remainder", () => {
  const rows=[
    {id:"a",workerId:"1001",date:"2026-09-30",regularHours:8,overtimeHours:5,status:"P" as const,approvedBy:"Owner"},
    {id:"b",workerId:"1001",date:"2026-10-01",regularHours:8,overtimeHours:4,status:"P" as const,approvedBy:"Owner"},
    {id:"c",workerId:"1001",date:"2026-10-02",regularHours:0,overtimeHours:3,status:"A" as const,approvedBy:"Owner"},
  ];
  assert.deepEqual(overtimeMonthSummary(rows,"1001","2026-10"),{hours:7,carryIn:5,units:1,remainder:4});
});

test("attendance edits replace the date record without duplicates and require whole OT hours", () => {
  const original={id:"stable",workerId:"1001",date:"2026-10-01",regularHours:8,overtimeHours:2,status:"P" as const,approvedBy:"Owner"};
  const edited=upsertAttendance([original],"1001","2026-10-01","A",3,"Owner");
  assert.equal(edited.length,1);
  assert.equal(edited[0].id,"stable");
  assert.equal(edited[0].status,"A");
  assert.equal(edited[0].regularHours,0);
  assert.equal(edited[0].overtimeHours,3);
  assert.throws(()=>upsertAttendance(edited,"1001","2026-10-01","P",1.5,"Owner"),/whole overtime hours/i);
});

test("monthly agreed wages remain fixed when a worker is absent", () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0}],attendance:[{id:"a",workerId:"1001",date:"2026-10-14",regularHours:0,overtimeHours:0,status:"A" as const,approvedBy:"Owner"}]};
  assert.equal(payrollSummary(data,"2026-10").fixedMonthly,18000);
  assert.equal(payrollSummary(data,"2026-10").outstanding,18000);
});

test("monthly wage reminders show only the unpaid balance for the current month", () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0}],ledger:[{id:"p1",date:"2026-10-03",kind:"Labour payment" as const,description:"Part payment",amount:5000,workerId:"1001"},{id:"p2",date:"2026-09-30",kind:"Labour payment" as const,description:"Last month",amount:18000,workerId:"1001"}]};
  const due=unpaidMonthlyWages(data,"2026-10");
  assert.equal(due.length,1);
  assert.equal(due[0].remaining,13000);
  assert.equal(unpaidMonthlyWages(data,"2026-11")[0].remaining,18000);
});

test("worker financial summary separates wages, advances and expenses and ignores reversals", () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0}],ledger:[
    {id:"pay",date:"2026-10-03",kind:"Labour payment" as const,description:"Weekly wage",amount:3000,workerId:"1001"},
    {id:"advance",date:"2026-10-04",kind:"Advance" as const,description:"Advance",amount:1000,workerId:"1001"},
    {id:"travel",date:"2026-10-05",kind:"Worker expense" as const,description:"Ticket",amount:450,workerId:"1001"},
    {id:"adjust",date:"2026-10-06",kind:"Wage adjustment" as const,description:"Approved extra",amount:600,workerId:"1001"},
    {id:"void",date:"2026-10-07",kind:"Labour payment" as const,description:"Duplicate reversed",amount:9000,workerId:"1001",status:"Reversed" as const},
  ]};
  assert.deepEqual(workerFinancialSummary(data,"1001","2026-10"),{earned:18000,paid:3000,advances:1000,expenses:450,adjustments:600,balance:14000});
});

test("shared snapshot validation rejects duplicate and cross-worker financial records", () => {
  const worker={id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0};
  const entry={id:"pay",date:"2026-10-03",kind:"Labour payment" as const,description:"Wage payment",amount:3000,workerId:"1001"};
  assert.throws(()=>validateBackup({...initialData,workers:[worker],ledger:[entry,{...entry}]}),/invalid transaction/i);
  assert.throws(()=>validateBackup({...initialData,workers:[worker],ledger:[{...entry,workerId:"9999"}]}),/invalid transaction/i);
});

test("daily payroll carries overtime across days before calculating its equivalent", () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Daily" as const,monthlyWage:0,dailyWage:750}],attendance:[
    {id:"a",workerId:"1001",date:"2026-10-13",regularHours:8,overtimeHours:5,status:"P" as const,approvedBy:"Owner"},
    {id:"b",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:3,status:"P" as const,approvedBy:"Owner"},
  ]};
  assert.equal(payrollSummary(data,"2026-10").dailyEarned,2250);
});

test("backup is validated and round trips all records", async () => {
  const data = { ...initialData, brandLogo:"data:image/jpeg;base64,AA==", monthlyWageReminderDay:5, workers:[{ id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0 }], attendance:[{id:"a1",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:3.5,status:"P" as const,approvedBy:"Owner"}], overtimeCarry:{"1001":3.5} };
  const text = await createBackup(data);
  const restored = await readBackup(text);
  assert.deepEqual(restored.workers, data.workers);
  assert.equal(restored.overtimeCarry["1001"], 3.5);
  assert.equal(restored.brandLogo,data.brandLogo);
  assert.equal(restored.monthlyWageReminderDay,5);
});

test("backup rejects malformed logo data and reminder settings", () => {
  assert.throws(()=>validateBackup({...initialData,brandLogo:"javascript:alert(1)"}),/invalid company logo/i);
  assert.throws(()=>validateBackup({...initialData,monthlyWageReminderDay:31}),/invalid monthly wage reminder day/i);
});

test("backup rejects overtime carry that disagrees with saved attendance", async () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0}],attendance:[{id:"a1",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:3,status:"P" as const,approvedBy:"Owner"}],overtimeCarry:{"1001":2}};
  const text=await createBackup(data);
  await assert.rejects(()=>readBackup(text),/balances do not match attendance/i);
});

test("tampered backup fails before restore", async () => {
  const text = await createBackup(initialData);
  const object = JSON.parse(text); object.data.workers.push({id:"1001",name:"tampered"});
  await assert.rejects(() => readBackup(JSON.stringify(object)), /integrity check failed/i);
});

test("backup rejects duplicate or malformed Labour IDs", async () => {
  const text = await createBackup(initialData);
  const object = JSON.parse(text); object.data.workers = [
    {id:"12",name:"Bad",phone:"",role:"Labour",status:"Active",wageType:"Daily",monthlyWage:0,dailyWage:1},
  ];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(object.data)));
  object.sha256 = Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,"0")).join("");
  await assert.rejects(() => readBackup(JSON.stringify(object)), /invalid or duplicate Labour ID/i);
});

test("worker deletion is blocked when attendance, payroll or overtime records depend on the profile", () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0}],attendance:[{id:"a1",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:2,status:"P" as const,approvedBy:"Owner"}],ledger:[{id:"p1",date:"2026-10-14",kind:"Labour payment" as const,description:"Wage payment",amount:5000,workerId:"1001"}],wageHistory:[{id:"w1",workerId:"1001",previousType:"Monthly" as const,previousAmount:17000,newType:"Monthly" as const,newAmount:18000,reason:"Annual review",approvedBy:"Owner",approvedAt:"2026-10-14T10:00:00Z"}],overtimeCarry:{"1001":2}};
  assert.deepEqual(workerDeletionBlockers(data,"1001"),["attendance","financial entries","approved wage history","overtime balance"]);
});

test("a worker without dependent records can be permanently removed", () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0}]};
  assert.deepEqual(workerDeletionBlockers(data,"1001"),[]);
});

test("backup validation preserves explicit worker deletion audit events", () => {
  const auditTrail=[{id:"event-1",actor:"Owner",action:"deleted" as const,recordType:"worker profile",recordId:"1001 · Example Worker",occurredAt:"2026-10-14T10:00:00Z"}];
  assert.deepEqual(validateBackup({...initialData,auditTrail}).auditTrail,auditTrail);
});
