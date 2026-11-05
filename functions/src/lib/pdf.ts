// Invoice, receipt and audit-export PDFs (pdfkit).
import PDFDocument from "pdfkit";
import type { BillingConfig, Institution, Invoice } from "../../../shared/src/types";
import { formatMoney } from "../../../shared/src/billing";

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    doc.on("data", (d: Buffer) => parts.push(d));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.end();
  });
}
const date = (t: { toDate(): Date } | null | undefined) => (t ? t.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");

export async function invoicePdf(inv: Invoice, institution: Institution, cfg: BillingConfig, kind: "invoice" | "receipt" = "invoice"): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `${kind === "receipt" ? "Receipt" : "Invoice"} ${inv.number}` } });
  const ink = "#12302A", grey = "#4F6660";
  doc.fillColor(ink).fontSize(20).font("Helvetica-Bold").text("DocInsight Health", 50, 50);
  doc.fontSize(9).font("Helvetica").fillColor(grey).text(`${cfg.companyName}\n${cfg.companyRc}\n${cfg.companyAddress}${cfg.supportEmail ? "\n" + cfg.supportEmail : ""}`, 50, 76);
  doc.fontSize(22).font("Helvetica-Bold").fillColor(ink).text(kind === "receipt" ? "RECEIPT" : "INVOICE", 350, 50, { width: 195, align: "right" });
  doc.fontSize(10).font("Helvetica").fillColor(grey).text(`${inv.number}\nIssued ${date(inv.issuedAt)}\n${kind === "receipt" ? `Paid ${date(inv.paidAt)}` : `Due ${date(inv.dueAt)}`}`, 350, 80, { width: 195, align: "right" });
  doc.moveDown(3).fontSize(10).fillColor(grey).text("Bill to", 50, 160).fillColor(ink).font("Helvetica-Bold").text(institution.name).font("Helvetica")
    .text([institution.billingContact?.name, institution.billingContact?.email, institution.billingContact?.phone].filter(Boolean).join("\n"));
  let y = 250;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text("Description", 50, y).text("Qty", 340, y, { width: 40, align: "right" }).text("Unit", 390, y, { width: 70, align: "right" }).text("Amount", 470, y, { width: 75, align: "right" });
  y += 18; doc.moveTo(50, y).lineTo(545, y).strokeColor("#D3DEDA").stroke(); y += 8;
  doc.font("Helvetica");
  for (const l of inv.lines) {
    const h = doc.heightOfString(l.description, { width: 280 });
    doc.fillColor(ink).text(l.description, 50, y, { width: 280 }).text(String(l.quantity), 340, y, { width: 40, align: "right" })
      .text(formatMoney(l.unitAmount, inv.currency), 390, y, { width: 70, align: "right" }).text(formatMoney(l.amount, inv.currency), 470, y, { width: 75, align: "right" });
    y += Math.max(h, 14) + 8;
  }
  y += 4; doc.moveTo(50, y).lineTo(545, y).strokeColor("#D3DEDA").stroke(); y += 10;
  doc.font("Helvetica-Bold").text("Total", 390, y, { width: 70, align: "right" }).text(formatMoney(inv.amount, inv.currency), 470, y, { width: 75, align: "right" });
  y += 40;
  if (kind === "invoice") {
    doc.font("Helvetica-Bold").fontSize(11).text("How to pay", 50, y); y += 18;
    doc.font("Helvetica").fontSize(10).fillColor(ink).text(`Bank transfer to ${cfg.bankTransfer.accountName}\nBank: ${cfg.bankTransfer.bankName}\nAccount number: ${cfg.bankTransfer.accountNumber}\nReference: ${inv.number}\n\n${cfg.bankTransfer.note}${cfg.paystackEnabled ? "\n\nOr pay by card, bank transfer or USSD from the Billing page in DocInsight." : ""}`, 50, y, { width: 495 });
  } else {
    doc.font("Helvetica").fontSize(10).fillColor(ink).text(`Payment received${inv.method === "paystack" ? " via Paystack" : " by bank transfer"}${inv.paystackRef ? ` (ref ${inv.paystackRef})` : ""}. Thank you.`, 50, y);
  }
  doc.fontSize(8).fillColor(grey).text("All amounts in " + inv.currency + ". " + (cfg.vatPct ? `Includes VAT at ${cfg.vatPct}%.` : ""), 50, 780, { width: 495, align: "center" });
  return toBuffer(doc);
}

export async function tablePdf(title: string, subtitle: string, headers: string[], rows: string[][]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: rows[0]?.length > 4 ? "landscape" : "portrait", margin: 40, info: { Title: title } });
  const width = (doc.page.width - 80) / headers.length;
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#12302A").text(title).fontSize(9).font("Helvetica").fillColor("#4F6660").text(subtitle).moveDown();
  const row = (cells: string[], bold = false) => {
    const y = doc.y;
    const h = Math.max(...cells.map((c) => doc.heightOfString(c, { width: width - 6 })), 12);
    if (y + h > doc.page.height - 50) doc.addPage();
    const yy = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor("#12302A");
    cells.forEach((c, i) => doc.text(c, 40 + i * width, yy, { width: width - 6 }));
    doc.y = yy + h + 6;
  };
  doc.fontSize(9); row(headers, true); rows.forEach((r) => row(r));
  return toBuffer(doc);
}
