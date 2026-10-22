import { countries } from "@/lib/catalog";
import { ApiInputError } from "@/lib/server/api";
import type { AtlasEvent, EventsResponse } from "@/types";

export function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

export function matchesText(values: string[], query: string): boolean {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const text = normalized(values.join(" "));
  return terms.every((term) => text.includes(term));
}

export function responseContext(response: EventsResponse) {
  return {
    mode: response.mode,
    referenceTime: response.referenceTime,
    updatedAt: response.updatedAt,
    sources: response.sources,
    warnings: response.warnings,
  };
}

export function countryByIdentifier(identifier: string) {
  if (typeof identifier !== "string" || !/^[\p{L}\p{N}' -]{1,100}$/u.test(identifier)) {
    throw new ApiInputError("Invalid country identifier.");
  }
  const value = normalized(identifier);
  const country = countries.find((item) =>
    [item.code, item.slug, item.name].some((candidate) => normalized(candidate) === value),
  );
  if (!country) throw new ApiInputError("Country not found.", 404);
  return country;
}

export function withEvents(response: EventsResponse, events: AtlasEvent[]): EventsResponse {
  return { ...response, events, total: events.length };
}

export const LIVE_CONFLICT_NOTICE =
  "No curated live conflict assessments are configured. An empty catalog does not imply that no conflicts exist.";
