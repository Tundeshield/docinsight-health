import { httpsCallable } from "firebase/functions";
import { functions, auth, ASK_URL } from "../firebase.js";

/** Calls a Cloud Function and returns its data; errors carry a readable message. */
export async function call(name, data) {
  try { return (await httpsCallable(functions, name, { timeout: 120000 })(data)).data; }
  catch (e) {
    const msg = e?.message && !/^(internal|INTERNAL)$/.test(e.message) ? e.message : "Something went wrong. Try again in a moment.";
    const err = new Error(msg); err.code = e?.code; err.details = e?.details; throw err;
  }
}

/**
 * Streams an answer. Handlers: onStatus(text), onDelta(text), onReset(), onDone(payload).
 * Returns when the stream ends; throws Error(message) on failure.
 */
export async function askStream({ orgId, question, role, history, signal }, h) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(ASK_URL, { method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ orgId, question, role, history }) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || "DocInsight couldn't answer right now. Try again in a moment."); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = (block.match(/^event: (.+)$/m) || [])[1]; const raw = (block.match(/^data: (.+)$/m) || [])[1];
      if (!ev || !raw) continue;
      const data = JSON.parse(raw);
      if (ev === "status") h.onStatus?.(data.text);
      else if (ev === "delta") h.onDelta?.(data.text);
      else if (ev === "reset") h.onReset?.();
      else if (ev === "done") h.onDone?.(data);
      else if (ev === "error") throw new Error(data.message);
    }
  }
}
