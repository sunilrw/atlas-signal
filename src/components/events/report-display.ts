import { SEVERITY_META } from "@/lib/catalog";
import type { AtlasEvent, EventSource } from "@/types";

/** A display boundary, not an assertion that a publisher's claims are verified. */
export function isLiveReport(event: AtlasEvent): boolean {
  return event.isDemo === false &&
    !event.sources.some((source) => source.isDemo === true) &&
    event.sources.some((source) => httpSourceUrl(source.url) !== null);
}

export function httpSourceUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function reportPublisher(event: AtlasEvent): string {
  const names = [...new Set(event.sources.map((source) => source.name.trim()).filter(Boolean))];
  return names.length ? names.join(" · ") : "Publisher not provided";
}

export function reportKindLabel(event: AtlasEvent): string {
  if (event.reportKind === "analysis") return "Analysis";
  if (event.reportKind === "news") return "News report";
  if (event.reportKind === "incident") return "Incident report";
  return "Source report";
}

export function sourceTimestampLabel(source: EventSource): string {
  if (source.timestampBasis === "observed") return "Indexed / observed";
  if (source.timestampBasis === "occurred") return "Reported occurrence";
  if (source.timestampBasis === "published") return "Published";
  return "Source timestamp";
}

export function reportTimestampLabel(event: AtlasEvent): string {
  const labels = [...new Set(event.sources.map(sourceTimestampLabel))];
  return labels.length === 1 ? labels[0] : "Source timestamp";
}

export function reportSeverity(event: AtlasEvent): { label: string; color: string } {
  return event.severity !== null && Number.isInteger(event.severity) && event.severity >= 1 && event.severity <= 7
    ? SEVERITY_META[event.severity]
    : { label: "Unassessed", color: "var(--text-muted, #a5aebb)" };
}

const MISSING_LOCATIONS = new Set([
  "", "unknown", "unknown location", "location unknown", "location not provided",
  "not provided", "unknown country", "unspecified", "global", "international", "n/a", "—",
]);

function knownLocation(value: string): string {
  const trimmed = value.trim();
  return MISSING_LOCATIONS.has(trimmed.toLowerCase()) ? "" : trimmed;
}

export function reportLocation(event: AtlasEvent): string {
  const location = knownLocation(event.locationName);
  const country = knownLocation(event.country);
  if (location && country && !location.toLowerCase().includes(country.toLowerCase())) return `${location}, ${country}`;
  return location || country || "Location not provided";
}

export function hasReportCoordinates(event: AtlasEvent): boolean {
  return typeof event.latitude === "number" && Number.isFinite(event.latitude) &&
    typeof event.longitude === "number" && Number.isFinite(event.longitude) &&
    Math.abs(event.latitude) <= 90 && Math.abs(event.longitude) <= 180;
}
