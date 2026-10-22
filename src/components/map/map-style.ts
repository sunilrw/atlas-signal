import type {
  ExpressionSpecification,
  FilterSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { MapTheme } from "@/types";
import type { SignalCollection } from "./map-features";

export type MarkerDensity = "minimal" | "standard" | "detailed";

export const SIGNAL_COLORS = {
  unassessed: "#9aa5ac",
  low: "#91ac86",
  elevated: "#ddbf71",
  high: "#df935c",
  critical: "#e06d65",
  disaster: "#82b7ce",
};

export const MAP_PALETTES = {
  dark: {
    background: "#0e1215",
    land: "#242b30",
    border: "#4e565b",
    hover: "#333e43",
    grid: "#a1adb4",
    label: "#8a969d",
    oceanLabel: "#586770",
    cityLabel: "#9ca7ad",
    cluster: "#22292c",
    clusterText: "#e7e7e1",
    selection: "#e8ece8",
  },
  light: {
    background: "#e9edef",
    land: "#f8f8f4",
    border: "#b0bbc0",
    hover: "#d5dedb",
    grid: "#829199",
    label: "#6a787d",
    oceanLabel: "#91a0a7",
    cityLabel: "#53646a",
    cluster: "#fafbf7",
    clusterText: "#25322e",
    selection: "#273c36",
  },
} satisfies Record<MapTheme, Record<string, string>>;

export const EMPTY_SIGNALS: SignalCollection = {
  type: "FeatureCollection",
  features: [],
};

export const INTERACTIVE_SIGNAL_LAYERS = [
  "signal-clusters",
  "signal-points",
  "signal-hit-targets",
  "disaster-points",
  "selected-point",
  "selected-hit-targets",
  "selected-disaster",
] as const;

export const LABEL_LAYERS = [
  "country-labels",
  "ocean-labels",
  "place-labels",
  "signal-location-labels",
] as const;

export function severityColor(
  property = "severity",
): ExpressionSpecification {
  return [
    "step",
    ["coalesce", ["get", property], 0],
    SIGNAL_COLORS.unassessed,
    1,
    SIGNAL_COLORS.low,
    3,
    SIGNAL_COLORS.elevated,
    5,
    SIGNAL_COLORS.high,
    7,
    SIGNAL_COLORS.critical,
  ];
}

export function clusterRadius(density: MarkerDensity): number {
  return density === "minimal" ? 54 : density === "detailed" ? 24 : 36;
}

export function pointRadius(
  density: MarkerDensity,
): ExpressionSpecification {
  const base = density === "minimal" ? 3.6 : density === "detailed" ? 5.4 : 4.6;
  return ["interpolate", ["linear"], ["zoom"], 1, base, 5, base + 2, 9, base + 3];
}

export function countryLabelFilter(density: MarkerDensity): FilterSpecification {
  const maximumRank = density === "minimal" ? 2 : density === "detailed" ? 4 : 3;
  return [
    "step",
    ["zoom"],
    [
      "all",
      ["!=", ["get", "ISO_A2_EH"], "AQ"],
      ["<=", ["get", "LABELRANK"], maximumRank],
    ],
    3,
    ["!=", ["get", "ISO_A2_EH"], "AQ"],
  ];
}

function graticule(): FeatureCollection<LineString> {
  const features: FeatureCollection<LineString>["features"] = [];

  for (let longitude = -180; longitude <= 180; longitude += 30) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [longitude, -80],
          [longitude, 85],
        ],
      },
    });
  }

  for (let latitude = -60; latitude <= 60; latitude += 30) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [-180, latitude],
          [180, latitude],
        ],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

function namedPoints(
  points: [name: string, longitude: number, latitude: number][],
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map(([name, longitude, latitude]) => ({
      type: "Feature",
      properties: { name },
      geometry: { type: "Point", coordinates: [longitude, latitude] },
    })),
  };
}

const OCEANS = namedPoints([
  ["NORTH ATLANTIC\nOCEAN", -38, 33],
  ["SOUTH ATLANTIC\nOCEAN", -20, -29],
  ["NORTH PACIFIC\nOCEAN", -148, 21],
  ["SOUTH PACIFIC\nOCEAN", -115, -31],
  ["INDIAN\nOCEAN", 75, -25],
  ["ARABIAN SEA", 63, 14],
  ["SOUTH CHINA SEA", 113, 14],
]);

// Reference cartography only: these anchors are never used to locate events.
const REFERENCE_PLACES = namedPoints([
  ["New York", -74.01, 40.71],
  ["Washington", -77.04, 38.91],
  ["Mexico City", -99.13, 19.43],
  ["Sao Paulo", -46.63, -23.55],
  ["Buenos Aires", -58.38, -34.6],
  ["London", -0.12, 51.51],
  ["Paris", 2.35, 48.86],
  ["Berlin", 13.41, 52.52],
  ["Kyiv", 30.52, 50.45],
  ["Moscow", 37.62, 55.75],
  ["Istanbul", 28.98, 41.01],
  ["Cairo", 31.24, 30.04],
  ["Lagos", 3.38, 6.52],
  ["Nairobi", 36.82, -1.29],
  ["Johannesburg", 28.05, -26.2],
  ["Riyadh", 46.72, 24.69],
  ["Tehran", 51.39, 35.69],
  ["New Delhi", 77.21, 28.61],
  ["Mumbai", 72.88, 19.08],
  ["Beijing", 116.4, 39.9],
  ["Taipei", 121.57, 25.03],
  ["Tokyo", 139.69, 35.68],
  ["Seoul", 126.98, 37.57],
  ["Singapore", 103.82, 1.35],
  ["Jakarta", 106.85, -6.21],
  ["Sydney", 151.21, -33.87],
]);

export function createMapStyle({
  theme,
  density,
  showLabels,
  signals,
}: {
  theme: MapTheme;
  density: MarkerDensity;
  showLabels: boolean;
  signals: SignalCollection;
}): StyleSpecification {
  const colors = MAP_PALETTES[theme];
  const visibility = showLabels ? "visible" : "none";
  const unclustered: ExpressionSpecification = ["!", ["has", "point_count"]];
  const assessedDisaster: ExpressionSpecification = [
    "all",
    ["==", ["get", "disaster"], true],
    [">", ["coalesce", ["get", "severity"], 0], 0],
  ];
  const radius = pointRadius(density);

  return {
    version: 8,
    name: "Atlas Signal",
    glyphs: "/data/fonts/{fontstack}/{range}.pbf",
    sources: {
      countries: {
        type: "geojson",
        data: "/data/countries.geojson",
        promoteId: "ADM0_A3",
        tolerance: 0.45,
      },
      "country-labels": {
        type: "geojson",
        data: "/data/country-labels.geojson",
      },
      graticule: { type: "geojson", data: graticule() },
      oceans: { type: "geojson", data: OCEANS },
      places: { type: "geojson", data: REFERENCE_PLACES },
      signals: {
        type: "geojson",
        data: signals,
        cluster: true,
        clusterMaxZoom: 6,
        clusterRadius: clusterRadius(density),
        clusterProperties: {
          // Zero is an aggregate-only sentinel for missing assessments, not
          // an assigned event severity. An entirely unassessed cluster is gray.
          maxSeverity: ["max", ["coalesce", ["get", "severity"], 0]],
        },
      },
      selection: { type: "geojson", data: EMPTY_SIGNALS },
    },
    layers: [
      {
        id: "ocean",
        type: "background",
        paint: { "background-color": colors.background },
      },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: {
          "line-color": colors.grid,
          "line-width": 0.5,
          "line-opacity": theme === "dark" ? 0.09 : 0.13,
        },
      },
      {
        id: "countries-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            colors.hover,
            colors.land,
          ],
          "fill-opacity": 1,
        },
      },
      {
        id: "countries-border",
        type: "line",
        source: "countries",
        paint: {
          "line-color": colors.border,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.55, 6, 1],
          "line-opacity": 0.72,
        },
      },
      {
        id: "ocean-labels",
        type: "symbol",
        source: "oceans",
        maxzoom: 5,
        layout: {
          visibility,
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 4, 12],
          "text-letter-spacing": 0.18,
          "text-line-height": 1.65,
          "text-max-width": 15,
          "text-padding": 20,
        },
        paint: {
          "text-color": colors.oceanLabel,
          "text-opacity": 0.8,
        },
      },
      {
        id: "country-labels",
        type: "symbol",
        source: "country-labels",
        minzoom: 0.5,
        filter: countryLabelFilter(density),
        layout: {
          visibility,
          "text-field": ["get", "NAME_EN"],
          "text-font": ["Noto Sans Regular"],
          "text-transform": "uppercase",
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            9,
            3,
            11,
            6,
            13,
          ],
          "text-letter-spacing": 0.095,
          "text-max-width": 9,
          "text-padding": density === "minimal" ? 25 : 12,
          "symbol-sort-key": ["get", "LABELRANK"],
        },
        paint: {
          "text-color": colors.label,
          "text-halo-color": colors.land,
          "text-halo-width": 1,
          "text-opacity": 0.85,
        },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "places",
        minzoom: 3.5,
        layout: {
          visibility,
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-padding": 6,
        },
        paint: {
          "text-color": colors.cityLabel,
          "text-halo-color": colors.land,
          "text-halo-width": 1.5,
        },
      },
      {
        id: "signal-halos",
        type: "circle",
        source: "signals",
        filter: [
          "all",
          unclustered,
          [
            "any",
            [">=", ["coalesce", ["get", "severity"], 0], 5],
            ["==", ["get", "developing"], true],
          ],
        ],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            11,
            5,
            15,
          ],
          "circle-color": [
            "case",
            assessedDisaster,
            SIGNAL_COLORS.disaster,
            severityColor(),
          ],
          "circle-opacity": 0.1,
          "circle-stroke-width": 0.75,
          "circle-stroke-color": [
            "case",
            assessedDisaster,
            SIGNAL_COLORS.disaster,
            severityColor(),
          ],
          "circle-stroke-opacity": 0.13,
        },
      },
      {
        id: "signal-cluster-halos",
        type: "circle",
        source: "signals",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": [
            "step",
            ["get", "point_count"],
            21,
            10,
            26,
            40,
            31,
          ],
          "circle-color": severityColor("maxSeverity"),
          "circle-opacity": 0.055,
        },
      },
      {
        id: "signal-clusters",
        type: "circle",
        source: "signals",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": [
            "step",
            ["get", "point_count"],
            13,
            10,
            18,
            40,
            23,
          ],
          "circle-color": colors.cluster,
          "circle-stroke-color": severityColor("maxSeverity"),
          "circle-stroke-width": 1.4,
          "circle-stroke-opacity": 0.85,
        },
      },
      {
        id: "signal-cluster-counts",
        type: "symbol",
        source: "signals",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": colors.clusterText },
      },
      {
        id: "signal-points",
        type: "circle",
        source: "signals",
        filter: ["all", unclustered, ["!", assessedDisaster]],
        paint: {
          "circle-radius": radius,
          "circle-color": severityColor(),
          "circle-stroke-color": colors.background,
          "circle-stroke-width": 1.6,
        },
      },
      {
        id: "signal-hit-targets",
        type: "circle",
        source: "signals",
        filter: unclustered,
        paint: {
          "circle-radius": 9,
          "circle-opacity": 0,
        },
      },
      {
        id: "disaster-points",
        type: "symbol",
        source: "signals",
        filter: ["all", unclustered, assessedDisaster],
        layout: {
          "icon-image": "disaster-diamond",
          "icon-size": density === "minimal" ? 0.8 : 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
      {
        id: "signal-location-labels",
        type: "symbol",
        source: "signals",
        minzoom: 4,
        filter: unclustered,
        layout: {
          visibility:
            showLabels && density === "detailed" ? "visible" : "none",
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-max-width": 17,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-padding": 8,
        },
        paint: {
          "text-color": colors.cityLabel,
          "text-halo-color": colors.background,
          "text-halo-width": 2,
        },
      },
      {
        id: "selected-halo",
        type: "circle",
        source: "selection",
        paint: {
          "circle-radius": 21,
          "circle-color": colors.selection,
          "circle-opacity": 0.045,
        },
      },
      {
        id: "selected-ring",
        type: "circle",
        source: "selection",
        paint: {
          "circle-radius": 13,
          "circle-opacity": 0,
          "circle-stroke-color": colors.selection,
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.9,
        },
      },
      {
        id: "selected-point",
        type: "circle",
        source: "selection",
        filter: ["!", assessedDisaster],
        paint: {
          "circle-radius": 5.5,
          "circle-color": severityColor(),
          "circle-stroke-color": colors.background,
          "circle-stroke-width": 1.5,
        },
      },
      {
        id: "selected-hit-targets",
        type: "circle",
        source: "selection",
        paint: { "circle-radius": 13, "circle-opacity": 0 },
      },
      {
        id: "selected-disaster",
        type: "symbol",
        source: "selection",
        filter: assessedDisaster,
        layout: {
          "icon-image": "disaster-diamond",
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
    ],
  };
}

export function createDisasterImage() {
  const size = 30;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.abs(x - center) + Math.abs(y - center);
      if (distance > 12) continue;

      const offset = (y * size + x) * 4;
      const outline = distance > 9;
      data[offset] = outline ? 165 : 105;
      data[offset + 1] = outline ? 205 : 161;
      data[offset + 2] = outline ? 223 : 186;
      data[offset + 3] = 255;
    }
  }

  return { width: size, height: size, data };
}
