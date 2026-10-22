import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasEvent } from "../src/types";
import { classifyText, normalizeLiveEvent, plainText, processEvents, safeSourceUrl, validDate } from "../src/lib/server/pipeline";

const NOW = "2026-09-13T12:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Synthetic records are confined to this test file, never application data. */
function event(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    id: "usgs-test1",
    title: "M 5.2 earthquake near Test Island",
    summary: "Test-only hazard source record.",
    category: "natural-disaster",
    subcategory: "earthquake",
    severity: 3,
    severityReason: "Derived from provider magnitude 5.2; this is not a measured impact assessment.",
    status: "reported",
    confidence: 75,
    reportKind: "incident",
    latitude: 10,
    longitude: 20,
    locationName: "Near Test Island",
    locationAccuracy: "approximate",
    country: "Unspecified",
    countryCode: "ZZ",
    region: "Unspecified",
    firstReportedAt: "2026-09-13T10:00:00.000Z",
    lastUpdatedAt: "2026-09-13T10:30:00.000Z",
    sources: [{
      id: "source-1",
      name: "USGS",
      url: "https://earthquake.usgs.gov/earthquakes/eventpage/test1",
      publishedAt: "2026-09-13T10:00:00.000Z",
      type: "primary",
    }],
    timeline: [{ id: "update1", timestamp: "2026-09-13T10:00:00.000Z", title: "Initial provider report" }],
    relatedEvents: [],
    tags: ["earthquake"],
    isDemo: false,
    ...overrides,
  };
}

describe("live normalization and provenance", () => {
  it("rejects demo contamination and incomplete records", () => {
    expect(normalizeLiveEvent(event({ isDemo: true }))).toBeNull();
    expect(normalizeLiveEvent(event({ firstReportedAt: "not-a-date" }))).toBeNull();
    expect(normalizeLiveEvent({ title: "Incomplete record" })).toBeNull();
  });

  it.each([null, undefined, [], "record", 42, {}])("rejects a non-record payload %j", (value) => {
    expect(normalizeLiveEvent(value)).toBeNull();
  });

  it.each(["demo", "demo-test", "demo:test", "DEMO-old", "../private", "<script>", "a".repeat(161)])(
    "rejects retired or invalid event identifier %s",
    (id) => {
      expect(normalizeLiveEvent(event({ id }))).toBeNull();
    },
  );

  it("requires an explicit non-demo origin rather than assuming one", () => {
    expect(normalizeLiveEvent(event({ isDemo: undefined }))).toBeNull();
  });

  it.each([
    { isDemo: true },
    { id: "demo-reference" },
    { id: "demo:reference" },
    { id: "DEMO" },
  ])("rejects even mixed live and retired fictional provenance %j", (overrides) => {
    expect(normalizeLiveEvent(event({
      sources: [event().sources[0], { ...event().sources[0], ...overrides }],
    }))).toBeNull();
  });

  it("retains only paired finite coordinates and does not invent missing locations", () => {
    const normalized = normalizeLiveEvent(event({ latitude: 12, longitude: undefined }));
    expect(normalized).not.toHaveProperty("latitude");
    expect(normalized).not.toHaveProperty("longitude");
    expect(normalized?.locationAccuracy).toBe("unknown");
    expect(normalizeLiveEvent(event({ longitude: 999 }))?.latitude).toBeUndefined();
    expect(normalizeLiveEvent(event({ latitude: Number.NaN }))?.latitude).toBeUndefined();
    expect(normalizeLiveEvent(event({ latitude: 0, longitude: 0 }))?.latitude).toBe(0);
  });

  it("rejects unsafe source URLs without stripping valid source provenance", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hello", "https://secret:token@example.com/a", "/relative/article", "ftp://example.org/article"]) {
      expect(safeSourceUrl(url)).toBeNull();
      expect(normalizeLiveEvent(event({ sources: [{ ...event().sources[0], url }] }))).toBeNull();
    }
    expect(normalizeLiveEvent(event())?.sources[0].url).toBe(event().sources[0].url);
    expect(safeSourceUrl("http://example.org/article")).toBe("http://example.org/article");
    expect(safeSourceUrl(`https://example.org/${"a".repeat(2_048)}`)).toBeNull();
  });

  it("retains publisher wording, attribution and the distinct source and detection clocks", () => {
    const input = event({
      title: "Publisher says an assessment remains disputed",
      summary: "The publisher attributes the estimate to its named source.",
      detectedAt: "2026-09-13T11:45:00Z",
      verificationNote: "Publisher reporting; Atlas Signal has not independently verified it.",
      locationEvidence: "Coordinates provided by the upstream source.",
      sources: [{
        ...event().sources[0],
        name: "Named publisher",
        providerId: "news-aggregator",
        publisherCountry: "United Kingdom",
        language: "English",
        byline: "Reporter Name",
        publishedAt: "2026-09-13T10:15:00+01:00",
        observedAt: "2026-09-13T11:35:00Z",
        timestampBasis: "observed",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      }],
    });
    const result = normalizeLiveEvent(input)!;
    expect(result.title).toBe(input.title);
    expect(result.summary).toBe(input.summary);
    expect(result.verificationNote).toBe(input.verificationNote);
    expect(result.locationEvidence).toBe(input.locationEvidence);
    expect(result.detectedAt).toBe("2026-09-13T11:45:00.000Z");
    expect(result.firstReportedAt).toBe("2026-09-13T10:00:00.000Z");
    expect(result.lastUpdatedAt).toBe("2026-09-13T10:30:00.000Z");
    expect(result.sources[0]).toMatchObject({
      name: "Named publisher",
      providerId: "news-aggregator",
      publisherCountry: "United Kingdom",
      language: "English",
      byline: "Reporter Name",
      publishedAt: "2026-09-13T09:15:00.000Z",
      observedAt: "2026-09-13T11:35:00.000Z",
      timestampBasis: "observed",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    });
  });

  it("does not retain unsafe attribution-license links", () => {
    for (const licenseUrl of ["javascript:alert(1)", "file:///etc/passwd", "https://secret:token@example.org/license"]) {
      expect(normalizeLiveEvent(event({
        sources: [{ ...event().sources[0], licenseUrl }],
      }))).toBeNull();
    }
  });

  it("converts provider markup to bounded text", () => {
    expect(plainText("<script>alert(1)</script><b>Flood</b>&nbsp;&amp; damage")).toBe("Flood & damage");
    expect(plainText("a".repeat(10_000))).toHaveLength(4_000);
    const result = normalizeLiveEvent(event({ title: "<b>Earthquake</b>", confidence: Number.NaN, severity: 90 as AtlasEvent["severity"] }));
    expect(result?.title).toBe("Earthquake");
    expect(result?.severity).toBeNull();
    expect(result?.confidence).toBeNull();
    expect(result?.status).toBe("reported");
    expect(result?.tags).not.toContain("automated-confidence");
    expect(result).not.toHaveProperty("severityReason");
  });

  it("uses transparent conservative fallback classification", () => {
    expect(classifyText("Earthquake reported offshore")).toBe("natural-disaster");
    expect(classifyText("Ransomware affects a provider")).toBe("cyber");
    expect(classifyText("An unidentified situation")).toBe("other");
    const result = normalizeLiveEvent({ ...event(), category: "unknown-category" });
    expect(result?.category).toBe("natural-disaster");
    expect(result?.tags).toContain("automated-classification");
    expect(result?.confidence).toBeNull();
  });

  it("retains provider status without creating confirmation from source availability", () => {
    expect(normalizeLiveEvent({ ...event(), status: "invalid" })?.status).toBe("reported");
    expect(normalizeLiveEvent(event({ status: "disputed" }))?.status).toBe("disputed");
    expect(normalizeLiveEvent(event())?.verificationNote).toContain("not independently verified");
  });

  it("removes legacy inferred relationships and score tags without inventing a timeline", () => {
    const result = normalizeLiveEvent(event({
      severity: null,
      timeline: [],
      relatedEvents: ["demo-old", "other-nearby-event"],
      tags: ["earthquake", "automated-confidence", "automated-severity", "contextual-links-not-corroboration"],
    }));
    expect(result?.relatedEvents).toEqual([]);
    expect(result?.timeline).toEqual([]);
    expect(result?.tags).toEqual(["earthquake"]);
  });
});

describe("unassessed values and disclosed hazard severity", () => {
  it.each([undefined, null, -1, 0, 45, 75, 100, 101, Number.NaN, Infinity])(
    "never invents calibrated confidence from %s",
    (confidence) => {
      expect(normalizeLiveEvent(event({ confidence }))?.confidence).toBeNull();
    },
  );

  it.each([1, 2, 3, 4, 5, 6, 7] as const)("retains hazard severity %s only with its disclosed basis", (severity) => {
    const result = normalizeLiveEvent(event({ severity }))!;
    expect(result.severity).toBe(severity);
    expect(result.severityReason).toBe(event().severityReason);
    expect(result.confidence).toBeNull();
  });

  it.each([undefined, null, -1, 0, 1.5, 8, 90, Number.NaN, Infinity])(
    "keeps invalid or missing hazard severity %s unknown rather than clamping it",
    (severity) => {
      const result = normalizeLiveEvent({ ...event(), severity });
      expect(result?.severity).toBeNull();
      expect(result).not.toHaveProperty("severityReason");
    },
  );

  it.each([
    { severityReason: undefined },
    { severityReason: "" },
    { severityReason: "<script>not a basis</script>" },
    { category: "conflict" as const },
    { category: "political" as const },
    { reportKind: "news" as const },
    { reportKind: "analysis" as const },
    { sources: [{ ...event().sources[0], type: "news" as const }] },
    { sources: [{ ...event().sources[0], type: "dataset" as const }] },
    { sources: [{ ...event().sources[0], type: "ngo" as const }] },
  ])("does not assess severity without an eligible primary hazard basis %j", (overrides) => {
    const result = normalizeLiveEvent(event(overrides));
    expect(result?.severity).toBeNull();
    expect(result).not.toHaveProperty("severityReason");
  });
});

describe("source timestamp validity", () => {
  it.each([
    "1970-01-01T00:00:00Z",
    "2024-02-29T12:00:00Z",
    "2026-09-13T11:30:00.123456789Z",
    "2026-09-13T12:00:00+01:00",
    "2026-09-13T06:00:00-05:00",
  ])("accepts strict ISO timestamps %s", (timestamp) => {
    expect(validDate(timestamp)).toBe(true);
  });

  it.each([
    "", "not-a-date", "2026-09-13", "September 13, 2026", "2026-09-13 10:00:00Z",
    "2026-02-29T10:00:00Z", "2026-04-31T10:00:00Z", "2026-00-01T10:00:00Z",
    "2026-13-01T10:00:00Z", "2026-09-00T10:00:00Z", "2026-09-32T10:00:00Z",
    "2026-09-13T10:00:00", "2026-09-13T10:00:00+01:90", "1969-12-31T23:59:59Z",
  ])("rejects invalid or ambiguous calendar timestamps %s", (timestamp) => {
    expect(validDate(timestamp)).toBe(false);
    expect(normalizeLiveEvent(event({ firstReportedAt: timestamp }))).toBeNull();
  });

  it.each(["firstReportedAt", "lastUpdatedAt", "detectedAt"] as const)(
    "rejects future %s instead of replacing it with the fetch time",
    (field) => {
      expect(normalizeLiveEvent(event({ [field]: "2026-09-13T12:00:00.001Z" }))).toBeNull();
    },
  );

  it("rejects update timestamps preceding the initial report", () => {
    expect(normalizeLiveEvent(event({ lastUpdatedAt: "2026-09-13T09:59:59Z" }))).toBeNull();
  });

  it("accepts the current instant and canonicalizes explicit timezone offsets", () => {
    const result = normalizeLiveEvent(event({
      firstReportedAt: "2026-09-13T11:00:00+01:00",
      lastUpdatedAt: NOW,
      detectedAt: NOW,
    }));
    expect(result?.firstReportedAt).toBe("2026-09-13T10:00:00.000Z");
    expect(result?.lastUpdatedAt).toBe(NOW);
    expect(result?.detectedAt).toBe(NOW);
  });

  it.each([
    { publishedAt: "2026-09-13T12:00:00.001Z" },
    { publishedAt: "2026-02-29T10:00:00Z" },
    { publishedAt: "2026-09-13" },
    { observedAt: "2026-09-13T12:00:00.001Z" },
    { observedAt: "not-a-date" },
  ])("omits source provenance with invalid clocks %j without generating timestamps", (overrides) => {
    const invalidSource = { ...event().sources[0], ...overrides };
    expect(normalizeLiveEvent(event({ sources: [invalidSource] }))).toBeNull();
    const result = normalizeLiveEvent(event({ sources: [invalidSource, event().sources[0]] }));
    expect(result?.sources).toHaveLength(1);
    expect(result?.sources[0].publishedAt).toBe("2026-09-13T10:00:00.000Z");
  });

  it("drops future, malformed and retired timeline entries while retaining source updates", () => {
    const result = normalizeLiveEvent(event({
      timeline: [
        { id: "later", timestamp: "2026-09-13T11:00:00Z", title: "Later source update" },
        { id: "future", timestamp: "2026-09-13T12:00:00.001Z", title: "Future entry" },
        { id: "invalid", timestamp: "2026-02-29T11:00:00Z", title: "Invalid calendar date" },
        { id: "demo-old", timestamp: "2026-09-13T10:00:00Z", title: "Retired fabricated entry" },
        event().timeline[0],
      ],
    }));
    expect(result?.timeline.map(({ id }) => id)).toEqual(["update1", "later"]);
    expect(result?.timeline[1].timestamp).toBe("2026-09-13T11:00:00.000Z");
  });
});

describe("conservative deduplication", () => {
  it("consolidates repeat provider IDs, retains history and does not boost confidence", () => {
    const original = event();
    const update = event({
      title: "Updated earthquake report",
      lastUpdatedAt: "2026-09-13T11:00:00.000Z",
      confidence: 70,
      timeline: [{ id: "update2", timestamp: "2026-09-13T11:00:00.000Z", title: "Magnitude revised" }],
    });
    const result = processEvents([original, update]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe(update.title);
    expect(result[0].timeline).toHaveLength(2);
    expect(result[0].sources).toHaveLength(1);
    expect(result[0].confidence).toBeNull();
    expect(result[0].tags).toContain("duplicate-records-consolidated");
  });

  it("recognizes shared article+headline with tracking parameters as repetition, not independent corroboration", () => {
    const syndicated = event({
      id: "news-copy",
      sources: [{ ...event().sources[0], url: `${event().sources[0].url}?utm_source=copy#latest` }],
    });
    const result = processEvents([event(), syndicated]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBeNull();
  });

  it("never merges nearby earthquakes based on coordinates or time alone", () => {
    const second = event({
      id: "usgs-aftershock",
      title: "Another earthquake in the same area",
      latitude: 10.02,
      firstReportedAt: "2026-09-13T10:03:00.000Z",
      sources: [{ ...event().sources[0], url: "https://earthquake.usgs.gov/earthquakes/eventpage/aftershock" }],
    });
    const result = processEvents([event(), second]);
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.relatedEvents.length === 0)).toBe(true);
    expect(result.every((item) => !item.tags.includes("contextual-links-not-corroboration"))).toBe(true);
    expect(result.every((item) => item.confidence === null)).toBe(true);
  });

  it("does not merge different incident types or unrelated headlines sharing a source homepage", () => {
    const homepage = event({ sources: [{ ...event().sources[0], url: "https://example.org/" }] });
    expect(processEvents([homepage, event({ ...homepage, id: "second" })])).toHaveLength(2);
    expect(processEvents([event(), event({ id: "political-event", category: "political" })])).toHaveLength(2);
    expect(processEvents([event(), event({ id: "new-report", title: "Unrelated event referenced in same source" })])).toHaveLength(2);
  });

  it.each(["old-first", "new-first"])("retains the earliest detection and source report during %s deduplication", (order) => {
    const original = event({
      firstReportedAt: "2026-09-13T09:00:00Z",
      detectedAt: "2026-09-13T10:10:00Z",
    });
    const revised = event({
      title: "Revised publisher headline",
      summary: "Revised publisher summary",
      firstReportedAt: "2026-09-13T10:00:00Z",
      lastUpdatedAt: "2026-09-13T11:00:00Z",
      detectedAt: "2026-09-13T11:05:00Z",
    });
    const result = processEvents(order === "old-first" ? [original, revised] : [revised, original]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: original.id,
      title: revised.title,
      summary: revised.summary,
      firstReportedAt: "2026-09-13T09:00:00.000Z",
      lastUpdatedAt: "2026-09-13T11:00:00.000Z",
      detectedAt: "2026-09-13T10:10:00.000Z",
      confidence: null,
    });
  });

  it("retains a known detection timestamp when a duplicate omits it", () => {
    const result = processEvents([
      event({ detectedAt: "2026-09-13T10:10:00Z" }),
      event({ lastUpdatedAt: "2026-09-13T11:00:00Z", detectedAt: undefined }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].detectedAt).toBe("2026-09-13T10:10:00.000Z");
  });

  it("preserves distinct provider attributions without treating repeated links as corroboration", () => {
    const source = event().sources[0];
    const result = processEvents([
      event({ sources: [{ ...source, providerId: "provider-a", byline: "Original author" }] }),
      event({
        id: "rediscovered-record",
        sources: [{
          ...source,
          providerId: "provider-b",
          byline: "Original author",
          observedAt: "2026-09-13T11:00:00Z",
          timestampBasis: "observed",
        }],
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].sources.map(({ providerId }) => providerId).sort()).toEqual(["provider-a", "provider-b"]);
    expect(result[0].sources.find(({ providerId }) => providerId === "provider-b")).toMatchObject({
      byline: "Original author",
      observedAt: "2026-09-13T11:00:00.000Z",
      timestampBasis: "observed",
    });
    expect(result[0].confidence).toBeNull();
    expect(result[0].relatedEvents).toEqual([]);
    expect(result[0].tags).not.toContain("independently-corroborated");
  });

  it.each(["old-first", "new-first"])("retains the latest publisher metadata in %s input order", (order) => {
    const original = event({
      sources: [{ ...event().sources[0], byline: "Original author", observedAt: "2026-09-13T10:15:00Z" }],
    });
    const revised = event({
      lastUpdatedAt: "2026-09-13T11:00:00Z",
      sources: [{
        ...event().sources[0],
        byline: "Corrected publisher byline",
        observedAt: "2026-09-13T11:05:00Z",
        timestampBasis: "published",
      }],
    });
    const result = processEvents(order === "old-first" ? [original, revised] : [revised, original]);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(1);
    expect(result[0].sources[0]).toMatchObject({
      byline: "Corrected publisher byline",
      observedAt: "2026-09-13T11:05:00.000Z",
      timestampBasis: "published",
    });
  });

  it("does not let malformed or fictional inputs poison valid live records", () => {
    const result = processEvents([
      event({ isDemo: true }),
      null,
      event({ id: "demo-old" }),
      event({ firstReportedAt: "2026-09-14T10:00:00Z" }),
      event(),
    ]);
    expect(result.map(({ id }) => id)).toEqual(["usgs-test1"]);
    expect(result[0].isDemo).toBe(false);
  });

  it("does not invent records when every input is rejected", () => {
    expect(processEvents([null, {}, event({ isDemo: true })])).toEqual([]);
  });
});
