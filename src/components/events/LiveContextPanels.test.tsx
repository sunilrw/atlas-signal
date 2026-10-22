import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AtlasEvent, CountryInfo, WatchlistEntry } from "@/types";
import { Briefing } from "@/components/Briefing";
import { CountryPanel } from "@/components/CountryPanel";
import { CommandPalette, getCommandReportResults } from "@/components/CommandPalette";
import { Watchlist } from "@/components/Watchlist";

const referenceTime = "2026-09-13T12:00:00.000Z";
const noop = () => {};
const country: CountryInfo = {
  code: "GB",
  name: "United Kingdom",
  slug: "united-kingdom",
  region: "Europe",
  latitude: 55.38,
  longitude: -3.44,
};

// Synthetic records are deliberately confined to this test module.
const report: AtlasEvent = {
  id: "context-test-report",
  title: "Latest test-only publisher headline",
  summary: "The publisher's original test-only description.",
  category: "political",
  reportKind: "news",
  severity: null,
  confidence: null,
  status: "reported",
  locationName: "",
  country: country.name,
  countryCode: country.code,
  region: country.region,
  locationAccuracy: "country",
  firstReportedAt: "2026-09-13T04:00:00.000Z",
  lastUpdatedAt: "2026-09-13T11:30:00.000Z",
  sources: [{
    id: "context-test-source",
    name: "Test Bulletin",
    providerId: "test-provider",
    publisherCountry: "GB",
    language: "en",
    type: "news",
    url: "https://example.com/test-only-report",
    publishedAt: "2026-09-13T11:30:00.000Z",
  }],
  timeline: [],
  relatedEvents: [],
  tags: [],
  isDemo: false,
};

const olderAssessedReport: AtlasEvent = {
  ...report,
  id: "context-test-older-hazard",
  title: "Older test-only hazard record",
  reportKind: "incident",
  category: "natural-disaster",
  severity: 7,
  severityReason: "Test-only magnitude-based severity.",
  lastUpdatedAt: "2026-09-13T05:00:00.000Z",
  sources: [{ ...report.sources[0], publishedAt: "2026-09-13T05:00:00.000Z" }],
};

const rejectedRecords: AtlasEvent[] = [
  { ...report, id: "rejected-event", title: "Rejected fictional event title", isDemo: true },
  { ...report, id: "rejected-source", title: "Rejected fictional source title", sources: [{ ...report.sources[0], isDemo: true }] },
  { ...report, id: "rejected-no-source", title: "Rejected ungrounded title", sources: [] },
];

function renderBriefing(events: AtlasEvent[]) {
  return renderToStaticMarkup(createElement(Briefing, { events, referenceTime, mode: "live", onSelectEvent: noop }));
}

function renderCountry(events: AtlasEvent[]) {
  return renderToStaticMarkup(createElement(CountryPanel, {
    country, events, referenceTime, mode: "live", saved: false,
    onClose: noop, onToggleSave: noop, onSelectEvent: noop,
  }));
}

function renderCommand(events: AtlasEvent[]) {
  return renderToStaticMarkup(createElement(CommandPalette, {
    open: true, events, onClose: noop, onSelectEvent: noop, onSelectCountry: noop,
    onSearch: noop, onSetCategory: noop, onSetView: noop,
  }));
}

function renderWatchlist(events: AtlasEvent[], watchlist: WatchlistEntry[]) {
  return renderToStaticMarkup(createElement(Watchlist, {
    events, watchlist, referenceTime, alerts: [], onSelectEvent: noop,
    onSelectCountry: noop, onRemove: noop, onExplore: noop, onAlerts: noop,
  }));
}

describe("live-only contextual panels", () => {
  it.each([
    ["briefing", renderBriefing],
    ["country", renderCountry],
    ["command search", renderCommand],
  ] as const)("does not expose rejected records in the %s panel", (_name, render) => {
    const html = render([report, ...rejectedRecords]);
    expect(html).toContain(report.title);
    for (const rejected of rejectedRecords) expect(html).not.toContain(rejected.title);
    expect(html).not.toContain("Illustrative scenario");
    expect(html).not.toContain("mode=demo");
  });

  it("keeps unassessed news first in the briefing and shows assessment coverage", () => {
    const html = renderBriefing([olderAssessedReport, report]);
    expect(html.indexOf(report.title)).toBeLessThan(html.indexOf(olderAssessedReport.title));
    expect(html).toContain("<span>Available reports</span><strong>2</strong>");
    expect(html).toContain("<span>Severity assessed</span><strong>1</strong>");
    expect(html).toContain("<span>Severity unassessed</span><strong>1</strong>");
    expect(html).toContain("Test Bulletin");
    expect(html).toMatch(/News/);
    expect(html).toContain("Unassessed");
    expect(html).toContain("Severity basis: Test-only magnitude-based severity.");
    expect(html).not.toContain("Priority developments");
    expect(html).not.toContain("confidence");
    expect(html).toContain("inclusion is not independent verification");
  });

  it("does not treat all-unassessed reports as assessed, critical, or low severity", () => {
    const html = renderBriefing([report]);
    expect(html).toContain("<span>Severity assessed</span><strong>0</strong>");
    expect(html).toContain("<span>Severity unassessed</span><strong>1</strong>");
    expect(html).not.toContain("Critical");
    expect(html).not.toContain("Severity: Low");
    expect(html).not.toContain("Severity: Minimal");
  });

  it("shows an empty briefing instead of restoring rejected records", () => {
    const html = renderBriefing(rejectedRecords);
    expect(html).toContain("<span>Available reports</span><strong>0</strong>");
    expect(html).toContain("No reports match this view.");
  });

  it("sorts the country latest reports by update time instead of severity", () => {
    const html = renderCountry([olderAssessedReport, report]);
    expect(html.indexOf(report.title)).toBeLessThan(html.indexOf(olderAssessedReport.title));
    expect(html).toContain("Latest report update</span><strong>30m ago</strong>");
    expect(html).toContain("<strong>1</strong><span>severity unassessed</span>");
    expect(html).toContain("Test Bulletin");
    expect(html).toMatch(/News/);
    expect(html).toContain('href="/country/united-kingdom"');
    expect(html).not.toContain("?mode=");
  });

  it("does not present absent country coverage as stability or a risk score", () => {
    const otherCountry = { ...report, id: "test-other-country", countryCode: "US" };
    const html = renderCountry([otherCountry, ...rejectedRecords]);
    expect(html).toContain("<strong>0</strong><span>available reports</span>");
    expect(html).toContain("No reports available");
    expect(html).toContain("No reporting in this view.");
    expect(html).toContain("Missing reports do not imply safety or stability.");
    expect(html).not.toContain("severe or critical");
    expect(html).not.toContain("Low risk");
  });

  it("uses latest-first command results with neutral unassessed styling", () => {
    const events = [olderAssessedReport, report, ...rejectedRecords];
    expect(getCommandReportResults(events, "").map(({ id }) => id)).toEqual([report.id, olderAssessedReport.id]);
    expect(events[0]).toBe(olderAssessedReport);
    const html = renderCommand([report]);
    expect(html).toContain('title="Severity: Unassessed"');
    expect(html).not.toContain("severity-7");
    expect(html).not.toContain("severity-null");
    expect(html).toContain('aria-label="Search countries, reports, and publishers"');
    expect(html).toContain("to navigate");
    expect(html).toContain("to select");
  });

  it.each(["test bulletin", "test-provider", "gb", "en", "news"])("searches publisher metadata and report kind for %s", (query) => {
    expect(getCommandReportResults([report, ...rejectedRecords], query)).toEqual([report]);
  });

  it("never resurrects a stale saved event label, even in its remove control", () => {
    const entries: WatchlistEntry[] = [
      { id: "old-label", kind: "event", value: report.id, label: "Outdated fictional saved headline" },
      { id: "missing", kind: "event", value: "missing-report", label: "Missing fictional saved headline" },
      ...rejectedRecords.map((event) => ({ id: event.id, kind: "event" as const, value: event.id, label: event.title })),
    ];
    const html = renderWatchlist([report, ...rejectedRecords], entries);
    expect(html).toContain(report.title);
    expect(html).toContain("Test Bulletin");
    expect(html).toContain("Saved report unavailable");
    expect(html).toContain('aria-label="Remove Saved report unavailable from watchlist"');
    expect(html).toContain('disabled=""');
    for (const entry of entries) expect(html).not.toContain(entry.label);
  });

  it("counts only source-backed country reports and uses the catalog country label", () => {
    const html = renderWatchlist([report, ...rejectedRecords], [{
      id: "saved-country", kind: "country", value: country.code, label: "Outdated country label",
    }]);
    expect(html).toContain(country.name);
    expect(html).toContain("1 source report in this view");
    expect(html).not.toContain("Outdated country label");
  });
});
