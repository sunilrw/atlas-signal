"use client";

import { useState } from "react";
import { Bell, Plus, Trash2 } from "lucide-react";
import { CATEGORY_META, countries, SEVERITY_META } from "@/lib/catalog";
import { Dialog } from "@/components/ui/Dialog";
import type { AlertRule, EventCategory } from "@/types";

export function AlertDialog({ open, onClose, rules, onRules, onEnableNotifications, notificationStatus }: {
  open: boolean;
  onClose: () => void;
  rules: AlertRule[];
  onRules: (rules: AlertRule[]) => void;
  onEnableNotifications: () => void;
  notificationStatus: string;
}) {
  const [countryCode, setCountryCode] = useState("");
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [severity, setSeverity] = useState(5);
  const addRule = () => {
    const countryName = countries.find((country) => country.code === countryCode)?.name ?? "Worldwide";
    const name = `${countryName} · ${category === "all" ? "All reports" : CATEGORY_META[category].label} · ${severity === 1 ? "Any severity" : `${SEVERITY_META[severity as keyof typeof SEVERITY_META].label}+`}`;
    if (rules.some((rule) => rule.countryCode === countryCode && rule.category === category && rule.minSeverity === severity)) return;
    onRules([...rules, { id: crypto.randomUUID(), name, countryCode, category, minSeverity: severity, enabled: true }]);
  };
  return <Dialog open={open} title="A signal, not more noise." onClose={onClose}>
    <p className="dialog-description">Local rules for newly received live events. Alerts work only while this workspace is open.</p>
    <div className="notification-permission"><Bell size={20} /><div><strong>Browser notifications</strong><span>{notificationStatus}</span></div><button className="secondary-button" onClick={onEnableNotifications}>Enable</button></div>
    <fieldset className="filter-field"><legend>CREATE A RULE</legend><div className="filter-columns"><label className="filter-field"><span>PLACE</span><select aria-label="Alert country" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}><option value="">Worldwide</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label><label className="filter-field"><span>CATEGORY</span><select aria-label="Alert category" value={category} onChange={(event) => setCategory(event.target.value as EventCategory | "all")}><option value="all">All categories</option>{Object.entries(CATEGORY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label></div><label className="filter-field"><span>MINIMUM ASSESSED SEVERITY</span><select aria-label="Alert minimum severity" value={severity} onChange={(event) => setSeverity(Number(event.target.value))}>{Object.entries(SEVERITY_META).map(([value, meta]) => <option key={value} value={value}>{value === "1" ? "Any severity, including unassessed" : `${meta.label} and above`}</option>)}</select><p className="field-help">Higher thresholds exclude news reports with unassessed impact. A country rule matches source-supplied incident country metadata, not the publisher’s origin.</p></label><button className="primary-button" onClick={addRule} disabled={rules.length >= 100}><Plus size={14} /> Add rule</button></fieldset>
    <h3 className="section-label">YOUR RULES</h3><div className="alert-rules">{!rules.length ? <p className="muted">No alert rules yet.</p> : rules.map((rule) => <div key={rule.id}><label><input type="checkbox" checked={rule.enabled} onChange={() => onRules(rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))} /><span>{rule.name}</span></label><button className="icon-button" aria-label={`Delete alert ${rule.name}`} onClick={() => onRules(rules.filter((item) => item.id !== rule.id))}><Trash2 size={15} /></button></div>)}</div>
    <p className="field-help">These are convenience notifications, not an emergency warning system. No email, server-side delivery, or background monitoring is enabled.</p>
  </Dialog>;
}
