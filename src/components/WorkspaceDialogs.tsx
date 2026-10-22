"use client";

import { ArrowUpRight, Check, CheckCheck, Info, Moon, Radio, RefreshCw, Sun } from "lucide-react";
import { CATEGORY_META, REGIONS, SEVERITY_META } from "@/lib/catalog";
import { formatUtcDate, formatUtcTime } from "@/lib/event-utils";
import { Dialog } from "@/components/ui/Dialog";
import type { EventCategory, EventFilters, EventsResponse, MapTheme, TimeRange } from "@/types";

export type DialogName = "filters" | "layers" | "sources" | "about" | "alerts" | null;
const timeRanges: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "Last hour" }, { value: "6h", label: "6 hours" }, { value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }
];

function safeLink(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function publisherOrigin(value: string | undefined) {
  if (!value) return "Origin not specified";
  try { return /^[A-Z]{2}$/.test(value) ? new Intl.DisplayNames(["en"], { type: "region" }).of(value) ?? value : value; }
  catch { return value; }
}

export function WorkspaceDialogs({ dialog, onClose, filters, onFilters, onReset, theme, onTheme, labels, onLabels, density, onDensity, data, onRefresh }: {
  dialog: DialogName;
  onClose: () => void;
  filters: EventFilters;
  onFilters: (update: Partial<EventFilters>) => void;
  onReset: () => void;
  theme: MapTheme;
  onTheme: (theme: MapTheme) => void;
  labels: boolean;
  onLabels: (value: boolean) => void;
  density: "minimal" | "standard" | "detailed";
  onDensity: (value: "minimal" | "standard" | "detailed") => void;
  data: EventsResponse | null;
  onRefresh: () => void;
}) {
  const toggleCategory = (category: EventCategory) => onFilters({ categories: filters.categories.includes(category) ? filters.categories.filter((item) => item !== category) : [...filters.categories, category] });
  return <>
    <Dialog open={dialog === "filters"} title="Focus your view" onClose={onClose} className="filters-dialog">
      <p className="dialog-description">Show the signals that matter to you.</p>
      <fieldset className="filter-field"><legend>TIME RANGE</legend><div className="segmented-control">{timeRanges.map((range) => <button key={range.value} aria-pressed={filters.timeRange === range.value} onClick={() => onFilters({ timeRange: range.value })}>{range.label}</button>)}</div></fieldset>
      <fieldset className="filter-field"><legend>EVENT CATEGORIES <span>{filters.categories.length ? `${filters.categories.length} selected` : "All categories"}</span></legend><div className="category-options">{Object.entries(CATEGORY_META).map(([key, category]) => <button key={key} aria-pressed={filters.categories.includes(key as EventCategory)} onClick={() => toggleCategory(key as EventCategory)}><span className="category-check">{filters.categories.includes(key as EventCategory) && <Check size={11} />}</span>{category.label}</button>)}</div></fieldset>
      <label className="filter-field"><span>MINIMUM ASSESSED SEVERITY</span><select value={filters.minSeverity} onChange={(event) => onFilters({ minSeverity: Number(event.target.value) })}><option value="1">All reports, including unassessed</option>{Object.entries(SEVERITY_META).filter(([key]) => Number(key) > 1).map(([key, value]) => <option key={key} value={key}>{value.label} and above</option>)}</select><p className="field-help">News impact is unassessed unless a supported source supplies hazard measurements. Selecting a threshold excludes unassessed reports; it does not establish their importance.</p></label>
      <label className="filter-field"><span>REGION</span><select value={filters.region} onChange={(event) => onFilters({ region: event.target.value })}>{REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
      <div className="dialog-actions"><button className="text-button" onClick={onReset}><RefreshCw size={14} /> Reset filters</button><button className="primary-button" onClick={onClose}>Show results <ArrowUpRight size={15} /></button></div>
    </Dialog>
    <Dialog open={dialog === "layers"} title="Your view of the world" onClose={onClose}>
      <p className="dialog-description">A little more context. Only when you need it.</p>
      <fieldset className="filter-field"><legend>BASE MAP</legend><div className="map-style-options"><button className={theme === "dark" ? "selected" : ""} onClick={() => onTheme("dark")} aria-pressed={theme === "dark"}><div className="map-style-preview preview-dark"><Moon size={22} /><span /></div><strong>Dark matter</strong>{theme === "dark" && <CheckCheck size={16} />}</button><button className={theme === "light" ? "selected" : ""} onClick={() => onTheme("light")} aria-pressed={theme === "light"}><div className="map-style-preview preview-light"><Sun size={22} /><span /></div><strong>Daylight</strong>{theme === "light" && <CheckCheck size={16} />}</button></div></fieldset>
      <fieldset className="filter-field"><legend>INFORMATION DENSITY</legend><div className="segmented-control">{(["minimal", "standard", "detailed"] as const).map((value) => <button key={value} aria-pressed={density === value} onClick={() => onDensity(value)} className="capitalize">{value}</button>)}</div><p className="field-help">Minimal shows assessed high-severity reports only. Detailed adds location labels as you zoom. Reports without source-supplied coordinates remain in the feed.</p></fieldset>
      <label className="switch-row"><span><strong>Place labels</strong><small>Countries, cities, and geographic context</small></span><input type="checkbox" checked={labels} onChange={(event) => onLabels(event.target.checked)} /></label>
      <div className="inline-note"><Info size={16} /><span>Map boundaries are for geographic context and do not imply a position on sovereignty.</span></div>
    </Dialog>
    <Dialog open={dialog === "sources"} title="The signal behind the map" onClose={onClose} className="sources-dialog">
      <div className="live-source-summary"><Radio size={21} /><div><span className="eyebrow">LIVE REPORTING ONLY</span><h3>Sources, not simulations.</h3><p>Original publisher records, source timestamps, and article links. Atlas does not generate events or replace unavailable reports.</p></div></div>
      <div className="source-principles"><span><Check size={13} /> Original attribution</span><span><Check size={13} /> Unknowns stay unknown</span><span><Check size={13} /> No confidence percentages</span></div>
      <div className="section-heading"><h3>Source status</h3><button className="icon-button" aria-label="Refresh source status" onClick={onRefresh}><RefreshCw size={15} /></button></div>
      <div className="source-status-list">{data?.sources.length ? data.sources.map((source) => <div key={source.id}><div><span className={`provider-dot provider-${source.status}`} /><strong>{source.name}</strong><span className={`provider-status provider-${source.status}`}>{source.status}</span></div><div className="publisher-context"><span>{source.kind ?? "Source"} · {publisherOrigin(source.publisherCountry)}{source.language ? ` · ${source.language}` : ""}</span></div><p>{source.message}</p><span className="source-status-meta">{source.eventCount} source records{source.lastFetchedAt ? ` · Last successful fetch ${formatUtcDate(source.lastFetchedAt)}, ${formatUtcTime(source.lastFetchedAt)}` : " · No successful fetch"}</span><div className="provider-links">{safeLink(source.url) && <a href={safeLink(source.url)} target="_blank" rel="noopener noreferrer">Original feed <ArrowUpRight size={11} /></a>}{safeLink(source.termsUrl) && <a href={safeLink(source.termsUrl)} target="_blank" rel="noopener noreferrer">Source usage terms <ArrowUpRight size={11} /></a>}</div></div>) : <p className="muted">Waiting for the live source service. No preloaded reporting is displayed.</p>}</div>
      {!!data?.warnings.length && <div className="source-warnings">{data.warnings.map((warning, index) => <p key={index}><Info size={14} />{warning}</p>)}</div>}
      <div className="inline-note"><Info size={16} /><span>Multiple editorial origins broaden the view, but do not make it bias-free or independently verified. English-language coverage is incomplete. Repeated or syndicated reports do not count as independent confirmation.</span></div>
      <p className="field-help">Publisher origin describes the organization, not where an incident occurred. News, commentary, and official alerts remain attributed to their sources. Cached records retain their original timestamps. Some feed rights are limited to personal, non-commercial reading; review terms before redistribution.</p>
    </Dialog>
    <Dialog open={dialog === "about"} title="Clarity in a changing world." onClose={onClose} className="about-dialog">
      <p className="about-intro">Atlas Signal brings events, places, and source context together. The aim is understanding, not urgency.</p>
      <p className="about-credit">Made by Sunil Warrier</p>
      <div className="principle-list"><div><span>01</span><div><h3>Attributable reporting</h3><p>Every report comes from a connected source. Open it to see the publisher, original article, source timestamps, and any supplied location. Missing information is not filled in.</p></div></div><div><span>02</span><div><h3>Verification is not assumed</h3><p>Atlas does not independently verify source claims. There are no invented confidence percentages. Multiple links and repeated coverage are not proof of independent corroboration.</p></div></div><div><span>03</span><div><h3>Perspective, not a promise of neutrality</h3><p>Publishers can have biases and coverage gaps. Headlines remain attributable to them. Hazard severity, where available, is a disclosed interpretation of source measurements—not a prediction or a calibrated assessment of harm.</p></div></div></div>
      <div className="about-shortcuts"><h3 className="section-label">A FEW SHORTCUTS</h3><div><span>Search the world</span><kbd>⌘ K</kbd></div><div><span>Search</span><kbd>/</kbd></div><div><span>Filters</span><kbd>F</kbd></div><div><span>Map layers</span><kbd>L</kbd></div><div><span>Timeline</span><kbd>T</kbd></div><div><span>Close panel</span><kbd>ESC</kbd></div></div>
      <p className="field-help">Watchlists and alert rules stay in this browser. No account, cross-device sync, or background notification service is enabled in this MVP. Do not rely on Atlas Signal for emergency decisions.</p>
    </Dialog>
  </>;
}
