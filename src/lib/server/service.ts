import type { AtlasEvent, DataMode, EventsResponse, FeedHealth } from "@/types";
import { fetchProvider, PROVIDERS, type ProviderId } from "./providers";
import { ApiInputError } from "./api";
import { normalizeLiveEvent, processEvents, validDate } from "./pipeline";
import { getStoreStatus, readSnapshot, writeSnapshot, type StoredSnapshot } from "./store";

export const FEED_CACHE_MS = 60_000;
/** A failed provider may retain labeled last-good records for no more than one day. */
export const MAX_STALE_SNAPSHOT_MS = 24 * 60 * 60_000;

interface FeedState {
  checkedAt: number;
  snapshot: StoredSnapshot | null;
  health: FeedHealth | null;
  warning?: string;
  pending?: Promise<void>;
}

interface ServiceState {
  feeds: Map<ProviderId, FeedState>;
}

// A separate versioned key discards earlier process-local demonstration/score caches.
const shared = globalThis as typeof globalThis & { __atlasSignalLiveServiceV2?: ServiceState };
const state = shared.__atlasSignalLiveServiceV2 ??= { feeds: new Map() };

function feedState(id: ProviderId): FeedState {
  let entry = state.feeds.get(id);
  if (!entry) {
    entry = { checkedAt: 0, snapshot: null, health: null };
    state.feeds.set(id, entry);
  }
  return entry;
}

function providerDetails(id: ProviderId): Pick<FeedHealth, "id" | "name" | "url" | "kind" | "publisherCountry" | "language" | "termsUrl"> {
  const provider = PROVIDERS.find((item) => item.id === id)!;
  return {
    id,
    name: provider.name,
    url: provider.url,
    ...(provider.kind ? { kind: provider.kind } : {}),
    ...(provider.publisherCountry ? { publisherCountry: provider.publisherCountry } : {}),
    ...(provider.language ? { language: provider.language } : {}),
    ...(provider.termsUrl ? { termsUrl: provider.termsUrl } : {}),
  };
}

function usableSnapshot(snapshot: StoredSnapshot | null): boolean {
  if (!snapshot || !validDate(snapshot.fetchedAt)) return false;
  const age = Date.now() - Date.parse(snapshot.fetchedAt);
  return age >= 0 && age <= MAX_STALE_SNAPSHOT_MS;
}

function providerHealth(id: ProviderId): FeedHealth {
  const provider = PROVIDERS.find((item) => item.id === id)!;
  const details = providerDetails(id);
  if (!provider.enabled()) {
    return {
      ...details,
      status: "disabled",
      lastFetchedAt: null,
      eventCount: 0,
      message: provider.disabledMessage,
    };
  }
  const entry = feedState(id);
  if (entry.snapshot && !usableSnapshot(entry.snapshot)) {
    return {
      ...details,
      status: "error",
      lastFetchedAt: validDate(entry.snapshot.fetchedAt) && Date.parse(entry.snapshot.fetchedAt) <= Date.now()
        ? entry.snapshot.fetchedAt : null,
      eventCount: 0,
      message: "The last successful snapshot is older than the 24-hour outage retention limit. Its records are not shown.",
    };
  }
  return entry.health ? { ...entry.health, ...details } : {
    ...details,
    status: "degraded",
    lastFetchedAt: null,
    eventCount: 0,
    message: "Not fetched in this process yet.",
  };
}

function normalizeSnapshot(snapshot: StoredSnapshot | null, id: ProviderId): StoredSnapshot | null {
  if (!snapshot || snapshot.providerId !== id || !validDate(snapshot.fetchedAt) ||
    Date.parse(snapshot.fetchedAt) > Date.now() || !Array.isArray(snapshot.events) ||
    snapshot.events.length > 1_000) return null;
  const events = snapshot.events.map(normalizeLiveEvent).filter((event): event is AtlasEvent => event !== null);
  if (events.length !== snapshot.events.length) return null;
  return { providerId: id, fetchedAt: snapshot.fetchedAt, events };
}

function retainFirstDetection(event: AtlasEvent, previous: AtlasEvent | undefined): AtlasEvent {
  if (previous?.detectedAt &&
    (!event.detectedAt || Date.parse(previous.detectedAt) < Date.parse(event.detectedAt))) {
    return { ...event, detectedAt: previous.detectedAt };
  }
  return event;
}

async function refreshProvider(id: ProviderId, force = false): Promise<void> {
  const provider = PROVIDERS.find((item) => item.id === id)!;
  if (!provider.enabled()) return;
  const entry = feedState(id);
  if (entry.pending) return entry.pending;
  const cacheMs = Math.max(FEED_CACHE_MS, provider.refreshIntervalMs ?? 0);
  const mayForce = force && provider.refreshIntervalMs === undefined;
  const checkAge = Date.now() - entry.checkedAt;
  if (!mayForce && entry.checkedAt > 0 && checkAge >= 0 && checkAge < cacheMs) return;
  entry.pending = (async () => {
    try {
      const saved = await readSnapshot(id);
      entry.warning = saved.warning;
      const validatedSnapshot = normalizeSnapshot(saved.snapshot, id);
      if (saved.snapshot && !validatedSnapshot) {
        entry.warning = "A stored snapshot failed live-source validation and was not used.";
      }
      if (validatedSnapshot && (!entry.snapshot || Date.parse(validatedSnapshot.fetchedAt) > Date.parse(entry.snapshot.fetchedAt))) {
        const previous = new Map(entry.snapshot?.events.map((event) => [event.id, event]) ?? []);
        entry.snapshot = {
          ...validatedSnapshot,
          events: validatedSnapshot.events.map((event) => retainFirstDetection(event, previous.get(event.id))),
        };
      }
      const snapshotAge = entry.snapshot ? Date.now() - Date.parse(entry.snapshot.fetchedAt) : Infinity;
      // A worker's fresh persisted snapshot is shared with all web processes.
      if (!mayForce && entry.snapshot && snapshotAge >= 0 && snapshotAge < cacheMs) {
        entry.health = {
          ...providerDetails(id),
          status: "healthy",
          lastFetchedAt: entry.snapshot.fetchedAt,
          eventCount: entry.snapshot.events.length,
          message: "Using a recently fetched provider snapshot.",
        };
        entry.checkedAt = Date.now();
        return;
      }
      const result = await fetchProvider(id);
      const fetchedAt = new Date().toISOString();
      const previous = new Map(entry.snapshot?.events.map((event) => [event.id, event]) ?? []);
      const events = result.events.map(normalizeLiveEvent)
        .filter((event): event is AtlasEvent => event !== null)
        .map((event) => retainFirstDetection(event, previous.get(event.id)));
      if (result.events.length && !events.length) throw new Error("No valid source records.");
      const omitted = result.events.length - events.length;
      entry.snapshot = { providerId: id, fetchedAt, events };
      const stored = await writeSnapshot(entry.snapshot, result.raw);
      // A successful replacement also supersedes an earlier read/persistence failure.
      entry.warning = stored.warning;
      entry.health = {
        ...providerDetails(id),
        status: omitted ? "degraded" : "healthy",
        lastFetchedAt: fetchedAt,
        eventCount: events.length,
        message: omitted
          ? `${result.message} ${omitted} records were omitted because provenance or timestamps were invalid.`
          : result.message,
      };
    } catch {
      // Errors are intentionally not reflected verbatim: fetch/DB errors may contain credentials.
      const usable = usableSnapshot(entry.snapshot);
      entry.health = {
        ...providerDetails(id),
        status: usable ? "degraded" : "error",
        lastFetchedAt: entry.snapshot?.fetchedAt ?? null,
        eventCount: usable ? entry.snapshot!.events.length : 0,
        message: usable
          ? "Refresh failed. Showing the last successfully fetched snapshot; it may be stale."
          : "Provider unavailable or returned invalid data. No events have been substituted.",
      };
    } finally {
      entry.checkedAt = Date.now();
      entry.pending = undefined;
    }
  })();
  return entry.pending;
}

/**
 * Live source records are the only application data path. Provider failures
 * remain errors or explicitly stale, retention-bounded cached records.
 */
export async function getEvents(mode: DataMode = "live", options: { force?: boolean } = {}): Promise<EventsResponse> {
  if (mode !== "live") throw new ApiInputError("Only live source data is supported.");
  await Promise.all(PROVIDERS.map((provider) => refreshProvider(provider.id, options.force)));
  const sources = PROVIDERS.map((provider) => providerHealth(provider.id));
  const inputs = PROVIDERS.filter((provider) => provider.enabled())
    .flatMap((provider) => {
      const snapshot = feedState(provider.id).snapshot;
      return snapshot && usableSnapshot(snapshot) ? snapshot.events : [];
    });
  const events = processEvents(inputs);
  const warnings = [
    "These are attributed source reports, not independent verification. No publisher is guaranteed unbiased, and coverage depends on the enabled feeds.",
    "Unassessed severity and confidence remain unknown. Hazard severity, when available, is derived from the disclosed source measurement or alert level.",
    ...sources.filter((source) => source.status === "error" || source.status === "degraded")
      .map((source) => `${source.name}: ${source.message}`),
    ...PROVIDERS.filter((provider) => provider.enabled()).flatMap((provider) => feedState(provider.id).warning ?? []),
  ];
  const now = new Date().toISOString();
  const timestamps = sources.flatMap((source) => source.lastFetchedAt ? [Date.parse(source.lastFetchedAt)] : []);
  return {
    events,
    mode: "live",
    referenceTime: now,
    updatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    sources,
    total: events.length,
    warnings: [...new Set(warnings)],
  };
}

export async function getEvent(id: string, mode: DataMode = "live"): Promise<AtlasEvent | null> {
  if (mode !== "live") throw new ApiInputError("Only live source data is supported.");
  if (/^demo(?:[-:]|$)/i.test(id)) return null;
  return (await getEvents(mode)).events.find((event) => event.id === id) ?? null;
}

/** Cheap liveness check: does not initiate upstream traffic. */
export function getHealth() {
  return {
    status: "ok" as const,
    service: "Atlas Signal",
    timestamp: new Date().toISOString(),
    storage: getStoreStatus(),
    sources: PROVIDERS.map((provider) => providerHealth(provider.id)),
    cacheSeconds: FEED_CACHE_MS / 1_000,
    maxStaleSnapshotSeconds: MAX_STALE_SNAPSHOT_MS / 1_000,
  };
}

export function resetServiceForTests(): void {
  state.feeds.clear();
}
