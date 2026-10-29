import { Link } from "react-router-dom";
import { useSession } from "../lib/session.jsx";
import { CATS } from "../lib/constants.js";

const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || "";

const PLANS = [
  { name: "Clinic", price: "$149", per: "/month", for: "Private clinics and small hospitals", items: ["Up to 50 documents", "750 questions a month", "300 scanned pages a month", "Unlimited staff"] },
  { name: "Hospital", price: "$499", per: "/month", for: "Mid-size private hospitals", items: ["Unlimited documents", "3,000 questions a month", "2,000 scanned pages a month", "Unlimited staff, usage reports"], featured: true },
  { name: "Enterprise", price: "From $1,500", per: "/month", for: "Teaching hospitals, groups and HMOs", items: ["Custom volumes", "Sign-in through your own systems", "Data residency options", "Dedicated onboarding"], contact: true }
];

const ASKED = [
  ["Nurses and midwives", ["What's our escalation if NEWS2 is 7 at night?", "How often do I repeat observations after a positive sepsis screen?"]],
  ["Biomedical engineers", ["The VP-300 shows E-21. Can I clear it?", "What's the cleaning procedure between patients?"]],
  ["Admin and billing", ["Does CareShield need pre-authorisation for a CT scan?", "How long do we have to submit a claim?"]]
];

const FAQ = [
  ["Does DocInsight give clinical advice?", "No. It answers only from the documents your hospital adds and links every point to its source. If your documents don't cover a question, it says so instead of guessing. It's a reference aid; professional judgement and your escalation procedures always apply."],
  ["Our protocols are old scanned copies. Will that work?", "Yes. DocInsight reads scanned PDFs and phone photos of pages. It copies doses and numbers exactly, marks anything it can't read with certainty, and warns staff to check those parts against the paper original."],
  ["Who can see our documents?", "Only people you invite to your hospital's library. Each hospital's documents are kept separate, and library managers decide who joins."],
  ["Should staff type patient details?", "No, and they don't need to. DocInsight answers questions about procedures and equipment, and warns anyone who types something that looks like a name or record number."],
  ["Does it work in French?", "Yes. Staff can ask in English or French and get the answer in the language they asked in, even when the source document is in the other language."],
  ["Can we try it before paying?", `We run pilots with a small number of hospitals in Lagos. ${CONTACT ? "Email us to ask about a pilot." : "Contact Avelon Technologies to ask about a pilot."}`]
];

function Specimen() {
  return (
    <figure className="specimen" aria-label="Example of a DocInsight answer">
      <div className="sp-q">The VP-300 pump shows error E-21. What should I do?</div>
      <div className="sp-row">
        <div className="sp-a">
          <p>Stop the infusion and take the pump out of use. Don't try to clear the error by restarting it.<sup className="c cat-equipment">1</sup></p>
          <ol>
            <li>Label it DO NOT USE and keep the giving set attached.<sup className="c cat-policy">2</sup></li>
            <li>Get a spare pump from the 2nd floor store, cabinet B.<sup className="c cat-protocol">3</sup></li>
            <li>Call biomedical engineering on ext. 2270 and complete an incident form within 24 hours.<sup className="c cat-policy">2</sup></li>
          </ol>
        </div>
        <div className="sp-notes">
          <div className="cat-equipment"><b>1</b>VP-300 operator manual<span>Error codes</span></div>
          <div className="cat-policy"><b>2</b>Equipment fault policy<span>Reporting</span></div>
          <div className="cat-protocol"><b>3</b>ICU pump quick guide<span>Pannes et codes</span></div>
        </div>
      </div>
      <figcaption>An answer drawn from three of a hospital's documents, one of them in French. Each number opens the exact section.</figcaption>
    </figure>
  );
}

export default function Landing() {
  const { user } = useSession();
  return (
    <div className="site">
      <header className="site-nav">
        <a href="/" className="brand"><span className="cross" aria-hidden="true" />DocInsight Health</a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          {user ? <Link className="btn primary small" to="/app">Open DocInsight</Link> : <><Link to="/login">Sign in</Link><Link className="btn primary small" to="/signup">Get started</Link></>}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>The answer is already in your protocols.</h1>
          <p>DocInsight Health reads your hospital's protocols, equipment manuals and policies, so staff can ask a question on shift and get the steps, with every point linked to the page it came from.</p>
          <div className="row-btns">
            <Link className="btn primary" to={user ? "/app" : "/signup"}>{user ? "Open DocInsight" : "Register your hospital"}</Link>
            <a className="btn" href="#pricing">See pricing</a>
          </div>
        </div>
        <Specimen />
      </section>

      <section className="band">
        <div className="wrap">
          <h2>Questions asked on every shift</h2>
          <p className="section-lede">New staff, locums and night teams lose time hunting through binders and shared drives, or wait for the one colleague who knows. DocInsight answers the way that colleague would, from your own documents.</p>
          <div className="asked">
            {ASKED.map(([who, qs]) => <div key={who}><h3>{who}</h3>{qs.map((q) => <p key={q}>“{q}”</p>)}</div>)}
          </div>
        </div>
      </section>

      <section className="wrap" id="how">
        <h2>How it works</h2>
        <ol className="steps">
          <li><h3>Add your documents</h3><p>Upload PDFs, saved web pages, scanned copies or phone photos of pages. Add the version and review date so staff know what's current.</p></li>
          <li><h3>Invite your team</h3><p>Share an invite link in your ward or department WhatsApp group. Library managers control who can add documents.</p></li>
          <li><h3>Ask in plain language</h3><p>Staff ask in English or French and get step-by-step answers, each point linked to the section it came from.</p></li>
        </ol>
        <div className="kinds">
          {Object.entries(CATS).map(([k, c]) => <div key={k} className={`cat-${k}`}><strong>{c.label}</strong>{c.hint}</div>)}
        </div>
      </section>

      <section className="band">
        <div className="wrap split">
          <h2>It would rather say “not in your documents” than guess.</h2>
          <ul className="safety">
            <li><strong>Every point is cited.</strong> Staff can open the exact section, or the original page of the PDF.</li>
            <li><strong>Doses and numbers are copied exactly.</strong> It never calculates a patient-specific dose.</li>
            <li><strong>Unclear scans are flagged.</strong> If a number on a faded page can't be read with certainty, it shows both readings and asks staff to check the paper.</li>
            <li><strong>Out-of-date documents are called out.</strong> Answers warn when a cited document is past its review date.</li>
            <li><strong>Local protocol comes first.</strong> When your protocol and a manufacturer's manual disagree, it points out the conflict and suggests who to escalate to.</li>
          </ul>
        </div>
      </section>

      <section className="wrap" id="pricing">
        <h2>Pricing</h2>
        <p className="section-lede">One price for the whole facility. Every plan includes unlimited staff, every document type and reading of scanned documents.</p>
        <div className="site-plans">
          {PLANS.map((p) => (
            <div key={p.name} className={`site-plan${p.featured ? " featured" : ""}`}>
              <h3>{p.name}</h3>
              <div className="price">{p.price}<span>{p.per}</span></div>
              <p className="muted">{p.for}</p>
              <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
              {p.contact ? <a className="btn" href={CONTACT ? `mailto:${CONTACT}?subject=DocInsight%20Enterprise` : "#faq"}>Talk to us</a> : <Link className={`btn${p.featured ? " primary" : ""}`} to={user ? "/app" : "/signup"}>Get started</Link>}
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 15, marginTop: 16 }}>Need help collecting, scanning and labelling your binders? We offer a one-time setup service. Prices are charged in naira at the current rate.</p>
      </section>

      <section className="band" id="faq">
        <div className="wrap">
          <h2>Questions</h2>
          <div className="faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
        </div>
      </section>

      <section className="wrap cta">
        <h2>Put your protocols within reach of every shift.</h2>
        <Link className="btn primary" to={user ? "/app" : "/signup"}>{user ? "Open DocInsight" : "Register your hospital"}</Link>
      </section>

      <footer className="site-foot">
        <span className="brand"><span className="cross" aria-hidden="true" />DocInsight Health</span>
        <span>A reference aid, not clinical advice. By Avelon Technologies, Lagos.{CONTACT && <> <a href={`mailto:${CONTACT}`}>{CONTACT}</a></>}</span>
      </footer>
    </div>
  );
}
