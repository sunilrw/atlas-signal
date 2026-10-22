import type { FeatureCollection, Point } from "geojson";
import type { AtlasEvent, MapView } from "@/types";

export interface SignalProperties {
  id: string;
  title: string;
  label: string;
  severity: AtlasEvent["severity"];
  disaster: boolean;
  developing: boolean;
}

export type SignalCollection = FeatureCollection<Point, SignalProperties>;

export const DEFAULT_MAP_VIEW: MapView = {
  latitude: 23,
  longitude: 18,
  zoom: 1.38,
};

export function worldViewForWidth(width: number): MapView {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1024;
  return {
    latitude: 20,
    longitude: 0,
    zoom: Math.max(-1, Math.min(DEFAULT_MAP_VIEW.zoom, Math.log2(safeWidth / 512) - 0.1)),
  };
}

// Beyond these latitudes, a point cannot be represented in Web Mercator.
// Do not silently move it to the nearest visible latitude.
export function hasMappableCoordinates<
  T extends Pick<AtlasEvent, "latitude" | "longitude">,
>(
  event: T,
): event is T & {
  latitude: number;
  longitude: number;
} {
  return (
    typeof event.latitude === "number" &&
    typeof event.longitude === "number" &&
    Number.isFinite(event.latitude) &&
    Number.isFinite(event.longitude) &&
    Math.abs(event.latitude) <= 85.051129 &&
    Math.abs(event.longitude) <= 180
  );
}

export function isLiveMapEvent(event: AtlasEvent): boolean {
  // Fail closed for accidentally retained scenarios, including synthetic
  // provenance attached to an otherwise live record.
  return event.isDemo === false && event.sources.every((source) => !source.isDemo);
}

export function toSignalCollection(events: AtlasEvent[]): SignalCollection {
  return {
    type: "FeatureCollection",
    features: events.filter(isLiveMapEvent).filter(hasMappableCoordinates).map((event) => ({
      type: "Feature",
      id: event.id,
      geometry: {
        type: "Point",
        coordinates: [event.longitude, event.latitude],
      },
      properties: {
        id: event.id,
        title: event.title,
        // The locally hosted glyph range covers Latin cartography. Full,
        // unmodified Unicode titles/locations remain in DOM tooltips and panels.
        // Omit unsupported on-map labels rather than request an external font.
        label: /^[\u0020-\u007e\u00a0-\u00ff]*$/.test(event.locationName)
          ? event.locationName
          : "",
        severity: event.severity,
        disaster: event.category === "natural-disaster",
        developing: event.status === "developing",
      },
    })),
  };
}

export function countryCodeFromProperties(
  properties: Record<string, unknown> | null,
): string | null {
  if (!properties) return null;

  // Natural Earth stores corrected ISO codes here. ISO_A2 alone is -99
  // for France/Norway and CN-TW for Taiwan in the source release.
  for (const candidate of [properties.ISO_A2_EH, properties.ISO_A2]) {
    if (typeof candidate === "string" && /^[A-Z]{2}$/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isValidMapView(view: MapView | undefined): view is MapView {
  return (
    !!view &&
    Number.isFinite(view.latitude) &&
    Number.isFinite(view.longitude) &&
    Number.isFinite(view.zoom) &&
    Math.abs(view.latitude) <= 85 &&
    Math.abs(view.longitude) <= 180 &&
    view.zoom >= -1 &&
    view.zoom <= 9
  );
}
