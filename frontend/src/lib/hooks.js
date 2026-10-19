'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Ambil data lalu (opsional) polling berkala.
 * - loading hanya true pada pemuatan pertama / saat deps berubah (polling tidak memicu spinner).
 * - reload() memuat ulang manual.
 */
export function usePolling(fetcher, intervalMs = 0, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true, fetchedAt: null });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const data = await fetcherRef.current();
        if (alive) setState({ data, error: null, loading: false, fetchedAt: Date.now() });
      } catch (error) {
        if (alive) setState((s) => ({ ...s, error, loading: false }));
      }
    };
    setState((s) => ({ ...s, loading: true }));
    run();
    const id = intervalMs ? setInterval(run, intervalMs) : null;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, intervalMs]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Detik yang terus berkurang tiap detik, dimulai dari initialSeconds pada saat `anchor` (ms). */
export function useCountdown(initialSeconds, anchor) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [initialSeconds, anchor]);
  if (initialSeconds === null || initialSeconds === undefined) return null;
  return Math.max(0, Math.round(initialSeconds - (now - (anchor || now)) / 1000));
}

/** Menunda nilai (untuk kotak pencarian). */
export function useDebounced(value, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}
