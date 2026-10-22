import { CATEGORY_META } from "@/lib/catalog";
import type { AtlasEvent, EventsResponse } from "@/types";

export function isRemovedSampleId(value: unknown): boolean {
  return typeof value === "string" && /^(?:event:)?(?:demo|sample|fixture)[-:]/i.test(value);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= maxDays[month - 1] &&
    Number(parts[4]) <= 23 && Number(parts[5]) <= 59 && Number(parts[6]) <= 59 &&
    Number(parts[7] ?? 0) <= 23 && Number(parts[8] ?? 0) <= 59 &&
    Number.isFinite(Date.parse(value));
}

function sourceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

/** Defense in depth against legacy bundles, caches, or malformed stream messages. */
export function isLiveSourceEvent(value: unknown): value is AtlasEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AtlasEvent>;
  if (event.isDemo !== false || typeof event.id !== "string" || isRemovedSampleId(event.id)) return false;
  if (typeof event.title !== "string" || !event.title.trim() || typeof event.summary !== "string" || !event.category || !Object.hasOwn(CATEGORY_META, event.category)) return false;
  if (!["reported", "developing", "confirmed", "resolved", "disputed"].includes(event.status ?? "") ||
    !["exact", "city", "region", "country", "approximate", "unknown"].includes(event.locationAccuracy ?? "")) return false;
  if (![event.verificationNote, event.severityReason, event.locationEvidence, event.subcategory].every(optionalText)) return false;
  if (event.reportKind !== undefined && !["incident", "news", "analysis"].includes(event.reportKind)) return false;
  if (event.detectedAt !== undefined && !timestamp(event.detectedAt)) return false;
  if (event.contradictions !== undefined && (!Array.isArray(event.contradictions) || !event.contradictions.every((claim) => typeof claim === "string"))) return false;
  if (!timestamp(event.firstReportedAt) || !timestamp(event.lastUpdatedAt) || Date.parse(event.firstReportedAt) > Date.parse(event.lastUpdatedAt)) return false;
  if (event.severity !== null && (!Number.isInteger(event.severity) || event.severity! < 1 || event.severity! > 7 ||
    typeof event.severityReason !== "string" || !event.severityReason.trim())) return false;
  // No independent-verification workflow exists. Never revive old heuristic scores.
  if (event.confidence !== null) return false;
  if (!Array.isArray(event.sources) || event.sources.length === 0 || !event.sources.every((source) =>
    source && source.isDemo !== true && typeof source.id === "string" && !isRemovedSampleId(source.id) &&
    typeof source.name === "string" && source.name.trim().length > 0 &&
    ["primary", "news", "ngo", "dataset"].includes(source.type) &&
    [source.byline, source.publisherCountry, source.language, source.providerId].every(optionalText) &&
    (source.licenseUrl === undefined || sourceUrl(source.licenseUrl)) &&
    (source.publisherUrl === undefined || sourceUrl(source.publisherUrl)) &&
    (source.observedAt === undefined || timestamp(source.observedAt)) &&
    (source.timestampBasis === undefined || ["published", "observed", "occurred"].includes(source.timestampBasis)) &&
    sourceUrl(source.url) && timestamp(source.publishedAt)
  )) return false;
  if (event.severity !== null && (event.category !== "natural-disaster" || !event.sources.some((source) => source.type === "primary"))) return false;
  if (![event.country, event.countryCode, event.region, event.locationName].every((field) => typeof field === "string")) return false;
  if (event.latitude !== undefined || event.longitude !== undefined) {
    if (typeof event.latitude !== "number" || typeof event.longitude !== "number" ||
      !Number.isFinite(event.latitude) || !Number.isFinite(event.longitude) ||
      Math.abs(event.latitude) > 90 || Math.abs(event.longitude) > 180) return false;
  }
  if (!Array.isArray(event.timeline) || !event.timeline.every((update) =>
    update && typeof update.id === "string" && !isRemovedSampleId(update.id) &&
    typeof update.title === "string" && optionalText(update.description) && timestamp(update.timestamp)
  )) return false;
  return Array.isArray(event.tags) && event.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(event.relatedEvents) && event.relatedEvents.every((id) => typeof id === "string" && !isRemovedSampleId(id));
}

export function readLiveSnapshot(value: unknown): EventsResponse | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<EventsResponse>;
  if (snapshot.mode !== "live" || !Array.isArray(snapshot.events) ||
    !timestamp(snapshot.referenceTime) || Date.parse(snapshot.referenceTime) > Date.now() + 300_000 ||
    !(snapshot.updatedAt === null || timestamp(snapshot.updatedAt)) ||
    !Array.isArray(snapshot.sources) ||
    !snapshot.sources.every((source) => source && typeof source.id === "string" &&
      typeof source.name === "string" && typeof source.message === "string" &&
      [source.publisherCountry, source.language].every(optionalText) &&
      (source.kind === undefined || ["primary", "news", "humanitarian", "aggregator"].includes(source.kind)) &&
      (source.termsUrl === undefined || sourceUrl(source.termsUrl)) &&
      ["healthy", "degraded", "disabled", "error"].includes(source.status) &&
      typeof source.eventCount === "number" && sourceUrl(source.url) &&
      (source.lastFetchedAt === null || timestamp(source.lastFetchedAt))) ||
    !Array.isArray(snapshot.warnings) || !snapshot.warnings.every((warning) => typeof warning === "string")) return null;
  const cutoff = Date.parse(snapshot.referenceTime);
  if ((snapshot.updatedAt && Date.parse(snapshot.updatedAt) > cutoff) ||
    snapshot.sources.some((source) => source.lastFetchedAt && Date.parse(source.lastFetchedAt) > cutoff)) return null;
  const events = snapshot.events.filter((event) => isLiveSourceEvent(event) &&
    Date.parse(event.lastUpdatedAt) <= cutoff &&
    (!event.detectedAt || Date.parse(event.detectedAt) <= cutoff) &&
    event.timeline.every((update) => Date.parse(update.timestamp) <= cutoff) &&
    event.sources.every((source) => Date.parse(source.publishedAt) <= cutoff &&
      (!source.observedAt || Date.parse(source.observedAt) <= cutoff)));
  return {
    mode: "live",
    referenceTime: snapshot.referenceTime,
    updatedAt: snapshot.updatedAt,
    events,
    total: events.length,
    sources: snapshot.sources,
    warnings: [
      ...snapshot.warnings,
      ...(events.length !== snapshot.events.length ? ["Some records failed source-provenance validation and were omitted."] : [])
    ]
  };
}
