"use client";

import { ArrowLeft, ArrowUpRight, Bookmark, Check, Globe2 } from "lucide-react";
import { CATEGORY_META } from "@/lib/catalog";
import { relativeTime } from "@/lib/event-utils";
import { isLiveReport, reportKindLabel, reportLocation, reportPublisher, reportSeverity } from "@/components/events/report-display";
import type { AtlasEvent, CountryInfo, DataMode } from "@/types";

export function CountryPanel({ country, events, referenceTime, saved, onClose, onToggleSave, onSelectEvent }: {
  country: CountryInfo;
  events: AtlasEvent[];
  referenceTime: string;
  mode: DataMode;
  saved: boolean;
  onClose: () => void;
  onToggleSave: () => void;
  onSelectEvent: (event: AtlasEvent) => void;
}) {
  const countryEvents = events
    .filter((event) => isLiveReport(event) && event.countryCode === country.code)
    .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || a.id.localeCompare(b.id));
  const categories = Object.entries(CATEGORY_META).map(([key, value]) => ({ ...value, count: countryEvents.filter((event) => event.category === key).length })).filter((item) => item.count);
  const newest = countryEvents[0]?.lastUpdatedAt;
  const unassessed = countryEvents.filter((event) => event.severity === null).length;

  return <section className="country-panel" aria-label={`${country.name} source reports`}>
    <div className="panel-topline"><button className="text-button" onClick={onClose}><ArrowLeft size={14} /> All reports</button><span className="eyebrow">COUNTRY REPORTS</span></div>
    <div className="country-heading"><span className="country-code">{country.code}</span><button className={`icon-button ${saved ? "is-active" : ""}`} aria-label={saved ? `Unfollow ${country.name}` : `Follow ${country.name}`} onClick={onToggleSave}>{saved ? <Check size={18} /> : <Bookmark size={18} />}</button></div>
    <h2>{country.name}</h2><p className="muted country-region"><Globe2 size={13} /> {country.region}</p>
    <div className="country-numbers">
      <div><strong>{countryEvents.length}</strong><span>available reports</span></div>
      <div><strong>{unassessed}</strong><span>severity unassessed</span></div>
    </div>
    <p className="context-note">Coverage reflects available source reports, not a country risk assessment. Missing reports do not imply safety or stability.</p>
    <div className="country-update"><span>Latest report update</span><strong>{newest ? relativeTime(newest, referenceTime) : "No reports available"}</strong></div>
    <h3 className="section-label">REPORTED CATEGORIES</h3>
    <div className="category-breakdown">{categories.length ? categories.map((category) => <div key={category.label}><span><i style={{ background: category.color }} />{category.label}</span><strong>{category.count}</strong></div>) : <p className="muted">No reporting in this view. Check source coverage, the time range, and filters.</p>}</div>
    <h3 className="section-label">LATEST REPORTS</h3>
    <div className="compact-event-list">{countryEvents.slice(0, 10).map((event) => <button key={event.id} onClick={() => onSelectEvent(event)}>
      <span className="eyebrow">{CATEGORY_META[event.category].label} · Updated {relativeTime(event.lastUpdatedAt, referenceTime)}</span>
      <strong>{event.title}</strong>
      <span className="muted">{reportPublisher(event)} · {reportKindLabel(event)}</span>
      <span className="muted">{reportLocation(event)} · Severity: {reportSeverity(event).label} <ArrowUpRight size={13} /></span>
      {event.severity !== null && event.severityReason && <span className="muted">Severity basis: {event.severityReason}</span>}
    </button>)}</div>
    <a className="country-permalink" href={`/country/${country.slug}`}>Open country permalink <ArrowUpRight size={14} /></a>
  </section>;
}
