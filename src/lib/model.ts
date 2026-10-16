export type Worker = { id: string; name: string; phone: string; role: "Labour" | "Mistri"; status: "Active" | "Inactive" | "Archived"; wageType: "Monthly" | "Daily" | "Contract"; monthlyWage: number; dailyWage: number; contractWage?: number; photo?: string };
export type Company = { id: string; name: string; phone?: string; contactName?: string; notes?: string; logoPath?: string };
export type Contract = { id: string; company: string; companyId?: string; title: string; location: string; value: number; received: number; status: "Active" | "Complete"; instruments: number };
export type EquipmentItem = { id: string; name: string; category: string; serialNumber: string; quantity: number; condition: "Good"|"Repair"|"Retired"|"Lost"; location: string; contractId?: string; notes: string };
export type MaintenanceRecord = { id: string; equipmentId: string; date: string; description: string; amount: number; approvedBy: string };
export type Attendance = { id: string; workerId: string; date: string; regularHours: number; overtimeHours: number; status: "P" | "A"; approvedBy: string };
export type Ledger = { id: string; date: string; createdAt?: string; kind: "Receipt" | "Labour payment" | "Advance" | "Project expense" | "Equipment" | "Family transfer" | "Personal" | "Worker expense" | "Allowance" | "Reimbursement" | "Wage adjustment"; description: string; amount: number; contractId?: string; workerId?: string; equipmentId?: string; approvedBy?: string; recordedBy?: string; paymentMethod?: "Cash" | "Bank" | "UPI" | "Cheque" | "Other"; reference?: string; status?: "Recorded" | "Reversed"; reversalOf?: string; adjustmentReason?: string };
export type WageApproval = { id: string; workerId: string; previousType: Worker["wageType"]; previousAmount: number; newType: Worker["wageType"]; newAmount: number; reason: string; approvedBy: string; approvedAt: string };
export type AuditEntry = { id: string; actor: string; action: "added"|"updated"|"restored"|"deleted"; recordType: string; recordId: string; occurredAt: string; reason?: string; details?: string };
export type AppData = { version: 1; brandLogo?: string; monthlyWageReminderDay?: number; workers: Worker[]; companies: Company[]; contracts: Contract[]; equipment: EquipmentItem[]; maintenance: MaintenanceRecord[]; attendance: Attendance[]; ledger: Ledger[]; wageHistory: WageApproval[]; auditTrail: AuditEntry[]; overtimeCarry: Record<string, number>; updatedAt: string };
/** Returns a transaction and every reversal that depends on it, in ledger order. */
export function ledgerDeletionGroup(ledger: Ledger[], entryId: string): Ledger[] {
  const ids = new Set([entryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of ledger) if (entry.reversalOf && ids.has(entry.reversalOf) && !ids.has(entry.id)) {
      ids.add(entry.id);
      changed = true;
    }
  }
  return ledger.filter(entry => ids.has(entry.id));
}
/** Removes a deleted worker link while preserving unrelated and unlinked transactions. */
export function unlinkWorkerLedgerEntries(ledger: Ledger[], workerId: string): Ledger[] {
  return ledger.map(entry => {
    if (entry.workerId !== workerId) return entry;
    const unlinked = { ...entry };
    delete unlinked.workerId;
    return unlinked;
  });
}
export const STORAGE_KEY = "lakshmi-fabrication-v1";
export const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
export const initialData: AppData = { version: 1, monthlyWageReminderDay: 1, updatedAt: new Date().toISOString(), workers: [], companies: [], contracts: [], equipment: [], maintenance: [], attendance: [], ledger: [], wageHistory: [], auditTrail: [], overtimeCarry: {} };
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
  if (!Array.isArray(x.companies)) x.companies=[];
  if (!Array.isArray(x.maintenance)) x.maintenance=[];
  if (!Array.isArray(x.wageHistory)) x.wageHistory = [];
  if (!Array.isArray(x.auditTrail)) x.auditTrail = [];
  const ids = new Set<string>(); for (const w of x.workers) { if (!/^\d{4}$/.test(w.id) || ids.has(w.id)) throw new Error("Backup contains an invalid or duplicate Labour ID. No records were changed."); ids.add(w.id); }
  const workerIds = new Set(x.workers.map(w => w.id)); const contractIds = new Set<string>();
  const companyIds = new Set(x.companies.map(c => c.id));
  if (x.companies.some(c => !c.id || !c.name?.trim() || (c.logoPath !== undefined && (!/^companies\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(c.logoPath))))) throw new Error("Backup contains an invalid company. No records were changed.");
  for (const w of x.workers) if (!w.name?.trim() || !["Labour","Mistri"].includes(w.role) || !["Active","Inactive","Archived"].includes(w.status) || !["Monthly","Daily","Contract"].includes(w.wageType) || [w.monthlyWage,w.dailyWage,w.contractWage??0].some(v=>!Number.isFinite(v)||v<0)) throw new Error("Backup contains an invalid worker or wage agreement. No records were changed.");
  for (const c of x.contracts) { if (!c.id || contractIds.has(c.id) || !c.company?.trim() || !Number.isFinite(c.value) || c.value<0 || !Number.isFinite(c.received) || c.received<0 || (c.companyId && !companyIds.has(c.companyId))) throw new Error("Backup contains an invalid contract. No records were changed."); contractIds.add(c.id); }
  const equipmentIds=new Set<string>();
  for(const e of x.equipment){if(!e.id||equipmentIds.has(e.id)||!e.name?.trim()||!Number.isInteger(e.quantity)||e.quantity<0||!(["Good","Repair","Retired","Lost"].includes(e.condition))||(e.contractId&&!contractIds.has(e.contractId)))throw new Error("Backup contains invalid equipment. No records were changed.");equipmentIds.add(e.id)}
  for(const m of x.maintenance)if(!equipmentIds.has(m.equipmentId)||!m.description?.trim()||!Number.isFinite(m.amount)||m.amount<0||!/^\d{4}-\d{2}-\d{2}$/.test(m.date))throw new Error("Backup contains invalid equipment maintenance. No records were changed.");
  const attendanceKeys = new Set<string>();
  for (const a of x.attendance) { const k=`${a.workerId}:${a.date}`; if(!workerIds.has(a.workerId)||attendanceKeys.has(k)||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!(["P","A"].includes(a.status))||!Number.isFinite(a.regularHours)||a.regularHours<0||a.regularHours>8||!Number.isFinite(a.overtimeHours)||a.overtimeHours<0||(a.status==="A"&&a.regularHours!==0)||(a.status==="P"&&a.regularHours!==8)) throw new Error("Backup contains invalid or duplicate attendance. No records were changed."); attendanceKeys.add(k); }
  for (const [id,hours] of Object.entries(x.overtimeCarry)) if(!workerIds.has(id)||!Number.isFinite(hours)||hours<0||hours>=8) throw new Error("Backup contains an invalid overtime balance. No records were changed.");
  for (const id of workerIds) if (Math.abs((x.overtimeCarry[id]??0)-overtimeRemainder(x.attendance,id))>0.01) throw new Error("Backup overtime balances do not match attendance history. No records were changed.");
  const kinds = ["Receipt","Labour payment","Advance","Project expense","Equipment","Family transfer","Personal","Worker expense","Allowance","Reimbursement","Wage adjustment"];
  const ledgerIds = new Set<string>();
  for (const e of x.ledger) { if (!e.id || ledgerIds.has(e.id) || !Number.isFinite(e.amount) || e.amount <= 0 || !kinds.includes(e.kind) || !e.description?.trim() || (e.workerId&&!workerIds.has(e.workerId)) || (e.contractId&&!contractIds.has(e.contractId)) || (e.equipmentId&&!equipmentIds.has(e.equipmentId)) || (e.status!==undefined&&!(["Recorded","Reversed"].includes(e.status))) || (e.paymentMethod!==undefined&&!(["Cash","Bank","UPI","Cheque","Other"].includes(e.paymentMethod))) || (e.createdAt!==undefined&&!Number.isFinite(Date.parse(e.createdAt))) || (e.reversalOf!==undefined&&!e.reversalOf.trim())) throw new Error("Backup contains an invalid transaction. No records were changed."); ledgerIds.add(e.id); }
  for (const e of x.ledger) if (e.reversalOf && !ledgerIds.has(e.reversalOf)) throw new Error("Backup contains a reversal with no original transaction. No records were changed.");
  for (const h of x.wageHistory) if(!workerIds.has(h.workerId)||!Number.isFinite(h.previousAmount)||!Number.isFinite(h.newAmount)||h.previousAmount<0||h.newAmount<0||!h.reason?.trim()) throw new Error("Backup contains an invalid wage approval history. No records were changed.");
  for (const a of x.auditTrail) if(!a.id||!a.actor||!a.recordType||!a.recordId||!Number.isFinite(Date.parse(a.occurredAt))||!(["added","updated","restored","deleted"].includes(a.action))) throw new Error("Backup contains an invalid audit entry. No records were changed.");
  if (!Number.isFinite(Date.parse(x.updatedAt||""))) throw new Error("Backup timestamp is invalid. No records were changed.");
  // Older snapshots represented companies only by the company name on each contract.
  // Preserve those contracts and create stable company identities for the new UI.
  const seenCompanies = new Set(x.companies.map(c => c.name.trim().toLocaleLowerCase()));
  for (const contract of x.contracts) if (!seenCompanies.has(contract.company.trim().toLocaleLowerCase())) {
    const id = contract.companyId || `legacy-${contract.company.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || contract.id}`;
    x.companies.push({ id, name: contract.company.trim() }); seenCompanies.add(contract.company.trim().toLocaleLowerCase());
  }
  for (const contract of x.contracts) if (!contract.companyId) contract.companyId = x.companies.find(c => c.name.trim().toLocaleLowerCase() === contract.company.trim().toLocaleLowerCase())?.id;
  return x as AppData;
}
export const currency = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
export function attendanceUnits(a: Attendance, carryHours = 0) {
  const regular = a.status === "P" ? Math.min(a.regularHours, 8) / 8 : 0;
  const overtimeBlocks = Math.floor(Math.round((carryHours + a.overtimeHours) * 100) / 800) - Math.floor(Math.round(carryHours * 100) / 800);
  return regular + overtimeBlocks;
}
export function overtimeRemainder(rows: Attendance[], workerId: string) {
  const hours = rows.filter(a => a.workerId === workerId).reduce((sum, a) => sum + a.overtimeHours, 0);
  return Math.round(hours * 100) % 800 / 100;
}
export function overtimeMonthSummary(rows: Attendance[], workerId: string, month: string) {
  const workerRows = rows.filter(a => a.workerId === workerId).sort((a, b) => a.date.localeCompare(b.date));
  const carryInTotal = workerRows.filter(a => a.date.slice(0, 7) < month).reduce((sum, a) => sum + a.overtimeHours, 0);
  const carryIn = Math.round(carryInTotal * 100) % 800 / 100;
  const monthRows = workerRows.filter(a => a.date.slice(0, 7) === month);
  const hours = monthRows.reduce((sum, a) => sum + a.overtimeHours, 0);
  const combined = Math.round((carryIn + hours) * 100);
  return { hours, carryIn, units: Math.floor(combined / 800), remainder: combined % 800 / 100 };
}
export function upsertAttendance(rows: Attendance[], workerId: string, date: string, status: "P" | "A", overtimeHours: number, approvedBy: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(overtimeHours) || overtimeHours < 0 || overtimeHours > 24) throw new Error("Use a valid date and whole overtime hours from 0 to 24.");
  const previous = rows.find(a => a.workerId === workerId && a.date === date);
  const next: Attendance = { id: previous?.id ?? crypto.randomUUID(), workerId, date, regularHours: status === "P" ? 8 : 0, overtimeHours, status, approvedBy };
  return previous ? rows.map(a => a.id === previous.id ? next : a) : [...rows, next];
}
export function payrollSummary(data: AppData, month: string) {
  let fixedMonthly = 0, dailyEarned = 0, contractAgreed = 0;
  for (const worker of data.workers.filter(w => w.status !== "Archived")) {
    if (worker.wageType === "Monthly") fixedMonthly += worker.monthlyWage;
    if (worker.wageType === "Contract") contractAgreed += worker.contractWage || 0;
    if (worker.wageType !== "Daily") continue;
    const earlier = data.attendance.filter(a => a.workerId === worker.id && a.date.slice(0,7) < month).reduce((s,a)=>s+a.overtimeHours,0);
    let carry = Math.round(earlier * 100) % 800 / 100;
    for (const row of data.attendance.filter(a => a.workerId === worker.id && a.date.slice(0,7) === month).sort((a,b)=>a.date.localeCompare(b.date))) {
      dailyEarned += attendanceUnits(row, carry) * worker.dailyWage;
      carry = Math.round((carry + row.overtimeHours) * 100) % 800 / 100;
    }
  }
  const contractIds = new Set(data.workers.filter(w=>w.status!=="Archived"&&w.wageType==="Contract").map(w=>w.id));
  const paid = data.ledger.filter(l => l.status!=="Reversed" && l.date.slice(0,7)===month && l.workerId && !contractIds.has(l.workerId) && (l.kind === "Labour payment" || l.kind === "Advance")).reduce((s,l)=>s+l.amount,0);
  const contractPaid = data.ledger.filter(l=>l.status!=="Reversed"&&l.workerId&&contractIds.has(l.workerId)&&(l.kind==="Labour payment"||l.kind==="Advance")).reduce((s,l)=>s+l.amount,0);
  const earned = fixedMonthly + dailyEarned;
  return { fixedMonthly, dailyEarned, contractAgreed, paid, earned, outstanding: Math.max(0,earned-paid)+Math.max(0,contractAgreed-contractPaid) };
}
export function unpaidMonthlyWages(data: AppData, month: string) {
  return data.workers.filter(w => w.wageType === "Monthly" && w.monthlyWage > 0).map(worker => {
    const paid = data.ledger.filter(entry => entry.status!=="Reversed" && entry.kind === "Labour payment" && entry.workerId === worker.id && entry.date.startsWith(month)).reduce((sum, entry) => sum + entry.amount, 0);
    return { worker, paid, remaining: Math.max(0, worker.monthlyWage - paid) };
  }).filter(item => item.remaining > 0);
}

export function workerFinancialSummary(data: AppData, workerId: string, month: string) {
  const worker = data.workers.find(w => w.id === workerId);
  if (!worker) return { earned: 0, paid: 0, advances: 0, expenses: 0, adjustments: 0, balance: 0 };
  const rows = data.attendance.filter(a => a.workerId === workerId && a.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date));
  let earned = worker.wageType === "Monthly" ? worker.monthlyWage : worker.wageType === "Contract" ? (worker.contractWage || 0) : 0;
  if (worker.wageType === "Daily") {
    const prior = data.attendance.filter(a => a.workerId === workerId && a.date.slice(0, 7) < month).reduce((sum, a) => sum + a.overtimeHours, 0);
    let carry = Math.round(prior * 100) % 800 / 100;
    for (const row of rows) { earned += attendanceUnits(row, carry) * worker.dailyWage; carry = Math.round((carry + row.overtimeHours) * 100) % 800 / 100; }
  }
  const entries = data.ledger.filter(l => l.workerId === workerId && l.date.slice(0, 7) === month && l.status !== "Reversed");
  const paid = entries.filter(l => l.kind === "Labour payment").reduce((sum, l) => sum + l.amount, 0);
  const advances = entries.filter(l => l.kind === "Advance").reduce((sum, l) => sum + l.amount, 0);
  const expenses = entries.filter(l => ["Worker expense", "Project expense", "Allowance", "Reimbursement"].includes(l.kind)).reduce((sum, l) => sum + l.amount, 0);
  const adjustments = entries.filter(l => l.kind === "Wage adjustment").reduce((sum, l) => sum + l.amount, 0);
  return { earned, paid, advances, expenses, adjustments, balance: Math.max(0, earned - paid - advances) };
}

export function workerDeletionBlockers(data: AppData, workerId: string) {
  return [
    data.attendance.some(row => row.workerId === workerId) ? "attendance" : null,
    data.ledger.some(row => row.workerId === workerId) ? "financial entries" : null,
    data.wageHistory.some(row => row.workerId === workerId) ? "approved wage history" : null,
    Number(data.overtimeCarry[workerId] || 0) > 0 ? "overtime balance" : null,
  ].filter((item): item is string => item !== null);
}

