"use client";

import { useMemo, useState } from "react";
import { AppData, Ledger, Worker, currency, workerFinancialSummary } from "@/lib/model";

const words = {
  en: { title: "Payments and expenses", wage: "Wages earned this month", paid: "Wage payments", advances: "Advances", expenses: "Worker expenses", adjustments: "Wage adjustments", balance: "Wage balance", add: "Record payment or expense", type: "Type", amount: "Amount (₹)", date: "Date", note: "Description", method: "Payment method", reference: "Reference", recorder: "Recorded by", save: "Save transaction", saving: "Saving…", saved: "Saved to shared records", local: "Saved on this device only", error: "Not saved", all: "All types", status: "Status", statuses: "All statuses", recorded: "Recorded", reversed: "Reversed", timeMissing: "Time not recorded", empty: "No worker transactions yet.", reverse: "Reverse", reverseReason: "Reason for correction or reversal", reverseAsk: "Reverse this transaction? The original will stay in history.", expenseHint: "New entries sync to Accounts and this worker's history.", kind: { "Labour payment": "Wage payment", Advance: "Advance", "Worker expense": "Worker expense", Allowance: "Allowance", Reimbursement: "Reimbursement", "Wage adjustment": "Wage adjustment" } },
  hi: { title: "भुगतान और खर्च", wage: "इस माह अर्जित मज़दूरी", paid: "मज़दूरी भुगतान", advances: "अग्रिम", expenses: "कर्मचारी खर्च", adjustments: "मज़दूरी समायोजन", balance: "मज़दूरी बकाया", add: "भुगतान या खर्च दर्ज करें", type: "प्रकार", amount: "राशि (₹)", date: "तारीख़", note: "विवरण", method: "भुगतान का तरीका", reference: "संदर्भ", recorder: "दर्ज किया", save: "लेन-देन सहेजें", saving: "सहेज रहे हैं…", saved: "साझा रिकॉर्ड में सहेजा गया", local: "केवल इस डिवाइस पर सहेजा गया", error: "सहेजा नहीं गया", all: "सभी प्रकार", status: "स्थिति", statuses: "सभी स्थितियाँ", recorded: "दर्ज", reversed: "वापस किया", timeMissing: "समय दर्ज नहीं", empty: "अभी कोई कर्मचारी लेन-देन नहीं है।", reverse: "वापस करें", reverseReason: "सुधार या वापसी का कारण", reverseAsk: "क्या इस लेन-देन को वापस करें? मूल रिकॉर्ड इतिहास में रहेगा।", expenseHint: "नए रिकॉर्ड लेखे और इस कर्मचारी के इतिहास में सिंक होंगे।", kind: { "Labour payment": "मज़दूरी भुगतान", Advance: "अग्रिम", "Worker expense": "कर्मचारी खर्च", Allowance: "भत्ता", Reimbursement: "खर्च वापसी", "Wage adjustment": "मज़दूरी समायोजन" } },
};

const types = ["Labour payment", "Advance", "Worker expense", "Allowance", "Reimbursement", "Wage adjustment"] as const satisfies readonly Ledger["kind"][];

export function WorkerTransactions({ worker, data, lang, recorder, saveState, onSave, onReverse, onDelete, isOwner }: {
  worker: Worker;
  data: AppData;
  lang: "en" | "hi";
  recorder: string;
  saveState: "saving" | "saved" | "error" | "local";
  onSave: (entry: Ledger) => void;
  onReverse: (entry: Ledger, reason: string) => void;
  onDelete: (entry: Ledger) => void;
  isOwner: boolean;
}) {
  const t = words[lang];
  const kindLabel = (value: Ledger["kind"]) => (t.kind as Partial<Record<Ledger["kind"], string>>)[value] || value;
  const [kind, setKind] = useState<(typeof types)[number]>("Labour payment");
  const [typeFilter, setTypeFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<Record<string, string>>({});
  const summary = workerFinancialSummary(data, worker.id, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7));
  const rows = useMemo(() => data.ledger.filter(x => x.workerId === worker.id)
    .filter(x => !typeFilter || x.kind === typeFilter)
    .filter(x => !monthFilter || x.date.startsWith(monthFilter))
    .filter(x => !statusFilter || (x.status || "Recorded") === statusFilter)
    .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date)),
  [data.ledger, worker.id, typeFilter, monthFilter, statusFilter]);

  function submit(form: FormData) {
    if (busy) return;
    const amount = Number(form.get("amount"));
    const description = String(form.get("description") || "").trim();
    if (!Number.isFinite(amount) || amount <= 0 || !description) return;
    setBusy(true);
    onSave({
      id: crypto.randomUUID(), date: String(form.get("date") || ""), createdAt: new Date().toISOString(),
      workerId: worker.id, kind, amount, description,
      paymentMethod: (String(form.get("paymentMethod") || "") || undefined) as Ledger["paymentMethod"],
      reference: String(form.get("reference") || "").trim() || undefined,
      adjustmentReason: kind === "Wage adjustment" ? String(form.get("reason") || "").trim() : undefined,
      recordedBy: recorder, approvedBy: kind === "Labour payment" || kind === "Advance" ? recorder : undefined,
    });
    window.setTimeout(() => setBusy(false), 1000);
  }

  return <section className="worker-transactions">
    <div className="profile-transaction-heading"><h3>{t.title}</h3><span className={`transaction-save-state ${saveState}`} role="status">{saveState === "saving" ? t.saving : saveState === "saved" ? t.saved : saveState === "error" ? t.error : t.local}</span></div>
    <div className="worker-money-summary">
      {([[t.wage, summary.earned], [t.paid, summary.paid], [t.advances, summary.advances], [t.expenses, summary.expenses], [t.adjustments, summary.adjustments], [t.balance, summary.balance]] as const).map(([label, amount]) => <div key={label}><small>{label}</small><b>{currency(amount)}</b></div>)}
    </div>
    <p>{t.expenseHint}</p>
    <form className="worker-transaction-form" action={submit}>
      <label>{t.type}<select value={kind} onChange={e => setKind(e.target.value as (typeof types)[number])}>{types.map(x => <option key={x} value={x}>{t.kind[x]}</option>)}</select></label>
      <label>{t.amount}<input name="amount" type="number" min="1" step="1" required /></label>
      <label>{t.date}<input name="date" type="date" defaultValue={new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })} required /></label>
      <label className="transaction-note">{t.note}<input name="description" maxLength={240} required /></label>
      <label>{t.method}<select name="paymentMethod"><option value="">—</option><option>Cash</option><option>Bank</option><option>UPI</option><option>Cheque</option><option>Other</option></select></label>
      <label>{t.reference}<input name="reference" maxLength={80} /></label>
      {kind === "Wage adjustment" && <label>{t.reverseReason}<input name="reason" required /></label>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? t.saving : t.save}</button>
    </form>
    <div className="profile-txn-filters">
      <label>{t.type}<select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">{t.all}</option>{types.map(x => <option key={x} value={x}>{t.kind[x]}</option>)}</select></label>
      <label>{t.date}<input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} /></label>
      <label>{t.status}<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">{t.statuses}</option><option value="Recorded">{t.recorded}</option><option value="Reversed">{t.reversed}</option></select></label>
    </div>
    <div className="profile-transaction-list">{rows.length ? rows.map(entry => <article key={entry.id} className={entry.status === "Reversed" ? "reversed" : ""}>
      <div><b>{kindLabel(entry.kind)}</b>
        <small>{entry.createdAt ? new Intl.DateTimeFormat(lang === "en" ? "en-IN" : "hi-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt)) + " IST" : new Intl.DateTimeFormat(lang === "en" ? "en-IN" : "hi-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }).format(new Date(entry.date + "T12:00:00")) + " · " + t.timeMissing}</small>
        <small>{t.note}: {entry.description}{entry.reference ? " · " + t.reference + ": " + entry.reference : ""}</small>
        <small>{t.method}: {entry.paymentMethod || "—"} · {t.recorder}: {entry.recordedBy || entry.approvedBy || "—"}{entry.adjustmentReason ? " · " + entry.adjustmentReason : ""}</small></div>
      <strong>{currency(entry.amount)}</strong>
      {entry.status !== "Reversed" && entry.kind !== "Wage adjustment" && <div className="transaction-reversal"><input aria-label={t.reverseReason} placeholder={t.reverseReason} value={reason[entry.id] || ""} onChange={e => setReason(v => ({ ...v, [entry.id]: e.target.value }))} /><button type="button" className="button button-quiet" disabled={!reason[entry.id]?.trim()} onClick={() => { if (reason[entry.id]?.trim() && window.confirm(t.reverseAsk)) { onReverse(entry, reason[entry.id].trim()); setReason(v => ({ ...v, [entry.id]: "" })); } }}>{t.reverse}</button></div>}
      {isOwner && <div className="transaction-reversal"><button type="button" className="button button-danger" onClick={() => onDelete(entry)}>Delete record</button></div>}
    </article>) : <p className="empty-state">{t.empty}</p>}</div>
  </section>;
}
