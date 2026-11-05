// One-time Google Cloud setup, signed in with the Firebase CLI's Google sign-in.
// Usage: node scripts/setup-cloud.mjs <projectId> <firebase-tools dir> <email> <owner/repo>
// Safe to run again: it only creates what's missing.
import { createRequire } from "node:module";
import readline from "node:readline";

const [projectId, toolsDir, email, repo] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const auth = require(`${toolsDir}/lib/auth.js`);
const REGION = "europe-west1";
const log = (m) => console.log(`   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token() {
  const acct = (auth.getAllAccounts() || []).find((a) => a.user?.email === email) || auth.getGlobalDefaultAccount();
  if (!acct?.tokens?.refresh_token) throw new Error("Not signed in. Run the setup again.");
  const t = await auth.getAccessToken(acct.tokens.refresh_token, []);
  if (!t?.access_token || t.access_token === acct.tokens.refresh_token) throw new Error("Your Google sign-in has expired. Run: scripts/.tools/node_modules/.bin/firebase login --reauth, then run the setup again.");
  return t.access_token;
}
async function api(method, url, body, { allow404 = false, allow409 = false } = {}) {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", "x-goog-user-project": projectId }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 404 && allow404) return null;
  if (res.status === 409 && allow409) return { alreadyExists: true };
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(`${method} ${url.split("?")[0]} → ${res.status}: ${json.error?.message || text.slice(0, 300)}`), { status: res.status });
  return json;
}
async function waitOp(url, what) {
  for (let i = 0; i < 90; i++) {
    const op = await api("GET", url);
    if (op.done) { if (op.error) throw new Error(`${what} failed: ${op.error.message}`); return op; }
    await sleep(4000);
  }
  throw new Error(`${what} is taking too long. Run the setup again in a few minutes.`);
}
function hidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a.trim()); });
  });
}

const proj = await api("GET", `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`);
const num = proj.projectNumber;

// 0. Billing must be open: Cloud Functions, file storage, OCR and AI search all need it.
await api("POST", `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/cloudbilling.googleapis.com:enable`).then((op) => op.name && !op.done ? waitOp(`https://serviceusage.googleapis.com/v1/${op.name}`, "Billing API") : null).catch(() => null);
const billing = await api("GET", `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`).catch(() => null);
if (billing && !billing.billingEnabled) {
  console.log(`\n   \x1b[1;31mThis project has no open billing account.\x1b[0m`);
  console.log(`   1. Open https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`);
  console.log(`   2. If it says the billing account is closed, click "Manage billing accounts", open (or create) an account and add a card.`);
  console.log(`   3. Link that account to ${projectId}, then run this setup again.`);
  console.log(`   Google gives new accounts free credit, and DocInsight's usage at pilot scale costs a few dollars a month.\n`);
  process.exit(1);
}
log("Billing is open.");

// 1. Services
const SERVICES = ["firestore.googleapis.com", "firebasestorage.googleapis.com", "storage.googleapis.com", "cloudtasks.googleapis.com",
  "cloudfunctions.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com", "run.googleapis.com", "eventarc.googleapis.com",
  "secretmanager.googleapis.com", "cloudresourcemanager.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com",
  "firebaserules.googleapis.com", "identitytoolkit.googleapis.com", "pubsub.googleapis.com", "cloudscheduler.googleapis.com",
  "documentai.googleapis.com", "vision.googleapis.com", "aiplatform.googleapis.com", "fcm.googleapis.com", "fcmregistrations.googleapis.com",
  "firebase.googleapis.com", "logging.googleapis.com", "serviceusage.googleapis.com"];
log("Switching on Google services (a minute or two)…");
for (let i = 0; i < SERVICES.length; i += 20) {
  const en = await api("POST", `https://serviceusage.googleapis.com/v1/projects/${projectId}/services:batchEnable`, { serviceIds: SERVICES.slice(i, i + 20) });
  if (en.name && !en.done) await waitOp(`https://serviceusage.googleapis.com/v1/${en.name}`, "Switching on services");
}
log("Services are on.");

// 2. Database
const db = await api("GET", `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`, null, { allow404: true });
if (db) log(`Database exists (${db.locationId}).`);
else {
  log(`Creating the database in ${REGION}…`);
  const op = await api("POST", `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`, { type: "FIRESTORE_NATIVE", locationId: REGION }, { allow409: true });
  if (op?.name) await waitOp(`https://firestore.googleapis.com/v1/${op.name}`, "Creating the database");
  log("Database created.");
}

// 3. File storage
const bucketUrl = `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`;
let bucket = await api("GET", bucketUrl, null, { allow404: true });
if (!bucket?.bucket?.name) {
  log(`Creating file storage in ${REGION}…`);
  try {
    await api("POST", bucketUrl, { location: REGION, storageClass: "STANDARD" }, { allow409: true });
    for (let i = 0; i < 24 && !bucket?.bucket?.name; i++) { await sleep(5000); bucket = await api("GET", bucketUrl, null, { allow404: true }); }
    if (!bucket?.bucket?.name) throw new Error("not ready yet");
  } catch (e) {
    console.log(`\n   File storage couldn't be created automatically (${e.message}).\n   Open https://console.firebase.google.com/project/${projectId}/storage, click "Get started", choose ${REGION}, then run this setup again.\n`);
    process.exit(1);
  }
}
log("File storage is ready.");

// 4. Secrets (stored in Google Secret Manager, never on disk or in GitHub)
async function ensureSecret(name, getValue) {
  const base = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets`;
  const existing = await api("GET", `${base}/${name}/versions/latest`, null, { allow404: true });
  if (existing) {
    const val = await api("GET", `${base}/${name}/versions/latest:access`).catch(() => null);
    const isPlaceholder = val && Buffer.from(val.payload.data, "base64").toString() === "unset";
    if (!(isPlaceholder && name === "ANTHROPIC_API_KEY")) { log(`${name} is already stored.`); return; }
  }
  const value = await getValue();
  await api("POST", `${base}?secretId=${name}`, { replication: { automatic: {} } }, { allow409: true });
  await api("POST", `${base}/${name}:addVersion`, { payload: { data: Buffer.from(value).toString("base64") } });
  log(`${name} stored securely.`);
}
await ensureSecret("ANTHROPIC_API_KEY", async () => {
  console.log("\n   Paste your Anthropic API key and press Enter. It starts with sk-ant- and stays hidden while you paste.");
  console.log("   No key yet? Create one at https://console.anthropic.com/settings/keys\n");
  for (;;) {
    const k = await hidden("   Anthropic API key: ");
    if (k.startsWith("sk-ant-") && k.length > 30) return k;
    console.log("   That doesn't look like an Anthropic key (it starts with sk-ant-). Try again.");
  }
});
for (const s of ["PAYSTACK_SECRET_KEY", "RESEND_API_KEY", "SENTRY_DSN"]) await ensureSecret(s, async () => "unset");

// 5. Deployer account for GitHub, linked without keys (Workload Identity Federation)
const SA_ID = "github-deployer";
const SA = `${SA_ID}@${projectId}.iam.gserviceaccount.com`;
await api("POST", `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`, { accountId: SA_ID, serviceAccount: { displayName: "GitHub deploys (DocInsight)" } }, { allow409: true });
const poolBase = `https://iam.googleapis.com/v1/projects/${projectId}/locations/global/workloadIdentityPools`;
const pool = await api("GET", `${poolBase}/github`, null, { allow404: true });
if (!pool) { const op = await api("POST", `${poolBase}?workloadIdentityPoolId=github`, { displayName: "GitHub" }, { allow409: true }); if (op?.name) await waitOp(`https://iam.googleapis.com/v1/${op.name}`, "Creating the GitHub link").catch(() => sleep(5000)); }
else if (pool.state === "DELETED") await api("POST", `${poolBase}/github:undelete`, {});
const prov = await api("GET", `${poolBase}/github/providers/github`, null, { allow404: true });
if (!prov) {
  const op = await api("POST", `${poolBase}/github/providers?workloadIdentityPoolProviderId=github`, {
    displayName: "GitHub Actions", oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
    attributeMapping: { "google.subject": "assertion.sub", "attribute.repository": "assertion.repository", "attribute.ref": "assertion.ref" },
    attributeCondition: `assertion.repository == '${repo}'`,
  }, { allow409: true });
  if (op?.name) await waitOp(`https://iam.googleapis.com/v1/${op.name}`, "Creating the GitHub link").catch(() => sleep(5000));
}
// Only this repository may act as the deployer
const saPolicyUrl = `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${SA}`;
for (let i = 0; i < 5; i++) {
  try {
    const p = await api("POST", `${saPolicyUrl}:getIamPolicy`, {});
    const member = `principalSet://iam.googleapis.com/projects/${num}/locations/global/workloadIdentityPools/github/attribute.repository/${repo}`;
    p.bindings = p.bindings || [];
    let b = p.bindings.find((x) => x.role === "roles/iam.workloadIdentityUser");
    if (!b) { b = { role: "roles/iam.workloadIdentityUser", members: [] }; p.bindings.push(b); }
    if (!b.members.includes(member)) { b.members.push(member); await api("POST", `${saPolicyUrl}:setIamPolicy`, { policy: p }); }
    break;
  } catch (e) { if (i === 4) throw e; await sleep(8000); }
}

// 6. Project permissions
const computeSA = `serviceAccount:${num}-compute@developer.gserviceaccount.com`;
const deployer = `serviceAccount:${SA}`;
const want = [
  ...["roles/firebase.admin", "roles/cloudfunctions.admin", "roles/run.admin", "roles/iam.serviceAccountUser", "roles/artifactregistry.admin",
    "roles/cloudbuild.builds.editor", "roles/secretmanager.admin", "roles/serviceusage.serviceUsageAdmin", "roles/documentai.admin", "roles/aiplatform.user",
    "roles/firebaseauth.admin", "roles/cloudscheduler.admin", "roles/cloudtasks.admin", "roles/datastore.owner", "roles/datastore.indexAdmin",
    "roles/storage.admin", "roles/logging.viewer", "roles/resourcemanager.projectIamAdmin", "roles/eventarc.admin", "roles/pubsub.admin"].map((r) => [r, deployer]),
  ["roles/cloudtasks.enqueuer", computeSA], ["roles/iam.serviceAccountUser", computeSA], ["roles/documentai.apiUser", computeSA], ["roles/aiplatform.user", computeSA],
  ["roles/secretmanager.secretAccessor", computeSA], ["roles/firebaserules.firestoreServiceAgent", `serviceAccount:service-${num}@gcp-sa-firebasestorage.iam.gserviceaccount.com`],
];
let wantNow = want;
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    const policy = await api("POST", `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } });
    let changed = false;
    for (const [role, member] of wantNow) {
      let b = policy.bindings.find((x) => x.role === role && !x.condition);
      if (!b) { b = { role, members: [] }; policy.bindings.push(b); }
      if (!b.members.includes(member)) { b.members.push(member); changed = true; }
    }
    if (changed) await api("POST", `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:setIamPolicy`, { policy });
    break;
  } catch (e) {
    if (attempt === 4) throw e;
    // A Google-managed account that doesn't exist yet: skip it, Claude adds it after the first deploy
    const missing = /(serviceAccount:[^\s]+) does not exist/.exec(e.message)?.[1];
    if (missing) wantNow = wantNow.filter(([, m]) => m !== missing);
    log("Waiting for Google to finish creating accounts…"); await sleep(20000);
  }
}
log("Permissions are set. GitHub can now deploy DocInsight without any stored keys.");
