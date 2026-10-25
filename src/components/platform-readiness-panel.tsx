"use client";
import { readinessIndicators } from "@/lib/platform-readiness";

export function PlatformReadinessPanel() {
  return <aside aria-label="Platform readiness" className="card" style={{ marginTop: 16 }}>
    <div className="eyebrow">Platform readiness · SIMULATION ONLY</div>
    <div className="grid grid-3" style={{ marginTop: 12 }}>{readinessIndicators().map((item) => <div key={item.name} className="panel"><strong>{item.name}</strong><div className="muted">{item.status === "disabled" ? "Disabled" : "Sandbox only"}</div><small>{item.detail}</small></div>)}</div>
  </aside>;
}
