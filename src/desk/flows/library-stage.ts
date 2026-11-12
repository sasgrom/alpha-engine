/**
 * The library of capital, drawn with three.js. A hall of bookcases: one bookcase per sector, one book per covered
 * company (thickness = value held by the tracked funds), the funds at reading desks in the nave. A quarter is
 * shown by what moves: books that were bought slide out toward the reader and turn blue, books that were sold sink
 * back and turn red; streams of light overhead carry the estimated rotation from the sectors sold to the sectors
 * bought, and through the door at the far end to and from everything outside the covered stocks. Selecting a desk
 * or a book strings threads between the fund and the companies it traded.
 *
 * No React in here: the page hands in data and receives hover and pick events. Labels are plain elements the
 * stage positions itself, so nothing re-renders per frame.
 */
import * as THREE from "three";
import { FLOW_OUTSIDE, type FlowLink } from "@contracts/fund-flows";
import { mixOklab, type ChartPalette } from "../charts/color";
import { HALL, libraryLayout, type BookLayout, type DeskLayout, type LayoutCompany, type LayoutFund, type LibraryLayout } from "./library-layout";

export interface StageCompany extends LayoutCompany { name: string }
export interface StageFund extends LayoutFund { name: string }

export interface StageData {
  /** Per company: net flow of the quarter, value held, and the stock's return since the quarter end. */
  company: Map<number, { net: number; held: number; since: number | null }>;
  /** Per fund counted in the quarter: dollars bought and sold. */
  fund: Map<number, { bought: number; sold: number }>;
  sectors: Map<string, { net: number; bought: number; sold: number }>;
  links: FlowLink[];
  /** "flow": colour is the net flow against the value held. "outcome": colour is the return since. */
  mode: "flow" | "outcome";
  /** Price level now over the price level then, to restate returns after inflation (1 = leave as is). */
  deflator: number;
  focus: string | null;
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
  | { kind: "outside" };

export interface StageEvents {
  onHover: (target: StageTarget | null, x: number, y: number) => void;
  onPick: (target: StageTarget | null) => void;
}

interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }
interface PlacedLabel { element: HTMLElement; at: THREE.Vector3; reach: number; rank: number; shown: boolean }

interface Stream {
  from: THREE.Vector3;
  control: THREE.Vector3;
  to: THREE.Vector3;
  /** Colour at the start and at the end of the way. */
  start: THREE.Color;
  end: THREE.Color;
  particles: number;
  lit: boolean;
}

const COLORS = {
  dark: { sky: "#0b0c10", floor: "#17181d", runner: "#1f2128", wood: "#3b312a", board: "#4d4239", book: "#716e67", desk: "#4b4138", lampOff: "#5c5952", door: "#efdfb6", ink: "#f0efec" },
  light: { sky: "#f3f1ea", floor: "#e7e4da", runner: "#dcd8cb", wood: "#b9ab93", board: "#cdbfa8", book: "#aca89e", desk: "#c2b59d", lampOff: "#a9a59a", door: "#ffffff", ink: "#0b0b0b" },
} as const;

/** Where the reader stands on arrival: a little back from the first bookcases, looking down the nave. */
const HOME: Pose = { x: 0, y: 6.2, z: 12, yaw: 0, pitch: -0.22 };

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function webglAvailable(): boolean {
  if (typeof window === "undefined" || typeof WebGLRenderingContext === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export class LibraryStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(54, 1, 0.1, 420);
  private readonly layout: LibraryLayout;
  private readonly tone: (typeof COLORS)["dark" | "light"];
  private readonly bookIndex = new Map<number, number>();
  private readonly deskIndex = new Map<number, number>();
  private readonly books: THREE.InstancedMesh;
  private readonly desks: THREE.InstancedMesh;
  private readonly lamps: THREE.Points;
  private readonly bayPlanes: THREE.Mesh[] = [];
  private readonly door: THREE.Mesh;
  private readonly halo: THREE.Sprite;
  private readonly streamLines = new THREE.Group();
  private readonly sparks: THREE.Points;
  private readonly sparkCapacity = 3400;
  private streams: Stream[] = [];
  private sparkOf: { stream: number; phase: number; speed: number }[] = [];
  private flowStreams: Stream[] = [];
  private threadStreams: Stream[] = [];
  private readonly labelLayer: HTMLDivElement;
  private labels: PlacedLabel[] = [];
  private fixedLabels: PlacedLabel[] = [];
  private readonly sectorLabels = new Map<string, HTMLElement>();
  private readonly pull: Float32Array;
  private readonly pullTarget: Float32Array;
  private readonly tint: Float32Array;
  private readonly tintTarget: Float32Array;
  private settling = true;
  private data: StageData | null = null;
  private selection: StageSelection = { kind: null, id: null, threads: [] };
  private hovered: StageTarget | null = null;
  private readonly pointer = new THREE.Vector2(2, 2);
  private pointerClient: [number, number] = [0, 0];
  private pointerDirty = false;
  private dragging: { x: number; y: number; moved: number } | null = null;
  private readonly pose: Pose = { ...HOME };
  private flight: { from: Pose; to: Pose; started: number; duration: number } | null = null;
  private lastTouch = 0;
  private inset = 0;
  private insetBottom = 0;
  private framedFor = "";
  private frame = 0;
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

  constructor(host: HTMLElement, companies: StageCompany[], funds: StageFund[], dark: boolean, palette: ChartPalette, events: StageEvents) {
    this.host = host;
    this.funds = funds;
    this.dark = dark;
    this.palette = palette;
    this.events = events;
    this.tone = COLORS[dark ? "dark" : "light"];
    this.positive = new THREE.Color(palette.pos);
    this.negative = new THREE.Color(palette.neg);
    this.calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.layout = libraryLayout(companies, funds);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.style.cssText = "display:block;width:100%;height:100%;outline:none;touch-action:none;cursor:grab";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute("aria-label", "A hall of bookcases: one bookcase per sector, one book per company, the funds at desks in the middle. Use the reading view for the same figures as charts and tables.");
    host.appendChild(this.renderer.domElement);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "desk-lib-labels";
    host.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color(this.tone.sky);
    this.scene.fog = new THREE.FogExp2(this.tone.sky, dark ? 0.0098 : 0.0088);
    this.scene.add(new THREE.HemisphereLight(dark ? "#c3cde2" : "#ffffff", dark ? "#1b1713" : "#cfc8b8", 1.5));
    // one lamp for each wall, so the spines on both sides of the aisle are lit alike
    for (const side of [-1, 1]) {
      const lamp = new THREE.DirectionalLight("#ffffff", dark ? 1.15 : 0.85);
      lamp.position.set(side * 7, 15, 9);
      this.scene.add(lamp);
    }

    this.buildHall();
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.books = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: "#ffffff" }), Math.max(1, this.layout.books.length));
    this.books.frustumCulled = false;
    this.layout.books.forEach((book, index) => this.bookIndex.set(book.cik, index));
    this.pull = new Float32Array(this.layout.books.length);
    this.pullTarget = new Float32Array(this.layout.books.length);
    this.tint = new Float32Array(this.layout.books.length * 3);
    this.tintTarget = new Float32Array(this.layout.books.length * 3);
    const rest = new THREE.Color(this.tone.book);
    for (let index = 0; index < this.layout.books.length; index++) {
      rest.toArray(this.tint, index * 3);
      rest.toArray(this.tintTarget, index * 3);
      this.books.setColorAt(index, rest);
    }
    this.placeBooks(true);
    this.scene.add(this.books);

    this.desks = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: "#ffffff" }), Math.max(1, this.layout.desks.length));
    this.desks.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const deskColor = new THREE.Color(this.tone.desk);
    this.layout.desks.forEach((desk, index) => {
      this.deskIndex.set(desk.cik, index);
      matrix.compose(new THREE.Vector3(desk.x, 0.36, desk.z), new THREE.Quaternion(), new THREE.Vector3(desk.size, 0.72, desk.size * 0.62));
      this.desks.setMatrixAt(index, matrix);
      this.desks.setColorAt(index, deskColor);
    });
    this.desks.instanceMatrix.needsUpdate = true;
    this.scene.add(this.desks);

    const glow = this.glowTexture();
    const lampGeometry = new THREE.BufferGeometry();
    lampGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.layout.desks.flatMap((desk) => [desk.x, 1.02, desk.z])), 3));
    lampGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.layout.desks.length * 3), 3));
    this.lamps = new THREE.Points(lampGeometry, new THREE.PointsMaterial({ size: 0.62, map: glow, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.lamps.frustumCulled = false;
    this.scene.add(this.lamps);

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.sparkCapacity * 3), 3));
    sparkGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.sparkCapacity * 3), 3));
    sparkGeometry.setDrawRange(0, 0);
    this.sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ size: dark ? 0.46 : 0.3, map: glow, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks, this.streamLines);

    const far = -(this.layout.length + 16);
    this.door = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 9.6), new THREE.MeshBasicMaterial({ color: this.tone.door, fog: false }));
    this.door.position.set(0, 4.8, far);
    if (dark) {
      const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: this.tone.door, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      light.position.set(0, 5.2, far + 0.6);
      light.scale.set(30, 30, 1);
      this.scene.add(light);
    }
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: palette.accent, transparent: true, opacity: dark ? 0.75 : 0.5, depthWrite: false, depthTest: false, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.halo.visible = false;
    this.scene.add(this.halo);
    const frame = new THREE.MeshLambertMaterial({ color: this.tone.wood });
    for (const [x, y, width, height] of [[-3.15, 5.1, 0.7, 10.2], [3.15, 5.1, 0.7, 10.2], [0, 10.0, 7, 0.8]]) {
      const post = new THREE.Mesh(unit, frame);
      post.position.set(x, y, far + 0.2);
      post.scale.set(width, height, 0.7);
      this.scene.add(post);
    }
    this.scene.add(this.door);

    this.buildFixedLabels();
    this.applyPose();
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(host);
    this.resize();
    this.listen();
    this.frame = requestAnimationFrame(this.tick);
  }

  // --- building ---------------------------------------------------------------------------------------------------
  private buildHall(): void {
    const { layout, tone } = this;
    const depth = layout.length + 150;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, depth), new THREE.MeshLambertMaterial({ color: tone.floor }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 20 - depth / 2);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(HALL.aisle * 2 - 2.4, depth), new THREE.MeshLambertMaterial({ color: tone.runner }));
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, 0.01, 20 - depth / 2);
    this.scene.add(floor, runner);

    // bookcases: a back, two ends and the boards; beyond the last sector the same cases stand empty into the distance
    const cases: { side: -1 | 1; from: number; to: number; ghost: boolean }[] = layout.bays.map((bay) => ({ ...bay, ghost: false }));
    for (const side of [-1, 1] as const) {
      let from = Math.max(HALL.entrance, ...layout.bays.filter((bay) => bay.side === side).map((bay) => bay.to)) + HALL.bayGap;
      for (let extra = 0; extra < 9; extra++) {
        cases.push({ side, from, to: from + 9.5, ghost: true });
        from += 9.5 + HALL.bayGap;
      }
    }
    const pieces: { position: [number, number, number]; scale: [number, number, number]; board: boolean }[] = [];
    const caseDepth = HALL.bookDepth + 0.42;
    for (const item of cases) {
      const centre = -(item.from + item.to) / 2;
      const width = item.to - item.from + 0.3;
      const x = item.side * (HALL.aisle + caseDepth / 2);
      pieces.push({ position: [item.side * (HALL.aisle + caseDepth + 0.05), layout.top / 2 + 0.1, centre], scale: [0.1, layout.top + 0.5, width], board: false });
      for (const end of [item.from - 0.12, item.to + 0.12]) pieces.push({ position: [x, layout.top / 2 + 0.1, -end], scale: [caseDepth, layout.top + 0.5, 0.12], board: false });
      for (let shelf = 0; shelf <= HALL.shelves; shelf++) pieces.push({ position: [x, HALL.shelfBase + shelf * HALL.shelfHeight - 0.045, centre], scale: [caseDepth, 0.07, width], board: true });
      if (!item.ghost) {
        // an unseen pane over the front of the case, so that pointing between the books still names the sector
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(item.to - item.from, layout.top), new THREE.MeshBasicMaterial({ visible: false }));
        pane.position.set(item.side * (HALL.aisle + HALL.bookDepth * 0.8), HALL.shelfBase + layout.top / 2 - 0.3, centre);
        pane.rotation.y = item.side > 0 ? -Math.PI / 2 : Math.PI / 2;
        pane.userData.sector = layout.bays.find((bay) => bay.side === item.side && bay.from === item.from)?.sector;
        this.bayPlanes.push(pane);
        this.scene.add(pane);
      }
    }
    const wood = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: "#ffffff" }), pieces.length);
    wood.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const panel = new THREE.Color(tone.wood);
    const board = new THREE.Color(tone.board);
    pieces.forEach((piece, index) => {
      matrix.compose(new THREE.Vector3(...piece.position), new THREE.Quaternion(), new THREE.Vector3(...piece.scale));
      wood.setMatrixAt(index, matrix);
      wood.setColorAt(index, piece.board ? board : panel);
    });
    this.scene.add(wood);

    // a row of lights under the roof gives the eye the depth of the hall
    const count = Math.ceil((layout.length + 120) / 6);
    const lights = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) lights.set([0, layout.top + 4.2, 6 - index * 6], index * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(lights, 3));
    const roof = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.5, map: this.glowTexture(), color: this.dark ? "#ffe9b8" : "#ffffff", transparent: true, opacity: this.dark ? 0.9 : 0.55, depthWrite: false, sizeAttenuation: true }));
    roof.frustumCulled = false;
    this.scene.add(roof);
  }

  private glowTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.75)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private label(text: string, className: string, at: THREE.Vector3, reach: number, target?: StageTarget): PlacedLabel {
    // which labels win when two would overlap: sectors, then books, desks, floor marks, the door
    const rank = className.startsWith("sector") ? 0 : className.startsWith("book") ? 1 : className.startsWith("desk") ? 2 : className.startsWith("mark") ? 3 : 4;
    const element = document.createElement(target ? "button" : "div");
    element.className = `desk-lib-label ${className}`;
    element.textContent = text;
    if (target) {
      (element as HTMLButtonElement).type = "button";
      element.addEventListener("click", () => this.events.onPick(target));
    }
    this.labelLayer.appendChild(element);
    return { element, at, reach, rank, shown: false };
  }

  private bayAnchor(sector: string): THREE.Vector3 | null {
    if (sector === FLOW_OUTSIDE) return new THREE.Vector3(0, 6.2, -(this.layout.length + 15.5));
    const bay = this.layout.bays.find((item) => item.sector === sector);
    return bay ? new THREE.Vector3(bay.side * (HALL.aisle - 0.2), this.layout.top + 0.35, -(bay.from + bay.to) / 2) : null;
  }

  private buildFixedLabels(): void {
    for (const bay of this.layout.bays) {
      const placed = this.label(bay.sector, "sector", new THREE.Vector3(bay.side * HALL.aisle, this.layout.top + 0.85, -(bay.from + bay.to) / 2), 90, { kind: "sector", name: bay.sector });
      this.sectorLabels.set(bay.sector, placed.element);
      this.fixedLabels.push(placed);
    }
    for (const mark of this.layout.marks) this.fixedLabels.push(this.label(mark.label, "mark", new THREE.Vector3(0, 0.05, mark.z), 34));
    this.fixedLabels.push(this.label("Outside the covered stocks", "door", new THREE.Vector3(0, 11.4, -(this.layout.length + 16)), 400, { kind: "outside" }));
  }

  // --- data ---------------------------------------------------------------------------------------------------------
  setData(data: StageData): void {
    this.data = data;
    const { layout, tone } = this;
    const values: number[] = [];
    const reading = (book: BookLayout): number | null => {
      const entry = data.company.get(book.cik);
      if (!entry) return null;
      if (data.mode === "flow") return entry.held > 0 ? entry.net / entry.held : null;
      return entry.since === null ? null : (1 + entry.since) / data.deflator - 1;
    };
    for (const book of layout.books) {
      const value = reading(book);
      if (value !== null) values.push(Math.abs(value));
    }
    values.sort((a, b) => a - b);
    const limit = Math.max(data.mode === "flow" ? 0.004 : 0.08, values[Math.floor(values.length * 0.9)] ?? 0);
    const most = Math.max(1, ...layout.books.map((book) => Math.abs(data.company.get(book.cik)?.net ?? 0)));
    const color = new THREE.Color();
    layout.books.forEach((book, index) => {
      const entry = data.company.get(book.cik);
      const value = reading(book);
      const dimmed = data.focus !== null && book.sector !== data.focus;
      const shade = value === null ? tone.book : mixOklab(tone.book, value >= 0 ? this.palette.pos : this.palette.neg, Math.min(1, Math.abs(value) / limit));
      color.set(dimmed ? mixOklab(shade, tone.sky, 0.62) : shade);
      color.toArray(this.tintTarget, index * 3);
      const net = entry?.net ?? 0;
      const strength = Math.sqrt(Math.abs(net) / most);
      this.pullTarget[index] = dimmed ? 0 : net > 0 ? 0.55 * strength : -0.26 * strength;
    });
    this.settling = true;

    // desk lamps: blue for a net buyer, red for a net seller, dark for a fund without a counted report this quarter
    const lampColors = this.lamps.geometry.getAttribute("color") as THREE.BufferAttribute;
    const off = new THREE.Color(mixOklab(tone.lampOff, tone.sky, 0.55));
    const quiet = new THREE.Color(tone.lampOff);
    layout.desks.forEach((desk, index) => {
      const entry = data.fund.get(desk.cik);
      if (!entry) return lampColors.setXYZ(index, off.r, off.g, off.b);
      const net = entry.bought - entry.sold;
      const gross = entry.bought + entry.sold;
      if (gross <= 0) return lampColors.setXYZ(index, quiet.r, quiet.g, quiet.b);
      color.set(mixOklab(tone.lampOff, net >= 0 ? this.palette.pos : this.palette.neg, 0.35 + 0.65 * Math.min(1, Math.abs(net) / gross / 0.5)));
      lampColors.setXYZ(index, color.r, color.g, color.b);
    });
    lampColors.needsUpdate = true;

    // streams of the estimated rotation: the largest links, red where the money left, blue where it arrived
    const links = data.links.filter((link) => link.from !== link.to).slice(0, 30);
    const top = Math.max(1, ...links.map((link) => link.usd));
    this.flowStreams = [];
    for (const link of links) {
      const from = this.bayAnchor(link.from);
      const to = this.bayAnchor(link.to);
      if (!from || !to) continue;
      const span = from.distanceTo(to);
      const sameSide = Math.sign(from.x) === Math.sign(to.x) && from.x !== 0 && to.x !== 0;
      const control = new THREE.Vector3(sameSide ? from.x * 0.25 : (from.x + to.x) / 2, Math.max(from.y, to.y) + 3.2 + span * 0.16, (from.z + to.z) / 2);
      this.flowStreams.push({ from, control, to, start: this.negative, end: this.positive, particles: clamp(Math.round((link.usd / top) * 90), 5, 90), lit: data.focus === null || link.from === data.focus || link.to === data.focus });
    }
    this.rebuildStreams();
    this.refreshLabels();
  }

  setSelection(selection: StageSelection): void {
    const changed = selection.kind !== this.selection.kind || selection.id !== this.selection.id;
    this.selection = selection;
    this.threadStreams = [];
    const top = Math.max(1, ...selection.threads.map((thread) => Math.abs(thread.usd)));
    const bookFace = (cik: number): THREE.Vector3 | null => {
      const book = this.layout.books[this.bookIndex.get(cik) ?? -1];
      return book ? new THREE.Vector3(book.side * (HALL.aisle - 0.35), book.y, book.z) : null;
    };
    const lamp = (cik: number): THREE.Vector3 | null => {
      const desk = this.layout.desks[this.deskIndex.get(cik) ?? -1];
      return desk ? new THREE.Vector3(desk.x, 1.05, desk.z) : null;
    };
    for (const thread of selection.threads) {
      const fund = selection.kind === "fund" ? lamp(selection.id!) : lamp(thread.id);
      const book = selection.kind === "fund" ? bookFace(thread.id) : bookFace(selection.id!);
      if (!fund || !book) continue;
      // money bought travels from the desk into the book; money sold comes back out of it
      const bought = thread.usd > 0;
      const from = bought ? fund : book;
      const to = bought ? book : fund;
      const control = new THREE.Vector3((fund.x + book.x) / 2, Math.max(fund.y, book.y) + 2.4 + fund.distanceTo(book) * 0.12, (fund.z + book.z) / 2);
      const tone = bought ? this.positive : this.negative;
      this.threadStreams.push({ from, control, to, start: tone, end: tone, particles: clamp(Math.round((Math.abs(thread.usd) / top) * 14), 2, 14), lit: true });
    }
    this.rebuildStreams();
    this.settling = true;
    // the view is set when something is selected, and once more when its trades arrive
    const framed = `${selection.kind}|${selection.id}|${selection.threads.length > 0}`;
    if (changed || (selection.kind === "fund" && framed !== this.framedFor)) this.flyToSelection();
    this.framedFor = framed;
    this.placeHalo();
    this.refreshLabels();
  }

  /** A soft light on what is selected. */
  private placeHalo(): void {
    const { kind, id } = this.selection;
    const book = kind === "company" ? this.layout.books[this.bookIndex.get(id ?? -1) ?? -1] : undefined;
    const desk = kind === "fund" ? this.layout.desks[this.deskIndex.get(id ?? -1) ?? -1] : undefined;
    this.halo.visible = Boolean(book ?? desk);
    if (book) this.halo.position.set(book.side * (HALL.aisle - 0.75), book.y, book.z);
    else if (desk) this.halo.position.set(desk.x, 1.1, desk.z);
    this.halo.scale.setScalar(book ? Math.max(2.4, book.thickness * 2.2) : 2.6);
  }

  private rebuildStreams(): void {
    // with a fund or a company selected its threads are the story: the rotation overhead fades
    const quiet = this.threadStreams.length > 0;
    this.streams = [...this.flowStreams.map((stream) => ({ ...stream, lit: stream.lit && !quiet })), ...this.threadStreams];
    for (const child of [...this.streamLines.children]) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.streamLines.remove(line);
    }
    this.sparkOf = [];
    const point = new THREE.Vector3();
    const color = new THREE.Color();
    this.streams.forEach((stream, index) => {
      const steps = 36;
      const positions = new Float32Array((steps + 1) * 3);
      const colors = new Float32Array((steps + 1) * 3);
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        this.along(stream, t, point).toArray(positions, step * 3);
        color.copy(stream.start).lerp(stream.end, THREE.MathUtils.smoothstep(t, 0.2, 0.8)).toArray(colors, step * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const thread = index >= this.flowStreams.length;
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: stream.lit ? (thread ? 0.9 : 0.3 + 0.5 * (stream.particles / 90)) : 0.05, depthWrite: false }));
      line.frustumCulled = false;
      this.streamLines.add(line);
      if (!stream.lit) return;
      for (let particle = 0; particle < stream.particles && this.sparkOf.length < this.sparkCapacity; particle++) {
        this.sparkOf.push({ stream: index, phase: (particle + ((index * 0.37) % 1)) / stream.particles, speed: (thread ? 0.22 : 0.085) * (0.85 + ((particle * 7 + index * 3) % 10) / 33) });
      }
    });
    this.sparks.geometry.setDrawRange(0, this.sparkOf.length);
    this.placeSparks(0);
  }

  private along(stream: Stream, t: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return out.set(a * stream.from.x + b * stream.control.x + c * stream.to.x, a * stream.from.y + b * stream.control.y + c * stream.to.y, a * stream.from.z + b * stream.control.z + c * stream.to.z);
  }

  private placeSparks(seconds: number): void {
    const positions = this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = this.sparks.geometry.getAttribute("color") as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    const color = new THREE.Color();
    for (let index = 0; index < this.sparkOf.length; index++) {
      const spark = this.sparkOf[index];
      const stream = this.streams[spark.stream];
      const t = (spark.phase + (this.calm ? 0 : seconds * spark.speed)) % 1;
      this.along(stream, t, point);
      positions.setXYZ(index, point.x, point.y, point.z);
      color.copy(stream.start).lerp(stream.end, THREE.MathUtils.smoothstep(t, 0.2, 0.8));
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  private placeBooks(force: boolean): void {
    if (!this.settling && !force) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const color = new THREE.Color();
    const selected = this.selection.kind === "company" ? this.bookIndex.get(this.selection.id ?? -1) : undefined;
    const hovered = this.hovered?.kind === "company" ? this.bookIndex.get(this.hovered.id) : undefined;
    const threaded = this.selection.kind === "fund" ? new Set(this.selection.threads.map((thread) => this.bookIndex.get(thread.id))) : null;
    const ink = new THREE.Color(this.tone.ink);
    let moving = false;
    for (let index = 0; index < this.layout.books.length; index++) {
      const book = this.layout.books[index];
      const target = this.pullTarget[index] + (index === selected ? 0.42 : threaded?.has(index) ? 0.2 : 0);
      const step = force ? 1 : 0.14;
      this.pull[index] += (target - this.pull[index]) * step;
      for (let channel = 0; channel < 3; channel++) this.tint[index * 3 + channel] += (this.tintTarget[index * 3 + channel] - this.tint[index * 3 + channel]) * step;
      if (Math.abs(target - this.pull[index]) > 0.002 || Math.abs(this.tintTarget[index * 3] - this.tint[index * 3]) > 0.004) moving = true;
      position.set(book.x - book.side * this.pull[index], book.y, book.z);
      scale.set(HALL.bookDepth, book.height, book.thickness);
      matrix.compose(position, rotation, scale);
      this.books.setMatrixAt(index, matrix);
      color.fromArray(this.tint, index * 3);
      if (index === hovered || index === selected) color.lerp(ink, 0.3);
      this.books.setColorAt(index, color);
    }
    this.books.instanceMatrix.needsUpdate = true;
    if (this.books.instanceColor) this.books.instanceColor.needsUpdate = true;
    this.settling = moving;
  }

  private refreshLabels(): void {
    for (const label of this.labels) label.element.remove();
    this.labels = [];
    const data = this.data;
    if (!data) return;
    const money = (value: number) => `${value < 0 ? "−" : "+"}$${Math.abs(value) >= 1e9 ? `${(Math.abs(value) / 1e9).toFixed(Math.abs(value) >= 1e10 ? 0 : 1)}bn` : `${(Math.abs(value) / 1e6).toFixed(0)}m`}`;
    for (const [sector, element] of this.sectorLabels) {
      const entry = data.sectors.get(sector);
      element.textContent = `${sector}${entry ? `  ${money(entry.net)}` : ""}`;
      element.classList.toggle("in", (entry?.net ?? 0) > 0);
      element.classList.toggle("out", (entry?.net ?? 0) < 0);
      element.classList.toggle("dim", data.focus !== null && sector !== data.focus);
      element.classList.toggle("on", data.focus !== null && sector === data.focus);
    }
    // the books that moved most carry their ticker; a selection names what it is tied to
    const named = new Set<number>();
    const movers = [...this.layout.books].filter((book) => data.focus === null || book.sector === data.focus).sort((a, b) => Math.abs(data.company.get(b.cik)?.net ?? 0) - Math.abs(data.company.get(a.cik)?.net ?? 0)).slice(0, data.focus === null ? 16 : 200);
    if (this.selection.kind !== "fund" || this.selection.threads.length === 0) for (const book of movers) named.add(book.cik);
    if (this.selection.kind === "company" && this.selection.id !== null) named.add(this.selection.id);
    if (this.selection.kind === "fund") for (const thread of this.selection.threads.slice(0, 24)) named.add(thread.id);
    for (const cik of named) {
      const book = this.layout.books[this.bookIndex.get(cik) ?? -1];
      const net = data.company.get(cik)?.net ?? 0;
      if (!book) continue;
      this.labels.push(this.label(book.ticker, `book ${net > 0 ? "in" : net < 0 ? "out" : ""}`, new THREE.Vector3(book.side * (HALL.aisle - 0.62), book.y, book.z), 44));
    }
    const desks = new Set<number>();
    if (this.selection.kind === null) for (const [cik] of [...data.fund].sort((a, b) => Math.abs(b[1].bought - b[1].sold) - Math.abs(a[1].bought - a[1].sold)).slice(0, 8)) desks.add(cik);
    if (this.selection.kind === "fund" && this.selection.id !== null) desks.add(this.selection.id);
    if (this.selection.kind === "company") for (const thread of this.selection.threads.slice(0, 16)) desks.add(thread.id);
    for (const cik of desks) {
      const desk = this.layout.desks[this.deskIndex.get(cik) ?? -1];
      const fund = this.funds.find((item) => item.cik === cik);
      if (!desk || !fund) continue;
      const entry = data.fund.get(cik);
      const net = entry ? entry.bought - entry.sold : 0;
      this.labels.push(this.label(fund.name.length > 26 ? `${fund.name.slice(0, 25)}…` : fund.name, `desk ${net > 0 ? "in" : net < 0 ? "out" : ""}`, new THREE.Vector3(desk.x, 1.55, desk.z), 40));
    }
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
    const from = { ...this.pose };
    // the short way round
    const turn = ((to.yaw - from.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.flight = { from, to: { ...to, yaw: from.yaw + turn }, started: performance.now(), duration: this.calm ? 1 : 1100 };
  }

  /** Stand in the aisle facing a sector's bookcase, far enough back to see all of it. */
  flyToSector(sector: string | null): void {
    if (sector === null) return this.flyHome();
    const bay = this.layout.bays.find((item) => item.sector === sector);
    if (!bay) return;
    const centre = -(bay.from + bay.to) / 2;
    const halfWidth = (bay.to - bay.from) / 2 + 0.8;
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const height = Math.max(1, this.host.clientHeight);
    const openShare = Math.max(0.5, (height - this.insetBottom - 70) / height);
    const distance = clamp(Math.max(halfWidth / (Math.tan(half) * openShare * this.openAspect()), (this.layout.top / 2 + 0.5) / (Math.tan(half) * openShare)), 7.5, HALL.aisle * 2 - 1.2);
    const middle = HALL.shelfBase + (this.layout.top - HALL.shelfBase) / 2;
    this.fly(this.aim(new THREE.Vector3(bay.side * (HALL.aisle - distance), middle + 0.2, centre), new THREE.Vector3(bay.side * HALL.aisle, middle, centre)));
  }

  flyHome(): void {
    this.fly({ ...HOME });
  }

  private flyToSelection(): void {
    const { kind, id } = this.selection;
    if (kind === "company" && id !== null) {
      const book = this.layout.books[this.bookIndex.get(id) ?? -1];
      if (book) this.fly(this.aim(new THREE.Vector3(-book.side * 1.6, Math.max(3.6, book.y + 1.3), book.z + 7.5), new THREE.Vector3(book.side * HALL.aisle, book.y - 0.4, book.z - 1.5)));
    } else if (kind === "fund" && id !== null) {
      const desk = this.layout.desks[this.deskIndex.get(id) ?? -1];
      if (!desk) return;
      let weight = 0;
      const centre = new THREE.Vector3();
      for (const thread of this.selection.threads) {
        const book = this.layout.books[this.bookIndex.get(thread.id) ?? -1];
        if (!book) continue;
        centre.add(new THREE.Vector3(0, book.y, book.z).multiplyScalar(Math.abs(thread.usd)));
        weight += Math.abs(thread.usd);
      }
      if (weight <= 0) return this.fly(this.aim(new THREE.Vector3(desk.x * 0.25, 9.2, desk.z + 12.5), new THREE.Vector3(desk.x * 0.6, 2.2, desk.z - 4)));
      centre.divideScalar(weight);
      // on the side of the desk away from the books, so desk and threads lie in front
      const away = Math.sign(desk.z - centre.z) || -1;
      const from = new THREE.Vector3(desk.x * 0.3, 8.8, clamp(desk.z + away * 10.5, -(this.layout.length + 8), 13));
      this.fly(this.aim(from, new THREE.Vector3(0, 1.4, desk.z + (centre.z - desk.z) * 0.25)));
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
      this.pose.yaw += dx * 0.0042;
      this.pose.pitch = clamp(this.pose.pitch + dy * 0.0032, -0.85, 0.5);
      this.lastTouch = performance.now();
    } else this.pointerDirty = true;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = { x: event.clientX, y: event.clientY, moved: 0 };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.dragging;
    this.dragging = null;
    this.renderer.domElement.releasePointerCapture?.(event.pointerId);
    this.renderer.domElement.style.cursor = "grab";
    if (drag && drag.moved < 5) {
      this.pick();
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
    // walk the way the camera faces, kept between the bookcases
    const stride = clamp(event.deltaY, -240, 240) * 0.034;
    this.pose.z = clamp(this.pose.z - Math.cos(this.pose.yaw) * stride, -(this.layout.length + 10), 14);
    this.pose.x = clamp(this.pose.x - Math.sin(this.pose.yaw) * stride, -(HALL.aisle - 1.2), HALL.aisle - 1.2);
    this.lastTouch = performance.now();
    this.pointerDirty = true;
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 6 : 2.4;
    if (event.key === "ArrowUp" || event.key === "w") this.pose.z = clamp(this.pose.z - step, -(this.layout.length + 10), 14);
    else if (event.key === "ArrowDown" || event.key === "s") this.pose.z = clamp(this.pose.z + step, -(this.layout.length + 10), 14);
    else if (event.key === "ArrowLeft" || event.key === "a") this.pose.yaw += 0.16;
    else if (event.key === "ArrowRight" || event.key === "d") this.pose.yaw -= 0.16;
    else if (event.key === "Home") return this.flyHome();
    else return;
    event.preventDefault();
    this.flight = null;
    this.lastTouch = performance.now();
  };

  private listen(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("keydown", this.onKey);
  }

  private pick(): void {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([this.books, this.desks, this.door, ...this.bayPlanes], false);
    let next: StageTarget | null = null;
    const hit = hits[0];
    if (hit) {
      if (hit.object === this.books && hit.instanceId !== undefined) next = { kind: "company", id: this.layout.books[hit.instanceId].cik };
      else if (hit.object === this.desks && hit.instanceId !== undefined) next = { kind: "fund", id: (this.layout.desks[hit.instanceId] as DeskLayout).cik };
      else if (hit.object === this.door) next = { kind: "outside" };
      else if (typeof hit.object.userData.sector === "string") next = { kind: "sector", name: hit.object.userData.sector };
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

  /** Width over height of the part of the picture no panel covers. */
  private openAspect(): number {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    return Math.max(0.4, (width - (this.inset < width * 0.6 ? this.inset : 0)) / Math.max(1, height - this.insetBottom - 70));
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const right = this.inset < width * 0.6 ? this.inset : 0;
    // the picture moves left by half the panel and up by a part of the strip below it
    this.camera.setViewOffset(width, height, right / 2, Math.min(this.insetBottom, height * 0.3) * 0.3, width, height);
    this.camera.updateProjectionMatrix();
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (document.hidden) return;
    this.clock = now / 1000;
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
    this.applyPose();
    // at rest the view breathes a little, so the hall never looks like a still picture
    if (!this.calm && !this.flight && !this.dragging && now - this.lastTouch > 2500) this.camera.position.x += Math.sin(this.clock * 0.32) * 0.1;
    if (this.pointerDirty && !this.dragging) {
      this.pointerDirty = false;
      this.pick();
    }
    this.placeBooks(false);
    if (this.halo.visible && !this.calm) (this.halo.material as THREE.SpriteMaterial).opacity = (this.dark ? 0.6 : 0.4) + 0.2 * Math.sin(this.clock * 2.4);
    if (!this.calm) this.placeSparks(this.clock);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  };

  private placeLabels(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const projected = new THREE.Vector3();
    // by rank; within a rank a label already on screen keeps its place, so nothing flickers as the view breathes
    const ordered = [...this.fixedLabels, ...this.labels].sort((a, b) => a.rank - b.rank || Number(b.shown) - Number(a.shown));
    const taken: [number, number, number, number][] = [];
    for (const label of ordered) {
      projected.copy(label.at);
      const distance = projected.distanceTo(this.camera.position);
      projected.project(this.camera);
      let visible = projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05 && distance < label.reach;
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;
      if (visible) {
        const half = ((label.element.textContent?.length ?? 6) * (label.rank === 0 ? 7.4 : 6.6) + 22) / 2;
        const box: [number, number, number, number] = label.rank === 1 ? [x - half, y - 12, x + half, y + 12] : [x - half, y - 24, x + half, y + 2];
        if (taken.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) visible = false;
        else taken.push(box);
      }
      label.shown = visible;
      if (!visible) {
        if (label.element.style.display !== "none") label.element.style.display = "none";
        continue;
      }
      label.element.style.display = "";
      label.element.style.transform = `translate(-50%, ${label.rank === 1 ? "-50%" : "-100%"}) translate(${x}px, ${y}px)`;
      label.element.style.opacity = String(clamp(1.25 - distance / label.reach, 0.3, 1));
    }
  }

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
    canvas.removeEventListener("keydown", this.onKey);
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      for (const item of Array.isArray(material) ? material : material ? [material] : []) {
        (item as THREE.PointsMaterial).map?.dispose?.();
        item.dispose();
      }
    });
    this.renderer.dispose();
    canvas.remove();
    this.labelLayer.remove();
  }
}
