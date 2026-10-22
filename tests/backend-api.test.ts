import { describe, expect, it } from "vitest";
import type { AtlasEvent, EventsResponse } from "../src/types";
import { ApiInputError, applyEventFilters, matchesQuery, parseEventFilters, parseMode, validateIdentifier } from "../src/lib/server/api";

const baseEvent: AtlasEvent = {
  id: "test-event", title: "Offshore earthquake", summary: "An automated observation.",
  category: "natural-disaster", severity: 4, confidence: 75, status: "reported",
  latitude: 20, longitude: 179, locationName: "Pacific Ocean", country: "Unspecified",
  countryCode: "ZZ", region: "Asia Pacific", locationAccuracy: "approximate",
  firstReportedAt: "2026-09-13T10:00:00.000Z", lastUpdatedAt: "2026-09-13T11:30:00.000Z",
  sources: [], timeline: [], relatedEvents: [], tags: [], isDemo: false,
};
const response: EventsResponse = {
  events: [baseEvent, { ...baseEvent, id: "west", longitude: -179 },
    { ...baseEvent, id: "middle", longitude: 0 },
    { ...baseEvent, id: "unlocated", latitude: undefined, longitude: undefined }],
  mode: "live", referenceTime: "2026-09-13T12:00:00.000Z",
  updatedAt: "2026-09-13T12:00:00.000Z", sources: [], total: 4, warnings: [],
};

describe("API input boundaries", () => {
  it("defaults to live and rejects retired, invalid and repeated modes", () => {
    expect(parseMode(new URLSearchParams())).toBe("live");
    expect(parseMode(new URLSearchParams("mode=live"))).toBe("live");
    expect(() => parseMode(new URLSearchParams("mode=demo"))).toThrow(ApiInputError);
    expect(() => parseMode(new URLSearchParams("mode=pretend"))).toThrow(ApiInputError);
    expect(() => parseMode(new URLSearchParams("mode=live&mode=demo"))).toThrow(ApiInputError);
    expect(() => parseMode(new URLSearchParams("mode=live&mode=live"))).toThrow(ApiInputError);
    expect(() => parseMode(new URLSearchParams("mode="))).toThrow(ApiInputError);
  });

  it.each([
    "north=NaN&south=0&east=20&west=10",
    "north=Infinity&south=0&east=20&west=10",
    "north=&south=0&east=20&west=10",
    "north=10&south=0&east=20",
    "north=91&south=0&east=20&west=10",
    "north=10&south=20&east=20&west=10",
    "north=10&south=0&east=181&west=10",
    "north=10&north=20&south=0&east=20&west=10",
    "severity=1.5", "severity=0", "severity=8", "confidence=-1",
    "confidence=101", "since=year", "category=made-up", "category=",
  ])("rejects malformed filter %s", (query) => {
    expect(() => parseEventFilters(new URLSearchParams(query))).toThrow(ApiInputError);
  });

  it("limits query length and rejects unsafe identifiers", () => {
    expect(() => parseEventFilters(new URLSearchParams({ q: "x".repeat(251) }))).toThrow(ApiInputError);
    expect(validateIdentifier("usgs:abc-123")).toBe("usgs:abc-123");
    for (const id of ["", "../private", "<script>", "a".repeat(161), "a?url=http://localhost"]) {
      expect(() => validateIdentifier(id)).toThrow(ApiInputError);
    }
  });
});

describe("server filtering", () => {
  it("supports wrapped longitude bounds and excludes unlocated events", () => {
    const filters = parseEventFilters(new URLSearchParams("north=25&south=15&west=170&east=-170"));
    const result = applyEventFilters(response, filters);
    expect(result.events.map((item) => item.id)).toEqual(["test-event", "west"]);
    expect(result.total).toBe(2);
    expect(response.events).toHaveLength(4);
  });

  it("uses reference time, minimum thresholds and category", () => {
    const filters = parseEventFilters(new URLSearchParams("since=1h&severity=4&confidence=75&category=natural-disaster"));
    expect(applyEventFilters(response, filters).total).toBe(4);
    expect(applyEventFilters(response, { ...filters, minSeverity: 5 }).total).toBe(0);
    expect(applyEventFilters({ ...response, referenceTime: "2026-09-13T14:00:00Z" }, filters).total).toBe(0);
  });

  it("retains unknown assessments in the default view and preserves null values", () => {
    const unassessed = { ...baseEvent, severity: null, confidence: null };
    const result = applyEventFilters(
      { ...response, events: [unassessed], total: 1, updatedAt: null },
      parseEventFilters(new URLSearchParams()),
    );
    expect(result.events).toEqual([unassessed]);
    expect(result.events[0].severity).toBeNull();
    expect(result.events[0].confidence).toBeNull();
    expect(result.updatedAt).toBeNull();
  });

  it.each([
    ["", 1],
    ["severity=1&confidence=0", 1],
    ["severity=2", 0],
    ["confidence=0.1", 0],
    ["severity=7&confidence=100", 0],
  ])("does not invent assessments to satisfy thresholds %s", (query, count) => {
    const unassessed = { ...baseEvent, severity: null, confidence: null };
    const result = applyEventFilters(
      { ...response, events: [unassessed], total: 1 },
      parseEventFilters(new URLSearchParams(query)),
    );
    expect(result.total).toBe(count);
  });

  it("matches all meaningful query terms across metadata", () => {
    expect(matchesQuery(baseEvent, "offshore pacific")).toBe(true);
    expect(matchesQuery(baseEvent, "offshore europe")).toBe(false);
    expect(matchesQuery({ ...baseEvent, country: "Côte d’Ivoire" }, "cote")).toBe(true);
    const filters = parseEventFilters(new URLSearchParams("region=asia%20pacific"));
    expect(applyEventFilters(response, filters).total).toBe(4);
    expect(applyEventFilters(response, parseEventFilters(new URLSearchParams("region=All%20regions"))).total).toBe(4);
  });

  it("does not display source timestamps beyond the response reference time", () => {
    const filters = parseEventFilters(new URLSearchParams());
    expect(applyEventFilters({ ...response, referenceTime: "2026-09-13T10:00:00Z" }, filters).total).toBe(0);
  });
});
