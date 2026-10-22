"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import type { AtlasEvent } from "@/types";

export function TimeRail({ events, referenceTime, playbackHours, onChange, playing, onTogglePlay }: {
  events: AtlasEvent[];
  referenceTime: string;
  playbackHours: number;
  onChange: (hours: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const bars = useMemo(() => {
    const now = new Date(referenceTime).getTime();
    const counts = Array.from({ length: 72 }, () => 0);
    for (const event of events) {
      const bin = Math.floor((new Date(event.lastUpdatedAt).getTime() - (now - 86_400_000)) / 1_200_000);
      if (bin >= 0 && bin < 72) counts[bin] += 1;
    }
    const max = Math.max(...counts, 1);
    return counts.map((count) => ({ count, height: count ? 5 + (count / max) * 23 : 0 }));
  }, [events, referenceTime]);
  const now = new Date(referenceTime).getTime();
  const labelAt = (hours: number) => new Date(now - hours * 3_600_000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  return <section className="time-rail" aria-label="24-hour event playback">
    <div className="time-rail-title"><span className="eyebrow">REPORT ACTIVITY</span><strong>Past 24 hours <span>UTC</span></strong></div>
    <button className={`play-button ${playing ? "is-playing" : ""}`} aria-label={playing ? "Pause playback" : "Play the past 24 hours"} onClick={onTogglePlay}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
    <div className="time-track">
      <div className="activity-bars" aria-hidden="true">{bars.map((bar, i) => <span key={i} className={i > ((24 - playbackHours) / 24) * 71 ? "future-bar" : ""} style={{ height: `${bar.height}px` }} />)}</div>
      <input type="range" aria-label="Hours before reference time" aria-valuetext={playbackHours === 0 ? "Reference time, most recent events" : `${playbackHours} hours ago, snapshot view`} min={0} max={24} step={0.5} value={24 - playbackHours} onChange={(event) => onChange(24 - Number(event.target.value))} />
      <div className="time-ticks"><span>{labelAt(24)}</span><span>{labelAt(18)}</span><span>{labelAt(12)}</span><span>{labelAt(6)}</span><span>{playbackHours ? labelAt(playbackHours) : "NOW"}</span></div>
    </div>
    <button className={`now-button ${playbackHours === 0 ? "at-now" : ""}`} onClick={() => onChange(0)} title="Return to the reference time">{playbackHours > 0 ? <RotateCcw size={12} /> : <span className="status-dot" />}<span>{playbackHours > 0 ? "Reset" : "Latest"}</span></button>
  </section>;
}
