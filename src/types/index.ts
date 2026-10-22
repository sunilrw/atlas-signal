export type EventCategory =
  | "conflict"
  | "military"
  | "terrorism"
  | "civil-unrest"
  | "political"
  | "diplomatic"
  | "cyber"
  | "infrastructure"
  | "energy"
  | "economic"
  | "humanitarian"
  | "natural-disaster"
  | "maritime"
  | "aviation"
  | "health"
  | "crime"
  | "other";

export type EventStatus = "reported" | "developing" | "confirmed" | "resolved" | "disputed";
export type DataMode = "live";
export type LocationAccuracy = "exact" | "city" | "region" | "country" | "approximate" | "unknown";
export type Severity = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d";
export type MapTheme = "dark" | "light";

export interface EventSource {
  id: string;
  name: string;
  url: string;
  publishedAt: string;
  type: "primary" | "news" | "ngo" | "dataset";
  isDemo?: boolean;
  providerId?: string;
  publisherCountry?: string;
  language?: string;
  byline?: string;
  observedAt?: string;
  timestampBasis?: "published" | "observed" | "occurred";
  licenseUrl?: string;
  publisherUrl?: string;
}

export interface EventUpdate {
  id: string;
  timestamp: string;
  title: string;
  description?: string;
}

export interface AtlasEvent {
  id: string;
  title: string;
  summary: string;
  category: EventCategory;
  subcategory?: string;
  severity: Severity | null;
  status: EventStatus;
  confidence: number | null;
  severityReason?: string;
  verificationNote?: string;
  reportKind?: "incident" | "news" | "analysis";
  locationEvidence?: string;
  detectedAt?: string;
  latitude?: number;
  longitude?: number;
  locationName: string;
  country: string;
  countryCode: string;
  region: string;
  locationAccuracy: LocationAccuracy;
  firstReportedAt: string;
  lastUpdatedAt: string;
  sources: EventSource[];
  timeline: EventUpdate[];
  relatedEvents: string[];
  tags: string[];
  isDemo: boolean;
  magnitude?: number;
  contradictions?: string[];
}

export interface EventFilters {
  query: string;
  categories: EventCategory[];
  minSeverity: number;
  minConfidence: number;
  timeRange: TimeRange;
  region: string;
  watchlistOnly: boolean;
}

export interface MapView {
  latitude: number;
  longitude: number;
  zoom: number;
}

export interface FeedHealth {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "disabled" | "error";
  lastFetchedAt: string | null;
  eventCount: number;
  message: string;
  url: string;
  kind?: "primary" | "news" | "humanitarian" | "aggregator";
  publisherCountry?: string;
  language?: string;
  termsUrl?: string;
}

export interface EventsResponse {
  events: AtlasEvent[];
  mode: DataMode;
  referenceTime: string;
  updatedAt: string | null;
  sources: FeedHealth[];
  total: number;
  warnings: string[];
}

export interface CountryInfo {
  code: string;
  name: string;
  slug: string;
  region: string;
  latitude: number;
  longitude: number;
}

export interface ConflictInfo {
  id: string;
  name: string;
  summary: string;
  countryCodes: string[];
  tags: string[];
  isDemo: boolean;
}

export interface WatchlistEntry {
  id: string;
  kind: "country" | "event";
  label: string;
  value: string;
}

export interface AlertRule {
  id: string;
  name: string;
  countryCode: string;
  category: EventCategory | "all";
  minSeverity: number;
  enabled: boolean;
}
