import { CATEGORY_META } from "@/lib/catalog";
import { isRemovedSampleId } from "@/lib/live-data";
import type { AlertRule, WatchlistEntry } from "@/types";

export const EMPTY_WATCHLIST: WatchlistEntry[] = [];
export const EMPTY_ALERTS: AlertRule[] = [];

/** Removes only retired sample bookmarks; preserves real event and country saves. */
export function liveWatchlist(entries: WatchlistEntry[]): WatchlistEntry[] {
  return entries.filter((entry) => !isRemovedSampleId(entry.id) && !isRemovedSampleId(entry.value));
}

export function purgeRetiredBookmarks(storage: Pick<Storage, "getItem" | "setItem">): boolean {
  const key = "atlas-signal:watchlist:v1";
  const raw = storage.getItem(key);
  if (!raw) return false;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return false; }
  if (!isWatchlist(value)) return false;
  const cleaned = liveWatchlist(value);
  if (cleaned.length === value.length) return false;
  storage.setItem(key, JSON.stringify(cleaned));
  return true;
}

export function isWatchlist(value: unknown): value is WatchlistEntry[] {
  return Array.isArray(value) && value.length <= 500 && value.every((entry) =>
    !!entry && typeof entry === "object" && typeof entry.id === "string" &&
    (entry.kind === "country" || entry.kind === "event") &&
    typeof entry.label === "string" && typeof entry.value === "string"
  );
}

export function isAlertRules(value: unknown): value is AlertRule[] {
  return Array.isArray(value) && value.length <= 100 && value.every((rule) =>
    !!rule && typeof rule === "object" &&
    typeof rule.id === "string" && typeof rule.name === "string" &&
    typeof rule.countryCode === "string" &&
    typeof rule.category === "string" && (rule.category === "all" || Object.hasOwn(CATEGORY_META, rule.category)) &&
    Number.isInteger(rule.minSeverity) && rule.minSeverity >= 1 && rule.minSeverity <= 7 &&
    typeof rule.enabled === "boolean"
  );
}

export function isTheme(value: unknown): value is "dark" | "light" {
  return value === "dark" || value === "light";
}
