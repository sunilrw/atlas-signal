import type { AtlasEvent, DataMode, EventCategory, EventsResponse, TimeRange } from "@/types";

export class ApiInputError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ApiInputError";
  }
}

const CATEGORY_VALUES: EventCategory[] = [
  "conflict", "military", "terrorism", "civil-unrest", "political", "diplomatic",
  "cyber", "infrastructure", "energy", "economic", "humanitarian",
  "natural-disaster", "maritime", "aviation", "health", "crime", "other",
];
const TIME_WINDOWS: Record<TimeRange, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new ApiInputError(`Use only one ${key} parameter.`);
  return values[0] ?? null;
}

export function parseMode(params: URLSearchParams): DataMode {
  const mode = single(params, "mode") ?? "live";
  if (mode !== "live") throw new ApiInputError("Only live source data is available. mode must be live.");
  return mode;
}

function numeric(params: URLSearchParams, key: string, min: number, max: number, integer = false): number | undefined {
  const raw = single(params, key);
  if (raw === null) return undefined;
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || raw.length > 24) {
    throw new ApiInputError(`${key} must be a finite number between ${min} and ${max}.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new ApiInputError(`${key} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}.`);
  }
  return value;
}

export interface ApiEventFilters {
  query: string;
  categories: EventCategory[];
  minSeverity: number;
  minConfidence: number;
  timeRange?: TimeRange;
  region: string;
  bounds?: { north: number; south: number; east: number; west: number };
}

export function parseEventFilters(params: URLSearchParams): ApiEventFilters {
  const query = (single(params, "q") ?? "").trim();
  if (query.length > 250) throw new ApiInputError("q must contain no more than 250 characters.");
  const category = single(params, "category");
  const categories = category === null ? [] : category.split(",");
  if (categories.length > CATEGORY_VALUES.length || categories.some((item) => !CATEGORY_VALUES.includes(item as EventCategory))) {
    throw new ApiInputError("category must be a comma-separated list of supported event categories.");
  }
  const since = single(params, "since");
  if (since !== null && !Object.hasOwn(TIME_WINDOWS, since)) throw new ApiInputError("since must be 1h, 6h, 24h, 7d or 30d.");
  const requestedRegion = (single(params, "region") ?? "").trim();
  if (requestedRegion.length > 100) throw new ApiInputError("region must contain no more than 100 characters.");
  const region = requestedRegion.toLowerCase() === "all regions" ? "" : requestedRegion;
  const north = numeric(params, "north", -90, 90);
  const south = numeric(params, "south", -90, 90);
  const east = numeric(params, "east", -180, 180);
  const west = numeric(params, "west", -180, 180);
  const coordinates = [north, south, east, west];
  const boundsProvided = coordinates.filter((value) => value !== undefined).length;
  if (boundsProvided > 0 && boundsProvided < 4) {
    throw new ApiInputError("Map bounds require north, south, east and west together.");
  }
  if (north !== undefined && south !== undefined && north < south) {
    throw new ApiInputError("north must be greater than or equal to south.");
  }
  return {
    query,
    categories: [...new Set(categories)] as EventCategory[],
    minSeverity: numeric(params, "severity", 1, 7, true) ?? 1,
    minConfidence: numeric(params, "confidence", 0, 100) ?? 0,
    ...(since ? { timeRange: since as TimeRange } : {}),
    region,
    ...(boundsProvided === 4
      ? { bounds: { north: north!, south: south!, east: east!, west: west! } } : {}),
  };
}

function searchable(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function matchesQuery(event: AtlasEvent, query: string): boolean {
  const terms = searchable(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = searchable([
    event.title, event.summary, event.country, event.countryCode, event.region,
    event.locationName, event.category, event.subcategory ?? "", ...event.tags,
    ...event.sources.map((source) => source.name),
  ].join(" "));
  return terms.every((term) => text.includes(term));
}

export function applyEventFilters(response: EventsResponse, filters: ApiEventFilters): EventsResponse {
  const reference = Date.parse(response.referenceTime);
  const cutoff = filters.timeRange ? reference - TIME_WINDOWS[filters.timeRange] : -Infinity;
  const events = response.events.filter((event) => {
    // The default view includes unassessed records. A requested threshold
    // requires an actual assessment, never a fabricated substitute for null.
    if (event.severity === null ? filters.minSeverity > 1 : event.severity < filters.minSeverity) return false;
    if (event.confidence === null ? filters.minConfidence > 0 : event.confidence < filters.minConfidence) return false;
    if (filters.categories.length && !filters.categories.includes(event.category)) return false;
    if (filters.region && searchable(event.region) !== searchable(filters.region)) return false;
    const updatedAt = Date.parse(event.lastUpdatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt < cutoff || updatedAt > reference || !matchesQuery(event, filters.query)) return false;
    if (filters.bounds) {
      if (event.latitude === undefined || event.longitude === undefined) return false;
      const { north, south, east, west } = filters.bounds;
      if (event.latitude > north || event.latitude < south) return false;
      // A west > east viewport crosses the international date line.
      const withinLongitude = west <= east
        ? event.longitude >= west && event.longitude <= east
        : event.longitude >= west || event.longitude <= east;
      if (!withinLongitude) return false;
    }
    return true;
  });
  return { ...response, events, total: events.length };
}

export function validateIdentifier(value: string): string {
  if (typeof value !== "string" || !/^[\w:-]{1,160}$/.test(value)) throw new ApiInputError("Invalid identifier.");
  return value;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function apiResponse(run: () => Promise<unknown>): Promise<Response> {
  try {
    return json(await run());
  } catch (error) {
    if (error instanceof ApiInputError) return json({ error: error.message }, error.status);
    return json({ error: "The requested data is temporarily unavailable." }, 503);
  }
}
