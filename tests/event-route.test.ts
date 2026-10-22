import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasEvent, EventsResponse } from "../src/types";
import { decodeEventPageId } from "../src/lib/event-route";
import EventPage from "../src/app/event/[id]/page";
import { GET as eventRoute } from "../src/app/api/events/[id]/route";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(),
  getEvents: vi.fn(),
}));

vi.mock("../src/components/AtlasApp", () => ({ AtlasApp: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    mocks.notFound();
    throw new Error("TEST_NOT_FOUND");
  },
}));
vi.mock("../src/lib/server/service", () => ({ getEvents: mocks.getEvents }));

/** Synthetic source records are test fixtures only. */
const record: AtlasEvent = {
  id: "bbc:unit-test-record",
  title: "Test-only publisher headline",
  summary: "",
  category: "other",
  severity: null,
  confidence: null,
  status: "reported",
  locationName: "Not provided",
  country: "Unspecified",
  countryCode: "ZZ",
  region: "Unspecified",
  locationAccuracy: "unknown",
  firstReportedAt: "2026-09-13T09:00:00.000Z",
  lastUpdatedAt: "2026-09-13T09:00:00.000Z",
  sources: [{
    id: "bbc:unit-test-source",
    name: "Test publisher",
    url: "https://example.test/source-record",
    publishedAt: "2026-09-13T09:00:00.000Z",
    type: "news",
  }],
  timeline: [],
  relatedEvents: [],
  tags: [],
  isDemo: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  const response: EventsResponse = {
    events: [record],
    mode: "live",
    referenceTime: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T11:00:00.000Z",
    sources: [],
    total: 1,
    warnings: [],
  };
  mocks.getEvents.mockResolvedValue(response);
});

describe("one-time event page parameter decoding", () => {
  it.each([
    ["bbc:unit-test-record", "bbc:unit-test-record"],
    ["bbc%3Aunit-test-record", "bbc:unit-test-record"],
    ["bbc%3aunit-test-record", "bbc:unit-test-record"],
    ["%62bc%3Aunit-test-record", "bbc:unit-test-record"],
    ["gdacs%3AFL%3A123", "gdacs:FL:123"],
    ["usgs:MixedCase_01", "usgs:MixedCase_01"],
    ["%61".repeat(160), "a".repeat(160)],
  ])("normalizes %s to its exact canonical ID", (input, expected) => {
    expect(decodeEventPageId(input)).toBe(expected);
  });

  it.each([
    null, undefined, 42, {}, [], "",
    "bbc%", "bbc%2", "bbc%GG", "bbc%E0%A4%A",
    "bbc%253Aunit-test-record", "bbc%25253Aunit-test-record",
    "bbc%2Farticle", "bbc%5Carticle", "bbc%00article",
    "bbc%3Farticle", "bbc%23article", "bbc+article",
    "bbc%20article", "../private", "a".repeat(161), "%61".repeat(161),
  ])("safely rejects malformed, double-encoded, or unsupported IDs %j", (input) => {
    expect(() => decodeEventPageId(input)).not.toThrow();
    expect(decodeEventPageId(input)).toBeNull();
  });
});

describe("event Server Component page boundary", () => {
  it.each(["bbc:unit-test-record", "bbc%3Aunit-test-record"])(
    "passes canonical ID from %s into the app without double encoding",
    async (id) => {
      const result = await EventPage({ params: Promise.resolve({ id }) }) as ReactElement<{
        children: ReactElement<{ initialEventId: string }>;
      }>;
      const selectedId = result.props.children.props.initialEventId;
      expect(selectedId).toBe(record.id);
      expect(new URLSearchParams({ event: selectedId }).toString()).toBe("event=bbc%3Aunit-test-record");
      expect(mocks.notFound).not.toHaveBeenCalled();
    },
  );

  it.each([
    "demo-old", "demo%3Aold", "DEMO%3Aold", "%64emo%2Dold",
    "event%3Ademo%3Aold", "fixture%3Aold", "sample%2Dold",
    "demo%253Aold", "%2564emo%253Aold",
    "bbc%", "bbc%2", "bbc%GG", "bbc%E0%A4%A",
    "bbc%253Aunit-test-record", "bbc%2Farticle",
  ])("does not expose retired or invalid page IDs %s", async (id) => {
    await expect(EventPage({ params: Promise.resolve({ id }) })).rejects.toThrow("TEST_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getEvents).not.toHaveBeenCalled();
  });
});

describe("event API keeps the framework-decoded identifier exact", () => {
  it.each(["bbc:unit-test-record", "bbc%3Aunit-test-record"])(
    "resolves %s using the already-decoded Route Handler param",
    async (path) => {
      const response = await eventRoute(new Request(`https://atlas.test/api/events/${path}`), {
        params: Promise.resolve({ id: record.id }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).event.id).toBe(record.id);
      expect(mocks.getEvents).toHaveBeenCalledWith("live");
    },
  );

  it.each(["bbc%3Aunit-test-record", "demo%3Aold", "bbc%", "bbc%GG"])(
    "does not perform a second API decode on %s",
    async (id) => {
      const response = await eventRoute(new Request(`https://atlas.test/api/events/${encodeURIComponent(id)}`), {
        params: Promise.resolve({ id }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).not.toHaveProperty("event");
      expect(mocks.getEvents).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["demo%3Aold", "demo:old"],
    ["%64emo%2Dold", "demo-old"],
    ["DEMO%3Aold", "DEMO:old"],
  ])("keeps encoded retired API record %s removed", async (path, id) => {
    const response = await eventRoute(new Request(`https://atlas.test/api/events/${path}`), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(410);
    expect(await response.json()).not.toHaveProperty("event");
    expect(mocks.getEvents).not.toHaveBeenCalled();
  });
});
