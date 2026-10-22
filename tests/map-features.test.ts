import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Color, createExpression, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { AtlasEvent, MapView } from "../src/types";
import WorldMap from "../src/components/map/WorldMap";
import {
  countryCodeFromProperties,
  hasMappableCoordinates,
  isValidMapView,
  toSignalCollection,
  worldViewForWidth,
} from "../src/components/map/map-features";
import {
  clusterRadius,
  createDisasterImage,
  createMapStyle,
  EMPTY_SIGNALS,
  severityColor,
  SIGNAL_COLORS,
} from "../src/components/map/map-style";

// Synthetic fixtures are confined to this test module; production has no seeds.
function record(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    id: "map-test",
    title: "Fixture source report",
    summary: "A test-only record for deterministic map checks.",
    category: "infrastructure",
    severity: null,
    status: "reported",
    confidence: null,
    latitude: 48.86,
    longitude: 2.35,
    locationName: "Paris, France",
    country: "France",
    countryCode: "FR",
    region: "Europe",
    locationAccuracy: "city",
    firstReportedAt: "2026-09-13T10:00:00.000Z",
    lastUpdatedAt: "2026-09-13T11:00:00.000Z",
    sources: [{
      id: "test-source",
      name: "Fixture publisher",
      url: "https://example.org/report",
      publishedAt: "2026-09-13T10:00:00.000Z",
      type: "news",
    }],
    timeline: [],
    relatedEvents: [],
    tags: [],
    isDemo: false,
    ...overrides,
  };
}

function evaluateExpression(
  expression: unknown,
  properties: Record<string, unknown>,
  options: { color?: boolean; accumulated?: number } = {},
): unknown {
  const parsed = createExpression(expression, options.color ? "paint.circle-color" : "filter", options.color
    ? {
        type: "color",
        "property-type": "data-driven",
        transition: false,
        overridable: false,
      }
    : undefined);
  expect(parsed.result).toBe("success");
  if (parsed.result !== "success") throw new Error("Map expression did not compile.");

  // The regular evaluate method may hide runtime null errors behind a fallback.
  return parsed.value.evaluateWithoutErrorHandling(
    { zoom: 1, accumulated: options.accumulated },
    { type: "Point", properties },
  );
}

describe("map event coordinates", () => {
  it("preserves supplied coordinates exactly and uses longitude, latitude order", () => {
    const original = record({ latitude: 12.345678, longitude: -76.54321 });
    const result = toSignalCollection([original]);
    expect(result.features[0].geometry.coordinates).toEqual([-76.54321, 12.345678]);
    expect(result.features[0].id).toBe(original.id);
    expect(original.latitude).toBe(12.345678);
  });

  it("does not replace a missing coordinate with a country or city anchor", () => {
    const events = [
      record({ id: "missing-both", latitude: undefined, longitude: undefined }),
      record({ id: "missing-latitude", latitude: undefined }),
      record({ id: "missing-longitude", longitude: undefined }),
    ];
    expect(toSignalCollection(events)).toEqual(EMPTY_SIGNALS);
    expect(events[0].latitude).toBeUndefined();
    expect(events[0].longitude).toBeUndefined();
  });

  it("keeps legitimate zero coordinates", () => {
    const event = record({ latitude: 0, longitude: 0 });
    expect(hasMappableCoordinates(event)).toBe(true);
    expect(toSignalCollection([event]).features[0].geometry.coordinates).toEqual([0, 0]);
  });

  it.each([
    [NaN, 2],
    [Infinity, 2],
    [48, NaN],
    [48, -Infinity],
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [90, 0],
    [-90, 0],
  ])("does not silently clamp unrepresentable coordinates %s, %s", (latitude, longitude) => {
    const event = record({ latitude, longitude });
    expect(hasMappableCoordinates(event)).toBe(false);
    expect(toSignalCollection([event]).features).toHaveLength(0);
  });

  it("retains both antimeridian boundary coordinates", () => {
    const events = [
      record({ id: "east", latitude: 0, longitude: 180 }),
      record({ id: "west", latitude: 0, longitude: -180 }),
    ];
    expect(toSignalCollection(events).features.map((feature) => feature.geometry.coordinates))
      .toEqual([[180, 0], [-180, 0]]);
  });

  it("preserves supplied disaster/developing metadata without synthetic provenance fields", () => {
    const event = record({
      category: "natural-disaster",
      status: "developing",
      severity: 6,
    });
    expect(toSignalCollection([event]).features[0].properties).toMatchObject({
      disaster: true,
      developing: true,
      severity: 6,
    });
    expect(toSignalCollection([event]).features[0].properties).not.toHaveProperty("isDemo");
    expect(Object.keys(toSignalCollection([event]).features[0].properties).sort())
      .toEqual(["developing", "disaster", "id", "label", "severity", "title"]);
  });

  it("retains an unassessed severity as null without inventing a score", () => {
    const event = record();
    expect(toSignalCollection([event]).features[0].properties.severity).toBeNull();
    expect(event.severity).toBeNull();
  });

  it("refuses accidentally retained demo events and source relationships", () => {
    const event = record();
    expect(toSignalCollection([
      event,
      record({ id: "blocked-demo", isDemo: true }),
      record({
        id: "blocked-source",
        sources: [{ ...event.sources[0], isDemo: true }],
      }),
    ]).features.map((feature) => feature.id)).toEqual(["map-test"]);
  });

  it("does not request unbundled glyph ranges or alter the full source title", () => {
    const event = record({ title: "東京の報告", locationName: "東京都" });
    const properties = toSignalCollection([event]).features[0].properties;
    expect(properties.label).toBe("");
    expect(properties.title).toBe("東京の報告");
    expect(event.locationName).toBe("東京都");
  });

  it("retains supported Latin-1 labels", () => {
    const event = record({ locationName: "São Tomé" });
    expect(toSignalCollection([event]).features[0].properties.label).toBe("São Tomé");
  });
});

describe("reference country identifiers", () => {
  it.each([
    ["FR", "-99", "FR"],
    ["NO", "-99", "NO"],
    ["TW", "CN-TW", "TW"],
    ["XK", "-99", "XK"],
    [undefined, "GB", "GB"],
    ["-99", "CYN", null],
    ["-99", "-99", null],
    ["invalid", "not-a-code", null],
    [12, false, null],
  ])("prefers the corrected Natural Earth code %s", (ISO_A2_EH, ISO_A2, expected) => {
    expect(countryCodeFromProperties({ ISO_A2_EH, ISO_A2 })).toBe(expected);
  });

  it("preserves unknown country identity", () => {
    expect(countryCodeFromProperties(null)).toBeNull();
    expect(countryCodeFromProperties({})).toBeNull();
  });
});

describe("map view validation", () => {
  it("accepts valid shared views", () => {
    expect(isValidMapView({ latitude: 0, longitude: 0, zoom: 1.5 })).toBe(true);
    expect(isValidMapView({ latitude: -75, longitude: -180, zoom: 9 })).toBe(true);
    expect(isValidMapView({ latitude: 20, longitude: 0, zoom: -0.5 })).toBe(true);
  });

  it.each([
    undefined,
    { latitude: 91, longitude: 0, zoom: 1 },
    { latitude: 0, longitude: -181, zoom: 1 },
    { latitude: 0, longitude: 0, zoom: 12 },
    { latitude: 0, longitude: 0, zoom: -1.1 },
    { latitude: NaN, longitude: 0, zoom: 1 },
    { latitude: 0, longitude: Infinity, zoom: 1 },
    { latitude: 0, longitude: 0, zoom: NaN },
  ] satisfies (MapView | undefined)[])("rejects an invalid initial view", (view) => {
    expect(isValidMapView(view)).toBe(false);
  });

  it("fits the complete world width into a narrow viewport without changing event coordinates", () => {
    const view = worldViewForWidth(390);
    expect(view.zoom).toBeLessThan(0);
    expect(512 * 2 ** view.zoom).toBeLessThan(390);
    expect(view.longitude).toBe(0);
    expect(isValidMapView(view)).toBe(true);
  });

  it("bounds reset zoom for large, invalid, and very narrow viewports", () => {
    expect(worldViewForWidth(3000).zoom).toBe(1.38);
    expect(worldViewForWidth(100).zoom).toBe(-1);
    expect(worldViewForWidth(NaN)).toEqual(worldViewForWidth(1024));
    expect(worldViewForWidth(-300)).toEqual(worldViewForWidth(1024));
  });
});

describe("local MapLibre style", () => {
  for (const theme of ["dark", "light"] as const) {
    for (const density of ["minimal", "standard", "detailed"] as const) {
      for (const showLabels of [true, false]) {
        it(`validates ${theme}/${density}/labels=${showLabels} against the installed style schema`, () => {
          const style = createMapStyle({ theme, density, showLabels, signals: EMPTY_SIGNALS });
          expect(validateStyleMin(style)).toEqual([]);
          expect(style.glyphs).toBe("/data/fonts/{fontstack}/{range}.pbf");
          expect(style.sources.signals).toMatchObject({
            type: "geojson",
            cluster: true,
            clusterRadius: clusterRadius(density),
          });
          for (const source of Object.values(style.sources)) {
            if (source.type === "geojson" && typeof source.data === "string") {
              expect(source.data.startsWith("/data/")).toBe(true);
            }
          }
        });
      }
    }
  }

  it("contains no country risk layer or risk data source", () => {
    const style = createMapStyle({
      theme: "dark",
      density: "standard",
      showLabels: true,
      signals: EMPTY_SIGNALS,
    });
    expect(style.layers.some((layer) => /risk/i.test(layer.id))).toBe(false);
    expect(Object.keys(style.sources).some((source) => /risk/i.test(source))).toBe(false);
  });

  it.each([{}, { severity: null }, { severity: 0 }])(
    "renders absent assessments as neutral, not low: %j",
    (properties) => {
      const color = evaluateExpression(severityColor(), properties, { color: true });
      expect(color).toEqual(Color.parse(SIGNAL_COLORS.unassessed));
      expect(color).not.toEqual(Color.parse(SIGNAL_COLORS.low));
    },
  );

  it.each([
    [1, "low"], [2, "low"], [3, "elevated"], [4, "elevated"],
    [5, "high"], [6, "high"], [7, "critical"],
  ] as const)("retains the assessed severity %i color", (severity, band) => {
    expect(evaluateExpression(severityColor(), { severity }, { color: true }))
      .toEqual(Color.parse(SIGNAL_COLORS[band]));
  });

  it.each([
    [[null, null], 0],
    [[null, 6], 6],
    [[6, null], 6],
    [[null, 1, null], 1],
    [[3, null, 7, 1], 7],
  ])("does not upgrade unknown cluster severity: %j", (severities, expected) => {
    const style = createMapStyle({
      theme: "dark", density: "standard", showLabels: true, signals: EMPTY_SIGNALS,
    });
    const source = style.sources.signals;
    if (source.type !== "geojson") throw new Error("Expected a GeoJSON signal source.");
    const aggregation = (source.clusterProperties as
      | Record<string, [string, unknown]>
      | undefined)?.maxSeverity;
    expect(aggregation).toEqual(["max", ["coalesce", ["get", "severity"], 0]]);
    if (!aggregation) throw new Error("Expected cluster aggregation.");
    const [operator, mapExpression] = aggregation;
    const maximum = (severities as (number | null)[]).reduce<number>((accumulated, severity) => {
      const maxSeverity = evaluateExpression(mapExpression, { severity });
      return evaluateExpression(
        [operator, ["accumulated"], ["get", "maxSeverity"]],
        { maxSeverity },
        { accumulated },
      ) as number;
    }, 0);
    expect(maximum).toBe(expected);
    expect(evaluateExpression(severityColor("maxSeverity"), { maxSeverity: maximum }, { color: true }))
      .toEqual(Color.parse(expected === 0
        ? SIGNAL_COLORS.unassessed
        : expected === 1 ? SIGNAL_COLORS.low
        : expected === 7 ? SIGNAL_COLORS.critical
        : SIGNAL_COLORS.high));
  });

  it.each([false, true])("handles unassessed halo filtering when developing=%s", (developing) => {
    const style = createMapStyle({
      theme: "dark", density: "standard", showLabels: true, signals: EMPTY_SIGNALS,
    });
    const halo = style.layers.find((layer) => layer.id === "signal-halos");
    if (halo?.type !== "circle") throw new Error("Expected a signal halo layer.");
    const properties = { severity: null, developing, disaster: true };
    expect(evaluateExpression(halo.filter, properties)).toBe(developing);
    expect(evaluateExpression(halo.paint?.["circle-color"], properties, { color: true }))
      .toEqual(Color.parse(SIGNAL_COLORS.unassessed));
  });

  it("uses a neutral circle for an unassessed disaster, including when selected", () => {
    const style = createMapStyle({
      theme: "dark", density: "standard", showLabels: true, signals: EMPTY_SIGNALS,
    });
    const properties = { severity: null, disaster: true, developing: false };
    for (const id of ["signal-points", "selected-point"]) {
      const layer = style.layers.find((candidate) => candidate.id === id);
      if (layer?.type !== "circle") throw new Error(`Expected circle layer ${id}.`);
      expect(evaluateExpression(layer.filter, properties)).toBe(true);
      expect(evaluateExpression(layer.paint?.["circle-color"], properties, { color: true }))
        .toEqual(Color.parse(SIGNAL_COLORS.unassessed));
    }
    for (const id of ["disaster-points", "selected-disaster"]) {
      const layer = style.layers.find((candidate) => candidate.id === id);
      if (layer?.type !== "symbol") throw new Error(`Expected symbol layer ${id}.`);
      expect(evaluateExpression(layer.filter, properties)).toBe(false);
    }
  });

  it("creates a local raster diamond with transparent corners", () => {
    const image = createDisasterImage();
    expect(image.data).toHaveLength(image.width * image.height * 4);
    expect(image.data[3]).toBe(0);
    const centerOffset = (15 * image.width + 15) * 4;
    expect(image.data[centerOffset + 3]).toBe(255);
  });

  it("hosts a matching worker, shared module, and license from the installed package", () => {
    const require = createRequire(import.meta.url);
    const packageDirectory = dirname(require.resolve("maplibre-gl/package.json"));
    for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
      expect(
        readFileSync(new URL(`../public/data/maplibre/${file}`, import.meta.url)).equals(
          readFileSync(join(packageDirectory, "dist", file)),
        ),
      ).toBe(true);
    }
    expect(
      readFileSync(new URL("../public/data/maplibre/LICENSE.txt", import.meta.url)).equals(
        readFileSync(join(packageDirectory, "LICENSE.txt")),
      ),
    ).toBe(true);
  });
});

describe("map legend", () => {
  function render(events: AtlasEvent[]) {
    return renderToStaticMarkup(createElement(WorldMap, {
      events,
      selectedEventId: null,
      onSelectEvent: () => undefined,
      onSelectCountry: () => undefined,
      theme: "dark",
      showLabels: true,
      density: "standard",
    }));
  }

  it("explicitly labels unassessed severity without presenting an analytical overlay", () => {
    const html = render([record()]);
    expect(html).toContain("Unassessed");
    expect(html).toContain("Severity unassessed");
    expect(html).not.toMatch(/risk overlay|demonstration scenario|demo severity/i);
  });

  it("does not include a demo event in the legend or missing-location count", () => {
    const html = render([record({
      isDemo: true, latitude: undefined, longitude: undefined,
    })]);
    expect(html).not.toContain("Unassessed");
    expect(html).not.toContain("no mappable location");
  });

  it("retains missing-location notices for real source records", () => {
    expect(render([record({ latitude: undefined, longitude: undefined })]))
      .toContain("1 signal has no mappable location");
  });
});
