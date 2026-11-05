// Email through Resend. Without RESEND_API_KEY, emails are logged and skipped:
// invites still work through links, codes and QR codes.
import { logger } from "firebase-functions";
import { EMAIL_FROM, RESEND_API_KEY, APP_URL, secretValue } from "./params";

export interface Email {
  to: string | string[];
  subject: string;
  /** Plain paragraphs; the first link becomes the button */
  lines: string[];
  button?: { label: string; url: string };
  attachments?: { filename: string; content: string /* base64 */ }[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderEmail(e: Email): string {
  const body = e.lines.map((l) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#12302A">${esc(l)}</p>`).join("");
  const btn = e.button ? `<p style="margin:22px 0"><a href="${esc(e.button.url)}" style="background:#12302A;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">${esc(e.button.label)}</a></p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#F3F6F5;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;padding:28px 20px"><p style="font-weight:700;font-size:18px;color:#12302A;margin:0 0 20px">DocInsight Health</p><div style="background:#fff;border:1px solid #D3DEDA;border-radius:12px;padding:22px">${body}${btn}</div><p style="font-size:12px;color:#4F6660;margin-top:18px">You're receiving this because you're a member of a hospital on DocInsight Health. <a href="${esc(APP_URL.value())}/app/settings" style="color:#4F6660">Email settings</a></p></div></body></html>`;
}

export async function sendEmail(e: Email): Promise<boolean> {
  const key = secretValue(RESEND_API_KEY);
  const to = (Array.isArray(e.to) ? e.to : [e.to]).filter((x) => /@/.test(x));
  if (!to.length) return false;
  if (!key) {
    logger.info("email skipped (RESEND_API_KEY not set)", { to: to.length, subject: e.subject });
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM.value(), to, subject: e.subject, html: renderEmail(e), text: [...e.lines, e.button ? `${e.button.label}: ${e.button.url}` : ""].join("\n\n"), attachments: e.attachments }),
  });
  if (!res.ok) logger.warn("email failed", { status: res.status, body: (await res.text()).slice(0, 300) });
  return res.ok;
}
