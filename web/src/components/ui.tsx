import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "brand" | "danger" | "ghost"; size?: "sm" | "md"; busy?: boolean };
export function Button({ variant = "default", size = "md", busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || busy} className={cx("btn", variant !== "default" && `btn-${variant}`, size === "sm" && "btn-sm", className)}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Spinner({ label = "Loading…", className }: { label?: string; className?: string }) {
  return <div role="status" className={cx("flex items-center gap-2 py-8 text-ink-2", className)}><Loader2 className="h-5 w-5 animate-spin" aria-hidden />{label}</div>;
}

export function Field({ label, help, error, children, className }: { label: ReactNode; help?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx("mb-4", className)}>
      <label htmlFor={id} className="label">{label}</label>
      {children(id)}
      {help && <span className="help">{help}</span>}
      {error && <span className="mt-1 block text-sm font-bold text-warn">{error}</span>}
    </div>
  );
}

export function TextField({ label, help, error, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; help?: ReactNode; error?: string | null }) {
  return <Field label={label} help={help} error={error} className={className}>{(id) => <input id={id} className="input" {...p} />}</Field>;
}
export function TextArea({ label, help, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; help?: ReactNode }) {
  return <Field label={label} help={help} className={className}>{(id) => <textarea id={id} className="input min-h-[96px]" {...p} />}</Field>;
}
export function SelectField({ label, help, options, className, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; help?: ReactNode; options: { value: string; label: string }[] }) {
  return (
    <Field label={label} help={help} className={className}>
      {(id) => <select id={id} className="input" {...p}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
    </Field>
  );
}
export function Check({ label, help, checked, onChange, disabled }: { label: ReactNode; help?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="mb-3 flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-[15px]"><span className="font-bold">{label}</span>{help && <span className="block text-sm text-ink-2">{help}</span>}</label>
    </div>
  );
}

export function Banner({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "ok"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div role={tone === "warn" ? "alert" : "status"} className={cx("mb-4 flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3", tone === "warn" ? "border-warn/40 bg-warn-bg" : tone === "ok" ? "border-ok/30 bg-ok-bg" : "border-rule bg-soft")}>
      <Icon className={cx("mt-0.5 h-5 w-5 shrink-0", tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink-2")} aria-hidden />
      <div className="min-w-0 flex-1 text-[15px]">
        {title && <div className="font-bold">{title}</div>}
        {children}
      </div>
      {action && <div className="w-full sm:w-auto">{action}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p role="alert" className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-[15px] font-bold text-warn">{error}</p>;
}

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card px-5 py-10 text-center">
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-ink-2">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function PageHead({ title, sub, back, actions }: { title: ReactNode; sub?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  return (
    <header className="mb-5">
      {back && <Link to={back.to} className="mb-2 inline-block text-sm font-bold text-ink-2 hover:text-ink">← {back.label}</Link>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="h1 break-words">{title}</h1>
          {sub && <div className="mt-1 text-ink-2">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not([data-close])")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        className={cx("flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
          <h2 className="h2">{title}</h2>
          <button data-close className="btn btn-ghost btn-sm -mr-2" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A destructive action that asks once before running. */
export function ConfirmButton({ children, confirm, onConfirm, variant = "default", size = "sm", title = "Are you sure?", confirmLabel = "Yes, continue" }: { children: ReactNode; confirm: ReactNode; onConfirm: () => Promise<unknown> | void; variant?: BtnProps["variant"]; size?: "sm" | "md"; title?: string; confirmLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => { setErr(null); setOpen(true); }}>{children}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" busy={busy} onClick={async () => { setBusy(true); setErr(null); try { await onConfirm(); setOpen(false); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{confirmLabel}</Button></>}>
        <ErrorText error={err} />
        <div className="text-[15px]">{confirm}</div>
      </Modal>
    </>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-rule">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[15px] font-bold", value === t.value ? "border-brand text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    approved: ["Live", "bg-ok-bg text-ok"], published: ["Live", "bg-ok-bg text-ok"], in_review: ["In review", "bg-soft text-ink"], draft: ["Draft", "bg-soft text-ink-2"],
    archived: ["Archived", "bg-soft text-ink-2"], processing: ["Processing", "bg-soft text-ink-2"], uploading: ["Uploading", "bg-soft text-ink-2"],
    changes_requested: ["Changes requested", "bg-warn-bg text-warn"], rejected: ["Rejected", "bg-warn-bg text-warn"], superseded: ["Older version", "bg-soft text-ink-2"],
    active: ["Active", "bg-ok-bg text-ok"], pending_payment: ["Pending payment", "bg-soft text-ink"], past_due: ["Past due", "bg-warn-bg text-warn"],
    restricted: ["Restricted", "bg-warn-bg text-warn"], suspended: ["Suspended", "bg-warn-bg text-warn"], cancelled: ["Cancelled", "bg-soft text-ink-2"],
    open: ["Unpaid", "bg-warn-bg text-warn"], paid: ["Paid", "bg-ok-bg text-ok"], void: ["Void", "bg-soft text-ink-2"], pending: ["Pending", "bg-soft text-ink"],
    deactivated: ["Deactivated", "bg-soft text-ink-2"], overdue: ["Review overdue", "bg-warn-bg text-warn"],
  };
  const [label, cls] = map[status] ?? [status, "bg-soft text-ink-2"];
  return <span className={cx("pill", cls)}>{label}</span>;
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-sm text-ink-2">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[13px] text-ink-2">{sub}</div>}
    </div>
  );
}

/** Small toast for confirmations. */
let pushToast: ((m: string) => void) | null = null;
export const toast = (m: string) => pushToast?.(m);
export function Toaster() {
  const [msgs, setMsgs] = useState<{ id: number; m: string }[]>([]);
  useEffect(() => {
    pushToast = (m) => { const id = Date.now() + Math.random(); setMsgs((x) => [...x, { id, m }]); setTimeout(() => setMsgs((x) => x.filter((y) => y.id !== id)), 4000); };
    return () => { pushToast = null; };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {msgs.map((t) => <div key={t.id} className="rounded-lg bg-ink px-4 py-2.5 text-[15px] font-bold text-page shadow-lg">{t.m}</div>)}
    </div>
  );
}
