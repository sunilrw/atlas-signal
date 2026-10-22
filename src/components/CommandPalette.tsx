"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Command, Globe2, ListFilter, Search, Zap } from "lucide-react";
import { countries } from "@/lib/catalog";
import { Dialog } from "@/components/ui/Dialog";
import { isLiveReport, reportKindLabel, reportLocation, reportPublisher, reportSeverity } from "@/components/events/report-display";
import type { AtlasEvent, CountryInfo, EventCategory } from "@/types";

export function getCommandReportResults(events: AtlasEvent[], query: string): AtlasEvent[] {
  const normalized = query.toLowerCase().trim();
  return events
    .filter(isLiveReport)
    .filter((event) => [
      event.title, event.summary, event.country, event.locationName, event.category, event.reportKind,
      ...event.tags,
      ...event.sources.flatMap((source) => [source.name, source.byline, source.providerId, source.publisherCountry, source.language]),
    ].join(" ").toLowerCase().includes(normalized))
    .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || a.id.localeCompare(b.id))
    .slice(0, normalized ? 6 : 3);
}

export function CommandPalette({ open, onClose, events, onSelectEvent, onSelectCountry, onSearch, onSetCategory, onSetView }: {
  open: boolean;
  onClose: () => void;
  events: AtlasEvent[];
  onSelectEvent: (event: AtlasEvent) => void;
  onSelectCountry: (country: CountryInfo) => void;
  onSearch: (query: string) => void;
  onSetCategory: (category: EventCategory) => void;
  onSetView: (view: "map" | "timeline" | "briefing" | "watchlist") => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const normalized = query.toLowerCase().trim();
  const countryResults = useMemo(() => countries.filter((country) => `${country.name} ${country.region} ${country.code}`.toLowerCase().includes(normalized)).slice(0, normalized ? 4 : 3), [normalized]);
  const eventResults = useMemo(() => getCommandReportResults(events, normalized), [events, normalized]);
  const execute = (callback: () => void) => { callback(); onClose(); };
  const focusResult = (direction: 1 | -1) => {
    const buttons = Array.from(resultsRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(current + direction + buttons.length) % buttons.length]?.focus();
  };

  return <Dialog open={open} onClose={onClose} title="Search the world" className="command-dialog">
    <div className="command-input"><Search size={20} /><input ref={inputRef} aria-label="Search countries, reports, and publishers" placeholder="A place, a report, a publisher…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); focusResult(1); } if (event.key === "Enter" && query.trim()) execute(() => onSearch(query.trim())); }} autoFocus /><kbd>ESC</kbd></div>
    <div className="command-results" ref={resultsRef} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); focusResult(event.key === "ArrowDown" ? 1 : -1); } }}>
      {normalized && <button className="command-result query-result" onClick={() => execute(() => onSearch(query.trim()))}><ListFilter size={17} /><div><strong>Filter all reports for “{query.trim()}”</strong><span>Search titles, locations, and source details</span></div><ArrowRight size={15} /></button>}
      {!!countryResults.length && <><h3 className="section-label">PLACES</h3>{countryResults.map((country) => <button className="command-result" key={country.code} onClick={() => execute(() => onSelectCountry(country))}><Globe2 size={17} /><div><strong>{country.name}</strong><span>{country.region}</span></div><ArrowRight size={15} /></button>)}</>}
      {!!eventResults.length && <><h3 className="section-label">LATEST REPORTS</h3>{eventResults.map((event) => <button className="command-result" key={event.id} onClick={() => execute(() => onSelectEvent(event))}>
        <span className="severity-pin" style={{ background: reportSeverity(event).color }} title={`Severity: ${reportSeverity(event).label}${event.severityReason ? `. Basis: ${event.severityReason}` : ""}`} />
        <div>
          <strong>{event.title}</strong>
          <span>{reportLocation(event)} · {reportPublisher(event)} · {reportKindLabel(event)} · Severity: {reportSeverity(event).label}</span>
          {event.severity !== null && event.severityReason && <span>Severity basis: {event.severityReason}</span>}
        </div><ArrowRight size={15} />
      </button>)}</>}
      {!normalized && <><h3 className="section-label">QUICK ACTIONS</h3><button className="command-result" onClick={() => execute(() => onSetCategory("conflict"))}><Zap size={16} /><div><strong>Show conflict reports</strong><span>Filter the map by category</span></div></button><button className="command-result" onClick={() => execute(() => onSetCategory("natural-disaster"))}><Zap size={16} /><div><strong>Show natural disasters</strong><span>Earthquakes and disaster alerts</span></div></button><button className="command-result" onClick={() => execute(() => onSetView("timeline"))}><Command size={16} /><div><strong>Open the timeline</strong><span>See reports in chronological order</span></div><kbd>T</kbd></button></>}
    </div>
    <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to select</span><span>Places. Reports. Sources.</span></div>
  </Dialog>;
}
