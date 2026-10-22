import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasEvent } from "../src/types";
import {
  closeStore,
  getStoreStatus,
  readSnapshot,
  resetStoreForTests,
  writeSnapshot,
  type StoredSnapshot,
} from "../src/lib/server/store";

const database = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  const query = vi.fn();
  const connect = vi.fn();
  const end = vi.fn();
  const on = vi.fn();
  const pool = { query, connect, end, on };
  const Pool = vi.fn(function MockPool() {
    return pool;
  });
  return { Pool, query, connect, end, on, clientQuery, release };
});

vi.mock("pg", () => ({
  Pool: database.Pool,
  default: { Pool: database.Pool },
}));

const NOW = "2026-09-13T12:00:00.000Z";
const DATABASE_URL = "postgresql://atlas:test-password@database.example:5432/atlas";
const PRIVATE_ERROR =
  "authentication failed for postgresql://atlas:private-secret@internal-database:5432/private-db";

function event(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    id: "usgs:test-earthquake",
    title: "Reported earthquake",
    summary: "An automatically classified earthquake record from the source feed.",
    category: "natural-disaster",
    severity: 3,
    severityReason: "Synthetic test fixture: magnitude bracket; not a real-world observation.",
    status: "reported",
    confidence: null,
    latitude: 35.2,
    longitude: 139.4,
    locationName: "Offshore Japan",
    country: "Japan",
    countryCode: "JP",
    region: "Asia",
    locationAccuracy: "exact",
    firstReportedAt: "2026-09-13T09:00:00.000Z",
    lastUpdatedAt: "2026-09-13T10:00:00.000Z",
    sources: [
      {
        id: "usgs:test-earthquake:source",
        name: "USGS",
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/test-earthquake",
        publishedAt: "2026-09-13T09:00:00.000Z",
        type: "primary",
        isDemo: false,
      },
    ],
    timeline: [
      {
        id: "usgs:test-earthquake:reported",
        timestamp: "2026-09-13T09:00:00.000Z",
        title: "Provider record published",
      },
    ],
    relatedEvents: [],
    tags: ["automated-classification"],
    isDemo: false,
    ...overrides,
  };
}

function snapshot(
  fetchedAt = NOW,
  events: AtlasEvent[] = [event()],
): StoredSnapshot {
  return { providerId: "usgs", fetchedAt, events };
}

function row(value: StoredSnapshot) {
  return {
    provider_id: value.providerId,
    fetched_at: new Date(value.fetchedAt),
    snapshot: value,
  };
}

function rawRecords(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    provider: "usgs" as const,
    providerId: `raw-${offset + index}`,
    fetchedAt: NOW,
    payload: { id: `raw-${offset + index}`, magnitude: 4.2 },
  }));
}

function expectSanitizedWarning(warning: string | undefined) {
  expect(warning).toEqual(expect.any(String));
  expect(warning).not.toContain("private-secret");
  expect(warning).not.toContain("internal-database");
  expect(warning).not.toContain("private-db");
  expect(warning).not.toContain("postgresql://");
}

beforeEach(() => {
  resetStoreForTests();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  database.query.mockReset().mockResolvedValue({ rows: [] });
  database.clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  database.connect.mockReset().mockResolvedValue({
    query: database.clientQuery,
    release: database.release,
  });
  database.end.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await closeStore();
  resetStoreForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("optional in-memory persistence", () => {
  it("works without a database or paid-service configuration", async () => {
    expect(getStoreStatus()).toMatchObject({
      mode: "memory",
      available: true,
      rawRecords: 0,
    });
    expect(await readSnapshot("usgs")).toMatchObject({ snapshot: null });

    const value = snapshot();
    expect((await writeSnapshot(value, [])).warning).toBeUndefined();
    expect((await readSnapshot("usgs")).snapshot).toEqual(value);
    expect(database.Pool).not.toHaveBeenCalled();
  });

  it("does not replace a newer snapshot with an older worker result", async () => {
    const newer = snapshot("2026-09-13T12:00:00.000Z", [
      event({ title: "More recent provider report" }),
    ]);
    const older = snapshot("2026-09-13T11:00:00.000Z", [
      event({ title: "Earlier provider report" }),
    ]);

    await writeSnapshot(newer, []);
    await writeSnapshot(older, []);

    expect((await readSnapshot("usgs")).snapshot).toEqual(newer);
  });

  it("preserves missing coordinates instead of creating a map position", async () => {
    const value = snapshot(NOW, [
      event({
        latitude: undefined,
        longitude: undefined,
        locationAccuracy: "unknown",
      }),
    ]);

    await writeSnapshot(value, []);
    const stored = (await readSnapshot("usgs")).snapshot?.events[0];

    expect(stored).toBeDefined();
    expect(stored?.latitude).toBeUndefined();
    expect(stored?.longitude).toBeUndefined();
    expect(stored?.locationAccuracy).toBe("unknown");
  });

  it("persists unassessed scores as null without assigning defaults", async () => {
    const value = snapshot(NOW, [
      event({ severity: null, severityReason: undefined, confidence: null, reportKind: "news" }),
    ]);

    expect((await writeSnapshot(value, [])).warning).toBeUndefined();
    expect((await readSnapshot("usgs")).snapshot?.events[0]).toMatchObject({
      severity: null,
      confidence: null,
      reportKind: "news",
    });
  });

  it("round-trips source attribution and observation clocks without relabeling them", async () => {
    const value = snapshot(NOW, [
      event({
        verificationNote: "Source-reported observation; no independent verification.",
        reportKind: "incident",
        locationEvidence: "Coordinates supplied in the provider record.",
        detectedAt: "2026-09-13T11:45:00.000Z",
        sources: [{
          ...event().sources[0],
          providerId: "usgs",
          publisherCountry: "United States",
          language: "en",
          byline: "Test fixture author",
          observedAt: "2026-09-13T11:45:00.000Z",
          timestampBasis: "occurred",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          publisherUrl: "https://www.usgs.gov/",
        }],
      }),
    ]);

    expect((await writeSnapshot(value, [])).warning).toBeUndefined();
    expect((await readSnapshot("usgs")).snapshot).toEqual(value);
  });

  it("accepts newly configured news providers through the shared provider registry", async () => {
    const value: StoredSnapshot = {
      providerId: "dw",
      fetchedAt: NOW,
      events: [event({
        id: "dw:test-news",
        category: "political",
        severity: null,
        severityReason: undefined,
        confidence: null,
        reportKind: "news",
        sources: [{
          ...event().sources[0],
          id: "dw:test-news:source",
          providerId: "dw",
          type: "news",
          url: "https://www.dw.com/en/test-news/a-1234",
          name: "DW",
        }],
      })],
    };

    expect((await writeSnapshot(value, [])).warning).toBeUndefined();
    expect((await readSnapshot("dw")).snapshot).toEqual(value);
  });

  it("rejects unconfigured provider identifiers before database access", async () => {
    const value = { ...snapshot(), providerId: "unconfigured" as StoredSnapshot["providerId"] };
    expect((await writeSnapshot(value, [])).warning).toBeDefined();
    expect((await readSnapshot(value.providerId)).snapshot).toBeNull();
    expect(database.Pool).not.toHaveBeenCalled();
  });

  it("omits retired or fabricated raw records while retaining valid provider data", async () => {
    const originals = rawRecords(1);
    const bad = [
      { ...originals[0], providerId: "demo:retired" },
      { ...originals[0], payload: { isDemo: true, id: "fictional" } },
      { ...originals[0], payload: { id: "demo-scenario" } },
      { ...originals[0], fetchedAt: "2026-09-14T00:00:00.000Z" },
    ];

    const result = await writeSnapshot(snapshot(), [...originals, ...bad]);

    expect(result.warning).toBeDefined();
    expect(getStoreStatus().rawRecords).toBe(1);
    expect((await readSnapshot("usgs")).snapshot).toEqual(snapshot());
  });

  it("isolates cached snapshots from mutations by readers and callers", async () => {
    const value = snapshot();
    await writeSnapshot(value, []);
    value.events[0].title = "Changed by the original caller";
    const firstRead = (await readSnapshot("usgs")).snapshot;
    expect(firstRead?.events[0].title).toBe("Reported earthquake");
    if (firstRead) {
      firstRead.events[0].sources[0].url = "https://example.com/replaced";
      firstRead.events.length = 0;
    }

    expect((await readSnapshot("usgs")).snapshot).toEqual(snapshot());
  });

  it("bounds raw records per ingestion call and across repeated calls", async () => {
    await writeSnapshot(snapshot(), rawRecords(800));
    expect(getStoreStatus().rawRecords).toBe(500);

    for (let batch = 1; batch < 6; batch += 1) {
      vi.advanceTimersByTime(1_000);
      await writeSnapshot(
        snapshot(new Date(Date.parse(NOW) + batch * 1_000).toISOString()),
        rawRecords(800, batch * 1_000),
      );
    }

    expect(getStoreStatus().rawRecords).toBe(2_000);
    expect(database.Pool).not.toHaveBeenCalled();
  });

  it("clears process-local snapshots and raw retention between isolated stores", async () => {
    await writeSnapshot(snapshot(), rawRecords(2));
    resetStoreForTests();

    expect((await readSnapshot("usgs")).snapshot).toBeNull();
    expect(getStoreStatus().rawRecords).toBe(0);
  });
});

describe("PostgreSQL persistence", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
  });

  it("reports configured-but-unverified storage without eagerly opening a pool", () => {
    expect(getStoreStatus()).toMatchObject({
      mode: "postgres",
      available: false,
    });
    expect(database.Pool).not.toHaveBeenCalled();
  });

  it("creates a bounded, time-limited pool and parameterizes provider reads", async () => {
    await readSnapshot("usgs");

    expect(database.Pool).toHaveBeenCalledOnce();
    expect(database.Pool).toHaveBeenCalledWith({
      connectionString: DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 4_000,
      query_timeout: 5_000,
      idle_in_transaction_session_timeout: 5_000,
      allowExitOnIdle: true,
    });
    expect(database.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(database.query).toHaveBeenCalledWith(
      expect.stringMatching(/\bSELECT\b[\s\S]*\$1/i),
      ["usgs"],
    );
    expect(getStoreStatus().available).toBe(true);
  });

  it("handles driver construction failures without exposing connection details", async () => {
    database.Pool.mockImplementationOnce(function UnavailablePool() {
      throw new Error(PRIVATE_ERROR);
    });

    const result = await readSnapshot("usgs");

    expect(result.snapshot).toBeNull();
    expectSanitizedWarning(result.warning);
    expectSanitizedWarning(getStoreStatus().warning);
    expect(getStoreStatus().available).toBe(false);
    expect(database.connect).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });

  it("loads a valid snapshot persisted by a different worker", async () => {
    const persisted = snapshot();
    database.query.mockResolvedValueOnce({ rows: [row(persisted)] });

    const result = await readSnapshot("usgs");

    expect(result.snapshot).toEqual(persisted);
    expect(result.warning).toBeUndefined();
    expect(getStoreStatus()).toMatchObject({
      mode: "postgres",
      available: true,
    });
  });

  it("supports PostgreSQL timestamp rows represented as strings", async () => {
    const persisted = snapshot();
    database.query.mockResolvedValueOnce({
      rows: [{ ...row(persisted), fetched_at: persisted.fetchedAt }],
    });

    expect((await readSnapshot("usgs")).snapshot).toEqual(persisted);
  });

  it("caches reads for one minute and then refreshes shared worker state", async () => {
    const first = snapshot("2026-09-13T11:00:00.000Z");
    const next = snapshot("2026-09-13T12:01:00.000Z", [
      event({ title: "Updated by another worker" }),
    ]);
    database.query
      .mockResolvedValueOnce({ rows: [row(first)] })
      .mockResolvedValueOnce({ rows: [row(next)] });

    expect((await readSnapshot("usgs")).snapshot).toEqual(first);
    expect((await readSnapshot("usgs")).snapshot).toEqual(first);
    vi.advanceTimersByTime(59_999);
    expect((await readSnapshot("usgs")).snapshot).toEqual(first);
    expect(database.query).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    expect((await readSnapshot("usgs")).snapshot).toEqual(next);
    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it("retains newer process-local data when the persisted snapshot is older", async () => {
    const local = snapshot();
    const older = snapshot("2026-09-13T11:00:00.000Z", [
      event({ title: "Older shared snapshot" }),
    ]);
    await writeSnapshot(local, []);
    vi.advanceTimersByTime(60_001);
    database.query.mockResolvedValueOnce({ rows: [row(older)] });

    expect((await readSnapshot("usgs")).snapshot).toEqual(local);
  });

  it("adopts a newer persisted snapshot after a process-local write", async () => {
    const local = snapshot("2026-09-13T11:00:00.000Z");
    const newer = snapshot("2026-09-13T12:00:00.000Z", [
      event({ title: "Newer shared snapshot" }),
    ]);
    await writeSnapshot(local, []);
    vi.advanceTimersByTime(60_001);
    database.query.mockResolvedValueOnce({ rows: [row(newer)] });

    expect((await readSnapshot("usgs")).snapshot).toEqual(newer);
  });

  it("writes snapshots and raw records in one parameterized transaction", async () => {
    const title = "Provider report '; DROP TABLE atlas_ingestion_snapshots; --";
    const value = snapshot(NOW, [event({ title })]);
    const raw = rawRecords(2);

    expect((await writeSnapshot(value, raw)).warning).toBeUndefined();

    const calls = database.clientQuery.mock.calls;
    const sql = calls.map(([statement]) => String(statement).trim());
    expect(sql[0]).toMatch(/^BEGIN$/i);
    expect(sql.at(-1)).toMatch(/^COMMIT$/i);
    expect(database.connect).toHaveBeenCalledOnce();
    expect(database.release).toHaveBeenCalledOnce();
    expect(sql.join("\n")).not.toContain(title);

    const snapshotWrite = calls.find(([statement]) =>
      /INSERT\s+INTO\s+atlas_ingestion_snapshots/i.test(String(statement)),
    );
    expect(snapshotWrite).toBeDefined();
    expect(snapshotWrite?.[0]).toMatch(/\$\d/);
    expect(JSON.stringify(snapshotWrite?.[1])).toContain("DROP TABLE");
    expect(snapshotWrite?.[0]).toMatch(/\bWHERE\b[\s\S]*fetched_at/i);
    expect(snapshotWrite?.[0]).toMatch(
      /(?:excluded\.fetched_at\s*>=\s*\w+\.fetched_at|\w+\.fetched_at\s*<=\s*excluded\.fetched_at)/i,
    );

    const rawWrite = calls.find(([statement]) =>
      /INSERT\s+INTO\s+atlas_source_records/i.test(String(statement)),
    );
    expect(rawWrite).toBeDefined();
    expect(rawWrite?.[0]).toMatch(/\$\d/);
    expect(JSON.stringify(rawWrite?.[1])).toContain("raw-0");
    expect(JSON.stringify(rawWrite?.[1])).toContain("raw-1");
    expect(getStoreStatus().available).toBe(true);
  });

  it("bounds the raw records sent to PostgreSQL in a single ingestion transaction", async () => {
    await writeSnapshot(snapshot(), rawRecords(800));
    const rawWrites = database.clientQuery.mock.calls.filter(([statement]) =>
      /INSERT\s+INTO\s+atlas_source_records/i.test(String(statement)),
    );
    expect(rawWrites).toHaveLength(1);
    const encodedRecords = JSON.stringify(rawWrites[0][1]);
    const submittedIds = new Set(encodedRecords.match(/raw-\d+/g));

    expect(submittedIds.size).toBe(500);
    expect(getStoreStatus().rawRecords).toBe(500);
  });

  it("deduplicates raw provider IDs and persists only their newest payload", async () => {
    const base = rawRecords(1)[0];
    const newer = { ...base, fetchedAt: NOW, payload: { revision: "newest" } };
    const older = {
      ...base,
      fetchedAt: "2026-09-13T11:00:00.000Z",
      payload: { revision: "older" },
    };

    await writeSnapshot(snapshot(), [newer, older, newer]);

    const rawWrites = database.clientQuery.mock.calls.filter(([statement]) =>
      /INSERT\s+INTO\s+atlas_source_records/i.test(String(statement)),
    );
    expect(rawWrites).toHaveLength(1);
    expect(JSON.parse(rawWrites[0][1][1])).toEqual([
      {
        provider_record_id: base.providerId,
        fetched_at: NOW,
        payload: { revision: "newest" },
      },
    ]);
    expect(getStoreStatus().rawRecords).toBe(1);
  });

  it("bounds the aggregate raw PostgreSQL payload independently of record count", async () => {
    const records = rawRecords(40).map((record) => ({
      ...record,
      payload: { body: "a".repeat(250 * 1_024) },
    }));

    const result = await writeSnapshot(snapshot(), records);

    expect(result.warning).toEqual(expect.any(String));
    const rawWrite = database.clientQuery.mock.calls.find(([statement]) =>
      /INSERT\s+INTO\s+atlas_source_records/i.test(String(statement)),
    );
    expect(rawWrite).toBeDefined();
    const encoded: string = rawWrite?.[1][1];
    const persisted: unknown[] = JSON.parse(encoded);
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.length).toBeLessThan(40);
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(8 * 1_024 * 1_024);
    expect(getStoreStatus().rawRecords).toBe(persisted.length);
  });

  const invalidPayloads: [string, () => unknown][] = [
    [
      "cyclic",
      () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        return cyclic;
      },
    ],
    ["oversized", () => ({ body: "a".repeat(300 * 1_024) })],
  ];

  it.each(invalidPayloads)(
    "omits %s raw payloads with a warning while committing the valid snapshot",
    async (_label, createPayload) => {
      const value = snapshot();
      const invalid = { ...rawRecords(1)[0], payload: createPayload() };

      const result = await writeSnapshot(value, [invalid]);

      expect(result.warning).toEqual(expect.any(String));
      expect(getStoreStatus()).toMatchObject({ available: true, rawRecords: 0 });
      const sql = database.clientQuery.mock.calls.map(([statement]) =>
        String(statement).trim(),
      );
      expect(sql.some((statement) => /INSERT\s+INTO\s+atlas_source_records/i.test(statement))).toBe(false);
      expect(sql.at(-1)).toBe("COMMIT");
      expect(database.release).toHaveBeenCalledOnce();
      expect((await readSnapshot("usgs")).snapshot).toEqual(value);
    },
  );

  it("rolls back and releases a failed transaction while retaining local data", async () => {
    database.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    const value = snapshot();

    const result = await writeSnapshot(value, rawRecords(1));

    expectSanitizedWarning(result.warning);
    expect(database.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(database.release).toHaveBeenCalledOnce();
    expect(database.clientQuery.mock.calls.some(([statement]) =>
      /^COMMIT$/i.test(String(statement).trim()),
    )).toBe(false);
    expect(getStoreStatus().available).toBe(false);

    database.query.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    vi.advanceTimersByTime(60_001);
    expect((await readSnapshot("usgs")).snapshot).toEqual(value);
    expect(database.query).toHaveBeenCalledOnce();
  });

  it("rolls back the snapshot when inserting the raw records fails", async () => {
    database.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(new Error(PRIVATE_ERROR));

    const result = await writeSnapshot(snapshot(), rawRecords(2));

    const sql = database.clientQuery.mock.calls.map(([statement]) =>
      String(statement).trim(),
    );
    expectSanitizedWarning(result.warning);
    expect(sql[1]).toMatch(/INSERT\s+INTO\s+atlas_ingestion_snapshots/i);
    expect(sql[2]).toMatch(/INSERT\s+INTO\s+atlas_source_records/i);
    expect(sql.at(-1)).toBe("ROLLBACK");
    expect(sql.some((statement) => /^COMMIT$/i.test(statement))).toBe(false);
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("keeps local snapshots usable when a database connection cannot be acquired", async () => {
    database.connect.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    const value = snapshot();

    const result = await writeSnapshot(value, []);

    expectSanitizedWarning(result.warning);
    expect(database.release).not.toHaveBeenCalled();
    expect(getStoreStatus().available).toBe(false);
    database.query.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    vi.advanceTimersByTime(60_001);
    expect((await readSnapshot("usgs")).snapshot).toEqual(value);
    expect(database.query).toHaveBeenCalledOnce();
  });

  it("sanitizes read failures and recovers after a subsequent successful read", async () => {
    database.query.mockRejectedValueOnce(new Error(PRIVATE_ERROR));

    const failure = await readSnapshot("usgs");

    expect(failure.snapshot).toBeNull();
    expectSanitizedWarning(failure.warning);
    expectSanitizedWarning(getStoreStatus().warning);
    expect(getStoreStatus().available).toBe(false);

    const persisted = snapshot();
    database.query.mockResolvedValueOnce({ rows: [row(persisted)] });
    vi.advanceTimersByTime(60_001);
    const recovered = await readSnapshot("usgs");

    expect(recovered.snapshot).toEqual(persisted);
    expect(recovered.warning).toBeUndefined();
    expect(getStoreStatus().available).toBe(true);
  });

  it("handles idle pool errors without leaking database connection details", async () => {
    await readSnapshot("usgs");
    const errorHandler = database.on.mock.calls.find(([name]) => name === "error")?.[1];
    expect(errorHandler).toEqual(expect.any(Function));

    errorHandler(new Error(PRIVATE_ERROR));

    expect(getStoreStatus().available).toBe(false);
    expectSanitizedWarning(getStoreStatus().warning);
  });

  it("closes the lazily constructed pool explicitly", async () => {
    await readSnapshot("usgs");
    await closeStore();

    expect(database.end).toHaveBeenCalledOnce();
  });
});

describe("untrusted persisted snapshots", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
  });

  const malformedEvents: [string, () => AtlasEvent][] = [
    ["invalid event timestamp", () => event({ lastUpdatedAt: "not-a-date" })],
    ["out-of-range latitude", () => event({ latitude: 91 })],
    ["out-of-range longitude", () => event({ longitude: -181 })],
    ["non-finite coordinates", () => event({ latitude: Number.NaN })],
    ["unpaired coordinates", () => event({ longitude: undefined })],
    ["out-of-range confidence", () => event({ confidence: 101 })],
    ["negative confidence", () => event({ confidence: -1 })],
    ["legacy unverified numeric confidence", () => event({ confidence: 72 })],
    ["zero misrepresented as assessed confidence", () => event({ confidence: 0 })],
    ["invalid category", () => event({ category: "untrusted" as AtlasEvent["category"] })],
    ["invalid severity", () => event({ severity: 8 as AtlasEvent["severity"] })],
    ["fractional severity", () => event({ severity: 2.5 as AtlasEvent["severity"] })],
    ["severity without a disclosed hazard basis", () => event({ severityReason: undefined })],
    ["unassessed news assigned a severity", () => event({ reportKind: "news" })],
    ["unassessed analysis assigned a severity", () => event({ reportKind: "analysis" })],
    ["non-hazard severity", () => event({ category: "conflict" })],
    ["invalid status", () => event({ status: "verified-by-ai" as AtlasEvent["status"] })],
    ["demo data in a live snapshot", () => event({ isDemo: true })],
    ["retired fictional event ID", () => event({ id: "demo:retired-earthquake" })],
    ["retired hyphenated fictional ID", () => event({ id: "DEMO-retired-earthquake" })],
    ["inferred event relationships", () => event({ relatedEvents: ["usgs:neighbor"] })],
    ["legacy confidence tag", () => event({ tags: ["automated-confidence"] })],
    ["future event publication", () => event({ lastUpdatedAt: "2026-09-14T00:00:00.000Z" })],
    ["future detection timestamp", () => event({ detectedAt: "2026-09-14T00:00:00.000Z" })],
    ["invalid calendar date", () => event({ firstReportedAt: "2026-02-30T00:00:00.000Z" })],
    ["unordered event timestamps", () => event({ firstReportedAt: "2026-09-13T11:00:00.000Z" })],
    [
      "demo provenance in a live source",
      () => event({
        sources: [{ ...event().sources[0], isDemo: true }],
      }),
    ],
    [
      "retired fictional source ID",
      () => event({
        sources: [{ ...event().sources[0], id: "demo-source" }],
      }),
    ],
    ["missing sources", () => event({ sources: [] })],
    [
      "non-HTTP source URL",
      () => event({
        sources: [{ ...event().sources[0], url: "javascript:alert('source')" }],
      }),
    ],
    [
      "source URL with embedded credentials",
      () => event({
        sources: [{ ...event().sources[0], url: "https://user:secret@example.com/report" }],
      }),
    ],
    [
      "invalid source timestamp",
      () => event({
        sources: [{ ...event().sources[0], publishedAt: "not-a-date" }],
      }),
    ],
    [
      "future source publication",
      () => event({
        sources: [{ ...event().sources[0], publishedAt: "2026-09-14T00:00:00.000Z" }],
      }),
    ],
    [
      "future source observation",
      () => event({
        sources: [{ ...event().sources[0], observedAt: "2026-09-14T00:00:00.000Z" }],
      }),
    ],
    [
      "unsafe source license",
      () => event({
        sources: [{ ...event().sources[0], licenseUrl: "javascript:alert(1)" }],
      }),
    ],
    [
      "unsupported provider provenance",
      () => event({
        sources: [{ ...event().sources[0], providerId: "invented-provider" }],
      }),
    ],
    [
      "invalid timeline timestamp",
      () => event({
        timeline: [{ id: "invalid-update", timestamp: "not-a-date", title: "Update" }],
      }),
    ],
  ];

  it.each(malformedEvents)("rejects the complete snapshot for %s", async (_label, createEvent) => {
    const invalid = snapshot(NOW, [event(), createEvent()]);
    database.query.mockResolvedValueOnce({ rows: [row(invalid)] });

    const result = await readSnapshot("usgs");

    expect(result.snapshot).toBeNull();
    expect(result.warning).toEqual(expect.any(String));
  });

  it("rejects invalid snapshot timestamps before caching the data", async () => {
    database.query.mockResolvedValueOnce({
      rows: [{
        provider_id: "usgs",
        fetched_at: NOW,
        snapshot: { ...snapshot(), fetchedAt: "not-a-date" },
      }],
    });

    const result = await readSnapshot("usgs");

    expect(result.snapshot).toBeNull();
    expect(result.warning).toEqual(expect.any(String));
  });

  it("rejects future snapshot fetches instead of advertising artificial freshness", async () => {
    const future = snapshot("2026-09-14T00:00:00.000Z");
    database.query.mockResolvedValueOnce({ rows: [row(future)] });

    const result = await readSnapshot("usgs");

    expect(result.snapshot).toBeNull();
    expect(result.warning).toBeDefined();
  });

  it("rejects a source report timestamp later than the alleged snapshot fetch", async () => {
    const impossible = snapshot("2026-09-13T08:00:00.000Z");
    database.query.mockResolvedValueOnce({ rows: [row(impossible)] });

    const result = await readSnapshot("usgs");

    expect(result.snapshot).toBeNull();
    expect(result.warning).toBeDefined();
  });

  it("rejects oversized snapshot collections before writing or retaining raw records", async () => {
    const oversized = snapshot(NOW, Array.from({ length: 1_001 }, (_, index) =>
      event({ id: `usgs:record-${index}` }),
    ));

    const result = await writeSnapshot(oversized, rawRecords(1));

    expect(result.warning).toEqual(expect.any(String));
    expect(database.Pool).not.toHaveBeenCalled();
    expect(getStoreStatus().rawRecords).toBe(0);
    expect((await readSnapshot("usgs")).snapshot).toBeNull();
  });

  it("rejects row timestamps that disagree with the snapshot timestamp", async () => {
    const persisted = snapshot();
    database.query.mockResolvedValueOnce({
      rows: [{ ...row(persisted), fetched_at: "2026-09-13T11:00:00.000Z" }],
    });

    expect((await readSnapshot("usgs")).snapshot).toBeNull();
  });

  it("does not load another provider's snapshot into the requested provider", async () => {
    const persisted = { ...snapshot(), providerId: "bbc" as const };
    database.query.mockResolvedValueOnce({
      rows: [{ ...row(persisted), provider_id: "usgs" }],
    });

    expect((await readSnapshot("usgs")).snapshot).toBeNull();
  });

  it("retains a valid local snapshot when a persisted refresh is malformed", async () => {
    const local = snapshot();
    await writeSnapshot(local, []);
    vi.advanceTimersByTime(60_001);
    const invalid = snapshot("2026-09-13T12:01:00.000Z", [
      event({ confidence: -20 }),
    ]);
    database.query.mockResolvedValueOnce({ rows: [row(invalid)] });

    const result = await readSnapshot("usgs");

    expect(result.snapshot).toEqual(local);
    expect(result.warning).toEqual(expect.any(String));
  });
});
