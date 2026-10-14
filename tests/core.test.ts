import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceUnits, initialData, payrollSummary } from "../src/lib/model";
import { createBackup, readBackup } from "../src/lib/backup";

test("attendance counts regular presence and only complete overtime blocks", () => {
  assert.equal(attendanceUnits({ id:"1",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:7.5,status:"P",approvedBy:"Father" }), 1);
  assert.equal(attendanceUnits({ id:"2",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:8,status:"P",approvedBy:"Father" }), 2);
  assert.equal(attendanceUnits({ id:"3",workerId:"1001",date:"2026-10-14",regularHours:0,overtimeHours:0,status:"A",approvedBy:"Father" }), 0);
});

test("overtime remainder carries between workdays", () => {
  const day1={id:"1",workerId:"1001",date:"2026-10-13",regularHours:8,overtimeHours:5,status:"P" as const,approvedBy:"Father"};
  const day2={id:"2",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:3,status:"P" as const,approvedBy:"Father"};
  assert.equal(attendanceUnits(day1),1);
  assert.equal(attendanceUnits(day2,5),2);
});

test("monthly agreed wages remain fixed when a worker is absent", () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0}],attendance:[{id:"a",workerId:"1001",date:"2026-10-14",regularHours:0,overtimeHours:0,status:"A" as const,approvedBy:"Father"}]};
  assert.equal(payrollSummary(data,"2026-10").fixedMonthly,18000);
  assert.equal(payrollSummary(data,"2026-10").outstanding,18000);
});

test("daily payroll carries overtime across days before calculating its equivalent", () => {
  const data={...initialData,workers:[{id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Daily" as const,monthlyWage:0,dailyWage:750}],attendance:[
    {id:"a",workerId:"1001",date:"2026-10-13",regularHours:8,overtimeHours:5,status:"P" as const,approvedBy:"Father"},
    {id:"b",workerId:"1001",date:"2026-10-14",regularHours:8,overtimeHours:3,status:"P" as const,approvedBy:"Father"},
  ]};
  assert.equal(payrollSummary(data,"2026-10").dailyEarned,2250);
});

test("backup is validated and round trips all records", async () => {
  const data = { ...initialData, workers:[{ id:"1001",name:"Example Worker",phone:"",role:"Labour" as const,status:"Active" as const,wageType:"Monthly" as const,monthlyWage:18000,dailyWage:0 }], overtimeCarry:{"1001":3.5} };
  const text = await createBackup(data);
  const restored = await readBackup(text);
  assert.deepEqual(restored.workers, data.workers);
  assert.equal(restored.overtimeCarry["1001"], 3.5);
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
