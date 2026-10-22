import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProvider, PROVIDERS, type ProviderId } from "@/lib/server/providers";
import { processEvents } from "@/lib/server/pipeline";

const NOW = "2026-09-13T12:00:00.000Z";
const REPORTED = "2026-09-13T10:00:00.000Z";

function earthquake(overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    id: "us-example",
    properties: {
      title: "M 5.8 - Offshore Japan",
      place: "Offshore Japan",
      time: Date.parse(REPORTED),
      updated: Date.parse("2026-09-13T11:00:00.000Z"),
      mag: 5.8,
      type: "earthquake",
      status: "reviewed",
      url: "https://earthquake.usgs.gov/earthquakes/eventpage/us-example",
    },
    geometry: { type: "Point", coordinates: [141.2, 38.3, 10] },
    ...overrides,
  };
}

function respondJson(value: unknown, init?: ResponseInit) {
  const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify(value), init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function respondXml(value: string) {
  const mock = vi.fn().mockResolvedValue(new Response(value, { headers: { "content-type": "application/xml" } }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function gdacsItem(extra = "") {
  return `<item>
    <title>Orange flood alert in Japan</title>
    <description><![CDATA[<p>Provider alert, <b>not independently verified</b>.</p>]]></description>
    <link>https://www.gdacs.org/report.aspx?eventid=12&amp;eventtype=FL</link>
    <pubDate>Sun, 13 Sep 2026 10:00:00 GMT</pubDate>
    <gdacs:eventtype>FL</gdacs:eventtype>
    <gdacs:eventid>12</gdacs:eventid>
    <gdacs:episodeid>3</gdacs:episodeid>
    <gdacs:alertlevel>Orange</gdacs:alertlevel>
    <gdacs:country>Japan</gdacs:country>
    <gdacs:iso3>JPN</gdacs:iso3>
    <gdacs:fromdate>Sat, 12 Sep 2026 10:00:00 GMT</gdacs:fromdate>
    ${extra}
  </item>`;
}

const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Source feed</title>${items}</channel></rss>`;

function newsItem(extra = "", overrides: { title?: string; link?: string; date?: string } = {}) {
  return `<item>
    <title>${overrides.title ?? "Election results reported"}</title>
    <link>${overrides.link ?? "https://publisher.example.org/news/report"}</link>
    <pubDate>${overrides.date ?? "Sun, 13 Sep 2026 10:00:00 GMT"}</pubDate>
    <description><![CDATA[The source says <b>counting continues</b>.]]></description>
    ${extra}
  </item>`;
}

const missingGdacsIdentifiers = [
  { label: "missing event ID", pattern: /<gdacs:eventid>[^<]*<\/gdacs:eventid>/g },
  { label: "missing event type", pattern: /<gdacs:eventtype>[^<]*<\/gdacs:eventtype>/g },
  { label: "missing event ID and type", pattern: /<gdacs:(?:eventid|eventtype)>[^<]*<\/gdacs:(?:eventid|eventtype)>/g },
  { label: "blank event ID", pattern: /<gdacs:eventid>[^<]*<\/gdacs:eventid>/g, replacement: "<gdacs:eventid>   </gdacs:eventid>" },
  { label: "malformed event ID", pattern: /<gdacs:eventid>[^<]*<\/gdacs:eventid>/g, replacement: "<gdacs:eventid>event-12</gdacs:eventid>" },
  { label: "malformed event type", pattern: /<gdacs:eventtype>[^<]*<\/gdacs:eventtype>/g, replacement: "<gdacs:eventtype>FL:spoof</gdacs:eventtype>" },
];

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(NOW));
  vi.stubEnv("USGS_ENABLED", "true");
  vi.stubEnv("GDACS_ENABLED", "true");
  vi.stubEnv("RELIEFWEB_APPNAME", "");
  vi.stubEnv("GDELT_ENABLED", "false");
  for (const variable of ["RSS_ENABLED", "BBC_ENABLED", "DW_ENABLED", "UN_NEWS_ENABLED", "GLOBAL_VOICES_ENABLED", "FRANCE24_ENABLED", "ALJAZEERA_ENABLED"]) {
    vi.stubEnv(variable, undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("provider configuration and fetch boundaries", () => {
  it("enables genuinely sourced hazards and four editorial organizations for local personal reading", () => {
    expect(PROVIDERS.filter((provider) => provider.enabled()).map((provider) => provider.id))
      .toEqual(["usgs", "gdacs", "bbc", "dw", "unnews", "globalvoices"]);
    expect(new Set(PROVIDERS.map((provider) => provider.id)).size).toBe(PROVIDERS.length);
    for (const provider of PROVIDERS) {
      expect(new URL(provider.url).protocol).toBe("https:");
      expect(new URL(provider.termsUrl).protocol).toBe("https:");
      expect(provider.kind).toBeTruthy();
      expect(provider.publisherCountry).toBeTruthy();
      expect(provider.language).toBeTruthy();
      expect(provider.usageNote).toBeTruthy();
    }
    expect(PROVIDERS.find((provider) => provider.id === "bbc")?.refreshIntervalMs).toBe(15 * 60_000);
  });

  it("supports individual feed opt-outs and retains a master RSS opt-out", () => {
    vi.stubEnv("BBC_ENABLED", "false");
    expect(PROVIDERS.find((provider) => provider.id === "bbc")?.enabled()).toBe(false);
    expect(PROVIDERS.find((provider) => provider.id === "dw")?.enabled()).toBe(true);
    vi.stubEnv("FRANCE24_ENABLED", "true");
    expect(PROVIDERS.find((provider) => provider.id === "france24")?.enabled()).toBe(true);
    vi.stubEnv("RSS_ENABLED", "false");
    expect(PROVIDERS.filter((provider) => provider.enabled()).map((provider) => provider.id)).toEqual(["usgs", "gdacs"]);
  });

  it("does not enable permission-restricted optional publishers on a general RSS opt-in", () => {
    vi.stubEnv("RSS_ENABLED", "true");
    expect(PROVIDERS.find((provider) => provider.id === "france24")?.enabled()).toBe(false);
    expect(PROVIDERS.find((provider) => provider.id === "aljazeera")?.enabled()).toBe(false);
  });

  it("does not fetch a disabled or unknown provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProvider("reliefweb")).rejects.toThrow("approved ReliefWeb");
    await expect(fetchProvider("https://internal.invalid" as "usgs")).rejects.toThrow("Unknown provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the fixed endpoint with redirects forbidden and caching disabled", async () => {
    vi.stubEnv("USGS_URL", "http://127.0.0.1/secrets");
    const fetchMock = respondJson({ features: [] });
    await fetchProvider("usgs");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sanitizes transport and upstream failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret token=response-body")));
    await expect(fetchProvider("usgs")).rejects.toThrow("Provider request failed, timed out, or was cancelled.");
    respondJson({ private: "sensitive upstream body" }, { status: 503 });
    await expect(fetchProvider("usgs")).rejects.toThrow("Provider returned HTTP 503.");
  });

  it("retries only an ENOTFOUND lookup failure through an IPv4 dispatcher for the identical fixed URL", async () => {
    const dnsFailure = new TypeError("fetch failed", { cause: Object.assign(new Error("DNS lookup failed"), { code: "ENOTFOUND" }) });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(dnsFailure)
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchProvider("usgs");
    expect(result.events).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [URL, RequestInit & { dispatcher?: unknown }];
    const [retryUrl, retryInit] = fetchMock.mock.calls[1] as [URL, RequestInit & { dispatcher?: unknown }];
    expect(retryUrl).toBe(firstUrl);
    expect(retryUrl.toString()).toBe(PROVIDERS.find((provider) => provider.id === "usgs")!.url);
    expect(firstInit.dispatcher).toBeUndefined();
    expect(retryInit.dispatcher).toBeTruthy();
    expect(retryInit.signal).toBe(firstInit.signal);
    expect(retryInit.redirect).toBe("error");
    expect(retryInit.cache).toBe("no-store");
    expect(retryInit.headers).toEqual(firstInit.headers);
  });

  it.each(["ECONNRESET", "EAI_AGAIN", "CERT_HAS_EXPIRED"])("does not retry non-ENOTFOUND transport failure %s", async (code) => {
    const failure = new TypeError("fetch failed", { cause: Object.assign(new Error("Transport failure"), { code }) });
    const fetchMock = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProvider("usgs")).rejects.toThrow("Provider request failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not loop or expose DNS details if the IPv4 retry also fails", async () => {
    const failure = Object.assign(new Error("private resolver details"), { code: "ENOTFOUND" });
    const fetchMock = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProvider("usgs")).rejects.toThrow("Provider request failed, timed out, or was cancelled.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares the original nine-second deadline with the DNS retry", async () => {
    vi.useFakeTimers();
    const failure = Object.assign(new Error("DNS lookup failed"), { code: "ENOTFOUND" });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => setTimeout(() => reject(failure), 8_000)))
      .mockImplementationOnce((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = expect(fetchProvider("usgs")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(retryInit.signal).toBe(firstInit.signal);
    expect(retryInit.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(retryInit.signal!.aborted).toBe(true);
  });

  it("does not start a DNS retry after external cancellation", async () => {
    const controller = new AbortController();
    const failure = Object.assign(new Error("DNS lookup failed"), { code: "ENOTFOUND" });
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(failure);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProvider("usgs", controller.signal)).rejects.toThrow("cancelled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized advertised and streamed responses", async () => {
    respondJson({ features: [] }, { headers: { "content-length": String(5 * 1_024 * 1_024 + 1) } });
    await expect(fetchProvider("usgs")).rejects.toThrow("5 MB limit");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(5 * 1_024 * 1_024 + 1))));
    await expect(fetchProvider("usgs")).rejects.toThrow("5 MB limit");
  });

  it("bounds processed record counts and explicitly reports omissions", async () => {
    respondJson({ features: Array.from({ length: 1_003 }, (_, index) => earthquake({ id: `event-${index}` })) });
    const result = await fetchProvider("usgs");
    expect(result.events).toHaveLength(1_000);
    expect(result.raw).toHaveLength(1_000);
    expect(result.message).toContain("3 records omitted by the 1000-record per-refresh limit");
  });

  it("aborts slow provider requests within nine seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    const pending = expect(fetchProvider("usgs")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(9_000);
    await pending;
  });

  it("rejects malformed JSON, response shapes, XML and DTDs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(fetchProvider("usgs")).rejects.toThrow("invalid JSON");
    respondJson({ error: "private provider details" });
    await expect(fetchProvider("usgs")).rejects.toThrow("unsupported response shape");
    respondXml("<rss><channel><item></channel></rss>");
    await expect(fetchProvider("gdacs")).rejects.toThrow("invalid or unsupported XML");
    respondXml('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><title>&x;</title></channel></rss>');
    await expect(fetchProvider("gdacs")).rejects.toThrow("invalid or unsupported XML");
  });
});

describe("USGS normalization", () => {
  it("preserves provenance, actual coordinates and raw records without implying verification", async () => {
    const feature = earthquake();
    respondJson({ features: [feature] });
    const result = await fetchProvider("usgs");
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.id).toBe("usgs:us-example");
    expect(event.category).toBe("natural-disaster");
    expect(event.subcategory).toBe("earthquake");
    expect(event.latitude).toBe(38.3);
    expect(event.longitude).toBe(141.2);
    expect(event.countryCode).toBe("ZZ");
    expect(event.country).toBe("Unspecified");
    expect(event.locationAccuracy).toBe("approximate");
    expect(event.status).toBe("reported");
    expect(event.confidence).toBeNull();
    expect(event.severity).toBe(4);
    expect(event.severityReason).toContain("magnitude 5.8 only");
    expect(event.verificationNote).toContain("not independently verified by Atlas Signal");
    expect(event.verificationNote).toContain("USGS review status: reviewed");
    expect(event.reportKind).toBe("incident");
    expect(event.summary).toContain("magnitude only");
    expect(event.timeline[0].title).toBe("USGS event origin time");
    expect(event.isDemo).toBe(false);
    expect(event.sources[0].isDemo).toBe(false);
    expect(event.sources[0].providerId).toBe("usgs");
    expect(event.sources[0].timestampBasis).toBe("occurred");
    expect(event.sources[0].observedAt).toBe(NOW);
    expect(event.detectedAt).toBe(NOW);
    expect(event.tags).not.toContain("automated-confidence");
    expect(result.raw).toEqual([{ provider: "usgs", providerId: "us-example", fetchedAt: NOW, payload: feature }]);
  });

  it.each([
    [181, 38],
    [140, 91],
    [null, 30],
    [140, null],
    [140],
    [],
  ])("does not invent or partially retain invalid coordinates %j", async (...coordinates) => {
    respondJson({ features: [earthquake({ geometry: { type: "Point", coordinates } })] });
    const { events } = await fetchProvider("usgs");
    expect(events[0].latitude).toBeUndefined();
    expect(events[0].longitude).toBeUndefined();
    expect(events[0].locationAccuracy).toBe("unknown");
  });

  it("retains invalid-date and unsafe-link records only as raw data", async () => {
    const feature = earthquake();
    respondJson({ features: [
      earthquake({ properties: { ...feature.properties, time: "not a date" } }),
      earthquake({ properties: { ...feature.properties, url: "javascript:alert(1)" } }),
      earthquake({ properties: { ...feature.properties, url: "https://user:password@example.com/report" } }),
    ] });
    const result = await fetchProvider("usgs");
    expect(result.events).toEqual([]);
    expect(result.raw).toHaveLength(3);
    expect(result.message).toContain("3 incomplete records");
  });

  it("does not label non-earthquake USGS detections as natural earthquakes", async () => {
    const feature = earthquake();
    respondJson({ features: [earthquake({ properties: { ...feature.properties, type: "explosion" } })] });
    const result = await fetchProvider("usgs");
    expect(result.events).toEqual([]);
    expect(result.raw).toHaveLength(1);
  });

  it.each([undefined, null, "unknown", 13, -3])("leaves missing or invalid magnitude %j unassessed", async (mag) => {
    const feature = earthquake();
    respondJson({ features: [earthquake({ properties: { ...feature.properties, mag } })] });
    const event = (await fetchProvider("usgs")).events[0];
    expect(event.severity).toBeNull();
    expect(event.severityReason).toBeUndefined();
    expect(event.confidence).toBeNull();
    expect(event.magnitude).toBeUndefined();
    expect(event.summary).not.toContain("defaults");
  });

  it("rejects future origin times and never substitutes ingestion time for missing source times", async () => {
    const feature = earthquake();
    respondJson({ features: [
      earthquake({ properties: { ...feature.properties, time: Date.parse(NOW) + 1 } }),
      earthquake({ properties: { ...feature.properties, time: undefined } }),
      earthquake({ properties: { ...feature.properties, time: -1 } }),
    ] });
    const result = await fetchProvider("usgs");
    expect(result.events).toEqual([]);
    expect(result.raw).toHaveLength(3);
  });

  it("does not publish a future last-updated timestamp", async () => {
    const feature = earthquake();
    respondJson({ features: [earthquake({ properties: { ...feature.properties, updated: Date.parse(NOW) + 1 } })] });
    const event = (await fetchProvider("usgs")).events[0];
    expect(event.lastUpdatedAt).toBe(REPORTED);
    expect(event.timeline).toHaveLength(1);
  });

  it("removes markup and script content from provider display fields", async () => {
    const feature = earthquake();
    respondJson({ features: [earthquake({ properties: {
      ...feature.properties,
      title: '<script>bad()</script><b>Earthquake</b> &amp; aftershocks',
      place: "&lt;b&gt;Offshore&lt;/b&gt;",
    } })] });
    const event = (await fetchProvider("usgs")).events[0];
    expect(event.title).toBe("Earthquake & aftershocks");
    expect(event.locationName).toBe("Offshore");
    expect(event.summary).not.toContain("<");
  });
});

describe("GDACS normalization", () => {
  it("supports nested geo points and encoded source links while preserving source alert labels", async () => {
    respondXml(rss(gdacsItem("<geo:Point><geo:lat>38.3</geo:lat><geo:long>141.2</geo:long></geo:Point>")));
    const result = await fetchProvider("gdacs");
    const event = result.events[0];
    expect(event.id).toBe("gdacs:FL:12");
    expect(event.latitude).toBe(38.3);
    expect(event.longitude).toBe(141.2);
    expect(event.countryCode).toBe("JP");
    expect(event.severity).toBe(4);
    expect(event.confidence).toBeNull();
    expect(event.severityReason).toContain("GDACS orange alert");
    expect(event.status).toBe("reported");
    expect(event.summary).toContain("GDACS source alert level: orange");
    expect(event.summary).not.toContain("<p>");
    expect(event.sources[0].url).toBe("https://www.gdacs.org/report.aspx?eventid=12&eventtype=FL");
    expect(event.timeline[0].title).toBe("Event onset reported by GDACS");
    expect(result.raw[0].providerId).toBe("FL:12:3");
  });

  it("supports georss latitude-longitude order and zero coordinates", async () => {
    respondXml(rss(gdacsItem("<georss:point>0 15.5</georss:point>")));
    const event = (await fetchProvider("gdacs")).events[0];
    expect(event.latitude).toBe(0);
    expect(event.longitude).toBe(15.5);
  });

  it("never turns country metadata into a map marker", async () => {
    respondXml(rss(gdacsItem()));
    const event = (await fetchProvider("gdacs")).events[0];
    expect(event.country).toBe("Japan");
    expect(event.countryCode).toBe("JP");
    expect(event.latitude).toBeUndefined();
    expect(event.longitude).toBeUndefined();
    expect(event.locationAccuracy).toBe("unknown");
  });

  it.each(["", "unknown", "blue"])("leaves GDACS level %j unassessed rather than assigning a default score", async (level) => {
    respondXml(rss(gdacsItem().replace("<gdacs:alertlevel>Orange</gdacs:alertlevel>", `<gdacs:alertlevel>${level}</gdacs:alertlevel>`)));
    const event = (await fetchProvider("gdacs")).events[0];
    expect(event.severity).toBeNull();
    expect(event.severityReason).toBeUndefined();
    expect(event.confidence).toBeNull();
    expect(event.summary).toContain("unassessed");
  });

  it("retains raw episode IDs while keeping the normalized disaster ID stable", async () => {
    respondXml(rss(gdacsItem() + gdacsItem().replace("<gdacs:episodeid>3", "<gdacs:episodeid>4")));
    const result = await fetchProvider("gdacs");
    expect(result.events.map((event) => event.id)).toEqual(["gdacs:FL:12", "gdacs:FL:12"]);
    expect(result.raw.map((record) => record.providerId)).toEqual(["FL:12:3", "FL:12:4"]);
  });

  it.each(missingGdacsIdentifiers)("keeps distinct reports separate with $label", async ({ pattern, replacement }) => {
    const first = gdacsItem().replace(pattern, replacement ?? "");
    const second = gdacsItem()
      .replace("Orange flood alert in Japan", "Separate flood alert in northern Japan")
      .replace("eventid=12&amp;eventtype=FL", "eventid=13&amp;eventtype=FL")
      .replace(pattern, replacement ?? "");
    respondXml(rss(first + second));

    const result = await fetchProvider("gdacs");
    expect(result.events).toHaveLength(2);
    expect(new Set(result.events.map((event) => event.id)).size).toBe(2);
    expect(result.raw).toHaveLength(2);
    expect(new Set(result.raw.map((record) => record.providerId)).size).toBe(2);
    const processed = processEvents(result.events);
    expect(processed).toHaveLength(2);
    expect(new Set(processed.map((event) => event.id)).size).toBe(2);
  });

  it.each(missingGdacsIdentifiers)("keeps fallback IDs stable across fetches with $label", async ({ pattern, replacement }) => {
    const body = rss(gdacsItem().replace(pattern, replacement ?? ""));
    respondXml(body);
    const first = await fetchProvider("gdacs");
    vi.mocked(Date.now).mockReturnValue(Date.parse(NOW) + 60_000);
    respondXml(body);
    const repeated = await fetchProvider("gdacs");

    expect(first.events).toHaveLength(1);
    expect(repeated.events).toHaveLength(1);
    expect(repeated.events[0].id).toBe(first.events[0].id);
    expect(repeated.raw[0].providerId).toBe(first.raw[0].providerId);
    expect(repeated.raw[0].fetchedAt).not.toBe(first.raw[0].fetchedAt);
    expect(processEvents([...first.events, ...repeated.events])).toHaveLength(1);
  });

  it("does not truncate distinct long numeric GDACS IDs with a shared prefix", async () => {
    const prefix = "7".repeat(110);
    const items = ["1", "2"].map((suffix) => gdacsItem()
      .replace("<gdacs:eventid>12</gdacs:eventid>", `<gdacs:eventid>${prefix}${suffix}</gdacs:eventid>`)
      .replace("eventid=12&amp;", `eventid=${prefix}${suffix}&amp;`));
    respondXml(rss(items.join("")));
    const result = await fetchProvider("gdacs");

    expect(result.events).toHaveLength(2);
    expect(new Set(result.events.map((event) => event.id)).size).toBe(2);
    expect(new Set(result.raw.map((record) => record.providerId)).size).toBe(2);
    expect(processEvents(result.events)).toHaveLength(2);
  });

  it("uses explicit single ISO3 metadata when provider country labels differ", async () => {
    respondXml(rss(gdacsItem()
      .replace("<gdacs:country>Japan", "<gdacs:country>Islamic Republic of Iran")
      .replace("<gdacs:iso3>JPN", "<gdacs:iso3>IRN")));
    const event = (await fetchProvider("gdacs")).events[0];
    expect(event.country).toBe("Islamic Republic of Iran");
    expect(event.countryCode).toBe("IR");
    expect(event.region).toBe("Middle East");
    expect(event.latitude).toBeUndefined();
  });

  it("does not truncate compound country codes into a single country", async () => {
    respondXml(rss(gdacsItem()
      .replace("<gdacs:country>Japan", "<gdacs:country>Multiple countries")
      .replace("<gdacs:iso3>JPN", "<gdacs:iso3>IRN,COD")));
    const event = (await fetchProvider("gdacs")).events[0];
    expect(event.countryCode).toBe("ZZ");
    expect(event.region).toBe("Unspecified");
  });
});

describe("optional adapters", () => {
  it("uses configured approved ReliefWeb appname only as a query parameter and does not geocode metadata", async () => {
    vi.stubEnv("RELIEFWEB_APPNAME", "approved-app&next=http://localhost");
    const fetchMock = respondJson({ data: [{
      id: 123,
      fields: {
        title: "Humanitarian situation report",
        url: "https://reliefweb.int/report/japan/example",
        origin: "javascript:unsafe()",
        date: { original: REPORTED, created: "2026-09-13T11:00:00+00:00" },
        primary_country: { name: "Japan", iso3: "JPN", location: { lat: 36, lon: 138 } },
        source: [{ name: "Example aid organization", shortname: "Example aid" }],
      },
    }] });
    const result = await fetchProvider("reliefweb");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe("https://api.reliefweb.int");
    expect(url.pathname).toBe("/v2/reports");
    expect(url.searchParams.get("appname")).toBe("approved-app&next=http://localhost");
    expect(url.searchParams.has("next")).toBe(false);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).limit).toBe(50);
    expect(result.url).not.toContain("appname");
    expect(result.events[0].countryCode).toBe("JP");
    expect(result.events[0].latitude).toBeUndefined();
    expect(result.events[0].longitude).toBeUndefined();
    expect(result.events[0].firstReportedAt).toBe(REPORTED);
    expect(result.events[0].sources[0].name).toBe("Example aid (via ReliefWeb)");
    expect(result.events[0].sources[0].url).toBe("https://reliefweb.int/report/japan/example");
  });

  it("keeps GDELT source country separate from event location and labels observation time", async () => {
    vi.stubEnv("GDELT_ENABLED", "true");
    respondJson({ articles: [{
      title: "Flood evacuation announced",
      url: "https://news.example.org/story",
      domain: "news.example.org",
      seendate: "20260913T100000Z",
      sourcecountry: "United States",
    }] });
    const event = (await fetchProvider("gdelt")).events[0];
    expect(event.category).toBe("natural-disaster");
    expect(event.firstReportedAt).toBe(REPORTED);
    expect(event.latitude).toBeUndefined();
    expect(event.countryCode).toBe("ZZ");
    expect(event.timeline[0].title).toBe("Article first seen by GDELT");
    expect(event.summary).toContain("not when it was published or when the event occurred");
    expect(event.sources[0].name).toBe("news.example.org (via GDELT)");
    expect(event.sources[0].publisherCountry).toBe("United States");
    expect(event.sources[0].timestampBasis).toBe("observed");
    expect(event.detectedAt).toBe(NOW);
    expect(event.severity).toBeNull();
    expect(event.confidence).toBeNull();
  });

  it("does not collapse distinct long source URLs into the same event ID", async () => {
    vi.stubEnv("GDELT_ENABLED", "true");
    const prefix = `https://news.example.org/${"x".repeat(150)}`;
    respondJson({ articles: ["one", "two"].map((suffix) => ({
      title: `Headline ${suffix}`, url: `${prefix}/${suffix}`, seendate: "20260913T100000Z",
    })) });
    const result = await fetchProvider("gdelt");
    expect(result.events).toHaveLength(2);
    expect(result.events[0].id).not.toBe(result.events[1].id);
    expect(result.raw[0].providerId).not.toBe(result.raw[1].providerId);
  });

  it("uses only the fixed BBC feed and retains publisher attribution", async () => {
    vi.stubEnv("RSS_ENABLED", "true");
    vi.stubEnv("RSS_URL", "http://127.0.0.1/private");
    const fetchMock = respondXml(rss(`<item>
      <title>Election results reported</title>
      <link>https://www.bbc.com/news/articles/example</link>
      <guid>https://www.bbc.com/news/articles/example#0</guid>
      <pubDate>Sun, 13 Sep 2026 10:00:00 GMT</pubDate>
    </item>`));
    const result = await fetchProvider("bbc");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://feeds.bbci.co.uk/news/world/rss.xml");
    expect(result.events[0].category).toBe("political");
    expect(result.events[0].sources[0].name).toBe("BBC News");
    expect(result.events[0].latitude).toBeUndefined();
    expect(result.events[0].status).toBe("reported");
  });
});

describe("live publisher RSS normalization", () => {
  it.each<ProviderId>(["bbc", "dw", "unnews", "globalvoices"])("imports %s without accounts, seeded events, invented scores or inferred locations", async (id) => {
    const fetchMock = respondXml(rss(newsItem("<dc:creator>Reporter Name</dc:creator>")));
    const result = await fetchProvider(id);
    expect(String(fetchMock.mock.calls[0][0])).toBe(PROVIDERS.find((provider) => provider.id === id)!.url);
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.title).toBe("Election results reported");
    expect(event.firstReportedAt).toBe(REPORTED);
    expect(event.detectedAt).toBe(NOW);
    expect(event.isDemo).toBe(false);
    expect(event.reportKind).toBe("news");
    expect(event.status).toBe("reported");
    expect(event.severity).toBeNull();
    expect(event.confidence).toBeNull();
    expect(event.sources[0]).toMatchObject({
      providerId: id, isDemo: false, language: "en",
      url: "https://publisher.example.org/news/report",
      publishedAt: REPORTED, observedAt: NOW, timestampBasis: "published", byline: "Reporter Name",
    });
    expect(event.latitude).toBeUndefined();
    expect(event.longitude).toBeUndefined();
    expect(event.countryCode).toBe("ZZ");
    expect(event.relatedEvents).toEqual([]);
    expect(event.locationEvidence).toContain("Publisher country and headline place names are not used");
    expect(result.message).toContain("not independently verified");
    expect(result.raw).toHaveLength(1);
  });

  it("preserves a publisher's short description and never displays full article content or images", async () => {
    respondXml(rss(newsItem(`
      <dc:creator>Reporter Name</dc:creator>
      <content:encoded><![CDATA[<p>Full article must remain out of the display contract.</p><img src="https://images.example.org/photo.jpg" />]]></content:encoded>
      <media:content url="https://images.example.org/photo.jpg" />
    `)));
    const result = await fetchProvider("globalvoices");
    const event = result.events[0];
    expect(event.summary).toBe("The source says counting continues.");
    expect(JSON.stringify(event)).not.toContain("Full article must remain");
    expect(JSON.stringify(event)).not.toContain("images.example.org");
    expect(event.sources[0].name).toBe("Global Voices");
    expect(event.sources[0].byline).toBe("Reporter Name");
    expect(event.sources[0].licenseUrl).toBe("https://creativecommons.org/licenses/by/3.0/");
    expect(event.verificationNote).toContain("markup removed and length limited");
    expect(event.tags).toContain("publisher-feed-excerpt");
  });

  it("does not guess attribution for Global Voices records without an author", async () => {
    respondXml(rss(newsItem()));
    const result = await fetchProvider("globalvoices");
    expect(result.events).toEqual([]);
    expect(result.raw).toHaveLength(1);
    expect(result.message).toContain("1 incomplete records");
  });

  it("keeps DW restricted to its title-and-link grant, even when a feed includes text", async () => {
    respondXml(rss(newsItem("<dc:creator>DW reporter</dc:creator>")));
    const event = (await fetchProvider("dw")).events[0];
    expect(event.title).toBe("Election results reported");
    expect(event.sources[0].name).toBe("Deutsche Welle");
    expect(event.summary).toContain("Content from the Deutsche Welle");
    expect(event.summary).not.toContain("counting continues");
    expect(event.tags).toContain("headline-only");
  });

  it("parses the live DW RSS 1.0 structure, including multiple sibling items and dc:date", async () => {
    respondXml(`<?xml version="1.0" encoding="UTF-8"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel><title>DW World</title></channel>
        <item>
          <title>Publisher&apos;s &#8220;quoted&#8221; headline &#x2014; preserved</title>
          <link>https://www.dw.com/en/article/a-123?maca=world&amp;campaign=feed</link>
          <dc:date>2026-09-13T10:00:00Z</dc:date>
          <dc:subject>World</dc:subject>
          <dwsyn:contentID>123</dwsyn:contentID>
        </item>
        <item>
          <title>Second publisher report</title>
          <link>https://www.dw.com/en/article/a-124</link>
          <dc:date>2026-09-13T09:00:00Z</dc:date>
          <dwsyn:contentID>124</dwsyn:contentID>
        </item>
      </rdf:RDF>`);
    const result = await fetchProvider("dw");
    expect(result.events).toHaveLength(2);
    expect(result.events[0].title).toBe("Publisher's “quoted” headline — preserved");
    expect(result.events[0].id).toBe("dw:123");
    expect(result.events[0].firstReportedAt).toBe(REPORTED);
    expect(result.events[0].sources[0].url).toBe("https://www.dw.com/en/article/a-123?maca=world&campaign=feed");
    expect(result.events[1].id).toBe("dw:124");
    expect(result.events[0].tags).toContain("source-category:World");
  });

  it("parses a single RDF item without treating the channel as an event", async () => {
    respondXml(`<rdf:RDF><channel><title>World</title><dc:date>${NOW}</dc:date></channel>${newsItem().replace(
      "<pubDate>Sun, 13 Sep 2026 10:00:00 GMT</pubDate>", `<dc:date>${REPORTED}</dc:date>`,
    )}</rdf:RDF>`);
    const result = await fetchProvider("dw");
    expect(result.events).toHaveLength(1);
    expect(result.events[0].firstReportedAt).toBe(REPORTED);
  });

  it("decodes XML punctuation and double-encoded markup without allowing script content", async () => {
    respondXml(rss(newsItem("", {
      title: "&amp;lt;script&amp;gt;bad()&amp;lt;/script&amp;gt;&amp;lt;b&amp;gt;Publisher&amp;lt;/b&amp;gt;&apos;s &#x2014; &#8220;headline&#8221;",
    })));
    const event = (await fetchProvider("bbc")).events[0];
    expect(event.title).toBe("Publisher's — “headline”");
    expect(event.title).not.toContain("bad()");
    expect(event.title).not.toContain("<");
  });

  it.each([
    { extra: "<category>Opinion</category>", title: "A perspective on the election", expected: "analysis" },
    { extra: "<category>Analysis</category>", title: "Why a decision matters", expected: "analysis" },
    { extra: "<dc:subject>Commentary</dc:subject>", title: "A perspective on the election", expected: "analysis" },
    { extra: "", title: "Analysis: A publisher's labeled analysis", expected: "analysis" },
    { extra: "<category>World</category>", title: "Why might the election matter?", expected: "news" },
  ])("uses explicit publisher genre labels, not guessed bias: $title", async ({ extra, title, expected }) => {
    respondXml(rss(newsItem(extra, { title })));
    const event = (await fetchProvider("bbc")).events[0];
    expect(event.title).toBe(title);
    expect(event.reportKind).toBe(expected);
    expect(event.confidence).toBeNull();
    expect(event.severity).toBeNull();
    expect(event.tags.includes("source-labeled-analysis-or-opinion")).toBe(expected === "analysis");
  });

  it("retains publisher origin without treating it, country-like categories, or headline places as incident geography", async () => {
    respondXml(rss(newsItem("<category>Japan</category><country>United Kingdom</country>", {
      title: "Japan earthquake reported from Tokyo",
    })));
    const event = (await fetchProvider("bbc")).events[0];
    expect(event.category).toBe("natural-disaster");
    expect(event.severity).toBeNull();
    expect(event.sources[0].publisherCountry).toBe("United Kingdom");
    expect(event.country).toBe("Unspecified");
    expect(event.region).toBe("Unspecified");
    expect(event.countryCode).toBe("ZZ");
    expect(event.latitude).toBeUndefined();
    expect(event.longitude).toBeUndefined();
  });

  it("retains an explicitly supplied GeoRSS point with an accuracy explanation", async () => {
    respondXml(rss(newsItem("<georss:point>0 15.5</georss:point>")));
    const event = (await fetchProvider("unnews")).events[0];
    expect(event.latitude).toBe(0);
    expect(event.longitude).toBe(15.5);
    expect(event.locationAccuracy).toBe("approximate");
    expect(event.locationEvidence).toContain("explicitly supplied");
    expect(event.locationEvidence).toContain("not independently verified");
    expect(event.countryCode).toBe("ZZ");
  });

  it.each(["91 10", "10 181", "10", "10 20 30", "NaN 20"])("does not create a map point from invalid GeoRSS: %s", async (coordinates) => {
    respondXml(rss(newsItem(`<georss:point>${coordinates}</georss:point>`)));
    const event = (await fetchProvider("unnews")).events[0];
    expect(event.latitude).toBeUndefined();
    expect(event.longitude).toBeUndefined();
    expect(event.locationAccuracy).toBe("unknown");
  });

  it("keeps missing, invalid and future publication dates as raw only, ignoring channel dates", async () => {
    respondXml(rss([
      newsItem().replace(/<pubDate>.*?<\/pubDate>/, ""),
      newsItem("", { date: "invalid date" }),
      newsItem("", { date: "Mon, 14 Sep 2026 10:00:00 GMT" }),
      newsItem("", { date: "Sun, 13 Sep 2026 12:00:01 GMT" }),
    ].join("")).replace("<title>Source feed</title>", `<title>Source feed</title><pubDate>${NOW}</pubDate><lastBuildDate>${NOW}</lastBuildDate>`));
    const result = await fetchProvider("bbc");
    expect(result.events).toEqual([]);
    expect(result.raw).toHaveLength(4);
  });

  it.each([
    "2026-02-30T10:00:00Z",
    "Mon, 30 Feb 2026 10:00:00 GMT",
    "2026-09-13T24:00:00Z",
    "2026-09-13",
    "September 13, 2026",
    "0",
  ])("does not silently normalize impossible or imprecise source timestamps: %s", async (invalidDate) => {
    respondXml(rss(newsItem("", { date: invalidDate })));
    const result = await fetchProvider("bbc");
    expect(result.events).toEqual([]);
    expect(result.raw).toHaveLength(1);
  });

  it("accepts valid timezone offsets while retaining the actual instant", async () => {
    respondXml(rss(newsItem("", { date: "2026-09-13T11:30:00+01:30" })));
    const event = (await fetchProvider("bbc")).events[0];
    expect(event.firstReportedAt).toBe(REPORTED);
  });

  it("keeps empty titles and unsafe links as raw only without a fictional fallback", async () => {
    respondXml(rss([
      newsItem("", { title: "" }),
      newsItem("", { link: "javascript:alert(1)" }),
      newsItem("", { link: "file:///etc/passwd" }),
      newsItem("", { link: "https://user:password@publisher.example.org/report" }),
    ].join("")));
    const result = await fetchProvider("bbc");
    expect(result.events).toEqual([]);
    expect(result.raw).toHaveLength(4);
  });

  it("does not truncate a publisher's long headline into a changed claim", async () => {
    respondXml(rss(newsItem("", { title: `${"Unconfirmed report ".repeat(20)}— the publisher says the claim is false` })));
    const result = await fetchProvider("dw");
    expect(result.events).toEqual([]);
    expect(result.raw).toHaveLength(1);
  });

  it("returns an honestly empty provider result, not seeded news", async () => {
    respondXml(rss(""));
    const result = await fetchProvider("unnews");
    expect(result.events).toEqual([]);
    expect(result.raw).toEqual([]);
    expect(result.message).toContain("0 source reports imported");
  });

  it("fails unsupported XML structures and DTDs without falling back to invented reports", async () => {
    respondXml("<rdf:RDF><item><title>Missing channel</title></item></rdf:RDF>");
    await expect(fetchProvider("dw")).rejects.toThrow("invalid or unsupported RSS");
    respondXml('<!DOCTYPE rss [<!ENTITY x "repeated">]><rss><channel><title>&x;</title></channel></rss>');
    await expect(fetchProvider("bbc")).rejects.toThrow("invalid or unsupported XML");
  });

  it.each<ProviderId>(["france24", "aljazeera"])("uses %s only after specific operator opt-in", async (id) => {
    const variable = id === "france24" ? "FRANCE24_ENABLED" : "ALJAZEERA_ENABLED";
    const fetchMock = respondXml(rss(newsItem("<dc:creator>Publisher byline</dc:creator>")));
    await expect(fetchProvider(id)).rejects.toThrow("Optional source");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv(variable, "true");
    const result = await fetchProvider(id);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].sources[0].providerId).toBe(id);
    expect(String(fetchMock.mock.calls[0][0])).toBe(PROVIDERS.find((provider) => provider.id === id)!.url);
  });
});
