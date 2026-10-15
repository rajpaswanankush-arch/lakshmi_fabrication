export type Worker = { id: string; name: string; phone: string; role: "Labour" | "Mistri"; status: "Active" | "Inactive" | "Archived"; wageType: "Monthly" | "Daily" | "Contract"; monthlyWage: number; dailyWage: number; contractWage?: number; photo?: string };
export type Contract = { id: string; company: string; title: string; location: string; value: number; received: number; status: "Active" | "Complete"; instruments: number };
export type EquipmentItem = { id: string; name: string; category: string; serialNumber: string; quantity: number; condition: "Good"|"Repair"|"Retired"|"Lost"; location: string; contractId?: string; notes: string };
export type MaintenanceRecord = { id: string; equipmentId: string; date: string; description: string; amount: number; approvedBy: string };
export type Attendance = { id: string; workerId: string; date: string; regularHours: number; overtimeHours: number; status: "P" | "A"; approvedBy: string };
export type Ledger = { id: string; date: string; kind: "Receipt" | "Labour payment" | "Advance" | "Project expense" | "Equipment" | "Family transfer" | "Personal"; description: string; amount: number; contractId?: string; workerId?: string; equipmentId?: string; approvedBy?: string };
export type WageApproval = { id: string; workerId: string; previousType: Worker["wageType"]; previousAmount: number; newType: Worker["wageType"]; newAmount: number; reason: string; approvedBy: string; approvedAt: string };
export type AuditEntry = { id: string; actor: string; action: "added"|"updated"|"restored"|"deleted"; recordType: string; recordId: string; occurredAt: string };
export type AppData = { version: 1; brandLogo?: string; monthlyWageReminderDay?: number; workers: Worker[]; contracts: Contract[]; equipment: EquipmentItem[]; maintenance: MaintenanceRecord[]; attendance: Attendance[]; ledger: Ledger[]; wageHistory: WageApproval[]; auditTrail: AuditEntry[]; overtimeCarry: Record<string, number>; updatedAt: string };
export const STORAGE_KEY = "lakshmi-fabrication-v1";
export const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
export const initialData: AppData = { version: 1, monthlyWageReminderDay: 1, updatedAt: new Date().toISOString(), workers: [], contracts: [], equipment: [], maintenance: [], attendance: [], ledger: [], wageHistory: [], auditTrail: [], overtimeCarry: {} };
export function loadData(): AppData {
  if (typeof window === "undefined") return initialData;
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return validateBackup(JSON.parse(raw)); } catch { /* use the starter workspace until a valid local copy is available */ }
  return initialData;
}
export function saveData(data: AppData) { const next = { ...data, updatedAt: new Date().toISOString() }; localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); return next; }
export function validateBackup(input: unknown): AppData {
  if (!input || typeof input !== "object") throw new Error("This file is not a Lakshmi Fabrication backup.");
  const x = input as Partial<AppData>;
  if (x.version !== 1 || !Array.isArray(x.workers) || !Array.isArray(x.contracts) || !Array.isArray(x.attendance) || !Array.isArray(x.ledger) || !x.overtimeCarry || typeof x.overtimeCarry !== "object") throw new Error("Backup validation failed. No records were changed.");
  if (x.brandLogo !== undefined && (typeof x.brandLogo !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(x.brandLogo) || x.brandLogo.length > 30000)) throw new Error("Backup contains an invalid company logo. No records were changed.");
  if (x.monthlyWageReminderDay !== undefined && (!Number.isInteger(x.monthlyWageReminderDay) || x.monthlyWageReminderDay < 1 || x.monthlyWageReminderDay > 28)) throw new Error("Backup contains an invalid monthly wage reminder day. No records were changed.");
  if (!Array.isArray(x.equipment)) x.equipment=[];
  if (!Array.isArray(x.maintenance)) x.maintenance=[];
  if (!Array.isArray(x.wageHistory)) x.wageHistory = [];
  if (!Array.isArray(x.auditTrail)) x.auditTrail = [];
  const ids = new Set<string>(); for (const w of x.workers) { if (!/^\d{4}$/.test(w.id) || ids.has(w.id)) throw new Error("Backup contains an invalid or duplicate Labour ID. No records were changed."); ids.add(w.id); }
  const workerIds = new Set(x.workers.map(w => w.id)); const contractIds = new Set<string>();
  for (const w of x.workers) if (!w.name?.trim() || !["Labour","Mistri"].includes(w.role) || !["Active","Inactive","Archived"].includes(w.status) || !["Monthly","Daily","Contract"].includes(w.wageType) || [w.monthlyWage,w.dailyWage,w.contractWage??0].some(v=>!Number.isFinite(v)||v<0)) throw new Error("Backup contains an invalid worker or wage agreement. No records were changed.");
  for (const c of x.contracts) { if (!c.id || contractIds.has(c.id) || !c.company?.trim() || !Number.isFinite(c.value) || c.value<0 || !Number.isFinite(c.received) || c.received<0) throw new Error("Backup contains an invalid contract. No records were changed."); contractIds.add(c.id); }
  const equipmentIds=new Set<string>();
  for(const e of x.equipment){if(!e.id||equipmentIds.has(e.id)||!e.name?.trim()||!Number.isInteger(e.quantity)||e.quantity<0||!(["Good","Repair","Retired","Lost"].includes(e.condition))||(e.contractId&&!contractIds.has(e.contractId)))throw new Error("Backup contains invalid equipment. No records were changed.");equipmentIds.add(e.id)}
  for(const m of x.maintenance)if(!equipmentIds.has(m.equipmentId)||!m.description?.trim()||!Number.isFinite(m.amount)||m.amount<0||!/^\d{4}-\d{2}-\d{2}$/.test(m.date))throw new Error("Backup contains invalid equipment maintenance. No records were changed.");
  const attendanceKeys = new Set<string>();
  for (const a of x.attendance) { const k=`${a.workerId}:${a.date}`; if(!workerIds.has(a.workerId)||attendanceKeys.has(k)||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!(["P","A"].includes(a.status))||!Number.isFinite(a.regularHours)||a.regularHours<0||a.regularHours>8||!Number.isFinite(a.overtimeHours)||a.overtimeHours<0||(a.status==="A"&&a.regularHours!==0)||(a.status==="P"&&a.regularHours!==8)) throw new Error("Backup contains invalid or duplicate attendance. No records were changed."); attendanceKeys.add(k); }
  for (const [id,hours] of Object.entries(x.overtimeCarry)) if(!workerIds.has(id)||!Number.isFinite(hours)||hours<0||hours>=8) throw new Error("Backup contains an invalid overtime balance. No records were changed.");
  for (const id of workerIds) if (Math.abs((x.overtimeCarry[id]??0)-overtimeRemainder(x.attendance,id))>0.01) throw new Error("Backup overtime balances do not match attendance history. No records were changed.");
  const kinds = ["Receipt","Labour payment","Advance","Project expense","Equipment","Family transfer","Personal"];
  for (const e of x.ledger) if (!Number.isFinite(e.amount) || e.amount <= 0 || !kinds.includes(e.kind) || !e.description?.trim() || (e.workerId&&!workerIds.has(e.workerId)) || (e.contractId&&!contractIds.has(e.contractId)) || (e.equipmentId&&!equipmentIds.has(e.equipmentId))) throw new Error("Backup contains an invalid transaction. No records were changed.");
  for (const h of x.wageHistory) if(!workerIds.has(h.workerId)||!Number.isFinite(h.previousAmount)||!Number.isFinite(h.newAmount)||h.previousAmount<0||h.newAmount<0||!h.reason?.trim()) throw new Error("Backup contains an invalid wage approval history. No records were changed.");
  for (const a of x.auditTrail) if(!a.id||!a.actor||!a.recordType||!a.recordId||!Number.isFinite(Date.parse(a.occurredAt))||!(["added","updated","restored","deleted"].includes(a.action))) throw new Error("Backup contains an invalid audit entry. No records were changed.");
  if (!Number.isFinite(Date.parse(x.updatedAt||""))) throw new Error("Backup timestamp is invalid. No records were changed.");
  return x as AppData;
}
export const currency = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
export function attendanceUnits(a: Attendance, carryHours = 0) {
  const regular = a.status === "P" ? Math.min(a.regularHours, 8) / 8 : 0;
  const overtimeBlocks = Math.floor((carryHours + a.overtimeHours) / 8) - Math.floor(carryHours / 8);
  return regular + overtimeBlocks;
}
export function overtimeRemainder(rows: Attendance[], workerId: string) {
  const hours = rows.filter(a => a.workerId === workerId).reduce((sum, a) => sum + a.overtimeHours, 0);
  return Math.round((hours % 8) * 100) / 100;
}
export function payrollSummary(data: AppData, month: string) {
  let fixedMonthly = 0, dailyEarned = 0, contractAgreed = 0;
  for (const worker of data.workers.filter(w => w.status !== "Archived")) {
    if (worker.wageType === "Monthly") fixedMonthly += worker.monthlyWage;
    if (worker.wageType === "Contract") contractAgreed += worker.contractWage || 0;
    if (worker.wageType !== "Daily") continue;
    const earlier = data.attendance.filter(a => a.workerId === worker.id && a.date.slice(0,7) < month).reduce((s,a)=>s+a.overtimeHours,0);
    let carry = earlier % 8;
    for (const row of data.attendance.filter(a => a.workerId === worker.id && a.date.slice(0,7) === month).sort((a,b)=>a.date.localeCompare(b.date))) {
      dailyEarned += attendanceUnits(row, carry) * worker.dailyWage;
      carry = (carry + row.overtimeHours) % 8;
    }
  }
  const contractIds = new Set(data.workers.filter(w=>w.status!=="Archived"&&w.wageType==="Contract").map(w=>w.id));
  const paid = data.ledger.filter(l => l.date.slice(0,7)===month && l.workerId && !contractIds.has(l.workerId) && (l.kind === "Labour payment" || l.kind === "Advance")).reduce((s,l)=>s+l.amount,0);
  const contractPaid = data.ledger.filter(l=>l.workerId&&contractIds.has(l.workerId)&&(l.kind==="Labour payment"||l.kind==="Advance")).reduce((s,l)=>s+l.amount,0);
  const earned = fixedMonthly + dailyEarned;
  return { fixedMonthly, dailyEarned, contractAgreed, paid, earned, outstanding: Math.max(0,earned-paid)+Math.max(0,contractAgreed-contractPaid) };
}
export function unpaidMonthlyWages(data: AppData, month: string) {
  return data.workers.filter(w => w.wageType === "Monthly" && w.monthlyWage > 0).map(worker => {
    const paid = data.ledger.filter(entry => entry.kind === "Labour payment" && entry.workerId === worker.id && entry.date.startsWith(month)).reduce((sum, entry) => sum + entry.amount, 0);
    return { worker, paid, remaining: Math.max(0, worker.monthlyWage - paid) };
  }).filter(item => item.remaining > 0);
}

export function workerDeletionBlockers(data: AppData, workerId: string) {
  return [
    data.attendance.some(row => row.workerId === workerId) ? "attendance" : null,
    data.ledger.some(row => row.workerId === workerId) ? "financial entries" : null,
    data.wageHistory.some(row => row.workerId === workerId) ? "approved wage history" : null,
    Object.hasOwn(data.overtimeCarry, workerId) ? "overtime balance" : null,
  ].filter((item): item is string => item !== null);
}
