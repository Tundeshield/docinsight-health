// Error reporting. Sentry loads only when a DSN is configured, so it adds nothing to the
// download otherwise. Personal data is never attached: no question text, no document text.
export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  const s = document.createElement("script");
  s.src = "https://browser.sentry-cdn.com/8.55.0/bundle.min.js";
  s.crossOrigin = "anonymous";
  s.onload = () => {
    const S = (window as unknown as { Sentry?: { init: (o: Record<string, unknown>) => void } }).Sentry;
    S?.init({
      dsn, tracesSampleRate: 0, sendDefaultPii: false,
      beforeSend(event: { request?: { data?: unknown }; breadcrumbs?: unknown }) { if (event.request) delete event.request.data; delete event.breadcrumbs; return event; },
    });
  };
  document.head.appendChild(s);
}
