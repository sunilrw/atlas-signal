import { describe, expect, it } from "vitest";
import { isLiveSourceEvent, isRemovedSampleId, readLiveSnapshot } from "../src/lib/live-data";
import { liveWatchlist, purgeRetiredBookmarks } from "../src/lib/preferences";
import type { AtlasEvent, EventsResponse, WatchlistEntry } from "../src/types";

// Test-only transport fixtures. These are never imported by the application.
const AT = "2026-09-13T09:00:00.000Z";
const REF = "2026-09-13T12:00:00.000Z";
function report(patch: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    id: "bbc:unit-report",
    title: "Publisher headline used in a transport test",
    summary: "Publisher-provided excerpt used only by this test.",
    category: "political",
    severity: null,
    confidence: null,
    status: "reported",
    country: "Unspecified",
    countryCode: "ZZ",
    region: "Unspecified",
    locationName: "Location not provided",
    locationAccuracy: "unknown",
    firstReportedAt: AT,
    lastUpdatedAt: AT,
    sources: [{
      id: "bbc:unit-report:source",
      name: "BBC News",
      url: "https://www.bbc.com/news/articles/unit-test",
      publishedAt: AT,
      type: "news",
      isDemo: false,
      publisherCountry: "United Kingdom"
    }],
    timeline: [{ id: "bbc:unit-report:published", title: "Source report published", timestamp: AT }],
    tags: ["live-source"],
    relatedEvents: [],
    isDemo: false,
    ...patch
  };
}
function snapshot(patch: Partial<EventsResponse> = {}): EventsResponse {
  return {
    events: [report()],
    total: 1,
    mode: "live",
    referenceTime: REF,
    updatedAt: REF,
    sources: [{
      id: "bbc", name: "BBC News", status: "healthy", lastFetchedAt: REF,
      eventCount: 1, message: "Source reports imported.",
      url: "https://feeds.bbci.co.uk/news/world/rss.xml"
    }],
    warnings: [],
    ...patch
  };
}

describe("live-only browser admission", () => {
  it("accepts an attributed, unassessed report without guessing its coordinates", () => {
    expect(isLiveSourceEvent(report())).toBe(true);
    const result = readLiveSnapshot(snapshot())!;
    expect(result.events[0].confidence).toBeNull();
    expect(result.events[0].severity).toBeNull();
    expect(result.events[0]).not.toHaveProperty("latitude");
    expect(result.events[0]).not.toHaveProperty("longitude");
  });
  it.each(["demo-event", "demo:event", "sample:event", "fixture:event", "event:demo-event"])("rejects retired identifier %s", (id) => {
    expect(isRemovedSampleId(id)).toBe(true);
    expect(isLiveSourceEvent(report({ id }))).toBe(false);
  });
  it("never mistakes real words such as democracy for a retired record", () => {
    expect(isRemovedSampleId("bbc:democracy")).toBe(false);
    expect(isRemovedSampleId("democracy")).toBe(false);
  });
  it("rejects synthetic flags at either provenance level", () => {
    expect(isLiveSourceEvent(report({ isDemo: true }))).toBe(false);
    expect(isLiveSourceEvent(report({ sources: [{ ...report().sources[0], isDemo: true }] }))).toBe(false);
  });
  it.each([0, 45, 80, 100])("does not revive an invented confidence score %s", (confidence) => {
    expect(isLiveSourceEvent(report({ confidence }))).toBe(false);
  });
  it("requires a disclosed severity basis for an assessed hazard", () => {
    expect(isLiveSourceEvent(report({ severity: 5 }))).toBe(false);
    expect(isLiveSourceEvent(report({ category: "natural-disaster", severity: 5, severityReason: "Derived from provider magnitude.", sources: [{ ...report().sources[0], type: "primary" }] }))).toBe(true);
  });
  it.each(["javascript:alert(1)", "data:text/html,example", "https://user:secret@example.org/report"])("rejects unsafe source URLs", (url) => {
    expect(isLiveSourceEvent(report({ sources: [{ ...report().sources[0], url }] }))).toBe(false);
  });
  it.each(["2026-02-30T12:00:00Z", "2026-09-13T12:00:00", "not-a-date"])("rejects invalid or timezone-less source timestamps %s", (publishedAt) => {
    expect(isLiveSourceEvent(report({ sources: [{ ...report().sources[0], publishedAt }] }))).toBe(false);
  });
  it("rejects missing sources, malformed text, partial coordinates and untrusted categories without throwing", () => {
    expect(isLiveSourceEvent(report({ sources: [] }))).toBe(false);
    expect(isLiveSourceEvent({ ...report(), title: 123 })).toBe(false);
    expect(isLiveSourceEvent({ ...report(), severity: 4, severityReason: {} })).toBe(false);
    expect(isLiveSourceEvent(report({ latitude: 0 }))).toBe(false);
    expect(isLiveSourceEvent({ ...report(), category: "constructor" })).toBe(false);
  });
  it("does not accept a retired mode even with otherwise real-looking records", () => {
    expect(readLiveSnapshot({ ...snapshot(), mode: "demo" })).toBeNull();
  });
  it("admits an honest empty outage without inventing a successful fetch", () => {
    const result = readLiveSnapshot(snapshot({ events: [], total: 0, updatedAt: null, sources: [] }));
    expect(result).toMatchObject({ events: [], total: 0, updatedAt: null, mode: "live" });
  });
  it("omits invalid and future-dated reports but keeps valid records", () => {
    const future = "2026-09-14T10:00:00.000Z";
    const result = readLiveSnapshot(snapshot({
      events: [report(), report({ id: "demo-retired" }), report({ id: "bbc:future", firstReportedAt: future, lastUpdatedAt: future })],
      total: 3
    }))!;
    expect(result.events.map((event) => event.id)).toEqual(["bbc:unit-report"]);
    expect(result.total).toBe(1);
    expect(result.warnings.join(" ")).toContain("omitted");
  });
  it("rejects future publication metadata even inside a current event", () => {
    const result = readLiveSnapshot(snapshot({ events: [report({ sources: [{ ...report().sources[0], publishedAt: "2026-09-14T00:00:00Z" }] })] }))!;
    expect(result.events).toEqual([]);
  });
  it("rejects malformed snapshot source-health and warning shapes", () => {
    expect(readLiveSnapshot({ ...snapshot(), sources: [{ id: "bbc", status: "healthy" }] })).toBeNull();
    expect(readLiveSnapshot({ ...snapshot(), warnings: [null] })).toBeNull();
    expect(readLiveSnapshot({ ...snapshot(), updatedAt: "2026-02-30T00:00:00Z" })).toBeNull();
  });
  it("rejects retired relationships and update history, not just top-level records", () => {
    expect(isLiveSourceEvent(report({ relatedEvents: ["demo-retired"] }))).toBe(false);
    expect(isLiveSourceEvent(report({ timeline: [{ id: "demo-retired:history", timestamp: AT, title: "Retired update" }] }))).toBe(false);
  });
  it("rejects malformed optional text and state instead of crashing the renderer", () => {
    expect(isLiveSourceEvent({ ...report(), verificationNote: {} })).toBe(false);
    expect(isLiveSourceEvent({ ...report(), status: undefined })).toBe(false);
    expect(isLiveSourceEvent({ ...report(), locationAccuracy: "imagined" })).toBe(false);
    expect(isLiveSourceEvent({ ...report(), reportKind: [] })).toBe(false);
    expect(isLiveSourceEvent(report({ sources: [{ ...report().sources[0], byline: 12 as unknown as string }] }))).toBe(false);
  });
  it("does not accept made-up future envelope or fetch clocks", () => {
    expect(readLiveSnapshot(snapshot({ referenceTime: "2099-01-01T00:00:00Z" }))).toBeNull();
    expect(readLiveSnapshot(snapshot({ updatedAt: "2099-01-01T00:00:00Z" }))).toBeNull();
    expect(readLiveSnapshot(snapshot({ sources: [{ ...snapshot().sources[0], lastFetchedAt: "2099-01-01T00:00:00Z" }] }))).toBeNull();
  });
  it("does not display future observation, detection, or history timestamps", () => {
    const future = "2026-09-14T00:00:00Z";
    for (const record of [
      report({ detectedAt: future }),
      report({ sources: [{ ...report().sources[0], observedAt: future }] }),
      report({ timeline: [{ id: "bbc:later", timestamp: future, title: "Later source update" }] })
    ]) expect(readLiveSnapshot(snapshot({ events: [record] }))?.events).toEqual([]);
  });
});

describe("removal of retired local bookmarks", () => {
  const entries: WatchlistEntry[] = [
    { id: "event:demo-kharkiv-response", kind: "event", value: "demo-kharkiv-response", label: "Retired sample" },
    { id: "country:UA", kind: "country", value: "UA", label: "Ukraine" },
    { id: "event:bbc:unit-report", kind: "event", value: "bbc:unit-report", label: "Saved source report" }
  ];
  it("removes only unsupported sample bookmarks", () => {
    expect(liveWatchlist(entries)).toEqual(entries.slice(1));
    expect(entries).toHaveLength(3);
  });
  it("purges the persisted sample entries while preserving other saved items", () => {
    let stored = JSON.stringify(entries);
    const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } };
    expect(purgeRetiredBookmarks(storage)).toBe(true);
    expect(JSON.parse(stored)).toEqual(entries.slice(1));
    expect(purgeRetiredBookmarks(storage)).toBe(false);
  });
  it("does not erase unrelated or unreadable preferences", () => {
    let writes = 0;
    const storage = { getItem: () => "not-json", setItem: () => { writes += 1; } };
    expect(purgeRetiredBookmarks(storage)).toBe(false);
    expect(writes).toBe(0);
  });
});
