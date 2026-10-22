"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownWideNarrow, ArrowUpRight, Bell, Bookmark, Check,
  ChevronDown, CircleHelp, Clock3, Compass, Globe2, Layers3, List,
  Maximize2, PanelRightClose, PanelRightOpen, Radio, Search,
  SlidersHorizontal, Sparkles, X
} from "lucide-react";
import { CATEGORY_META, countries } from "@/lib/catalog";
import { DEFAULT_FILTERS, filterEvents, getEventStats } from "@/lib/event-utils";
import { EMPTY_ALERTS, EMPTY_WATCHLIST, isAlertRules, isTheme, isWatchlist, liveWatchlist, purgeRetiredBookmarks } from "@/lib/preferences";
import { isRemovedSampleId } from "@/lib/live-data";
import { useEvents } from "@/hooks/use-events";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useMediaQuery } from "@/hooks/use-media-query";
import { EventDetail, EventFeed, TimelineView } from "@/components/events";
import { CountryPanel } from "@/components/CountryPanel";
import { Briefing } from "@/components/Briefing";
import { Watchlist } from "@/components/Watchlist";
import { AlertDialog } from "@/components/AlertDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { WorkspaceDialogs, type DialogName } from "@/components/WorkspaceDialogs";
import { TimeRail } from "@/components/TimeRail";
import type { AlertRule, AtlasEvent, CountryInfo, DataMode, EventCategory, EventFilters, MapView, TimeRange, WatchlistEntry } from "@/types";

const WorldMap = dynamic(() => import("@/components/map/WorldMap"), {
  ssr: false,
  loading: () => <div className="map-loading"><span className="loading-orbit" /><span>Bringing the world into view</span></div>
});

type View = "map" | "timeline" | "briefing" | "watchlist";
const TIME_LABELS: Record<TimeRange, string> = { "1h": "Last hour", "6h": "Last 6 hours", "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" };
const quickCategories: { label: string; value: EventCategory | null }[] = [
  { label: "All events", value: null }, { label: "Conflict", value: "conflict" },
  { label: "Disasters", value: "natural-disaster" }, { label: "Political", value: "political" }
];
const validRanges = new Set(["1h", "6h", "24h", "7d", "30d"]);

function clampNumber(value: string | null, min: number, max: number, fallback: number) {
  if (value === null || value.trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function findCountry(value?: string | null) {
  return value ? countries.find((country) => country.code.toLowerCase() === value.toLowerCase() || country.slug === value.toLowerCase()) ?? null : null;
}

export function AtlasApp({ initialEventId, initialCountry }: { initialEventId?: string; initialCountry?: string }) {
  const searchParams = useSearchParams();
  const isMobile = useMediaQuery("(max-width: 780px)");
  const sidebarRef = useRef<HTMLElement | null>(null);
  const mode: DataMode = "live";
  const [view, setView] = useState<View>("map");
  const [filters, setFilters] = useState<EventFilters>(() => ({
    ...DEFAULT_FILTERS,
    query: searchParams.get("q")?.slice(0, 250) ?? "",
    categories: (searchParams.get("category")?.split(",") ?? []).filter((category): category is EventCategory => Object.hasOwn(CATEGORY_META, category)),
    minSeverity: clampNumber(searchParams.get("severity"), 1, 7, 1),
    minConfidence: 0,
    timeRange: validRanges.has(searchParams.get("time") ?? "") ? searchParams.get("time") as TimeRange : "24h",
    region: searchParams.get("region") ?? DEFAULT_FILTERS.region
  }));
  const [theme, setTheme] = useLocalStorage("atlas-signal:theme:v1", "dark", isTheme);
  const [savedWatchlist, setWatchlist] = useLocalStorage<WatchlistEntry[]>("atlas-signal:watchlist:v1", EMPTY_WATCHLIST, isWatchlist);
  const watchlist = useMemo(() => liveWatchlist(savedWatchlist), [savedWatchlist]);
  const [alerts, setAlerts] = useLocalStorage<AlertRule[]>("atlas-signal:alerts:v1", EMPTY_ALERTS, isAlertRules);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const candidate = initialEventId ?? searchParams.get("event");
    return isRemovedSampleId(candidate) ? null : candidate;
  });
  const [selectedCountry, setSelectedCountry] = useState<CountryInfo | null>(() => findCountry(initialCountry ?? searchParams.get("country")));
  const [dialog, setDialog] = useState<DialogName>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [showFeed, setShowFeed] = useState(true);
  const [mobileFeed, setMobileFeed] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [density, setDensity] = useState<"minimal" | "standard" | "detailed">("standard");
  const [playbackHours, setPlaybackHours] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("Permission is requested only when you enable notifications.");
  const [toast, setToast] = useState<string | null>(null);
  const [hasExplicitInitialView] = useState(() => searchParams.has("lat") || searchParams.has("lng") || searchParams.has("zoom"));
  const [hasCameraView, setHasCameraView] = useState(hasExplicitInitialView);
  const [focus, setFocus] = useState<{ latitude: number; longitude: number; zoom?: number; nonce?: number } | null>(() => {
    const country = findCountry(initialCountry);
    if (searchParams.has("lat") || searchParams.has("lng")) return null;
    return country ? { latitude: country.latitude, longitude: country.longitude, zoom: 3.5 } : null;
  });
  const [mapView, setMapView] = useState<MapView>(() => ({
    latitude: clampNumber(searchParams.get("lat"), -75, 75, 20),
    longitude: clampNumber(searchParams.get("lng"), -180, 180, 12),
    zoom: clampNumber(searchParams.get("zoom"), -1, 9, 1.15)
  }));
  const currentMapView = useRef<MapView>(mapView);
  const { data, isLoading, error, connected, refresh } = useEvents();
  const events = useMemo(() => data?.events ?? [], [data?.events]);
  const referenceTime = data?.referenceTime ?? new Date().toISOString();
  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;
  const initialSelectionFocus = useMemo(() => {
    if (focus || hasExplicitInitialView || !initialEventId || selectedId !== initialEventId || !selectedEvent) return focus;
    return selectedEvent.latitude !== undefined && selectedEvent.longitude !== undefined
      ? { latitude: selectedEvent.latitude, longitude: selectedEvent.longitude, zoom: 3.7 }
      : null;
  }, [focus, hasExplicitInitialView, initialEventId, selectedEvent, selectedId]);
  const visibleEvents = useMemo(() => filterEvents(events, filters, referenceTime, playbackHours, watchlist), [events, filters, referenceTime, playbackHours, watchlist]);
  const mapEvents = useMemo(() => density === "minimal" ? visibleEvents.filter((event) => event.severity !== null && event.severity >= 5) : visibleEvents, [density, visibleEvents]);
  const mappedCount = mapEvents.filter((event) => event.latitude !== undefined && event.longitude !== undefined).length;
  const hasLocatedReports = visibleEvents.some((event) => event.latitude !== undefined && event.longitude !== undefined);
  const stats = getEventStats(visibleEvents);
  const activeFilters = filters.categories.length + (filters.minSeverity > 1 ? 1 : 0) + (filters.minConfidence > 0 ? 1 : 0) + (filters.region !== DEFAULT_FILTERS.region ? 1 : 0) + (filters.watchlistOnly ? 1 : 0);
  const closeDialog = useCallback(() => setDialog(null), []);
  const updateFilters = useCallback((update: Partial<EventFilters>) => setFilters((current) => ({ ...current, ...update })), []);
  const resetFilters = useCallback(() => { setFilters({ ...DEFAULT_FILTERS, categories: [] }); setPlaybackHours(0); setPlaying(false); }, []);
  const notify = useCallback((message: string) => setToast(message), []);
  const closePanel = useCallback(() => { setSelectedId(null); setSelectedCountry(null); setMobileFeed(false); }, []);

  useEffect(() => {
    try {
      if (purgeRetiredBookmarks(localStorage)) window.dispatchEvent(new Event("atlas:preferences"));
    } catch { /* The render path still excludes retired items if storage is unavailable. */ }
  }, []);

  useEffect(() => {
    if (isMobile && (selectedId || selectedCountry)) {
      sidebarRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Close event details"], button')?.focus({ preventScroll: true });
    }
  }, [isMobile, selectedCountry, selectedId]);

  const selectEvent = useCallback((event: AtlasEvent) => {
    setSelectedId(event.id);
    setSelectedCountry(null);
    setShowFeed(true);
    setMobileFeed(false);
    if (event.latitude !== undefined && event.longitude !== undefined) {
      setFocus({ latitude: event.latitude, longitude: event.longitude, zoom: Math.max(currentMapView.current.zoom, 3.7), nonce: Date.now() });
    }
  }, []);

  const selectCountry = useCallback((country: CountryInfo, fly = true) => {
    setSelectedCountry(country);
    setSelectedId(null);
    setView("map");
    setShowFeed(true);
    setMobileFeed(false);
    if (fly) setFocus({ latitude: country.latitude, longitude: country.longitude, zoom: 3.5, nonce: Date.now() });
  }, []);

  const selectCountryCode = useCallback((code: string) => {
    const country = findCountry(code);
    if (country) { selectCountry(country, false); return; }
    notify("No country profile is available for this map feature.");
  }, [notify, selectCountry]);

  const toggleWatch = useCallback((entry: Omit<WatchlistEntry, "id">) => {
    const id = `${entry.kind}:${entry.value}`;
    if (watchlist.length >= 500 && !watchlist.some((item) => item.id === id)) {
      notify("This device can save up to 500 items. Remove an item before adding another.");
      return;
    }
    setWatchlist((stored) => {
      const current = liveWatchlist(stored);
      return current.some((item) => item.id === id) ? current.filter((item) => item.id !== id) : [...current, { ...entry, id }];
    });
  }, [notify, setWatchlist, watchlist]);

  const changeView = useCallback((next: View) => {
    setView(next);
    setSelectedId(null);
    setSelectedCountry(null);
    setMobileFeed(false);
    setFocus(null);
  }, []);

  const searchWorld = useCallback((query: string) => {
    const nextFilters = { ...DEFAULT_FILTERS, categories: [], query };
    changeView("map");
    setFilters(nextFilters);
    setPlaybackHours(0);
    setPlaying(false);
    setShowFeed(true);
    setMobileFeed(isMobile);
    const match = filterEvents(events, nextFilters, referenceTime).find((event) => event.latitude !== undefined && event.longitude !== undefined);
    if (match?.latitude !== undefined && match.longitude !== undefined) setFocus({ latitude: match.latitude, longitude: match.longitude, zoom: 3.4, nonce: Date.now() });
  }, [changeView, events, isMobile, referenceTime]);

  const showCategory = useCallback((category: EventCategory) => {
    changeView("map");
    setFilters({ ...DEFAULT_FILTERS, categories: [category] });
    setPlaybackHours(0);
    setPlaying(false);
    setShowFeed(true);
    setMobileFeed(isMobile);
  }, [changeView, isMobile]);

  useEffect(() => {
    if (!playing || playbackHours <= 0) return;
    const timer = setTimeout(() => setPlaybackHours((hours) => Math.max(0, hours - 0.5)), 800);
    return () => clearTimeout(timer);
  }, [playing, playbackHours]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4_500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInput = target.matches("input, textarea, select, [contenteditable=true]");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((open) => !open); return; }
      if (event.key === "Escape") {
        if (document.querySelector("dialog[open]")) { setCommandOpen(false); setDialog(null); }
        else closePanel();
        return;
      }
      if (isInput || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("dialog[open]")) return;
      if (event.key === "/") { event.preventDefault(); setCommandOpen(true); }
      if (event.key.toLowerCase() === "f") { event.preventDefault(); setDialog("filters"); }
      if (event.key.toLowerCase() === "l") { event.preventDefault(); setDialog("layers"); }
      if (event.key.toLowerCase() === "t") { event.preventDefault(); setView((view) => view === "timeline" ? "map" : "timeline"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closePanel]);

  const buildMapUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (hasCameraView) {
      params.set("lat", mapView.latitude.toFixed(3));
      params.set("lng", mapView.longitude.toFixed(3));
      params.set("zoom", mapView.zoom.toFixed(2));
    }
    if (filters.query) params.set("q", filters.query);
    if (filters.categories.length) params.set("category", filters.categories.join(","));
    if (filters.timeRange !== "24h") params.set("time", filters.timeRange);
    if (filters.minSeverity > 1) params.set("severity", String(filters.minSeverity));
    if (filters.region !== DEFAULT_FILTERS.region) params.set("region", filters.region);
    if (selectedId) params.set("event", selectedId);
    if (selectedCountry) params.set("country", selectedCountry.code);
    return `/map?${params.toString()}`;
  }, [filters, hasCameraView, mapView, selectedCountry, selectedId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.history.replaceState(null, "", buildMapUrl());
    }, 400);
    return () => clearTimeout(timer);
  }, [buildMapUrl]);

  const shareMap = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${buildMapUrl()}`);
      notify("Map link copied. The view and filters are included.");
    } catch { notify("Clipboard is unavailable. Copy the current address from your browser."); }
  };

  const handleMapView = useCallback((mapView: MapView) => {
    currentMapView.current = mapView;
    setHasCameraView(true);
    setMapView((previous) => Math.abs(previous.latitude - mapView.latitude) < .0001 && Math.abs(previous.longitude - mapView.longitude) < .0001 && Math.abs(previous.zoom - mapView.zoom) < .001 ? previous : mapView);
  }, []);

  const seenEvents = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data || data.mode !== "live") return;
    if (!seenEvents.current) { seenEvents.current = new Set(events.map((event) => event.id)); return; }
    for (const event of events) {
      if (seenEvents.current.has(event.id)) continue;
      seenEvents.current.add(event.id);
      const matches = alerts.some((rule) => rule.enabled && (!rule.countryCode || rule.countryCode === event.countryCode) && (rule.category === "all" || rule.category === event.category) && (rule.minSeverity === 1 || (event.severity !== null && event.severity >= rule.minSeverity)));
      if (matches && !event.isDemo && "Notification" in window && Notification.permission === "granted") {
        try {
          const notification = new Notification(`Atlas Signal · ${event.country || event.region}`, { body: event.title, tag: event.id, icon: "/icon.svg" });
          notification.onclick = () => { window.focus(); selectEvent(event); notification.close(); };
        } catch { /* Browser delivery may be unavailable despite permission. */ }
      }
    }
  }, [alerts, data, events, selectEvent]);

  async function enableNotifications() {
    if (!("Notification" in window)) { setNotificationStatus("This browser does not support desktop notifications."); return; }
    try {
      const permission = await Notification.requestPermission();
      setNotificationStatus(permission === "granted" ? "Enabled. New matching live events will notify you while this tab is open." : permission === "denied" ? "Blocked by your browser. Change site permissions to enable." : "Permission was not granted. Your rules are still saved.");
    } catch { setNotificationStatus("Notifications are unavailable. A secure browser context is required."); }
  }

  const timeText = data ? new Date(referenceTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "—";
  const fetchedTimeText = data?.updatedAt ? new Date(data.updatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : null;
  const hasFeedProblems = data?.sources.some((source) => source.status === "error" || source.status === "degraded") ?? false;
  const hasHealthySource = data?.sources.some((source) => source.status === "healthy") ?? false;
  const connectionLabel = error ? "OFFLINE" : isLoading ? "CONNECTING" : hasFeedProblems ? "PARTIAL" : connected && hasHealthySource ? "LIVE" : hasHealthySource ? "LIVE SOURCES" : "NO FEEDS";
  const hasDetail = !!selectedEvent || !!selectedCountry;
  const asideVisible = showFeed || hasDetail;
  const commandSelectEvent = (event: AtlasEvent) => { setView("map"); selectEvent(event); };
  const missingRequestedEvent = selectedId && !selectedEvent && !isLoading;

  return <div className="atlas-app" data-theme={theme}>
    <a className="skip-link" href="#workspace">Skip to events</a>
    <header className="app-header">
      <button className="brand" aria-label="Atlas Signal home" onClick={() => { changeView("map"); resetFilters(); setFocus({ latitude: 20, longitude: 0, zoom: isMobile ? -0.5 : 1.15, nonce: Date.now() }); }}>
        <span className="brand-symbol"><Globe2 size={29} strokeWidth={1.35} /><i /></span><span>ATLAS<span>SIGNAL</span></span>
      </button>
      <div className="header-divider" />
      <nav className="header-nav" aria-label="Primary navigation"><button className={view === "map" || view === "timeline" ? "active" : ""} onClick={() => changeView("map")}>Explore</button><button className={view === "briefing" ? "active" : ""} onClick={() => changeView("briefing")}>Briefing</button><button className={view === "watchlist" ? "active" : ""} onClick={() => changeView("watchlist")}>Watchlist{watchlist.length > 0 && <span>{watchlist.length}</span>}</button></nav>
      <button className="global-search" onClick={() => setCommandOpen(true)} aria-label="Search the world"><Search size={16} /><span>Search the world</span><kbd>⌘ K</kbd></button>
      <div className="header-meta"><div className="utc-clock"><span>{timeText}</span><small>UTC</small></div><button className={`data-mode-pill ${hasFeedProblems || error ? "degraded" : "live"}`} onClick={() => setDialog("sources")} title="Live source coverage and connection status"><span className="status-dot" /><span>{connectionLabel}</span><ChevronDown size={11} /></button><button className="icon-button header-help" aria-label="About Atlas Signal" onClick={() => setDialog("about")}><CircleHelp size={19} /></button></div>
    </header>
    <div className="app-body">
      <nav className="navigation-rail" aria-label="Workspace views">
        <div><button className={view === "map" ? "active" : ""} aria-label="World map" title="World map" onClick={() => changeView("map")}><Globe2 size={20} /></button><button className={view === "timeline" ? "active" : ""} aria-label="Event timeline" title="Timeline · T" onClick={() => changeView("timeline")}><Activity size={20} /></button><button className={view === "briefing" ? "active" : ""} aria-label="Global briefing" title="Global briefing" onClick={() => changeView("briefing")}><ArrowDownWideNarrow size={20} /></button><span className="rail-separator" /><button className={view === "watchlist" ? "active" : ""} aria-label="Saved watchlist" title="Watchlist" onClick={() => changeView("watchlist")}><Bookmark size={19} />{watchlist.length > 0 && <i />}</button><button className={dialog === "alerts" ? "active" : ""} aria-label="Alert rules" title="Alert rules" onClick={() => setDialog("alerts")}><Bell size={19} /></button></div>
        <div><button aria-label="Sources and connection status" title="Data sources" onClick={() => setDialog("sources")}><Radio size={19} /></button><button aria-label="Help and keyboard shortcuts" title="Help & shortcuts" onClick={() => setDialog("about")}><CircleHelp size={19} /></button><span className="rail-avatar" title="Local workspace">AS</span></div>
      </nav>
      <main className="workspace" id="workspace">
        <div className="workspace-toolbar">
          <div className="toolbar-location"><Compass size={16} /><span>Global overview</span><span className="toolbar-location-divider">/</span></div>
          <div className="quick-categories" role="group" aria-label="Quick category filters">{quickCategories.map((category) => <button key={category.label} className={category.value === null ? !filters.categories.length ? "active" : "" : filters.categories.length === 1 && filters.categories[0] === category.value ? "active" : ""} aria-pressed={category.value === null ? !filters.categories.length : filters.categories.length === 1 && filters.categories[0] === category.value} onClick={() => updateFilters({ categories: category.value ? [category.value] : [] })}>{category.label}</button>)}</div>
          <div className="toolbar-actions"><label className="time-select"><Clock3 size={14} /><select aria-label="Event time range" value={filters.timeRange} onChange={(event) => { updateFilters({ timeRange: event.target.value as TimeRange }); setPlaybackHours(0); }}>{Object.entries(TIME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={12} /></label><span className="toolbar-separator" /><button className={`toolbar-button ${activeFilters ? "has-filter" : ""}`} onClick={() => setDialog("filters")}><SlidersHorizontal size={15} /><span>Filters</span>{activeFilters > 0 && <b>{activeFilters}</b>}</button><button className="toolbar-button" onClick={() => setDialog("layers")}><Layers3 size={16} /><span>Layers</span></button><button className="icon-button feed-toggle" aria-label={showFeed ? "Hide event feed" : "Show event feed"} onClick={() => setShowFeed((shown) => !shown)}>{showFeed ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button></div>
        </div>
        {(filters.query || filters.watchlistOnly) && <div className="active-query-bar"><span><Search size={12} />{filters.watchlistOnly ? "Your saved countries and reports" : `Results for “${filters.query}”`}</span><button onClick={resetFilters} aria-label="Clear search and context"><X size={13} />Clear</button></div>}
        {error && <div className="service-error" role="status">{error}<button onClick={refresh}>Retry</button></div>}
        {hasFeedProblems && <button className="feed-warning" onClick={() => setDialog("sources")}><InfoIcon />Some feeds could not refresh. Cached reports keep their original timestamps. View status <ArrowUpRight size={12} /></button>}
        <div className={`workspace-content ${asideVisible && view !== "watchlist" ? "with-aside" : ""} ${mobileFeed ? "mobile-feed-open" : ""} ${hasDetail ? "has-detail" : ""}`}>
          <div className={`primary-canvas view-${view}`} inert={isMobile && (mobileFeed || hasDetail)}>
            {view === "map" && <>
              <WorldMap events={mapEvents} selectedEventId={selectedId} onSelectEvent={selectEvent} onSelectCountry={selectCountryCode} theme={theme} showLabels={showLabels} density={density} initialView={hasCameraView ? mapView : undefined} focus={initialSelectionFocus} onViewChange={handleMapView} />
              <div className="map-overview"><div className="eyebrow"><span className="tiny-cross">+</span> THE WORLD, IN CONTEXT</div><h1>{selectedCountry ? selectedCountry.name : "Global situation"}<span>.</span></h1><p><strong>{stats.total}</strong> reports<span className="overview-dot">·</span><strong>{mappedCount}</strong> mapped<span className="overview-dot">·</span><span className={stats.critical ? "critical-inline" : ""}>{stats.critical} critical</span></p></div>
              <div className="map-top-actions"><button className="map-context-badge" onClick={() => setDialog("sources")}><span className="small-green-dot" />Live source reports</button><button className="map-share-button" onClick={shareMap} aria-label="Copy a link to this map view" title="Share this view"><ArrowUpRight size={15} /></button></div>
              {playbackHours > 0 && <div className="playback-banner"><Clock3 size={14} /><span>{playbackHours}h before reference time · snapshot filter, not historical reconstruction</span></div>}
              {isLoading && <div className="loading-live"><span className="loading-orbit" />Connecting to live sources…</div>}
              {!isLoading && visibleEvents.length === 0 && <div className="map-empty-state"><Search size={22} /><strong>{error ? "Live reports unavailable" : "No reports in this view"}</strong><p>{error ? "No substitute events are shown. Check the connection or retry." : "Try a wider time range or fewer filters. No reports does not mean nothing happened."}</p><button className="secondary-button" onClick={error ? refresh : resetFilters}>{error ? "Retry live feeds" : "Reset filters"}</button></div>}
              {!isLoading && visibleEvents.length > 0 && mappedCount === 0 && <div className="map-empty-state"><Radio size={22} /><strong>{hasLocatedReports ? "No reports meet this map density" : "Reports without map coordinates"}</strong><p>{hasLocatedReports ? "Minimal density hides reports without a high assessed severity. Switch to Standard to see all supplied locations." : "These sources did not supply incident coordinates. Read their reporting in the feed; Atlas does not invent locations."}</p><button className="secondary-button" onClick={() => { if (hasLocatedReports) setDensity("standard"); else { setShowFeed(true); setMobileFeed(isMobile); } }}>{hasLocatedReports ? "Show standard density" : "Open report feed"}</button></div>}
              {!showFeed && !hasDetail && <button className="floating-feed-button" onClick={() => setShowFeed(true)}><List size={16} />Event feed<span>{visibleEvents.length}</span></button>}
              <button className="map-expand-button" aria-label={showFeed ? "Expand map" : "Restore split view"} title={showFeed ? "Expand map" : "Restore split view"} onClick={() => setShowFeed((value) => !value)}><Maximize2 size={15} /></button>
            </>}
            {view === "timeline" && <TimelineView events={visibleEvents} referenceTime={referenceTime} onSelectEvent={selectEvent} />}
            {view === "briefing" && <Briefing events={visibleEvents} referenceTime={referenceTime} mode={mode} onSelectEvent={selectEvent} />}
            {view === "watchlist" && <Watchlist watchlist={watchlist} events={events} referenceTime={referenceTime} onSelectEvent={(event) => { changeView("map"); selectEvent(event); }} onSelectCountry={selectCountry} onRemove={(id) => setWatchlist((items) => items.filter((item) => item.id !== id))} onExplore={() => setCommandOpen(true)} onAlerts={() => setDialog("alerts")} alerts={alerts} />}
          </div>
          {asideVisible && view !== "watchlist" && <aside ref={sidebarRef} className={`event-sidebar ${hasDetail ? "detail-sidebar" : ""}`} aria-label={hasDetail ? "Selected intelligence" : "Event feed"}>
            {selectedEvent ? <EventDetail event={selectedEvent} onClose={closePanel} onSelectEvent={selectEvent} allEvents={events} referenceTime={referenceTime} isSaved={watchlist.some((item) => item.kind === "event" && item.value === selectedEvent.id)} onToggleSave={() => toggleWatch({ kind: "event", label: selectedEvent.title, value: selectedEvent.id })} /> : selectedCountry ? <CountryPanel country={selectedCountry} events={events} referenceTime={referenceTime} mode={mode} saved={watchlist.some((item) => item.kind === "country" && item.value === selectedCountry.code)} onClose={closePanel} onToggleSave={() => toggleWatch({ kind: "country", label: selectedCountry.name, value: selectedCountry.code })} onSelectEvent={selectEvent} /> : <>{missingRequestedEvent && <div className="missing-event-note"><span>This event is not in the current dataset. It may have aged out of the live feed.</span><button className="icon-button" aria-label="Dismiss unavailable event" onClick={() => setSelectedId(null)}><X size={14} /></button></div>}<EventFeed events={visibleEvents} selectedEventId={selectedId} onSelectEvent={selectEvent} referenceTime={referenceTime} mode={mode} isLoading={isLoading} onClearFilters={resetFilters} /></>}
          </aside>}
        </div>
        {view !== "watchlist" && data && <TimeRail events={events} referenceTime={referenceTime} playbackHours={playbackHours} onChange={(hours) => { setPlaybackHours(hours); setPlaying(false); }} playing={playing && playbackHours > 0} onTogglePlay={() => { if (playing && playbackHours > 0) setPlaying(false); else { if (playbackHours === 0) setPlaybackHours(24); setPlaying(true); } }} />}
        <footer className="workspace-status"><div><span className={`status-dot ${hasFeedProblems || error ? "amber" : hasHealthySource ? "green" : ""}`} /><strong>{connectionLabel}</strong><span className="status-divider">/</span><span>{stats.total} reports</span><span className="status-divider">/</span><span>{fetchedTimeText ? `Latest successful fetch ${fetchedTimeText} UTC` : "No successful feed fetch yet"}</span></div><div><button onClick={() => setDialog("sources")}><Radio size={12} /><span>Sources & status</span><ArrowUpRight size={11} /></button><span className="footer-utc">All times UTC</span></div></footer>
        <nav className="mobile-navigation" aria-label="Mobile workspace"><button className={view === "map" && !mobileFeed ? "active" : ""} onClick={() => { changeView("map"); setMobileFeed(false); }}><Globe2 size={18} /><span>Map</span></button><button className={mobileFeed ? "active" : ""} onClick={() => { changeView("map"); setShowFeed(true); setMobileFeed(true); }}><List size={18} /><span>Feed</span></button><button className={view === "timeline" ? "active" : ""} onClick={() => changeView("timeline")}><Activity size={18} /><span>Timeline</span></button><button className={view === "watchlist" ? "active" : ""} onClick={() => changeView("watchlist")}><Bookmark size={18} /><span>Saved</span></button><button onClick={() => setCommandOpen(true)}><Search size={18} /><span>Search</span></button></nav>
      </main>
    </div>
    <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} events={events} onSelectEvent={commandSelectEvent} onSelectCountry={selectCountry} onSearch={searchWorld} onSetCategory={showCategory} onSetView={changeView} />
    <WorkspaceDialogs dialog={dialog} onClose={closeDialog} filters={filters} onFilters={updateFilters} onReset={resetFilters} theme={theme} onTheme={setTheme} labels={showLabels} onLabels={setShowLabels} density={density} onDensity={setDensity} data={data} onRefresh={refresh} />
    <AlertDialog open={dialog === "alerts"} onClose={closeDialog} rules={alerts} onRules={setAlerts} onEnableNotifications={enableNotifications} notificationStatus={notificationStatus} />
    {toast && <div className="toast" role="status"><Check size={16} />{toast}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={13} /></button></div>}
  </div>;
}

function InfoIcon() { return <Sparkles size={13} aria-hidden="true" />; }
