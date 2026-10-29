# DocInsight Health

Answers from a hospital's own protocols, equipment manuals, policies and system guides, with every point linked to its source. Built by Avelon Technologies. Launch market: Lagos.

## How it fits together

```
web/          React app (Vite): public website, paywall and the product → Netlify
functions/    Cloud Functions (Node 20)
  src/orgs.js       hospital registration, invite links, roles
  src/library.js    upload → ingest → background OCR → searchable sections
  src/ask.js        the answering agent (streams answers with citations)
  src/billing.js    Paystack subscriptions
  src/plans.js      the billing feature flag and plan limits
  scripts/admin.mjs Avelon admin commands (flags, founding hospitals, plans)
firestore.rules / storage.rules   each hospital can only see its own data
```

**Data model.** `orgs/{orgId}` holds the hospital, with `members`, `sources` (documents), `invites`, `usage/{yyyy-mm}` and `questions` (audit log) beneath it. Original files live in Storage under `orgs/{orgId}/uploads/`, and the processed sections under `orgs/{orgId}/sources/` (server-only).

**Documents.** A library manager uploads a file. `ingestTask` extracts text page by page. Pages without text (scans, photos) are queued for `ocrTask`, which renders them, splits tall pages into overlapping halves, and has Claude transcribe them 4 pages at a time, marking uncertain text as `[unclear: …]`. When every page is done, the document becomes searchable. Rate limits and outages are retried automatically with backoff.

**Answers.** `ask` runs a search-and-read agent over the hospital's sections (BM25 keyword search, English and French) and streams the answer. Every claim cites a section; references to sections that don't exist are dropped and reported.

## Website and paywall

- `/` is the public website (what DocInsight does, safety, pricing, FAQ).
- `/signup` and `/login` create accounts; a new user registers their hospital.
- `/app` is the product. A hospital needs an **active plan** to get past the paywall; staff of an unpaid hospital are told to ask their manager.
- Until a payment provider is chosen, checkout is a **test checkout** (`paymentProvider: "dummy"`): no card details are collected and no money moves. "Simulate successful payment" activates the plan for 30 days; "Simulate failed payment" shows the failure path. Managers can cancel from Billing.
- When you choose a provider, switch with `node scripts/admin.mjs provider paystack` (Paystack is already wired) and the test checkout stops working.

## The billing feature flag

The paywall is **on** by default. Pilot hospitals you want to keep free are marked `exempt`: they skip the paywall and get fair-use caps (3,000 questions and 3,000 scanned pages a month, adjustable). `billing off` puts every hospital on the free pilot.

```bash
cd functions
node scripts/admin.mjs status                    # flags + every hospital
node scripts/admin.mjs billing on                # switch pricing on for everyone...
node scripts/admin.mjs exempt <orgId> on         # ...except founding hospitals you keep free
node scripts/admin.mjs pilot-limits 5000 3000    # change pilot caps ("none" = no cap)
node scripts/admin.mjs plan <orgId> enterprise   # put an invoiced hospital on Enterprise
node scripts/admin.mjs plan-code clinic PLN_xxx  # link a plan to its Paystack plan code
```

After a pilot hospital registers, run `exempt <orgId> on` so they never see the paywall (find the ID with `status`).

## Setting it up

### 1. Accounts you need
- **Firebase** project on the **Blaze** (pay-as-you-go) plan. Cloud Functions and Cloud Tasks require it; costs at pilot scale are small.
- **Anthropic API key** from the Claude Console (console.anthropic.com). Add a payment method and set a monthly spend limit.
- **Paystack** account (only needed when you switch billing on).

### 2. Create the Firebase project
1. In the Firebase console, create a project. Choose **europe-west1** as the location for Firestore and Storage (same region as the functions).
2. Enable **Authentication → Email/Password**.
3. Create **Firestore** (production mode) and **Storage**.
4. Add a **Web app** and copy its config into `web/.env` (see `web/.env.example`).
5. In Google Cloud console for the same project, enable the **Cloud Tasks API**.

### 3. Install and deploy
```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc        # put your project ID in it
cd functions && npm install && npm test   # pipeline smoke tests
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set PAYSTACK_SECRET_KEY   # any placeholder (e.g. "unset") until Paystack is chosen
cd .. && firebase deploy --only firestore,storage,functions
```
Deploying prints the URL of the `ask` function. Put it in `web/.env` as `VITE_ASK_URL`, and set `APP_URL` for the functions to your site address (`firebase functions:config` is not used; set it in `functions/.env` as `APP_URL=https://your-site.netlify.app` and redeploy functions).

The website deploys on **Netlify** from GitHub (settings come from `netlify.toml`). In Netlify → Site configuration → Environment variables, add every `VITE_…` value from `web/.env.example`. Each push to `main` redeploys. Add your Netlify address (or custom domain) under Firebase Authentication → Settings → Authorized domains, otherwise sign-in fails.

The first time you deploy Storage rules, Firebase asks to let Storage read Firestore (the rules check membership). Accept it.

If uploads stay on "Processing…", grant the functions' service account the **Cloud Tasks Enqueuer** role in Google Cloud IAM.

### 4. Paystack (when you're ready to take real payments)
1. In Paystack, create plans (Clinic, Hospital) with monthly intervals and naira amounts.
2. Link each: `node scripts/admin.mjs plan-code clinic PLN_xxx`.
3. Set the webhook URL in Paystack → Settings → API Keys & Webhooks to the deployed `paystackWebhook` URL.
4. Set the real secret: `firebase functions:secrets:set PAYSTACK_SECRET_KEY`, then redeploy functions.
5. `node scripts/admin.mjs provider paystack`.

## Running locally
```bash
firebase emulators:start          # functions, Firestore, Auth, Storage
cd web && VITE_USE_EMULATORS=true npm run dev   # http://localhost:5173
```
Cloud Tasks don't run in the emulator, so local uploads stay queued; test document processing on a deployed project.

## Before the first hospital
- [ ] Set a monthly spend limit on the Anthropic account and a budget alert in Google Cloud.
- [ ] Terms of service and privacy policy positioning DocInsight as a reference aid, not clinical advice; a data processing agreement for hospitals; Nigeria Data Protection Act review by a lawyer.
- [ ] Decide how long to keep the question audit log (`orgs/*/questions`), since staff may type sensitive details despite the warning.
- [ ] Test with each pilot hospital's real documents, including at least one scanned protocol, and have a clinician check answers before staff rely on them.
- [ ] Restrict the `ask` function's CORS to your site address once the domain is final.

## Costs to watch
Roughly $0.05–0.15 of Claude usage per question and $0.015 per scanned page at Sonnet-class pricing; check current rates at docs.claude.com. Usage per hospital is recorded in `orgs/{orgId}/usage/{month}`, including token counts.
