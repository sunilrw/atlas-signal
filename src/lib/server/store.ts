import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { AtlasEvent, Severity } from "@/types";
import { PROVIDERS, type ProviderId, type RawProviderRecord } from "./providers";
import { validDate } from "./pipeline";

export interface StoredSnapshot {
  providerId: ProviderId;
  fetchedAt: string;
  events: AtlasEvent[];
}

const READ_TTL_MS = 60_000;
const MAX_RAW_BATCH = 500;
const MAX_RAW_RECORDS = 2_000;
const MAX_RAW_PAYLOAD_BYTES = 256 * 1_024;
const MAX_RAW_BATCH_BYTES = 8 * 1_024 * 1_024;
const MAX_RAW_MEMORY_BYTES = 16 * 1_024 * 1_024;
const MAX_SNAPSHOT_BYTES = 8 * 1_024 * 1_024;
const DATABASE_WARNING = "PostgreSQL storage is unavailable; this process is using its in-memory snapshot.";
const INVALID_WARNING = "A stored snapshot was invalid or exceeded safe limits; any valid in-memory snapshot was retained.";
const RAW_WARNING = "Some raw records were omitted because they were invalid or exceeded bounded retention limits.";

const timestamp = z.string().max(40).datetime({ offset: true })
  .refine((value) => validDate(value) && Date.parse(value) <= Date.now(), "Timestamp must be a past or present source timestamp.");
const providerIdSchema = z.custom<ProviderId>((value) =>
  typeof value === "string" && PROVIDERS.some((provider) => provider.id === value),
);
const liveIdentifier = z.string().regex(/^[\w:-]{1,160}$/)
  .refine((value) => !/^demo(?:[-:]|$)/i.test(value), "Retired fictional identifiers are not allowed.");
const sourceUrl = z.string().min(1).max(2_048).refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
});
const text = (length: number) => z.string().max(length);
const sourceSchema = z.object({
  id: text(180).min(1).refine((value) => !/^demo(?:[-:]|$)/i.test(value)),
  name: text(120).min(1),
  url: sourceUrl,
  publishedAt: timestamp,
  type: z.enum(["primary", "news", "ngo", "dataset"]),
  isDemo: z.literal(false).optional(),
  providerId: providerIdSchema.optional(),
  publisherCountry: text(120).optional(),
  language: text(80).optional(),
  byline: text(300).optional(),
  licenseUrl: sourceUrl.optional(),
  publisherUrl: sourceUrl.optional(),
  observedAt: timestamp.optional(),
  timestampBasis: z.enum(["published", "observed", "occurred"]).optional(),
});
const eventSchema = z.object({
  id: liveIdentifier,
  title: text(500).min(1),
  summary: text(6_000),
  category: z.enum([
    "conflict", "military", "terrorism", "civil-unrest", "political", "diplomatic",
    "cyber", "infrastructure", "energy", "economic", "humanitarian",
    "natural-disaster", "maritime", "aviation", "health", "crime", "other",
  ]),
  subcategory: text(100).optional(),
  severity: z.number().int().min(1).max(7).transform((value) => value as Severity).nullable(),
  status: z.enum(["reported", "developing", "confirmed", "resolved", "disputed"]),
  // Legacy fixed heuristics are not evidence: discard those snapshots, do not relabel them.
  confidence: z.null(),
  severityReason: text(1_000).optional(),
  verificationNote: text(1_000).optional(),
  reportKind: z.enum(["incident", "news", "analysis"]).optional(),
  locationEvidence: text(1_000).optional(),
  detectedAt: timestamp.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locationName: text(200).min(1),
  country: text(120).min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  region: text(100).min(1),
  locationAccuracy: z.enum(["exact", "city", "region", "country", "approximate", "unknown"]),
  firstReportedAt: timestamp,
  lastUpdatedAt: timestamp,
  sources: z.array(sourceSchema).min(1).max(100),
  timeline: z.array(z.object({
    id: text(180).refine((value) => !/^demo(?:[-:]|$)/i.test(value)),
    timestamp,
    title: text(500),
    description: text(2_000).optional(),
  })).max(50),
  // No current provider supplies verified event relationships.
  relatedEvents: z.array(text(160)).max(0),
  tags: z.array(text(100)).max(100).refine((tags) =>
    !tags.includes("automated-confidence") && !tags.includes("contextual-links-not-corroboration"),
  ),
  isDemo: z.literal(false),
  magnitude: z.number().min(-10).max(20).optional(),
  contradictions: z.array(text(500)).max(10).optional(),
}).superRefine((event, context) => {
  const missingLatitude = event.latitude === undefined;
  const missingLongitude = event.longitude === undefined;
  if (missingLatitude !== missingLongitude) {
    context.addIssue({ code: "custom", message: "Coordinates must be a valid pair." });
  }
  if (missingLatitude && event.locationAccuracy !== "unknown") {
    context.addIssue({ code: "custom", message: "Missing coordinates must not imply location accuracy." });
  }
  if (Date.parse(event.lastUpdatedAt) < Date.parse(event.firstReportedAt)) {
    context.addIssue({ code: "custom", message: "Event timestamps are out of order." });
  }
  if (event.severity !== null && (
    !event.severityReason?.trim() || event.category !== "natural-disaster" ||
    event.reportKind === "news" || event.reportKind === "analysis" ||
    !event.sources.some((source) => source.type === "primary")
  )) {
    context.addIssue({ code: "custom", message: "Severity requires an explicit source-backed hazard basis." });
  }
});
const snapshotSchema = z.object({
  providerId: providerIdSchema,
  fetchedAt: timestamp,
  events: z.array(eventSchema).max(1_000),
}).superRefine((snapshot, context) => {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (snapshot.events.some((event) => [
    event.firstReportedAt,
    event.lastUpdatedAt,
    ...(event.detectedAt ? [event.detectedAt] : []),
    ...event.sources.flatMap((source) => [
      source.publishedAt, ...(source.observedAt ? [source.observedAt] : []),
    ]),
    ...event.timeline.map((update) => update.timestamp),
  ].some((value) => Date.parse(value) > fetchedAt))) {
    context.addIssue({ code: "custom", message: "A snapshot cannot contain source timestamps after its fetch." });
  }
});
const rawSchema = z.object({
  provider: providerIdSchema,
  providerId: text(512).min(1).refine((value) => !/^demo(?:[-:]|$)/i.test(value)),
  fetchedAt: timestamp,
  payload: z.unknown(),
}).refine((record) => {
  if (!record.payload || typeof record.payload !== "object") return true;
  const payload = record.payload as Record<string, unknown>;
  return payload.isDemo !== true &&
    !(typeof payload.id === "string" && /^demo(?:[-:]|$)/i.test(payload.id));
});

const snapshots = new Map<ProviderId, StoredSnapshot>();
const rawRecords = new Map<string, { record: RawProviderRecord; bytes: number }>();
const readChecks = new Map<ProviderId, { checkedAt: number; warning?: string }>();
const inFlightReads = new Map<ProviderId, Promise<void>>();
let rawMemoryBytes = 0;
let poolPromise: Promise<Pool | null> | undefined;
let databaseAvailable = false;
let databaseWarning: string | undefined;
let generation = 0;

function connectionString(): string {
  return process.env.DATABASE_URL?.trim() ?? "";
}

function setUnavailable(): void {
  databaseAvailable = false;
  databaseWarning = DATABASE_WARNING;
}

function setAvailable(): void {
  databaseAvailable = true;
  databaseWarning = undefined;
}

function joinWarnings(...warnings: (string | undefined)[]): string | undefined {
  const unique = [...new Set(warnings.filter((warning): warning is string => Boolean(warning)))];
  return unique.length ? unique.join(" ") : undefined;
}

function copySnapshot(providerId: ProviderId): StoredSnapshot | null {
  const snapshot = snapshots.get(providerId);
  return snapshot ? structuredClone(snapshot) : null;
}

function retainSnapshot(snapshot: StoredSnapshot): void {
  const existing = snapshots.get(snapshot.providerId);
  if (!existing || Date.parse(snapshot.fetchedAt) >= Date.parse(existing.fetchedAt)) {
    snapshots.set(snapshot.providerId, structuredClone(snapshot));
  }
}

function parseSnapshot(input: unknown): StoredSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const events = (input as Record<string, unknown>).events;
  // Reject oversized collections before asking the schema to walk their members.
  if (!Array.isArray(events) || events.length > 1_000) return null;
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_SNAPSHOT_BYTES) return null;
  return parsed.data;
}

/** Import pg only when configured. No database, migration, or paid service is required locally. */
async function getPool(): Promise<Pool | null> {
  const url = connectionString();
  if (!url) return null;
  if (!poolPromise) {
    const currentGeneration = generation;
    poolPromise = (async () => {
      try {
        const parsed = new URL(url);
        if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Invalid configuration");
        const { Pool: PostgresPool } = await import("pg");
        if (generation !== currentGeneration) return null;
        const pool = new PostgresPool({
          connectionString: url,
          max: 3,
          connectionTimeoutMillis: 3_000,
          idleTimeoutMillis: 10_000,
          statement_timeout: 4_000,
          query_timeout: 5_000,
          idle_in_transaction_session_timeout: 5_000,
          allowExitOnIdle: true,
        });
        // Pool errors can contain credentials or private hostnames; never expose the original error.
        pool.on("error", () => {
          if (generation === currentGeneration) setUnavailable();
        });
        return pool;
      } catch {
        if (generation === currentGeneration) setUnavailable();
        return null;
      }
    })();
  }
  return poolPromise;
}

function parseDatabaseRow(row: unknown, providerId: ProviderId): StoredSnapshot | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const snapshot = parseSnapshot(record.snapshot);
  if (!snapshot || snapshot.providerId !== providerId || record.provider_id !== providerId) return null;
  const fetchedAt = record.fetched_at instanceof Date
    ? record.fetched_at.getTime()
    : typeof record.fetched_at === "string" && timestamp.safeParse(record.fetched_at).success
      ? Date.parse(record.fetched_at)
      : Number.NaN;
  if (!Number.isFinite(fetchedAt) || fetchedAt !== Date.parse(snapshot.fetchedAt)) return null;
  return snapshot;
}

async function refreshSnapshot(providerId: ProviderId): Promise<void> {
  const currentGeneration = generation;
  let warning: string | undefined;
  try {
    const pool = await getPool();
    if (!pool) {
      warning = DATABASE_WARNING;
    } else {
      const result = await pool.query(
        "SELECT provider_id, fetched_at, snapshot FROM atlas_ingestion_snapshots WHERE provider_id = $1 LIMIT 1",
        [providerId],
      );
      if (generation !== currentGeneration) return;
      setAvailable();
      if (result.rows.length) {
        const snapshot = parseDatabaseRow(result.rows[0], providerId);
        if (snapshot) retainSnapshot(snapshot);
        else warning = INVALID_WARNING;
      }
    }
  } catch {
    if (generation !== currentGeneration) return;
    setUnavailable();
    warning = DATABASE_WARNING;
  }
  if (generation === currentGeneration) {
    readChecks.set(providerId, { checkedAt: Date.now(), ...(warning ? { warning } : {}) });
  }
}

/** The minute-long read cache still permits a separate ingestion worker to publish fresher data. */
export async function readSnapshot(
  providerId: ProviderId,
): Promise<{ snapshot: StoredSnapshot | null; warning?: string }> {
  if (!PROVIDERS.some((provider) => provider.id === providerId)) return { snapshot: null, warning: INVALID_WARNING };
  if (!connectionString()) return { snapshot: copySnapshot(providerId) };
  const check = readChecks.get(providerId);
  const age = check ? Date.now() - check.checkedAt : Infinity;
  if (age < 0 || age >= READ_TTL_MS) {
    let pending = inFlightReads.get(providerId);
    if (!pending) {
      pending = refreshSnapshot(providerId);
      inFlightReads.set(providerId, pending);
      const current = pending;
      void pending.finally(() => {
        if (inFlightReads.get(providerId) === current) inFlightReads.delete(providerId);
      });
    }
    await pending;
  }
  const warning = joinWarnings(readChecks.get(providerId)?.warning, databaseWarning);
  return { snapshot: copySnapshot(providerId), ...(warning ? { warning } : {}) };
}

function prepareRaw(
  providerId: ProviderId,
  input: RawProviderRecord[],
): { records: RawProviderRecord[]; warning?: string } {
  if (!Array.isArray(input)) return { records: [], warning: RAW_WARNING };
  let omitted = input.length > MAX_RAW_BATCH;
  let batchBytes = 0;
  const accepted = new Map<string, RawProviderRecord>();
  for (const candidate of input.slice(0, MAX_RAW_BATCH)) {
    const parsed = rawSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.provider !== providerId) {
      omitted = true;
      continue;
    }
    try {
      const serialized = JSON.stringify(parsed.data.payload);
      if (serialized === undefined || Buffer.byteLength(serialized) > MAX_RAW_PAYLOAD_BYTES) {
        omitted = true;
        continue;
      }
      const record: RawProviderRecord = { ...parsed.data, payload: JSON.parse(serialized) };
      const prior = accepted.get(record.providerId);
      if (!prior || Date.parse(record.fetchedAt) >= Date.parse(prior.fetchedAt)) {
        const bytes = Buffer.byteLength(JSON.stringify(record));
        const priorBytes = prior ? Buffer.byteLength(JSON.stringify(prior)) : 0;
        if (batchBytes - priorBytes + bytes > MAX_RAW_BATCH_BYTES) {
          omitted = true;
          continue;
        }
        accepted.set(record.providerId, record);
        batchBytes += bytes - priorBytes;
      }
    } catch {
      omitted = true;
    }
  }
  return { records: [...accepted.values()], ...(omitted ? { warning: RAW_WARNING } : {}) };
}

function retainRaw(records: RawProviderRecord[]): boolean {
  let evicted = false;
  for (const record of records) {
    const key = `${record.provider}:${record.providerId}`;
    const previous = rawRecords.get(key);
    if (previous && Date.parse(previous.record.fetchedAt) > Date.parse(record.fetchedAt)) continue;
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (previous) rawMemoryBytes -= previous.bytes;
    rawRecords.delete(key);
    rawRecords.set(key, { record, bytes });
    rawMemoryBytes += bytes;
    while (rawRecords.size > MAX_RAW_RECORDS || rawMemoryBytes > MAX_RAW_MEMORY_BYTES) {
      const oldest = rawRecords.entries().next().value;
      if (!oldest) break;
      rawRecords.delete(oldest[0]);
      rawMemoryBytes -= oldest[1].bytes;
      evicted = true;
    }
  }
  return evicted;
}

/** Local retention always survives a failed database transaction. Schema is migration-owned. */
export async function writeSnapshot(
  snapshot: StoredSnapshot,
  raw: RawProviderRecord[],
): Promise<{ warning?: string }> {
  const value = parseSnapshot(snapshot);
  if (!value) return { warning: INVALID_WARNING };
  const prepared = prepareRaw(value.providerId, raw);
  retainSnapshot(value);
  const evicted = retainRaw(prepared.records);
  const retentionWarning = joinWarnings(prepared.warning, evicted ? RAW_WARNING : undefined);
  if (!connectionString()) return retentionWarning ? { warning: retentionWarning } : {};

  const currentGeneration = generation;
  const pool = await getPool();
  if (!pool) return { warning: joinWarnings(retentionWarning, DATABASE_WARNING) };
  let client: PoolClient | undefined;
  let failed = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO atlas_ingestion_snapshots (provider_id, fetched_at, snapshot)
       VALUES ($1, $2::timestamptz, $3::jsonb)
       ON CONFLICT (provider_id) DO UPDATE
       SET fetched_at = EXCLUDED.fetched_at, snapshot = EXCLUDED.snapshot
       WHERE EXCLUDED.fetched_at >= atlas_ingestion_snapshots.fetched_at`,
      [value.providerId, value.fetchedAt, JSON.stringify(value)],
    );
    if (prepared.records.length) {
      await client.query(
        `INSERT INTO atlas_source_records (provider_id, provider_record_id, fetched_at, payload)
         SELECT $1, record.provider_record_id, record.fetched_at, record.payload
         FROM jsonb_to_recordset($2::jsonb)
           AS record(provider_record_id text, fetched_at timestamptz, payload jsonb)
         WHERE TRUE
         ON CONFLICT (provider_id, provider_record_id) DO UPDATE
         SET fetched_at = EXCLUDED.fetched_at, payload = EXCLUDED.payload
         WHERE EXCLUDED.fetched_at >= atlas_source_records.fetched_at`,
        [value.providerId, JSON.stringify(prepared.records.map((record) => ({
          provider_record_id: record.providerId,
          fetched_at: record.fetchedAt,
          payload: record.payload,
        })))],
      );
    }
    await client.query("COMMIT");
    if (generation === currentGeneration) {
      setAvailable();
      // A concurrent worker may already have a newer row; refresh instead of assuming our write won.
      readChecks.delete(value.providerId);
    }
    return retentionWarning ? { warning: retentionWarning } : {};
  } catch {
    failed = true;
    if (generation === currentGeneration) setUnavailable();
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // A failed/timed-out transaction must not return an uncertain connection to the pool.
      }
    }
    return { warning: joinWarnings(retentionWarning, DATABASE_WARNING) };
  } finally {
    client?.release(failed);
  }
}

export function getStoreStatus(): {
  mode: "memory" | "postgres";
  available: boolean;
  rawRecords: number;
  warning?: string;
} {
  const configured = Boolean(connectionString());
  return {
    mode: configured ? "postgres" : "memory",
    available: configured ? databaseAvailable : true,
    rawRecords: rawRecords.size,
    ...(configured && databaseWarning ? { warning: databaseWarning } : {}),
  };
}

/** Explicit shutdown for workers and tests; process-local snapshots remain available. */
export async function closeStore(): Promise<void> {
  const closing = poolPromise;
  poolPromise = undefined;
  generation += 1;
  databaseAvailable = false;
  databaseWarning = undefined;
  readChecks.clear();
  inFlightReads.clear();
  try {
    await (await closing)?.end();
  } catch {
    // Shutdown diagnostics must not expose the connection string.
  }
}

export function resetStoreForTests(): void {
  const closing = poolPromise;
  poolPromise = undefined;
  generation += 1;
  snapshots.clear();
  rawRecords.clear();
  rawMemoryBytes = 0;
  readChecks.clear();
  inFlightReads.clear();
  databaseAvailable = false;
  databaseWarning = undefined;
  if (closing) void closing.then((pool) => pool?.end()).catch(() => undefined);
}
