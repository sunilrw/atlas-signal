import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasEvent, DataMode, EventSource } from "../src/types";
import type { StoredSnapshot } from "../src/lib/server/store";
import { ApiInputError } from "../src/lib/server/api";

const mocks = vi.hoisted(() => ({
  fetchProvider: vi.fn(),
  readSnapshot: vi.fn(),
  writeSnapshot: vi.fn(),
  enabled: { usgs: true, gdacs: true },
  refreshIntervalMs: undefined as number | undefined,
}));

vi.mock("../src/lib/server/providers", () => ({
  PROVIDERS: [
    {
      id: "usgs", name: "USGS", url: "https://earthquake.usgs.gov",
      enabled: () => mocks.enabled.usgs, disabledMessage: "Disabled by configuration.",
      get refreshIntervalMs() { return mocks.refreshIntervalMs; },
    },
    { id: "gdacs", name: "GDACS", url: "https://www.gdacs.org", enabled: () => mocks.enabled.gdacs, disabledMessage: "Disabled by configuration." },
  ],
  fetchProvider: mocks.fetchProvider,
}));

vi.mock("../src/lib/server/store", () => ({
  readSnapshot: mocks.readSnapshot,
  writeSnapshot: mocks.writeSnapshot,
  getStoreStatus: () => ({ mode: "memory", available: true, rawRecords: 0 }),
}));

import {
  FEED_CACHE_MS, MAX_STALE_SNAPSHOT_MS, getEvent, getEvents, getHealth, resetServiceForTests,
} from "../src/lib/server/service";

const NOW = "2026-09-13T12:00:00.000Z";
const RECENT_FETCH = "2026-09-13T11:59:50.000Z";
const PRIVATE_ERROR = "private-password at private-provider.internal";
type TestProviderId = keyof typeof mocks.enabled;

// Synthetic provider records are confined to this test file.
function providerEvent(id: string, overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    id: `${id}-test`, title: `${id} source report`, summary: "Synthetic source payload for service tests.",
    category: "natural-disaster", severity: null, confidence: null, status: "reported",
    reportKind: "incident", detectedAt: "2026-09-13T11:45:00.000Z",
    locationName: "Not provided", country: "Unspecified", countryCode: "ZZ", region: "Unspecified",
    locationAccuracy: "unknown", firstReportedAt: "2026-09-13T11:00:00Z", lastUpdatedAt: "2026-09-13T11:30:00Z",
    sources: [{
      id: `${id}-source`, providerId: id, name: id, url: `https://example.org/${id}`,
      type: "primary", publishedAt: "2026-09-13T11:00:00Z", isDemo: false,
    }],
    timeline: [], relatedEvents: [], tags: [], isDemo: false,
    ...overrides,
  };
}

function providerResult(id: string, events: unknown[] = [providerEvent(id)]) {
  return {
    id, name: id, url: `https://example.org/${id}`,
    events, raw: [], message: "Attributed source records fetched.",
  };
}

function storedSnapshot(
  id: TestProviderId = "usgs",
  events: AtlasEvent[] = [providerEvent(id)],
  fetchedAt = RECENT_FETCH,
): StoredSnapshot {
  return { providerId: id, fetchedAt, events };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.resetAllMocks();
  resetServiceForTests();
  mocks.enabled.usgs = true;
  mocks.enabled.gdacs = true;
  mocks.refreshIntervalMs = undefined;
  mocks.readSnapshot.mockResolvedValue({ snapshot: null });
  mocks.writeSnapshot.mockResolvedValue({});
  mocks.fetchProvider.mockImplementation(async (id: string) => providerResult(id));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("live-only service entry points", () => {
  it("defaults to live source records with unassessed scores left unknown", async () => {
    const result = await getEvents();
    expect(result.mode).toBe("live");
    expect(result.total).toBe(2);
    expect(result.events.map((event) => event.id)).toEqual(["usgs-test", "gdacs-test"]);
    expect(result.events.every((event) => event.isDemo === false)).toBe(true);
    expect(result.events.every((event) => event.severity === null && event.confidence === null)).toBe(true);
    expect(result.updatedAt).toBe(NOW);
    expect(result.referenceTime).toBe(NOW);
    expect(result.warnings.join(" ")).toMatch(/not independent verification/i);
    expect(mocks.fetchProvider).toHaveBeenCalledTimes(2);
  });

  it.each(["demo", "DEMO", "hybrid", "", null])("rejects runtime non-live mode %s before any I/O", async (mode) => {
    await expect(getEvents(mode as DataMode)).rejects.toBeInstanceOf(ApiInputError);
    await expect(getEvent("usgs-test", mode as DataMode)).rejects.toMatchObject({ status: 400 });
    expect(mocks.fetchProvider).not.toHaveBeenCalled();
    expect(mocks.readSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it.each(["demo", "demo:ukraine", "demo-coastal", "DEMO:legacy"])("rejects retired identifier %s without fetching", async (id) => {
    expect(await getEvent(id)).toBeNull();
    expect(mocks.fetchProvider).not.toHaveBeenCalled();
    expect(mocks.readSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("does not mistake an ordinary provider identifier for a retired prefix", async () => {
    mocks.enabled.gdacs = false;
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [
      providerEvent("usgs", { id: "democracy-report" }),
    ]));
    expect(await getEvent("democracy-report")).toMatchObject({ id: "democracy-report", isDemo: false });
    expect(mocks.fetchProvider).toHaveBeenCalledOnce();
  });

  it("never substitutes events when every source is unavailable", async () => {
    mocks.fetchProvider.mockRejectedValue(new Error(PRIVATE_ERROR));
    const result = await getEvents();
    expect(result.mode).toBe("live");
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.updatedAt).toBeNull();
    expect(result.sources.every((source) => source.status === "error" && source.lastFetchedAt === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
    expect(result.warnings.join(" ")).toContain("No events have been substituted");
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("keeps updatedAt null until a successful snapshot, including a genuinely empty response", async () => {
    mocks.fetchProvider.mockRejectedValue(new Error("offline"));
    expect((await getEvents()).updatedAt).toBeNull();
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS);
    mocks.fetchProvider.mockImplementation(async (id: string) => providerResult(id, []));
    const result = await getEvents();
    expect(result.events).toEqual([]);
    expect(result.updatedAt).toBe("2026-09-13T12:01:00.000Z");
    expect(result.sources.every((source) => source.status === "healthy" && source.eventCount === 0)).toBe(true);
    expect(mocks.writeSnapshot).toHaveBeenCalledTimes(2);
  });

  it("leaves an entirely disabled installation empty without touching providers or persistence", async () => {
    mocks.enabled.usgs = false;
    mocks.enabled.gdacs = false;
    const result = await getEvents();
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.updatedAt).toBeNull();
    expect(result.sources.every((source) => source.status === "disabled" && source.lastFetchedAt === null)).toBe(true);
    expect(mocks.fetchProvider).not.toHaveBeenCalled();
    expect(mocks.readSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });
});

describe("provider caching and outage retention", () => {
  it("coalesces simultaneous requests and reuses provider cache for at least one minute", async () => {
    const [first, concurrent] = await Promise.all([getEvents(), getEvents()]);
    expect(first.total).toBe(2);
    expect(concurrent.total).toBe(2);
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS - 1);
    await getEvents();
    expect(mocks.fetchProvider).toHaveBeenCalledTimes(2);
    expect(mocks.readSnapshot).toHaveBeenCalledTimes(2);
    expect(first.events.every((item) => item.isDemo === false)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await getEvents();
    expect(mocks.fetchProvider).toHaveBeenCalledTimes(4);
  });

  it("allows a forced refresh while still coalescing simultaneous forced requests", async () => {
    await getEvents();
    await Promise.all([getEvents("live", { force: true }), getEvents("live", { force: true })]);
    expect(mocks.fetchProvider).toHaveBeenCalledTimes(4);
  });

  it.each([
    [1_000, FEED_CACHE_MS],
    [5 * FEED_CACHE_MS, 5 * FEED_CACHE_MS],
  ])("enforces configured refresh interval %i with cache floor %i even for forced refreshes", async (interval, cacheFloor) => {
    mocks.enabled.gdacs = false;
    mocks.refreshIntervalMs = interval;
    await getEvents();
    await vi.advanceTimersByTimeAsync(cacheFloor - 1);
    await getEvents("live", { force: true });
    expect(mocks.fetchProvider).toHaveBeenCalledOnce();
    expect(mocks.readSnapshot).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await getEvents("live", { force: true });
    expect(mocks.fetchProvider).toHaveBeenCalledTimes(2);
  });

  it("uses worker data within a publisher's longer refresh interval without forcing another fetch", async () => {
    mocks.enabled.gdacs = false;
    mocks.refreshIntervalMs = 5 * FEED_CACHE_MS;
    const fetchedAt = "2026-09-13T11:56:00.000Z";
    mocks.readSnapshot.mockResolvedValue({ snapshot: storedSnapshot("usgs", [providerEvent("usgs")], fetchedAt) });
    const result = await getEvents("live", { force: true });
    expect(result.total).toBe(1);
    expect(result.updatedAt).toBe(fetchedAt);
    expect(result.sources[0].status).toBe("healthy");
    expect(mocks.fetchProvider).not.toHaveBeenCalled();
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("clearly labels stale last-good snapshots without advancing their successful fetch time", async () => {
    const first = await getEvents();
    const fetchedAt = first.sources[0].lastFetchedAt;
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS + 1);
    mocks.fetchProvider.mockRejectedValue(new Error("unavailable"));
    const stale = await getEvents();
    expect(stale.events).toHaveLength(2);
    expect(stale.updatedAt).toBe(first.updatedAt);
    expect(stale.sources[0].lastFetchedAt).toBe(fetchedAt);
    expect(stale.sources.every((source) => source.status === "degraded")).toBe(true);
    expect(stale.warnings.join(" ")).toMatch(/stale/i);
  });

  it("expires last-good records after one day even inside the provider cache window", async () => {
    await getEvents();
    mocks.fetchProvider.mockRejectedValue(new Error("offline"));
    expect(MAX_STALE_SNAPSHOT_MS).toBe(24 * 60 * 60_000);
    await vi.advanceTimersByTimeAsync(MAX_STALE_SNAPSHOT_MS);
    const boundary = await getEvents();
    expect(boundary.total).toBe(2);
    expect(boundary.sources.every((source) => source.status === "degraded")).toBe(true);
    const callsAtBoundary = mocks.fetchProvider.mock.calls.length;

    await vi.advanceTimersByTimeAsync(1);
    const expired = await getEvents();
    expect(expired.events).toEqual([]);
    expect(expired.total).toBe(0);
    expect(expired.updatedAt).toBe(NOW);
    expect(expired.sources.every((source) =>
      source.status === "error" && source.eventCount === 0 && source.lastFetchedAt === NOW,
    )).toBe(true);
    expect(expired.warnings.join(" ")).toMatch(/24-hour outage retention limit/);
    expect(getHealth().sources).toEqual(expired.sources);
    expect(mocks.fetchProvider).toHaveBeenCalledTimes(callsAtBoundary);
  });

  it("does not revive already expired persisted records after a failed refresh", async () => {
    mocks.enabled.gdacs = false;
    const fetchedAt = "2026-09-12T11:59:59.999Z";
    const old = providerEvent("usgs", {
      firstReportedAt: "2026-09-12T10:00:00.000Z",
      lastUpdatedAt: "2026-09-12T11:00:00.000Z",
      detectedAt: "2026-09-12T11:30:00.000Z",
      sources: [{
        ...providerEvent("usgs").sources[0],
        publishedAt: "2026-09-12T10:00:00.000Z",
      }],
    });
    mocks.readSnapshot.mockResolvedValue({ snapshot: storedSnapshot("usgs", [old], fetchedAt) });
    mocks.fetchProvider.mockRejectedValue(new Error("offline"));
    const result = await getEvents();
    expect(result.events).toEqual([]);
    expect(result.sources[0]).toMatchObject({ status: "error", lastFetchedAt: fetchedAt, eventCount: 0 });
    expect(result.warnings.join(" ")).toMatch(/24-hour outage retention limit/);
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("preserves successful providers when a separate provider fails", async () => {
    mocks.fetchProvider.mockImplementation(async (id: string) => {
      if (id === "gdacs") throw new Error("offline");
      return providerResult(id);
    });
    const result = await getEvents();
    expect(result.total).toBe(1);
    expect(result.sources.map((source) => source.status)).toEqual(["healthy", "error"]);
    expect(await getEvent("usgs-test")).not.toBeNull();
    expect(await getEvent("missing")).toBeNull();
  });

  it("does not request snapshots from disabled providers", async () => {
    mocks.enabled.gdacs = false;
    const result = await getEvents();
    expect(mocks.fetchProvider).toHaveBeenCalledTimes(1);
    expect(mocks.readSnapshot).toHaveBeenCalledExactlyOnceWith("usgs");
    expect(result.total).toBe(1);
    expect(result.sources.find((source) => source.id === "gdacs")?.status).toBe("disabled");
  });

  it("stops returning a provider's cached records when it becomes disabled", async () => {
    await getEvents();
    mocks.enabled.gdacs = false;
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS);
    const result = await getEvents();
    expect(result.events.map((event) => event.id)).toEqual(["usgs-test"]);
    expect(result.sources.find((source) => source.id === "gdacs")).toMatchObject({
      status: "disabled", eventCount: 0, lastFetchedAt: null,
    });
    expect(mocks.fetchProvider.mock.calls.map(([id]) => id)).toEqual(["usgs", "gdacs", "usgs"]);
    expect(mocks.readSnapshot.mock.calls.map(([id]) => id)).toEqual(["usgs", "gdacs", "usgs"]);
  });

  it("replaces cached events with a successful empty source snapshot", async () => {
    await getEvents();
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS);
    mocks.fetchProvider.mockImplementation(async (id: string) => providerResult(id, []));
    const result = await getEvents();
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.updatedAt).toBe("2026-09-13T12:01:00.000Z");
    expect(result.sources.every((source) => source.status === "healthy" && source.eventCount === 0)).toBe(true);
    expect(result.warnings.join(" ")).not.toMatch(/stale/i);
  });
});

describe("persisted live snapshot validation", () => {
  it("uses fresh worker snapshots without duplicating upstream requests", async () => {
    mocks.readSnapshot.mockImplementation(async (id: TestProviderId) => ({
      snapshot: storedSnapshot(id),
    }));
    const result = await getEvents();
    expect(result.total).toBe(2);
    expect(result.updatedAt).toBe(RECENT_FETCH);
    expect(mocks.fetchProvider).not.toHaveBeenCalled();
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
    expect(result.sources.every((source) => source.status === "healthy")).toBe(true);
  });

  const invalidSnapshots: [string, () => unknown][] = [
    ["malformed snapshot shape", () => ({ events: [] })],
    ["wrong provider", () => storedSnapshot("gdacs")],
    ["non-array records", () => ({ ...storedSnapshot(), events: {} })],
    ["oversized records", () => storedSnapshot("usgs", Array.from({ length: 1_001 }, () => providerEvent("usgs")))],
    ["malformed fetch time", () => ({ ...storedSnapshot(), fetchedAt: "not-a-date" })],
    ["impossible calendar date", () => ({ ...storedSnapshot(), fetchedAt: "2026-02-30T12:00:00.000Z" })],
    ["future fetch time", () => ({ ...storedSnapshot(), fetchedAt: "2026-09-13T12:00:00.001Z" })],
    ["future event time", () => storedSnapshot("usgs", [
      providerEvent("usgs", { lastUpdatedAt: "2026-09-13T12:00:00.001Z" }),
    ])],
    ["future detection time", () => storedSnapshot("usgs", [
      providerEvent("usgs", { detectedAt: "2026-09-13T12:00:00.001Z" }),
    ])],
    ["missing source provenance", () => storedSnapshot("usgs", [providerEvent("usgs", { sources: [] })])],
    ["retired event ID", () => storedSnapshot("usgs", [providerEvent("usgs", { id: "demo:legacy" })])],
    ["mixed live and demo records", () => storedSnapshot("usgs", [
      providerEvent("usgs"),
      providerEvent("retired", { isDemo: true }),
    ])],
    ["mixed live and demo sources", () => storedSnapshot("usgs", [
      providerEvent("usgs", {
        sources: [
          ...providerEvent("usgs").sources,
          { ...providerEvent("retired").sources[0], isDemo: true },
        ],
      }),
    ])],
    ["retired source ID marked live", () => storedSnapshot("usgs", [
      providerEvent("usgs", {
        sources: [{ ...providerEvent("usgs").sources[0], id: "demo:reference", isDemo: false }],
      }),
    ])],
  ];

  it.each(invalidSnapshots)("rejects %s without salvaging a persisted fallback", async (_label, makeSnapshot) => {
    mocks.enabled.gdacs = false;
    mocks.readSnapshot.mockResolvedValue({ snapshot: makeSnapshot() });
    mocks.fetchProvider.mockRejectedValue(new Error(PRIVATE_ERROR));
    const result = await getEvents();
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.updatedAt).toBeNull();
    expect(result.sources[0]).toMatchObject({ status: "error", lastFetchedAt: null, eventCount: 0 });
    expect(result.warnings).toContain("A stored snapshot failed live-source validation and was not used.");
    expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
    expect(mocks.fetchProvider).toHaveBeenCalledExactlyOnceWith("usgs");
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("replaces a rejected stored snapshot only with newly fetched valid records", async () => {
    mocks.enabled.gdacs = false;
    mocks.readSnapshot.mockResolvedValue({
      snapshot: storedSnapshot("usgs", [providerEvent("usgs", { id: "demo:legacy", isDemo: true })]),
    });
    const result = await getEvents();
    expect(result.events.map((event) => event.id)).toEqual(["usgs-test"]);
    expect(result.sources[0].status).toBe("healthy");
    expect(result.updatedAt).toBe(NOW);
    expect(mocks.fetchProvider).toHaveBeenCalledOnce();
    expect(mocks.writeSnapshot).toHaveBeenCalledOnce();
  });

  it("surfaces optional persistence warnings without failing the local experience", async () => {
    mocks.writeSnapshot.mockResolvedValue({ warning: "Database unavailable; using in-memory storage." });
    const result = await getEvents();
    expect(result.total).toBe(2);
    expect(result.warnings).toContain("Database unavailable; using in-memory storage.");
    expect(result.warnings.filter((warning) => warning.startsWith("Database"))).toHaveLength(1);
  });

  it("clears an earlier database-read warning after successful replacement persistence", async () => {
    mocks.readSnapshot.mockResolvedValue({ snapshot: null, warning: "Database unavailable on the earlier read." });
    const result = await getEvents();
    expect(result.total).toBe(2);
    expect(result.warnings.join(" ")).not.toContain("Database unavailable");
  });
});

describe("fetched live record validation and assessments", () => {
  const invalidEvents: [string, () => unknown][] = [
    ["demo records", () => providerEvent("usgs", { isDemo: true })],
    ["retired IDs", () => providerEvent("usgs", { id: "demo:legacy" })],
    ["missing provenance", () => providerEvent("usgs", { sources: [] })],
    ["future timestamps", () => providerEvent("usgs", { lastUpdatedAt: "2026-09-13T12:00:00.001Z" })],
    ["unsafe source links", () => providerEvent("usgs", {
      sources: [{ ...providerEvent("usgs").sources[0], url: "javascript:alert(1)" }],
    })],
    ["unsafe source license links", () => providerEvent("usgs", {
      sources: [{ ...providerEvent("usgs").sources[0], licenseUrl: "javascript:alert(1)" }],
    })],
    ["unsafe publisher links", () => providerEvent("usgs", {
      sources: [{ ...providerEvent("usgs").sources[0], publisherUrl: "javascript:alert(1)" }],
    })],
  ];

  it.each(invalidEvents)("treats an all-invalid batch of %s as an error, not a successful empty fetch", async (_label, makeEvent) => {
    mocks.enabled.gdacs = false;
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [makeEvent()]));
    const result = await getEvents();
    expect(result.events).toEqual([]);
    expect(result.updatedAt).toBeNull();
    expect(result.sources[0]).toMatchObject({ status: "error", eventCount: 0, lastFetchedAt: null });
    expect(result.warnings.join(" ")).toContain("No events have been substituted");
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("retains only valid fetched records and discloses omitted records as degraded", async () => {
    mocks.enabled.gdacs = false;
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [
      providerEvent("usgs"),
      providerEvent("retired", { isDemo: true }),
    ]));
    const result = await getEvents();
    expect(result.events.map((event) => event.id)).toEqual(["usgs-test"]);
    expect(result.sources[0]).toMatchObject({ status: "degraded", eventCount: 1, lastFetchedAt: NOW });
    expect(result.sources[0].message).toMatch(/1 records were omitted/);
    expect(mocks.writeSnapshot.mock.calls[0][0].events).toEqual(result.events);
  });

  it("does not overwrite the last-good snapshot with an all-invalid refresh", async () => {
    mocks.enabled.gdacs = false;
    const first = await getEvents();
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS);
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [
      providerEvent("usgs", { isDemo: true, title: "Rejected replacement" }),
    ]));
    const result = await getEvents();
    expect(result.events).toEqual(first.events);
    expect(result.updatedAt).toBe(NOW);
    expect(result.sources[0]).toMatchObject({ status: "degraded", eventCount: 1, lastFetchedAt: NOW });
    expect(mocks.writeSnapshot).toHaveBeenCalledOnce();
  });

  it.each(["fetch", "stored"] as const)("removes legacy confidence and unsupported severity from %s records", async (origin) => {
    mocks.enabled.gdacs = false;
    const record = providerEvent("usgs", {
      category: "political", severity: 7, confidence: 95,
      severityReason: "A former headline-based score.",
      tags: ["automated-confidence", "automated-severity"],
    });
    if (origin === "stored") {
      mocks.readSnapshot.mockResolvedValue({ snapshot: storedSnapshot("usgs", [record]) });
    } else {
      mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [record]));
    }
    const result = await getEvents();
    expect(result.events[0]).toMatchObject({ severity: null, confidence: null });
    expect(result.events[0]).not.toHaveProperty("severityReason");
    expect(result.events[0].tags).not.toContain("automated-confidence");
    expect(result.events[0].tags).not.toContain("automated-severity");
  });

  it("retains a disclosed primary-source hazard measurement without inventing confidence", async () => {
    mocks.enabled.gdacs = false;
    const severityReason = "Magnitude 5.7 mapped to level 4; this is not an observed damage assessment.";
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [
      providerEvent("usgs", { severity: 4, confidence: 99, severityReason, magnitude: 5.7 }),
    ]));
    const result = await getEvents();
    expect(result.events[0]).toMatchObject({ severity: 4, severityReason, magnitude: 5.7, confidence: null });
  });

  it.each([
    ["a missing measurement basis", { severityReason: undefined }],
    ["a news article about a hazard", { reportKind: "news" }],
    ["an analytical hazard article", { reportKind: "analysis" }],
    ["a non-hazard report", { category: "political" }],
    ["non-primary source metadata", {
      sources: [{ ...providerEvent("usgs").sources[0], type: "news" }],
    }],
  ] satisfies [string, Partial<AtlasEvent>][])("does not treat %s as an assessed incident", async (_label, overrides) => {
    mocks.enabled.gdacs = false;
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [
      providerEvent("usgs", {
        severity: 4, confidence: 80, severityReason: "Attributed hazard measurement.", ...overrides,
      }),
    ]));
    const result = await getEvents();
    expect(result.events[0].severity).toBeNull();
    expect(result.events[0].confidence).toBeNull();
    expect(result.events[0]).not.toHaveProperty("severityReason");
  });
});

describe("source provenance and detection continuity", () => {
  it.each(["fetch", "stored"] as const)("retains publisher metadata and distinct source clocks from %s records", async (origin) => {
    mocks.enabled.gdacs = false;
    const source: EventSource = {
      ...providerEvent("usgs").sources[0],
      name: "Publisher science desk",
      byline: "A. Reporter",
      publisherCountry: "United States",
      language: "English",
      licenseUrl: "https://example.org/license",
      publisherUrl: "https://example.org/science-desk",
      observedAt: "2026-09-13T11:40:00Z",
      timestampBasis: "occurred",
    };
    const record = providerEvent("usgs", { sources: [source] });
    if (origin === "stored") {
      mocks.readSnapshot.mockResolvedValue({ snapshot: storedSnapshot("usgs", [record]) });
    } else {
      mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [record]));
    }
    const result = await getEvents();
    const returned = result.events[0];
    expect(returned.title).toBe(record.title);
    expect(returned.summary).toBe(record.summary);
    expect(returned.sources[0]).toEqual({
      ...source,
      publishedAt: "2026-09-13T11:00:00.000Z",
      observedAt: "2026-09-13T11:40:00.000Z",
    });
    expect(returned).toMatchObject({
      firstReportedAt: "2026-09-13T11:00:00.000Z",
      lastUpdatedAt: "2026-09-13T11:30:00.000Z",
      detectedAt: "2026-09-13T11:45:00.000Z",
      confidence: null,
      locationAccuracy: "unknown",
    });
    expect(returned).not.toHaveProperty("latitude");
    expect(returned).not.toHaveProperty("longitude");
    expect(result.updatedAt).toBe(origin === "stored" ? RECENT_FETCH : NOW);
  });

  it.each(["published", "observed", "occurred"] as const)("preserves the %s timestamp basis", async (timestampBasis) => {
    mocks.enabled.gdacs = false;
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [
      providerEvent("usgs", {
        sources: [{ ...providerEvent("usgs").sources[0], timestampBasis }],
      }),
    ]));
    expect((await getEvents()).events[0].sources[0].timestampBasis).toBe(timestampBasis);
  });

  it("retains the earliest detection while source observation and update times advance", async () => {
    mocks.enabled.gdacs = false;
    const first = await getEvents();
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS);
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [
      providerEvent("usgs", {
        title: "Publisher updated title",
        detectedAt: "2026-09-13T12:01:00.000Z",
        lastUpdatedAt: "2026-09-13T12:00:30.000Z",
        sources: [{
          ...providerEvent("usgs").sources[0],
          observedAt: "2026-09-13T12:01:00.000Z",
          timestampBasis: "published",
        }],
      }),
    ]));
    const result = await getEvents();
    expect(result.events[0]).toMatchObject({
      title: "Publisher updated title",
      firstReportedAt: "2026-09-13T11:00:00.000Z",
      lastUpdatedAt: "2026-09-13T12:00:30.000Z",
      detectedAt: first.events[0].detectedAt,
    });
    expect(result.events[0].sources[0].publishedAt).toBe("2026-09-13T11:00:00.000Z");
    expect(result.events[0].sources[0].observedAt).toBe("2026-09-13T12:01:00.000Z");
    expect(mocks.writeSnapshot.mock.calls.at(-1)?.[0].events[0].detectedAt).toBe(first.events[0].detectedAt);
  });

  it("does not discard known first detection when a later valid record omits it", async () => {
    mocks.enabled.gdacs = false;
    const first = await getEvents();
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS);
    mocks.fetchProvider.mockResolvedValue(providerResult("usgs", [
      providerEvent("usgs", { detectedAt: undefined }),
    ]));
    const result = await getEvents();
    expect(result.events[0].detectedAt).toBe(first.events[0].detectedAt);
    expect(mocks.writeSnapshot.mock.calls.at(-1)?.[0].events[0].detectedAt).toBe(first.events[0].detectedAt);
  });

  it("retains earlier local detection when adopting a newer worker snapshot", async () => {
    mocks.enabled.gdacs = false;
    const first = await getEvents();
    await vi.advanceTimersByTimeAsync(FEED_CACHE_MS);
    mocks.readSnapshot.mockResolvedValue({
      snapshot: storedSnapshot("usgs", [
        providerEvent("usgs", {
          title: "Newer worker source record",
          detectedAt: "2026-09-13T12:00:20.000Z",
          lastUpdatedAt: "2026-09-13T12:00:25.000Z",
        }),
      ], "2026-09-13T12:00:30.000Z"),
    });
    const result = await getEvents();
    expect(result.events[0]).toMatchObject({
      title: "Newer worker source record",
      detectedAt: first.events[0].detectedAt,
      lastUpdatedAt: "2026-09-13T12:00:25.000Z",
    });
    expect(result.updatedAt).toBe("2026-09-13T12:00:30.000Z");
    expect(mocks.fetchProvider).toHaveBeenCalledOnce();
  });
});

describe("local service health", () => {
  it("reports local health without initiating live traffic", () => {
    const health = getHealth();
    expect(health.status).toBe("ok");
    expect(health.timestamp).toBe(NOW);
    expect(health.storage.mode).toBe("memory");
    expect(health.cacheSeconds).toBe(FEED_CACHE_MS / 1_000);
    expect(health.maxStaleSnapshotSeconds).toBe(MAX_STALE_SNAPSHOT_MS / 1_000);
    expect(health.sources.every((source) => source.lastFetchedAt === null && source.eventCount === 0)).toBe(true);
    expect(mocks.fetchProvider).not.toHaveBeenCalled();
    expect(mocks.readSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });
});
