"use client";

import { useMemo, type CSSProperties } from "react";
import { ArrowUpRight, CalendarDays, Clock3, MapPin } from "lucide-react";
import { CATEGORY_META } from "@/lib/catalog";
import { formatUtcDate, formatUtcTime } from "@/lib/event-utils";
import type { AtlasEvent } from "@/types";
import { hasReportCoordinates, isLiveReport, reportKindLabel, reportLocation, reportPublisher, reportSeverity, reportTimestampLabel } from "./report-display";
import styles from "./TimelineView.module.css";

export interface TimelineViewProps {
  events: AtlasEvent[];
  referenceTime: string;
  onSelectEvent: (event: AtlasEvent) => void;
}

interface DayGroup {
  key: string;
  label: string;
  events: AtlasEvent[];
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function groupByDay(events: AtlasEvent[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  const sorted = [...events].sort(
    (a, b) =>
      timestamp(b.firstReportedAt) - timestamp(a.firstReportedAt) ||
      a.id.localeCompare(b.id),
  );

  for (const event of sorted) {
    const reportedAt = timestamp(event.firstReportedAt);
    const key = Number.isFinite(reportedAt)
      ? new Date(reportedAt).toISOString().slice(0, 10)
      : "unknown";
    const group = groups.get(key);

    if (group) {
      group.events.push(event);
    } else {
      groups.set(key, {
        key,
        label:
          key === "unknown"
            ? "Reporting date unavailable"
            : formatUtcDate(event.firstReportedAt),
        events: [event],
      });
    }
  }

  return [...groups.values()];
}

export function TimelineView({
  events,
  referenceTime,
  onSelectEvent,
}: TimelineViewProps) {
  const liveEvents = useMemo(() => events.filter(isLiveReport), [events]);
  const groups = useMemo(() => groupByDay(liveEvents), [liveEvents]);

  return (
    <section className={styles.view} aria-labelledby="event-timeline-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>A different perspective</p>
          <h2 id="event-timeline-heading">Report timeline</h2>
          <p className={styles.description}>
            Source timestamps, newest first. Publication, observation, and reported occurrence times are labeled separately. All times UTC.
          </p>
        </div>
        <div className={styles.reference}>
          <span>Reference time</span>
          <strong>{formatUtcDate(referenceTime)}</strong>
          <span>{formatUtcTime(referenceTime)}</span>
        </div>
      </header>

      <div className={styles.context}>
        <span className={styles.resultCount}>
          <span className={styles.count}>{liveEvents.length}</span>{" "}
          {liveEvents.length === 1 ? "report" : "reports"} in your selection
        </span>
      </div>

      {liveEvents.length === 0 ? (
        <div className={styles.empty} role="status">
          <span className={styles.emptyIcon}>
            <Clock3 size={23} strokeWidth={1.35} aria-hidden="true" />
          </span>
          <h3>No reports in this view</h3>
          <p>
            Adjust the time range, region, or filters to see matching reports. Source coverage can be incomplete.
          </p>
        </div>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section
              className={styles.day}
              key={group.key}
              aria-labelledby={`timeline-day-${group.key}`}
            >
              <div className={styles.dayHeading}>
                <CalendarDays size={13} aria-hidden="true" />
                <h3 id={`timeline-day-${group.key}`}>{group.label}</h3>
                <span className={styles.dayRule} />
                <span className={styles.dayCount}>
                  {group.events.length}{" "}
                  {group.events.length === 1 ? "report" : "reports"}
                </span>
              </div>
              <ol className={styles.events}>
                {group.events.map((event) => {
                  const severity = reportSeverity(event);
                  const category = CATEGORY_META[event.category];
                  const hasCoordinates = hasReportCoordinates(event);

                  return (
                    <li className={styles.event} key={event.id}>
                      <div className={styles.time}>
                        <span className={styles.timeBasis}>{reportTimestampLabel(event)}</span>
                        {Number.isFinite(timestamp(event.firstReportedAt)) ? (
                          <time dateTime={event.firstReportedAt}>
                            {formatUtcTime(event.firstReportedAt)}
                          </time>
                        ) : (
                          <span>Time unknown</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className={styles.card}
                        onClick={() => onSelectEvent(event)}
                        aria-label={`Open ${reportKindLabel(event).toLowerCase()}: ${event.title}, ${reportPublisher(event)}`}
                      >
                        <span className={styles.cardMeta}>
                          <span
                            className={styles.category}
                            style={{ "--signal-color": category.color } as CSSProperties}
                          >
                            {category.label}
                          </span>
                          <span
                            className={styles.severity}
                            style={{ "--signal-color": severity.color } as CSSProperties}
                            title={event.severityReason || "Severity has not been assessed"}
                          >
                            <span className={styles.severityDot} />
                            {severity.label}{event.severity !== null && <> · {event.severity}/7</>}
                          </span>
                          <ArrowUpRight
                            className={styles.openIcon}
                            size={15}
                            aria-hidden="true"
                          />
                        </span>
                        <span className={styles.title}>{event.title}</span>
                        <span className={styles.publisher}>{reportPublisher(event)} · {reportKindLabel(event)}</span>
                        <span className={styles.summary}>{event.summary}</span>
                        <span className={styles.cardFooter}>
                          <span className={styles.location}>
                            <MapPin size={11} aria-hidden="true" />
                            {reportLocation(event)}
                            {!hasCoordinates && (
                              <span className={styles.unmapped}>Unmapped</span>
                            )}
                          </span>
                          <span className={styles.sources}>
                            {event.sources.length}{" "}
                            {event.sources.length === 1 ? "source" : "sources"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          <p className={styles.methodology}>
            This timeline contains source reports, not reconstructed incident history. Missing severity remains unassessed; any derived severity is explained in report details.
          </p>
          <p className={styles.endNote}>
            <span />
            End of your selection
            <span />
          </p>
        </div>
      )}
    </section>
  );
}
