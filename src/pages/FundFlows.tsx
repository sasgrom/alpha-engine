/**
 * /fundflows (owner-only) — 3D graph of tracked-fund flows into S&P 500 names.
 * Outer ring: funds by tier (activist/quant/fundamental/passive/institutional).
 * Inner ring: companies by GICS sector. Edge = QoQ position change; green =
 * increased, red = decreased; thickness ~ |Δvalue|. Hover = details, click = focus.
 * Data: admin.fundFlows (deterministic from fund_holdings).
 */
import { useEffect, useRef, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const TIER_COLOR: Record<string, number> = {
  activist: 0xff5a5a, quant: 0x7cc7ff, fundamental: 0x4ade80, passive: 0xc084fc, institutional: 0x9ca3af,
};
const SECTOR_COLOR: Record<string, number> = {
  "Information Technology": 0x22d3ee, "Health Care": 0x4ade80, Financials: 0xfacc15,
  "Consumer Discretionary": 0xfb923c, "Consumer Staples": 0xf472b6, Industrials: 0xa3a3a3,
  Energy: 0xf87171, Utilities: 0x60a5fa, "Real Estate": 0x2dd4bf, Materials: 0xd4a373,
  "Communication Services": 0xe879f9,
};

interface GFund { cik: number; name: string; tier: string | null }
interface GCompany { cik: number; ticker: string; sector: string | null }
interface GEdge { fundCik: number; cik: number; curUsd: number; deltaUsd: number }

export default function FundFlows() {
  const q = trpc.admin.fundFlows.useQuery({ limit: 400 }, { retry: false });
  const hostRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);

  useEffect(() => {
    const d = q.data;
    const host = hostRef.current;
    if (!d || !host) return;

    const funds: GFund[] = d.funds;
    const companies: GCompany[] = d.companies;
    const edges: GEdge[] = d.edges;
    const byCikFund = new Map(funds.map((f) => [f.cik, f]));
    const byCikCo = new Map(companies.map((c) => [c.cik, c]));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b12);
    const camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 2000);
    camera.position.set(0, 26, 62);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.enableDamping = true;

    // node positions
    const pos = new Map<number, THREE.Vector3>();
    const tierOrder = ["activist", "quant", "fundamental", "passive", "institutional"];
    const fundsSorted = [...funds].sort((a, b) => tierOrder.indexOf(a.tier ?? "institutional") - tierOrder.indexOf(b.tier ?? "institutional"));
    fundsSorted.forEach((f, i) => {
      const a = (i / fundsSorted.length) * Math.PI * 2;
      pos.set(f.cik, new THREE.Vector3(Math.cos(a) * 30, 0, Math.sin(a) * 30));
    });
    const sectorOrder = [...new Set(companies.map((c) => c.sector ?? "?"))].sort();
    companies.forEach((c, i) => {
      const sectorIdx = sectorOrder.indexOf(c.sector ?? "?");
      const perSector = companies.filter((x) => x.sector === c.sector).length;
      const idxInSector = companies.slice(0, i).filter((x) => x.sector === c.sector).length;
      const a = (sectorIdx / sectorOrder.length) * Math.PI * 2 + (idxInSector / perSector) * 0.5;
      pos.set(c.cik, new THREE.Vector3(Math.cos(a) * 15, 0, Math.sin(a) * 15));
    });

    // nodes (instanced spheres, two meshes)
    const mkNodes = (ciks: number[], colorOf: (cik: number) => number, sizeOf: (cik: number) => number) => {
      const geo = new THREE.SphereGeometry(1, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(geo, mat, ciks.length);
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      ciks.forEach((cik, i) => {
        const p = pos.get(cik)!;
        const s = sizeOf(cik);
        m.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(i, m);
        col.setHex(colorOf(cik));
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      (mesh as any).userData.ciks = ciks;
      scene.add(mesh);
      return mesh;
    };
    mkNodes(fundsSorted.map((f) => f.cik), (cik) => TIER_COLOR[byCikFund.get(cik)?.tier ?? "institutional"] ?? 0x9ca3af, () => 0.85);
    mkNodes(companies.map((c) => c.cik), (cik) => SECTOR_COLOR[byCikCo.get(cik)?.sector ?? ""] ?? 0x60a5fa, () => 0.45);

    // edges
    const verts: number[] = [], colors: number[] = [];
    const maxAbs = Math.max(...edges.map((e) => Math.abs(e.deltaUsd)), 1);
    for (const e of edges) {
      const a = pos.get(e.fundCik)!, b = pos.get(e.cik)!;
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const up = e.deltaUsd >= 0;
      const k = Math.min(1, Math.abs(e.deltaUsd) / maxAbs);
      const c = new THREE.Color(up ? 0x22c55e : 0xef4444).multiplyScalar(0.25 + 0.75 * k);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    eg.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
    scene.add(lines);

    // hover / focus
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const onMove = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const meshes = scene.children.filter((c): c is THREE.InstancedMesh => (c as any).isInstancedMesh);
      const hit = ray.intersectObjects(meshes)[0];
      if (hit && (hit as any).instanceId !== undefined) {
        const mesh = hit.object as THREE.InstancedMesh;
        const cik = (mesh as any).userData.ciks[(hit as any).instanceId];
        const f = byCikFund.get(cik), co = byCikCo.get(cik);
        if (f) setHover({ text: `${f.name} [${f.tier}]`, x: ev.clientX - r.left, y: ev.clientY - r.top });
        else if (co) setHover({ text: `${co.ticker} — ${co.sector ?? ""}`, x: ev.clientX - r.left, y: ev.clientY - r.top });
      } else setHover(null);
    };
    const onClick = () => {
      const meshes = scene.children.filter((c): c is THREE.InstancedMesh => (c as any).isInstancedMesh);
      const hit = ray.intersectObjects(meshes)[0];
      if (hit && (hit as any).instanceId !== undefined) {
        const mesh = hit.object as THREE.InstancedMesh;
        const cik = (mesh as any).userData.ciks[(hit as any).instanceId];
        const p = pos.get(cik)!;
        controls.target.copy(p);
        setFocusLabel(byCikFund.get(cik)?.name ?? byCikCo.get(cik)?.ticker ?? null);
      }
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("click", onClick);

    const onResize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener("resize", onResize);
    const raf = { id: 0 };
    const tick = () => { raf.id = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); };
    tick();

    return () => {
      cancelAnimationFrame(raf.id);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      scene.traverse((o: any) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.()); });
    };
  }, [q.data]);

  return (
    <AppLayout title="Fund flows — 3D">
      <div className="panel relative" style={{ height: "calc(100vh - 150px)", minHeight: 480 }}>
        <div className="absolute top-3 left-3 z-10 t-mono text-[11px] text-muted-foreground">
          outer ring = funds by tier · inner ring = companies by sector · green inflow / red outflow · hover for names, click to focus
        </div>
        <div ref={hostRef} className="w-full h-full" />
        {hover && (
          <div className="absolute z-20 t-mono text-[11px] px-2 py-1 rounded border border-border bg-[hsl(var(--card))] pointer-events-none"
            style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.text}
          </div>
        )}
        {focusLabel && <div className="absolute bottom-3 left-3 z-10 t-mono text-[11px] text-live-cyan">focused: {focusLabel}</div>}
        {q.isLoading && <div className="absolute inset-0 grid place-items-center t-mono text-[12px] text-muted-foreground">loading flow graph…</div>}
      </div>
    </AppLayout>
  );
}
