"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const volatileStorage = new Map<string, string>();
const STORAGE_EVENT = "atlas:preferences";

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key) volatileStorage.delete(event.key);
    else volatileStorage.clear();
    listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(STORAGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STORAGE_EVENT, listener);
  };
}

export function useLocalStorage<T>(key: string, fallback: T, validate: (value: unknown) => value is T) {
  const getSnapshot = useCallback(() => {
    try { return volatileStorage.get(key) ?? localStorage.getItem(key) ?? null; }
    catch { return volatileStorage.get(key) ?? null; }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const value = useMemo(() => {
    if (!raw) return fallback;
    try {
      const candidate: unknown = JSON.parse(raw);
      return validate(candidate) ? candidate : fallback;
    } catch { return fallback; }
  }, [raw, fallback, validate]);
  const setValue = useCallback((next: T | ((current: T) => T)) => {
    const result = typeof next === "function" ? (next as (current: T) => T)(value) : next;
    const serialized = JSON.stringify(result);
    try { localStorage.setItem(key, serialized); volatileStorage.delete(key); } catch { volatileStorage.set(key, serialized); }
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }, [key, value]);
  return [value, setValue] as const;
}
