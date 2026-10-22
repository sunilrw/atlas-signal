import assert from "node:assert/strict";

const base = new URL(process.env.ATLAS_BASE_URL ?? "http://127.0.0.1:4011");
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
  throw new Error("ATLAS_BASE_URL must be an HTTP(S) application origin without credentials.");
}
const request = async (pathname) => {
  const response = await fetch(new URL(pathname, base), { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  const data = await response.json();
  return { response, data };
};

const { response, data } = await request("/api/events");
assert.equal(response.status, 200, "The event service must respond successfully.");
assert.equal(data.mode, "live", "The default must be live-only.");
assert.ok(data.events.length > 0, "No live reports are available; inspect provider status.");
assert.equal(data.total, data.events.length);
const cutoff = Date.parse(data.referenceTime);
assert.ok(Number.isFinite(cutoff) && cutoff <= Date.now() + 300_000);
for (const event of data.events) {
  assert.equal(event.isDemo, false, "A synthetic flag entered the response.");
  assert.ok(!/^(demo|sample|fixture)[-:]/i.test(event.id), "A retired identifier entered the response.");
  assert.equal(event.confidence, null, "No independent-verification score should be invented.");
  assert.ok(Date.parse(event.lastUpdatedAt) <= cutoff, "A report has a future timestamp.");
  assert.ok(event.sources.length > 0, "Every report needs source provenance.");
  for (const source of event.sources) {
    const url = new URL(source.url);
    assert.ok(["http:", "https:"].includes(url.protocol) && !url.username && !url.password);
    assert.ok(source.name && source.isDemo !== true);
    assert.ok(Date.parse(source.publishedAt) <= cutoff);
  }
  if (event.severity !== null) {
    assert.equal(event.category, "natural-disaster");
    assert.ok(event.severityReason, "Derived hazard severity needs an explicit basis.");
  }
}
const news = data.events.filter((event) => event.reportKind === "news" || event.reportKind === "analysis");
assert.ok(news.length > 0, "Disaster-only coverage is insufficient for the default live news configuration.");
assert.ok(news.every((event) => event.severity === null));

const reportLink = await request(`/api/events/${encodeURIComponent(news[0].id)}`);
assert.equal(reportLink.response.status, 200, "A live report identifier must resolve through its encoded API link.");
assert.equal(reportLink.data.event?.id, news[0].id, "The report link must preserve the exact source identifier.");
assert.equal(reportLink.data.event?.confidence, null);

const retiredMode = await request("/api/events?mode=demo");
assert.equal(retiredMode.response.status, 400, "The retired mode must not return records.");
const retiredEvent = await request("/api/events/demo-kharkiv-response");
assert.equal(retiredEvent.response.status, 410, "The retired record must not return a fictional payload.");
const conflicts = await request("/api/conflicts");
assert.deepEqual(conflicts.data.conflicts, [], "No fabricated conflict assessment should be provided.");

console.log(JSON.stringify({
  result: "passed",
  checkedAt: new Date().toISOString(),
  totalReports: data.events.length,
  newsAndAnalysisReports: news.length,
  sourceStatus: data.sources.map(({ id, status, eventCount }) => ({ id, status, records: eventCount })),
  checks: ["live default", "original source links", "live report API link", "no synthetic records", "no invented confidence",
    "unknown news impact preserved", "no future report timestamps", "retired mode rejected",
    "retired event removed", "no fabricated conflict catalog"]
}, null, 2));
