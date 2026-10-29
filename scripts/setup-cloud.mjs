// Creates the Google Cloud pieces DocInsight needs, using the Firebase CLI's sign-in.
// Usage: node scripts/setup-cloud.mjs <projectId> <path to firebase-tools>
// Safe to run more than once: it only creates what's missing.
import { createRequire } from "node:module";
import readline from "node:readline";

const [projectId, toolsDir] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const auth = require(`${toolsDir}/lib/auth.js`);
const REGION = "europe-west1";
const CONSOLE = `https://console.firebase.google.com/project/${projectId}`;

const log = (m) => console.log(`   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token() {
  const acct = auth.getGlobalDefaultAccount();
  if (!acct?.tokens?.refresh_token) throw new Error("Not signed in to Firebase. Run the setup again.");
  // Same call the Firebase CLI makes. On a failed refresh it returns the refresh token itself, so check for that.
  const t = await auth.getAccessToken(acct.tokens.refresh_token, []);
  if (!t?.access_token || t.access_token === acct.tokens.refresh_token) throw new Error("Your Firebase sign-in has expired. Run: scripts/.tools/node_modules/.bin/firebase login --reauth, then run the setup again.");
  return t.access_token;
}
async function api(method, url, body, { allow404 = false, allow409 = false } = {}) {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", "x-goog-user-project": projectId }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 404 && allow404) return null;
  if (res.status === 409 && allow409) return { alreadyExists: true };
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(`${method} ${url.split("?")[0]} → ${res.status}: ${json.error?.message || text.slice(0, 300)}`), { status: res.status });
  return json;
}
async function waitOp(url, what) {
  for (let i = 0; i < 60; i++) {
    const op = await api("GET", url);
    if (op.done) { if (op.error) throw new Error(`${what} failed: ${op.error.message}`); return op; }
    await sleep(5000);
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

// 1. Services
const SERVICES = ["firestore.googleapis.com", "firebasestorage.googleapis.com", "storage.googleapis.com", "cloudtasks.googleapis.com",
  "cloudfunctions.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com", "run.googleapis.com",
  "eventarc.googleapis.com", "secretmanager.googleapis.com", "cloudresourcemanager.googleapis.com", "iam.googleapis.com",
  "firebaserules.googleapis.com", "identitytoolkit.googleapis.com", "pubsub.googleapis.com"];
log("Switching on Google services…");
const en = await api("POST", `https://serviceusage.googleapis.com/v1/projects/${projectId}/services:batchEnable`, { serviceIds: SERVICES });
if (en.name && !en.done) await waitOp(`https://serviceusage.googleapis.com/v1/${en.name}`, "Switching on services");
log("Services are on.");

// 2. Firestore database
const dbUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
const db = await api("GET", dbUrl, null, { allow404: true });
if (db) log(`Database already exists (${db.locationId}).`);
else {
  log(`Creating the database in ${REGION}…`);
  const op = await api("POST", `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`, { type: "FIRESTORE_NATIVE", locationId: REGION }, { allow409: true });
  if (op?.name) await waitOp(`https://firestore.googleapis.com/v1/${op.name}`, "Creating the database");
  log("Database created.");
}

// 3. Default storage bucket
const bucketUrl = `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`;
let bucket = await api("GET", bucketUrl, null, { allow404: true });
if (bucket?.bucket?.name) log(`File storage already exists (${bucket.bucket.name.split("/").pop()}).`);
else {
  log(`Creating file storage in ${REGION}…`);
  try {
    await api("POST", bucketUrl, { location: REGION, storageClass: "STANDARD" }, { allow409: true });
    for (let i = 0; i < 24 && !bucket?.bucket?.name; i++) { await sleep(5000); bucket = await api("GET", bucketUrl, null, { allow404: true }); }
    if (!bucket?.bucket?.name) throw new Error("not ready yet");
    log("File storage created.");
  } catch (e) {
    console.log(`\n   File storage couldn't be created automatically (${e.message}).\n   Open ${CONSOLE}/storage, click "Get started", choose ${REGION}, then run this setup again.\n`);
    process.exit(1);
  }
}

// 4. Permissions
const proj = await api("GET", `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`);
const num = proj.projectNumber;
const computeSA = `serviceAccount:${num}-compute@developer.gserviceaccount.com`;
const storageAgent = `serviceAccount:service-${num}@gcp-sa-firebasestorage.iam.gserviceaccount.com`;
const want = [
  ["roles/cloudtasks.enqueuer", computeSA],          // functions queue background document processing
  ["roles/iam.serviceAccountUser", computeSA],       // ...and sign those tasks
  ["roles/firebaserules.firestoreServiceAgent", storageAgent] // storage rules check hospital membership in Firestore
];
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const policy = await api("POST", `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } });
    let changed = false;
    for (const [role, member] of want) {
      let b = policy.bindings.find((x) => x.role === role && !x.condition);
      if (!b) { b = { role, members: [] }; policy.bindings.push(b); }
      if (!b.members.includes(member)) { b.members.push(member); changed = true; }
    }
    if (changed) await api("POST", `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:setIamPolicy`, { policy });
    log("Permissions are set.");
    break;
  } catch (e) {
    if (attempt === 2) { log(`Couldn't set permissions automatically (${e.message.slice(0, 160)}). Continuing; Claude can fix this after deploy.`); break; }
    log("Waiting for Google to create the service accounts…"); await sleep(20000);
  }
}

// 5. Secrets
async function ensureSecret(name, getValue) {
  const base = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets`;
  const existing = await api("GET", `${base}/${name}/versions/latest`, null, { allow404: true });
  if (existing) { log(`${name} is already stored.`); return; }
  const value = await getValue();
  await api("POST", `${base}?secretId=${name}`, { replication: { automatic: {} } }, { allow409: true });
  await api("POST", `${base}/${name}:addVersion`, { payload: { data: Buffer.from(value).toString("base64") } });
  log(`${name} stored securely.`);
}
await ensureSecret("ANTHROPIC_API_KEY", async () => {
  console.log("\n   Paste your Anthropic API key and press Enter. It starts with sk-ant- and won't be shown as you paste.");
  console.log("   No key yet? Create one at https://console.anthropic.com/settings/keys\n");
  for (;;) {
    const k = await hidden("   Anthropic API key: ");
    if (k.startsWith("sk-ant-") && k.length > 30) return k;
    console.log("   That doesn't look like an Anthropic key (it should start with sk-ant-). Try again.");
  }
});
await ensureSecret("PAYSTACK_SECRET_KEY", async () => "unset");
log("Cloud setup complete.");
