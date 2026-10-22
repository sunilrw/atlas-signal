import type { AtlasEvent, EventCategory, EventSource, Severity } from "@/types";

const CATEGORIES = new Set<EventCategory>([
  "conflict", "military", "terrorism", "civil-unrest", "political", "diplomatic",
  "cyber", "infrastructure", "energy", "economic", "humanitarian",
  "natural-disaster", "maritime", "aviation", "health", "crime", "other",
]);
const STATUSES = new Set(["reported", "developing", "confirmed", "resolved", "disputed"]);
const ACCURACIES = new Set(["exact", "city", "region", "country", "approximate", "unknown"]);
const RETIRED_ID = /^demo(?:[-:]|$)/i;

/** Provider copy is plain text, never trusted markup. */
export function plainText(value: unknown, limit = 4_000): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || key === "fbclid" || key === "gclid") url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40) return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse silently rolls some invalid calendar dates into the next month.
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1970 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

function reportedDate(value: unknown, now: number): value is string {
  return validDate(value) && Date.parse(value) <= now;
}

/** Fallback classification is a transparent heuristic, not an assessment of truth. */
export function classifyText(text: string): EventCategory {
  const rules: [RegExp, EventCategory][] = [
    [/\b(earthquake|tsunami|volcan|wildfire|flood|cyclone|hurricane|tornado|drought)/i, "natural-disaster"],
    [/\b(humanitarian|displaced|refugees|famine|relief aid)\b/i, "humanitarian"],
    [/\b(ceasefire|invasion|airstrike|air strike|armed conflict|shelling)\b/i, "conflict"],
    [/\b(military exercise|troops|missile|drone strike)\b/i, "military"],
    [/\b(protest|demonstrat|civil unrest|riot)/i, "civil-unrest"],
    [/\b(ransomware|cyberattack|cyber attack|data breach)\b/i, "cyber"],
    [/\b(election|ballot|parliament|coup)\b/i, "political"],
    [/\b(sanctions|diplomat|treaty|embassy)\b/i, "diplomatic"],
    [/\b(power outage|blackout|pipeline|oil refinery)\b/i, "energy"],
    [/\b(shipping|vessel|maritime|cargo ship)\b/i, "maritime"],
    [/\b(aircraft|aviation|airport)\b/i, "aviation"],
    [/\b(outbreak|epidemic|pandemic)\b/i, "health"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? "other";
}

/** Also validates stored JSON; malformed provider records cannot poison a whole feed. */
export function normalizeLiveEvent(input: unknown): AtlasEvent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const event = input as Partial<AtlasEvent>;
  if (event.isDemo !== false || typeof event.id !== "string" ||
    !/^[\w:-]{1,160}$/.test(event.id) || RETIRED_ID.test(event.id)) return null;
  const now = Date.now();
  const title = plainText(event.title, 300);
  const summary = plainText(event.summary, 4_000);
  if (!title || !reportedDate(event.firstReportedAt, now) || !reportedDate(event.lastUpdatedAt, now) ||
    Date.parse(event.lastUpdatedAt) < Date.parse(event.firstReportedAt)) return null;
  if (event.detectedAt !== undefined && !reportedDate(event.detectedAt, now)) return null;
  // Even a mixed record must not re-introduce a retired fictional relationship.
  if (Array.isArray(event.sources) && event.sources.some((source) =>
    source && (source.isDemo === true || (typeof source.id === "string" && RETIRED_ID.test(source.id))),
  )) return null;
  const sources: EventSource[] = [];
  for (const item of Array.isArray(event.sources) ? event.sources.slice(0, 30) : []) {
    if (!item || typeof item !== "object") continue;
    const url = safeSourceUrl(item.url);
    if (!url || !reportedDate(item.publishedAt, now) || item.isDemo) continue;
    if (item.observedAt !== undefined && !reportedDate(item.observedAt, now)) continue;
    const licenseUrl = item.licenseUrl === undefined ? undefined : safeSourceUrl(item.licenseUrl);
    const publisherUrl = item.publisherUrl === undefined ? undefined : safeSourceUrl(item.publisherUrl);
    if (licenseUrl === null || publisherUrl === null) continue;
    const id = plainText(item.id, 180);
    const name = plainText(item.name, 120);
    if (!id || !name) continue;
    sources.push({
      id,
      name,
      url,
      publishedAt: new Date(item.publishedAt).toISOString(),
      type: ["primary", "news", "ngo", "dataset"].includes(item.type) ? item.type : "news",
      isDemo: false,
      ...(item.providerId ? { providerId: plainText(item.providerId, 80) } : {}),
      ...(item.publisherCountry ? { publisherCountry: plainText(item.publisherCountry, 120) } : {}),
      ...(item.language ? { language: plainText(item.language, 80) } : {}),
      ...(item.byline ? { byline: plainText(item.byline, 300) } : {}),
      ...(licenseUrl ? { licenseUrl } : {}),
      ...(publisherUrl ? { publisherUrl } : {}),
      ...(item.observedAt ? { observedAt: new Date(item.observedAt).toISOString() } : {}),
      ...(["published", "observed", "occurred"].includes(item.timestampBasis ?? "")
        ? { timestampBasis: item.timestampBasis } : {}),
    });
  }
  if (!sources.length) return null;
  const hasCoordinates = typeof event.latitude === "number" && Number.isFinite(event.latitude) &&
    event.latitude >= -90 && event.latitude <= 90 &&
    typeof event.longitude === "number" && Number.isFinite(event.longitude) &&
    event.longitude >= -180 && event.longitude <= 180;
  const category = CATEGORIES.has(event.category as EventCategory)
    ? event.category as EventCategory
    : classifyText(`${title} ${summary}`);
  const severityReason = plainText(event.severityReason, 1_000);
  // Only explicit, attributed hazard measurements support the current scale.
  // In particular, old headline/provider defaults must not survive cache reads.
  const severity = category === "natural-disaster" &&
    event.reportKind !== "news" && event.reportKind !== "analysis" &&
    sources.some((source) => source.type === "primary") && severityReason &&
    typeof event.severity === "number" && Number.isInteger(event.severity) &&
    event.severity >= 1 && event.severity <= 7
    ? event.severity as Severity : null;
  const verificationNote = plainText(event.verificationNote, 1_000) ||
    "Source report. Atlas Signal has not independently verified these claims.";
  const reportKind = ["incident", "news", "analysis"].includes(event.reportKind ?? "")
    ? event.reportKind : undefined;
  const locationEvidence = plainText(event.locationEvidence, 1_000);
  const firstReportedAt = new Date(event.firstReportedAt).toISOString();
  const lastUpdatedAt = new Date(event.lastUpdatedAt).toISOString();
  return {
    id: event.id,
    title,
    summary,
    category,
    ...(event.subcategory ? { subcategory: plainText(event.subcategory, 100) } : {}),
    severity,
    status: STATUSES.has(event.status ?? "") ? event.status! : "reported",
    // None of the configured adapters provides a calibrated independent assessment.
    confidence: null,
    ...(severity !== null ? { severityReason } : {}),
    verificationNote,
    ...(reportKind ? { reportKind } : {}),
    ...(locationEvidence ? { locationEvidence } : {}),
    ...(event.detectedAt ? { detectedAt: new Date(event.detectedAt).toISOString() } : {}),
    ...(hasCoordinates ? { latitude: event.latitude, longitude: event.longitude } : {}),
    locationName: plainText(event.locationName, 200) || "Location not provided",
    country: plainText(event.country, 120) || "Unspecified",
    countryCode: typeof event.countryCode === "string" && /^[A-Za-z]{2}$/.test(event.countryCode)
      ? event.countryCode.toUpperCase() : "ZZ",
    region: plainText(event.region, 100) || "Unspecified",
    locationAccuracy: hasCoordinates && ACCURACIES.has(event.locationAccuracy ?? "")
      ? event.locationAccuracy! : "unknown",
    firstReportedAt,
    lastUpdatedAt,
    sources,
    timeline: (Array.isArray(event.timeline) ? event.timeline : []).slice(-50)
      .filter((item) => item && typeof item.id === "string" && !RETIRED_ID.test(item.id) &&
        reportedDate(item.timestamp, now) && typeof item.title === "string")
      .map((item) => ({
        id: plainText(item.id, 180),
        timestamp: new Date(item.timestamp).toISOString(),
        title: plainText(item.title, 300),
        ...(item.description ? { description: plainText(item.description, 2_000) } : {}),
      }))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    relatedEvents: [],
    tags: [...new Set([
      ...(Array.isArray(event.tags) ? event.tags.filter((tag) => typeof tag === "string")
        .slice(0, 25).map((tag) => plainText(tag, 80)).filter((tag) =>
          tag && tag !== "automated-confidence" && tag !== "contextual-links-not-corroboration" &&
          (tag !== "automated-severity" || severity !== null),
        ) : []),
      ...(!CATEGORIES.has(event.category as EventCategory) ? ["automated-classification"] : []),
    ])],
    isDemo: false,
    ...(typeof event.magnitude === "number" && Number.isFinite(event.magnitude)
      ? { magnitude: event.magnitude } : {}),
    ...(Array.isArray(event.contradictions)
      ? { contradictions: event.contradictions.filter((value) => typeof value === "string").slice(0, 10).map((value) => plainText(value, 500)) } : {}),
  };
}

function sourceKeys(event: AtlasEvent): string[] {
  // Homepage links and shared URLs without an identical headline are not event identifiers.
  const title = event.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return event.sources
    .filter((source) => new URL(source.url).pathname.replace(/\/+$/, "").length > 0)
    .map((source) => `${event.category}|${title}|${canonicalUrl(source.url)}`);
}

function mergeRepeatedRecord(earlier: AtlasEvent, later: AtlasEvent): AtlasEvent {
  const newest = Date.parse(earlier.lastUpdatedAt) >= Date.parse(later.lastUpdatedAt) ? earlier : later;
  const older = newest === earlier ? later : earlier;
  const sources = [...new Map([...older.sources, ...newest.sources].map((source) => [
    `${source.providerId ?? ""}|${source.id}|${canonicalUrl(source.url)}`, source,
  ])).values()];
  const timeline = [...new Map([...earlier.timeline, ...later.timeline].map((update) => [
    `${update.timestamp}|${update.title}`, update,
  ])).values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-50);
  const detections = [earlier.detectedAt, later.detectedAt]
    .filter((value): value is string => Boolean(value)).map(Date.parse);
  return {
    ...newest,
    id: earlier.id,
    firstReportedAt: new Date(Math.min(Date.parse(earlier.firstReportedAt), Date.parse(later.firstReportedAt))).toISOString(),
    ...(detections.length ? { detectedAt: new Date(Math.min(...detections)).toISOString() } : {}),
    sources,
    timeline,
    tags: [...new Set([...earlier.tags, ...later.tags, "duplicate-records-consolidated"])],
    // Repeated reporting, syndication, and shared links do not prove independent corroboration.
    confidence: null,
  };
}

/** Conservative deduplication: spatial proximity alone never merges separate incidents. */
export function processEvents(inputs: unknown[]): AtlasEvent[] {
  const events = new Map<string, AtlasEvent>();
  const canonical = new Map<string, string>();
  for (const input of inputs.slice(0, 5_000)) {
    const event = normalizeLiveEvent(input);
    if (!event) continue;
    const keys = sourceKeys(event);
    const existingId = events.has(event.id) ? event.id : keys.map((key) => canonical.get(key)).find(Boolean);
    const id = existingId ?? event.id;
    const existing = events.get(id);
    events.set(id, existing ? mergeRepeatedRecord(existing, event) : event);
    for (const key of keys) canonical.set(key, id);
  }
  // Similar time or location is not evidence that source reports are related.
  return [...events.values()].sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt));
}
