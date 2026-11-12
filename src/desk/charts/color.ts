/**
 * Chart colors of the desk view. Values come from the data-viz reference instance: a blue/red diverging pair with
 * a neutral gray midpoint per theme, the accent, and the chart chrome. Intermediate diverging steps are mixed in
 * OKLab, so lightness changes monotonically from the midpoint to each pole.
 */
import type { ResolvedTheme } from "../preferences";

export interface ChartPalette {
  pos: string;
  neg: string;
  mid: string;
  surface: string;
  accent: string;
  grid: string;
  axis: string;
  muted: string;
  ink: string;
}

export const CHART_PALETTE: Record<ResolvedTheme, ChartPalette> = {
  light: { pos: "#2a78d6", neg: "#e34948", mid: "#f0efec", surface: "#fcfcfb", accent: "#2a78d6", grid: "#e1e0d9", axis: "#c3c2b7", muted: "#898781", ink: "#0b0b0b" },
  dark: { pos: "#3987e5", neg: "#e66767", mid: "#383835", surface: "#1a1a19", accent: "#3987e5", grid: "#2c2c2a", axis: "#383835", muted: "#898781", ink: "#f0efec" },
};

type Lab = [number, number, number];

function channelToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToChannel(value: number): number {
  const c = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16)) as [number, number, number];
}

export function hexToOklab(hex: string): Lab {
  const [r, g, b] = parseHex(hex).map(channelToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linearToChannel);
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function mixOklab(from: string, to: string, t: number): string {
  const a = hexToOklab(from);
  const b = hexToOklab(to);
  const k = Math.min(1, Math.max(0, t));
  return oklabToHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
}

/** Value → color on the diverging scale clamped at ±limit; null reads as "no data" (the midpoint gray). */
export function divergingColor(value: number | null, limit: number, palette: ChartPalette): string {
  if (value === null || !Number.isFinite(value) || limit <= 0) return palette.mid;
  const t = Math.min(1, Math.abs(value) / limit);
  return mixOklab(palette.mid, value >= 0 ? palette.pos : palette.neg, t);
}

/** Symmetric clamp of the diverging scale per return period. */
export const DIVERGING_LIMIT: Record<string, number> = { d1: 0.03, w1: 0.06, m1: 0.1, m3: 0.2, ytd: 0.3, y1: 0.4 };

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(channelToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Label ink inside a colored fill: white or near-black, whichever reads better on it. */
export function labelInk(fill: string): string {
  return contrastRatio(fill, "#ffffff") >= contrastRatio(fill, "#0b0b0b") ? "#ffffff" : "#0b0b0b";
}
