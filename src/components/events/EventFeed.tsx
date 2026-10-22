"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ArrowDownWideNarrow, ChevronDown, Link2, LoaderCircle, MapPin, SearchX } from "lucide-react";
import { CATEGORY_META } from "@/lib/catalog";
import { formatUtcDate, relativeTime } from "@/lib/event-utils";
import type { AtlasEvent, DataMode } from "@/types";
import { hasReportCoordinates, isLiveReport, reportKindLabel, reportLocation, reportPublisher, reportSeverity } from "./report-display";
import styles from "./EventFeed.module.css";

export interface EventFeedProps {
  events: AtlasEvent[];
  selectedEventId: string | null;
  onSelectEvent: (event: AtlasEvent) => void;
  referenceTime: string;
  mode: DataMode;
  isLoading?: boolean;
  onClearFilters?: () => void;
}

type SortOrder = "latest" | "severity";

function groupLabel(timestamp: string, referenceTime: string): string {
  const date = new Date(timestamp);
  const reference = new Date(referenceTime);
  if (!Number.isFinite(date.getTime())) return "Undated";
  if (Number.isFinite(reference.getTime())) {
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const referenceDay = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
    if (day === referenceDay) return "Today";
    if (referenceDay - day === 86_400_000) return "Yesterday";
  }
  return formatUtcDate(timestamp);
}

function EventRow({
  event,
  selected,
  referenceTime,
  onSelect,
}: {
  event: AtlasEvent;
  selected: boolean;
  referenceTime: string;
  onSelect: () => void;
}) {
  const category = CATEGORY_META[event.category];
  const severity = reportSeverity(event);
  const sourceCount = event.sources.length;
  const location = reportLocation(event);
  const publisher = reportPublisher(event);

  return (
    <button
      type="button"
      className={`${styles.event} ${selected ? styles.selected : ""}`}
      style={{ "--event-color": severity.color } as CSSProperties}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${event.title}, ${publisher}, ${reportKindLabel(event)}, ${severity.label} severity, ${location}`}
    >
      <span className={styles.eventTop}>
        <span className={styles.category}>
          <span className={styles.severityDot} aria-hidden="true" />
          {category.shortLabel || category.label}
        </span>
        <time dateTime={event.lastUpdatedAt} title={`${event.lastUpdatedAt} (UTC)`}>
          {relativeTime(event.lastUpdatedAt, referenceTime)}
        </time>
      </span>
      <span className={styles.headline}>{event.title}</span>
      <span className={styles.publisher} title={publisher}>
        {publisher} <span aria-hidden="true">·</span> {reportKindLabel(event)}
      </span>
      <span className={styles.location}>
        <MapPin size={11} strokeWidth={1.6} aria-hidden="true" />
        <span>{location}</span>
        {!hasReportCoordinates(event) && <span className={styles.unmapped}>Unmapped</span>}
      </span>
      <span className={styles.eventBottom}>
        <span className={styles.sourceCount}>
          <Link2 size={11} strokeWidth={1.5} aria-hidden="true" />
          {sourceCount} source{sourceCount === 1 ? "" : "s"}
        </span>
        <span className={styles.dividerDot} aria-hidden="true">·</span>
        <span className={styles.severityLabel} title={event.severityReason || "Severity has not been assessed"}>{severity.label}</span>
        {selected && <span className={styles.viewing}>Viewing</span>}
      </span>
    </button>
  );
}

export function EventFeed({
  events,
  selectedEventId,
  onSelectEvent,
  referenceTime,
  isLoading = false,
  onClearFilters,
}: EventFeedProps) {
  const [sortOrder, setSortOrder] = useState<SortOrder>("latest");
  const liveEvents = useMemo(() => events.filter(isLiveReport), [events]);
  const groups = useMemo(() => {
    const sorted = [...liveEvents].sort((a, b) => {
      if (sortOrder === "severity" && a.severity !== b.severity) return (b.severity ?? -1) - (a.severity ?? -1);
      return Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt);
    });
    if (sortOrder === "severity") return [{ label: "Assessed severity first · unassessed last", events: sorted }];
    const grouped = new Map<string, AtlasEvent[]>();
    for (const event of sorted) {
      const label = groupLabel(event.lastUpdatedAt, referenceTime);
      const group = grouped.get(label) ?? [];
      group.push(event);
      grouped.set(label, group);
    }
    return Array.from(grouped, ([label, groupedEvents]) => ({ label, events: groupedEvents }));
  }, [liveEvents, referenceTime, sortOrder]);

  return (
    <section className={styles.feed} aria-labelledby="event-feed-heading" aria-busy={isLoading}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 id="event-feed-heading">Event feed</h2>
          <span className={styles.count} aria-label={`${liveEvents.length} ${liveEvents.length === 1 ? "report" : "reports"}`}>{liveEvents.length}</span>
          {isLoading && <LoaderCircle className={styles.spinner} size={14} aria-label="Refreshing events" />}
        </div>
        <div className={styles.controls}>
          <span className={styles.feedSubtitle}>LIVE REPORTS</span>
          <label className={styles.sortControl}>
            <ArrowDownWideNarrow size={12} aria-hidden="true" />
            <span className={styles.srOnly}>Sort events</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}>
              <option value="latest">Latest first</option>
              <option value="severity">Severity</option>
            </select>
            <ChevronDown size={10} aria-hidden="true" />
          </label>
        </div>
      </div>

      <div className={styles.scrollArea}>
        {isLoading && liveEvents.length === 0 ? (
          <div className={styles.skeletons} role="status" aria-label="Loading event feed">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className={styles.skeleton} aria-hidden="true">
                <span /><span /><span /><span />
              </div>
            ))}
          </div>
        ) : liveEvents.length === 0 ? (
          <div className={styles.empty}>
            <SearchX size={29} strokeWidth={1.2} aria-hidden="true" />
            <h3>No matching events</h3>
            <p>Try a wider time range or adjust your filters. Source coverage can be incomplete.</p>
            {onClearFilters && <button type="button" onClick={onClearFilters}>Clear filters</button>}
          </div>
        ) : (
          groups.map((group) => (
            <div className={styles.group} key={group.label}>
              <div className={styles.groupHeading}>
                <h3>{group.label}</h3>
                <span>{group.events.length} {group.events.length === 1 ? "report" : "reports"} <span aria-hidden="true">·</span> UTC</span>
              </div>
              <div className={styles.rows}>
                {group.events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    selected={selectedEventId === event.id}
                    referenceTime={referenceTime}
                    onSelect={() => onSelectEvent(event)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div className={styles.footer}>
        <span className={styles.footerDot} aria-hidden="true" />
        Source reports, not independent verification. Updates may be delayed.
      </div>
    </section>
  );
}

export default EventFeed;
