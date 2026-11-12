/**
 * The rotunda of the fund-flow view, drawn with three.js: a round library with a bookcase for every sector, a book
 * for every company, the funds as people standing at the bookcase where their money went, the index funds keeping
 * the library at the map table, and the quarter's money flowing under the dome. Game-like controls: drag to look,
 * W A S D or the arrow keys to walk, R and F to rise and fall, the wheel to move forward, a click to select.
 *
 * No React in here: the page hands in data and receives hover and pick events. Labels are plain elements the stage
 * positions itself, so nothing re-renders per frame.
 */
import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { FLOW_OUTSIDE, type FlowLink } from "@contracts/fund-flows";
import { mixOklab, type ChartPalette } from "../../charts/color";
import { buildHall, DOORWAY, loadHallTextures, WALL_RADIUS, type HallBuilding } from "./building";
import type { Look } from "./figures";
import type { Carry } from "./character";
import { angleOf, crowdSlots, crowdWedges, hallLayout, polar, ROTUNDA, staffSlots, type HallCompany, type HallLayout, type Slot } from "./layout";
import { Crowd, loadPrototypes, type BodyKind } from "./people";
import { MoneyStreams, type StreamPart, type StreamSpec } from "./streams";
import { MapTable, type StateFlow, type UsaTopology } from "./usa-map";
import { MainStreet } from "./mainstreet";
import { Providence } from "./providence";
import { SCOREBOARD_CROWN, Scoreboards, TopBoards, type SectorScore, type TopList } from "./boards";
import { bikeGeometry, BRONZE, caneGeometry, emblemFor, laptopGeometry, scooterGeometry } from "./props";
import { nextVisits, stayFor } from "./visits";
import { atlasCell, SPINE_ATLAS, spineAtlas, spineMaterial, type LogoAtlas } from "./spines";

export interface StageCompany extends HallCompany { name: string; /** US state of the headquarters (null: abroad or not stated). */ hq?: string | null }
export interface StageFund { cik: number; name: string; category: string; tracked: number }

export interface StageFigure {
  body: BodyKind;
  scale: number;
  staff: boolean;
  leader: string | null;
  look: Look;
  /** From the firm's history and size: build, grey hair for the old firms (null keeps the look's), what it carries, its pace. */
  girth: number;
  hair: string | null;
  carry: Carry;
  pace: number;
}

/** Where things are held, in a person's own space (1.74 m tall, facing +z): under the right arm, in the right hand, underfoot, beside. */
const HELD: Record<Exclude<Carry, null>, THREE.Matrix4> = {
  laptop: new THREE.Matrix4().compose(new THREE.Vector3(-0.25, 0.98, 0.03), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1)),
  cane: new THREE.Matrix4().compose(new THREE.Vector3(-0.3, 0, 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0, 0)), new THREE.Vector3(1, 1, 1)),
  scooter: new THREE.Matrix4().makeTranslation(0, 0, 0.05),
  bike: new THREE.Matrix4().makeTranslation(-0.55, 0, 0.1),
};
const BIKES = ["#2f6f4f", "#8a2f2f", "#2f4f8a", "#c9a14f", "#3a3a3a", "#e8e6e1"];

export interface StageData {
  /** Per company: net flow of the quarter, value held, and the stock's return since the quarter end. */
  company: Map<number, { net: number; held: number; since: number | null }>;
  /** Per fund counted in the quarter: dollars bought and sold. */
  fund: Map<number, { bought: number; sold: number }>;
  sectors: Map<string, { net: number; bought: number; sold: number; held: number }>;
  links: FlowLink[];
  /** "flow": books coloured by the net flow against the value held. "outcome": by the return since. "held": by the value held. */
  mode: "flow" | "outcome" | "held";
  /** Price level now over the price level then, to restate returns after inflation (1 = leave as is). */
  deflator: number;
  focus: string | null;
  /** Every fund that reported the quarter: its home bookcase (null: none) and how it is drawn. */
  places: Map<number, { home: string | null; stakes?: { sector: string; weight: number }[] }>;
  figures: Map<number, StageFigure>;
  /** The funds kept in the hall by the switch between all, the winners and the losers (null: everybody). */
  keep: Set<number> | null;
  /** The quarter's name ("Q2 2026"), and the lists on the top-ten boards. */
  quarter: string;
  lists: TopList[];
  /** The "people" audience: the names to show for funds (famous faces), and placeholders by the entrance (null and none for funds). */
  names: Map<number, string> | null;
  placeholders: { id: number; name: string; note: string }[];
}

export interface StageSelection {
  kind: "fund" | "company" | null;
  id: number | null;
  /** For a fund: the companies it traded. For a company: the funds that traded it. Positive = bought. */
  threads: { id: number; usd: number }[];
}

export type StageTarget =
  | { kind: "company"; id: number }
  | { kind: "fund"; id: number }
  | { kind: "sector"; name: string }
  | { kind: "outside" }
  | { kind: "state"; code: string; name: string }
  | { kind: "stream"; from: string; to: string; usd: number };

export interface StageEvents {
  onHover: (target: StageTarget | null, x: number, y: number) => void;
  onPick: (target: StageTarget | null) => void;
  /** The hall has loaded (or failed to: the message says why). */
  onReady?: (error: string | null) => void;
}

interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }
interface PlacedLabel { element: HTMLElement; at: THREE.Vector3; reach: number; rank: number; shown: boolean; follow?: number }

/** Where the reader comes in: inside the entrance, looking across the hall. */
const HOME: Pose = { x: 0, y: 6.4, z: 21, yaw: 0, pitch: -0.12 };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export class HallStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly layout: HallLayout;
  private building: HallBuilding | null = null;
  private map: MapTable | null = null;
  private readonly headquarters = new Map<number, string | null>();
  private books: THREE.InstancedMesh | null = null;
  private readonly bookIndex = new Map<number, number>();
  private readonly pull: Float32Array;
  private readonly pullTarget: Float32Array;
  private readonly tint: Float32Array;
  private readonly tintTarget: Float32Array;
  private settling = true;
  private readonly streams: MoneyStreams;
  private crowd: Crowd | null = null;
  private readonly labelLayer: HTMLDivElement;
  private labels: PlacedLabel[] = [];
  private mainStreet: MainStreet | null = null;
  private providence: Providence | null = null;
  private scoreboards: Scoreboards | null = null;
  private topBoards: TopBoards | null = null;
  private data: StageData | null = null;
  private selection: StageSelection = { kind: null, id: null, threads: [] };
  private placed = false;
  /** Where each fund in a crowd belongs (visits start and end there), how many stand at each bookcase, and the visits under way. */
  private readonly homes = new Map<number, { slot: Slot; face: { x: number; z: number } }>();
  private readonly crowdSize = new Map<string, number>();
  private readonly visits = new Map<number, { phase: "going" | "staying" | "returning"; until: number; spot: string }>();
  private visitClock = 0;
  private visitRound = 0;
  private readonly carried = new Map<Carry, THREE.InstancedMesh>();
  private hovered: StageTarget | null = null;
  /** The top-ten board under the pointer, and the one the reader was brought to stand in front of. */
  private hoveredBoard: number | null = null;
  private focusedBoard: number | null = null;
  private readonly pointer = new THREE.Vector2(2, 2);
  private pointerClient: [number, number] = [0, 0];
  private pointerDirty = false;
  private dragging: { x: number; y: number; moved: number } | null = null;
  private readonly keys = new Set<string>();
  private readonly pose: Pose = { ...HOME };
  private flight: { from: Pose; to: Pose; started: number; duration: number } | null = null;
  private game = false;
  private inset = 0;
  private insetBottom = 0;
  private frame = 0;
  private last = 0;
  private clock = 0;
  private disposed = false;
  private readonly calm: boolean;
  private readonly resizer: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly positive: THREE.Color;
  private readonly negative: THREE.Color;
  private readonly host: HTMLElement;
  private readonly funds: StageFund[];
  private readonly dark: boolean;
  private readonly palette: ChartPalette;
  private readonly events: StageEvents;
  private readonly tone: { book: string; sky: string; ink: string };
  private readonly halo: THREE.Sprite;

  constructor(host: HTMLElement, companies: StageCompany[], funds: StageFund[], sectorOrder: string[], dark: boolean, palette: ChartPalette, events: StageEvents) {
    this.host = host;
    this.funds = funds;
    this.dark = dark;
    this.palette = palette;
    this.events = events;
    this.tone = { book: dark ? "#6f6a62" : "#a8a397", sky: dark ? "#0b0c10" : "#efe9dc", ink: dark ? "#f0efec" : "#0b0b0b" };
    this.positive = new THREE.Color(palette.pos);
    this.negative = new THREE.Color(palette.neg);
    this.calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.layout = hallLayout(companies, sectorOrder);
    for (const company of companies) if (company.hq !== undefined) this.headquarters.set(company.cik, company.hq);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // a reading room's light: soft, nothing burnt out
    this.renderer.toneMappingExposure = dark ? 0.82 : 0.78;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.cssText = "display:block;width:100%;height:100%;outline:none;touch-action:none;cursor:grab";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute("aria-label", "A round library: a bookcase for every sector, a book for every company, the funds as people at the bookcases where their money went. The reading view has the same figures as charts and tables.");
    host.appendChild(this.renderer.domElement);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "desk-lib-labels";
    host.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color(this.tone.sky);
    this.scene.fog = new THREE.Fog(this.tone.sky, 60, 140);
    this.scene.add(new THREE.HemisphereLight(dark ? 0x9fb0d0 : 0xfff6e8, dark ? 0x1c1612 : 0xb9ab95, dark ? 0.4 : 0.55));
    // light through the oculus, casting the people's shadows on the marble
    const sun = new THREE.DirectionalLight(dark ? 0xbfcaf0 : 0xfff1d6, dark ? 0.8 : 1.35);
    sun.position.set(8, 40, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    // warm lamps round the gallery
    for (let index = 0; index < 6; index++) {
      const lamp = new THREE.PointLight(0xffc98a, dark ? 34 : 14, 34, 1.6);
      lamp.position.set(...polar((index / 6) * Math.PI * 2 + 0.3, ROTUNDA.radius - 6, ROTUNDA.galleryHeight + 2.5));
      this.scene.add(lamp);
    }

    // books: one instanced box each, coloured by the quarter
    this.pull = new Float32Array(this.layout.books.length);
    this.pullTarget = new Float32Array(this.layout.books.length);
    this.tint = new Float32Array(this.layout.books.length * 3);
    this.tintTarget = new Float32Array(this.layout.books.length * 3);

    this.streams = new MoneyStreams(dark);
    this.scene.add(this.streams.group);
    const glow = new THREE.CanvasTexture((() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d")!;
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.4, "rgba(255,255,255,0.5)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      return canvas;
    })());
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: palette.accent, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false }));
    this.halo.visible = false;
    this.scene.add(this.halo);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), dark ? 0.32 : 0.1, 0.45, dark ? 0.86 : 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.applyPose();
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(host);
    this.resize();
    this.listen();
    this.frame = requestAnimationFrame(this.tick);
    void this.load();
  }

  // --- loading --------------------------------------------------------------------------------------------------
  private async load(): Promise<void> {
    try {
      const font = new FontFace("Cinzel", "url(/desk-assets/library/fonts/Cinzel-wght.ttf)", { weight: "400 900" });
      const [textures, environment, prototypes, , usa, logos] = await Promise.all([
        loadHallTextures(this.renderer).catch(() => null),
        new HDRLoader().loadAsync("/desk-assets/library/env/vestibule_1k.hdr").catch(() => null),
        loadPrototypes().catch((error: unknown) => {
          console.warn("The people of the hall could not be loaded", error);
          return null;
        }),
        font.load().then((face) => document.fonts.add(face)).catch(() => null),
        fetch("/desk-assets/library/usa/states-albers-10m.json").then((response) => (response.ok ? (response.json() as Promise<UsaTopology>) : null)).catch(() => null),
        Promise.all([
          new THREE.TextureLoader().loadAsync("/desk-assets/library/logos/atlas.webp"),
          fetch("/desk-assets/library/logos/atlas.json").then((response) => response.json() as Promise<LogoAtlas>),
        ])
          .then(([texture, index]) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            return { texture, index };
          })
          .catch(() => null),
      ]);
      if (this.disposed) return;
      if (environment) {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        environment.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.environment = pmrem.fromEquirectangular(environment).texture;
        this.scene.environmentIntensity = this.dark ? 0.32 : 0.45;
        environment.dispose();
        pmrem.dispose();
      }
      this.building = buildHall(this.layout, textures, this.dark);
      this.building.group.traverse((object) => {
        if ((object as THREE.Mesh).isMesh && !(object as THREE.Mesh).castShadow) (object as THREE.Mesh).receiveShadow = true;
      });
      this.scene.add(this.building.group);
      for (const sign of this.building.signs) sign.paint();
      // Main Street beyond the doorway, the eye under the dome, the boards
      this.mainStreet = new MainStreet(this.dark, { wallRadius: WALL_RADIUS, ...DOORWAY });
      this.scene.add(this.mainStreet.group);
      this.providence = new Providence(ROTUNDA.wallTop + ROTUNDA.domeHeight - 7.4);
      this.scene.add(this.providence.group);
      this.scoreboards = new Scoreboards(this.layout, { pos: this.palette.pos, neg: this.palette.neg }, this.calm);
      this.scene.add(this.scoreboards.group);
      this.topBoards = new TopBoards(this.layout, { pos: this.palette.pos, neg: this.palette.neg });
      this.scene.add(this.topBoards.group);
      // a bronze emblem crowns each scoreboard, standing on the plaque of the net
      const bronze = BRONZE();
      for (const alcove of this.layout.alcoves) {
        const geometry = emblemFor(alcove.sector);
        if (!geometry) continue;
        const emblem = new THREE.Mesh(geometry, bronze);
        emblem.position.set(...polar(alcove.mid, ROTUNDA.radius - 1.98, ROTUNDA.galleryHeight + SCOREBOARD_CROWN));
        emblem.rotation.y = -alcove.mid;
        emblem.scale.setScalar(0.62);
        this.scene.add(emblem);
      }
      this.buildBooks(textures?.leather ?? null, logos);
      if (usa) {
        this.map = new MapTable(usa, this.dark, new THREE.MeshStandardMaterial({ color: this.dark ? 0x2b2018 : 0x4a3727, roughness: 0.55, metalness: 0.05 }));
        this.scene.add(this.map.group);
      }
      if (prototypes) {
        this.crowd = new Crowd(prototypes, this.calm);
        this.scene.add(this.crowd.group);
        const kinds: [Exclude<Carry, null>, THREE.BufferGeometry, THREE.Material][] = [
          ["laptop", laptopGeometry(), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.6 })],
          ["cane", caneGeometry(), new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.5 })],
          ["scooter", scooterGeometry(), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.7 })],
          ["bike", bikeGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.4 })],
        ];
        for (const [kind, geometry, material] of kinds) {
          const mesh = new THREE.InstancedMesh(geometry, material, 400);
          mesh.count = 0;
          mesh.frustumCulled = false;
          this.scene.add(mesh);
          this.carried.set(kind, mesh);
        }
      }
      if (this.data) this.setData(this.data);
      this.setSelection(this.selection);
      // a selection made before the hall had loaded (a linked address) still gets its vantage point
      if (this.selection.kind !== null) this.flyToSelection();
      this.events.onReady?.(null);
    } catch (error) {
      this.events.onReady?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** One instanced draw for all books: leather covers in the quarter's colour, the spine (the face towards the hall) with logo and gilt ticker. */
  private buildBooks(leather: THREE.Texture[] | null, logos: { texture: THREE.Texture; index: LogoAtlas } | null): void {
    const base: THREE.MeshStandardMaterialParameters = { color: 0xffffff, roughness: 0.55, metalness: 0.02, ...(leather ? { normalMap: leather[1], normalScale: new THREE.Vector2(0.6, 0.6) } : {}) };
    const cover = new THREE.MeshStandardMaterial(base);
    const spine = spineMaterial(spineAtlas(this.layout.books.map((book) => book.ticker)), logos?.texture ?? null, logos?.index ?? null, base);
    const count = Math.max(1, this.layout.books.length);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const spineCells = new Float32Array(count * 2);
    const logoCells = new Float32Array(count * 3);
    const shapes = new Float32Array(count);
    this.layout.books.forEach((book, index) => {
      spineCells.set(atlasCell(index, SPINE_ATLAS.columns, SPINE_ATLAS.rows), index * 2);
      const logo = logos?.index.tickers[book.ticker];
      if (logos && logo !== undefined) logoCells.set([...atlasCell(logo, logos.index.columns, logos.index.rows), 1], index * 3);
      shapes[index] = book.thickness / book.height;
    });
    geometry.setAttribute("spine", new THREE.InstancedBufferAttribute(spineCells, 2));
    geometry.setAttribute("logo", new THREE.InstancedBufferAttribute(logoCells, 3));
    geometry.setAttribute("shape", new THREE.InstancedBufferAttribute(shapes, 1));
    // the box's faces: +x, -x, +y, -y, +z (the spine, towards the hall), -z
    const books = new THREE.InstancedMesh(geometry, [cover, cover, cover, cover, spine, cover], count);
    books.castShadow = true;
    books.receiveShadow = true;
    books.frustumCulled = false;
    const rest = new THREE.Color(this.tone.book);
    this.layout.books.forEach((book, index) => {
      this.bookIndex.set(book.cik, index);
      rest.toArray(this.tint, index * 3);
      rest.toArray(this.tintTarget, index * 3);
      books.setColorAt(index, rest);
    });
    this.books = books;
    this.scene.add(books);
    this.placeBooks(true);
  }

  // --- labels -----------------------------------------------------------------------------------------------------
  private label(text: string, className: string, at: THREE.Vector3, reach: number, target?: StageTarget, follow?: number): PlacedLabel {
    const rank = className.startsWith("sector") ? 0 : className.startsWith("desk") ? 1 : className.startsWith("book") ? 2 : 3;
    const element = document.createElement(target ? "button" : "div");
    element.className = `desk-lib-label ${className}`;
    element.textContent = text;
    if (target) {
      (element as HTMLButtonElement).type = "button";
      element.addEventListener("click", () => this.events.onPick(target));
    }
    this.labelLayer.appendChild(element);
    return { element, at, reach, rank, shown: false, follow };
  }

  private refreshLabels(): void {
    for (const label of this.labels) label.element.remove();
    this.labels = [];
    const data = this.data;
    if (!data) return;
    // the books carry their tickers on their spines; floating names only for a sector in focus and a selection
    const named = new Set<number>();
    if (this.selection.kind === null && data.focus !== null) {
      const movers = [...this.layout.books].filter((book) => book.sector === data.focus).sort((a, b) => Math.abs(data.company.get(b.cik)?.net ?? 0) - Math.abs(data.company.get(a.cik)?.net ?? 0)).slice(0, 12);
      for (const book of movers) named.add(book.cik);
    }
    if (this.selection.kind === "company" && this.selection.id !== null) named.add(this.selection.id);
    if (this.selection.kind === "fund") for (const thread of this.selection.threads.slice(0, 24)) named.add(thread.id);
    for (const cik of named) {
      const book = this.layout.books[this.bookIndex.get(cik) ?? -1];
      if (!book) continue;
      const net = data.company.get(cik)?.net ?? 0;
      this.labels.push(this.label(book.ticker, `book ${net > 0 ? "in" : net < 0 ? "out" : ""}`, new THREE.Vector3(...polar(book.angle, ROTUNDA.radius - 0.55, book.y)), 40));
    }
    // the people with the largest net trades, and whoever the selection involves
    const people = new Set<number>();
    if (this.selection.kind === null && data.names) for (const cik of data.names.keys()) if (!data.keep || data.keep.has(cik)) people.add(cik);
    else if (this.selection.kind === null) for (const [cik] of [...data.fund].filter(([cik]) => !data.keep || data.keep.has(cik)).sort((a, b) => Math.abs(b[1].bought - b[1].sold) - Math.abs(a[1].bought - a[1].sold)).slice(0, 6)) people.add(cik);
    if (this.selection.kind === "fund" && this.selection.id !== null) people.add(this.selection.id);
    if (this.selection.kind === "company") for (const thread of this.selection.threads.slice(0, 16)) people.add(thread.id);
    for (const placeholder of data.placeholders) this.labels.push(this.label(`${placeholder.name} · not collected`, "desk", new THREE.Vector3(), 46, { kind: "fund", id: placeholder.id }, placeholder.id));
    for (const cik of people) {
      const fund = this.funds.find((item) => item.cik === cik);
      if (!fund) continue;
      const entry = data.fund.get(cik);
      const net = entry ? entry.bought - entry.sold : 0;
      const name = data.names?.get(cik) ?? fund.name;
      // famous names read from across the hall
      this.labels.push(this.label(name.length > 26 ? `${name.slice(0, 25)}…` : name, `desk ${net > 0 ? "in" : net < 0 ? "out" : ""}`, new THREE.Vector3(), data.names ? 95 : 46, { kind: "fund", id: cik }, cik));
    }
  }

  private placeLabels(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const projected = new THREE.Vector3();
    const ordered = [...this.labels].sort((a, b) => a.rank - b.rank || Number(b.shown) - Number(a.shown));
    const taken: [number, number, number, number][] = [];
    for (const label of ordered) {
      if (label.follow !== undefined) {
        const head = this.crowd?.headOf(label.follow, label.at);
        if (!head) {
          label.element.style.display = "none";
          continue;
        }
        label.at.y += 0.28;
      }
      projected.copy(label.at);
      const distance = projected.distanceTo(this.camera.position);
      projected.project(this.camera);
      let visible = projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05 && distance < label.reach;
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;
      if (visible) {
        const half = ((label.element.textContent?.length ?? 6) * (label.rank === 0 ? 7.2 : 6.6) + 22) / 2;
        const box: [number, number, number, number] = [x - half, y - 24, x + half, y + 2];
        if (taken.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) visible = false;
        else taken.push(box);
      }
      label.shown = visible;
      if (!visible) {
        if (label.element.style.display !== "none") label.element.style.display = "none";
        continue;
      }
      label.element.style.display = "";
      label.element.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      label.element.style.opacity = String(clamp(1.25 - distance / label.reach, 0.3, 1));
    }
  }

  // --- data ---------------------------------------------------------------------------------------------------------
  setData(data: StageData): void {
    // a new quarter, or a new choice of who is in the hall: people walk to their places (or out of the hall)
    const moved = this.data !== null && (this.data.links !== data.links || this.data.keep !== data.keep);
    this.data = data;
    if (!this.books) return;
    const values: number[] = [];
    const reading = (cik: number): number | null => {
      const entry = data.company.get(cik);
      if (!entry) return null;
      if (data.mode === "flow") return entry.held > 0 ? entry.net / entry.held : null;
      // what is held: on a log scale from a billion to the largest holding
      if (data.mode === "held") return entry.held > 0 ? Math.max(0, Math.log10(entry.held / 1e9)) : null;
      return entry.since === null ? null : (1 + entry.since) / data.deflator - 1;
    };
    for (const book of this.layout.books) {
      const value = reading(book.cik);
      if (value !== null) values.push(Math.abs(value));
    }
    values.sort((a, b) => a - b);
    const limit = data.mode === "held" ? Math.max(0.5, ...values) : Math.max(data.mode === "flow" ? 0.004 : 0.08, values[Math.floor(values.length * 0.9)] ?? 0);
    const gold = this.dark ? "#d8ad55" : "#b8892e";
    const most = Math.max(1, ...this.layout.books.map((book) => Math.abs(data.company.get(book.cik)?.net ?? 0)));
    const color = new THREE.Color();
    this.layout.books.forEach((book, index) => {
      const value = reading(book.cik);
      const dimmed = data.focus !== null && book.sector !== data.focus;
      const shade = value === null ? this.tone.book : mixOklab(this.tone.book, data.mode === "held" ? gold : value >= 0 ? this.palette.pos : this.palette.neg, Math.min(1, Math.abs(value) / limit));
      color.set(dimmed ? mixOklab(shade, this.tone.sky, 0.55) : shade);
      color.toArray(this.tintTarget, index * 3);
      const net = data.company.get(book.cik)?.net ?? 0;
      const strength = Math.sqrt(Math.abs(net) / most);
      // bought: out of the shelf towards the reader; sold: pushed back towards the wall
      this.pullTarget[index] = dimmed || data.mode === "held" ? 0 : net > 0 ? 0.7 * strength : -0.3 * strength;
    });
    this.settling = true;
    this.updatePeople(moved);
    this.updateStreams();
    this.updateMap();
    this.updateBoards();
    this.refreshLabels();
  }

  /** The scoreboards over the bookcases, the top-ten boards, and Main Street's panel of the money from outside. */
  private updateBoards(): void {
    const data = this.data;
    if (!data) return;
    const companies = new Map<string, number>();
    for (const book of this.layout.books) companies.set(book.sector, (companies.get(book.sector) ?? 0) + 1);
    const scores = new Map<string, SectorScore>();
    for (const [sector, entry] of data.sectors) scores.set(sector, { sector, inflow: entry.bought, outflow: entry.sold, net: entry.net, held: entry.held, companies: companies.get(sector) ?? 0 });
    this.scoreboards?.set(scores, data.mode === "held" ? "held" : data.mode);
    this.topBoards?.set(data.lists);
    let arrived = 0;
    let left = 0;
    for (const link of data.links) {
      if (link.from === FLOW_OUTSIDE && link.to !== FLOW_OUTSIDE) arrived += link.usd;
      if (link.to === FLOW_OUTSIDE && link.from !== FLOW_OUTSIDE) left += link.usd;
    }
    this.mainStreet?.paint({ arrived, left, quarter: data.quarter });
  }

  /** The map table: each state tinted by the quarter's net flow into the companies headquartered there, flags where it was large. */
  private updateMap(): void {
    const data = this.data;
    if (!data || !this.map) return;
    const flows = new Map<string, StateFlow>();
    const abroad: StateFlow = { net: 0, companies: 0 };
    for (const [cik, entry] of data.company) {
      if (!this.headquarters.has(cik)) continue;
      const state = this.headquarters.get(cik);
      const flow = state ? flows.get(state) ?? flows.set(state, { net: 0, companies: 0 }).get(state)! : abroad;
      flow.net += data.mode === "held" ? entry.held : entry.net;
      flow.companies++;
    }
    const gold = this.dark ? "#d8ad55" : "#b8892e";
    this.map.update(flows, abroad, data.mode === "held" ? gold : this.palette.pos, data.mode === "held" ? gold : this.palette.neg, mixOklab);
  }

  /**
   * Puts every fund at its bookcase (or, for index funds, at the map table), walking when the quarter changed; the
   * funds the switch leaves out walk out through the entrance, and the others close up.
   */
  private updatePeople(walk: boolean): void {
    const data = this.data;
    if (!data || !this.crowd) return;
    this.homes.clear();
    this.crowdSize.clear();
    this.visits.clear();
    const specs = [...data.places.keys()].flatMap((cik) => {
      const figure = data.figures.get(cik);
      if (!figure) return [];
      const entry = data.fund.get(cik);
      const gross = entry ? entry.bought + entry.sold : 0;
      const net = entry ? entry.bought - entry.sold : 0;
      // grey without trades; bluer the more of its trading was buying, redder the more was selling
      const quiet = this.dark ? "#4a4842" : "#8f8b82";
      const jacket = new THREE.Color(gross > 0 ? mixOklab(quiet, net >= 0 ? this.palette.pos : this.palette.neg, 0.45 + 0.55 * Math.min(1, Math.abs(net) / gross / 0.5)) : quiet);
      const { look } = figure;
      return [{ cik, body: figure.body, scale: figure.scale, girth: figure.girth, carry: figure.carry, pace: figure.pace, colours: { jacket, pants: new THREE.Color(look.pants), shirt: new THREE.Color(look.shirt), hair: new THREE.Color(figure.hair ?? look.hair), wood: new THREE.Color(look.wood) } }];
    });
    // the public figures whose trades are not collected wait just inside the entrance, in grey
    const grey = new THREE.Color(this.dark ? "#5a5852" : "#9a968e");
    for (const placeholder of data.placeholders) specs.push({ cik: placeholder.id, body: "mannequin", scale: 0.8, girth: 1, carry: null, pace: 1, colours: { jacket: grey.clone(), pants: grey.clone(), shirt: grey.clone(), hair: grey.clone(), wood: new THREE.Color("#b8b2a6") } });
    this.crowd.sync(specs);
    data.placeholders.forEach((placeholder, index) => {
      const angle = Math.PI + (index - (data.placeholders.length - 1) / 2) * 0.05;
      const [x, , z] = polar(angle, ROTUNDA.radius - 4.5);
      this.crowd!.place(placeholder.id, { x, z, angle }, { x: 0, z: 0 }, false);
    });
    // crowds per bookcase, the largest funds nearest the books; the staff round the map table
    const groups = new Map<string, number[]>();
    const staff: number[] = [];
    for (const [cik, place] of data.places) {
      const figure = data.figures.get(cik);
      if (!figure) continue;
      if (data.keep && !data.keep.has(cik)) {
        this.crowd.leave(cik, walk && this.placed);
        continue;
      }
      if (figure.staff || place.home === null) staff.push(cik);
      else (groups.get(place.home) ?? groups.set(place.home, []).get(place.home)!).push(cik);
    }
    const sizeOf = (cik: number) => data.figures.get(cik)?.scale ?? 1;
    const wedges = crowdWedges(this.layout.alcoves);
    for (const [sector, members] of groups) {
      const alcove = this.layout.alcoves.find((item) => item.sector === sector);
      if (!alcove) {
        staff.push(...members);
        continue;
      }
      members.sort((a, b) => sizeOf(b) - sizeOf(a) || a - b);
      this.crowdSize.set(sector, members.length);
      const slots = crowdSlots(alcove, members.length, wedges.get(sector));
      const centre = slots.reduce((sum, slot) => ({ x: sum.x + slot.x / slots.length, z: sum.z + slot.z / slots.length }), { x: 0, z: 0 });
      members.forEach((cik, index) => {
        const slot = slots[index];
        // most look at the books, some turn to the group: a crowd in conversation
        const turn = (cik * 0.618) % 1;
        const books = polar(alcove.mid + (slot.angle - alcove.mid) * 0.5, ROTUNDA.radius);
        const face = turn < 0.55 ? { x: books[0], z: books[2] } : { x: centre.x, z: centre.z };
        this.homes.set(cik, { slot, face });
        this.crowd!.place(cik, slot, face, walk && this.placed);
      });
    }
    staff.sort((a, b) => sizeOf(b) - sizeOf(a) || a - b);
    const ring = staffSlots(staff.length);
    staff.forEach((cik, index) => {
      const slot = ring[index];
      // the staff face the hall, their backs to the map table
      this.crowd!.place(cik, slot, { x: slot.x * 2, z: slot.z * 2 }, walk && this.placed);
    });
    this.placed = true;
  }

  /**
   * Now and then a fund with a sizable stake in another sector walks over to that bookcase, stands at the edge of
   * the crowd there for a while and walks back: two at a time, never more than eight away, none while a quarter's
   * walk is under way, never the selected fund.
   */
  private updateVisits(seconds: number): void {
    const data = this.data;
    const crowd = this.crowd;
    if (!data || !crowd || this.calm) return;
    for (const [cik, visit] of this.visits) {
      if (visit.phase === "going" && crowd.idle(cik)) {
        visit.phase = "staying";
        visit.until = this.clock + stayFor(cik);
      } else if (visit.phase === "staying" && this.clock >= visit.until) {
        const home = this.homes.get(cik);
        if (home) crowd.place(cik, home.slot, home.face, true);
        visit.phase = "returning";
      } else if (visit.phase === "returning" && crowd.idle(cik)) this.visits.delete(cik);
    }
    this.visitClock += seconds;
    if (this.visitClock < 2.5 || this.visits.size >= 8 || crowd.walking() > this.visits.size + 2) return;
    this.visitClock = 0;
    const busy = new Set<number>(this.visits.keys());
    if (this.selection.kind === "fund" && this.selection.id !== null) busy.add(this.selection.id);
    const shelved = new Set(this.layout.alcoves.map((alcove) => alcove.sector));
    const visitors = [...this.homes.keys()].flatMap((cik) => {
      const place = data.places.get(cik);
      const stakes = (place?.stakes ?? []).filter((stake) => stake.sector !== place?.home && shelved.has(stake.sector));
      return stakes.length && crowd.idle(cik) ? [{ cik, stakes }] : [];
    });
    const wedges = crowdWedges(this.layout.alcoves);
    const taken = new Set([...this.visits.values()].map((visit) => visit.spot));
    for (const visit of nextVisits(visitors, busy, this.visitRound++, 2)) {
      const alcove = this.layout.alcoves.find((item) => item.sector === visit.sector)!;
      const count = this.crowdSize.get(visit.sector) ?? 0;
      // a free place at the edge of the crowd there
      const free = crowdSlots(alcove, count + 14, wedges.get(visit.sector)).slice(count);
      const index = free.findIndex((_, at) => !taken.has(`${visit.sector}|${(at + visit.cik) % free.length}`));
      if (index < 0) continue;
      const at = (index + visit.cik) % free.length;
      const spot = `${visit.sector}|${at}`;
      taken.add(spot);
      const slot = free[at];
      const books = polar(alcove.mid + (slot.angle - alcove.mid) * 0.5, ROTUNDA.radius);
      crowd.place(visit.cik, slot, { x: books[0], z: books[2] }, true);
      this.visits.set(visit.cik, { phase: "going", until: 0, spot });
    }
  }

  /** What people carry or ride, wherever they stand or go: laptops, canes, scooters, bikes. */
  private placeCarried(): void {
    if (!this.crowd || !this.carried.size) return;
    const matrix = new THREE.Matrix4();
    const counts = new Map<Carry, number>();
    const colour = new THREE.Color();
    this.crowd.forEachPresent((cik, root, carry) => {
      const mesh = carry ? this.carried.get(carry) : undefined;
      if (!carry || !mesh) return;
      const index = counts.get(carry) ?? 0;
      if (index >= mesh.instanceMatrix.count) return;
      mesh.setMatrixAt(index, matrix.multiplyMatrices(root.matrixWorld, HELD[carry]));
      if (carry === "bike") mesh.setColorAt(index, colour.set(BIKES[cik % BIKES.length]));
      counts.set(carry, index + 1);
    });
    for (const [carry, mesh] of this.carried) {
      mesh.count = counts.get(carry) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private anchorOf(sector: string): THREE.Vector3 | null {
    return this.building?.anchors.get(sector === FLOW_OUTSIDE ? "Outside" : sector)?.clone() ?? null;
  }

  private updateStreams(): void {
    const data = this.data;
    if (!data || !this.building) return;
    const specs: StreamSpec[] = [];
    const quiet = this.selection.kind !== null && this.selection.threads.length > 0;
    for (const link of data.mode === "held" ? [] : data.links.filter((item) => item.from !== item.to).slice(0, 16)) {
      const from = this.anchorOf(link.from);
      const to = this.anchorOf(link.to);
      if (!from || !to) continue;
      specs.push({ from, to, usd: link.usd, start: this.negative, end: this.positive, kind: "rotation", lit: !quiet && (data.focus === null || link.from === data.focus || link.to === data.focus), label: { from: link.from, to: link.to } });
    }
    // a selected fund's money runs between the person and the books; a selected book's to and from its traders
    const head = new THREE.Vector3();
    for (const thread of this.selection.threads.slice(0, 30)) {
      const fundCik = this.selection.kind === "fund" ? this.selection.id! : thread.id;
      const bookCik = this.selection.kind === "fund" ? thread.id : this.selection.id!;
      const person = this.crowd?.headOf(fundCik, head)?.clone();
      const book = this.layout.books[this.bookIndex.get(bookCik) ?? -1];
      if (!person || !book) continue;
      const face = new THREE.Vector3(...polar(book.angle, ROTUNDA.radius - 0.4, book.y));
      const bought = thread.usd > 0;
      const tone = bought ? this.positive : this.negative;
      specs.push({ from: bought ? person : face, to: bought ? face : person, usd: Math.abs(thread.usd), start: tone, end: tone, kind: "thread", lit: true });
    }
    this.streams.set(specs);
  }

  setSelection(selection: StageSelection): void {
    const changed = selection.kind !== this.selection.kind || selection.id !== this.selection.id;
    const threadsArrived = selection.threads.length > 0 && this.selection.threads.length === 0;
    this.selection = selection;
    if (!this.building) return;
    this.updateStreams();
    this.settling = true;
    if (changed || threadsArrived) this.flyToSelection();
    this.placeHalo();
    this.refreshLabels();
  }

  private placeHalo(): void {
    const { kind, id } = this.selection;
    const book = kind === "company" ? this.layout.books[this.bookIndex.get(id ?? -1) ?? -1] : undefined;
    const head = kind === "fund" && id !== null ? this.crowd?.headOf(id) : null;
    this.halo.visible = Boolean(book ?? head);
    if (book) {
      this.halo.position.set(...polar(book.angle, ROTUNDA.radius - 0.6, book.y));
      this.halo.scale.setScalar(Math.max(2.2, book.thickness * 2.2));
    } else if (head) {
      this.halo.position.copy(head);
      this.halo.scale.setScalar(2.4);
    }
  }

  private placeBooks(force: boolean): void {
    if (!this.books || (!this.settling && !force)) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const selected = this.selection.kind === "company" ? this.bookIndex.get(this.selection.id ?? -1) : undefined;
    const hovered = this.hovered?.kind === "company" ? this.bookIndex.get(this.hovered.id) : undefined;
    const threaded = this.selection.kind === "fund" ? new Set(this.selection.threads.map((thread) => this.bookIndex.get(thread.id))) : null;
    const ink = new THREE.Color(this.tone.ink);
    let moving = false;
    for (let index = 0; index < this.layout.books.length; index++) {
      const book = this.layout.books[index];
      const target = this.pullTarget[index] + (index === selected ? 0.5 : threaded?.has(index) ? 0.3 : 0);
      const step = force ? 1 : 0.12;
      this.pull[index] += (target - this.pull[index]) * step;
      for (let channel = 0; channel < 3; channel++) this.tint[index * 3 + channel] += (this.tintTarget[index * 3 + channel] - this.tint[index * 3 + channel]) * step;
      if (Math.abs(target - this.pull[index]) > 0.002 || Math.abs(this.tintTarget[index * 3] - this.tint[index * 3]) > 0.004) moving = true;
      const radius = ROTUNDA.radius + ROTUNDA.bookDepth / 2 - this.pull[index];
      position.set(...polar(book.angle, radius, book.y));
      rotation.setFromAxisAngle(up, -book.angle);
      scale.set(book.thickness, book.height, ROTUNDA.bookDepth * 0.92);
      matrix.compose(position, rotation, scale);
      this.books.setMatrixAt(index, matrix);
      color.fromArray(this.tint, index * 3);
      if (index === hovered || index === selected) color.lerp(ink, 0.25);
      this.books.setColorAt(index, color);
    }
    this.books.instanceMatrix.needsUpdate = true;
    if (this.books.instanceColor) this.books.instanceColor.needsUpdate = true;
    this.settling = moving;
  }

  // --- camera -----------------------------------------------------------------------------------------------------
  private applyPose(): void {
    this.camera.position.set(this.pose.x, this.pose.y, this.pose.z);
    this.camera.rotation.set(this.pose.pitch, this.pose.yaw, 0, "YXZ");
  }

  private aim(from: THREE.Vector3, at: THREE.Vector3): Pose {
    const direction = at.clone().sub(from);
    return { x: from.x, y: from.y, z: from.z, yaw: Math.atan2(-direction.x, -direction.z), pitch: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) };
  }

  private fly(to: Pose): void {
    this.focusedBoard = null;
    const from = { ...this.pose };
    const turn = ((to.yaw - from.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.flight = { from, to: { ...to, yaw: from.yaw + turn }, started: performance.now(), duration: this.calm ? 1 : 1300 };
  }

  /** Stand in the hall facing a sector's bookcase, far enough back to see it and the crowd in front of it. */
  flyToSector(sector: string | null): void {
    if (sector === null) return this.flyHome();
    const alcove = this.layout.alcoves.find((item) => item.sector === sector);
    if (!alcove) return;
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const distance = clamp((alcove.width / 2 + 1.5) / (Math.tan(half) * Math.max(0.6, this.openAspect())), 9, 22);
    const middle = ROTUNDA.shelfBase + (ROTUNDA.rows * ROTUNDA.rowHeight) / 2 + 0.6;
    this.fly(this.aim(new THREE.Vector3(...polar(alcove.mid, ROTUNDA.radius - distance, middle + 2.2)), new THREE.Vector3(...polar(alcove.mid, ROTUNDA.radius, middle))));
  }

  flyHome(): void {
    this.fly({ ...HOME });
  }

  /** Square in front of a top-ten board, near enough to read it whole, centred in the part of the view left open. */
  private flyToBoard(index: number): void {
    const frame = this.topBoards?.frameOf(index);
    if (!frame) return;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // about two thirds of the view's height, so the title panel above and the timeline below leave it whole
    const distance = Math.max(frame.height / 2 / (half * 0.66), (frame.width / 2 + 0.3) / (half * this.openAspect() * 0.85));
    this.fly(this.aim(frame.centre.clone().addScaledVector(frame.normal, distance), frame.centre));
    this.focusedBoard = index;
  }

  /** High over the entrance under the dome, looking down over the whole floor: every crowd at once. */
  flyAbove(): void {
    this.fly(this.aim(new THREE.Vector3(0, ROTUNDA.wallTop + 5.5, ROTUNDA.radius - 4), new THREE.Vector3(0, 0, -3)));
  }

  private flyToSelection(): void {
    const { kind, id } = this.selection;
    if (kind === "company" && id !== null) {
      const book = this.layout.books[this.bookIndex.get(id) ?? -1];
      // back across the floor and above the crowd in front of the bookcase, the book and its traders in view
      if (book) this.fly(this.aim(new THREE.Vector3(...polar(book.angle - 0.06, ROTUNDA.radius - 14, book.y + 5.2)), new THREE.Vector3(...polar(book.angle, ROTUNDA.radius - 3, book.y))));
    } else if (kind === "fund" && id !== null) {
      const head = this.crowd?.headOf(id);
      if (!head) return;
      // behind the person, looking past it towards the books it traded
      let weight = 0;
      const target = new THREE.Vector3();
      for (const thread of this.selection.threads) {
        const book = this.layout.books[this.bookIndex.get(thread.id) ?? -1];
        if (!book) continue;
        target.add(new THREE.Vector3(...polar(book.angle, ROTUNDA.radius, book.y)).multiplyScalar(Math.abs(thread.usd)));
        weight += Math.abs(thread.usd);
      }
      if (weight > 0) target.divideScalar(weight);
      else target.set(...polar(angleOf(head.x, head.z), ROTUNDA.radius, 2.5));
      // from the middle of the hall's side of the person, a little above the crowd, looking out past it at the books
      const inward = new THREE.Vector3(-head.x, 0, -head.z);
      if (inward.lengthSq() < 1e-6) inward.set(0, 0, 1);
      const from = head.clone().add(inward.normalize().multiplyScalar(8.5)).setY(head.y + 3.4);
      this.fly(this.aim(from, head.clone().lerp(target, 0.15)));
    }
  }

  // --- input ------------------------------------------------------------------------------------------------------
  private readonly onPointerMove = (event: PointerEvent): void => {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    this.pointerClient = [event.clientX - box.left, event.clientY - box.top];
    if (this.dragging) {
      const dx = event.clientX - this.dragging.x;
      const dy = event.clientY - this.dragging.y;
      this.dragging = { x: event.clientX, y: event.clientY, moved: this.dragging.moved + Math.abs(dx) + Math.abs(dy) };
      this.flight = null;
      if (this.dragging.moved >= 5) this.focusedBoard = null;
      this.pose.yaw += dx * 0.0042;
      this.pose.pitch = clamp(this.pose.pitch + dy * 0.0032, -1.2, 1.1);
    } else this.pointerDirty = true;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = { x: event.clientX, y: event.clientY, moved: 0 };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
    this.renderer.domElement.focus({ preventScroll: true });
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.dragging;
    this.dragging = null;
    this.renderer.domElement.releasePointerCapture?.(event.pointerId);
    this.renderer.domElement.style.cursor = "grab";
    if (drag && drag.moved < 5) {
      this.pick();
      // a top-ten board first comes to the reader, centred and near enough to read; then its rows can be picked
      if (this.hoveredBoard !== null && this.hoveredBoard !== this.focusedBoard) {
        this.flyToBoard(this.hoveredBoard);
        return;
      }
      if (this.hovered) this.events.onPick(this.hovered);
    }
  };

  private readonly onLeave = (): void => {
    this.pointer.set(2, 2);
    if (this.hovered) {
      this.hovered = null;
      this.settling = true;
      this.events.onHover(null, 0, 0);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.flight = null;
    this.focusedBoard = null;
    const stride = clamp(event.deltaY, -240, 240) * -0.035;
    this.move(stride, 0, Math.sin(this.pose.pitch) * stride);
    this.pointerDirty = true;
  };

  /** Keys walk the hall when it has the focus, or anywhere in the game view, but never in a text field or a shortcut. */
  private keysFor(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return false;
    return this.game || target === this.renderer.domElement;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.keysFor(event)) return;
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "r", "f", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "q", "e"].includes(key)) {
      this.keys.add(key);
      if (key !== "shift") event.preventDefault();
      this.flight = null;
      if (key !== "shift") this.focusedBoard = null;
    } else if (key === "home") {
      event.preventDefault();
      this.flyHome();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly onBlur = (): void => this.keys.clear();

  /** Walks forward/back and sideways on the floor and rises or falls, staying inside the hall. */
  private move(forward: number, sideways: number, rise: number): void {
    const yaw = this.pose.yaw;
    let x = this.pose.x - Math.sin(yaw) * forward + Math.cos(yaw) * sideways;
    let z = this.pose.z - Math.cos(yaw) * forward - Math.sin(yaw) * sideways;
    const radius = Math.hypot(x, z);
    const limit = ROTUNDA.radius - 1.6;
    if (radius > limit) {
      x *= limit / radius;
      z *= limit / radius;
    }
    this.pose.x = x;
    this.pose.z = z;
    this.pose.y = clamp(this.pose.y + rise, 1.6, ROTUNDA.wallTop + 6);
  }

  private listen(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** The full-screen game view: the keys work wherever the focus is, and the hall takes the focus at once. */
  /** Every stream whole, or only the half of each where the money arrived (blue) or where it left (red). */
  setStreamPart(part: StreamPart): void {
    this.streams.setPart(part);
    this.settling = true;
  }

  setGame(on: boolean): void {
    this.game = on;
    this.keys.clear();
    if (on) this.renderer.domElement.focus({ preventScroll: true });
  }

  private pick(): void {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [];
    if (this.books) targets.push(this.books);
    if (this.crowd) targets.push(...this.crowd.pickers);
    if (this.building) targets.push(this.building.door, ...this.building.panes);
    if (this.mainStreet) targets.push(this.mainStreet.plaque);
    if (this.map) targets.push(...this.map.tiles);
    if (this.scoreboards) targets.push(...this.scoreboards.faces);
    if (this.topBoards) targets.push(...this.topBoards.faces);
    targets.push(...this.streams.pickable);
    // a stream's hidden half (when only the blue or only the red part shows) cannot be pointed at
    const hits = this.raycaster.intersectObjects(targets, false).filter((item) => !item.object.userData.stream || this.streams.showsAt(item.object, item.uv));
    let next: StageTarget | null = null;
    // the streams overhead are thin: a top-ten board behind one is what the reader is pointing at
    const behind = hits[0]?.object.userData.stream ? hits.find((item) => typeof item.object.userData.board === "number") : undefined;
    const hit = behind ?? hits[0];
    this.hoveredBoard = typeof hit?.object.userData.board === "number" ? hit.object.userData.board : null;
    if (hit) {
      if (hit.object === this.books && hit.instanceId !== undefined) next = { kind: "company", id: this.layout.books[hit.instanceId].cik };
      else if (typeof hit.object.userData.cik === "number") next = { kind: "fund", id: hit.object.userData.cik };
      else if (hit.object === this.building?.door || hit.object.userData.outside === true) next = { kind: "outside" };
      else if (typeof hit.object.userData.sector === "string") next = { kind: "sector", name: hit.object.userData.sector };
      else if (typeof hit.object.userData.state === "string") next = { kind: "state", code: hit.object.userData.state, name: this.map?.nameOf(hit.object.userData.state) ?? hit.object.userData.state };
      else if (typeof hit.object.userData.board === "number" && hit.uv) {
        const row = this.topBoards?.rowAt(hit.object.userData.board, hit.uv);
        next = row?.target ?? null;
      } else if (hit.object.userData.stream) next = { kind: "stream", ...(hit.object.userData.stream as { from: string; to: string; usd: number }) };
    }
    const same = JSON.stringify(next) === JSON.stringify(this.hovered);
    this.hovered = next;
    if (!same) this.settling = true;
    this.events.onHover(next, this.pointerClient[0], this.pointerClient[1]);
  }

  // --- frame ------------------------------------------------------------------------------------------------------
  /** Pixels of the right edge and of the bottom covered by panels: the hall is drawn centred in what is left. */
  setInset(right: number, bottom: number): void {
    this.inset = Math.max(0, right);
    this.insetBottom = Math.max(0, bottom);
    this.resize();
  }

  private openAspect(): number {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    return Math.max(0.4, (width - (this.inset < width * 0.6 ? this.inset : 0)) / Math.max(1, height - this.insetBottom));
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width / 2, height / 2);
    this.camera.aspect = width / height;
    const right = this.inset < width * 0.6 ? this.inset : 0;
    this.camera.setViewOffset(width, height, right / 2, Math.min(this.insetBottom, height * 0.3) * 0.3, width, height);
    this.camera.updateProjectionMatrix();
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (document.hidden) return;
    const seconds = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    this.clock += seconds;
    if (this.flight) {
      const t = clamp((now - this.flight.started) / this.flight.duration, 0, 1);
      const k = ease(t);
      const { from, to } = this.flight;
      this.pose.x = from.x + (to.x - from.x) * k;
      this.pose.y = from.y + (to.y - from.y) * k;
      this.pose.z = from.z + (to.z - from.z) * k;
      this.pose.yaw = from.yaw + (to.yaw - from.yaw) * k;
      this.pose.pitch = from.pitch + (to.pitch - from.pitch) * k;
      if (t >= 1) this.flight = null;
    }
    if (this.keys.size) {
      const speed = (this.keys.has("shift") ? 16 : 7) * seconds;
      const forward = (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0) - (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0);
      const sideways = (this.keys.has("d") ? 1 : 0) - (this.keys.has("a") ? 1 : 0);
      const turn = (this.keys.has("arrowleft") || this.keys.has("q") ? 1 : 0) - (this.keys.has("arrowright") || this.keys.has("e") ? 1 : 0);
      const rise = (this.keys.has("r") ? 1 : 0) - (this.keys.has("f") ? 1 : 0);
      this.pose.yaw += turn * 1.6 * seconds;
      this.move(forward * speed, sideways * speed, rise * speed * 0.7);
    }
    this.applyPose();
    if (this.pointerDirty && !this.dragging) {
      this.pointerDirty = false;
      this.pick();
    }
    this.placeBooks(false);
    this.crowd?.update(this.calm ? 0 : seconds);
    this.updateVisits(seconds);
    this.placeCarried();
    if (this.halo.visible && this.selection.kind === "fund" && this.selection.id !== null) {
      const head = this.crowd?.headOf(this.selection.id);
      if (head) this.halo.position.copy(head);
    }
    // from high under the dome the streams thin out so the crowds below show through
    this.streams.update(this.calm ? 0 : this.clock, clamp(1 - (this.camera.position.y - 11) / 9, 0.22, 1));
    if (!this.calm) this.map?.flutter(this.clock);
    // the map keeps north away from the reader, wherever they stand
    if (this.map) this.map.group.rotation.y = Math.atan2(this.camera.position.x, this.camera.position.z);
    this.providence?.watch(this.camera.position);
    this.scoreboards?.update(this.clock);
    this.mainStreet?.update(this.calm ? 0 : this.clock);
    this.composer.render();
    this.placeLabels();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizer.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointerleave", this.onLeave);
    canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.crowd?.dispose();
    this.map?.dispose();
    this.mainStreet?.dispose();
    this.providence?.dispose();
    this.scoreboards?.dispose();
    this.topBoards?.dispose();
    this.streams.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      for (const item of Array.isArray(material) ? material : material ? [material] : []) {
        for (const value of Object.values(item)) if (value instanceof THREE.Texture) value.dispose();
        item.dispose();
      }
    });
    this.scene.environment?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.labelLayer.remove();
  }
}
