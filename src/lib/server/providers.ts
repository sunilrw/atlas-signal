import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Agent } from "undici";
import { countries } from "@/lib/catalog";
import { classifyText, plainText, safeSourceUrl } from "@/lib/server/pipeline";
import type { AtlasEvent, EventCategory, EventSource, Severity } from "@/types";
import { PROVIDERS, type ProviderDefinition, type ProviderId } from "./provider-catalog";

export { PROVIDERS, type ProviderId } from "./provider-catalog";

export interface RawProviderRecord {
  provider: ProviderId;
  providerId: string;
  fetchedAt: string;
  payload: unknown;
}

export interface ProviderResult {
  id: ProviderId;
  name: string;
  url: string;
  events: AtlasEvent[];
  raw: RawProviderRecord[];
  message: string;
}

const MAX_RESPONSE_BYTES = 5 * 1_024 * 1_024;
const MAX_RECORDS = 1_000;
const TIMEOUT_MS = 9_000;
const VERIFICATION_NOTE = "Source report, not independently verified by Atlas Signal.";
let ipv4DnsRetryAgent: Agent | undefined;

class ProviderError extends Error {}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…",
  };
  return value.replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp|ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? entity;
    const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    // Never introduce invalid Unicode, surrogate code points, or controls.
    if ([9, 10, 13].includes(code)) return " ";
    return code >= 32 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      ? String.fromCodePoint(code) : "";
  });
}

function text(value: unknown, limit = 1_500): string {
  const scalar = object(value)["#text"] ?? value;
  if (typeof scalar !== "number" && typeof scalar !== "string") return "";
  // Decode only built-in/numeric XML entities. No custom entity or DTD is read.
  // A second pass removes encoded markup as well as literal feed markup.
  const decoded = decodeEntities(decodeEntities(String(scalar)));
  // Removing an inline emphasis/link must not insert spaces inside the
  // publisher's punctuation ("report<b>ed</b>." remains "reported.").
  const withoutInlineTags = decoded.replace(/<\/?(?:a|b|strong|i|em|span|small|big|sub|sup|u|s|abbr|time|code)\b[^>]*>/gi, "");
  return plainText(plainText(withoutInlineTags, limit * 2), limit);
}

function sourceUrl(value: unknown): string | null {
  const scalar = object(value)["#text"] ?? value;
  return safeSourceUrl(typeof scalar === "string" ? decodeEntities(scalar).trim() : scalar);
}

function number(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coordinatePair(latitude: unknown, longitude: unknown): Pick<AtlasEvent, "latitude" | "longitude"> {
  const lat = number(latitude);
  const lon = number(longitude);
  return lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { latitude: lat, longitude: lon }
    : {};
}

function validCalendarDate(value: string): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(value);
  const rfc = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:GMT|UTC|UT|[+-]\d{4})$/i.exec(value);
  if (!iso && !rfc) return false;
  const year = Number(iso?.[1] ?? rfc?.[3]);
  const month = iso ? Number(iso[2]) : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(rfc![2].toLowerCase()) + 1;
  const day = Number(iso?.[3] ?? rfc?.[1]);
  const hour = Number(iso?.[4] ?? rfc?.[4]);
  const minute = Number(iso?.[5] ?? rfc?.[5]);
  const second = Number(iso?.[6] ?? rfc?.[6] ?? 0);
  return year >= 1970 && month >= 1 && month <= 12 &&
    day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour < 24 && minute < 60 && second < 60;
}

function date(value: unknown): string | undefined {
  const scalar = object(value)["#text"] ?? value;
  if (typeof scalar !== "number" && (typeof scalar !== "string" || !scalar.trim() || scalar.length > 100)) return undefined;
  // Date.parse silently rolls some impossible dates (such as February 30)
  // forward. Reject them instead of fabricating a corrected publication day.
  if (typeof scalar === "string" && !validCalendarDate(scalar.trim())) return undefined;
  const timestamp = typeof scalar === "number" ? scalar : Date.parse(scalar);
  // Missing, invalid, pre-epoch and future source times stay absent. Ingestion
  // time is never substituted for an unknown source publication/origin time.
  return Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= Date.now()
    ? new Date(timestamp).toISOString()
    : undefined;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "").digest("hex").slice(0, 24);
}

function recordId(value: unknown, fallback: unknown): string {
  const scalar = object(value)["#text"] ?? value;
  if (typeof scalar !== "string" && typeof scalar !== "number") return hash(fallback);
  // Do not truncate article URLs into colliding IDs. The complete identifier stays in raw payloads.
  return String(scalar).length > 140 ? hash(scalar) : text(scalar, 140) || hash(fallback);
}

function gdacsRecordId(item: Record<string, unknown>): string | undefined {
  const suppliedType = object(item["gdacs:eventtype"])["#text"] ?? item["gdacs:eventtype"];
  const suppliedId = object(item["gdacs:eventid"])["#text"] ?? item["gdacs:eventid"];
  const type = typeof suppliedType === "string" ? suppliedType.trim().toUpperCase() : "";
  const id = typeof suppliedId === "string" || typeof suppliedId === "number" ? String(suppliedId).trim() : "";
  // Neither a hazard code nor an ID alone identifies a GDACS disaster. Incomplete
  // keys must fall back to the whole record hash, never a shared "FL:" or ":12".
  if (!/^[A-Z]{2}$/.test(type) || !/^\d+$/.test(id)) return undefined;
  // Preserve the full identifier; recordId hashes overlong values without truncation.
  return `${type}:${id}`;
}

function eventId(provider: ProviderId, id: string): string {
  return `${provider}:${/^[\w:-]{1,140}$/.test(id) ? id : hash(id)}`;
}

// ISO 3166-1 mappings for countries supported by the navigation catalogue.
const ISO3_TO_ISO2: Record<string, string> = {
  AFG: "AF", ARG: "AR", AUS: "AU", BGD: "BD", BRA: "BR", CAN: "CA", CHL: "CL",
  CHN: "CN", COL: "CO", COD: "CD", EGY: "EG", ETH: "ET", FRA: "FR", DEU: "DE",
  GRC: "GR", HTI: "HT", IND: "IN", IDN: "ID", IRN: "IR", IRQ: "IQ", ISR: "IL",
  JPN: "JP", KEN: "KE", LBN: "LB", MEX: "MX", MMR: "MM", NZL: "NZ", NGA: "NG",
  NOR: "NO", PAK: "PK", PSE: "PS", PHL: "PH", POL: "PL", RUS: "RU", SAU: "SA",
  SEN: "SN", SGP: "SG", SOM: "SO", ZAF: "ZA", KOR: "KR", SSD: "SS", ESP: "ES",
  SDN: "SD", CHE: "CH", SYR: "SY", TWN: "TW", TUR: "TR", UKR: "UA", ARE: "AE",
  GBR: "GB", USA: "US", VUT: "VU", VEN: "VE", VNM: "VN", YEM: "YE",
};

function countryFields(name: unknown, code?: unknown): Pick<AtlasEvent, "country" | "countryCode" | "region"> {
  const label = text(name, 120);
  // Reject compound/list values as codes rather than assigning their first country.
  const suppliedCode = text(code, 100).toUpperCase();
  const givenCode = /^[A-Z]{3}$/.test(suppliedCode) ? ISO3_TO_ISO2[suppliedCode] : suppliedCode;
  // This lookup uses explicit country metadata, never coordinates or headline guesses.
  const country = countries.find((item) =>
    (label && item.name.toLocaleLowerCase() === label.toLocaleLowerCase()) ||
    (givenCode?.length === 2 && item.code === givenCode),
  );
  return {
    country: label || country?.name || "Unspecified",
    countryCode: country?.code ?? (givenCode && /^[A-Z]{2}$/.test(givenCode) ? givenCode : "ZZ"),
    region: country?.region ?? "Unspecified",
  };
}

interface EventInput {
  provider: ProviderDefinition;
  providerId: string;
  title: string;
  summary: string;
  category: EventCategory;
  subcategory?: string;
  severity: Severity | null;
  severityReason?: string;
  reportKind: NonNullable<AtlasEvent["reportKind"]>;
  fetchedAt: string;
  publishedAt: string;
  updatedAt?: string;
  url: string;
  sourceName?: string;
  sourceByline?: string;
  publisherCountry?: string;
  language?: string;
  sourceType: EventSource["type"];
  locationName?: string;
  coordinates?: Pick<AtlasEvent, "latitude" | "longitude">;
  country?: unknown;
  countryCode?: unknown;
  tags?: string[];
  magnitude?: number;
  timestampLabel?: string;
  timestampBasis?: EventSource["timestampBasis"];
  locationEvidence?: string;
  providerNote?: string;
}

function makeEvent(input: EventInput): AtlasEvent {
  const id = eventId(input.provider.id, input.providerId);
  const updatedAt = input.updatedAt && Date.parse(input.updatedAt) >= Date.parse(input.publishedAt)
    ? input.updatedAt : input.publishedAt;
  const coordinates = input.coordinates ?? {};
  return {
    id,
    title: text(input.title, 300),
    summary: text(input.summary, 4_000),
    category: input.category,
    ...(input.subcategory ? { subcategory: input.subcategory } : {}),
    severity: input.severity,
    ...(input.severityReason ? { severityReason: input.severityReason } : {}),
    status: "reported",
    confidence: null,
    verificationNote: [VERIFICATION_NOTE, input.providerNote].filter(Boolean).join(" "),
    reportKind: input.reportKind,
    locationEvidence: input.locationEvidence || "The source did not supply event coordinates. No location was inferred.",
    ...coordinates,
    locationName: input.locationName || "Location not provided",
    ...countryFields(input.country, input.countryCode),
    locationAccuracy: coordinates.latitude !== undefined ? "approximate" : "unknown",
    firstReportedAt: input.publishedAt,
    lastUpdatedAt: updatedAt,
    detectedAt: input.fetchedAt,
    sources: [{
      id: `${id}:source`,
      name: input.sourceName || input.provider.name,
      url: input.url,
      publishedAt: input.publishedAt,
      type: input.sourceType,
      providerId: input.provider.id,
      publisherUrl: input.provider.publisherUrl,
      publisherCountry: input.publisherCountry ?? input.provider.publisherCountry,
      language: input.language ?? input.provider.language,
      ...(input.provider.licenseUrl ? { licenseUrl: input.provider.licenseUrl } : {}),
      timestampBasis: input.timestampBasis ?? "published",
      observedAt: input.fetchedAt,
      ...(input.sourceByline ? { byline: input.sourceByline } : {}),
      isDemo: false,
    }],
    timeline: [
      {
        id: `${id}:published`,
        timestamp: input.publishedAt,
        title: input.timestampLabel || "Source report published",
        description: `Timestamp supplied by ${input.provider.name}; ${
          input.timestampBasis === "observed" ? "this is an indexing time, not a publication or incident time."
            : input.timestampBasis === "occurred" ? "this is an event origin time, not a publication time."
              : "publication time is not necessarily the incident time."
        }`,
      },
      ...(updatedAt !== input.publishedAt ? [{
        id: `${id}:updated`,
        timestamp: updatedAt,
        title: "Source report updated",
        description: `Update timestamp supplied by ${input.provider.name}.`,
      }] : []),
    ],
    relatedEvents: [],
    tags: [
      input.provider.id, "live-source",
      "not-independently-verified", ...(input.tags ?? []),
    ],
    isDemo: false,
    ...(input.magnitude !== undefined ? { magnitude: input.magnitude } : {}),
  };
}

async function boundedFetch(url: URL, init: RequestInit, externalSignal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const requestInit: RequestInit = {
      ...init,
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json, application/rss+xml, application/xml, text/xml", ...init.headers },
    };
    let response: Response;
    try {
      response = await fetch(url, requestInit);
    } catch (error) {
      const failure = object(error);
      const code = object(failure.cause).code ?? failure.code;
      if (code !== "ENOTFOUND" || controller.signal.aborted) throw error;
      // Some dual-family resolver paths fail for a hostname that has a valid A
      // record. Retry that same allowlisted HTTPS URL via ordinary IPv4 DNS,
      // once, within the original deadline. Keep SNI/certificate verification,
      // redirect rejection and all response bounds; never pin an IP or change
      // global DNS/dispatcher settings. Other failures are not retried.
      ipv4DnsRetryAgent ??= new Agent({ connect: { family: 4 }, connections: 2, maxOrigins: PROVIDERS.length });
      const retryInit: RequestInit & { dispatcher: Agent } = { ...requestInit, dispatcher: ipv4DnsRetryAgent };
      response = await fetch(url, retryInit);
    }
    if (!response.ok) throw new ProviderError(`Provider returned HTTP ${response.status}.`);
    const length = Number(response.headers.get("content-length"));
    if (length > MAX_RESPONSE_BYTES) throw new ProviderError("Provider response exceeded the 5 MB limit.");
    reader = response.body?.getReader();
    if (!reader) throw new ProviderError("Provider returned an empty response.");
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ProviderError("Provider response exceeded the 5 MB limit.");
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    controller.abort();
    if (reader) void reader.cancel().catch(() => undefined);
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("Provider request failed, timed out, or was cancelled.");
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", cancel);
  }
}

function parseJson(value: string): Record<string, unknown> {
  try {
    return object(JSON.parse(value));
  } catch {
    throw new ProviderError("Provider returned invalid JSON.");
  }
}

function parseRss(value: string): unknown[] {
  // No DTDs or custom entities: avoid both external entities and expansion attacks.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(value) || XMLValidator.validate(value) !== true) {
    throw new ProviderError("Provider returned invalid or unsupported XML.");
  }
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: false,
      trimValues: true,
    });
    const root = object(parser.parse(value));
    const rss = object(root.rss);
    const channel = object(rss.channel);
    if (Object.keys(channel).length) return list(channel.item);
    // DW publishes RSS 1.0 / RDF: items are siblings of channel, not its children.
    const rdf = object(root["rdf:RDF"]);
    if (Object.keys(object(rdf.channel)).length) return list(rdf.item);
    throw new Error("Missing channel");
  } catch {
    throw new ProviderError("Provider returned invalid or unsupported RSS.");
  }
}

function earthquakeSeverity(magnitude: number | undefined): Severity | null {
  if (magnitude === undefined) return null;
  if (magnitude >= 8) return 7;
  if (magnitude >= 7) return 6;
  if (magnitude >= 6) return 5;
  if (magnitude >= 5) return 4;
  if (magnitude >= 4) return 3;
  return magnitude >= 3 ? 2 : 1;
}

function usgsEvent(provider: ProviderDefinition, id: string, value: unknown, fetchedAt: string): AtlasEvent | undefined {
  const feature = object(value);
  const properties = object(feature.properties);
  // USGS also catalogues explosions, quarry blasts and other seismic detections.
  // Do not silently relabel those records as natural earthquakes.
  if (text(properties.type, 60).toLowerCase() !== "earthquake") return undefined;
  const publishedAt = date(properties.time);
  const url = sourceUrl(properties.url);
  if (!publishedAt || !url) return undefined;
  const geo = object(feature.geometry);
  const point = geo.type === "Point" && Array.isArray(geo.coordinates) ? geo.coordinates : [];
  const suppliedMagnitude = number(properties.mag);
  const magnitude = suppliedMagnitude !== undefined && suppliedMagnitude >= -2 && suppliedMagnitude <= 12
    ? suppliedMagnitude : undefined;
  const place = text(properties.place, 200);
  const title = text(properties.title, 300) || (magnitude !== undefined ? `Magnitude ${magnitude} earthquake` : "USGS earthquake report");
  const reviewStatus = text(properties.status, 80);
  return makeEvent({
    provider, providerId: id, title, fetchedAt,
    summary: [
      magnitude !== undefined ? `USGS reports an earthquake with magnitude ${magnitude}.` : "USGS reports an earthquake; magnitude is unavailable.",
      place ? `Reported location: ${place}.` : "No location description was supplied.",
      "The timestamp is the USGS event origin time; coordinates describe the reported epicenter.",
      magnitude !== undefined ? "Atlas severity uses magnitude only, not casualties or damage." : "Severity is unassessed because magnitude is unavailable.",
    ].join(" "),
    category: "natural-disaster", subcategory: "earthquake",
    severity: earthquakeSeverity(magnitude),
    severityReason: magnitude !== undefined
      ? `Derived from USGS magnitude ${magnitude} only: <3→1, 3–<4→2, 4–<5→3, 5–<6→4, 6–<7→5, 7–<8→6, ≥8→7. Not a casualty or damage assessment.`
      : undefined,
    reportKind: "incident",
    publishedAt, updatedAt: date(properties.updated), url, sourceType: "primary",
    coordinates: coordinatePair(point[1], point[0]), locationName: place,
    magnitude, timestampLabel: "USGS event origin time", timestampBasis: "occurred",
    locationEvidence: coordinatePair(point[1], point[0]).latitude !== undefined
      ? "Epicenter coordinates supplied by USGS; not a street-level damage location."
      : undefined,
    providerNote: reviewStatus ? `USGS review status: ${reviewStatus}; provider review is not independent corroboration by Atlas Signal.` : undefined,
    tags: [...(magnitude !== undefined ? ["magnitude-based-severity"] : ["impact-unassessed"]), "provider-epicenter"],
  });
}

const DISASTER_TYPES: Record<string, string> = {
  EQ: "earthquake", FL: "flood", TC: "tropical-cyclone", TS: "tsunami",
  VO: "volcanic-activity", WF: "wildfire", DR: "drought",
};

function gdacsEvent(provider: ProviderDefinition, id: string, value: unknown, fetchedAt: string): AtlasEvent | undefined {
  const item = object(value);
  const title = text(item.title, 300);
  const publishedAt = date(item.pubDate) ?? date(item["gdacs:dateadded"]);
  const url = sourceUrl(item.link);
  if (!title || !publishedAt || !url) return undefined;
  const point = object(item["geo:Point"]);
  const geoRss = text(item["georss:point"], 80).split(/\s+/);
  const coordinates = coordinatePair(point["geo:lat"], point["geo:long"]);
  const level = text(item["gdacs:alertlevel"], 20).toLowerCase();
  const severity: Severity | null = level === "red" ? 6 : level === "orange" ? 4 : level === "green" ? 2 : null;
  const validCoordinates = coordinates.latitude !== undefined ? coordinates : coordinatePair(geoRss[0], geoRss[1]);
  const event = makeEvent({
    provider, providerId: id, title, fetchedAt,
    summary: [
      text(item.description, 1_700),
      level ? `GDACS source alert level: ${level}.` : "GDACS has not supplied an alert level.",
      severity === null ? "Severity is unassessed because a recognized alert level was not supplied."
        : "Atlas maps the source's red/orange/green alert levels to 6/4/2; this is not independently assessed damage.",
    ].filter(Boolean).join(" "),
    category: "natural-disaster",
    subcategory: DISASTER_TYPES[text(item["gdacs:eventtype"], 10).toUpperCase()] || "disaster-alert",
    severity,
    severityReason: severity === null ? undefined : `Derived from GDACS ${level} alert: red→6, orange→4, green→2. Model-based source alert, not verified casualties or damage.`,
    reportKind: "incident",
    publishedAt, updatedAt: date(item["gdacs:datemodified"]), url, sourceType: "primary",
    coordinates: validCoordinates,
    locationName: text(item["gdacs:country"], 200),
    country: item["gdacs:country"],
    countryCode: item["gdacs:iso3"],
    locationEvidence: validCoordinates.latitude !== undefined
      ? "Point supplied by GDACS for this disaster alert; an approximate reference point, not the complete affected area."
      : undefined,
    tags: [...(severity === null ? ["impact-unassessed"] : ["source-alert-based-severity"]), "gdacs-attribution", ...(level ? [`gdacs-alert:${level}`] : [])],
  });
  const onset = date(item["gdacs:fromdate"]);
  if (onset && onset !== publishedAt) {
    event.timeline.push({ id: `${event.id}:onset`, timestamp: onset, title: "Event onset reported by GDACS" });
    event.timeline.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }
  return event;
}

function reliefwebEvent(provider: ProviderDefinition, id: string, value: unknown, fetchedAt: string): AtlasEvent | undefined {
  const fields = object(object(value).fields);
  const dates = object(fields.date);
  const title = text(fields.title, 300);
  const publishedAt = date(dates.original) ?? date(dates.created);
  const url = sourceUrl(fields.origin) ?? sourceUrl(fields.url_alias) ?? sourceUrl(fields.url);
  if (!title || !publishedAt || !url) return undefined;
  const primaryCountry = object(list(fields.primary_country)[0] ?? list(fields.country)[0]);
  const publishers = list(fields.source).map((entry) => text(object(entry).shortname ?? object(entry).name, 100)).filter(Boolean);
  return makeEvent({
    provider, providerId: id, title, fetchedAt,
    summary: [
      "Humanitarian report indexed by ReliefWeb; consult the linked source for its findings.",
      "Country metadata does not establish an event location, so no map coordinates are assigned.",
      "Impact and confidence have not been assessed by Atlas Signal.",
    ].join(" "),
    category: "humanitarian", severity: null, reportKind: "news",
    publishedAt, updatedAt: date(dates.changed) ?? date(dates.created), url,
    sourceName: publishers.length ? `${publishers.join(", ")} (via ReliefWeb)` : "ReliefWeb",
    sourceType: "dataset", country: primaryCountry.shortname ?? primaryCountry.name,
    countryCode: primaryCountry.iso3,
    locationName: text(primaryCountry.shortname ?? primaryCountry.name, 200),
    tags: ["aggregated-report", "impact-unassessed", "no-event-coordinates"],
    timestampLabel: date(dates.original) ? "Original source publication" : "Report indexed by ReliefWeb",
    timestampBasis: date(dates.original) ? "published" : "observed",
  });
}

function newsEvent(provider: ProviderDefinition, id: string, value: unknown, fetchedAt: string): AtlasEvent | undefined {
  const item = object(value);
  const isGdelt = provider.id === "gdelt";
  const title = text(item.title, 1_000);
  // Do not silently cut off a publisher's qualification or negation to make a
  // headline fit. Oversized titles remain in raw storage, not altered reports.
  if (title.length > 300) return undefined;
  const url = sourceUrl(isGdelt ? item.url : item.link);
  const seen = text(item.seendate, 40).replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z",
  );
  const publishedAt = date(isGdelt ? seen : item.pubDate ?? item["dc:date"]);
  if (!title || !url || !publishedAt) return undefined;
  const category = classifyText(title);
  const domain = new URL(url).hostname;
  const sourceLabels = [...list(item.category), ...list(item["dc:subject"])]
    .map((label) => text(label, 80)).filter(Boolean).slice(0, 10);
  // Only a publisher-supplied genre/category or explicit headline prefix can
  // identify analysis/opinion. An uncertain-sounding headline is not evidence.
  const analysis = sourceLabels.some((label) => /^(opinion|analysis|commentary|editorial|op-ed)$/i.test(label)) ||
    /^(opinion|analysis|commentary|editorial|op-ed)\s*:/i.test(title);
  const geoRss = text(item["georss:point"], 80).split(/\s+/);
  const point = object(item["geo:Point"]);
  const nestedCoordinates = coordinatePair(point["geo:lat"], point["geo:long"]);
  const suppliedCoordinates = coordinatePair(item["geo:lat"], item["geo:long"]);
  const coordinates = isGdelt ? {}
    : nestedCoordinates.latitude !== undefined ? nestedCoordinates
      : suppliedCoordinates.latitude !== undefined ? suppliedCoordinates
        : geoRss.length === 2 ? coordinatePair(geoRss[0], geoRss[1]) : {};
  const byline = text(item["dc:creator"] ?? item.author, 200);
  // Global Voices requires author attribution. Do not guess an author if a
  // malformed feed item omits it; keep that item only in the bounded raw store.
  if (provider.id === "globalvoices" && !byline) return undefined;
  // Feed descriptions are publisher copy, never generated article summaries.
  // DW's free title/link grant does not cover the description. Full content,
  // enclosures, images, and content:encoded never enter the display contract.
  const excerpt = !isGdelt && !provider.headlineOnly ? text(item.description, 600) : "";
  const sourceName = isGdelt ? `${domain} (via GDELT)`
    : provider.id === "dw" ? "Deutsche Welle" : provider.id === "bbc" ? "BBC News" : provider.name;
  return makeEvent({
    provider, providerId: id, title, fetchedAt,
    summary: excerpt || (isGdelt
      ? "Headline indexed by GDELT; this timestamp records when GDELT observed the article, not when it was published or when the event occurred. Open the original publisher's article for its reporting."
      : provider.id === "dw"
        ? "Content from the Deutsche Welle. Headline and original link only; open the publisher's article to read the report."
        : `Headline supplied by ${provider.name}. Open the original article for the publisher's reporting.`),
    category, severity: null, reportKind: analysis ? "analysis" : "news",
    publishedAt, url, sourceType: "news",
    sourceName, sourceByline: byline || undefined,
    publisherCountry: isGdelt ? text(item.sourcecountry, 100) || undefined : undefined,
    language: isGdelt ? text(item.language, 60) || undefined : undefined,
    coordinates,
    tags: [
      "headline-classification", "impact-unassessed",
      coordinates.latitude === undefined ? "no-event-coordinates" : "provider-georss-point",
      ...(excerpt ? ["publisher-feed-excerpt"] : ["headline-only"]),
      ...(analysis ? ["source-labeled-analysis-or-opinion"] : []),
      ...sourceLabels.map((label) => `source-category:${label}`),
    ],
    timestampLabel: isGdelt ? "Article first seen by GDELT" : "Source article published",
    timestampBasis: isGdelt ? "observed" : "published",
    locationEvidence: coordinates.latitude !== undefined
      ? `Coordinates explicitly supplied in the ${provider.name} feed. Geographic precision is not independently verified.`
      : "No event coordinates supplied. Publisher country and headline place names are not used as incident locations.",
    providerNote: [
      "Category is an automated headline-keyword grouping, not publisher verification.",
      analysis ? "The publisher explicitly labeled this item as analysis or opinion." : "",
      provider.id === "globalvoices"
        ? "Global Voices feed excerpt, CC BY 3.0; markup removed and length limited. Author, original link and license are retained. No article body or image is reproduced."
        : "",
    ].filter(Boolean).join(" "),
  });
}

/** Fetches one allowlisted provider; errors never include response bodies or credentials. */
export async function fetchProvider(id: ProviderId, signal?: AbortSignal): Promise<ProviderResult> {
  const provider = PROVIDERS.find((item) => item.id === id);
  if (!provider) throw new ProviderError("Unknown provider.");
  if (!provider.enabled()) throw new ProviderError(provider.disabledMessage);
  const url = new URL(provider.url);
  const init: RequestInit = {};
  if (id === "reliefweb") {
    url.searchParams.set("appname", process.env.RELIEFWEB_APPNAME!.trim());
    init.method = "POST";
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify({
      limit: 50,
      sort: ["date.created:desc"],
      fields: { include: ["title", "url", "url_alias", "origin", "date", "source", "primary_country", "country", "disaster_type"] },
    });
  } else if (id === "gdelt") {
    url.searchParams.set("query", '(earthquake OR flood OR conflict OR "civil unrest" OR humanitarian)');
    url.searchParams.set("mode", "ArtList");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "DateDesc");
    url.searchParams.set("timespan", "24h");
    url.searchParams.set("maxrecords", "50");
  }
  const body = await boundedFetch(url, init, signal);
  const fetchedAt = new Date(Date.now()).toISOString();
  let records: unknown[];
  if (provider.format === "rss") {
    records = parseRss(body);
  } else {
    const payload = parseJson(body);
    const candidate = id === "usgs" ? payload.features : id === "reliefweb" ? payload.data : payload.articles;
    if (!Array.isArray(candidate)) throw new ProviderError("Provider returned an unsupported response shape.");
    records = candidate;
  }
  const raw: RawProviderRecord[] = [];
  const events: AtlasEvent[] = [];
  const omitted = Math.max(0, records.length - MAX_RECORDS);
  for (const record of records.slice(0, MAX_RECORDS)) {
    const item = object(record);
    const originalId = id === "gdacs"
      ? gdacsRecordId(item)
      : id === "gdelt" ? item.url : provider.format === "rss" ? item.guid ?? item["dwsyn:contentID"] ?? item.link : item.id;
    const providerId = recordId(originalId, record);
    const episodeId = id === "gdacs" ? text(item["gdacs:episodeid"], 100) : "";
    raw.push({
      provider: id, providerId: episodeId ? `${providerId}:${episodeId}` : providerId,
      fetchedAt, payload: record,
    });
    const event = id === "usgs" ? usgsEvent(provider, providerId, record, fetchedAt)
      : id === "gdacs" ? gdacsEvent(provider, providerId, record, fetchedAt)
      : id === "reliefweb" ? reliefwebEvent(provider, providerId, record, fetchedAt)
      : newsEvent(provider, providerId, record, fetchedAt);
    if (event) events.push(event);
  }
  const unlocated = events.filter((event) => event.latitude === undefined).length;
  const skipped = raw.length - events.length;
  return {
    id, name: provider.name, url: provider.url, events, raw,
    message: [
      `${events.length} source reports imported.`,
      `${unlocated} without event coordinates.`,
      skipped ? `${skipped} incomplete records retained as raw data only.` : "",
      omitted ? `${omitted} records omitted by the ${MAX_RECORDS}-record per-refresh limit.` : "",
      VERIFICATION_NOTE,
      provider.usageNote,
    ].filter(Boolean).join(" "),
  };
}
