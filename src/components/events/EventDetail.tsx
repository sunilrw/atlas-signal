"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { Bookmark, Check, Copy, Info, MapPin, X } from "lucide-react";
import { CATEGORY_META } from "@/lib/catalog";
import { relativeTime } from "@/lib/event-utils";
import type { AtlasEvent } from "@/types";
import { EventOverview, EventSources, EventUpdateTimeline } from "./EventDetailSections";
import { isLiveReport, reportKindLabel, reportLocation, reportPublisher, reportSeverity } from "./report-display";
import styles from "./EventDetail.module.css";

export interface EventDetailProps {
  event: AtlasEvent;
  onClose: () => void;
  onSelectEvent: (event: AtlasEvent) => void;
  allEvents: AtlasEvent[];
  referenceTime: string;
  isSaved: boolean;
  onToggleSave: () => void;
}

type DetailTab = "overview" | "timeline" | "sources";
const TABS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "sources", label: "Sources" },
];

export function EventDetail(props: EventDetailProps) {
  if (!isLiveReport(props.event)) {
    return (
      <section className={styles.detail} aria-label="Report unavailable">
        <div className={styles.toolbar}>
          <span>REPORT UNAVAILABLE</span>
          <button type="button" className={styles.iconButton} onClick={props.onClose} aria-label="Close event details">
            <X size={17} strokeWidth={1.5} />
          </button>
        </div>
        <div className={styles.tabEmpty} role="status">
          <Info size={22} aria-hidden="true" />
          <p>This report is unavailable. Only source-backed live reports are shown.</p>
        </div>
      </section>
    );
  }
  return <EventDetailContent key={props.event.id} {...props} />;
}

function EventDetailContent({
  event,
  onClose,
  onSelectEvent,
  allEvents,
  referenceTime,
  isSaved,
  onToggleSave,
}: EventDetailProps) {
  const id = useId();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "error">("idle");
  const [shareUrl, setShareUrl] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const category = CATEGORY_META[event.category];
  const severity = reportSeverity(event);
  const permalink = `/event/${encodeURIComponent(event.id)}`;

  async function copyLink() {
    const url = new URL(permalink, window.location.origin).href;
    setShareUrl(url);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
    } catch {
      setShareStatus("error");
    }
  }

  function moveTab(index: number, key: string) {
    let nextIndex: number;
    if (key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (key === "Home") nextIndex = 0;
    else if (key === "End") nextIndex = TABS.length - 1;
    else return false;
    setTab(TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
    return true;
  }

  return (
    <section
      className={styles.detail}
      aria-labelledby={`${id}-title`}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === "Escape") {
          keyboardEvent.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.toolbar}>
        <span>REPORT DETAILS</span>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.iconButton} ${isSaved ? styles.saved : ""}`}
            onClick={onToggleSave}
            aria-pressed={isSaved}
            aria-label={isSaved ? "Remove event from watchlist" : "Save event to watchlist"}
            title={isSaved ? "Remove from watchlist" : "Save to watchlist"}
          >
            <Bookmark size={15} strokeWidth={1.5} fill={isSaved ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={copyLink}
            aria-label="Copy event link"
            title="Copy event link"
          >
            {shareStatus === "copied" ? <Check size={15} strokeWidth={1.5} /> : <Copy size={15} strokeWidth={1.5} />}
          </button>
          <span className={styles.actionDivider} aria-hidden="true" />
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close event details" title="Close details">
            <X size={17} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {shareStatus !== "idle" && (
        <div className={styles.shareMessage} role="status">
          {shareStatus === "copied" ? "Event link copied." : (
            <>
              <span>Clipboard unavailable. Select and copy this link:</span>
              <input aria-label="Event share link" readOnly value={shareUrl} onFocus={(focusEvent) => focusEvent.target.select()} />
            </>
          )}
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.hero}>
          <div className={styles.heroMeta}>
            <span className={styles.category} style={{ "--signal-color": category.color } as CSSProperties}>{category.label}</span>
            <span className={styles.severityPill} style={{ "--signal-color": severity.color } as CSSProperties} title={event.severityReason || "Severity has not been assessed"}>
              <span aria-hidden="true" />
              {severity.label}
            </span>
          </div>
          <h2 id={`${id}-title`}>{event.title}</h2>
          <p className={styles.publisher}>{reportPublisher(event)} <span aria-hidden="true">·</span> {reportKindLabel(event)}</p>
          <div className={styles.heroLocation}>
            <MapPin size={13} strokeWidth={1.5} aria-hidden="true" />
            <span>{reportLocation(event)}</span>
          </div>
          <div className={styles.heroStatus}>
            <span className={`${styles.status} ${event.status === "developing" ? styles.developing : ""}`}>
              <span aria-hidden="true" />Source status: {event.status}
            </span>
            <span aria-hidden="true">·</span>
            <span>Updated {relativeTime(event.lastUpdatedAt, referenceTime)}</span>
          </div>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Event information">
          {TABS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${id}-tab-${item.id}`}
              aria-controls={`${id}-panel-${item.id}`}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? styles.activeTab : ""}
              onClick={() => setTab(item.id)}
              ref={(node) => { tabRefs.current[index] = node; }}
              onKeyDown={(keyboardEvent) => {
                if (moveTab(index, keyboardEvent.key)) keyboardEvent.preventDefault();
              }}
            >
              {item.label}
              {item.id === "sources" && <span>{event.sources.length}</span>}
            </button>
          ))}
        </div>
        <div
          className={styles.tabContent}
          role="tabpanel"
          id={`${id}-panel-${tab}`}
          aria-labelledby={`${id}-tab-${tab}`}
          tabIndex={0}
        >
          {tab === "overview" && (
            <EventOverview event={event} allEvents={allEvents} onSelectEvent={onSelectEvent} />
          )}
          {tab === "timeline" && <EventUpdateTimeline event={event} />}
          {tab === "sources" && <EventSources event={event} />}
        </div>
        <div className={styles.detailFooter}>
          <span>SOURCE-REPORTED RECORD</span>
          <a href={permalink}>Open event page <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </section>
  );
}

export default EventDetail;
