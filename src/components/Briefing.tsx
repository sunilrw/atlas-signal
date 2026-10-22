"use client";

import { ArrowUpRight, CircleHelp, Radio } from "lucide-react";
import { CATEGORY_META, REGIONS } from "@/lib/catalog";
import { formatUtcDate, getEventStats, relativeTime } from "@/lib/event-utils";
import { isLiveReport, reportKindLabel, reportLocation, reportPublisher, reportSeverity } from "@/components/events/report-display";
import type { AtlasEvent, DataMode } from "@/types";

export function Briefing({ events, referenceTime, onSelectEvent }: { events: AtlasEvent[]; mode: DataMode; referenceTime: string; onSelectEvent: (event: AtlasEvent) => void }) {
  const liveEvents = events.filter(isLiveReport);
  const stats = getEventStats(liveEvents);
  const assessed = liveEvents.filter((event) => event.severity !== null).length;
  const latest = [...liveEvents]
    .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || a.id.localeCompare(b.id))
    .slice(0, 6);

  return <section className="briefing-view" aria-label="Global briefing">
    <div className="view-heading">
      <span className="eyebrow">SOURCE REPORTS</span>
      <h1>Global briefing<span>.</span></h1>
      <p>{formatUtcDate(referenceTime)} · Latest available reports in this view, with publisher attribution.</p>
    </div>
    <div className="briefing-metrics">
      <div><span>Available reports</span><strong>{stats.total}</strong></div>
      <div><span>Severity assessed</span><strong>{assessed}</strong></div>
      <div><span>Severity unassessed</span><strong>{liveEvents.length - assessed}</strong></div>
      <div><span>Countries reported</span><strong>{stats.countries}</strong></div>
    </div>
    <div className="briefing-content">
      <div>
        <div className="section-heading"><h2>Latest reports</h2><Radio size={16} /></div>
        <div className="briefing-events">{latest.map((event, index) => <button key={event.id} onClick={() => onSelectEvent(event)}>
          <span className="briefing-rank">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <span className="eyebrow">{reportLocation(event)} / {CATEGORY_META[event.category].label}</span>
            <h3>{event.title}</h3>
            <p>{event.summary}</p>
            <span className="briefing-meta">{reportPublisher(event)} · {reportKindLabel(event)} · Updated {relativeTime(event.lastUpdatedAt, referenceTime)} · <span title={event.severityReason}>Severity: {reportSeverity(event).label}</span></span>
            {event.severity !== null && event.severityReason && <div className="briefing-meta">Severity basis: {event.severityReason}</div>}
          </div>
          <ArrowUpRight size={16} />
        </button>)}</div>
        {!latest.length && <p className="empty-copy">No reports match this view. Try a wider time range or fewer filters.</p>}
      </div>
      <aside>
        <h2>Regional coverage</h2>
        <p className="muted">Report counts, not a measure of risk.</p>
        <div className="region-chart">{REGIONS.filter((region) => region !== "All regions").map((region) => {
          const count = liveEvents.filter((event) => event.region === region).length;
          return <div key={region}><span>{region}<strong>{count}</strong></span><div><i style={{ width: `${liveEvents.length ? (count / liveEvents.length) * 100 : 0}%` }} /></div></div>;
        })}</div>
        <div className="analysis-note">
          <CircleHelp size={18} />
          <h3>Coverage is not certainty.</h3>
          <p>Available sources do not capture every event. Publisher wording and perspectives may differ; inclusion is not independent verification or an endorsement. Severity is unassessed unless a disclosed source or hazard measure supports it.</p>
        </div>
      </aside>
    </div>
  </section>;
}
