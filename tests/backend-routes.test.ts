import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasEvent, ConflictInfo, CountryInfo, DataMode, EventsResponse } from "../src/types";
import { GET as eventsRoute } from "../src/app/api/events/route";
import { GET as eventRoute } from "../src/app/api/events/[id]/route";
import { GET as countryRoute } from "../src/app/api/countries/[country]/route";
import { GET as conflictsRoute } from "../src/app/api/conflicts/route";
import { GET as conflictRoute } from "../src/app/api/conflicts/[id]/route";
import { GET as searchRoute } from "../src/app/api/search/route";
import { GET as riskRoute } from "../src/app/api/risk/route";
import { GET as timelineRoute } from "../src/app/api/timeline/route";
import { GET as sourcesRoute } from "../src/app/api/sources/route";
import { GET as healthRoute } from "../src/app/api/health/route";
import { GET as streamRoute } from "../src/app/api/stream/route";

const service = vi.hoisted(() => ({
  getEvents: vi.fn(),
  getHealth: vi.fn(),
}));

vi.mock("../src/lib/server/service", () => service);

const REFERENCE = "2026-09-13T12:00:00.000Z";
const PRIVATE_ERROR = "postgresql://admin:private-password@internal-database/private-db";

function event(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    id: "fixture:ukraine",
    title: "Coastal supply disruption",
    summary: "Test-only source-record fixture.",
    category: "infrastructure",
    severity: 7,
    status: "reported",
    confidence: 90,
    latitude: 50.4,
    longitude: 30.5,
    locationName: "Kyiv",
    country: "Ukraine",
    countryCode: "UA",
    region: "Europe",
    locationAccuracy: "city",
    firstReportedAt: "2026-09-13T09:00:00.000Z",
    lastUpdatedAt: "2026-09-13T11:30:00.000Z",
    sources: [{
      id: "fixture:source",
      name: "Test publisher",
      url: "https://example.org/source-record",
      publishedAt: "2026-09-13T09:00:00.000Z",
      type: "news",
      isDemo: false,
      providerId: "fixture-provider",
      publisherCountry: "United Kingdom",
      language: "English",
      byline: "Source Author",
      observedAt: "2026-09-13T11:45:00.000Z",
      timestampBasis: "published",
      licenseUrl: "https://example.org/license",
    }],
    timeline: [
      { id: "fixture:latest", timestamp: "2026-09-13T11:30:00.000Z", title: "Publisher update" },
      { id: "fixture:first", timestamp: "2026-09-13T09:00:00.000Z", title: "Publisher initial report" },
    ],
    relatedEvents: [],
    tags: ["russia-ukraine", "supply"],
    isDemo: false,
    ...overrides,
  };
}

function providerEvents(): AtlasEvent[] {
  return [
    event(),
    event({
      id: "fixture:brazil",
      title: "São Paulo port review",
      category: "maritime",
      severity: 3,
      confidence: 50,
      latitude: undefined,
      longitude: undefined,
      locationName: "São Paulo",
      country: "Brazil",
      countryCode: "BR",
      region: "Americas",
      locationAccuracy: "unknown",
      firstReportedAt: "2026-09-12T09:00:00.000Z",
      lastUpdatedAt: "2026-09-12T10:00:00.000Z",
      timeline: [{ id: "fixture:brazil:first", timestamp: "2026-09-12T09:00:00.000Z", title: "Publisher review" }],
      tags: ["shipping"],
    }),
    event({
      id: "fixture:japan",
      title: "Offshore earthquake",
      category: "natural-disaster",
      severity: 5,
      confidence: 88,
      latitude: 35,
      longitude: 139,
      country: "Japan",
      countryCode: "JP",
      region: "Asia Pacific",
      locationName: "Offshore Japan",
      locationAccuracy: "exact",
      firstReportedAt: "2026-09-13T08:00:00.000Z",
      lastUpdatedAt: "2026-09-13T09:00:00.000Z",
      timeline: [{ id: "fixture:japan:first", timestamp: "2026-09-13T08:00:00.000Z", title: "Source earthquake report" }],
      tags: ["earthquake"],
    }),
  ];
}

function snapshot(mode: DataMode = "live", events = providerEvents()): EventsResponse {
  return {
    events,
    mode,
    referenceTime: REFERENCE,
    updatedAt: REFERENCE,
    total: events.length,
    sources: [{
      id: "fixture-provider",
      name: "Test publisher feed",
      status: "healthy",
      lastFetchedAt: REFERENCE,
      eventCount: events.length,
      message: "Provider snapshot available.",
      url: "https://example.org/",
    }],
    warnings: ["Source records are not independently verified."],
  };
}

function request(path: string, query = "", signal?: AbortSignal): Request {
  return new Request(`https://atlas.example/api/${path}${query ? `?${query}` : ""}`, { signal });
}

function eventIds(events: AtlasEvent[]): string[] {
  return events.map(({ id }) => id);
}

beforeEach(() => {
  service.getEvents.mockReset().mockImplementation(async (mode: DataMode) => snapshot(mode));
  service.getHealth.mockReset().mockReturnValue({ status: "ok", service: "Atlas Signal", timestamp: REFERENCE });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("event collection API", () => {
  it("defaults to live source data and preserves provenance and missing coordinates", async () => {
    const response = await eventsRoute(request("events"));
    const body = await response.json() as EventsResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(service.getEvents).toHaveBeenCalledWith("live");
    expect(body).toEqual(JSON.parse(JSON.stringify(snapshot())));
    expect(body.events.find(({ id }) => id === "fixture:brazil")).not.toHaveProperty("latitude");
    expect(body.events.find(({ id }) => id === "fixture:brazil")).not.toHaveProperty("longitude");
    expect(body.events[0].sources[0]).toMatchObject({
      name: "Test publisher",
      providerId: "fixture-provider",
      publisherCountry: "United Kingdom",
      language: "English",
      publishedAt: "2026-09-13T09:00:00.000Z",
      byline: "Source Author",
      observedAt: "2026-09-13T11:45:00.000Z",
      timestampBasis: "published",
      licenseUrl: "https://example.org/license",
    });
  });

  it.each([
    ["q=COASTAL%20supply", ["fixture:ukraine"]],
    ["q=sao%20paulo", ["fixture:brazil"]],
    ["category=maritime,infrastructure", ["fixture:ukraine", "fixture:brazil"]],
    ["severity=6", ["fixture:ukraine"]],
    ["confidence=80", ["fixture:ukraine", "fixture:japan"]],
    ["since=1h", ["fixture:ukraine"]],
    ["since=6h", ["fixture:ukraine", "fixture:japan"]],
    ["since=24h", ["fixture:ukraine", "fixture:japan"]],
    ["region=europe", ["fixture:ukraine"]],
    ["north=60&south=40&east=40&west=20", ["fixture:ukraine"]],
    ["q=supply&category=infrastructure&severity=6&confidence=85&since=1h&region=Europe", ["fixture:ukraine"]],
    ["q=absent-phrase", []],
  ])("applies filters %s without changing response metadata", async (query, ids) => {
    const response = await eventsRoute(request("events", query));
    const body = await response.json() as EventsResponse;

    expect(response.status).toBe(200);
    expect(eventIds(body.events)).toEqual(ids);
    expect(body.total).toBe(ids.length);
    expect(body.referenceTime).toBe(REFERENCE);
    expect(body.sources).toEqual(snapshot().sources);
    expect(body.warnings).toEqual(snapshot().warnings);
  });

  it("uses snapshot time, not the machine clock, for relative time filters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));
    const body = await (await eventsRoute(request("events", "since=1h"))).json() as EventsResponse;
    expect(eventIds(body.events)).toEqual(["fixture:ukraine"]);
  });

  it("handles an antimeridian viewport without inventing coordinates", async () => {
    const events = [
      event({ id: "east", latitude: 5, longitude: 175 }),
      event({ id: "west", latitude: -5, longitude: -175 }),
      event({ id: "outside", latitude: 0, longitude: 0 }),
      event({ id: "unknown", latitude: undefined, longitude: undefined }),
    ];
    service.getEvents.mockResolvedValue(snapshot("live", events));
    const body = await (await eventsRoute(request("events", "north=10&south=-10&east=-170&west=170"))).json() as EventsResponse;
    expect(eventIds(body.events)).toEqual(["east", "west"]);
  });

  it.each([
    "mode=hybrid",
    "mode=demo",
    "mode=demo&mode=live",
    "mode=live&mode=live",
    "category=unsupported",
    "category=",
    "category=maritime&category=energy",
    "severity=0",
    "severity=8",
    "severity=3.5",
    "severity=NaN",
    "confidence=-1",
    "confidence=101",
    "confidence=Infinity",
    "since=2h",
    "since=__proto__",
    "north=40",
    "north=91&south=0&east=50&west=0",
    "north=0&south=40&east=50&west=0",
    "north=40&south=0&east=181&west=0",
    "q=one&q=two",
    `q=${"x".repeat(251)}`,
    `region=${"x".repeat(101)}`,
  ])("rejects invalid %s before fetching providers", async (query) => {
    const response = await eventsRoute(request("events", query));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(service.getEvents).not.toHaveBeenCalled();
  });

  it("accepts an explicit live mode without changing the source records", async () => {
    const body = await (await eventsRoute(request("events", "mode=live"))).json() as EventsResponse;
    expect(service.getEvents).toHaveBeenCalledWith("live");
    expect(body.mode).toBe("live");
    expect(eventIds(body.events)).toEqual(["fixture:ukraine", "fixture:brazil", "fixture:japan"]);
    expect(body.events.every((item) => !item.isDemo)).toBe(true);
    expect(body.events.flatMap((item) => item.sources).every((source) => !source.isDemo)).toBe(true);
  });

  it("returns a genuine empty live response without demo fallback", async () => {
    service.getEvents.mockResolvedValue(snapshot("live", []));
    const body = await (await eventsRoute(request("events", "mode=live"))).json() as EventsResponse;
    expect(body.mode).toBe("live");
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("keeps unassessed severity and confidence null in the default collection", async () => {
    service.getEvents.mockResolvedValue(snapshot("live", [event({ severity: null, confidence: null })]));
    const body = await (await eventsRoute(request("events"))).json() as EventsResponse;
    expect(body.total).toBe(1);
    expect(body.events[0]).toMatchObject({ severity: null, confidence: null });
    const filtered = await (await eventsRoute(request("events", "confidence=1"))).json() as EventsResponse;
    expect(filtered.events).toEqual([]);
  });

  it("preserves empty outage responses and unknown fetch timestamps", async () => {
    service.getEvents.mockResolvedValue({
      ...snapshot("live", []),
      updatedAt: null,
      sources: [{ ...snapshot().sources[0], status: "error", lastFetchedAt: null, eventCount: 0 }],
      warnings: ["No source snapshot is available."],
    });
    const body = await (await eventsRoute(request("events"))).json() as EventsResponse;
    expect(body).toMatchObject({
      mode: "live",
      events: [],
      total: 0,
      updatedAt: null,
      sources: [{ status: "error", lastFetchedAt: null, eventCount: 0 }],
      warnings: ["No source snapshot is available."],
    });
  });

  it("sanitizes upstream exceptions", async () => {
    service.getEvents.mockRejectedValue(new Error(PRIVATE_ERROR));
    const response = await eventsRoute(request("events", "mode=live"));
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain("temporarily unavailable");
    expect(body).not.toContain("private-password");
    expect(body).not.toContain("internal-database");
    expect(body).not.toContain("postgresql:");
  });
});

describe("event and country detail APIs", () => {
  it("returns event provenance together with mode and source health", async () => {
    const response = await eventRoute(request("events/fixture:ukraine"), { params: Promise.resolve({ id: "fixture:ukraine" }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      event: event(),
      mode: "live",
      referenceTime: REFERENCE,
      updatedAt: REFERENCE,
      sources: snapshot().sources,
      warnings: snapshot().warnings,
    });
  });

  it("preserves assessment limits and never fills missing source relationships", async () => {
    const record = event({
      severity: null,
      confidence: null,
      severityReason: "The publisher supplied no impact assessment.",
      verificationNote: "Publisher reporting; not independently verified.",
      timeline: [],
      relatedEvents: [],
    });
    service.getEvents.mockResolvedValue(snapshot("live", [record]));
    const response = await eventRoute(request(`events/${record.id}`), { params: Promise.resolve({ id: record.id }) });
    const body = await response.json();
    expect(body.event).toEqual(record);
    expect(body.event.sources[0].publishedAt).not.toBe(body.updatedAt);
  });

  it.each(["demo:ukraine", "demo-kharkiv-response", "DEMO:old-record"])("retires %s before fetching source data", async (id) => {
    const response = await eventRoute(request(`events/${id}`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(body).not.toHaveProperty("event");
    expect(service.getEvents).not.toHaveBeenCalled();
  });

  it("returns 404 for a source record missing from the live snapshot", async () => {
    const response = await eventRoute(request("events/provider:missing"), { params: Promise.resolve({ id: "provider:missing" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("event");
  });

  it("rejects invalid event identifiers before touching providers", async () => {
    const response = await eventRoute(request("events/invalid"), { params: Promise.resolve({ id: "../private" }) });
    expect(response.status).toBe(400);
    expect(service.getEvents).not.toHaveBeenCalled();
  });

  it.each([
    ["UA", "UA"],
    ["ukraine", "UA"],
    ["Ukraine", "UA"],
    ["United Kingdom", "GB"],
    ["united-kingdom", "GB"],
    ["Türkiye", "TR"],
    ["turkiye", "TR"],
  ])("looks up a catalog country by %s", async (country, code) => {
    const response = await countryRoute(request(`countries/${encodeURIComponent(country)}`), { params: Promise.resolve({ country }) });
    const body = await response.json() as EventsResponse & { country: CountryInfo };
    expect(response.status).toBe(200);
    expect(body.country.code).toBe(code);
    expect(body.events.every((item) => item.countryCode === code)).toBe(true);
    expect(body.total).toBe(body.events.length);
    expect(body.mode).toBe("live");
  });

  it("applies collection filters to a country view", async () => {
    const response = await countryRoute(request("countries/UA", "category=maritime"), { params: Promise.resolve({ country: "UA" }) });
    expect((await response.json()).events).toEqual([]);
  });

  it("returns 404 for unknown countries without manufacturing a profile", async () => {
    const response = await countryRoute(request("countries/not-a-country"), { params: Promise.resolve({ country: "not-a-country" }) });
    expect(response.status).toBe(404);
  });
});

describe("conflicts and search APIs", () => {
  it("returns an empty source-backed conflict catalog with an explicit coverage notice", async () => {
    const response = await conflictsRoute(request("conflicts"));
    const body = await response.json() as EventsResponse & { conflicts: ConflictInfo[] };
    expect(response.status).toBe(200);
    expect(body.conflicts).toEqual([]);
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.warnings).toContain("No curated live conflict assessments are configured. An empty catalog does not imply that no conflicts exist.");
    expect(body.mode).toBe("live");
  });

  it("never includes the demonstration conflict catalog in live lists or search", async () => {
    const list = await (await conflictsRoute(request("conflicts", "mode=live"))).json();
    const search = await (await searchRoute(request("search", "mode=live&q=ukraine"))).json();
    expect(list.conflicts).toEqual([]);
    expect(search.conflicts).toEqual([]);
    expect(list.mode).toBe("live");
    expect(search.mode).toBe("live");
  });

  it("does not infer conflict relationships from countries or matching tags", async () => {
    service.getEvents.mockResolvedValue(snapshot("live", [
      event(),
      event({ id: "tag-match", countryCode: "BR", country: "Brazil", tags: ["black-sea"] }),
      event({ id: "unrelated", countryCode: "BR", country: "Brazil", tags: ["shipping"] }),
    ]));
    const response = await conflictsRoute(request("conflicts"));
    const body = await response.json() as EventsResponse & { conflicts: ConflictInfo[] };
    expect(response.status).toBe(200);
    expect(body.conflicts).toEqual([]);
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
  });

  it.each(["not-a-conflict", "russia-ukraine"])("does not manufacture a conflict assessment for %s", async (id) => {
    const response = await conflictRoute(request(`conflicts/${id}`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("conflict");
    expect(service.getEvents).not.toHaveBeenCalled();
  });

  it("searches source records and reference countries without fictional conflict results", async () => {
    const response = await searchRoute(request("search", "q=ukraine"));
    const body = await response.json() as EventsResponse & { countries: CountryInfo[]; conflicts: ConflictInfo[] };
    expect(response.status).toBe(200);
    expect(eventIds(body.events)).toEqual(["fixture:ukraine"]);
    expect(body.countries.some((item) => item.code === "UA")).toBe(true);
    expect(body.conflicts).toEqual([]);
    expect(body.total).toBe(body.events.length);
  });
});

describe("derived and operational APIs", () => {
  it("counts source records without computing risk scores or severity-weighted rankings", async () => {
    const input = [
      event({ id: "one", severity: null, confidence: null }),
      event({ id: "two", severity: 7, confidence: null }),
      event({ id: "unassessed", countryCode: "BR", country: "Brazil", severity: null, confidence: null }),
      ...Array.from({ length: 8 }, (_, index) => event({ id: `jp-${index}`, countryCode: "JP", country: "Japan", severity: 7, confidence: 100 })),
    ];
    service.getEvents.mockResolvedValue(snapshot("live", input));
    const response = await riskRoute(request("risk"));
    const body = await response.json() as EventsResponse & {
      regions: { countryCode: string; eventCount: number; eventIds: string[] }[];
      methodology: { label: string; countDefinition: string; limitations: unknown };
    };
    expect(response.status).toBe(200);
    expect(body.regions.find((item) => item.countryCode === "UA")).toMatchObject({
      eventCount: 2,
      eventIds: ["one", "two"],
    });
    expect(body.regions.find((item) => item.countryCode === "JP")?.eventCount).toBe(8);
    expect(body.regions.find((item) => item.countryCode === "BR")?.eventCount).toBe(1);
    expect(body.regions.map(({ countryCode }) => countryCode)).toEqual(["BR", "JP", "UA"]);
    for (const region of body.regions) {
      expect(region).not.toHaveProperty("activityScore");
      expect(region).not.toHaveProperty("riskScore");
      expect(region).not.toHaveProperty("confidence");
      expect(region).not.toHaveProperty("level");
    }
    expect(body.methodology.label).toBe("Observed source-record counts");
    expect(body.methodology.countDefinition).toEqual(expect.any(String));
    expect(body.methodology).not.toHaveProperty("formula");
    expect(JSON.stringify(body.methodology.limitations)).toContain("No records does not mean no risk.");
    expect(body.mode).toBe("live");
  });

  it("does not turn an empty snapshot into a claim of zero regional risk", async () => {
    service.getEvents.mockResolvedValue(snapshot("live", []));
    const body = await (await riskRoute(request("risk", "mode=live"))).json();
    expect(body.regions).toEqual([]);
    expect(body.mode).toBe("live");
    expect(body.methodology).toHaveProperty("limitations");
  });

  it("leaves country-unassigned activity unassigned", async () => {
    service.getEvents.mockResolvedValue(snapshot("live", [
      event({ country: "", countryCode: "", latitude: undefined, longitude: undefined, locationAccuracy: "unknown" }),
    ]));
    const body = await (await riskRoute(request("risk"))).json();
    expect(body.regions).toHaveLength(1);
    expect(body.regions[0]).toMatchObject({ countryCode: "", country: "Unassigned", eventCount: 1 });
    expect(body.events[0]).not.toHaveProperty("latitude");
    expect(body.events[0]).not.toHaveProperty("longitude");
  });

  it("orders source-provided timeline updates chronologically and preserves record identity", async () => {
    const response = await timelineRoute(request("timeline"));
    const body = await response.json() as EventsResponse & {
      updates: { id: string; timestamp: string; eventId: string; eventTitle: string; isDemo: boolean }[];
    };
    expect(response.status).toBe(200);
    const timestamps = body.updates.map(({ timestamp }) => Date.parse(timestamp));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(body.updates).toHaveLength(4);
    expect(body.updates.every((update) => !update.isDemo && Boolean(update.eventId) && Boolean(update.eventTitle))).toBe(true);
    expect(body.updates.find(({ id }) => id === "fixture:first")?.eventId).toBe("fixture:ukraine");
  });

  it("excludes filtered-out events from the timeline", async () => {
    const body = await (await timelineRoute(request("timeline", "category=natural-disaster"))).json();
    expect(body.updates).toHaveLength(1);
    expect(body.updates[0].eventId).toBe("fixture:japan");
  });

  it("does not invent timeline updates when the publisher supplied none", async () => {
    service.getEvents.mockResolvedValue(snapshot("live", [event({ timeline: [], relatedEvents: [] })]));
    const body = await (await timelineRoute(request("timeline"))).json();
    expect(body.events[0].timeline).toEqual([]);
    expect(body.events[0].relatedEvents).toEqual([]);
    expect(body.updates).toEqual([]);
  });

  it("exposes source health, timestamps and warnings without event duplication", async () => {
    const response = await sourcesRoute(request("sources", "mode=live"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      mode: "live",
      referenceTime: REFERENCE,
      updatedAt: REFERENCE,
      sources: snapshot("live").sources,
      warnings: snapshot("live").warnings,
    });
    expect(body).not.toHaveProperty("events");
  });

  it("checks health without initiating event ingestion", async () => {
    const response = await healthRoute();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", service: "Atlas Signal" });
    expect(service.getHealth).toHaveBeenCalledOnce();
    expect(service.getEvents).not.toHaveBeenCalled();
  });

  describe.each([
    ["events", eventsRoute],
    ["events/fixture:ukraine", (input: Request) => eventRoute(input, { params: Promise.resolve({ id: "fixture:ukraine" }) })],
    ["countries/UA", (input: Request) => countryRoute(input, { params: Promise.resolve({ country: "UA" }) })],
    ["conflicts", conflictsRoute],
    ["conflicts/russia-ukraine", (input: Request) => conflictRoute(input, { params: Promise.resolve({ id: "russia-ukraine" }) })],
    ["search", searchRoute],
    ["risk", riskRoute],
    ["timeline", timelineRoute],
    ["sources", sourcesRoute],
    ["stream", streamRoute],
  ])("%s live-only boundary", (path, route) => {
    it.each([
      "mode=demo", "mode=arbitrary", "mode=", "mode=live&mode=live", "mode=live&mode=demo",
    ])("rejects %s before accessing providers", async (query) => {
      const response = await route(request(path, query));
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(service.getEvents).not.toHaveBeenCalled();
    });
  });
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for (let index = 0; index < 10; index++) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.includes(marker)) return text;
  }
  throw new Error(`Expected stream marker ${marker} was not received.`);
}

function streamData(text: string): EventsResponse {
  const line = text.split("\n").find((value) => value.startsWith("data:"));
  if (!line) throw new Error("The stream frame did not include data.");
  return JSON.parse(line.slice("data:".length).trim()) as EventsResponse;
}

describe("server-sent events lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(REFERENCE));
  });

  it("sends named live snapshots with retry and streaming headers", async () => {
    const response = await streamRoute(request("stream", "mode=live&category=natural-disaster"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    const reader = response.body!.getReader();
    try {
      const text = await readUntil(reader, "event: events");
      expect(text).toMatch(/retry:\s*3000/);
      expect(streamData(text)).toMatchObject({ mode: "live", total: 1 });
      expect(streamData(text).events.every((item) => !item.isDemo)).toBe(true);
    } finally {
      await reader.cancel();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects malformed filters before opening a stream or querying providers", async () => {
    const response = await streamRoute(request("stream", "severity=NaN"));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(service.getEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends a sanitized error and releases timers if initial ingestion fails", async () => {
    service.getEvents.mockRejectedValue(new Error(PRIVATE_ERROR));
    const response = await streamRoute(request("stream", "mode=live"));
    const reader = response.body!.getReader();
    const text = await readUntil(reader, "event: error");
    expect(text).toContain("temporarily unavailable");
    expect(text).not.toContain("private-password");
    expect(text).not.toContain("internal-database");
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls after 15 seconds, applies filters and stops all timers on cancellation", async () => {
    const response = await streamRoute(request("stream", "severity=6"));
    const reader = response.body!.getReader();
    const initial = streamData(await readUntil(reader, "event: events"));
    expect(eventIds(initial.events)).toEqual(["fixture:ukraine"]);
    expect(service.getEvents).toHaveBeenCalledTimes(1);
    expect(service.getEvents).toHaveBeenCalledWith("live");
    const refreshed = snapshot();
    refreshed.updatedAt = "2026-09-13T12:00:15.000Z";
    refreshed.events[0].title = "Updated source-record title";
    service.getEvents.mockResolvedValue(refreshed);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(service.getEvents).toHaveBeenCalledTimes(2);
    const update = streamData(await readUntil(reader, "event: events"));
    expect(update.total).toBe(1);
    expect(update.events[0].title).toBe("Updated source-record title");
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(service.getEvents).toHaveBeenCalledTimes(2);
  });

  it.each(["identical", "reference-time-only"])("does not resend a %s snapshot", async (change) => {
    const response = await streamRoute(request("stream"));
    const reader = response.body!.getReader();
    await readUntil(reader, "event: events");
    const unchanged = snapshot();
    if (change === "reference-time-only") unchanged.referenceTime = "2026-09-13T12:00:15.000Z";
    service.getEvents.mockResolvedValue(unchanged);
    let received = false;
    const nextFrame = reader.read().then((result) => {
      received = true;
      return result;
    });
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(service.getEvents).toHaveBeenCalledTimes(2);
      expect(received).toBe(false);
    } finally {
      await reader.cancel();
    }
    expect((await nextFrame).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["source-health", "warnings"])("sends an updated snapshot when only %s changes", async (change) => {
    const response = await streamRoute(request("stream"));
    const reader = response.body!.getReader();
    try {
      await readUntil(reader, "event: events");
      const refreshed = snapshot();
      if (change === "source-health") refreshed.sources[0].status = "degraded";
      else refreshed.warnings = ["A source has stopped reporting."];
      service.getEvents.mockResolvedValue(refreshed);
      await vi.advanceTimersByTimeAsync(15_000);
      const update = streamData(await readUntil(reader, "event: events"));
      expect(update).toEqual(JSON.parse(JSON.stringify(refreshed)));
    } finally {
      await reader.cancel();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("streams genuinely empty coverage without invented records or success timestamps", async () => {
    const empty: EventsResponse = {
      ...snapshot("live", []),
      updatedAt: null,
      warnings: ["No source snapshot is available."],
    };
    service.getEvents.mockResolvedValue(empty);
    const response = await streamRoute(request("stream"));
    const reader = response.body!.getReader();
    try {
      const update = streamData(await readUntil(reader, "event: events"));
      expect(update).toEqual(empty);
      expect(service.getEvents).toHaveBeenCalledWith("live");
    } finally {
      await reader.cancel();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits a heartbeat comment and closes the connection within 55 seconds", async () => {
    const response = await streamRoute(request("stream"));
    const reader = response.body!.getReader();
    await readUntil(reader, "event: events");
    await vi.advanceTimersByTimeAsync(20_000);
    const heartbeat = await readUntil(reader, "heartbeat");
    expect(heartbeat).toMatch(/:\s*heartbeat/);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(vi.getTimerCount()).toBe(0);
    for (let index = 0; index < 10; index++) {
      if ((await reader.read()).done) return;
    }
    throw new Error("The stream did not close after its bounded lifetime.");
  });

  it("aborts a connected stream without leaking poll or heartbeat timers", async () => {
    const controller = new AbortController();
    const response = await streamRoute(request("stream", "", controller.signal));
    const reader = response.body!.getReader();
    await readUntil(reader, "event: events");
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    expect((await reader.read()).done).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getEvents).toHaveBeenCalledTimes(1);
  });

  it("does not poll a request that was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await streamRoute(request("stream", "", controller.signal));
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(true);
    expect(service.getEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap a pending snapshot fetch or write after cancellation", async () => {
    let resolvePending!: (value: EventsResponse) => void;
    service.getEvents.mockImplementation(() => new Promise<EventsResponse>((resolve) => { resolvePending = resolve; }));
    const response = await streamRoute(request("stream"));
    const reader = response.body!.getReader();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.getEvents).toHaveBeenCalledTimes(1);
    await reader.cancel();
    resolvePending(snapshot());
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect((await reader.read()).done).toBe(true);
  });
});
