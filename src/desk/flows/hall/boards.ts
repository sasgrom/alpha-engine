/**
 * Boards in the hall. Over the gallery railing above every bookcase hangs a scoreboard of its sector: what came in,
 * what went out, and the net in large figures, counting up to the new quarter's numbers. On the walls between the
 * columns hang the top-ten boards: the most bought, the most sold, the largest buyers and sellers, the winners and
 * losers, the most traded, the largest holdings, chosen to fit the view. A row on a top-ten board can be pointed at.
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

interface Scoreboard { sector: string; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh; from: SectorScore; to: SectorScore }

const EMPTY = (sector: string): SectorScore => ({ sector, inflow: 0, outflow: 0, net: 0, held: 0, companies: 0 });

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
    const width = 5.6;
    const height = 1.64;
    for (const alcove of layout.alcoves) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 300;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      // hung over the gallery railing, facing the middle of the hall
      const board = new THREE.Group();
      board.position.set(...polar(alcove.mid, ROTUNDA.radius - 1.98, ROTUNDA.galleryHeight + 0.82));
      board.rotation.y = -alcove.mid;
      const back = new THREE.Mesh(new THREE.BoxGeometry(width + 0.16, height + 0.16, 0.06), frame);
      back.position.z = -0.04;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
      mesh.userData.sector = alcove.sector;
      board.add(back, mesh);
      this.group.add(board);
      this.boards.push({ sector: alcove.sector, canvas, texture, mesh, from: EMPTY(alcove.sector), to: EMPTY(alcove.sector) });
    }
  }

  /** The boards' faces, for pointing (userData.sector). */
  get faces(): THREE.Mesh[] {
    return this.boards.map((board) => board.mesh);
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
    const context = board.canvas.getContext("2d")!;
    const { width, height } = board.canvas;
    // dark lacquer with a gilt rule
    const ground = context.createLinearGradient(0, 0, 0, height);
    ground.addColorStop(0, "#1d1a17");
    ground.addColorStop(1, "#11100e");
    context.fillStyle = ground;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#b8924a";
    context.lineWidth = 6;
    context.strokeRect(9, 9, width - 18, height - 18);
    context.textBaseline = "middle";
    context.fillStyle = "#d9c08a";
    context.font = '600 26px Cinzel, "Times New Roman", serif';
    context.textAlign = "left";
    context.fillText(board.sector.toUpperCase(), 36, 44);
    if (this.mode === "held") {
      context.fillStyle = "rgba(240,236,226,0.75)";
      context.font = "500 24px Arial, Helvetica, sans-serif";
      context.fillText(`${score.companies} companies · held by the tracked funds`, 36, 92);
      const share = score.held / this.most.held;
      context.fillStyle = "rgba(255,255,255,0.1)";
      context.fillRect(36, 130, 560, 34);
      context.fillStyle = "#c9a14f";
      context.fillRect(36, 130, 560 * share, 34);
      context.textAlign = "right";
      context.fillStyle = "#f6e7c1";
      context.font = '700 92px Cinzel, "Times New Roman", serif';
      context.fillText(money(score.held), width - 40, 176);
      context.font = "600 22px Arial, Helvetica, sans-serif";
      context.fillStyle = "rgba(240,236,226,0.7)";
      context.fillText("HELD", width - 40, 100);
    } else {
      const bar = (label: string, value: number, y: number, colour: string) => {
        context.textAlign = "left";
        context.font = "600 22px Arial, Helvetica, sans-serif";
        context.fillStyle = "rgba(240,236,226,0.8)";
        context.fillText(label, 36, y);
        context.fillStyle = "rgba(255,255,255,0.08)";
        context.fillRect(110, y - 15, 380, 30);
        context.fillStyle = colour;
        context.fillRect(110, y - 15, 380 * Math.min(1, value / this.most.flow), 30);
        context.fillStyle = "#ffffff";
        context.textAlign = "right";
        context.fillText(money(value), 600, y);
      };
      bar("IN", score.inflow, 112, this.palette.pos);
      bar("OUT", score.outflow, 168, this.palette.neg);
      context.textAlign = "right";
      context.font = "600 22px Arial, Helvetica, sans-serif";
      context.fillStyle = "rgba(240,236,226,0.7)";
      context.fillText("NET", width - 40, 74);
      context.font = '700 96px Cinzel, "Times New Roman", serif';
      context.fillStyle = score.net > 0 ? this.palette.pos : score.net < 0 ? this.palette.neg : "#d9c08a";
      context.fillText(signed(score.net), width - 40, 168);
      // an arrow beside the tally
      context.beginPath();
      const ax = width - 40 - context.measureText(signed(score.net)).width - 46;
      if (score.net !== 0) {
        const up = score.net > 0;
        context.moveTo(ax, up ? 140 : 196);
        context.lineTo(ax + 22, up ? 196 : 140);
        context.lineTo(ax - 22, up ? 196 : 140);
        context.closePath();
        context.fill();
      }
    }
    context.textAlign = "left";
    context.font = "500 18px Arial, Helvetica, sans-serif";
    context.fillStyle = "rgba(240,236,226,0.45)";
    context.fillText(this.mode === "held" ? "value held at the quarter end" : "dollars bought and sold this quarter", 36, height - 40);
    board.texture.needsUpdate = true;
  }

  dispose(): void {
    for (const board of this.boards) {
      board.texture.dispose();
      board.mesh.geometry.dispose();
      (board.mesh.material as THREE.Material).dispose();
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

interface PierBoard { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh; list: TopList | null; mid: number }

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
      this.boards.push({ canvas, texture, mesh, list: null, mid });
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
