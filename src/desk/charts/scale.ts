import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Width of an element, tracked with a ResizeObserver (0 until measured). Returns a callback ref, so an element
 * that mounts after a loading state is still measured, and a ref object for reading the element.
 */
export function useWidth<T extends HTMLElement>(): [(element: T | null) => void, number, React.RefObject<T | null>] {
  const ref = useRef<T | null>(null);
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  const attach = useCallback((element: T | null) => {
    ref.current = element;
    setNode(element);
    if (element) setWidth(element.getBoundingClientRect().width);
  }, []);
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [attach, width, ref];
}

/** "Nice" axis ticks covering [min, max] with about `count` steps of 1, 2, 2.5 or 5 × 10^k. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

export function linear(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}
