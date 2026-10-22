import { describe, expect, it } from "vitest";
import { isAlertRules, isTheme, isWatchlist } from "../src/lib/preferences";

describe("browser preference boundaries", () => {
  const entry = { id: "country:AT", kind: "country", label: "Austria", value: "AT" };
  const rule = { id: "local-rule", name: "High disaster reports", countryCode: "", category: "natural-disaster", minSeverity: 5, enabled: true };

  it("accepts local event and country watchlist entries", () => {
    expect(isWatchlist([entry, { id: "event:test", kind: "event", label: "An event", value: "test" }])).toBe(true);
  });
  it("accepts an empty watchlist without inventing defaults", () => {
    expect(isWatchlist([])).toBe(true);
  });
  it.each([null, {}, "[]", [{ ...entry, kind: "account" }], [{ ...entry, label: null }]])("rejects malformed watchlist %j", (value) => {
    expect(isWatchlist(value)).toBe(false);
  });
  it("limits a persisted watchlist to 500 items", () => {
    expect(isWatchlist(Array.from({ length: 500 }, () => entry))).toBe(true);
    expect(isWatchlist(Array.from({ length: 501 }, () => entry))).toBe(false);
  });
  it("accepts bounded local notification rules", () => {
    expect(isAlertRules([rule])).toBe(true);
    expect(isAlertRules([{ ...rule, category: "all" }])).toBe(true);
  });
  it.each([0, 8, 1.5, "5", null])("rejects severity %j", (minSeverity) => {
    expect(isAlertRules([{ ...rule, minSeverity }])).toBe(false);
  });
  it.each(["constructor", "not-a-category", null])("rejects unknown or inherited categories %j", (category) => {
    expect(isAlertRules([{ ...rule, category }])).toBe(false);
  });
  it("rejects more than 100 rules and malformed enabled flags", () => {
    expect(isAlertRules(Array.from({ length: 101 }, () => rule))).toBe(false);
    expect(isAlertRules([{ ...rule, enabled: "true" }])).toBe(false);
  });
  it("accepts only the two supported display themes", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
