// Operations CLI, run from GitHub Actions with the project's credentials:
//   node lib/ops.js config                     write default plans/billing/platform config (never overwrites edits)
//   node lib/ops.js seed-demo <ownerEmail>     create or refresh the Demo Specialist Hospital
//   node lib/ops.js grant-admin <email>        make an existing account a platform super admin
//   node lib/ops.js eval <instId|demo> [file]  run the quality evaluation set (PRD section 7)
import { readFileSync, writeFileSync } from "node:fs";
import type { Institution, Member, Space } from "../../../shared/src/types";
import { DEFAULT_BILLING_CONFIG, DEFAULT_PLANS, DEFAULT_PLATFORM_CONFIG, SPACE_TEMPLATES } from "../../../shared/src/config";
import { capabilities } from "../../../shared/src/billing";
import { adminAuth, db, FieldValue, randomId, Timestamp } from "../lib/admin";
import type { Ctx } from "../lib/access";
import { recomputeMembers, syncUser } from "../lib/visibility";
import { runIngest } from "../pipeline/ingest";
import { runPublish } from "../pipeline/publish";
import { answerQuestion } from "../api/ai";
import { retrieve } from "../ai/retrieve";
import { DEMO_DOCS, DEMO_EVAL } from "./demo-content";

const [cmd, ...args] = process.argv.slice(2);
const log = (...a: unknown[]) => console.log(...a);

async function config() {
  for (const p of DEFAULT_PLANS) {
    const ref = db.doc(`plans/${p.id}`);
    if (!(await ref.get()).exists) { await ref.set(p); log("plan created", p.id); }
  }
  for (const [path, data] of [["config/billing", DEFAULT_BILLING_CONFIG], ["config/platform", DEFAULT_PLATFORM_CONFIG]] as const) {
    const ref = db.doc(path);
    const cur = (await ref.get()).data() ?? {};
    // Add missing keys only: edits made in the console are never overwritten
    const missing = Object.fromEntries(Object.entries(data).filter(([k]) => !(k in cur)));
    if (Object.keys(missing).length) { await ref.set(missing, { merge: true }); log("config added", path, Object.keys(missing).join(", ")); }
  }
  await db.doc("config/hub").set({ corpusVersion: FieldValue.increment(0) }, { merge: true });
  const cols = ["Standard treatment guidelines", "Essential medicines", "NCDC guidance", "NHIA and HMO rules"];
  const existing = await db.collection("hubCollections").get();
  if (existing.empty) {
    for (const [i, name] of cols.entries()) {
      const ref = db.collection("hubCollections").doc();
      await ref.set({ id: ref.id, name, description: "", order: i, archived: false });
    }
    log("hub collections created (empty: add documents once usage rights are confirmed)");
  }
}

async function grantAdmin(email: string) {
  const u = await adminAuth().getUserByEmail(email);
  await db.doc(`platformAdmins/${u.uid}`).set({ email, grantedAt: FieldValue.serverTimestamp() });
  await syncUser(u.uid);
  log("platform admin granted", email);
}

async function seedDemo(ownerEmail: string) {
  let owner: { uid: string; name: string; email: string } | null = null;
  try { const u = await adminAuth().getUserByEmail(ownerEmail); owner = { uid: u.uid, name: u.displayName || "Tunde David", email: ownerEmail }; } catch { log("owner account not found yet; the demo will be owned by the first person to accept its owner invite"); }
  const found = await db.collection("institutions").where("demo", "==", true).limit(1).get();
  const ref = found.docs[0]?.ref ?? db.collection("institutions").doc();
  const instId = ref.id;
  if (found.empty) {
    await ref.set({
      name: "Demo Specialist Hospital", logoRef: null, colour: "#0E7A68", country: "NG", planId: "hospital", billingCycle: "annual", status: "active",
      statusChangedAt: Timestamp.now(), currentPeriodEnd: Timestamp.fromMillis(Date.now() + 365 * 86_400_000), pastDueSince: null, cancelledAt: null, remindersSent: [],
      seatsUsed: 1, extraSeats: 0, billingContact: { name: owner?.name ?? "", email: ownerEmail, phone: "" }, emailDomains: [],
      settings: { phoneLogin: false, dataSaverDefault: false, hiddenHubCollections: [], questionLogOptIn: false, requireAdmin2fa: false, emailDigest: false },
      joinCode: "DEMO" + randomId(4, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"), discountPct: 100, pilot: null, setupPackageId: null, corpusVersion: 0,
      createdBy: owner?.uid ?? "system", createdAt: Timestamp.now(), lastActivityAt: Timestamp.now(), demo: true,
    } satisfies Omit<Institution, "id"> & { demo: boolean });
    log("demo institution created", instId);
  }
  if (owner) {
    await ref.collection("members").doc(owner.uid).set({
      userId: owner.uid, role: "owner", name: owner.name, email: owner.email, phone: "", jobTitle: "Administrator", department: "Management", spaceIds: [],
      status: "active", expiresAt: null, invitedBy: null, joinedAt: Timestamp.now(), lastActiveAt: null, access: "full", visibleSpaceIds: [], editSpaceIds: [], approveSpaceIds: [], signOutBefore: 0,
    } satisfies Member, { merge: true });
  } else {
    const token = randomId(24);
    await ref.collection("invites").doc(token).set({ token, email: ownerEmail, phone: null, name: "", role: "owner", jobTitle: "Administrator", department: "", spaceIds: [], locumExpiresAt: null, status: "pending", createdBy: "system", createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 90 * 86_400_000), sentVia: ["link"] });
    log(`owner invite: /join/${instId}/${token}`);
  }
  const spaceKeys = ["hospital-wide", "emergency", "nursing", "maternity", "pharmacy", "biomedical", "billing"];
  const spacesSnap = await ref.collection("spaces").get();
  const spaces = new Map(spacesSnap.docs.map((d) => [d.data().template as string, { id: d.id, ...d.data() } as Space]));
  for (const [i, key] of spaceKeys.entries()) {
    if (spaces.has(key)) continue;
    const t = SPACE_TEMPLATES.find((x) => x.key === key)!;
    const sref = ref.collection("spaces").doc();
    const space: Space = { id: sref.id, siteId: null, name: t.name, icon: t.icon, colour: t.colour, description: "", visibility: t.visibility, allowedUserIds: [], allowedJobTitles: t.allowedJobTitles, editorIds: owner ? [owner.uid] : [], approverIds: owner ? [owner.uid] : [], approverNames: owner ? [owner.name] : [], requiresApproval: t.requiresApproval, order: i, archived: false, template: key, createdAt: Timestamp.now() };
    await sref.set(space);
    for (const [j, name] of t.sections.entries()) {
      const secRef = ref.collection("sections").doc();
      await secRef.set({ id: secRef.id, spaceId: sref.id, name, order: j, archived: false });
    }
    spaces.set(key, space);
  }
  await recomputeMembers(instId);
  if (owner) await syncUser(owner.uid);
  const sections = (await ref.collection("sections").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; spaceId: string; name: string });
  const existing = new Set((await ref.collection("content").get()).docs.map((d) => d.data().title as string));
  const scope = { kind: "inst" as const, instId };
  const actor = { uid: owner?.uid ?? "system", name: owner?.name ?? "DocInsight" };
  for (const doc of DEMO_DOCS) {
    if (existing.has(doc.title)) continue;
    const space = spaces.get(doc.space)!;
    const section = sections.find((s) => s.spaceId === space.id && s.name === doc.section) ?? null;
    const cref = ref.collection("content").doc();
    const vref = cref.collection("versions").doc();
    const review = new Date(Date.now() + doc.reviewInDays * 86_400_000).toISOString().slice(0, 10);
    await cref.set({
      id: cref.id, spaceId: space.id, sectionId: section?.id ?? null, type: "page", title: doc.title, description: "Demo document for testing", ownerId: actor.uid, ownerName: actor.name,
      documentType: doc.documentType, tags: ["demo"], language: doc.language ?? "en", status: "draft", published: false, currentVersionId: null, currentVersionNumber: null,
      latestVersionId: vref.id, versionCount: 1, effectiveDate: new Date().toISOString().slice(0, 10), reviewDate: review, reviewRemindersSent: [30, 7], mustRead: !!doc.mustRead, mustReadVersionId: null,
      pageCount: 0, approvedByName: null, approvedAt: null, url: null, source: "hospital", createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await vref.set({
      id: vref.id, number: 1, status: "processing", fileRef: null, fileName: null, mime: null, sizeBytes: 0, pageCount: 0, pageLabels: [], ocrStatus: "pending", ocrConfidence: null,
      ocrPages: [], lowConfidencePages: [], checkedPages: [], processingError: null, processedPages: 0, body: doc.body, checklist: null, url: null, changeNote: "Demo content",
      createdBy: actor.uid, createdByName: actor.name, createdAt: Timestamp.now(), submittedBy: actor.uid, submittedAt: Timestamp.now(), reviewComment: null, reviewedBy: actor.uid, reviewedAt: Timestamp.now(),
      approvedBy: null, approvedByName: null, approvedAt: null, active: false, chunkCount: 0,
    });
    await runIngest(scope, cref.id, vref.id);
    await vref.update({ status: "approved", approvedBy: actor.uid, approvedByName: actor.name, approvedAt: Timestamp.now() });
    await runPublish(scope, cref.id, vref.id, actor);
    log("published", doc.title);
  }
  log("demo ready", instId);
  writeFileSync("demo-institution.txt", instId);
}

function evalCtx(institution: Institution): Ctx {
  return {
    c: { uid: "eval-bot", email: "", emailVerified: true, name: "Evaluation", authTime: 0, secondFactor: true },
    instId: institution.id, inst: institution, isManager: true, isOwner: false, platformAdmin: true, caps: capabilities("active"),
    member: { userId: "eval-bot", role: "admin", name: "Evaluation", email: "", phone: "", jobTitle: "", department: "", spaceIds: [], status: "active", expiresAt: null, invitedBy: null, joinedAt: Timestamp.now(), lastActiveAt: null, access: "full", visibleSpaceIds: [], editSpaceIds: [], approveSpaceIds: [], signOutBefore: 0 },
  };
}

async function evaluate(instArg: string, file?: string) {
  const instId = instArg === "demo" ? (await db.collection("institutions").where("demo", "==", true).limit(1).get()).docs[0]?.id : instArg;
  if (!instId) throw new Error("Institution not found");
  const institution = { id: instId, ...(await db.doc(`institutions/${instId}`).get()).data() } as Institution;
  const set = file ? (JSON.parse(readFileSync(file, "utf8")) as typeof DEMO_EVAL) : DEMO_EVAL;
  const titles = new Map((await db.collection(`institutions/${instId}/content`).get()).docs.map((d) => [d.id, d.data().title as string]));
  const spaces = (await db.collection(`institutions/${instId}/spaces`).where("archived", "==", false).get()).docs.map((d) => d.id);
  const ctx = evalCtx(institution);
  const rows: Record<string, unknown>[] = [];
  let inScope = 0, top3 = 0, cited = 0, uncitedAnswers = 0, outScope = 0, notFoundRight = 0;
  for (const q of set) {
    const hits = await retrieve({ instId, spaceIds: spaces, hubCollectionIds: [], instCorpus: institution.corpusVersion, hubCorpus: 0 }, q.question, 20);
    const firstTitles = [...new Set(hits.map((h) => h.chunk.title))].slice(0, 3);
    await db.doc(`institutions/${instId}/rateLimits/eval-bot`).delete().catch(() => {});
    const r = await answerQuestion(ctx, q.question, () => {});
    const citedTitles = [...new Set(r.citations.map((c) => titles.get(c.contentId) ?? c.title))];
    const row: Record<string, unknown> = { question: q.question, expected: q.expectTitle ?? "(not covered)", top3: firstTitles, status: r.status, cited: citedTitles };
    if (q.expectTitle) {
      inScope++;
      if (firstTitles.includes(q.expectTitle)) top3++;
      if (r.status === "answered" && citedTitles.includes(q.expectTitle)) cited++;
      if (r.status === "answered" && !r.citations.length) uncitedAnswers++;
      row.pass = firstTitles.includes(q.expectTitle) && r.status === "answered" && citedTitles.includes(q.expectTitle);
    } else {
      outScope++;
      if (r.status === "not_found" || r.status === "off_topic") notFoundRight++;
      row.pass = r.status === "not_found" || r.status === "off_topic";
    }
    rows.push(row);
    log(`${row.pass ? "PASS" : "FAIL"}  ${q.question}  →  ${r.status}${citedTitles.length ? ` [${citedTitles.join("; ")}]` : ""}`);
  }
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 100);
  const metrics = {
    questions: set.length, rightDocumentTop3: `${pct(top3, inScope)}% (target 85%)`, correctCitedAnswer: `${pct(cited, inScope)}% (target 90%)`,
    uncitedAnswers: `${uncitedAnswers} (target 0)`, correctNotFound: `${pct(notFoundRight, outScope)}% (target 100%)`,
  };
  log("\n" + JSON.stringify(metrics, null, 2));
  writeFileSync("eval-report.json", JSON.stringify({ instId, at: new Date().toISOString(), metrics, rows }, null, 2));
  await db.collection(`institutions/${instId}/questions`).where("userId", "==", "eval-bot").get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
}

(async () => {
  if (cmd === "config") await config();
  else if (cmd === "grant-admin") await grantAdmin(args[0]);
  else if (cmd === "seed-demo") await seedDemo(args[0]);
  else if (cmd === "eval") await evaluate(args[0], args[1]);
  else { console.error("Commands: config | grant-admin <email> | seed-demo <ownerEmail> | eval <instId|demo> [file]"); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
