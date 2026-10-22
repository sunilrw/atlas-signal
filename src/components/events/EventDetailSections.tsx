"use client";

import type { CSSProperties } from "react";
import { ArrowUpRight, ChevronRight, Clock3, FileText, Link2, MapPin, ShieldAlert } from "lucide-react";
import { CATEGORY_META } from "@/lib/catalog";
import { formatUtcDate, formatUtcTime } from "@/lib/event-utils";
import type { AtlasEvent, LocationAccuracy } from "@/types";
import { hasReportCoordinates, httpSourceUrl, isLiveReport, reportKindLabel, reportPublisher, reportSeverity, reportTimestampLabel, sourceTimestampLabel } from "./report-display";
import styles from "./EventDetail.module.css";

const ACCURACY_LABELS: Record<LocationAccuracy, string> = {
  exact: "Source-reported coordinates",
  city: "City-level location",
  region: "Region-level location",
  country: "Country-level location",
  approximate: "Approximate location",
  unknown: "Location accuracy unknown",
};

const SOURCE_TYPES = {
  primary: "Primary source",
  news: "News organization",
  ngo: "Non-governmental organization",
  dataset: "Data provider",
};

function formattedCoordinates(event: AtlasEvent): string | null {
  if (!hasReportCoordinates(event) || event.latitude === undefined || event.longitude === undefined) return null;
  return `${Math.abs(event.latitude).toFixed(2)}° ${event.latitude < 0 ? "S" : "N"}  ·  ${Math.abs(event.longitude).toFixed(2)}° ${event.longitude < 0 ? "W" : "E"}`;
}

function UnavailableReport() {
  return <div className={styles.tabEmpty} role="status"><p>This report is unavailable. Only source-backed live reports are shown.</p></div>;
}

export function EventOverview({
  event,
  allEvents,
  onSelectEvent,
}: {
  event: AtlasEvent;
  allEvents: AtlasEvent[];
  onSelectEvent: (event: AtlasEvent) => void;
}) {
  if (!isLiveReport(event)) return <UnavailableReport />;
  const severity = reportSeverity(event);
  const validSeverity = event.severity !== null && Number.isInteger(event.severity) && event.severity >= 1 && event.severity <= 7;
  const validConfidence = typeof event.confidence === "number" && Number.isFinite(event.confidence) && event.confidence >= 0 && event.confidence <= 100;
  const coordinates = formattedCoordinates(event);
  const related = event.relatedEvents
    .map((eventId) => allEvents.find((item) => item.id === eventId))
    .filter((item): item is AtlasEvent => item !== undefined && item.id !== event.id && isLiveReport(item))
    .slice(0, 3);

  return (
    <>
      <section className={styles.section}>
        <h3>Report summary</h3>
        <p className={styles.tabIntro}>{reportPublisher(event)} · {reportKindLabel(event)}</p>
        <p className={styles.summary}>{event.summary || "The source has not provided a summary."}</p>
      </section>

      <section className={styles.section}>
        <h3>Assessment &amp; verification</h3>
        <div className={styles.assessments}>
          <div className={styles.assessment}>
            <span className={styles.assessmentLabel}>{validSeverity ? "Derived severity" : "Severity"}</span>
            <strong className={styles.assessmentSeverity} style={{ "--signal-color": severity.color } as CSSProperties}>{severity.label}{validSeverity && <small>{event.severity}/7</small>}</strong>
            {validSeverity && event.severity !== null && (
              <div className={styles.severityMeter} role="meter" aria-label="Derived severity" aria-valuemin={1} aria-valuemax={7} aria-valuenow={event.severity} aria-valuetext={`${severity.label}, ${event.severity} out of 7`}>
                {Array.from({ length: 7 }, (_, index) => (
                  <span key={index} style={index < (event.severity ?? 0) ? { background: severity.color } : undefined} />
                ))}
              </div>
            )}
          </div>
          <div className={styles.assessment}>
            <span className={styles.assessmentLabel}>{validConfidence ? "Recorded confidence" : "Verification"}</span>
            <strong className={styles.verificationStatus}>{validConfidence ? `${event.confidence}/100` : "Not independently verified"}</strong>
            {validConfidence && <p className={styles.assessmentNote}>A recorded score is not a verified probability.</p>}
          </div>
        </div>
        <p className={styles.assessmentNote}>
          {validSeverity
            ? event.severityReason || "The source does not provide an assessment method. This severity value is not independently verified."
            : "Severity has not been assessed. Missing assessment does not imply a minor event."}
        </p>
        <p className={styles.assessmentNote}>{event.verificationNote || "Source-reported information, not independent verification. Read the original reporting for context."}</p>
      </section>

      <section className={styles.section}>
        <h3>Report information</h3>
        <dl className={styles.metadata}>
          <div>
            <dt><Clock3 size={12} aria-hidden="true" />{reportTimestampLabel(event)}</dt>
            <dd>{formatUtcDate(event.firstReportedAt)}<span>{formatUtcTime(event.firstReportedAt)}</span></dd>
          </div>
          <div>
            <dt><Clock3 size={12} aria-hidden="true" />Latest source timestamp</dt>
            <dd>{formatUtcDate(event.lastUpdatedAt)}<span>{formatUtcTime(event.lastUpdatedAt)}</span></dd>
          </div>
          <div>
            <dt><Link2 size={12} aria-hidden="true" />Sources</dt>
            <dd>{event.sources.length} linked source{event.sources.length === 1 ? "" : "s"}</dd>
          </div>
          <div>
            <dt><MapPin size={12} aria-hidden="true" />Region</dt>
            <dd>{event.region || "Not provided"}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.section}>
        <h3>Location precision</h3>
        <div className={styles.locationDetails}>
          <MapPin size={17} strokeWidth={1.4} aria-hidden="true" />
          <div>
            <strong>{coordinates ? ACCURACY_LABELS[event.locationAccuracy] : "No coordinates provided"}</strong>
            {coordinates && <span className={styles.coordinates}>{coordinates}</span>}
          </div>
        </div>
        <p className={styles.assessmentNote}>
          {!coordinates
            ? "This report is not placed on the map. Missing coordinates have not been inferred."
            : event.locationAccuracy === "exact"
              ? "A source-reported position does not imply independent verification."
              : "The map position is approximate and should not be read as a verified incident site."}
        </p>
        {event.locationEvidence && <p className={styles.assessmentNote}>{event.locationEvidence}</p>}
      </section>

      {event.contradictions && event.contradictions.length > 0 && (
        <section className={styles.uncertainty}>
          <h3><ShieldAlert size={14} aria-hidden="true" />Uncertainty &amp; contradictions</h3>
          <ul>{event.contradictions.map((contradiction, index) => <li key={index}>{contradiction}</li>)}</ul>
        </section>
      )}

      {related.length > 0 && (
        <section className={styles.section}>
          <h3>Contextual reports<span>{related.length}</span></h3>
          <p className={styles.tabIntro}>Contextual links are not evidence of the same incident or independent corroboration.</p>
          <div className={styles.relatedEvents}>
            {related.map((item) => (
              <button key={item.id} type="button" onClick={() => onSelectEvent(item)}>
                <span className={styles.relatedDot} style={{ background: reportSeverity(item).color }} aria-hidden="true" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{CATEGORY_META[item.category].shortLabel} · {reportPublisher(item)}</small>
                </span>
                <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      {event.tags.length > 0 && (
        <div className={styles.tags} role="group" aria-label="Event tags">
          {event.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}
    </>
  );
}

export function EventUpdateTimeline({ event }: { event: AtlasEvent }) {
  if (!isLiveReport(event)) return <UnavailableReport />;
  const updates = [...event.timeline].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return (
    <section className={styles.section}>
      <h3>Source chronology<span>{updates.length} records</span></h3>
      <p className={styles.tabIntro}>Source publication and reported update times, most recent first. These records are not a reconstructed incident history. All times UTC.</p>
      {updates.length === 0 ? (
        <div className={styles.tabEmpty}><Clock3 size={25} strokeWidth={1.3} aria-hidden="true" /><p>No updates have been recorded for this event.</p></div>
      ) : (
        <ol className={styles.updateTimeline}>
          {updates.map((update, index) => (
            <li key={update.id}>
              <span className={`${styles.updateDot} ${index === 0 ? styles.latestDot : ""}`} aria-hidden="true" />
              <time dateTime={update.timestamp}>{formatUtcDate(update.timestamp)}<span>·</span>{formatUtcTime(update.timestamp)}</time>
              <h4>{update.title}</h4>
              {update.description && <p>{update.description}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function EventSources({ event }: { event: AtlasEvent }) {
  if (!isLiveReport(event)) return <UnavailableReport />;
  return (
    <section className={styles.section}>
      <h3>Original sources<span>{event.sources.length}</span></h3>
      <p className={styles.tabIntro}>
        Read the original reporting to assess context and reliability. Multiple links do not necessarily mean independent corroboration.
      </p>
      {event.sources.length === 0 ? (
        <div className={styles.tabEmpty}><FileText size={25} strokeWidth={1.3} aria-hidden="true" /><p>No source links are available. Treat the information as unverified.</p></div>
      ) : (
        <ul className={styles.sourceList}>
          {event.sources.map((source) => {
            const url = httpSourceUrl(source.url);
            const publisherUrl = source.publisherUrl ? httpSourceUrl(source.publisherUrl) : null;
            const licenseUrl = source.licenseUrl ? httpSourceUrl(source.licenseUrl) : null;
            const contents = (
              <>
                <span className={styles.sourceIcon}><FileText size={15} strokeWidth={1.4} aria-hidden="true" /></span>
                <span className={styles.sourceText}>
                  <strong>{source.name}</strong>
                  <span>{url ? url.hostname.replace(/^www\./, "") : "Source link unavailable"}</span>
                  <small>{SOURCE_TYPES[source.type]}</small>
                  {source.byline && <small>By {source.byline}</small>}
                  {source.publisherCountry && <small>Publisher country: {source.publisherCountry}</small>}
                  {source.language && <small>Language: {source.language}</small>}
                  <time dateTime={source.publishedAt}>{sourceTimestampLabel(source)} {formatUtcDate(source.publishedAt)} · {formatUtcTime(source.publishedAt)}</time>
                  {source.observedAt && source.timestampBasis !== "observed" && (
                    <time dateTime={source.observedAt}>Indexed / observed {formatUtcDate(source.observedAt)} · {formatUtcTime(source.observedAt)}</time>
                  )}
                </span>
                {url && <ArrowUpRight size={15} strokeWidth={1.5} className={styles.externalIcon} aria-hidden="true" />}
              </>
            );
            return (
              <li key={source.id}>
                {url ? (
                  <a href={url.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${source.name} source in a new tab`}>{contents}</a>
                ) : (
                  <div className={styles.invalidSource}>{contents}</div>
                )}
                {publisherUrl && (
                  <div className={styles.publisherAttribution}>
                    Content from{" "}
                    <a href={publisherUrl.href} target="_blank" rel="noopener noreferrer" aria-label={`${source.name} publisher homepage, opens in a new tab`}>
                      {source.name} <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                  </div>
                )}
                {licenseUrl && (
                  <a className={styles.sourceLicense} href={licenseUrl.href} target="_blank" rel="noopener noreferrer">
                    Source license / reuse terms <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
