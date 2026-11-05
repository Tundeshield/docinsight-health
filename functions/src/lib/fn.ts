// Ordinary calls share one Cloud Function ("api"), so there is one warm container instead of
// dozens of cold ones: important on slow networks. AI answers, search, background tasks,
// schedules and webhooks stay separate.
import { onCall, HttpsError, type CallableRequest, type CallableOptions } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { ANTHROPIC_API_KEY, PAYSTACK_SECRET_KEY, RESEND_API_KEY } from "./params";

export type Handler = ((req: CallableRequest<Record<string, unknown>>) => Promise<unknown>) & { __callable: true; opts: CallableOptions };

export function callable<T = unknown>(handler: (req: CallableRequest<Record<string, unknown>>) => Promise<T>, opts: CallableOptions = {}): Handler {
  return Object.assign(handler, { __callable: true as const, opts });
}

export async function runHandler(name: string, h: Handler, req: CallableRequest<Record<string, unknown>>) {
  try {
    return await h(req);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error("call failed", { action: name, err: (e as Error).message, stack: (e as Error).stack });
    throw new HttpsError("internal", "Something went wrong on our side. Try again in a moment.");
  }
}

/** A standalone function for a handler that needs its own memory, secrets or streaming. */
export function standalone(h: Handler, name: string) {
  return onCall({ region: "europe-west1", memory: "512MiB", timeoutSeconds: 120, maxInstances: 20, ...h.opts, secrets: [RESEND_API_KEY, ...((h.opts.secrets as never[]) ?? [])] }, (req) => runHandler(name, h, req as CallableRequest<Record<string, unknown>>));
}

export function dispatcher(handlers: Record<string, Handler>) {
  return onCall({ region: "europe-west1", memory: "1GiB", timeoutSeconds: 300, maxInstances: 30, concurrency: 40, minInstances: 0, secrets: [RESEND_API_KEY, PAYSTACK_SECRET_KEY, ANTHROPIC_API_KEY] }, async (req) => {
    const r = req as CallableRequest<Record<string, unknown>>;
    const action = String(r.data?.action ?? "");
    const h = Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null;
    if (!h) throw new HttpsError("not-found", `Unknown action "${action}".`);
    const payload = (r.data?.payload ?? {}) as Record<string, unknown>;
    return runHandler(action, h, { ...r, data: payload });
  });
}
