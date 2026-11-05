import { useEffect, useRef, useState } from "react";
import { onSnapshot, type DocumentReference, type Query, type DocumentData } from "firebase/firestore";

export type Loaded<T> = { data: T; loading: false; error: null } | { data: T | undefined; loading: true; error: null } | { data: undefined; loading: false; error: Error };

/** Live document. undefined while loading, null when missing. */
export function useDoc<T = DocumentData>(ref: DocumentReference | null, deps: unknown[] = []): { data: (T & { id: string }) | null | undefined; error: Error | null } {
  const [state, set] = useState<{ data: (T & { id: string }) | null | undefined; error: Error | null }>({ data: undefined, error: null });
  useEffect(() => {
    if (!ref) { set({ data: null, error: null }); return; }
    set((s) => ({ data: s.data, error: null }));
    return onSnapshot(ref, (s) => set({ data: s.exists() ? ({ id: s.id, ...s.data() } as T & { id: string }) : null, error: null }), (e) => set({ data: null, error: e }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.path, ...deps]);
  return state;
}

/** Live query. */
export function useQuery<T = DocumentData>(q: Query | null, key: string): { data: (T & { id: string })[] | undefined; error: Error | null } {
  const [state, set] = useState<{ data: (T & { id: string })[] | undefined; error: Error | null }>({ data: undefined, error: null });
  useEffect(() => {
    if (!q) { set({ data: [], error: null }); return; }
    set({ data: undefined, error: null });
    return onSnapshot(q, (s) => set({ data: s.docs.map((d) => ({ id: d.id, ...d.data() }) as T & { id: string }), error: null }), (e) => set({ data: [], error: e }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** Runs an async action, exposing busy/error state. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = async (...a: A): Promise<R | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(...a); }
    catch (e) { if (alive.current) setError((e as Error).message); return undefined; }
    finally { if (alive.current) setBusy(false); }
  };
  return { run, busy, error, setError };
}

export function useOnline(): boolean {
  const [on, set] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => set(true), down = () => set(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return on;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, set] = useState(value);
  useEffect(() => { const t = setTimeout(() => set(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
