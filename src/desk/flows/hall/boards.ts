/**
 * Boards in the hall. Over the gallery railing above every bookcase hangs a scoreboard of its sector: what came in and
 * what went out, and on a plaque above it the net in large figures, counting up to the new quarter's numbers. On the
 * walls between the columns hang the top-ten boards: the most bought, the most sold, the largest buyers and sellers,
 * the winners and losers, the most traded, the largest holdings, chosen to fit the view. A top-ten board can be
 * pointed at row by row.
 */
import * as THREE from "three";
import { polar, ROTUNDA, type HallLayout } from "./layout";
import type { ListRow, TopList } from "./lists";

const money = (value: number) => {
  const size = Math.abs(value);
  const text = size >= 1e12 ? `$${(size / 1e12).toFixed(2)}T` : size >= 1e9 ? `$${(size / 1e9).toFixed(size >= 1e11 ? 0 : 1)}bn` : `$${(size / 1e6).toFixed(0)}m`;
  return value < 0 ? `−${text}` : text;
};

const signed = (value: number) => (value > 0 ? `+${money(value)}` : value < 0 ? money(value) : "$0");

/** A sector's figures for its scoreboard: in the flow view the dollars in and out, in the holdings view what is held. */
export interface SectorScore { sector: string; inflow: number; outflow: number; net: number; held: number; companies: number }

export type ScoreMode = "flow" | "outcome" | "held";

interface Face { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh }
interface Scoreboard { sector: string; board: Face; plaque: Face; from: SectorScore; to: SectorScore }

const EMPTY = (sector: string): SectorScore => ({ sector, inflow: 0, outflow: 0, net: 0, held: 0, companies: 0 });

/** A scoreboard and the plaque with the net over it, in metres; the board's centre hangs this high over the gallery floor. */
export const SCOREBOARD = { width: 5.6, height: 1.64, frame: 0.08, gap: 0.08, plaqueWidth: 2.7, plaqueHeight: 0.66, over: 0.82 } as const;
/** Height over the gallery floor of the top of the plaque's frame, where the sector's emblem stands. */
export const SCOREBOARD_CROWN = SCOREBOARD.over + SCOREBOARD.height / 2 + SCOREBOARD.frame + SCOREBOARD.gap + SCOREBOARD.plaqueHeight + SCOREBOARD.frame;

function face(width: number, height: number, pixels: [number, number], sector: string): Face {
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = pixels;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  mesh.userData.sector = sector;
  return { canvas, texture, mesh };
}

/** Dark lacquer with a gilt rule: the ground of every board. */
function lacquer(context: CanvasRenderingContext2D, width: number, height: number, rule: number): void {
  const ground = context.createLinearGradient(0, 0, 0, height);
  ground.addColorStop(0, "#1d1a17");
  ground.addColorStop(1, "#11100e");
  context.fillStyle = ground;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#b8924a";
  context.lineWidth = rule;
  context.strokeRect(rule * 1.5, rule * 1.5, width - rule * 3, height - rule * 3);
}

/** How a figure moves to its new value: quick at first, settling at the end. */
const settle = (t: number) => 1 - (1 - t) ** 3;

export class Scoreboards {
  readonly group = new THREE.Group();
  private readonly boards: Scoreboard[] = [];
  private readonly palette: { pos: string; neg: string };
  private mode: ScoreMode = "flow";
  private most = { flow: 1, held: 1 };
  private started = -1;
  private now = 0;
  private readonly duration: number;

  constructor(layout: HallLayout, palette: { pos: string; neg: string }, calm: boolean) {
    this.palette = palette;
    this.duration = calm ? 0.001 : 1.4;
    const frame = new THREE.MeshStandardMaterial({ color: 0x3b2717, roughness: 0.5, metalness: 0.1 });
    const { width, height, plaqueWidth, plaqueHeight } = SCOREBOARD;
    const plaqueAt = height / 2 + SCOREBOARD.frame + SCOREBOARD.gap + plaqueHeight / 2;
    for (const alcove of layout.alcoves) {
      // hung over the gallery railing, facing the middle of the hall, the plaque with the net standing on it
      const group = new THREE.Group();
      group.position.set(...polar(alcove.mid, ROTUNDA.radius - 1.98, ROTUNDA.galleryHeight + SCOREBOARD.over));
      group.rotation.y = -alcove.mid;
      const board = face(width, height, [1024, 300], alcove.sector);
      const back = new THREE.Mesh(new THREE.BoxGeometry(width + 2 * SCOREBOARD.frame, height + 2 * SCOREBOARD.frame, 0.06), frame);
      back.position.z = -0.04;
      const plaque = face(plaqueWidth, plaqueHeight, [832, 204], alcove.sector);
      plaque.mesh.position.y = plaqueAt;
      const plaqueBack = new THREE.Mesh(new THREE.BoxGeometry(plaqueWidth + 2 * SCOREBOARD.frame, plaqueHeight + 2 * SCOREBOARD.frame, 0.06), frame);
      plaqueBack.position.set(0, plaqueAt, -0.04);
      // a short stem joins the plaque to the board
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.5, SCOREBOARD.gap + 0.02, 0.05), frame);
      stem.position.set(0, height / 2 + SCOREBOARD.frame + SCOREBOARD.gap / 2, -0.04);
      group.add(back, board.mesh, plaqueBack, plaque.mesh, stem);
      this.group.add(group);
      this.boards.push({ sector: alcove.sector, board, plaque, from: EMPTY(alcove.sector), to: EMPTY(alcove.sector) });
    }
  }

  /** The boards' and plaques' faces, for pointing (userData.sector). */
  get faces(): THREE.Mesh[] {
    return this.boards.flatMap((board) => [board.board.mesh, board.plaque.mesh]);
  }

  /** New figures: every board moves from what it shows now to these. */
  set(scores: Map<string, SectorScore>, mode: ScoreMode): void {
    const t = this.started < 0 ? 1 : Math.min(1, (this.now - this.started) / this.duration);
    for (const board of this.boards) {
      // start from where the figures are on the board at this moment
      board.from = mix(board.from, board.to, settle(t));
      board.to = scores.get(board.sector) ?? EMPTY(board.sector);
    }
    this.mode = mode;
    const all = [...scores.values()];
    this.most = { flow: Math.max(1, ...all.map((score) => Math.max(score.inflow, score.outflow))), held: Math.max(1, ...all.map((score) => score.held)) };
    this.started = this.now;
    this.paintAll(0);
  }

  update(seconds: number): void {
    this.now = seconds;
    if (this.started < 0) return;
    const t = Math.min(1, (this.now - this.started) / this.duration);
    this.paintAll(settle(t));
    if (t >= 1) this.started = -1;
  }

  private paintAll(t: number): void {
    for (const board of this.boards) this.paint(board, mix(board.from, board.to, t));
  }

  private paint(board: Scoreboard, score: SectorScore): void {
    // the board: the sector, then what came in and what went out, each with its bar and figure
    const context = board.board.canvas.getContext("2d")!;
    const { width, height } = board.board.canvas;
    lacquer(context, width, height, 6);
    context.textBaseline = "middle";
    context.fillStyle = "#d9c08a";
    context.font = '600 30px Cinzel, "Times New Roman", serif';
    context.textAlign = "left";
    context.fillText(board.sector.toUpperCase(), 36, 52);
    const barRow = (label: string, value: number, most: number, y: number, colour: string) => {
      context.textAlign = "left";
      context.font = "600 22px Arial, Helvetica, sans-serif";
      context.fillStyle = "rgba(240,236,226,0.8)";
      context.fillText(label, 36, y);
      const from = label ? 112 : 36;
      const length = width - 260 - from;
      context.fillStyle = "rgba(255,255,255,0.08)";
      context.fillRect(from, y - 16, length, 32);
      context.fillStyle = colour;
      context.fillRect(from, y - 16, length * Math.min(1, value / most), 32);
      context.fillStyle = "#ffffff";
      context.textAlign = "right";
      context.font = "700 32px Arial, Helvetica, sans-serif";
      context.fillText(money(value), width - 40, y);
    };
    if (this.mode === "held") {
      context.fillStyle = "rgba(240,236,226,0.75)";
      context.font = "500 22px Arial, Helvetica, sans-serif";
      context.fillText(`${score.companies} companies · held by the tracked funds`, 36, 108);
      barRow("", score.held, this.most.held, 164, "#c9a14f");
    } else {
      barRow("IN", score.inflow, this.most.flow, 126, this.palette.pos);
      barRow("OUT", score.outflow, this.most.flow, 190, this.palette.neg);
    }
    context.textAlign = "left";
    context.font = "500 18px Arial, Helvetica, sans-serif";
    context.fillStyle = "rgba(240,236,226,0.45)";
    context.fillText(this.mode === "held" ? "value held at the quarter end" : "dollars bought and sold this quarter", 36, height - 38);
    board.board.texture.needsUpdate = true;

    // the plaque above it: the net (or what is held), large, with an arrow for the direction
    const plaque = board.plaque.canvas.getContext("2d")!;
    const { width: pw, height: ph } = board.plaque.canvas;
    lacquer(plaque, pw, ph, 5);
    plaque.textBaseline = "middle";
    const held = this.mode === "held";
    const figure = held ? money(score.held) : signed(score.net);
    const colour = held ? "#f6e7c1" : score.net > 0 ? this.palette.pos : score.net < 0 ? this.palette.neg : "#d9c08a";
    plaque.font = '700 112px Cinzel, "Times New Roman", serif';
    const figureWidth = plaque.measureText(figure).width;
    plaque.font = "600 24px Arial, Helvetica, sans-serif";
    const caption = held ? "HELD" : "NET";
    const captionWidth = plaque.measureText(caption).width;
    const arrow = !held && score.net !== 0 ? 64 : 0;
    // caption, arrow and figure as one line, centred, shrunk to fit if a figure is very long
    const total = captionWidth + 26 + arrow + figureWidth;
    const fit = Math.min(1, (pw - 70) / total);
    plaque.save();
    plaque.translate(pw / 2, ph / 2 + 4);
    plaque.scale(fit, fit);
    let x = -total / 2;
    plaque.textAlign = "left";
    plaque.fillStyle = "rgba(240,236,226,0.7)";
    plaque.fillText(caption, x, 0);
    x += captionWidth + 26;
    plaque.fillStyle = colour;
    if (arrow) {
      const up = score.net > 0;
      plaque.beginPath();
      plaque.moveTo(x + 24, up ? -30 : 30);
      plaque.lineTo(x + 48, up ? 26 : -26);
      plaque.lineTo(x, up ? 26 : -26);
      plaque.closePath();
      plaque.fill();
      x += arrow;
    }
    plaque.font = '700 112px Cinzel, "Times New Roman", serif';
    plaque.fillText(figure, x, 0);
    plaque.restore();
    board.plaque.texture.needsUpdate = true;
  }

  dispose(): void {
    for (const board of this.boards) {
      for (const part of [board.board, board.plaque]) {
        part.texture.dispose();
        (part.mesh.material as THREE.Material).dispose();
      }
    }
    this.group.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
  }
}

function mix(a: SectorScore, b: SectorScore, t: number): SectorScore {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return { sector: b.sector, inflow: lerp(a.inflow, b.inflow), outflow: lerp(a.outflow, b.outflow), net: lerp(a.net, b.net), held: lerp(a.held, b.held), companies: Math.round(lerp(a.companies, b.companies)) };
}

// --- the top-ten boards between the columns ------------------------------------------------------------------------------

export type { ListRow, TopList };

interface PierBoard { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh; list: TopList | null; mid: number; width: number; height: number; centre: THREE.Vector3 }

/** Where a board hangs: the middle of its face, the way it faces (towards the middle of the hall), its size. */
export interface BoardFrame { centre: THREE.Vector3; normal: THREE.Vector3; width: number; height: number }

const ROWS = 10;

export class TopBoards {
  readonly group = new THREE.Group();
  private readonly boards: PierBoard[] = [];
  private readonly palette: { pos: string; neg: string };

  constructor(layout: HallLayout, palette: { pos: string; neg: string }) {
    this.palette = palette;
    const frame = new THREE.MeshStandardMaterial({ color: 0x3b2717, roughness: 0.5, metalness: 0.1 });
    const gilt = new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 0.85, roughness: 0.35 });
    const wall = ROTUNDA.radius + ROTUNDA.bookDepth + 0.45;
    for (const pier of layout.piers) {
      const span = (pier.end - pier.start) * ROTUNDA.radius;
      // room between the two columns of the pier, which stand about half a metre into it
      const width = Math.min(3.1, span - 1.7);
      if (width < 2.2) continue;
      const height = width * 1.27;
      const mid = (pier.start + pier.end) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 762;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const board = new THREE.Group();
      board.position.set(...polar(mid, wall - 0.12, 1.25 + height / 2));
      board.rotation.y = -mid;
      const back = new THREE.Mesh(new THREE.BoxGeometry(width + 0.22, height + 0.22, 0.08), frame);
      back.position.z = -0.05;
      const rule = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.05, 0.1), gilt);
      rule.position.set(0, height / 2 + 0.14, -0.02);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
      board.add(back, rule, mesh);
      this.group.add(board);
      this.boards.push({ canvas, texture, mesh, list: null, mid, width, height, centre: board.position.clone() });
    }
    // the first lists go to the boards across from the entrance, where the reader looks first
    this.boards.sort((a, b) => Math.abs(a.mid) - Math.abs(b.mid));
    this.boards.forEach((board, index) => (board.mesh.userData.board = index));
  }

  get count(): number {
    return this.boards.length;
  }

  get faces(): THREE.Mesh[] {
    return this.boards.map((board) => board.mesh);
  }

  /** A board's place, for standing in front of it. */
  frameOf(index: number): BoardFrame | null {
    const board = this.boards[index];
    if (!board) return null;
    return { centre: board.centre.clone(), normal: new THREE.Vector3(-Math.sin(board.mid), 0, Math.cos(board.mid)), width: board.width, height: board.height };
  }

  /** The lists, board by board round the hall (fewer lists than boards: the rest stay blank). */
  set(lists: TopList[]): void {
    this.boards.forEach((board, index) => {
      board.list = lists[index] ?? null;
      this.paint(board);
    });
  }

  /** What a point on a board's face (its texture coordinates) points at: a row's company or fund. */
  rowAt(board: number, uv: THREE.Vector2): ListRow | null {
    const list = this.boards[board]?.list;
    if (!list) return null;
    const y = (1 - uv.y) * 762;
    const index = Math.floor((y - 150) / 58);
    return index >= 0 && index < list.rows.length ? list.rows[index] : null;
  }

  private paint(board: PierBoard): void {
    const context = board.canvas.getContext("2d")!;
    const { width, height } = board.canvas;
    const ground = context.createLinearGradient(0, 0, 0, height);
    ground.addColorStop(0, "#1f2a24");
    ground.addColorStop(1, "#141b17");
    context.fillStyle = ground;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#b8924a";
    context.lineWidth = 5;
    context.strokeRect(12, 12, width - 24, height - 24);
    const list = board.list;
    if (!list) {
      board.texture.needsUpdate = true;
      return;
    }
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.fillStyle = "#e8d6a8";
    context.font = '700 38px Cinzel, "Times New Roman", serif';
    context.fillText(list.title.toUpperCase(), width / 2, 62);
    context.font = "500 19px Arial, Helvetica, sans-serif";
    context.fillStyle = "rgba(240,236,226,0.6)";
    context.fillText(list.note, width / 2, 104);
    context.fillStyle = "rgba(184,146,74,0.7)";
    context.fillRect(40, 128, width - 80, 2);
    list.rows.slice(0, ROWS).forEach((row, index) => {
      const y = 150 + index * 58 + 29;
      context.textAlign = "left";
      context.fillStyle = "rgba(232,214,168,0.55)";
      context.font = "600 22px Arial, Helvetica, sans-serif";
      context.fillText(String(index + 1).padStart(2, " "), 40, y);
      context.fillStyle = "#f4f1e8";
      context.font = "600 25px Arial, Helvetica, sans-serif";
      let label = row.label;
      while (context.measureText(label).width > 330 && label.length > 4) label = `${label.slice(0, -2)}…`;
      context.fillText(label, 84, y);
      context.textAlign = "right";
      context.fillStyle = row.tone === "in" ? this.palette.pos : row.tone === "out" ? this.palette.neg : "#e8d6a8";
      context.font = "700 25px Arial, Helvetica, sans-serif";
      context.fillText(row.value, width - 40, y);
      if (index < ROWS - 1) {
        context.fillStyle = "rgba(255,255,255,0.06)";
        context.fillRect(40, y + 28, width - 80, 1);
      }
    });
    board.texture.needsUpdate = true;
  }

  dispose(): void {
    for (const board of this.boards) {
      board.texture.dispose();
      board.mesh.geometry.dispose();
      (board.mesh.material as THREE.Material).dispose();
    }
  }
}

export { money as boardMoney, signed as boardSigned };
