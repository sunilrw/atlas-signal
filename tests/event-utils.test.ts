import { afterEach, describe, expect, it, vi } from "vitest";
import type { AtlasEvent, EventFilters, EventSource, TimeRange, WatchlistEntry } from "../src/types";
import {
  DEFAULT_FILTERS,
  confidenceLabel,
  distanceKm,
  filterEvents,
  formatUtcDate,
  formatUtcTime,
  getEventStats,
  relativeTime,
  severityLabel,
} from "../src/lib/event-utils";

const REFERENCE = "2026-09-13T12:00:00.000Z";
const HOUR_MS = 3_600_000;

function hoursAgo(hours: number): string {
  return new Date(Date.parse(REFERENCE) - hours * HOUR_MS).toISOString();
}

function source(overrides: Partial<EventSource> = {}): EventSource {
  return {
    id: "test-source",
    name: "Test Observatory",
    url: "https://example.org/reference",
    publishedAt: hoursAgo(2),
    type: "primary",
    isDemo: false,
    ...overrides,
  };
}

function event(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  const lastUpdatedAt = overrides.lastUpdatedAt ?? hoursAgo(2);
  return {
    id: "test-event",
    title: "Test port report",
    summary: "Unit-test fixture for source-aware monitoring.",
    category: "maritime",
    severity: 4,
    status: "reported",
    confidence: 72,
    locationName: "São Paulo",
    country: "Brazil",
    countryCode: "BR",
    region: "Americas",
    locationAccuracy: "unknown",
    firstReportedAt: hoursAgo(4),
    lastUpdatedAt,
    sources: [source({ publishedAt: lastUpdatedAt })],
    timeline: [],
    relatedEvents: [],
    tags: ["shipping", "trade"],
    isDemo: false,
    ...overrides,
  };
}

function filters(overrides: Partial<EventFilters> = {}): EventFilters {
  return { ...DEFAULT_FILTERS, categories: [], ...overrides };
}

function ids(events: AtlasEvent[]): string[] {
  return events.map(({ id }) => id);
}

describe("DEFAULT_FILTERS", () => {
  it("starts with an unrestricted 24-hour window", () => {
    expect(DEFAULT_FILTERS).toEqual({
      query: "",
      categories: [],
      minSeverity: 1,
      minConfidence: 0,
      timeRange: "24h",
      region: "All regions",
      watchlistOnly: false,
    });
  });
});

describe("filterEvents", () => {
  it("sorts newest updates first, breaking timestamp ties by stable event ID", () => {
    const input = [
      event({ id: "z", lastUpdatedAt: hoursAgo(3) }),
      event({ id: "b", lastUpdatedAt: hoursAgo(1) }),
      event({ id: "a", lastUpdatedAt: hoursAgo(1) }),
    ];
    expect(ids(filterEvents(input, filters(), REFERENCE))).toEqual(["a", "b", "z"]);
    expect(ids(input)).toEqual(["z", "b", "a"]);
  });

  it("preserves nested provenance and missing coordinates without mutating inputs", () => {
    const input = [event()];
    const selectedFilters = filters({ query: "port" });
    const before = structuredClone({ input, selectedFilters });
    const result = filterEvents(input, selectedFilters, REFERENCE);
    expect(result).not.toBe(input);
    expect(result[0]).toBe(input[0]);
    expect(result[0].latitude).toBeUndefined();
    expect(result[0].longitude).toBeUndefined();
    expect({ input, selectedFilters }).toEqual(before);
  });

  it("uses OR within selected categories and AND between controls", () => {
    const input = [
      event({ id: "maritime", category: "maritime", severity: 6, confidence: 80 }),
      event({ id: "cyber", category: "cyber", severity: 5, confidence: 95 }),
      event({ id: "energy", category: "energy", severity: 7, confidence: 95 }),
      event({ id: "weak", category: "cyber", severity: 4, confidence: 95 }),
      event({ id: "uncertain", category: "maritime", severity: 6, confidence: 79 }),
    ];
    expect(
      ids(
        filterEvents(
          input,
          filters({ categories: ["maritime", "cyber"], minSeverity: 5, minConfidence: 80 }),
          REFERENCE,
        ),
      ),
    ).toEqual(["cyber", "maritime"]);
  });

  it("supports exact region selection with whitespace and case normalization", () => {
    const input = [
      event({ id: "americas" }),
      event({ id: "europe", region: "Europe" }),
    ];
    expect(ids(filterEvents(input, filters({ region: " EUROPE " }), REFERENCE))).toEqual(["europe"]);
    expect(filterEvents(input, filters({ region: "all regions" }), REFERENCE)).toHaveLength(2);
  });

  it.each<[TimeRange, number]>([
    ["1h", 1],
    ["6h", 6],
    ["24h", 24],
    ["7d", 168],
    ["30d", 720],
  ])("honors the inclusive %s time window", (timeRange, hours) => {
    const input = [
      event({
        id: "start",
        firstReportedAt: hoursAgo(hours + 2),
        lastUpdatedAt: hoursAgo(hours),
      }),
      event({ id: "end", lastUpdatedAt: REFERENCE }),
      event({
        id: "too-old",
        firstReportedAt: hoursAgo(hours + 2),
        lastUpdatedAt: new Date(Date.parse(hoursAgo(hours)) - 1).toISOString(),
      }),
      event({
        id: "future",
        lastUpdatedAt: new Date(Date.parse(REFERENCE) + 1).toISOString(),
      }),
    ];
    expect(ids(filterEvents(input, filters({ timeRange }), REFERENCE))).toEqual(["end", "start"]);
  });

  it("filters by last update, not first report, for a long-running event", () => {
    const input = [event({ firstReportedAt: hoursAgo(200), lastUpdatedAt: hoursAgo(0.5) })];
    expect(filterEvents(input, filters({ timeRange: "1h" }), REFERENCE)).toHaveLength(1);
  });

  it("applies offset-bearing timestamps as absolute instants", () => {
    const input = [event({ lastUpdatedAt: "2026-09-13T13:30:00+02:00" })];
    expect(filterEvents(input, filters({ timeRange: "1h" }), REFERENCE)).toHaveLength(1);
  });

  it("moves the whole window backward during snapshot playback", () => {
    const input = [
      event({ id: "at-cutoff", firstReportedAt: hoursAgo(10), lastUpdatedAt: hoursAgo(6) }),
      event({ id: "at-start", firstReportedAt: hoursAgo(20), lastUpdatedAt: hoursAgo(12) }),
      event({ id: "older", firstReportedAt: hoursAgo(20), lastUpdatedAt: hoursAgo(12.001) }),
      event({ id: "future-report", firstReportedAt: hoursAgo(5), lastUpdatedAt: hoursAgo(4) }),
      event({ id: "future-update", firstReportedAt: hoursAgo(10), lastUpdatedAt: hoursAgo(5) }),
    ];
    expect(
      ids(filterEvents(input, filters({ timeRange: "6h" }), REFERENCE, 6)),
    ).toEqual(["at-cutoff", "at-start"]);
  });

  it("does not fabricate earlier state from the timeline of an updated snapshot", () => {
    const latest = event({
      firstReportedAt: hoursAgo(10),
      lastUpdatedAt: hoursAgo(1),
      status: "resolved",
      timeline: [{ id: "early-update", timestamp: hoursAgo(8), title: "Earlier report" }],
    });
    expect(filterEvents([latest], filters(), REFERENCE, 6)).toEqual([]);
    expect(latest.status).toBe("resolved");
    expect(latest.timeline).toHaveLength(1);
  });

  it("excludes snapshots with future source or timeline metadata even if lastUpdatedAt is older", () => {
    const base = { firstReportedAt: hoursAgo(10), lastUpdatedAt: hoursAgo(8) };
    const input = [
      event({ ...base, id: "future-source", sources: [source({ publishedAt: hoursAgo(2) })] }),
      event({
        ...base,
        id: "future-timeline",
        timeline: [{ id: "future-update", timestamp: hoursAgo(2), title: "Not yet known" }],
      }),
      event({
        ...base,
        id: "visible",
        timeline: [{ id: "known-update", timestamp: hoursAgo(6), title: "Known at cutoff" }],
      }),
    ];
    expect(ids(filterEvents(input, filters(), REFERENCE, 6))).toEqual(["visible"]);
  });

  it("excludes source and timeline metadata with invalid timestamps", () => {
    const input = [
      event({ id: "bad-source", sources: [source({ publishedAt: "not-a-date" })] }),
      event({
        id: "bad-update",
        timeline: [{ id: "bad-date", timestamp: "not-a-date", title: "Unknown time" }],
      }),
    ];
    expect(filterEvents(input, filters(), REFERENCE)).toEqual([]);
  });

  it.each([-3, Number.NaN, Number.POSITIVE_INFINITY])(
    "treats an invalid playback offset %s as zero, never advancing time",
    (offset) => {
      const input = [event()];
      expect(filterEvents(input, filters(), REFERENCE, offset)).toEqual(input);
    },
  );

  it("supports fractional playback offsets", () => {
    const input = [
      event({ id: "before", lastUpdatedAt: hoursAgo(1) }),
      event({ id: "after", lastUpdatedAt: hoursAgo(0.25) }),
    ];
    expect(ids(filterEvents(input, filters(), REFERENCE, 0.5))).toEqual(["before"]);
  });

  it("uses watchlist values, matching countries case-insensitively and event IDs exactly", () => {
    const watchlist: WatchlistEntry[] = [
      { id: "saved-country", kind: "country", label: "Brazil", value: " br " },
      { id: "saved-event", kind: "event", label: "Specific event", value: "chosen" },
    ];
    const input = [
      event({ id: "country-match" }),
      event({ id: "chosen", countryCode: "FR" }),
      event({ id: "saved-event", countryCode: "FR" }),
      event({ id: "CHOSEN", countryCode: "FR" }),
    ];
    expect(
      ids(filterEvents(input, filters({ watchlistOnly: true }), REFERENCE, 0, watchlist)),
    ).toEqual(["chosen", "country-match"]);
  });

  it("returns no events for an empty active watchlist; ignores it when inactive", () => {
    const input = [event()];
    expect(filterEvents(input, filters({ watchlistOnly: true }), REFERENCE)).toEqual([]);
    expect(filterEvents(input, filters(), REFERENCE)).toHaveLength(1);
  });

  it("does not match unspecified countries with an empty saved watchlist value", () => {
    const input = [event({ countryCode: "" })];
    const watchlist: WatchlistEntry[] = [
      { id: "empty-country", kind: "country", label: "", value: " " },
      { id: "empty-event", kind: "event", label: "", value: "" },
    ];
    expect(filterEvents(input, filters({ watchlistOnly: true }), REFERENCE, 0, watchlist)).toEqual([]);
  });

  it.each([
    "PORT",
    "fixture",
    "Brazil",
    "br",
    "Sao Paulo",
    "Americas",
    "shipping",
    "maritime",
    "Observatory",
    "example.org/reference",
  ])("searches meaningful event/source fields for %s", (query) => {
    expect(filterEvents([event()], filters({ query }), REFERENCE)).toHaveLength(1);
  });

  it("matches query tokens across fields using AND with normalized whitespace", () => {
    expect(
      filterEvents([event()], filters({ query: "  PORT\t brazil \n Observatory " }), REFERENCE),
    ).toHaveLength(1);
    expect(
      filterEvents([event()], filters({ query: "port nonexistent" }), REFERENCE),
    ).toEqual([]);
    expect(filterEvents([event()], filters({ query: " \t\n " }), REFERENCE)).toHaveLength(1);
  });

  it("searches readable category names and optional subcategories", () => {
    const input = [event({ category: "civil-unrest", subcategory: "public gathering" })];
    expect(
      filterEvents(input, filters({ query: "civil unrest public gathering" }), REFERENCE),
    ).toHaveLength(1);
    expect(filterEvents([event()], filters({ query: "test port" }), REFERENCE)).toHaveLength(1);
  });

  it("excludes invalid dates and impossible first-report/update chronology", () => {
    const input = [
      event({ id: "bad-first", firstReportedAt: "not-a-date" }),
      event({ id: "bad-update", lastUpdatedAt: "" }),
      event({ id: "reversed", firstReportedAt: hoursAgo(1), lastUpdatedAt: hoursAgo(2) }),
      event({ id: "future-first", firstReportedAt: hoursAgo(-1), lastUpdatedAt: hoursAgo(-2) }),
      event({ id: "impossible-date", firstReportedAt: "2026-02-30T10:00:00Z" }),
      event({ id: "local-date", lastUpdatedAt: "2026-09-13T11:00:00" }),
      event({ id: "valid" }),
    ];
    expect(ids(filterEvents(input, filters(), REFERENCE))).toEqual(["valid"]);
    expect(filterEvents(input, filters(), "invalid-reference")).toEqual([]);
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "excludes out-of-domain confidence %s",
    (confidence) => {
      expect(filterEvents([event({ confidence })], filters(), REFERENCE)).toEqual([]);
    },
  );

  it.each([0, 8, 1.5, Number.NaN])("excludes invalid severity %s", (severity) => {
    const invalid = event({ severity: severity as AtlasEvent["severity"] });
    expect(filterEvents([invalid], filters(), REFERENCE)).toEqual([]);
  });

  it("supports zero confidence and clamps invalid filter thresholds safely", () => {
    const input = [event({ severity: 1, confidence: 0 })];
    expect(filterEvents(input, filters(), REFERENCE)).toHaveLength(1);
    expect(
      filterEvents(input, filters({ minSeverity: Number.NaN, minConfidence: -10 }), REFERENCE),
    ).toHaveLength(1);
  });

  it.each([
    { severity: null, confidence: null },
    { severity: null, confidence: 72 },
    { severity: 4, confidence: null },
  ] satisfies Partial<AtlasEvent>[])(
    "keeps unassessed scores visible with unrestricted controls: %j",
    (scores) => {
      const input = [event(scores)];
      const before = structuredClone(input);
      expect(filterEvents(input, filters(), REFERENCE)).toEqual(input);
      expect(input).toEqual(before);
    },
  );

  it.each([1.01, 2, 7])("excludes unassessed severity at an explicit minimum of %s", (minimum) => {
    const input = [event({ severity: null })];
    expect(filterEvents(input, filters({ minSeverity: minimum }), REFERENCE)).toEqual([]);
  });

  it.each([0.01, 1, 80, 100])(
    "excludes unassessed confidence at an explicit minimum of %s",
    (minimum) => {
      const input = [event({ confidence: null })];
      expect(filterEvents(input, filters({ minConfidence: minimum }), REFERENCE)).toEqual([]);
    },
  );

  it("handles mixed assessed and unassessed records without inventing scores", () => {
    const input = [
      event({ id: "unassessed", severity: null, confidence: null }),
      event({ id: "hazard", severity: 6, confidence: null }),
      event({ id: "assessed", severity: 5, confidence: 80 }),
    ];
    expect(ids(filterEvents(input, filters(), REFERENCE))).toEqual(["assessed", "hazard", "unassessed"]);
    expect(ids(filterEvents(input, filters({ minSeverity: 6 }), REFERENCE))).toEqual(["hazard"]);
    expect(ids(filterEvents(input, filters({ minConfidence: 80 }), REFERENCE))).toEqual(["assessed"]);
    expect(input[0].severity).toBeNull();
    expect(input[0].confidence).toBeNull();
    expect(input[1].confidence).toBeNull();
  });

  it("still applies the known score threshold when the other score is unassessed", () => {
    expect(
      filterEvents(
        [event({ severity: null, confidence: 20 })],
        filters({ minConfidence: 80 }),
        REFERENCE,
      ),
    ).toEqual([]);
    expect(
      filterEvents(
        [event({ severity: 2, confidence: null })],
        filters({ minSeverity: 5 }),
        REFERENCE,
      ),
    ).toEqual([]);
  });

  it("treats invalid minimum controls as unrestricted for unassessed reports", () => {
    const input = [event({ severity: null, confidence: null })];
    expect(
      filterEvents(input, filters({ minSeverity: Number.NaN, minConfidence: -1 }), REFERENCE),
    ).toEqual(input);
  });

  it.each(["invalid", "__proto__", "toString"])(
    "uses the default time window for invalid persisted time range %s",
    (timeRange) => {
      const input = [
        event(),
        event({ id: "old", firstReportedAt: hoursAgo(40), lastUpdatedAt: hoursAgo(30) }),
      ];
      expect(
        ids(filterEvents(input, filters({ timeRange: timeRange as TimeRange }), REFERENCE)),
      ).toEqual(["test-event"]);
    },
  );
});

describe("UTC time helpers", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    [REFERENCE, "just now"],
    [hoursAgo(0.01), "just now"],
    [hoursAgo(1 / 60), "1m ago"],
    [hoursAgo(0.5), "30m ago"],
    [hoursAgo(1), "1h ago"],
    [hoursAgo(23), "23h ago"],
    [hoursAgo(24), "1d ago"],
    [hoursAgo(72), "3d ago"],
    [hoursAgo(-0.01), "in a moment"],
    [hoursAgo(-0.5), "in 30m"],
    [hoursAgo(-2), "in 2h"],
    [hoursAgo(-48), "in 2d"],
  ])("formats %s relative to an explicit reference", (iso, expected) => {
    expect(relativeTime(iso, REFERENCE)).toBe(expected);
  });

  it("defaults to the current clock only when the reference is omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(REFERENCE));
    expect(relativeTime(hoursAgo(1))).toBe("1h ago");
    expect(relativeTime(hoursAgo(1), "")).toBe("—");
  });

  it("formats UTC, including across local DST and calendar boundaries", () => {
    expect(formatUtcTime(REFERENCE)).toBe("12:00 UTC");
    expect(formatUtcDate(REFERENCE)).toBe("13 Sep 2026");
    expect(formatUtcTime("2026-10-25T01:30:00+01:00")).toBe("00:30 UTC");
    expect(formatUtcTime("2026-09-13T17:30:00+05:30")).toBe("12:00 UTC");
    expect(formatUtcTime("2026-09-13T00:00:00Z")).toBe("00:00 UTC");
    expect(formatUtcDate("2026-09-13T00:30:00+02:00")).toBe("12 Sep 2026");
    expect(formatUtcDate("2026-09-13")).toBe("13 Sep 2026");
    expect(formatUtcDate("2024-02-29T12:00:00Z")).toBe("29 Feb 2024");
    expect(formatUtcDate("2000-02-29T12:00:00Z")).toBe("29 Feb 2000");
  });

  it.each([
    "",
    "not-a-date",
    "2026-99-99T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2026-04-31",
    "2026-09-13T12:00:00",
    "2026-09-13T24:00:00Z",
    "2026-09-13T12:60:00Z",
    "2026-09-13T12:00:60Z",
    "2026-09-13T12:00:00+24:00",
    "2026-09-13T12:00:00+02:60",
  ])("handles invalid timestamp %s", (iso) => {
    expect(formatUtcTime(iso)).toBe("—");
    expect(formatUtcDate(iso)).toBe("—");
    expect(relativeTime(iso, REFERENCE)).toBe("—");
  });

  it("handles an invalid relative reference", () => {
    expect(relativeTime(REFERENCE, "invalid")).toBe("—");
  });
});

describe("score labels", () => {
  it("labels missing assessments explicitly without implying verification", () => {
    expect(severityLabel(null)).toBe("Unassessed");
    expect(confidenceLabel(null)).toBe("Not independently verified");
  });

  it.each([
    [0, "Low"],
    [0.95, "Low"],
    [49.99, "Low"],
    [50, "Moderate"],
    [79.99, "Moderate"],
    [80, "High"],
    [100, "High"],
  ])("labels confidence %s on its 0-100 scale", (confidence, expected) => {
    expect(confidenceLabel(confidence)).toBe(expected);
    expect(confidenceLabel(confidence)).not.toMatch(/verified|corroborated/i);
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not label invalid confidence %s",
    (confidence) => expect(confidenceLabel(confidence)).toBe("—"),
  );

  it.each([
    [1, "Minimal"],
    [2, "Low"],
    [3, "Moderate"],
    [4, "Significant"],
    [5, "High"],
    [6, "Severe"],
    [7, "Critical"],
  ])("uses the editorial label for severity %s", (severity, expected) => {
    expect(severityLabel(severity)).toBe(expected);
  });

  it.each([0, 8, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not label invalid severity %s",
    (severity) => expect(severityLabel(severity)).toBe("—"),
  );
});

describe("getEventStats", () => {
  it("provides zero counts for no events", () => {
    expect(getEventStats([])).toEqual({ total: 0, critical: 0, developing: 0, countries: 0, sources: 0 });
  });

  it("counts critical-only snapshots, explicit developing status, unique countries and URLs", () => {
    const input = [
      event({ id: "severe", severity: 6, status: "developing" }),
      event({
        id: "critical",
        severity: 7,
        countryCode: " br ",
        confidence: 100,
        sources: [source({ id: "another-id", url: "https://EXAMPLE.ORG:443/reference#section" })],
      }),
      event({
        id: "different",
        severity: 5,
        countryCode: "FR",
        sources: [source({ url: "https://example.org/another-reference" })],
      }),
    ];
    const before = structuredClone(input);
    expect(getEventStats(input)).toEqual({
      total: 3,
      critical: 1,
      developing: 1,
      countries: 2,
      sources: 2,
    });
    expect(input).toEqual(before);
  });

  it.each<[AtlasEvent["severity"], number]>([
    [null, 0],
    [6, 0],
    [7, 1],
  ])("counts severity %s as %s Critical events", (severity, critical) => {
    expect(getEventStats([event({ severity })]).critical).toBe(critical);
  });

  it("counts publication links without implying separate publishers or corroboration", () => {
    const input = [
      event({
        severity: null,
        confidence: null,
        sources: [
          source({ id: "report-one", url: "https://example.org/report-one" }),
          source({ id: "report-two", url: "https://example.org/report-two" }),
          source({ id: "report-one-repeated", url: "https://example.org/report-one#updates" }),
        ],
      }),
    ];
    expect(getEventStats(input)).toEqual({
      total: 1,
      critical: 0,
      developing: 0,
      countries: 1,
      sources: 2,
    });
  });

  it("does not multiply publication counts through tracking parameters or reordered query keys", () => {
    const input = [
      event({
        sources: [
          source({ url: "https://example.org/report?id=1&lang=en" }),
          source({ url: "https://example.org/report?lang=en&id=1&utm_source=feed#latest" }),
          source({ url: "https://example.org/report?id=1&lang=en&fbclid=tracking&gclid=tracking" }),
          source({ url: "https://example.org/report?id=2&lang=en" }),
        ],
      }),
    ];
    expect(getEventStats(input).sources).toBe(2);
    expect(input[0].sources[1].url).toContain("utm_source");
  });

  it("omits unsafe/invalid source URLs and blank countries from aggregate counts", () => {
    const input = [
      event({
        countryCode: "",
        country: " ",
        sources: [
          source({ url: "javascript:alert(1)" }),
          source({ url: "file:///tmp/reference" }),
          source({ url: "/relative-reference" }),
          source({ url: "not-a-url" }),
        ],
      }),
      event({ id: "named-country", countryCode: "", country: "Brazil", sources: [] }),
    ];
    expect(getEventStats(input)).toEqual({
      total: 2,
      critical: 0,
      developing: 0,
      countries: 1,
      sources: 0,
    });
  });

  it("does not count unspecified countries or count named/code variants twice", () => {
    const input = [
      event({ id: "known-brazil" }),
      event({ id: "named-brazil", countryCode: "", country: "brazil" }),
      event({ id: "unspecified-code", countryCode: "ZZ", country: "Unspecified" }),
      event({ id: "unknown", countryCode: "", country: "Unknown" }),
      event({ id: "global", countryCode: "", country: "Global" }),
      event({ id: "belgium-code", countryCode: "BE", country: "Belgium" }),
      event({ id: "belgium-name", countryCode: "", country: "Belgium" }),
    ];
    expect(getEventStats(input).countries).toBe(2);
  });
});

describe("distanceKm", () => {
  it("accepts valid zero coordinates and identical locations", () => {
    expect(distanceKm(0, 0, 0, 0)).toBe(0);
    expect(distanceKm(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });

  it("computes a symmetric great-circle distance", () => {
    const forward = distanceKm(0, 0, 0, 1);
    expect(forward).toBeCloseTo(111.195, 2);
    expect(distanceKm(0, 1, 0, 0)).toBeCloseTo(forward, 10);
  });

  it("takes the short path over the antimeridian and stays finite at antipodes", () => {
    expect(distanceKm(0, 179, 0, -179)).toBeCloseTo(222.39, 2);
    expect(distanceKm(0, 0, 0, 180)).toBeCloseTo(20_015.114, 2);
    expect(distanceKm(90, 0, -90, 0)).toBeCloseTo(20_015.114, 2);
  });

  it.each([
    [91, 0, 0, 0],
    [0, 181, 0, 0],
    [0, 0, -91, 0],
    [0, 0, 0, -181],
    [Number.NaN, 0, 0, 0],
    [0, Number.POSITIVE_INFINITY, 0, 0],
    [0, 0, Number.NEGATIVE_INFINITY, 0],
  ])("does not invent a distance for invalid coordinates %j", (...coordinates) => {
    expect(distanceKm(...(coordinates as [number, number, number, number]))).toBeNaN();
  });
});
