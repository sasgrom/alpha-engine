import type { KeyboardEvent } from "react";

export type AnalyticsStatus = "done" | "partial" | "missing" | "blocked";
export type AnalyticsNode = {
  id: string;
  title: string;
  status: AnalyticsStatus;
  detail: string;
  next: string;
};
export type AnalyticsMode = "actual" | "target";

type Props = {
  mode: AnalyticsMode;
  nodes: readonly AnalyticsNode[];
  selectedId?: string | null;
  onSelect: (node: AnalyticsNode) => void;
};

const layout: Record<string, { x: number; y: number }> = {
  fetch: { x: 30, y: 60 }, tone: { x: 30, y: 160 }, raw13f: { x: 30, y: 260 }, fundamentals: { x: 30, y: 360 }, prices: { x: 30, y: 460 }, macro: { x: 30, y: 560 }, optionsRaw: { x: 30, y: 660 },
  cusip: { x: 330, y: 60 }, factorLib: { x: 330, y: 160 }, shareFlows: { x: 330, y: 260 }, optionFeatures: { x: 330, y: 360 }, macroPrior: { x: 330, y: 460 }, guidance: { x: 330, y: 560 }, qa: { x: 330, y: 660 },
  probability: { x: 630, y: 60 }, rollingIc: { x: 630, y: 160 }, magnitude: { x: 630, y: 260 }, nestedEval: { x: 630, y: 360 }, costs: { x: 630, y: 460 }, calibration: { x: 630, y: 560 }, backtest: { x: 630, y: 660 },
  panel: { x: 930, y: 60 }, crossValidation: { x: 930, y: 160 }, portfolio: { x: 930, y: 260 }, workerInfra: { x: 930, y: 360 }, storage: { x: 930, y: 460 }, ui: { x: 930, y: 560 }, scheduler: { x: 930, y: 660 },
  fullUniverse: { x: 30, y: 60 }, dailyPrices: { x: 30, y: 160 }, pointInTime: { x: 30, y: 260 }, optionsHistory: { x: 30, y: 360 }, macroPack: { x: 30, y: 460 }, edgarToneQA: { x: 330, y: 60 }, shareFlowsTarget: { x: 330, y: 160 }, optionFeaturesTarget: { x: 330, y: 260 }, featurePanel: { x: 330, y: 360 }, sectorNeutral: { x: 330, y: 460 },
  magnitudeModel: { x: 630, y: 60 }, robustBacktest: { x: 630, y: 160 }, capacityCosts: { x: 630, y: 260 }, portfolioRisk: { x: 630, y: 360 }, independentValidation: { x: 630, y: 460 },
  execution: { x: 930, y: 60 }, monitoringQA: { x: 930, y: 160 }, storageBackup: { x: 930, y: 260 }, alphaEvidence: { x: 930, y: 360 }, paperTrading: { x: 930, y: 460 },
};

const actualEdges: [string, string][] = [
  ["fetch", "tone"], ["raw13f", "shareFlows"], ["fundamentals", "factorLib"], ["prices", "factorLib"], ["macro", "macroPrior"], ["optionsRaw", "optionFeatures"], ["cusip", "raw13f"], ["tone", "probability"], ["shareFlows", "factorLib"], ["factorLib", "probability"], ["macroPrior", "probability"], ["probability", "nestedEval"], ["nestedEval", "magnitude"], ["magnitude", "backtest"], ["backtest", "crossValidation"], ["crossValidation", "portfolio"], ["qa", "fundamentals"], ["qa", "optionsRaw"], ["qa", "raw13f"], ["workerInfra", "storage"], ["storage", "ui"], ["ui", "scheduler"], ["scheduler", "backtest"]
];
const targetEdges: [string, string][] = [
  ["fullUniverse", "featurePanel"], ["dailyPrices", "pointInTime"], ["pointInTime", "featurePanel"], ["optionsHistory", "optionFeatures"], ["macroPack", "featurePanel"], ["edgarToneQA", "featurePanel"], ["shareFlows", "featurePanel"], ["featurePanel", "magnitudeModel"], ["sectorNeutral", "magnitudeModel"], ["magnitudeModel", "robustBacktest"], ["robustBacktest", "capacityCosts"], ["capacityCosts", "portfolioRisk"], ["portfolioRisk", "execution"], ["execution", "paperTrading"], ["paperTrading", "alphaEvidence"], ["robustBacktest", "independentValidation"], ["independentValidation", "alphaEvidence"], ["monitoringQA", "robustBacktest"], ["storageBackup", "fullUniverse"], ["storageBackup", "optionsHistory"]
];

const statusMeta: Record<AnalyticsStatus, { label: string; color: string; fill: string }> = {
  done: { label: "Done", color: "hsl(var(--ok))", fill: "hsl(var(--ok) / 0.12)" },
  partial: { label: "Partial", color: "hsl(var(--warn))", fill: "hsl(var(--warn) / 0.12)" },
  missing: { label: "Missing / unproven", color: "hsl(var(--crit))", fill: "hsl(var(--crit) / 0.12)" },
  blocked: { label: "Blocked", color: "hsl(var(--muted-foreground))", fill: "hsl(var(--muted-foreground) / 0.12)" },
};

function center(node: AnalyticsNode) {
  const p = layout[node.id] ?? { x: 30, y: 60 };
  return { x: p.x + 115, y: p.y + 38 };
}
function edgePath(a: AnalyticsNode, b: AnalyticsNode) {
  const p = center(a), q = center(b), mx = (p.x + q.x) / 2;
  return `M${p.x},${p.y} C${mx},${p.y} ${mx},${q.y} ${q.x},${q.y}`;
}

export default function AnalyticsNetwork({ mode, nodes, selectedId, onSelect }: Props) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n] as const));
  const edges = (mode === "actual" ? actualEdges : targetEdges).filter(([a, b]) => byId[a] && byId[b]);
  const onKey = (event: KeyboardEvent, node: AnalyticsNode) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(node);
    }
  };
  return (
    <svg viewBox="0 0 1260 760" width="100%" role="img" aria-label={`${mode} project network`} style={{ display: "block", minWidth: 760 }}>
      <defs>
        <marker id="analytics-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="hsl(var(--muted-foreground))" />
        </marker>
      </defs>
      {edges.map(([a, b]) => <path key={`${a}-${b}`} d={edgePath(byId[a], byId[b])} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1.2} markerEnd="url(#analytics-arrow)" />)}
      {nodes.map((node) => {
        const meta = statusMeta[node.status];
        const pos = layout[node.id] ?? { x: 30, y: 60 };
        const selected = selectedId === node.id;
        return (
          <g key={node.id} role="button" tabIndex={0} onClick={() => onSelect(node)} onKeyDown={(e) => onKey(e, node)} style={{ cursor: "pointer", outline: "none" }} aria-label={`${node.title}: ${meta.label}`}>
            <rect x={pos.x} y={pos.y} width={230} height={76} rx={10} fill={meta.fill} stroke={meta.color} strokeWidth={selected ? 2.5 : 1.3} />
            <text x={pos.x + 14} y={pos.y + 27} fill="hsl(var(--foreground))" fontSize={13} fontWeight={500} fontFamily="var(--kimi-font-sans)">{node.title}</text>
            <text x={pos.x + 14} y={pos.y + 52} fill={meta.color} fontSize={11} fontFamily="var(--kimi-font-sans)">{meta.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
