// F11 admin analytics, F14 audit log export, F8 acknowledgement export.
import type { AuditEntry, ContentItem, Member, QuestionRecord, Space } from "../../../shared/src/types";
import { normalizeQuestion } from "../../../shared/src/text";
import { bucket, db, Timestamp } from "../lib/admin";
import { requireMember } from "../lib/access";
import { audit } from "../lib/audit";
import { fail, id, oneOf } from "../lib/errors";
import { callable } from "../lib/fn";
import { tablePdf } from "../lib/pdf";
import { usage } from "../lib/plans";

const DAY = 86_400_000;
const top = <T>(m: Map<string, T & { count: number }>, n = 10) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);

export const getAnalytics = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { allowPlatform: true });
  // Owners and admins see everything; editors and approvers see their own spaces
  const own = new Set([...ctx.member.editSpaceIds, ...ctx.member.approveSpaceIds]);
  if (!ctx.isManager && !own.size) throw fail.denied();
  const days = Math.max(7, Math.min(90, Number(req.data.days) || 30));
  const since = Timestamp.fromMillis(Date.now() - days * DAY);
  const [spacesSnap, membersSnap, contentSnap, eventsSnap, questionsSnap, reportsSnap] = await Promise.all([
    db.collection(`institutions/${ctx.instId}/spaces`).where("archived", "==", false).get(),
    db.collection(`institutions/${ctx.instId}/members`).where("status", "==", "active").get(),
    db.collection(`institutions/${ctx.instId}/content`).where("status", "!=", "archived").get(),
    db.collection(`institutions/${ctx.instId}/events`).where("at", ">=", since).orderBy("at", "desc").limit(20_000).get(),
    db.collection(`institutions/${ctx.instId}/questions`).where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(5_000).get(),
    db.collection(`institutions/${ctx.instId}/reports`).orderBy("createdAt", "desc").limit(50).get(),
  ]);
  const spaces = spacesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Space).filter((s) => ctx.isManager || own.has(s.id));
  const spaceIds = new Set(spaces.map((s) => s.id));
  const members = membersSnap.docs.map((d) => ({ ...d.data(), userId: d.id }) as Member);
  const content = contentSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentItem).filter((c) => spaceIds.has(c.spaceId));
  const byId = new Map(content.map((c) => [c.id, c]));

  // Active users from activity timestamps
  const now = Date.now();
  const activeIn = (n: number) => members.filter((m) => m.lastActiveAt && (m.lastActiveAt as Timestamp).toMillis() >= now - n * DAY).length;
  const active = { daily: activeIn(1), weekly: activeIn(7), monthly: activeIn(30), members: members.length };

  const searches = new Map<string, { query: string; count: number }>();
  const views = new Map<string, { contentId: string; title: string; count: number }>();
  for (const d of eventsSnap.docs) {
    const e = d.data();
    if (e.type === "search" && e.query) {
      const k = normalizeQuestion(e.query);
      const cur = searches.get(k) ?? { query: e.query, count: 0 }; cur.count++; searches.set(k, cur);
    } else if (e.type === "view" && e.contentId && byId.has(e.contentId)) {
      const cur = views.get(e.contentId) ?? { contentId: e.contentId, title: byId.get(e.contentId)!.title, count: 0 }; cur.count++; views.set(e.contentId, cur);
    }
  }

  // Questions are shown in aggregate: texts without names; repeated questions grouped
  const qs = questionsSnap.docs.map((d) => d.data() as QuestionRecord).filter((q) => q.question && q.status !== "blocked");
  const topQ = new Map<string, { question: string; count: number; status: string }>();
  const gaps = new Map<string, { topic: string; count: number; examples: string[] }>();
  for (const q of qs) {
    const k = normalizeQuestion(q.question);
    const cur = topQ.get(k) ?? { question: q.question, count: 0, status: q.status }; cur.count++; topQ.set(k, cur);
    if (q.status === "not_found") {
      const t = (q.topic || "Other").toLowerCase();
      const g = gaps.get(t) ?? { topic: q.topic || "Other", count: 0, examples: [] };
      g.count++;
      if (g.examples.length < 5 && !g.examples.some((e) => normalizeQuestion(e) === k)) g.examples.push(q.question);
      gaps.set(t, g);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(now + 30 * DAY).toISOString().slice(0, 10);
  const published = content.filter((c) => c.published);
  const health = {
    overdue: published.filter((c) => c.reviewDate && c.reviewDate < today).map((c) => ({ contentId: c.id, title: c.title, reviewDate: c.reviewDate, ownerName: c.ownerName, spaceId: c.spaceId })),
    dueSoon: published.filter((c) => c.reviewDate && c.reviewDate >= today && c.reviewDate <= in30).map((c) => ({ contentId: c.id, title: c.title, reviewDate: c.reviewDate, ownerName: c.ownerName, spaceId: c.spaceId })),
    awaitingApproval: content.filter((c) => c.status === "in_review").map((c) => ({ contentId: c.id, title: c.title, spaceId: c.spaceId, ownerName: c.ownerName })),
    emptySpaces: spaces.filter((s) => !published.some((c) => c.spaceId === s.id)).map((s) => ({ spaceId: s.id, name: s.name })),
    noReviewDate: published.filter((c) => !c.reviewDate).length,
  };
  const mustRead = await Promise.all(published.filter((c) => c.mustRead && c.mustReadVersionId).map(async (c) => {
    const acks = (await db.collection(`institutions/${ctx.instId}/acknowledgements`).where("contentId", "==", c.id).where("versionId", "==", c.mustReadVersionId).count().get()).data().count;
    const eligible = members.filter((m) => m.visibleSpaceIds.includes(c.spaceId) && m.access !== "none").length;
    return { contentId: c.id, title: c.title, acknowledged: acks, eligible, rate: eligible ? acks / eligible : 0 };
  }));
  const u = await usage(ctx.instId);
  return {
    days, active, spaces: spaces.map((s) => ({ id: s.id, name: s.name })),
    topSearches: top(searches), topDocuments: top(views), topQuestions: top(topQ).filter((q) => q.count >= 2),
    unanswered: [...gaps.values()].sort((a, b) => b.count - a.count), health, mustRead,
    ai: { questions: qs.length, notFound: qs.filter((q) => q.status === "not_found").length, answered: qs.filter((q) => q.status === "answered").length, thumbsUp: qs.filter((q) => q.feedback?.rating === "up").length, thumbsDown: qs.filter((q) => q.feedback?.rating === "down").length, monthCostMicros: ctx.isManager ? u.costMicros : null },
    reports: ctx.isManager ? reportsSnap.docs.map((d) => { const r = d.data(); return { id: d.id, question: r.question, note: r.note, status: r.status, at: r.createdAt?.toDate?.().toISOString() ?? null, citations: r.citations }; }) : [],
  };
});

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
}

async function saveExport(instId: string, uid: string, name: string, buf: Buffer, type: string): Promise<string> {
  const path = `inst/${instId}/exports/${uid}/${Date.now()}-${name}`;
  await bucket().file(path).save(buf, { contentType: type, resumable: false });
  return path;
}

/** F14: audit log, all of it or the history of one document. */
export const exportAuditLog = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const format = oneOf(req.data.format, ["csv", "pdf", "json"] as const, "csv");
  let q: FirebaseFirestore.Query = db.collection(`institutions/${ctx.instId}/auditLog`);
  if (req.data.targetId) q = q.where("target.id", "==", id(req.data.targetId, "target"));
  if (req.data.from) q = q.where("at", ">=", Timestamp.fromDate(new Date(String(req.data.from))));
  if (req.data.to) q = q.where("at", "<=", Timestamp.fromDate(new Date(String(req.data.to) + "T23:59:59Z")));
  const snap = await q.orderBy("at", "desc").limit(format === "json" ? 200 : 20_000).get();
  const entries = snap.docs.map((d) => d.data() as AuditEntry);
  const rows = entries.map((e) => [(e.at as Timestamp)?.toDate().toISOString() ?? "", e.actorName, e.action, `${e.target.type}: ${e.target.title ?? e.target.id}`, JSON.stringify(e.before ?? ""), JSON.stringify(e.after ?? "")]);
  if (format === "json") return { entries: entries.map((e) => ({ ...e, at: (e.at as Timestamp)?.toDate().toISOString() ?? null })) };
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "export", target: { type: "auditLog", id: String(req.data.targetId ?? "all") }, after: { format, rows: rows.length } });
  if (format === "csv") return { path: await saveExport(ctx.instId, ctx.c.uid, "audit-log.csv", Buffer.from(csv([["Time (UTC)", "Who", "Action", "Target", "Before", "After"], ...rows])), "text/csv") };
  const pdf = await tablePdf(`Audit log: ${ctx.inst.name}`, `Exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by ${ctx.member.name}`, ["Time (UTC)", "Who", "Action", "Target", "Before", "After"], rows.map((r) => r.map((c) => String(c).slice(0, 300))));
  return { path: await saveExport(ctx.instId, ctx.c.uid, "audit-log.pdf", pdf, "application/pdf") };
});

/** F8: who has and hasn't acknowledged a Must-read item, for audits. */
export const exportAcknowledgements = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const format = oneOf(req.data.format, ["csv", "pdf", "json"] as const, "csv");
  const c = (await db.doc(`institutions/${ctx.instId}/content/${id(req.data.contentId, "content")}`).get()).data() as ContentItem | undefined;
  if (!c || !c.mustReadVersionId) throw fail.notFound("This document isn't marked must read.");
  const [acks, members] = await Promise.all([
    db.collection(`institutions/${ctx.instId}/acknowledgements`).where("contentId", "==", c.id).where("versionId", "==", c.mustReadVersionId).get(),
    db.collection(`institutions/${ctx.instId}/members`).where("status", "==", "active").get(),
  ]);
  const ackBy = new Map(acks.docs.map((d) => [d.data().userId, d.data().acknowledgedAt as Timestamp]));
  const people = members.docs.map((d) => ({ ...d.data(), userId: d.id }) as Member).filter((m) => m.visibleSpaceIds.includes(c.spaceId) || ackBy.has(m.userId));
  const rows = people.map((m) => [m.name || m.email, m.jobTitle, m.department, ackBy.get(m.userId)?.toDate().toISOString().slice(0, 16).replace("T", " ") ?? "Not yet"])
    .sort((a, b) => (a[3] === "Not yet" ? -1 : 1) - (b[3] === "Not yet" ? -1 : 1) || String(a[0]).localeCompare(String(b[0])));
  if (format === "json") return { title: c.title, versionNumber: c.currentVersionNumber, rows: rows.map(([name, jobTitle, department, at]) => ({ name, jobTitle, department, at })) };
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "export", target: { type: "acknowledgements", id: c.id, title: c.title }, after: { format, acknowledged: ackBy.size, eligible: people.length } });
  const header = ["Name", "Job title", "Department", "Acknowledged (UTC)"];
  if (format === "csv") return { path: await saveExport(ctx.instId, ctx.c.uid, "acknowledgements.csv", Buffer.from(csv([header, ...rows])), "text/csv") };
  const pdf = await tablePdf(`Acknowledgements: ${c.title} (version ${c.currentVersionNumber})`, `${ackBy.size} of ${people.length} acknowledged. Exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`, header, rows.map((r) => r.map(String)));
  return { path: await saveExport(ctx.instId, ctx.c.uid, "acknowledgements.pdf", pdf, "application/pdf") };
});

/** Owners and admins export all their content (also available when suspended or cancelled). */
export const exportContentIndex = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"], cap: "export" });
  const snap = await db.collection(`institutions/${ctx.instId}/content`).get();
  const spaces = new Map((await db.collection(`institutions/${ctx.instId}/spaces`).get()).docs.map((d) => [d.id, d.data().name as string]));
  const files: { title: string; path: string }[] = [];
  for (const d of snap.docs) {
    const c = d.data() as ContentItem;
    if (!c.currentVersionId) continue;
    const [f] = await bucket().getFiles({ prefix: `inst/${ctx.instId}/published/${c.spaceId}/${d.id}/${c.currentVersionId}/original/` });
    if (f[0]) files.push({ title: c.title, path: f[0].name });
  }
  const rows = snap.docs.map((d) => { const c = d.data() as ContentItem; return [c.title, spaces.get(c.spaceId) ?? "", c.documentType, c.status, c.currentVersionNumber ?? "", c.effectiveDate ?? "", c.reviewDate ?? "", c.ownerName]; });
  const path = await saveExport(ctx.instId, ctx.c.uid, "content-index.csv", Buffer.from(csv([["Title", "Space", "Type", "Status", "Version", "Effective", "Review", "Owner"], ...rows])), "text/csv");
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "export", target: { type: "content", id: "all" }, after: { documents: rows.length } });
  return { indexPath: path, files };
});
