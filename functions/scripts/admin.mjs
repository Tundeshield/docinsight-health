// Avelon admin tasks. Needs a service-account key:
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
//   cd functions && node scripts/admin.mjs <command>
//
// Commands:
//   status                         show flags and every hospital
//   billing on|off                 the paywall (default on; off = everyone on the free pilot)
//   provider dummy|paystack        how plans are paid: test checkout, or real Paystack
//   exempt <orgId> on|off          pilot / founding hospital: free, no paywall
//   pilot-limits <questions> <ocrPages>   fair-use caps while on the pilot (use "none" for no cap)
//   plan <orgId> <clinic|hospital|enterprise>   set a hospital's plan by hand (e.g. invoiced enterprise)
//   plan-code <clinic|hospital> <PLN_xxx>       link a plan to its Paystack plan code
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const [cmd, a, b, c] = process.argv.slice(2);
const flags = db.doc("config/flags");
const cap = (v) => (v === "none" ? null : Number(v));

switch (cmd) {
  case "status": {
    const f = await flags.get(); console.log("Flags:", f.exists ? f.data() : "(defaults: paywall on, test checkout)");
    const orgs = await db.collection("orgs").get();
    for (const o of orgs.docs) { const d = o.data(); console.log(`- ${o.id}  ${d.name}  plan=${d.plan} exempt=${!!d.billingExempt} billing=${d.billing?.status}`); }
    break;
  }
  case "billing": await flags.set({ billingEnabled: a === "on" }, { merge: true }); console.log(`Billing is now ${a === "on" ? "ON" : "OFF (free pilot)"}.`); break;
  case "provider": await flags.set({ paymentProvider: a === "paystack" ? "paystack" : "dummy" }, { merge: true }); console.log(`Payments: ${a === "paystack" ? "Paystack" : "test checkout"}.`); break;
  case "exempt": await db.doc(`orgs/${a}`).update({ billingExempt: b === "on" }); console.log(`${a} exempt: ${b === "on"}`); break;
  case "pilot-limits": await flags.set({ pilotLimits: { questions: cap(a), ocrPages: cap(b), documents: null } }, { merge: true }); console.log("Pilot limits updated."); break;
  case "plan": await db.doc(`orgs/${a}`).update({ plan: b, "billing.status": b === "enterprise" ? "active" : "none" }); console.log(`${a} plan: ${b}`); break;
  case "plan-code": await db.doc("config/plans").set({ [a]: { paystackPlan: b } }, { merge: true }); console.log(`${a} → ${b}`); break;
  default: console.log("Commands: status | billing on|off | provider dummy|paystack | exempt <orgId> on|off | pilot-limits <q> <pages> | plan <orgId> <plan> | plan-code <plan> <code>");
}
process.exit(0);
