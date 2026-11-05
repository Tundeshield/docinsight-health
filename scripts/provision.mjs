// Runs in GitHub Actions before each deploy (signed in keylessly as the deployer).
// Makes sure sign-in methods, OCR, file access and backups are configured. Safe to repeat.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { GoogleAuth } = require("google-auth-library");
const projectId = process.env.PROJECT_ID || "docinsight-health";
const APP_ORIGIN = "https://docinsight-health.netlify.app";
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const client = await auth.getClient();
const log = (m) => console.log(`• ${m}`);
const warn = (m) => console.log(`::warning::${m}`);

async function api(method, url, body, { allow = [] } = {}) {
  const res = await client.request({ method, url, data: body, headers: { "x-goog-user-project": projectId }, validateStatus: () => true });
  if (res.status >= 400 && !allow.includes(res.status)) throw new Error(`${method} ${url.split("?")[0]} → ${res.status}: ${JSON.stringify(res.data?.error?.message ?? res.data).slice(0, 300)}`);
  return { status: res.status, data: res.data };
}
const step = async (name, fn) => { try { await fn(); } catch (e) { warn(`${name}: ${e.message}`); } };

const proj = (await api("GET", `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`)).data;
const num = proj.projectNumber;

await step("Billing", async () => {
  const b = (await api("GET", `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`)).data;
  if (!b.billingEnabled) throw new Error("Billing is not open on this project. Functions, storage and OCR won't deploy until it is.");
  log("Billing open");
});

// Sign-in: email and password, email link, phone, TOTP two-step; the Netlify site as an allowed domain
await step("Sign-in settings", async () => {
  const cfgUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  let cfg = await api("GET", cfgUrl, null, { allow: [404, 400] });
  if (cfg.status >= 400) { await api("POST", `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/identityPlatform:initializeAuth`, {}); cfg = await api("GET", cfgUrl); }
  const domains = new Set([...(cfg.data.authorizedDomains ?? []), "localhost", `${projectId}.firebaseapp.com`, `${projectId}.web.app`, new URL(APP_ORIGIN).host]);
  await api("PATCH", `${cfgUrl}?updateMask=signIn.email,signIn.phoneNumber.enabled,authorizedDomains,mfa`, {
    signIn: { email: { enabled: true, passwordRequired: false }, phoneNumber: { enabled: true } },
    authorizedDomains: [...domains],
    mfa: { state: "ENABLED", providerConfigs: [{ state: "ENABLED", totpProviderConfig: { adjacentIntervals: 5 } }] },
  });
  log("Sign-in methods: email and password, email link, phone, two-step (authenticator app)");
});

// OCR processor (Document AI, EU)
let processor = process.env.DOCAI_PROCESSOR || "";
await step("OCR processor", async () => {
  const base = `https://eu-documentai.googleapis.com/v1/projects/${projectId}/locations/eu/processors`;
  const list = (await api("GET", base)).data.processors ?? [];
  let p = list.find((x) => x.type === "OCR_PROCESSOR" && x.state !== "DELETED");
  if (!p) p = (await api("POST", base, { type: "OCR_PROCESSOR", displayName: "docinsight-ocr" })).data;
  processor = p.name;
  log(`OCR processor ${p.name.split("/").pop()}`);
});
writeFileSync(new URL(`../functions/.env.${projectId}`, import.meta.url), `DOCAI_PROCESSOR=${processor}\n`);

// File storage: browsers may download page images from the app's own sites
await step("File storage access", async () => {
  const bucket = `${projectId}.firebasestorage.app`;
  await api("PATCH", `https://storage.googleapis.com/storage/v1/b/${bucket}?fields=cors`, {
    cors: [{ origin: [APP_ORIGIN, "http://localhost:5173", "http://localhost:4173"], method: ["GET", "HEAD"], responseHeader: ["Content-Type", "Authorization", "Content-Length", "x-goog-meta-*"], maxAgeSeconds: 3600 }],
  });
  log("File storage CORS set");
});

// Daily database backups kept 30 days
await step("Backups", async () => {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/backupSchedules`;
  const have = (await api("GET", base)).data.backupSchedules ?? [];
  if (!have.length) await api("POST", base, { retention: `${30 * 86400}s`, dailyRecurrence: {} });
  log("Daily backups (30 days)");
});

// Storage rules read Firestore: the storage service agent needs this role
await step("Storage rules permission", async () => {
  const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`;
  const policy = (await api("POST", `${url}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } })).data;
  const member = `serviceAccount:service-${num}@gcp-sa-firebasestorage.iam.gserviceaccount.com`;
  const role = "roles/firebaserules.firestoreServiceAgent";
  let b = policy.bindings.find((x) => x.role === role && !x.condition);
  if (!b) { b = { role, members: [] }; policy.bindings.push(b); }
  if (!b.members.includes(member)) { b.members.push(member); await api("POST", `${url}:setIamPolicy`, { policy }); }
  log("Storage rules can read memberships");
});
