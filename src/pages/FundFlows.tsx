/**
 * /fundflows — 3D graph plus an accessible tabular view of comparable fund flows.
 * The graph is an enhancement, never the only way to inspect the evidence.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Table2, Rotate3D, Search } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { flowEdgeText, groupCompaniesBySector, groupFundsByTier, selectFlowEdges, signed, supportsWebGL, type FlowEdge } from "./fund-flows-utils";

const TIER_COLOR: Record<string, number> = {
  activist: 0xfb7185, quant: 0x7cc7ff, fundamental: 0x4ade80, passive: 0xc084fc, institutional: 0x9ca3af,
};
const SECTOR_COLOR: Record<string, number> = {
  "Information Technology": 0x22d3ee, "Health Care": 0x4ade80, Financials: 0xfacc15,
  "Consumer Discretionary": 0xfb923c, "Consumer Staples": 0xf472b6, Industrials: 0xa3a3a3,
  Energy: 0xf87171, Utilities: 0x60a5fa, "Real Estate": 0x2dd4bf, Materials: 0xd4a373,
  "Communication Services": 0xe879f9, Unclassified: 0x94a3b8,
};
const MAX_SCENE_EDGES = 150;

export default function FundFlows() {
  const q = trpc.admin.fundFlows.useQuery({ limit: 400 }, { retry: false });
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"scene" | "table">("scene");
  const [webglFailed, setWebglFailed] = useState(false);
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const data = q.data;
  const funds = data?.funds ?? [];
  const companies = data?.companies ?? [];
  const edges = useMemo(() => data?.edges ?? [], [data]);
  const byCikFund = useMemo(() => new Map(funds.map((fund) => [fund.cik, fund])), [funds]);
  const byCikCo = useMemo(() => new Map(companies.map((company) => [company.cik, company])), [companies]);
  const filteredEdges = useMemo(() => selectFlowEdges(edges.filter((edge) => {
    if (!query.trim()) return true;
    return flowEdgeText(edge, byCikFund.get(edge.fundCik), byCikCo.get(edge.cik)).includes(query.trim().toLowerCase());
  }), 100), [edges, query, byCikFund, byCikCo]);

  useEffect(() => {
    const host = hostRef.current;
    if (!data || !host || viewMode !== "scene" || webglFailed) return;
    if (!supportsWebGL()) {
      setWebglFailed(true);
      setViewMode("table");
      return;
    }
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let frame = 0;
    let lastFrame = 0;
    let disposed = false;
    const scene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(1, 16, 16);
    const materials: THREE.Material[] = [];
    const onMove = () => undefined;
    const onResize = () => undefined;
    const cleanup = () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      if (controls) controls.dispose();
      if (renderer) {
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("click", onMove);
        renderer.dispose();
        if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      }
      scene.traverse((object: any) => {
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((material: any) => material.dispose?.());
      });
      geometry.dispose();
    };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional fund flow graph");
      host.appendChild(renderer.domElement);
      renderer.domElement.addEventListener("webglcontextlost", () => {
        setWebglFailed(true);
        setViewMode("table");
      });

      scene.background = new THREE.Color(0x070b12);
      scene.fog = new THREE.Fog(0x070b12, 85, 180);
      const camera = new THREE.PerspectiveCamera(55, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 2000);
      camera.position.set(0, 26, 62);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      controls.autoRotateSpeed = 0.35;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;

      const ground = new THREE.Mesh(new THREE.CircleGeometry(75, 72), new THREE.MeshBasicMaterial({ color: 0x09111d, side: THREE.DoubleSide }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.65;
      scene.add(ground);

      const pos = new Map<number, THREE.Vector3>();
      const tierGroups = groupFundsByTier(funds);
      const tierOrder = [...tierGroups.keys()];
      tierOrder.forEach((tier, tierIndex) => {
        const group = tierGroups.get(tier)!;
        const tierAngle = (tierIndex / Math.max(1, tierOrder.length)) * Math.PI * 2;
        group.forEach((fund, index) => {
          const angle = tierAngle + (index / group.length) * (Math.PI * 0.62);
          pos.set(fund.cik, new THREE.Vector3(Math.cos(angle) * 30, 0, Math.sin(angle) * 30));
        });
        const material = new THREE.MeshBasicMaterial({ color: TIER_COLOR[tier] ?? TIER_COLOR.institutional });
        materials.push(material);
        const mesh = new THREE.InstancedMesh(geometry, material, group.length);
        const matrix = new THREE.Matrix4();
        group.forEach((fund, index) => {
          const point = pos.get(fund.cik)!;
          matrix.makeScale(0.9, 0.9, 0.9).setPosition(point.x, point.y, point.z);
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        (mesh as any).userData.ciks = group.map((fund) => fund.cik);
        scene.add(mesh);
      });

      const sectorGroups = groupCompaniesBySector(companies);
      const sectorOrder = [...sectorGroups.keys()].sort();
      sectorOrder.forEach((sector, sectorIndex) => {
        const group = sectorGroups.get(sector)!;
        const sectorAngle = (sectorIndex / Math.max(1, sectorOrder.length)) * Math.PI * 2;
        group.forEach((company, index) => {
          const angle = sectorAngle + (index / group.length) * 0.48;
          pos.set(company.cik, new THREE.Vector3(Math.cos(angle) * 15, 0, Math.sin(angle) * 15));
        });
        const material = new THREE.MeshBasicMaterial({ color: SECTOR_COLOR[sector] ?? SECTOR_COLOR.Unclassified });
        materials.push(material);
        const mesh = new THREE.InstancedMesh(geometry, material, group.length);
        const matrix = new THREE.Matrix4();
        group.forEach((company, index) => {
          const point = pos.get(company.cik)!;
          matrix.makeScale(0.55, 0.55, 0.55).setPosition(point.x, point.y, point.z);
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        (mesh as any).userData.ciks = group.map((company) => company.cik);
        scene.add(mesh);
      });

      const flowEdges = selectFlowEdges(edges, MAX_SCENE_EDGES);
      const vertices: number[] = [], colors: number[] = [];
      const maxAbs = Math.max(...flowEdges.map((edge) => Math.abs(edge.deltaShares)), 1);
      for (const edge of flowEdges) {
        const from = pos.get(edge.fundCik)!, to = pos.get(edge.cik)!;
        vertices.push(from.x, from.y, from.z, to.x, to.y, to.z);
        const magnitude = Math.min(1, Math.abs(edge.deltaShares) / maxAbs);
        const color = new THREE.Color(edge.deltaShares >= 0 ? 0x34d399 : 0xfb7185).multiplyScalar(0.35 + 0.65 * magnitude);
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      edgeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      const edgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38 });
      materials.push(edgeMaterial);
      scene.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const onPointerMove = (event: PointerEvent) => {
        const rect = renderer!.domElement.getBoundingClientRect();
        ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const meshes = scene.children.filter((child): child is THREE.InstancedMesh => (child as any).isInstancedMesh);
        const hit = ray.intersectObjects(meshes)[0];
        if (hit && (hit as any).instanceId !== undefined) {
          const mesh = hit.object as THREE.InstancedMesh;
          const cik = (mesh as any).userData.ciks[(hit as any).instanceId];
          const fund = byCikFund.get(cik), company = byCikCo.get(cik);
          if (fund) setHover({ text: `${fund.name} [${fund.tier ?? "institutional"}]`, x: event.clientX - rect.left, y: event.clientY - rect.top });
          else if (company) setHover({ text: `${company.ticker} — ${company.sector ?? "Unclassified"}`, x: event.clientX - rect.left, y: event.clientY - rect.top });
        } else setHover(null);
      };
      const onClick = () => {
        const meshes = scene.children.filter((child): child is THREE.InstancedMesh => (child as any).isInstancedMesh);
        const hit = ray.intersectObjects(meshes)[0];
        if (hit && (hit as any).instanceId !== undefined) {
          const mesh = hit.object as THREE.InstancedMesh;
          const cik = (mesh as any).userData.ciks[(hit as any).instanceId];
          const point = pos.get(cik)!;
          controls!.target.copy(point);
          setFocusLabel(byCikFund.get(cik)?.name ?? byCikCo.get(cik)?.ticker ?? null);
        }
      };
      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("click", onClick);
      const resize = () => {
        camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
        camera.updateProjectionMatrix();
        renderer!.setSize(host.clientWidth, host.clientHeight);
      };
      window.addEventListener("resize", resize);
      const tick = (time: number) => {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        if (time - lastFrame < 33 || document.hidden) return;
        lastFrame = time;
        controls!.update();
        renderer!.render(scene, camera);
      };
      frame = requestAnimationFrame(tick);
      return cleanup;
    } catch {
      cleanup();
      setWebglFailed(true);
      setViewMode("table");
      return undefined;
    }
  }, [data, viewMode, webglFailed, byCikFund, byCikCo, edges]);

  const guard = data?.guard;
  return (
    <AppLayout title="Fund flows — 3D">
      <div className="panel relative flows-panel">
        <div className="flows-toolbar">
          <div className="space-y-1">
            {guard && <div className="t-mono text-[11px] text-muted-foreground max-w-[95%]" title={guard.warnings.join("\n")}>
              {guard.cur} vs {guard.prev ?? "n/a"} · stable funds {guard.stableFunds} · coverage {guard.curFunds}/{guard.expectedFunds} · excluded {guard.missingFunds + guard.suspectFunds}{guard.partial ? " · partial" : ""}
            </div>}
            <div className="t-mono text-[11px] text-muted-foreground max-w-[95%]">
              outer ring = funds by tier · inner ring = companies by sector · green inflow / red outflow · hover for names, click to focus
            </div>
          </div>
          <div className="flows-view-buttons" role="group" aria-label="Fund flow view">
            <button type="button" className={viewMode === "scene" && !webglFailed ? "active" : ""} disabled={webglFailed} aria-pressed={viewMode === "scene" && !webglFailed} onClick={() => setViewMode("scene")}><Rotate3D size={13} /> 3D</button>
            <button type="button" className={viewMode === "table" || webglFailed ? "active" : ""} aria-pressed={viewMode === "table" || webglFailed} onClick={() => setViewMode("table")}><Table2 size={13} /> Data table</button>
          </div>
        </div>

        {q.isLoading && <div className="flows-state" role="status">loading flow graph…</div>}
        {q.isError && <div className="flows-state flows-error" role="alert"><AlertTriangle size={18} /><p>Fund flow data could not be loaded. No graph is inferred from the error.</p></div>}
        {!q.isLoading && !q.isError && edges.length === 0 && <div className="flows-state" role="status"><p>No comparable fund flows are available for this guard. Current-quarter levels are not converted into QoQ flows.</p></div>}

        {!q.isLoading && !q.isError && edges.length > 0 && viewMode === "scene" && !webglFailed && <>
          <div className="flows-scene-caption t-mono text-[10px] text-muted-foreground">showing {Math.min(MAX_SCENE_EDGES, edges.length)}/{edges.length} strongest share changes · {funds.length} funds · {companies.length} companies</div>
          <div ref={hostRef} className="flows-canvas" />
          {hover && <div className="absolute z-20 t-mono text-[11px] px-2 py-1 rounded border border-border bg-[hsl(var(--card))] pointer-events-none" style={{ left: hover.x + 12, top: hover.y + 12 }}>{hover.text}</div>}
          {focusLabel && <div className="absolute bottom-3 left-3 z-10 t-mono text-[11px] text-live-cyan">focused: {focusLabel}</div>}
        </>}

        {!q.isLoading && !q.isError && edges.length > 0 && (viewMode === "table" || webglFailed) && (
          <div className="flows-table-wrap">
            {webglFailed && <div className="flows-webgl-note" role="status">3D is unavailable in this browser. The same evidence is shown below in accessible form.</div>}
            <label className="flows-search"><Search size={13} /><span className="sr-only">Filter fund flows</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter fund, ticker or sector" /></label>
            <div className="t-mono text-[10px] text-muted-foreground">{filteredEdges.length} shown · {edges.length} total flows</div>
            <div className="flows-table-scroll" role="region" aria-label="Comparable fund flows table" tabIndex={0}>
              <table className="flows-table"><thead><tr><th>Fund</th><th>Company</th><th className="numeric">Δ shares</th><th className="numeric">Δ USD</th><th className="numeric">Δ weight pp</th></tr></thead>
                <tbody>{filteredEdges.map((edge) => {
                  const fund = byCikFund.get(edge.fundCik), company = byCikCo.get(edge.cik);
                  return <tr key={`${edge.fundCik}-${edge.cik}`}>
                    <td title={fund?.name ?? String(edge.fundCik)}>{fund?.name ?? edge.fundCik}</td>
                    <td><strong>{company?.ticker ?? edge.cik}</strong><span className="flows-sector">{company?.sector ?? "Unclassified"}</span></td>
                    <td className={edge.deltaShares >= 0 ? "flow-positive numeric" : "flow-negative numeric"} title={String(edge.deltaShares)}>{signed(edge.deltaShares)}</td>
                    <td className={edge.deltaUsd >= 0 ? "flow-positive numeric" : "flow-negative numeric"} title={String(edge.deltaUsd)}>{signed(edge.deltaUsd)}</td>
                    <td className="numeric">{edge.deltaWeightPp === null ? "—" : signed(edge.deltaWeightPp, 3)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
