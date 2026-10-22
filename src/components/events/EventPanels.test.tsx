import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AtlasEvent } from "@/types";
import { EventFeed } from "./EventFeed";
import { EventDetail } from "./EventDetail";
import { EventOverview, EventSources, EventUpdateTimeline } from "./EventDetailSections";
import { TimelineView } from "./TimelineView";

const referenceTime = "2026-09-13T12:00:00.000Z";
// Synthetic records are confined to this test file; runtime views use source ingestion.
const event: AtlasEvent = {
  id: "test-source-report",
  title: "Publisher headline preserved exactly",
  summary: "Publisher summary used only by the test.",
  category: "political",
  severity: null,
  status: "reported",
  confidence: null,
  reportKind: "news",
  verificationNote: "Publisher claims have not been independently verified.",
  locationName: "",
  country: "",
  countryCode: "XX",
  region: "",
  locationAccuracy: "unknown",
  firstReportedAt: "2026-09-13T10:00:00.000Z",
  lastUpdatedAt: "2026-09-13T11:30:00.000Z",
  sources: [{
    id: "test-source",
    name: "Test publisher",
    url: "https://example.com/report",
    publishedAt: "2026-09-13T11:30:00.000Z",
    type: "news",
    publisherCountry: "Test publisher country",
    language: "English",
    byline: "Test author",
    timestampBasis: "published",
  }],
  timeline: [],
  relatedEvents: [],
  tags: [],
  isDemo: false,
};

const noop = () => {};
const discardedEvent: AtlasEvent = {
  ...event,
  id: "test-discarded-record",
  title: "Content that must never be rendered",
  summary: "A stored fictional record must never surface.",
  isDemo: true,
};

describe("event panels display only source-backed live records", () => {
  it("shows the original publisher, actual source count, and explicit unassessed status", () => {
    const html = renderToStaticMarkup(createElement(EventFeed, {
      events: [event],
      selectedEventId: event.id,
      onSelectEvent: noop,
      referenceTime,
      mode: "live",
    }));
    expect(html).toContain("LIVE REPORTS");
    expect(html).toContain(event.title);
    expect(html).toContain("Test publisher");
    expect(html).toContain("News report");
    expect(html).toContain("1 source");
    expect(html).toContain("Unassessed");
    expect(html).toContain("Location not provided");
    expect(html).toContain("Unmapped");
    expect(html).toContain("not independent verification");
    expect(html).toContain("30m ago");
    expect(html).toContain('aria-pressed="true"');
  });

  it("drops unexpected fictional or fictional-source records from the feed", () => {
    const html = renderToStaticMarkup(createElement(EventFeed, {
      events: [event, discardedEvent, { ...discardedEvent, id: "test-source-flag", isDemo: false, sources: [{ ...event.sources[0], isDemo: true }] }],
      selectedEventId: null,
      onSelectEvent: noop,
      referenceTime,
      mode: "live",
    }));
    expect(html).toContain(event.title);
    expect(html).not.toContain(discardedEvent.title);
    expect(html).toContain('aria-label="1 report"');
  });

  it("does not count source-free records as live reporting", () => {
    const html = renderToStaticMarkup(createElement(EventFeed, {
      events: [{ ...event, sources: [] }],
      selectedEventId: null,
      onSelectEvent: noop,
      referenceTime,
      mode: "live",
    }));
    expect(html).toContain("No matching events");
    expect(html).not.toContain(event.title);
  });

  it("has an explicit empty feed and an available clear-filters control", () => {
    const html = renderToStaticMarkup(createElement(EventFeed, {
      events: [],
      selectedEventId: null,
      onSelectEvent: noop,
      referenceTime,
      mode: "live",
      onClearFilters: noop,
    }));
    expect(html).toContain("No matching events");
    expect(html).toContain("Clear filters");
    expect(html).toContain("Source coverage can be incomplete.");
  });

  it("does not turn missing coordinates into an implied map position", () => {
    const html = renderToStaticMarkup(createElement(EventOverview, {
      event,
      allEvents: [event],
      onSelectEvent: noop,
    }));
    expect(html).toContain("No coordinates provided");
    expect(html).toContain("Missing coordinates have not been inferred.");
    expect(html).toContain("Unassessed");
    expect(html).toContain("Not independently verified");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("Low");
    expect(html).not.toContain("0/7");
    expect(html).not.toContain("%");
  });

  it("shows an assessed hazard's stated basis rather than a fabricated confidence", () => {
    const html = renderToStaticMarkup(createElement(EventOverview, {
      event: { ...event, severity: 4, severityReason: "Derived only from source-reported magnitude; not measured damage." },
      allEvents: [event],
      onSelectEvent: noop,
    }));
    expect(html).toContain("Derived severity");
    expect(html).toContain("Derived only from source-reported magnitude; not measured damage.");
    expect(html).toContain('aria-valuenow="4"');
    expect(html).toContain("Not independently verified");
  });

  it("does not turn a recorded confidence score into a probability graphic", () => {
    const html = renderToStaticMarkup(createElement(EventOverview, {
      event: { ...event, confidence: 72 },
      allEvents: [event],
      onSelectEvent: noop,
    }));
    expect(html).toContain("72/100");
    expect(html).toContain("not a verified probability");
    expect(html).not.toContain("72%");
  });

  it("labels related reports as context rather than corroboration", () => {
    const contextual: AtlasEvent = { ...event, id: "contextual", title: "Separate source report" };
    const html = renderToStaticMarkup(createElement(EventOverview, {
      event: { ...event, relatedEvents: [contextual.id, discardedEvent.id] },
      allEvents: [event, contextual, discardedEvent],
      onSelectEvent: noop,
    }));
    expect(html).toContain("Contextual reports");
    expect(html).toContain("not evidence of the same incident or independent corroboration");
    expect(html).toContain(contextual.title);
    expect(html).not.toContain(discardedEvent.title);
  });

  it("does not render unsafe or credential-bearing source links", () => {
    const unsafeEvent: AtlasEvent = {
      ...event,
      sources: [
        ...event.sources,
        { ...event.sources[0], id: "javascript", name: "Unsafe script link", url: "javascript:alert(1)" },
        { ...event.sources[0], id: "data", name: "Unsafe data link", url: "data:text/html,hello" },
        { ...event.sources[0], id: "credentials", name: "Credential-bearing link", url: "https://name:secret@example.com/" },
      ],
    };
    const html = renderToStaticMarkup(createElement(EventSources, { event: unsafeEvent }));
    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain("Source link unavailable");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain("name:secret");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("preserves publisher origin, byline, language, and the original source URL", () => {
    const html = renderToStaticMarkup(createElement(EventSources, { event }));
    expect(html).toContain("Original sources");
    expect(html).toContain("Publisher country: Test publisher country");
    expect(html).toContain("Language: English");
    expect(html).toContain("By Test author");
    expect(html).toContain("Published 13 Sep 2026");
    expect(html).toContain("Multiple links do not necessarily mean independent corroboration.");
    expect(html).toContain('href="https://example.com/report"');
  });

  it("does not mislabel indexing time as the original publication time", () => {
    const html = renderToStaticMarkup(createElement(EventSources, {
      event: { ...event, sources: [{ ...event.sources[0], timestampBasis: "observed" }] },
    }));
    expect(html).toContain("Indexed / observed");
    expect(html).not.toContain("Published");
  });

  it("uses a neutral time label if the upstream timestamp basis is missing", () => {
    const html = renderToStaticMarkup(createElement(EventSources, {
      event: { ...event, sources: [{ ...event.sources[0], timestampBasis: undefined }] },
    }));
    expect(html).toContain("Source timestamp");
    expect(html).not.toContain("Published");
  });

  it("retains a safe source license link without nesting it inside the article link", () => {
    const html = renderToStaticMarkup(createElement(EventSources, {
      event: { ...event, sources: [{ ...event.sources[0], licenseUrl: "https://example.com/license" }] },
    }));
    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain('href="https://example.com/license"');
    expect(html).toContain("Source license / reuse terms");
    expect(html).toMatch(/<\/a><a class="[^"]+" href="https:\/\/example.com\/license"/);
  });

  it.each(["BBC News", "Deutsche Welle"])("attributes %s with a safe publisher homepage link separate from its article", (name) => {
    const html = renderToStaticMarkup(createElement(EventSources, {
      event: { ...event, sources: [{ ...event.sources[0], name, publisherUrl: "https://example.com/" }] },
    }));
    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("Content from");
    expect(html).toContain(`aria-label="${name} publisher homepage, opens in a new tab"`);
    expect(html).toMatch(/<\/a><div class="[^"]+">Content from <a href="https:\/\/example.com\/"/);
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "https://name:secret@example.com/"])("does not link unsafe publisher URLs", (publisherUrl) => {
    const html = renderToStaticMarkup(createElement(EventSources, {
      event: { ...event, sources: [{ ...event.sources[0], publisherUrl }] },
    }));
    expect(html).not.toContain("publisher homepage");
    expect(html).not.toContain("name:secret");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
  });

  it.each(["javascript:alert(1)", "https://name:secret@example.com/license"])("does not link unsafe license URLs", (licenseUrl) => {
    const html = renderToStaticMarkup(createElement(EventSources, {
      event: { ...event, sources: [{ ...event.sources[0], licenseUrl }] },
    }));
    expect(html).not.toContain("Source license / reuse terms");
    expect(html).not.toContain("name:secret");
    expect(html).not.toContain('href="javascript:');
  });

  it("keeps publication and indexing timestamps distinct when both are supplied", () => {
    const html = renderToStaticMarkup(createElement(EventSources, {
      event: { ...event, sources: [{ ...event.sources[0], observedAt: "2026-09-13T11:45:00.000Z" }] },
    }));
    expect(html).toContain("Published 13 Sep 2026");
    expect(html).toContain("Indexed / observed 13 Sep 2026");
    expect(html).toContain("11:30 UTC");
    expect(html).toContain("11:45 UTC");
  });

  it.each([
    discardedEvent,
    { ...discardedEvent, isDemo: false, sources: [{ ...event.sources[0], isDemo: true }] },
  ])("refuses to render unavailable event/source records in details or sources", (unavailable) => {
    const sources = renderToStaticMarkup(createElement(EventSources, { event: unavailable }));
    const details = renderToStaticMarkup(createElement(EventDetail, {
      event: unavailable,
      allEvents: [event, unavailable],
      onClose: noop,
      onSelectEvent: noop,
      referenceTime,
      isSaved: false,
      onToggleSave: noop,
    }));
    expect(sources).toContain("This report is unavailable.");
    expect(sources).not.toContain('href=');
    expect(details).toContain("REPORT UNAVAILABLE");
    expect(details).not.toContain(unavailable.title);
    expect(details).not.toContain(unavailable.summary);
    expect(details).toContain('aria-label="Close event details"');
  });

  it("provides a live-only permalink and keeps the accessible tab navigation", () => {
    const html = renderToStaticMarkup(createElement(EventDetail, {
      event,
      allEvents: [event],
      onClose: noop,
      onSelectEvent: noop,
      referenceTime,
      isSaved: false,
      onToggleSave: noop,
    }));
    expect(html).toContain('/event/test-source-report');
    expect(html).not.toContain("?mode=");
    expect(html).toContain("SOURCE-REPORTED RECORD");
    expect(html).toContain("Test publisher");
    expect(html).toContain("Unassessed");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-label="Save event to watchlist"');
  });

  it("shows an empty update history without inventing an update", () => {
    const html = renderToStaticMarkup(createElement(EventUpdateTimeline, { event }));
    expect(html).toContain("No updates have been recorded for this event.");
    expect(html).toContain("not a reconstructed incident history");
  });

  it("preserves actual source-timeline labels and descriptions verbatim", () => {
    const html = renderToStaticMarkup(createElement(EventUpdateTimeline, {
      event: {
        ...event,
        timeline: [{
          id: "source-time",
          timestamp: "2026-09-13T10:00:00.000Z",
          title: "Indexed by source aggregator",
          description: "Publication time unavailable from upstream.",
        }],
      },
    }));
    expect(html).toContain("Indexed by source aggregator");
    expect(html).toContain("Publication time unavailable from upstream.");
  });

  it("keeps unmapped news reports and null assessment visible in the full timeline", () => {
    const html = renderToStaticMarkup(createElement(TimelineView, {
      events: [event, discardedEvent],
      referenceTime,
      onSelectEvent: noop,
    }));
    expect(html).not.toContain(discardedEvent.title);
    expect(html).toContain("Report timeline");
    expect(html).toContain("Unmapped");
    expect(html).toContain("1 source");
    expect(html).toContain("Unassessed");
    expect(html).toContain("Test publisher");
    expect(html).toContain("News report");
    expect(html).toContain("not reconstructed incident history");
    expect(html).toContain("10:00 UTC");
  });

  it("keeps source occurrence timestamps distinct from publication in the full timeline", () => {
    const html = renderToStaticMarkup(createElement(TimelineView, {
      events: [{ ...event, sources: [{ ...event.sources[0], timestampBasis: "occurred" }] }],
      referenceTime,
      onSelectEvent: noop,
    }));
    expect(html).toContain("Reported occurrence");
  });

  it("uses the explicit empty timeline when all input records are unavailable", () => {
    const html = renderToStaticMarkup(createElement(TimelineView, {
      events: [discardedEvent],
      referenceTime,
      onSelectEvent: noop,
    }));
    expect(html).toContain("No reports in this view");
    expect(html).not.toContain(discardedEvent.title);
  });
});
