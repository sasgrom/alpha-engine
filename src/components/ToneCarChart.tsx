import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toneCarSeries, toneEventMeta } from "@/data/tone-event-study";

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

export default function ToneCarChart() {
  return (
    <section className="t-panel px-5 py-4" aria-labelledby="tone-car-title">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div className="t-label">EDGAR tone event study</div>
          <h2 id="tone-car-title" className="t-mono text-[18px] font-semibold tracking-[0.04em] text-foreground mt-1">Mean cumulative abnormal return</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground mt-2">{toneEventMeta.model} · {toneEventMeta.events.toLocaleString("en-US")} events</p>
        </div>
        <div className="t-mono text-[10px] text-muted-foreground max-w-md text-right">{toneEventMeta.note}</div>
      </div>
      <div className="h-[280px] w-full" data-testid="tone-car-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...toneCarSeries]} margin={{ top: 12, right: 20, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="horizon" tickFormatter={(value) => `${value}d`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={{ stroke: "hsl(var(--border))" }} />
            <YAxis tickFormatter={percent} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={{ stroke: "hsl(var(--border))" }} width={72} />
            <Tooltip
              formatter={(value) => [percent(Number(value)), "Mean CAR"]}
              labelFormatter={(value) => `${value} trading sessions after disclosure`}
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, color: "hsl(var(--popover-foreground))", fontSize: 12 }}
              itemStyle={{ color: "hsl(var(--popover-foreground))" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line isAnimationActive={false} type="monotone" dataKey="all" name="All filings" stroke="hsl(217 15% 65%)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line isAnimationActive={false} type="monotone" dataKey="positive" name="Positive tone ≥ 0.2" stroke="hsl(158 64% 52%)" strokeWidth={2.2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line isAnimationActive={false} type="monotone" dataKey="negative" name="Negative tone ≤ −0.2" stroke="hsl(0 91% 71%)" strokeWidth={2.2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
