import type { AtlasEvent, EventFilters, Severity, TimeRange, WatchlistEntry } from "@/types";
import { CATEGORY_META, SEVERITY_META, countries as countryCatalog } from "./catalog";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const UNKNOWN = "—";

const TIME_RANGE_MS: Record<TimeRange, number> = {
  "1h": HOUR_MS,
  "6h": 6 * HOUR_MS,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

export const DEFAULT_FILTERS: EventFilters = {
  query: "",
  categories: [],
  minSeverity: 1,
  minConfidence: 0,
  timeRange: "24h",
  region: "All regions",
  watchlistOnly: false,
};

const utcTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const UTC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UNKNOWN_COUNTRY_NAMES = new Set([
  "", "unknown", "unspecified", "unknown country", "global", "international", "n/a", "—",
]);

function timestamp(value: string): number {
  if (typeof value !== "string") return Number.NaN;
  const trimmed = value.trim();
  // Date-only ISO values mean UTC midnight. Date-times must carry an explicit
  // offset; accepting local wall time would differ between browser and server.
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):?(\d{2})))?$/i.exec(trimmed);
  if (!parts) return Number.NaN;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth[month - 1] ||
    Number(parts[4] ?? 0) > 23 ||
    Number(parts[5] ?? 0) > 59 ||
    Number(parts[6] ?? 0) > 59 ||
    Number(parts[8] ?? 0) > 23 ||
    Number(parts[9] ?? 0) > 59
  ) {
    return Number.NaN;
  }
  return Date.parse(trimmed);
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function boundedThreshold(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value) && value !== "ZZ";
}

function happenedBy(iso: string, cutoff: number): boolean {
  const value = timestamp(iso);
  return Number.isFinite(value) && value <= cutoff;
}

function searchableText(event: AtlasEvent): string {
  return normalizeSearch(
    [
      event.title,
      event.summary,
      event.country,
      event.countryCode,
      event.locationName,
      event.region,
      event.category,
      CATEGORY_META[event.category]?.label,
      CATEGORY_META[event.category]?.shortLabel,
      event.subcategory,
      ...event.tags,
      ...event.sources.flatMap((source) => [source.name, source.url]),
    ].join(" "),
  );
}

/**
 * Filters immutable, current event snapshots in a UTC update-time window.
 *
 * Playback moves the window's cutoff into the past. A snapshot last updated
 * after that cutoff, or containing later source/timeline timestamps, is omitted:
 * its current title, status and assessment cannot safely stand in for historical
 * state. This is snapshot playback, not event reconstruction. Missing coordinates
 * are never filled or filtered out.
 */
export function filterEvents(
  events: AtlasEvent[],
  filters: EventFilters,
  referenceTime: string,
  playbackHours = 0,
  watchlist: WatchlistEntry[] = [],
): AtlasEvent[] {
  const reference = timestamp(referenceTime);
  if (!Number.isFinite(reference)) return [];

  const offset = Number.isFinite(playbackHours) ? Math.max(0, playbackHours) : 0;
  const cutoff = reference - offset * HOUR_MS;
  if (!Number.isFinite(cutoff)) return [];

  const range = TIME_RANGE_MS[filters.timeRange];
  const windowStart = cutoff - (typeof range === "number" ? range : DAY_MS);
  const minimumSeverity = boundedThreshold(filters.minSeverity, 1, 7);
  const minimumConfidence = boundedThreshold(filters.minConfidence, 0, 100);
  const categories = new Set(filters.categories);
  const region = normalizeSearch(filters.region.trim());
  const tokens = normalizeSearch(filters.query).trim().split(/\s+/).filter(Boolean);
  const watchedCountries = new Set(
    watchlist
      .filter((entry) => entry.kind === "country")
      .map((entry) => entry.value.trim().toUpperCase())
      .filter(Boolean),
  );
  const watchedEvents = new Set(
    watchlist
      .filter((entry) => entry.kind === "event")
      .map((entry) => entry.value)
      .filter((value) => value.trim().length > 0),
  );

  return events
    .filter((event) => {
      const firstReported = timestamp(event.firstReportedAt);
      const lastUpdated = timestamp(event.lastUpdatedAt);

      if (
        !Number.isFinite(firstReported) ||
        !Number.isFinite(lastUpdated) ||
        firstReported > lastUpdated ||
        firstReported > cutoff ||
        lastUpdated > cutoff ||
        lastUpdated < windowStart
      ) {
        return false;
      }

      if (
        event.sources.some((source) => !happenedBy(source.publishedAt, cutoff)) ||
        event.timeline.some((update) => !happenedBy(update.timestamp, cutoff))
      ) {
        return false;
      }

      // Unassessed is not low severity or zero confidence. Keep it visible with
      // unrestricted controls; a requested score minimum requires an assessment.
      if (
        event.severity === null
          ? minimumSeverity > 1
          : !isSeverity(event.severity) || event.severity < minimumSeverity
      ) return false;
      if (
        event.confidence === null
          ? minimumConfidence > 0
          : !Number.isFinite(event.confidence) ||
            event.confidence < 0 ||
            event.confidence > 100 ||
            event.confidence < minimumConfidence
      ) return false;

      if (categories.size && !categories.has(event.category)) return false;
      if (region && region !== "all regions" && normalizeSearch(event.region.trim()) !== region) {
        return false;
      }
      if (
        filters.watchlistOnly &&
        !watchedEvents.has(event.id) &&
        !watchedCountries.has(event.countryCode.trim().toUpperCase())
      ) {
        return false;
      }
      if (tokens.length) {
        const text = searchableText(event);
        if (!tokens.every((token) => text.includes(token))) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const byUpdated = timestamp(b.lastUpdatedAt) - timestamp(a.lastUpdatedAt);
      if (byUpdated !== 0) return byUpdated;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** Compact relative wording; future timestamps are never presented as past. */
export function relativeTime(iso: string, referenceTime?: string): string {
  const value = timestamp(iso);
  const reference = referenceTime === undefined ? Date.now() : timestamp(referenceTime);
  if (!Number.isFinite(value) || !Number.isFinite(reference)) return UNKNOWN;

  const elapsed = reference - value;
  const duration = Math.abs(elapsed);
  if (duration < 60_000) return elapsed >= 0 ? "just now" : "in a moment";

  const [unit, unitMs]: [string, number] =
    duration < HOUR_MS ? ["m", 60_000] : duration < DAY_MS ? ["h", HOUR_MS] : ["d", DAY_MS];
  const quantity = Math.floor(duration / unitMs);
  return elapsed >= 0 ? `${quantity}${unit} ago` : `in ${quantity}${unit}`;
}

export function formatUtcTime(iso: string): string {
  const value = timestamp(iso);
  return Number.isFinite(value) ? `${utcTimeFormatter.format(value)} UTC` : UNKNOWN;
}

export function formatUtcDate(iso: string): string {
  const value = timestamp(iso);
  if (!Number.isFinite(value)) return UNKNOWN;
  const date = new Date(value);
  return `${date.getUTCDate()} ${UTC_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** A descriptive score band, never an assertion that a report is verified. */
export function confidenceLabel(confidence: number | null): string {
  if (confidence === null) return "Not independently verified";
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) return UNKNOWN;
  return confidence >= 80 ? "High" : confidence >= 50 ? "Moderate" : "Low";
}

export function severityLabel(severity: number | null): string {
  if (severity === null) return "Unassessed";
  return isSeverity(severity) ? SEVERITY_META[severity].label : UNKNOWN;
}

/**
 * Critical means level 7 only. Countries exclude unknowns; sources counts
 * distinct HTTP(S) publication URLs, not independent publishers or corroboration.
 */
export function getEventStats(events: AtlasEvent[]): {
  total: number;
  critical: number;
  developing: number;
  countries: number;
  sources: number;
} {
  const countries = new Set<string>();
  const sources = new Set<string>();
  const countryCodesByName = new Map(
    countryCatalog.map(({ name, code }) => [normalizeSearch(name), code]),
  );
  let critical = 0;
  let developing = 0;

  // Also reconcile named fallbacks for countries outside the navigation catalog.
  for (const event of events) {
    const name = normalizeSearch(event.country.trim());
    const code = event.countryCode.trim().toUpperCase();
    if (isCountryCode(code) && !UNKNOWN_COUNTRY_NAMES.has(name) && !countryCodesByName.has(name)) {
      countryCodesByName.set(name, code);
    }
  }

  for (const event of events) {
    if (event.severity === 7) critical += 1;
    if (event.status === "developing") developing += 1;
    const code = event.countryCode.trim().toUpperCase();
    const name = normalizeSearch(event.country.trim());
    if (isCountryCode(code)) countries.add(code);
    else if (!UNKNOWN_COUNTRY_NAMES.has(name)) countries.add(countryCodesByName.get(name) ?? name);
    for (const source of event.sources) {
      try {
        const url = new URL(source.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        url.hash = "";
        for (const key of [...url.searchParams.keys()]) {
          if (/^utm_/i.test(key) || /^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
        }
        url.searchParams.sort();
        sources.add(url.href);
      } catch {
        // Invalid source URLs are not counted as valid references.
      }
    }
  }

  return { total: events.length, critical, developing, countries: countries.size, sources: sources.size };
}

/** Great-circle kilometres. Invalid/missing coordinates produce NaN, not a location. */
export function distanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  if (
    ![latitude1, longitude1, latitude2, longitude2].every(Number.isFinite) ||
    Math.abs(latitude1) > 90 ||
    Math.abs(latitude2) > 90 ||
    Math.abs(longitude1) > 180 ||
    Math.abs(longitude2) > 180
  ) {
    return Number.NaN;
  }

  const radians = Math.PI / 180;
  const latitudeDelta = (latitude2 - latitude1) * radians;
  const longitudeDelta = (longitude2 - longitude1) * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1 * radians) * Math.cos(latitude2 * radians) * Math.sin(longitudeDelta / 2) ** 2;
  const arc = 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
  return 6_371.0088 * arc;
}
