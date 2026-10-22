"use client";

import { useCallback, useEffect, useState } from "react";
import { readLiveSnapshot } from "@/lib/live-data";
import type { EventsResponse } from "@/types";

export function useEvents() {
  const [snapshot, setSnapshot] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let stream: EventSource | null = null;

    function accept(value: unknown) {
      if (!active) return;
      const result = readLiveSnapshot(value);
      if (!result) throw new Error("Invalid live source response");
      setSnapshot(result);
      setReceivedAt(Date.now());
      setError(null);
    }

    async function refresh() {
      try {
        const response = await fetch("/api/events", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        accept(await response.json());
      } catch (cause) {
        if (active && !(cause instanceof DOMException && cause.name === "AbortError")) {
          setError("The live service is unavailable. Any previously loaded reports retain their original timestamps; nothing has been substituted.");
        }
      }
    }

    function connectStream() {
      if (!active || typeof EventSource === "undefined") return;
      stream = new EventSource("/api/stream");
      stream.onopen = () => { if (active) setConnected(true); };
      const handle = (message: MessageEvent<string>) => {
        try { accept(JSON.parse(message.data)); } catch {
          if (active) setError("An update failed source validation. Only previously validated reports are shown.");
        }
      };
      stream.addEventListener("events", handle);
      stream.onmessage = handle;
      stream.onerror = () => {
        if (!active) return;
        setConnected(false);
        // EventSource honors the server retry interval and reconnects itself.
      };
    }

    void refresh().then(connectStream);
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      controller.abort();
      stream?.close();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshIndex]);

  const refresh = useCallback(() => {
    setConnected(false);
    setError(null);
    setRefreshIndex((value) => value + 1);
  }, []);

  return {
    data: snapshot,
    isLoading: !snapshot && !error,
    error,
    connected,
    receivedAt,
    refresh
  };
}
