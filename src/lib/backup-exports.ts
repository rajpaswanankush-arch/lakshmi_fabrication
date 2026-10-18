import type { AppData } from "./model";
import { workerFinancialSummary } from "./model";

export type ExportTable = {
  name: string;
  headers: string[];
  rows: (string | number)[][];
};

const currentMonth = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const number = (value: number | undefined) => value ?? 0;
const activeEntries = (data: AppData) => data.ledger.filter(entry => entry.status !== "Reversed");

export function buildBackupTables(data: AppData): ExportTable[] {
  const month = currentMonth();
  const currentEntries = activeEntries(data);
  const receipts = currentEntries.filter(entry => entry.kind === "Receipt").reduce((sum, entry) => sum + entry.amount, 0);
  const cashOut = currentEntries.filter(entry => entry.kind !== "Receipt").reduce((sum, entry) => sum + entry.amount, 0);
  const tables: ExportTable[] = [
    {
      name: "Overview",
      headers: ["Metric", "Value"],
      rows: [
        ["Business", "Lakshmi Fabrication"],
        ["Backup created", new Date().toISOString()],
        ["Current month", month],
        ["Workers", data.workers.length],
        ["Active workers", data.workers.filter(worker => worker.status === "Active").length],
        ["Companies", data.companies.length],
        ["Sites / contracts", data.contracts.length],
        ["Equipment items", data.equipment.length],
        ["Attendance records", data.attendance.length],
        ["Cashbook records (includes reversals)", data.ledger.length],
        ["Receipts, excluding reversed records (₹)", receipts],
        ["Cash outflow, excluding reversed records (₹)", cashOut],
        ["Contract value (₹)", data.contracts.reduce((sum, contract) => sum + contract.value, 0)],
        ["Contract receipts recorded (₹)", data.contracts.reduce((sum, contract) => sum + contract.received, 0)],
        ["Outstanding contract value (₹)", data.contracts.reduce((sum, contract) => sum + Math.max(0, contract.value - contract.received), 0)],
        ["Report note", "For an exact restore, keep the integrity-checked JSON backup too."],
      ],
    },
    {
      name: "Workers",
      headers: ["Labour ID", "Name", "Phone", "Role", "Status", "Wage method", "Current agreed wage (₹)", "Present records", "Absent records", "OT hours recorded", "Current month earned (₹)", "Wage payments to date (₹)", "Advances to date (₹)", "Worker expenses to date (₹)", "Adjustments to date (₹)"],
      rows: data.workers.map(worker => {
        const attendance = data.attendance.filter(row => row.workerId === worker.id);
        const entries = currentEntries.filter(entry => entry.workerId === worker.id);
        const summary = workerFinancialSummary(data, worker.id, month);
        return [
          worker.id, worker.name, worker.phone, worker.role, worker.status, worker.wageType,
          worker.wageType === "Monthly" ? worker.monthlyWage : worker.wageType === "Daily" ? worker.dailyWage : number(worker.contractWage),
          attendance.filter(row => row.status === "P").length,
          attendance.filter(row => row.status === "A").length,
          attendance.reduce((sum, row) => sum + row.overtimeHours, 0),
          summary.earned,
          entries.filter(entry => entry.kind === "Labour payment").reduce((sum, entry) => sum + entry.amount, 0),
          entries.filter(entry => entry.kind === "Advance").reduce((sum, entry) => sum + entry.amount, 0),
          entries.filter(entry => entry.kind === "Worker expense" || entry.kind === "Project expense").reduce((sum, entry) => sum + entry.amount, 0),
          entries.filter(entry => entry.kind === "Wage adjustment").reduce((sum, entry) => sum + entry.amount, 0),
        ];
      }),
    },
    {
      name: "Attendance",
      headers: ["Date", "Labour ID", "Worker", "Status", "Regular hours", "Overtime hours", "Regular P units", "OT-derived P units", "OT balance after date", "Approved by"],
      rows: data.attendance.slice().sort((a, b) => a.date.localeCompare(b.date) || a.workerId.localeCompare(b.workerId)).map(row => {
        const previousHours = data.attendance.filter(item => item.workerId === row.workerId && item.date < row.date).reduce((sum, item) => sum + item.overtimeHours, 0);
        const carry = Math.round(previousHours * 100) % 800 / 100;
        const totalHours = carry + row.overtimeHours;
        const otUnits = Math.floor(Math.round(totalHours * 100) / 800);
        const worker = data.workers.find(item => item.id === row.workerId);
        return [row.date, row.workerId, worker?.name ?? "Deleted worker", row.status, row.regularHours, row.overtimeHours, row.status === "P" ? row.regularHours / 8 : 0, otUnits, Math.round(totalHours * 100) % 800 / 100, row.approvedBy];
      }),
    },
    {
      name: "Companies",
      headers: ["Company ID", "Company", "Contact person", "Phone", "Notes", "Logo path"],
      rows: data.companies.map(company => [company.id, company.name, company.contactName ?? "", company.phone ?? "", company.notes ?? "", company.logoPath ?? ""]),
    },
    {
      name: "Sites & contracts",
      headers: ["Contract ID", "Company", "Company ID", "Job / scope", "Location", "Status", "Contract value (₹)", "Received (₹)", "Outstanding (₹)", "Equipment count"],
      rows: data.contracts.map(contract => [contract.id, contract.company, contract.companyId ?? "", contract.title, contract.location, contract.status, contract.value, contract.received, Math.max(0, contract.value - contract.received), contract.instruments]),
    },
    {
      name: "Cashbook",
      headers: ["Date", "Created at", "Type", "Description", "Amount (₹)", "Status", "Worker ID", "Worker", "Contract ID", "Company", "Equipment ID", "Payment method", "Reference", "Reversal of", "Approved by", "Recorded by", "Adjustment reason"],
      rows: data.ledger.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "")).map(entry => [
        entry.date, entry.createdAt ?? "", entry.kind, entry.description, entry.amount, entry.status ?? "Recorded", entry.workerId ?? "",
        data.workers.find(worker => worker.id === entry.workerId)?.name ?? "", entry.contractId ?? "",
        data.contracts.find(contract => contract.id === entry.contractId)?.company ?? "", entry.equipmentId ?? "", entry.paymentMethod ?? "", entry.reference ?? "", entry.reversalOf ?? "", entry.approvedBy ?? "", entry.recordedBy ?? "", entry.adjustmentReason ?? "",
      ]),
    },
    {
      name: "Equipment",
      headers: ["Equipment ID", "Name", "Category", "Serial number", "Quantity", "Condition", "Location", "Contract ID", "Notes"],
      rows: data.equipment.map(item => [item.id, item.name, item.category, item.serialNumber, item.quantity, item.condition, item.location, item.contractId ?? "", item.notes]),
    },
    {
      name: "Maintenance",
      headers: ["Date", "Equipment ID", "Equipment", "Description", "Amount (₹)", "Approved by"],
      rows: data.maintenance.map(item => [item.date, item.equipmentId, data.equipment.find(equipment => equipment.id === item.equipmentId)?.name ?? "Deleted equipment", item.description, item.amount, item.approvedBy]),
    },
    {
      name: "Wage history",
      headers: ["Approved at", "Labour ID", "Worker", "Previous method", "Previous wage (₹)", "New method", "New wage (₹)", "Reason", "Approved by"],
      rows: data.wageHistory.map(item => [item.approvedAt, item.workerId, data.workers.find(worker => worker.id === item.workerId)?.name ?? "Deleted worker", item.previousType, item.previousAmount, item.newType, item.newAmount, item.reason, item.approvedBy]),
    },
    {
      name: "Audit history",
      headers: ["When", "Actor", "Action", "Record type", "Record ID", "Reason", "Details"],
      rows: data.auditTrail.map(item => [item.occurredAt, item.actor, item.action, item.recordType, item.recordId, item.reason ?? "", item.details ?? ""]),
    },
  ];
  return tables;
}

export async function createExcelBackupBuffer(data: AppData) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Lakshmi Fabrication";
  workbook.subject = "Workspace backup report";
  workbook.title = "Lakshmi Fabrication backup";
  workbook.created = new Date();
  for (const table of buildBackupTables(data)) {
    const sheet = workbook.addWorksheet(table.name);
    sheet.addRow(table.headers);
    if (table.rows.length) sheet.addRows(table.rows);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.headers.length } };
    sheet.getRow(1).height = 28;
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF692038" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    sheet.columns = table.headers.map((header, index) => {
      const maxLength = Math.max(header.length, ...table.rows.slice(0, 500).map(row => String(row[index] ?? "").length));
      return { width: Math.min(Math.max(maxLength + 2, 12), 42) };
    });
    for (let column = 1; column <= table.headers.length; column++) {
      if (table.headers[column - 1].includes("(₹)")) sheet.getColumn(column).numFmt = '₹#,##0;[Red]-₹#,##0';
    }
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
    });
  }
  return workbook.xlsx.writeBuffer();
}

export async function downloadExcelBackup(data: AppData) {
  const buffer = await createExcelBackupBuffer(data);
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `lakshmi-fabrication-backup-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function createPdfBackupBuffer(data: AppData) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const tables = buildBackupTables(data);
  for (const table of tables) {
    pdf.addPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(105, 32, 56);
    pdf.text("LAKSHMI FABRICATION", 36, 34);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(95, 99, 94);
    pdf.text(`Workspace backup · ${table.name} · ${new Date().toLocaleString("en-IN")}`, 36, 50);
    autoTable(pdf, {
      head: [table.headers],
      body: table.rows.map(row => row.map(value => typeof value === "number" ? value.toLocaleString("en-IN") : String(value))),
      startY: 66,
      margin: { top: 66, right: 30, bottom: 34, left: 30 },
      styles: { font: "helvetica", fontSize: 7, cellPadding: 4, overflow: "linebreak", textColor: [45, 48, 46] },
      headStyles: { fillColor: [105, 32, 56], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [249, 247, 243] },
      didDrawPage: () => {
        pdf.setFontSize(8);
        pdf.setTextColor(130, 130, 130);
        pdf.text("Private workspace export · Keep the JSON backup for full-fidelity restore", 30, pdf.internal.pageSize.height - 16);
      },
    });
  }
  pdf.deletePage(1);
  return pdf.output("arraybuffer");
}

export async function downloadPdfBackup(data: AppData) {
  const buffer = await createPdfBackupBuffer(data);
  downloadBlob(new Blob([buffer], { type: "application/pdf" }), `lakshmi-fabrication-backup-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
