"use client";

import { ArrowUpRight, Bell, Bookmark, Check, Globe2, Plus, Trash2 } from "lucide-react";
import { CATEGORY_META, countries } from "@/lib/catalog";
import { relativeTime } from "@/lib/event-utils";
import { isLiveReport, reportKindLabel, reportLocation, reportPublisher } from "@/components/events/report-display";
import type { AlertRule, AtlasEvent, CountryInfo, WatchlistEntry } from "@/types";

export function Watchlist({ watchlist, events, referenceTime, onSelectEvent, onSelectCountry, onRemove, onExplore, onAlerts, alerts }: {
  watchlist: WatchlistEntry[];
  events: AtlasEvent[];
  referenceTime: string;
  onSelectEvent: (event: AtlasEvent) => void;
  onSelectCountry: (country: CountryInfo) => void;
  onRemove: (id: string) => void;
  onExplore: () => void;
  onAlerts: () => void;
  alerts: AlertRule[];
}) {
  const liveEvents = events.filter(isLiveReport);
  return <section className="watchlist-view" aria-label="Your watchlist">
    <div className="view-heading"><span className="eyebrow">YOUR CORNER OF THE WORLD</span><h1>Keep a closer eye<span>.</span></h1><p>Places and source reports you follow. Saved on this device.</p></div>
    <div className="section-heading"><h2>Watchlist <span className="count-badge">{watchlist.length}</span></h2><button className="secondary-button" onClick={onExplore}><Plus size={15} /> Follow a place</button></div>
    {!watchlist.length ? <div className="watchlist-empty"><span><Bookmark size={29} strokeWidth={1.2} /></span><h2>A little focus goes a long way.</h2><p>Follow a country or save an event to keep it in view. Start by searching for a place that matters to you.</p><button className="primary-button" onClick={onExplore}>Find a place <ArrowUpRight size={15} /></button></div> : <div className="saved-list">{watchlist.map((entry) => {
      const country = countries.find((country) => country.code === entry.value);
      const event = liveEvents.find((event) => event.id === entry.value);
      const related = liveEvents.filter((event) => event.countryCode === entry.value);
      const label = entry.kind === "country" ? country?.name ?? "Saved country unavailable" : event?.title ?? "Saved report unavailable";
      return <div key={entry.id}>
        <span className="saved-icon">{entry.kind === "country" ? <Globe2 size={21} /> : <Bookmark size={19} />}</span>
        <button className="saved-main" disabled={entry.kind === "country" ? !country : !event} onClick={() => { if (entry.kind === "country" && country) onSelectCountry(country); if (entry.kind === "event" && event) onSelectEvent(event); }}>
          <span className="eyebrow">{entry.kind === "country" ? country?.region ?? "COUNTRY" : event ? CATEGORY_META[event.category].label : "SAVED REPORT"}</span>
          <strong>{label}</strong>
          <span>{entry.kind === "country" ? `${related.length} source ${related.length === 1 ? "report" : "reports"} in this view` : event ? `${reportLocation(event)} · Updated ${relativeTime(event.lastUpdatedAt, referenceTime)}` : "Not available in the current source reports"}</span>
          {entry.kind === "event" && event && <span>{reportPublisher(event)} · {reportKindLabel(event)}</span>}
        </button>
        <button className="icon-button" onClick={() => onRemove(entry.id)} aria-label={`Remove ${label} from watchlist`}><Trash2 size={16} /></button>
      </div>;
    })}</div>}
    <div className="watchlist-alerts"><Bell size={21} /><div><h3>A signal when it matters.</h3><p>{alerts.filter((rule) => rule.enabled).length ? `${alerts.filter((rule) => rule.enabled).length} active browser alert rules` : "Set a rule for reports with assessed severity in a place you follow."}</p><span><Check size={11} /> On this device · while the live workspace is open</span></div><button className="secondary-button" onClick={onAlerts}>Manage alerts <ArrowUpRight size={13} /></button></div>
  </section>;
}
