/**
 * The money map (owner, 2026-11-26: "create new look per your recommendations"): a flat, fast map of the tracked
 * funds' money. Sectors are districts and companies tiles, sized by what the funds hold; a tile's colour is the
 * quarter's net flow against the value held (or the stock's return since, or the value held); the largest sums moved
 * between sectors run as streams, as wide as the dollars, red where they leave and blue where they arrive; people
 * stand as pins in the district where their fund bought most. Drag to move, scroll to zoom: the map never moves by
 * itself, except when the reader asks to fit it or to zoom to a district.
 *
 * One 2D canvas, redrawn only when something changes (and while streams run, unless the reader prefers less motion).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { ChartPalette } from "../../charts/color";
import { labelInk } from "../../charts/color";
import { anchorOf, type MapPlan, type Tile } from "./layout";

export interface MapPerson {
  cik: number;
  /** The name on the pin's label (a person, or the firm). */
  label: string;
  initials: string;
  /** 0..1, from the fund's tracked value (log scale). */
  size: number;
  /** The book's quarter against all tracked funds. */
  tone: "up" | "down" | "flat";
  /** Famous faces carry their name on the map; other pins show it on hover. */
  named: boolean;
  /** An insider: the company it trades (its pin stands on that tile, and a click picks the company). */
  company?: number;
}
export interface MapStream { from: string; to: string; usd: number }
export interface MapThread { id: number; usd: number; way: "in" | "out" }
export type MapPick = { kind: "company"; id: number } | { kind: "fund"; id: number } | { kind: "sector"; name: string } | { kind: "none" };

interface Props {
  plan: MapPlan;
  /** Tile fills of the quarter shown. */
  fills: Map<number, string>;
  people: MapPerson[];
  positions: Map<number, { x: number; y: number }>;
  streams: MapStream[];
  selection: { kind: "fund" | "company" | null; id: number | null; threads: MapThread[] };
  focus: string | null;
  /** A short figure per district, written after its name ("+$12.3B"). */
  districtNote: (name: string) => string;
  describeTile: (tile: Tile) => string[];
  describePerson: (cik: number) => string[];
  palette: ChartPalette;
  dark: boolean;
  /** Room taken by panels over the canvas, in pixels: the map fits into what is left. */
  inset: { left: number; right: number; top: number; bottom: number };
  onPick: (pick: MapPick) => void;
  /** Changes whenever the quarter changes: tiles fade from the old colours to the new. */
  quarterKey: string;
}

interface Camera { x: number; y: number; k: number }

const prefersLessMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function MoneyMap(props: Props) {
  const { plan, fills, people, positions, streams, selection, focus, palette, dark, inset, onPick, quarterKey } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const camera = useRef<Camera>({ x: 0, y: 0, k: 1 });
  const moved = useRef(false);
  const flight = useRef<{ from: Camera; to: Camera; start: number; ms: number } | null>(null);
  const fade = useRef<{ from: Map<number, string>; start: number } | null>(null);
  const lastFills = useRef<Map<number, string>>(fills);
  const dirty = useRef(true);
  const hover = useRef<{ kind: "tile" | "person"; id: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const lessMotion = useMemo(prefersLessMotion, []);

  const fitCamera = useCallback((rect?: { x0: number; y0: number; x1: number; y1: number }): Camera => {
    const { w, h } = size.current;
    const box = rect ?? { x0: 0, y0: 0, x1: plan.width, y1: plan.height };
    const availW = Math.max(120, w - inset.left - inset.right - 24);
    const availH = Math.max(120, h - inset.top - inset.bottom - 24);
    const k = Math.min(availW / (box.x1 - box.x0), availH / (box.y1 - box.y0));
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const screenCx = inset.left + 12 + availW / 2, screenCy = inset.top + 12 + availH / 2;
    return { k, x: cx - screenCx / k, y: cy - screenCy / k };
  }, [plan, inset.left, inset.right, inset.top, inset.bottom]);

  const flyTo = useCallback((to: Camera, ms = 420) => {
    if (lessMotion) { camera.current = to; dirty.current = true; return; }
    flight.current = { from: { ...camera.current }, to, start: performance.now(), ms };
  }, [lessMotion]);

  // size the canvas to its box; fit the map until the reader has moved it
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: rect.width, h: rect.height, dpr };
      if (canvas.current) {
        canvas.current.width = Math.round(rect.width * dpr);
        canvas.current.height = Math.round(rect.height * dpr);
      }
      if (!moved.current) camera.current = fitCamera();
      dirty.current = true;
    };
    resize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitCamera]);

  // a new quarter: fade from the colours shown to the new ones
  useEffect(() => {
    fade.current = lessMotion ? null : { from: lastFills.current, start: performance.now() };
    lastFills.current = fills;
    dirty.current = true;
  }, [quarterKey, fills, lessMotion]);
  useEffect(() => { dirty.current = true; }, [people, positions, streams, selection, focus, palette, dark, inset]);

  // a district picked elsewhere (the panel, a stream's end): zoom to it; cleared: back to the whole map
  const lastFocus = useRef<string | null>(focus);
  useEffect(() => {
    if (lastFocus.current === focus) return;
    lastFocus.current = focus;
    const district = focus ? plan.districtByName.get(focus) : null;
    moved.current = Boolean(district);
    flyTo(district ? fitCamera(district) : fitCamera());
  }, [focus, plan, fitCamera, flyTo]);

  // the drawing loop
  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const p = latest.current;
      const flying = flight.current;
      if (flying) {
        const t = Math.min(1, (now - flying.start) / flying.ms);
        const e = 1 - (1 - t) ** 3;
        camera.current = { x: flying.from.x + (flying.to.x - flying.from.x) * e, y: flying.from.y + (flying.to.y - flying.from.y) * e, k: flying.from.k + (flying.to.k - flying.from.k) * e };
        if (t >= 1) flight.current = null;
        dirty.current = true;
      }
      const fading = fade.current && now - fade.current.start < 500;
      const running = !lessMotion && p.streams.length > 0 && !p.selection.kind && !document.hidden;
      if (!dirty.current && !fading && !running) return;
      dirty.current = Boolean(fading);
      render(now);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // render reads everything through `latest`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessMotion]);

  function toScreen(x: number, y: number) {
    const c = camera.current;
    return { x: (x - c.x) * c.k, y: (y - c.y) * c.k };
  }

  function render(now: number) {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const p = latest.current;
    const { w, h, dpr } = size.current;
    const c = camera.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const ink = p.palette.ink, muted = p.palette.muted;

    // districts
    for (const district of p.plan.districts) {
      const a = toScreen(district.x0, district.y0), b = toScreen(district.x1, district.y1);
      if (b.x < 0 || b.y < 0 || a.x > w || a.y > h) continue;
      const dim = p.focus && p.focus !== district.name;
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.fillStyle = p.dark ? "rgba(255,255,255,0.035)" : "rgba(11,11,11,0.035)";
      roundRect(ctx, a.x, a.y, b.x - a.x, b.y - a.y, 6);
      ctx.fill();
      // the district's name sits in the strip the plan leaves above its tiles (22 map units)
      const strip = 22 * c.k;
      const labelSize = Math.min(15, strip * 0.78);
      if (b.x - a.x > 60 && labelSize >= 9) {
        ctx.font = `600 ${labelSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = ink;
        ctx.textBaseline = "middle";
        const note = p.districtNote(district.name);
        const y = a.y + strip / 2 + 1;
        clipText(ctx, district.name, a.x + 6, y, b.x - a.x - 12);
        if (note) {
          const used = ctx.measureText(district.name).width;
          ctx.font = `500 ${labelSize - 1}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = muted;
          if (used + ctx.measureText(note).width + 24 < b.x - a.x) ctx.fillText(note, a.x + 14 + used, y);
        }
      }
      ctx.globalAlpha = 1;
    }

    // tiles: the old colours under the new while a quarter fades in
    const fadeT = fade.current ? Math.min(1, (now - fade.current.start) / 500) : 1;
    const threadIds = new Map(p.selection.threads.map((thread) => [thread.id, thread.way]));
    for (const tile of p.plan.tiles) {
      const a = toScreen(tile.x0, tile.y0), b = toScreen(tile.x1, tile.y1);
      if (b.x < 0 || b.y < 0 || a.x > w || a.y > h) continue;
      const tw = b.x - a.x, th = b.y - a.y;
      if (tw < 0.6 || th < 0.6) continue;
      const dim = (p.focus && p.focus !== tile.sector) || (p.selection.kind === "fund" && threadIds.size > 0 && !threadIds.has(tile.cik));
      ctx.globalAlpha = dim ? 0.28 : 1;
      const fill = p.fills.get(tile.cik) ?? p.palette.mid;
      if (fadeT < 1 && fade.current) {
        ctx.fillStyle = fade.current.from.get(tile.cik) ?? fill;
        roundRect(ctx, a.x, a.y, tw, th, Math.min(3, tw / 4));
        ctx.fill();
        ctx.globalAlpha *= fadeT;
      }
      ctx.fillStyle = fill;
      roundRect(ctx, a.x, a.y, tw, th, Math.min(3, tw / 4));
      ctx.fill();
      ctx.globalAlpha = dim ? 0.28 : 1;
      const isHover = hover.current?.kind === "tile" && hover.current.id === tile.cik;
      const isPicked = p.selection.kind === "company" && p.selection.id === tile.cik;
      const way = threadIds.get(tile.cik);
      if (isPicked || isHover || (p.selection.kind === "fund" && way)) {
        ctx.lineWidth = isPicked ? 2.5 : 1.5;
        ctx.strokeStyle = isPicked || isHover ? ink : way === "out" ? p.palette.neg : p.palette.pos;
        roundRect(ctx, a.x + 0.75, a.y + 0.75, tw - 1.5, th - 1.5, Math.min(3, tw / 4));
        ctx.stroke();
      }
      if (tw > 26 && th > 13) {
        const fontSize = Math.min(15, th * 0.42, (tw - 6) / (tile.ticker.length * 0.64));
        if (fontSize >= 8) {
          ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = inkOn(fill);
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          ctx.fillText(tile.ticker, a.x + tw / 2, a.y + th / 2 - (th > 44 && tw > 70 ? fontSize * 0.45 : 0));
          if (th > 44 && tw > 70) {
            ctx.font = `400 ${Math.max(9, fontSize * 0.62)}px Inter, system-ui, sans-serif`;
            ctx.globalAlpha *= 0.85;
            clipText(ctx, tile.name, a.x + tw / 2, a.y + th / 2 + fontSize * 0.7, tw - 10, "center");
          }
          ctx.textAlign = "left";
        }
      }
      ctx.globalAlpha = 1;
    }

    // streams of money between districts, when nothing is selected
    if (!p.selection.kind && p.streams.length) {
      const max = Math.max(...p.streams.map((stream) => stream.usd));
      p.streams.forEach((stream, index) => {
        const from = anchorOf(p.plan, stream.from), to = anchorOf(p.plan, stream.to);
        if (!from || !to) return;
        const dim = p.focus && p.focus !== stream.from && p.focus !== stream.to;
        const a = toScreen(from.x, from.y), b = toScreen(to.x, to.y);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const bend = 0.14 * len * (index % 2 ? 1 : -1);
        const cx = (a.x + b.x) / 2 - (dy / len) * bend, cy = (a.y + b.y) / 2 + (dx / len) * bend;
        const width = Math.max(1.5, Math.sqrt(stream.usd / max) * 9);
        const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, p.palette.neg);
        gradient.addColorStop(1, p.palette.pos);
        // quiet enough to read the tiles under it; the focused district's streams come forward
        ctx.globalAlpha = dim ? 0.08 : p.focus ? 0.85 : 0.5;
        ctx.strokeStyle = gradient;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
        ctx.stroke();
        if (!lessMotion && !dim) {
          ctx.globalAlpha = p.focus ? 0.9 : 0.6;
          ctx.strokeStyle = p.dark ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.95)";
          ctx.lineWidth = Math.max(1.2, width * 0.3);
          ctx.setLineDash([1, 26]);
          ctx.lineDashOffset = -(now / 28) % 27;
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = 1;
      });
    }

    // the outside gate
    const gate = toScreen(p.plan.outside.x, p.plan.outside.y);
    ctx.font = "500 11.5px Inter, system-ui, sans-serif";
    const gateText = "Outside the covered stocks";
    const gw = ctx.measureText(gateText).width + 18;
    ctx.fillStyle = p.dark ? "rgba(255,255,255,0.08)" : "rgba(11,11,11,0.06)";
    roundRect(ctx, gate.x - gw / 2, gate.y - 10, gw, 20, 10);
    ctx.fill();
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(gateText, gate.x, gate.y);
    ctx.textAlign = "left";

    // threads of the selection: from the person to the tiles it traded, or from the tile to the people who traded it
    if (p.selection.kind && p.selection.threads.length) {
      const max = Math.max(...p.selection.threads.map((thread) => thread.usd));
      for (const thread of p.selection.threads) {
        let from: { x: number; y: number } | undefined, to: { x: number; y: number } | undefined;
        if (p.selection.kind === "fund") {
          from = p.positions.get(p.selection.id!);
          const tile = p.plan.tileByCik.get(thread.id);
          to = tile ? { x: (tile.x0 + tile.x1) / 2, y: (tile.y0 + tile.y1) / 2 } : undefined;
        } else {
          const tile = p.plan.tileByCik.get(p.selection.id!);
          to = tile ? { x: (tile.x0 + tile.x1) / 2, y: (tile.y0 + tile.y1) / 2 } : undefined;
          from = p.positions.get(thread.id);
        }
        if (!from || !to) continue;
        const a = toScreen(from.x, from.y), b = toScreen(to.x, to.y);
        ctx.strokeStyle = thread.way === "out" ? p.palette.neg : p.palette.pos;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = Math.max(1.2, Math.sqrt(thread.usd / max) * 7);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - Math.abs(b.x - a.x) * 0.18, b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // people
    const tones = { up: p.palette.pos, down: p.palette.neg, flat: p.dark ? "#5b5b57" : "#8d8c85" };
    const labels: { text: string; x: number; y: number; rank: number; dim: boolean }[] = [];
    for (const person of p.people) {
      const at = p.positions.get(person.cik);
      if (!at) continue;
      const s = toScreen(at.x, at.y);
      if (s.x < -40 || s.y < -40 || s.x > w + 40 || s.y > h + 40) continue;
      const picked = p.selection.kind === "fund" && p.selection.id === person.cik;
      const traded = p.selection.kind === "company" && (threadIds.has(person.cik) || person.company === p.selection.id);
      const dim = (p.selection.kind === "fund" && !picked) || (p.selection.kind === "company" && !traded);
      const r = 8 + person.size * 9;
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 2, 0, Math.PI * 2);
      ctx.fillStyle = p.palette.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = tones[person.tone];
      ctx.fill();
      const isHover = hover.current?.kind === "person" && hover.current.id === person.cik;
      if (picked || isHover) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${Math.max(9, r * 0.78)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(person.initials, s.x, s.y + 0.5);
      ctx.textAlign = "left";
      if (person.named || picked || traded) labels.push({ text: person.label, x: s.x + r + 4, y: s.y, rank: picked || traded ? 2 : isHover ? 3 : person.size, dim });
      ctx.globalAlpha = 1;
    }
    // names last, the chosen and the largest first, each only where it covers no name already written
    ctx.font = "600 11.5px Inter, system-ui, sans-serif";
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const label of labels.sort((a, b) => b.rank - a.rank)) {
      const lw = ctx.measureText(label.text).width + 12;
      const box = { x0: label.x, y0: label.y - 9, x1: label.x + lw, y1: label.y + 9 };
      if (placed.some((other) => box.x0 < other.x1 && box.x1 > other.x0 && box.y0 < other.y1 && box.y1 > other.y0)) continue;
      placed.push(box);
      ctx.globalAlpha = label.dim ? 0.45 : 1;
      ctx.fillStyle = p.dark ? "rgba(26,26,25,0.9)" : "rgba(252,252,251,0.94)";
      roundRect(ctx, box.x0, box.y0, lw, 18, 9);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.fillText(label.text, label.x + 6, label.y + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  // hit tests in map units
  const pick = useCallback((sx: number, sy: number): { kind: "tile" | "person"; id: number } | null => {
    const c = camera.current;
    for (let i = people.length - 1; i >= 0; i--) {
      const at = positions.get(people[i].cik);
      if (!at) continue;
      const r = 8 + people[i].size * 9 + 3;
      if (Math.hypot((at.x - c.x) * c.k - sx, (at.y - c.y) * c.k - sy) <= r) return { kind: "person", id: people[i].cik };
    }
    const x = sx / c.k + c.x, y = sy / c.k + c.y;
    for (const tile of plan.tiles) if (x >= tile.x0 && x <= tile.x1 && y >= tile.y0 && y <= tile.y1) return { kind: "tile", id: tile.cik };
    return null;
  }, [people, positions, plan]);

  const districtAt = (sx: number, sy: number) => {
    const c = camera.current;
    const x = sx / c.k + c.x, y = sy / c.k + c.y;
    return plan.districts.find((district) => x >= district.x0 && x <= district.x1 && y >= district.y0 && y <= district.y1) ?? null;
  };

  // pointer: drag to move, click to pick, scroll to zoom, double-click to zoom into a district
  const drag = useRef<{ x: number; y: number; cam: Camera; moved: boolean } | null>(null);
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onPointerDown = (event: React.PointerEvent) => {
    const at = local(event);
    drag.current = { x: at.x, y: at.y, cam: { ...camera.current }, moved: false };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const at = local(event);
    const d = drag.current;
    if (d) {
      const dx = at.x - d.x, dy = at.y - d.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved) {
        flight.current = null;
        moved.current = true;
        camera.current = { ...d.cam, x: d.cam.x - dx / d.cam.k, y: d.cam.y - dy / d.cam.k };
        dirty.current = true;
        setTip(null);
        return;
      }
    }
    const hit = pick(at.x, at.y);
    if (hit?.kind !== hover.current?.kind || hit?.id !== hover.current?.id) {
      hover.current = hit;
      dirty.current = true;
    }
    if (!hit) { setTip(null); return; }
    const p = latest.current;
    const lines = hit.kind === "tile" ? p.describeTile(plan.tileByCik.get(hit.id)!) : p.describePerson(hit.id);
    setTip({ x: at.x, y: at.y, lines });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const at = local(event);
    const hit = pick(at.x, at.y);
    if (hit?.kind === "person") {
      const company = people.find((person) => person.cik === hit.id)?.company;
      onPick(company !== undefined ? { kind: "company", id: company } : { kind: "fund", id: hit.id });
    }
    else if (hit?.kind === "tile") onPick({ kind: "company", id: hit.id });
    else {
      const district = districtAt(at.x, at.y);
      onPick(district ? { kind: "sector", name: district.name } : { kind: "none" });
    }
  };
  const onDoubleClick = (event: React.MouseEvent) => {
    const at = local(event);
    const district = districtAt(at.x, at.y);
    if (district) { moved.current = true; flyTo(fitCamera(district)); }
  };
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = event.clientX - rect.left, sy = event.clientY - rect.top;
      const c = camera.current;
      const fit = fitCamera().k;
      const k = Math.min(fit * 16, Math.max(fit * 0.7, c.k * Math.exp(-event.deltaY * 0.0016)));
      const wx = sx / c.k + c.x, wy = sy / c.k + c.y;
      flight.current = null;
      moved.current = true;
      camera.current = { k, x: wx - sx / k, y: wy - sy / k };
      dirty.current = true;
      setTip(null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fitCamera]);

  const zoomBy = (factor: number) => {
    const { w, h } = size.current;
    const c = camera.current;
    const fit = fitCamera().k;
    const k = Math.min(fit * 16, Math.max(fit * 0.7, c.k * factor));
    const sx = inset.left + (w - inset.left - inset.right) / 2, sy = inset.top + (h - inset.top - inset.bottom) / 2;
    const wx = sx / c.k + c.x, wy = sy / c.k + c.y;
    moved.current = true;
    flyTo({ k, x: wx - sx / k, y: wy - sy / k }, 260);
  };

  return (
    <div ref={wrap} className="desk-map-stage">
      <canvas
        ref={canvas}
        className="desk-map-canvas"
        role="img"
        aria-label="Money map: sectors as districts, companies as tiles coloured by the quarter's flow, streams of money between sectors, and the funds' people as pins"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { hover.current = null; dirty.current = true; setTip(null); }}
        onDoubleClick={onDoubleClick}
        style={{ cursor: hover.current ? "pointer" : "grab" }}
      />
      {tip && (
        <div className="desk-map-tip" style={{ left: Math.min(tip.x + 14, size.current.w - 280), top: Math.min(tip.y + 14, size.current.h - 120) }} role="tooltip">
          {tip.lines.map((line, index) => (index === 0 ? <strong key={index}>{line}</strong> : <span key={index}>{line}</span>))}
        </div>
      )}
      <div className="desk-map-zoom" style={{ right: inset.right + 12, bottom: inset.bottom + 12 }}>
        <button type="button" className="desk-icon-button" onClick={() => zoomBy(1.5)} aria-label="Zoom in" title="Zoom in"><Plus size={15} aria-hidden="true" /></button>
        <button type="button" className="desk-icon-button" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out"><Minus size={15} aria-hidden="true" /></button>
        <button type="button" className="desk-icon-button" onClick={() => { moved.current = false; flyTo(fitCamera()); }} aria-label="Show the whole map" title="Show the whole map"><Maximize size={15} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

const inkCache = new Map<string, string>();
function inkOn(fill: string): string {
  let ink = inkCache.get(fill);
  if (!ink) {
    ink = /^#[0-9a-f]{6}$/i.test(fill) ? labelInk(fill) : "#0b0b0b";
    inkCache.set(fill, ink);
  }
  return ink;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function clipText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, align: CanvasTextAlign = "left") {
  if (max <= 8) return;
  let shown = text;
  while (shown.length > 1 && ctx.measureText(shown).width > max) shown = shown.slice(0, -2);
  if (shown !== text) shown = `${shown.trimEnd()}…`;
  ctx.textAlign = align;
  ctx.fillText(shown, x, y);
  ctx.textAlign = "left";
}
