// Security rules tests: tenant isolation, roles, space visibility, revocation.
// Run: npm run test:rules (starts the Firestore and Storage emulators).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc, Timestamp } from "firebase/firestore";
import { ref, getBytes, uploadBytes } from "firebase/storage";

let env: RulesTestEnvironment;
const now = Math.floor(Date.now() / 1000);
const past = Timestamp.fromMillis(Date.now() - 86_400_000);
const future = Timestamp.fromMillis(Date.now() + 86_400_000);

const member = (role: string, extra: Record<string, unknown> = {}) => ({
  userId: "", role, name: role, email: `${role}@x.test`, phone: "", jobTitle: "Nurse", department: "", spaceIds: [],
  status: "active", expiresAt: null, invitedBy: null, joinedAt: past, lastActiveAt: null,
  access: "full", visibleSpaceIds: ["general"], editSpaceIds: [], approveSpaceIds: [], signOutBefore: 0, ...extra,
});

// Users: A = Hospital A, B = Hospital B
const users: Record<string, { inst: string; data: Record<string, unknown> }> = {
  ownerA: { inst: "A", data: member("owner", { visibleSpaceIds: ["general", "pharmacy"] }) },
  staffA: { inst: "A", data: member("staff") },
  pharmA: { inst: "A", data: member("staff", { visibleSpaceIds: ["general", "pharmacy"] }) },
  editorA: { inst: "A", data: member("editor", { editSpaceIds: ["general"] }) },
  removedA: { inst: "A", data: member("staff", { status: "deactivated" }) },
  expiredLocumA: { inst: "A", data: member("locum", { expiresAt: past }) },
  activeLocumA: { inst: "A", data: member("locum", { expiresAt: future }) },
  signedOutA: { inst: "A", data: member("staff", { signOutBefore: now + 3600 }) },
  restrictedA: { inst: "A", data: member("staff", { access: "read" }) },
  suspendedStaffA: { inst: "A", data: member("staff", { access: "none" }) },
  ownerB: { inst: "B", data: member("owner") },
  staffB: { inst: "B", data: member("staff") },
};

const as = (u: string) => env.authenticatedContext(u, { auth_time: now, email: `${u}@x.test`, email_verified: true });
const db = (u: string) => as(u).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-docinsight",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
});
afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    for (const inst of ["A", "B"]) {
      await setDoc(doc(f, `institutions/${inst}`), { name: `Hospital ${inst}`, status: "active", settings: { questionLogOptIn: false } });
      await setDoc(doc(f, `institutions/${inst}/spaces/general`), { name: "General", visibility: "all" });
      await setDoc(doc(f, `institutions/${inst}/spaces/pharmacy`), { name: "Pharmacy", visibility: "restricted" });
      await setDoc(doc(f, `institutions/${inst}/sections/s1`), { spaceId: "general", name: "Protocols" });
      await setDoc(doc(f, `institutions/${inst}/content/pub`), { spaceId: "general", published: true, title: "Sepsis" });
      await setDoc(doc(f, `institutions/${inst}/content/draft`), { spaceId: "general", published: false, title: "Draft" });
      await setDoc(doc(f, `institutions/${inst}/content/pharm`), { spaceId: "pharmacy", published: true, title: "Formulary" });
      await setDoc(doc(f, `institutions/${inst}/content/pub/versions/v1`), { number: 1 });
      await setDoc(doc(f, `institutions/${inst}/questions/q1`), { userId: inst === "A" ? "staffA" : "staffB", question: "q" });
      await setDoc(doc(f, `institutions/${inst}/invoices/inv1`), { amount: 1 });
      await setDoc(doc(f, `institutions/${inst}/auditLog/a1`), { action: "x" });
      await setDoc(doc(f, `institutions/${inst}/chunks/c1`), { text: "secret" });
    }
    for (const [u, { inst, data }] of Object.entries(users)) {
      await setDoc(doc(f, `institutions/${inst}/members/${u}`), { ...data, userId: u });
      await setDoc(doc(f, `users/${u}`), { hubAccess: !["suspendedStaffA", "removedA"].includes(u) });
    }
    await setDoc(doc(f, "users/outsider"), { hubAccess: false });
    await setDoc(doc(f, "hubContent/h1"), { published: true, title: "National guideline" });
    await setDoc(doc(f, "platformAdmins/tunde"), { email: "t@x.test" });
    await setDoc(doc(f, "plans/clinic"), { name: "Clinic" });
  });
});

describe("tenant isolation", () => {
  it("a member reads their own institution", async () => { await assertSucceeds(getDoc(doc(db("staffA"), "institutions/A"))); });
  it("a member of A can never read B", async () => {
    await assertFails(getDoc(doc(db("staffA"), "institutions/B")));
    await assertFails(getDoc(doc(db("ownerA"), "institutions/B/content/pub")));
    await assertFails(getDoc(doc(db("ownerA"), "institutions/B/spaces/general")));
    await assertFails(getDocs(query(collection(db("ownerA"), "institutions/B/content"), where("spaceId", "==", "general"), where("published", "==", true))));
    await assertFails(getDoc(doc(db("ownerA"), "institutions/B/members/staffB")));
    await assertFails(getDoc(doc(db("ownerA"), "institutions/B/invoices/inv1")));
    await assertFails(getDoc(doc(db("ownerA"), "institutions/B/auditLog/a1")));
  });
  it("an outsider reads nothing", async () => {
    await assertFails(getDoc(doc(db("outsider"), "institutions/A")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "institutions/A/content/pub")));
  });
  it("clients cannot write institution data", async () => {
    await assertFails(setDoc(doc(db("ownerA"), "institutions/A/content/new"), { spaceId: "general", published: true }));
    await assertFails(updateDoc(doc(db("ownerA"), "institutions/A"), { status: "active" }));
    await assertFails(setDoc(doc(db("ownerA"), "institutions/A/members/ownerA"), member("owner")));
    await assertFails(setDoc(doc(db("ownerB"), "institutions/A/members/ownerB"), member("owner")));
  });
  it("chunks and AI caches are server-only", async () => {
    await assertFails(getDoc(doc(db("ownerA"), "institutions/A/chunks/c1")));
  });
});

describe("spaces and content visibility", () => {
  it("staff see published content in visible spaces only", async () => {
    await assertSucceeds(getDoc(doc(db("staffA"), "institutions/A/content/pub")));
    await assertFails(getDoc(doc(db("staffA"), "institutions/A/content/draft")));
    await assertFails(getDoc(doc(db("staffA"), "institutions/A/content/pharm")));
    await assertFails(getDoc(doc(db("staffA"), "institutions/A/spaces/pharmacy")));
    await assertSucceeds(getDoc(doc(db("pharmA"), "institutions/A/content/pharm")));
    await assertSucceeds(getDocs(query(collection(db("staffA"), "institutions/A/content"), where("spaceId", "==", "general"), where("published", "==", true))));
    await assertFails(getDocs(query(collection(db("staffA"), "institutions/A/content"), where("spaceId", "==", "general"))));
  });
  it("editors of a space see its drafts and versions; staff do not", async () => {
    await assertSucceeds(getDoc(doc(db("editorA"), "institutions/A/content/draft")));
    await assertSucceeds(getDoc(doc(db("editorA"), "institutions/A/content/pub/versions/v1")));
    await assertFails(getDoc(doc(db("staffA"), "institutions/A/content/pub/versions/v1")));
  });
});

describe("revocation", () => {
  it("a removed user loses access immediately", async () => { await assertFails(getDoc(doc(db("removedA"), "institutions/A/content/pub"))); });
  it("an expired locum cannot open any content", async () => { await assertFails(getDoc(doc(db("expiredLocumA"), "institutions/A/content/pub"))); });
  it("an unexpired locum can", async () => { await assertSucceeds(getDoc(doc(db("activeLocumA"), "institutions/A/content/pub"))); });
  it("a forced sign-out rejects older sessions", async () => { await assertFails(getDoc(doc(db("signedOutA"), "institutions/A/content/pub"))); });
  it("restricted billing keeps read access; suspended staff have none", async () => {
    await assertSucceeds(getDoc(doc(db("restrictedA"), "institutions/A/content/pub")));
    await assertFails(getDoc(doc(db("suspendedStaffA"), "institutions/A/content/pub")));
  });
});

describe("roles", () => {
  it("only managers read members, invites, usage and the audit log", async () => {
    await assertSucceeds(getDoc(doc(db("ownerA"), "institutions/A/members/staffA")));
    await assertFails(getDoc(doc(db("staffA"), "institutions/A/members/ownerA")));
    await assertSucceeds(getDoc(doc(db("staffA"), "institutions/A/members/staffA")));
    await assertSucceeds(getDoc(doc(db("ownerA"), "institutions/A/auditLog/a1")));
    await assertFails(getDoc(doc(db("staffA"), "institutions/A/auditLog/a1")));
  });
  it("only the owner reads invoices", async () => {
    await assertSucceeds(getDoc(doc(db("ownerA"), "institutions/A/invoices/inv1")));
    await assertFails(getDoc(doc(db("editorA"), "institutions/A/invoices/inv1")));
  });
  it("question logs: the asker only, unless the owner opts in", async () => {
    await assertSucceeds(getDoc(doc(db("staffA"), "institutions/A/questions/q1")));
    await assertFails(getDoc(doc(db("ownerA"), "institutions/A/questions/q1")));
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "institutions/A"), { "settings.questionLogOptIn": true }));
    await assertSucceeds(getDoc(doc(db("ownerA"), "institutions/A/questions/q1")));
  });
  it("platform admins read institutions but not question logs", async () => {
    await assertSucceeds(getDoc(doc(db("tunde"), "institutions/B")));
    await assertFails(getDoc(doc(db("tunde"), "institutions/B/questions/q1")));
  });
});

describe("personal data", () => {
  it("users manage their own favourites within visible spaces", async () => {
    const fav = (u: string, inst: string, space: string) => setDoc(doc(db(u), `institutions/${inst}/members/${u}/favourites/pub`), { contentId: "pub", title: "Sepsis", spaceId: space, at: Timestamp.now() });
    await assertSucceeds(fav("staffA", "A", "general"));
    await assertFails(fav("staffA", "A", "pharmacy"));
    await assertFails(setDoc(doc(db("staffA"), "institutions/A/members/pharmA/favourites/pub"), { contentId: "pub", title: "x", spaceId: "general", at: Timestamp.now() }));
  });
  it("settings accept only known fields", async () => {
    await assertSucceeds(setDoc(doc(db("staffA"), "users/staffA/private/settings"), { dataSaver: true }));
    await assertFails(setDoc(doc(db("staffA"), "users/staffA/private/settings"), { hubAccess: true }));
    await assertFails(setDoc(doc(db("staffA"), "users/staffB/private/settings"), { dataSaver: true }));
  });
  it("hub content needs a paying membership", async () => {
    await assertSucceeds(getDoc(doc(db("staffA"), "hubContent/h1")));
    await assertFails(getDoc(doc(db("outsider"), "hubContent/h1")));
  });
  it("plans are public", async () => { await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "plans/clinic"))); });
});

describe("storage", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const s = ctx.storage();
      await uploadBytes(ref(s, "inst/A/published/general/pub/v1/text.json"), new TextEncoder().encode("{}"));
      await uploadBytes(ref(s, "inst/A/published/pharmacy/pharm/v1/text.json"), new TextEncoder().encode("{}"));
      await uploadBytes(ref(s, "inst/B/published/general/pub/v1/text.json"), new TextEncoder().encode("{}"));
      await uploadBytes(ref(s, "inst/A/drafts/draft/v1/text.json"), new TextEncoder().encode("{}"));
      await uploadBytes(ref(s, "inst/A/invoices/inv1.pdf"), new TextEncoder().encode("%PDF"));
      await uploadBytes(ref(s, "hub/h1/v1/text.json"), new TextEncoder().encode("{}"));
      await setDoc(doc(ctx.firestore(), "institutions/A/content/draft/versions/up1"), { status: "uploading", createdBy: "editorA" });
    });
  });
  const st = (u: string) => as(u).storage();
  it("published files: visible spaces only, own tenant only", async () => {
    await assertSucceeds(getBytes(ref(st("staffA"), "inst/A/published/general/pub/v1/text.json")));
    await assertFails(getBytes(ref(st("staffA"), "inst/A/published/pharmacy/pharm/v1/text.json")));
    await assertFails(getBytes(ref(st("ownerA"), "inst/B/published/general/pub/v1/text.json")));
    await assertFails(getBytes(ref(st("removedA"), "inst/A/published/general/pub/v1/text.json")));
    await assertFails(getBytes(ref(st("expiredLocumA"), "inst/A/published/general/pub/v1/text.json")));
  });
  it("drafts: editors of the space and admins only", async () => {
    await assertSucceeds(getBytes(ref(st("editorA"), "inst/A/drafts/draft/v1/text.json")));
    await assertSucceeds(getBytes(ref(st("ownerA"), "inst/A/drafts/draft/v1/text.json")));
    await assertFails(getBytes(ref(st("staffA"), "inst/A/drafts/draft/v1/text.json")));
  });
  it("uploads: only the creator of an uploading version", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    await assertSucceeds(uploadBytes(ref(st("editorA"), "inst/A/uploads/draft/up1/file.pdf"), pdf, { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("staffA"), "inst/A/uploads/draft/up1/other.pdf"), pdf, { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("ownerB"), "inst/A/uploads/draft/up1/x.pdf"), pdf, { contentType: "application/pdf" }));
  });
  it("invoices: owner only; hub: paying members only", async () => {
    await assertSucceeds(getBytes(ref(st("ownerA"), "inst/A/invoices/inv1.pdf")));
    await assertFails(getBytes(ref(st("staffA"), "inst/A/invoices/inv1.pdf")));
    await assertSucceeds(getBytes(ref(st("staffA"), "hub/h1/v1/text.json")));
    await assertFails(getBytes(ref(st("outsider"), "hub/h1/v1/text.json")));
  });
});
