"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, Globe2, Minus, Plus, RotateCcw } from "lucide-react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  Popup,
} from "maplibre-gl";
import type { AtlasEvent, MapTheme, MapView } from "@/types";
import {
  countryCodeFromProperties,
  DEFAULT_MAP_VIEW,
  hasMappableCoordinates,
  isLiveMapEvent,
  isValidMapView,
  toSignalCollection,
  worldViewForWidth,
} from "./map-features";
import {
  clusterRadius,
  countryLabelFilter,
  createDisasterImage,
  createMapStyle,
  EMPTY_SIGNALS,
  INTERACTIVE_SIGNAL_LAYERS,
  LABEL_LAYERS,
  MAP_PALETTES,
  pointRadius,
  type MarkerDensity,
} from "./map-style";
import styles from "./WorldMap.module.css";

export interface WorldMapProps {
  events: AtlasEvent[];
  selectedEventId: string | null;
  onSelectEvent: (event: AtlasEvent) => void;
  onSelectCountry: (countryCode: string) => void;
  theme: MapTheme;
  showLabels: boolean;
  density: MarkerDensity;
  initialView?: MapView;
  focus?: {
    latitude: number;
    longitude: number;
    zoom?: number;
    nonce?: number;
  } | null;
  onViewChange?: (view: MapView) => void;
}

function motionDuration(duration: number): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : duration;
}

function getPointCoordinates(feature: MapGeoJSONFeature): [number, number] | null {
  if (feature.geometry.type !== "Point") return null;
  const [longitude, latitude] = feature.geometry.coordinates;
  return hasMappableCoordinates({ longitude, latitude })
    ? [longitude, latitude]
    : null;
}

function makeTooltip(event: AtlasEvent): HTMLElement {
  const element = document.createElement("div");
  element.className = styles.tooltip;

  const eyebrow = document.createElement("span");
  eyebrow.className = styles.tooltipEyebrow;
  eyebrow.textContent = [
    "SOURCE REPORT",
    ...new Set(event.sources.map((source) => source.name)),
  ].join(" · ");

  const title = document.createElement("strong");
  title.className = styles.tooltipTitle;
  title.textContent = event.title;

  const meta = document.createElement("span");
  meta.className = styles.tooltipMeta;
  meta.textContent = `${event.locationName} · ${
    event.severity === null ? "Severity unassessed" : `Severity ${event.severity}/7`
  }`;

  const basis = document.createElement("span");
  basis.className = styles.tooltipMeta;
  basis.textContent = event.severityReason
    ?? (event.severity === null
      ? "No severity assessment is available."
      : "Assessment basis unavailable.");

  const hint = document.createElement("span");
  hint.className = styles.tooltipHint;
  hint.textContent = "Select to explore sources";

  element.append(eyebrow, title, meta, basis, hint);
  return element;
}

function applyTheme(map: MapLibreMap, theme: MapTheme) {
  const colors = MAP_PALETTES[theme];
  map.setPaintProperty("ocean", "background-color", colors.background);
  map.setPaintProperty("graticule", "line-color", colors.grid);
  map.setPaintProperty("graticule", "line-opacity", theme === "dark" ? 0.09 : 0.13);
  map.setPaintProperty("countries-fill", "fill-color", [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    colors.hover,
    colors.land,
  ]);
  map.setPaintProperty("countries-border", "line-color", colors.border);
  map.setPaintProperty("country-labels", "text-color", colors.label);
  map.setPaintProperty("country-labels", "text-halo-color", colors.land);
  map.setPaintProperty("ocean-labels", "text-color", colors.oceanLabel);
  map.setPaintProperty("place-labels", "text-color", colors.cityLabel);
  map.setPaintProperty("place-labels", "text-halo-color", colors.land);
  map.setPaintProperty("signal-location-labels", "text-color", colors.cityLabel);
  map.setPaintProperty("signal-location-labels", "text-halo-color", colors.background);
  map.setPaintProperty("signal-clusters", "circle-color", colors.cluster);
  map.setPaintProperty("signal-cluster-counts", "text-color", colors.clusterText);
  map.setPaintProperty("signal-points", "circle-stroke-color", colors.background);
  map.setPaintProperty("selected-halo", "circle-color", colors.selection);
  map.setPaintProperty("selected-ring", "circle-stroke-color", colors.selection);
  map.setPaintProperty("selected-point", "circle-stroke-color", colors.background);
}

export default function WorldMap({
  events,
  selectedEventId,
  onSelectEvent,
  onSelectCountry,
  theme,
  showLabels,
  density,
  initialView,
  focus,
  onViewChange,
}: WorldMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [assetWarning, setAssetWarning] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_MAP_VIEW.zoom);
  const [retry, setRetry] = useState(0);

  const sourceEvents = useMemo(() => events.filter(isLiveMapEvent), [events]);
  const signals = useMemo(() => toSignalCollection(sourceEvents), [sourceEvents]);
  const eventsById = useMemo(
    () => new Map(sourceEvents.map((event) => [event.id, event])),
    [sourceEvents],
  );
  const missingLocations = sourceEvents.length - signals.features.length;
  const hasUnassessedSeverity = sourceEvents.some((event) => event.severity === null);
  const selectedSignal = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: signals.features.filter(
        (feature) => feature.properties.id === selectedEventId,
      ),
    }),
    [signals, selectedEventId],
  );

  const initialOptions = useRef({ initialView, theme, density, showLabels, signals });
  const callbacks = useRef({ onSelectEvent, onSelectCountry, onViewChange, eventsById });

  useEffect(() => {
    callbacks.current = { onSelectEvent, onSelectCountry, onViewChange, eventsById };
  }, [onSelectEvent, onSelectCountry, onViewChange, eventsById]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    let disposed = false;
    let localMap: MapLibreMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame = 0;
    let loadTimeout = 0;

    async function initialize() {
      try {
        const { Map: MapLibre, Popup: MapPopup, LngLat, setWorkerUrl } = await import("maplibre-gl");
        if (disposed) return;

        // MapLibre 6 ships a separate module worker with a sibling shared
        // module. Next's application chunks cannot serve that sibling path.
        // Both matching distribution files are hosted locally.
        setWorkerUrl(
          new URL("/data/maplibre/maplibre-gl-worker.mjs", window.location.href).href,
        );

        const options = initialOptions.current;
        const view = isValidMapView(options.initialView)
          ? options.initialView
          : worldViewForWidth(element!.clientWidth);

        const map = new MapLibre({
          container: element!,
          style: createMapStyle(options),
          center: [view.longitude, view.latitude],
          zoom: view.zoom,
          minZoom: -1,
          maxZoom: 9,
          maxPitch: 0,
          attributionControl: false,
          dragRotate: false,
          renderWorldCopies: false,
          localIdeographFontFamily: false,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          canvasContextAttributes: { antialias: true },
          fadeDuration: motionDuration(180),
        });

        localMap = map;
        mapRef.current = map;
        // Default Mercator constraints force the world to fill the viewport's
        // height, which prevents fitting its width on portrait displays.
        // Bound the camera itself, allowing neutral space above/below the world.
        // This does not alter any event geometry or its location precision.
        map.setTransformConstrain((center, zoom) => ({
          center: new LngLat(
            Math.max(-180, Math.min(center.lng, 180)),
            Math.max(-80, Math.min(center.lat, 85)),
          ),
          zoom: Math.max(-1, Math.min(zoom, 9)),
        }));
        map.jumpTo({ center: [view.longitude, view.latitude], zoom: view.zoom });
        map.touchZoomRotate.disableRotation();
        map.getCanvas().setAttribute(
          "aria-label",
          "World event map. Use arrow keys to pan and plus or minus to zoom. Events are also available in the signal list.",
        );

        const popup = new MapPopup({
          closeButton: false,
          closeOnClick: false,
          offset: 15,
          maxWidth: "290px",
          className: styles.popup,
        });
        popupRef.current = popup;

        map.setMissingStyleImageResolver((id) => {
          if (id === "disaster-diamond" && !map.hasImage(id)) {
            map.addImage(id, createDisasterImage(), { pixelRatio: 2 });
          }
        });

        let loaded = false;
        let hoveredCountry: string | number | null = null;
        let hoveredEvent: string | null = null;

        loadTimeout = window.setTimeout(() => {
          if (!disposed && !loaded) {
            setMapError("The interactive map is taking longer than expected to load.");
          }
        }, 18_000);

        map.on("load", () => {
          if (disposed) return;
          loaded = true;
          window.clearTimeout(loadTimeout);
          if (!map.hasImage("disaster-diamond")) {
            map.addImage("disaster-diamond", createDisasterImage(), { pixelRatio: 2 });
          }
          setReady(true);
          setMapError(null);
          setZoomLevel(map.getZoom());
          const center = map.getCenter();
          callbacks.current.onViewChange?.({
            latitude: center.lat,
            longitude: center.lng,
            zoom: map.getZoom(),
          });
        });

        map.on("error", (error) => {
          if (disposed) return;
          const message = error.error?.message ?? "";
          if (/webgl|context lost|gpu/i.test(message) && !loaded) {
            setMapError("This browser could not initialize the interactive map.");
          } else if (/fetch|network|404|glyph|source/i.test(message)) {
            setAssetWarning(true);
          }
        });

        map.on("webglcontextlost", () => {
          if (!disposed) {
            setMapError("The browser paused the map’s graphics context.");
          }
        });

        map.on("webglcontextrestored", () => {
          if (!disposed) setMapError(null);
        });

        map.on("moveend", () => {
          if (disposed) return;
          const center = map.getCenter().wrap();
          setZoomLevel(map.getZoom());
          callbacks.current.onViewChange?.({
            latitude: Number(center.lat.toFixed(5)),
            longitude: Number(center.lng.toFixed(5)),
            zoom: Number(map.getZoom().toFixed(2)),
          });
        });

        map.on("dragstart", () => popup.remove());

        function clearCountryHover() {
          if (hoveredCountry !== null) {
            map.setFeatureState(
              { source: "countries", id: hoveredCountry },
              { hover: false },
            );
            hoveredCountry = null;
          }
        }

        map.on("mousemove", (event) => {
          if (!loaded || map.isMoving()) return;

          const hits = map.queryRenderedFeatures(event.point, {
            layers: [
              ...INTERACTIVE_SIGNAL_LAYERS,
              "countries-fill",
            ],
          });
          const signal = hits.find((hit) => hit.source === "signals" || hit.source === "selection");

          if (signal) {
            clearCountryHover();
            map.getCanvas().style.cursor = "pointer";
            const id = signal.properties?.id;
            const atlasEvent =
              typeof id === "string" ? callbacks.current.eventsById.get(id) : undefined;

            if (atlasEvent && hasMappableCoordinates(atlasEvent)) {
              if (hoveredEvent !== id || !popup.isOpen()) {
                popup
                  .setLngLat([atlasEvent.longitude, atlasEvent.latitude])
                  .setDOMContent(makeTooltip(atlasEvent))
                  .addTo(map);
                hoveredEvent = id;
              }
            } else {
              hoveredEvent = null;
              popup.remove();
            }
            return;
          }

          hoveredEvent = null;
          popup.remove();
          const country = hits.find((hit) => hit.source === "countries");
          const code = countryCodeFromProperties(country?.properties ?? null);
          map.getCanvas().style.cursor = code ? "pointer" : "";

          if (country?.id !== undefined && country.id !== hoveredCountry && code) {
            clearCountryHover();
            hoveredCountry = country.id;
            map.setFeatureState(
              { source: "countries", id: hoveredCountry },
              { hover: true },
            );
          } else if (!country || !code) {
            clearCountryHover();
          }
        });

        map.getCanvas().addEventListener("mouseleave", () => {
          hoveredEvent = null;
          popup.remove();
          clearCountryHover();
          map.getCanvas().style.cursor = "";
        });

        map.on("click", async (event) => {
          if (!loaded) return;
          const hits = map.queryRenderedFeatures(event.point, {
            layers: [
              ...INTERACTIVE_SIGNAL_LAYERS,
              "countries-fill",
            ],
          });
          const signal = hits.find((hit) => hit.source === "signals" || hit.source === "selection");

          if (signal && signal.properties?.cluster_id !== undefined) {
            const coordinates = getPointCoordinates(signal);
            const source = map.getSource("signals") as GeoJSONSource | undefined;
            if (!source || !coordinates) return;

            try {
              const zoom = await source.getClusterExpansionZoom(
                Number(signal.properties.cluster_id),
              );
              if (!disposed) {
                map.easeTo({
                  center: coordinates,
                  zoom: Math.min(zoom, 9),
                  duration: motionDuration(650),
                });
              }
            } catch {
              // The user may have filtered the collection while this lookup was running.
              // A stale cluster is harmless and will be replaced in the next render.
            }
            return;
          }

          const id = signal?.properties?.id;
          if (typeof id === "string") {
            const atlasEvent = callbacks.current.eventsById.get(id);
            if (atlasEvent) {
              popup.remove();
              callbacks.current.onSelectEvent(atlasEvent);
              return;
            }
          }

          const country = hits.find((hit) => hit.source === "countries");
          const code = countryCodeFromProperties(country?.properties ?? null);
          if (code) callbacks.current.onSelectCountry(code);
        });

        resizeObserver = new ResizeObserver(() => {
          window.cancelAnimationFrame(resizeFrame);
          resizeFrame = window.requestAnimationFrame(() => {
            if (!disposed) map.resize();
          });
        });
        resizeObserver.observe(element!);
      } catch {
        if (!disposed) {
          setMapError("This browser could not initialize the interactive map.");
        }
      }
    }

    void initialize();

    return () => {
      disposed = true;
      window.clearTimeout(loadTimeout);
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      popupRef.current?.remove();
      localMap?.remove();
      if (mapRef.current === localMap) mapRef.current = null;
    };
  }, [retry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("signals") as GeoJSONSource | undefined;
    source?.setData(signals);
    popupRef.current?.remove();
  }, [signals, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("selection") as GeoJSONSource | undefined;
    source?.setData(selectedSignal.features.length ? selectedSignal : EMPTY_SIGNALS);
  }, [selectedSignal, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyTheme(map, theme);
  }, [theme, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const id of LABEL_LAYERS) {
      map.setLayoutProperty(
        id,
        "visibility",
        showLabels && (id !== "signal-location-labels" || density === "detailed")
          ? "visible"
          : "none",
      );
    }
    map.setLayoutProperty(
      "country-labels",
      "text-padding",
      density === "minimal" ? 25 : 12,
    );
    map.setFilter("country-labels", countryLabelFilter(density));
    map.setPaintProperty("signal-points", "circle-radius", pointRadius(density));
    map.setLayoutProperty("disaster-points", "icon-size", density === "minimal" ? 0.8 : 1);
    const source = map.getSource("signals") as GeoJSONSource | undefined;
    source?.setClusterOptions({
      cluster: true,
      clusterRadius: clusterRadius(density),
    }).catch(() => {
      // The source can disappear if its map is unmounted during a worker update.
    });
  }, [showLabels, density, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    if (!hasMappableCoordinates(focus)) return;
    map.flyTo({
      center: [focus.longitude, focus.latitude],
      zoom: Number.isFinite(focus.zoom)
        ? Math.max(-1, Math.min(focus.zoom!, 9))
        : Math.max(map.getZoom(), 4.1),
      duration: motionDuration(900),
      essential: false,
    });
  }, [focus, ready]);

  function resetView() {
    const worldView = worldViewForWidth(container.current?.clientWidth ?? 1024);
    mapRef.current?.flyTo({
      center: [worldView.longitude, worldView.latitude],
      zoom: worldView.zoom,
      bearing: 0,
      pitch: 0,
      duration: motionDuration(850),
    });
  }

  function retryMap() {
    setReady(false);
    setMapError(null);
    setAssetWarning(false);
    setRetry((value) => value + 1);
  }

  return (
    <div className={`${styles.root} ${theme === "light" ? styles.light : ""}`}>
      <div ref={container} className={styles.canvas} data-testid="world-map" />

      {!ready && !mapError && (
        <div className={styles.loading} role="status">
          <span className={styles.loadingGlobe}><Globe2 size={24} strokeWidth={1.2} /></span>
          <span>Preparing your world view</span>
          <span className={styles.loadingDetail}>Loading local map layers</span>
        </div>
      )}

      {mapError && (
        <div className={styles.fallback} role="status">
          <Globe2 size={34} strokeWidth={1.1} />
          <h3>There’s still a world to explore.</h3>
          <p>{mapError} All event details and sources remain available in the signal list.</p>
          <button type="button" onClick={retryMap}>
            <RotateCcw size={14} />
            Retry map
          </button>
          <small>WebGL must be enabled for the interactive map.</small>
        </div>
      )}

      {assetWarning && !mapError && (
        <p className={styles.assetWarning} role="status">
          Some map assets could not load. Event details remain available in the signal list.
        </p>
      )}

      <div className={styles.legend} aria-label="Map marker legend">
        <span className={styles.legendTitle}>SEVERITY · SOURCE / DERIVED</span>
        <div className={styles.legendItems}>
          {hasUnassessedSeverity && (
            <span aria-label="Severity unassessed"><i className={styles.unassessed} />Unassessed</span>
          )}
          <span aria-label="Low severity band, levels 1 and 2"><i className={styles.low} />Low</span>
          <span aria-label="Elevated severity band, levels 3 and 4"><i className={styles.elevated} />Elevated</span>
          <span aria-label="High severity band, levels 5 and 6"><i className={styles.high} />High</span>
          <span aria-label="Critical severity, level 7"><i className={styles.critical} />Critical</span>
          <span className={styles.disasterLegend}><i className={styles.disaster} />Assessed disaster</span>
        </div>
        {missingLocations > 0 && (
          <span className={styles.missingLocations}>
            {missingLocations} {missingLocations === 1 ? "signal has" : "signals have"} no mappable location
          </span>
        )}
      </div>

      <div className={styles.navigation} aria-label="Map navigation">
        <div className={styles.zoomButtons}>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={!ready || zoomLevel >= 9}
            onClick={() => mapRef.current?.zoomIn({ duration: motionDuration(250) })}
          >
            <Plus size={17} strokeWidth={1.5} />
          </button>
          <span />
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={!ready || zoomLevel <= -1}
            onClick={() => mapRef.current?.zoomOut({ duration: motionDuration(250) })}
          >
            <Minus size={17} strokeWidth={1.5} />
          </button>
        </div>
        <button
          type="button"
          className={styles.resetButton}
          aria-label="Reset to world view, north up"
          title="Reset world view"
          disabled={!ready}
          onClick={resetView}
        >
          <Compass size={17} strokeWidth={1.35} />
        </button>
        <span className={styles.northLabel} aria-hidden="true">N</span>
      </div>

      <div className={styles.attribution}>
        <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>
        <span aria-hidden="true">·</span>
        <a href="https://maplibre.org/" target="_blank" rel="noreferrer">MapLibre</a>
        <span className={styles.boundaryNote}>Boundaries are illustrative</span>
      </div>
    </div>
  );
}
