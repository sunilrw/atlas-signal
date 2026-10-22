import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeatureCollection, Point } from "geojson";
import { CATEGORY_META, SEVERITY_META, REGIONS, conflicts, countries } from "../src/lib/catalog";
import type { EventCategory, Severity } from "@/types";

const countryByCode = new Map(countries.map((country) => [country.code, country]));
const originalCountryCodes = new Set(
  "AF AR AU BD BR CA CL CN CO CD EG ET FR DE GR HT IN ID IR IQ IL JP KE LB MX MM NZ NG NO PK PS PH PL RU SA SN SG SO ZA KR SS ES SD CH SY TW TR UA AE GB US VU VE VN YE".split(" "),
);
const mapLabels = JSON.parse(
  readFileSync(new URL("../public/data/country-labels.geojson", import.meta.url), "utf8"),
) as FeatureCollection<Point, { NAME_EN: string; ISO_A2_EH: string }>;
const supportedMapLabels = mapLabels.features.filter(
  ({ properties }) => /^[A-Z]{2}$/.test(properties.ISO_A2_EH) && properties.ISO_A2_EH !== "XK",
);

describe("display and reference-cartography catalogs", () => {
  it("uses all 17 contract categories with accessible labels and hex colors", () => {
    expect(Object.keys(CATEGORY_META)).toHaveLength(17);
    for (const category of Object.keys(CATEGORY_META) as EventCategory[]) {
      expect(CATEGORY_META[category].label.trim()).not.toBe("");
      expect(CATEGORY_META[category].shortLabel.trim()).not.toBe("");
      expect(CATEGORY_META[category].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps the assessed severity scale distinct from an unassessed event", () => {
    expect(
      ([1, 2, 3, 4, 5, 6, 7] as Severity[]).map((severity) => SEVERITY_META[severity].label),
    ).toEqual(["Minimal", "Low", "Moderate", "Significant", "High", "Severe", "Critical"]);
    for (const entry of Object.values(SEVERITY_META)) {
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(SEVERITY_META).not.toHaveProperty("null");
  });

  it("uses unique country codes and URL-safe slugs for navigation only", () => {
    expect(new Set(countries.map((country) => country.code)).size).toBe(countries.length);
    expect(new Set(countries.map((country) => country.slug)).size).toBe(countries.length);
    for (const country of countries) {
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      expect(country.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(country.name.trim()).not.toBe("");
      expect(REGIONS).toContain(country.region);
      expect(country.region).not.toBe("All regions");
      expect(Number.isFinite(country.latitude)).toBe(true);
      expect(Number.isFinite(country.longitude)).toBe(true);
      expect(Math.abs(country.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(country.longitude)).toBeLessThanOrEqual(180);
      expect(Object.keys(country).sort()).toEqual(
        ["code", "name", "slug", "region", "latitude", "longitude"].sort(),
      );
    }
  });

  it("resolves every supported map country code and its permalink slug", () => {
    expect(supportedMapLabels).toHaveLength(174);
    expect(countries).toHaveLength(175);
    expect(new Set(supportedMapLabels.map((feature) => feature.properties.ISO_A2_EH)).size).toBe(174);

    for (const label of supportedMapLabels) {
      const country = countryByCode.get(label.properties.ISO_A2_EH);
      expect(country, label.properties.NAME_EN).toBeDefined();
      expect(countries.find((entry) => entry.slug === country?.slug)).toBe(country);
    }

    const mapCodes = new Set(supportedMapLabels.map((feature) => feature.properties.ISO_A2_EH));
    expect(countries.filter((country) => !mapCodes.has(country.code)).map((country) => country.code))
      .toEqual(["SG"]);
  });

  it("preserves existing country entries and saved navigation identities", () => {
    expect(new Set(countries.slice(0, 55).map((country) => country.code))).toEqual(originalCountryCodes);
    expect(countryByCode.get("TR")).toEqual({
      code: "TR", name: "Türkiye", slug: "turkiye", region: "Middle East", latitude: 38.96, longitude: 35.24,
    });
    expect(countryByCode.get("US")).toEqual({
      code: "US", name: "United States", slug: "united-states", region: "Americas", latitude: 39.83, longitude: -98.58,
    });
    expect(countryByCode.get("PS")).toEqual({
      code: "PS", name: "Palestinian territories", slug: "palestinian-territories", region: "Middle East", latitude: 31.95, longitude: 35.23,
    });
    expect(countryByCode.get("TW")).toEqual({
      code: "TW", name: "Taiwan", slug: "taiwan", region: "Asia Pacific", latitude: 23.7, longitude: 120.96,
    });
    expect(countryByCode.get("SG")).toEqual({
      code: "SG", name: "Singapore", slug: "singapore", region: "Asia Pacific", latitude: 1.35, longitude: 103.82,
    });
  });

  it("copies additional country names and camera anchors from the bundled label source", () => {
    const added = countries.filter((country) => !originalCountryCodes.has(country.code));
    expect(added).toHaveLength(120);
    for (const country of added) {
      const label = supportedMapLabels.find((feature) => feature.properties.ISO_A2_EH === country.code);
      expect(label, country.code).toBeDefined();
      expect(country.name).toBe(label?.properties.NAME_EN);
      expect(country.longitude).toBe(label?.geometry.coordinates[0]);
      expect(country.latitude).toBe(label?.geometry.coordinates[1]);
    }
    expect(countryByCode.get("AT")).toEqual({
      code: "AT",
      name: "Austria",
      slug: "austria",
      region: "Europe",
      latitude: 47.518859,
      longitude: 14.130515,
    });
  });

  it("does not create navigation identities from source placeholders or synthetic codes", () => {
    expect(countryByCode.has("-99")).toBe(false);
    expect(countryByCode.has("XK")).toBe(false);
    expect(countryByCode.has("ZZ")).toBe(false);
    // Valid ISO-coded territories remain navigable regardless of disputed boundaries.
    for (const code of ["EH", "FK", "PS", "AQ"]) {
      expect(countryByCode.has(code)).toBe(true);
    }
  });

  it("keeps Antarctica explicit rather than assigning it to a populated region", () => {
    expect(countryByCode.get("AQ")?.region).toBe("Antarctica");
    expect(REGIONS).toContain("Antarctica");
    expect(countryByCode.get("TF")?.region).toBe("Africa");
    expect(new Set(REGIONS).size).toBe(REGIONS.length);
  });

  it("does not seed conflict assessments or fabricated event relationships", () => {
    expect(conflicts).toEqual([]);
  });

  it("does not ship the removed production demonstration payload", () => {
    expect(existsSync(new URL("../src/lib/demo-data.ts", import.meta.url))).toBe(false);
  });
});
