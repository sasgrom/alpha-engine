/**
 * Main Street through the doorway: where the money from outside the covered stocks comes from and goes to (other
 * shares, bonds, cash; for many funds their clients' money, much of it ordinary savers'). A street in depth beyond the
 * doorway: steps down to a small square, then shopfronts and offices of several heights on both sides, lamps, trees,
 * parked cars and a few cars driving, the road running away into the haze under the sky. An afternoon in the light
 * theme, night in the dark one. The fronts are painted on two canvases and drawn without the hall's lights; the whole
 * street takes about fifteen draw calls. Over the doorway inside hangs a plaque with what came in from outside this
 * quarter and what went out.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface OutsideFlow { arrived: number; left: number; quarter: string }

/** The doorway the street is seen through: the hall's wall radius, the opening's size, and where the plaque hangs over it. */
export interface Doorway { wallRadius: number; width: number; height: number; depth: number; plaqueAbove: number }

const money = (value: number) => (Math.abs(value) >= 1e12 ? `$${(value / 1e12).toFixed(2)}T` : Math.abs(value) >= 1e9 ? `$${(value / 1e9).toFixed(1)}bn` : `$${(value / 1e6).toFixed(0)}m`);

/** A small deterministic sequence, so the street looks the same every time. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return state / 4294967296;
  };
}

/** The street's plan in metres: +z runs away from the doorway, x is across; the street lies below the hall's floor. */
const PLAN = { landing: 29.6, plaza: 30.3, road: 35, end: 262, roadHalf: 6, front: 11.5, depth: 14, plazaLevel: -0.6, roadLevel: -0.75 } as const;
/** The painted fronts: this stretch of the street, up to this height, on a canvas of 4096 by 1024 for each side. */
const FRONTS = { from: PLAN.plaza, length: 160, tall: 40, width: 4096, height: 1024 } as const;
const PX = FRONTS.width / FRONTS.length;

type Style = "brick" | "stone" | "painted" | "office";
interface Building { z0: number; z1: number; height: number; style: Style; base: string; trim: string; band: string; sign: string; awning: string | null }

const SHOPS = ["BAKERY", "BOOKS", "PHARMACY", "CAFE", "HARDWARE", "GROCER", "DINER", "TAILOR", "FLORIST", "BARBER", "NEWS", "DELI", "SHOES", "MARKET", "THEATER", "OPTICIAN", "JEWELER", "LAUNDRY", "MUSIC", "TOYS", "HOTEL", "POST OFFICE"];
const OFFICES = ["SAVINGS BANK", "INSURANCE", "TRUST COMPANY", "OFFICES", "BROKERS", "LAW OFFICES"];
const WALLS: Record<Style, string[]> = {
  brick: ["#8e4a3a", "#9a5440", "#7d4033", "#a0603f", "#874c3c", "#6f3b30"],
  stone: ["#cbbfa6", "#bfb39b", "#d6cbb4", "#b8ad98", "#c4b89e"],
  painted: ["#d9c9a3", "#9fb3a0", "#a8b8c8", "#d8b49a", "#c9c2b0", "#b9a6b4"],
  office: ["#8fa0ae", "#7d8f9e", "#9aa7b0", "#a59c8e"],
};
const TRIMS: Record<Style, string> = { brick: "#e9e1d0", stone: "#efe8d8", painted: "#f4efe4", office: "#d4dbe0" };
const BANDS = ["#1f3d2b", "#1c2a44", "#4a1f24", "#222222", "#3b2a1a", "#2c3e3a"];
const AWNINGS = ["#7a1f24", "#1f4a33", "#1f3354", "#8a5a1f", "#4a2a52", "#5a5a5a"];

function shade(hex: string, k: number): string {
  const colour = new THREE.Color(hex);
  return `#${colour.multiplyScalar(k).getHexString()}`;
}

/** Both rows of buildings, from the square to the end of the street. */
function plan(next: () => number): Building[][] {
  return [-1, 1].map((side) => {
    const row: Building[] = [];
    let z = FRONTS.from;
    let shop = side < 0 ? 0 : 11;
    while (z < PLAN.end) {
      const first = row.length === 0;
      const style: Style = first ? "stone" : next() < 0.16 ? "office" : (["brick", "brick", "stone", "painted"] as const)[Math.floor(next() * 4)];
      const width = first ? 14 : style === "office" ? 16 + next() * 8 : 9 + next() * 10;
      const floors = first ? 5 : style === "office" ? 7 + Math.floor(next() * 4) : 2 + Math.floor(next() * 5);
      const walls = WALLS[style];
      const office = style === "office" || first;
      row.push({
        z0: z,
        z1: z + width,
        height: 4.2 + floors * 3.3 + 0.6,
        style,
        base: walls[Math.floor(next() * walls.length)],
        trim: TRIMS[style],
        band: BANDS[Math.floor(next() * BANDS.length)],
        sign: office ? OFFICES[Math.floor(next() * OFFICES.length)] : SHOPS[shop++ % SHOPS.length],
        awning: !office && next() < 0.55 ? AWNINGS[Math.floor(next() * AWNINGS.length)] : null,
      });
      z += width;
    }
    return row;
  });
}

// --- the painted fronts ---------------------------------------------------------------------------------------------

function paintFronts(row: Building[], side: number, dark: boolean, haze: string, next: () => number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = FRONTS.width;
  canvas.height = FRONTS.height;
  const context = canvas.getContext("2d")!;
  // the haze's colour above the roofs, so the smaller copies of the texture do not darken the roof lines
  context.fillStyle = haze;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const building of row) {
    if (building.z0 >= FRONTS.from + FRONTS.length) continue;
    // as seen from the street the canvas runs left to right: towards -z on the left side, towards +z on the right
    const left = side < 0 ? (FRONTS.from + FRONTS.length - Math.min(building.z1, FRONTS.from + FRONTS.length)) * PX : (building.z0 - FRONTS.from) * PX;
    const width = (Math.min(building.z1, FRONTS.from + FRONTS.length) - building.z0) * PX;
    paintFront(context, building, left, width, dark, next);
  }
  return canvas;
}

function paintFront(context: CanvasRenderingContext2D, building: Building, x: number, width: number, dark: boolean, next: () => number): void {
  const bottom = FRONTS.height;
  const at = (metres: number) => bottom - metres * PX;
  const span = (metres: number) => metres * PX;
  const metresWide = width / PX;
  const wall = dark ? shade(building.base, 0.34) : building.base;
  const trim = dark ? shade(building.trim, 0.4) : building.trim;
  // the wall, a little lighter towards the top where the light falls
  context.fillStyle = wall;
  context.fillRect(x, at(building.height), width, span(building.height));
  const light = context.createLinearGradient(0, at(building.height), 0, bottom);
  light.addColorStop(0, dark ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.08)");
  light.addColorStop(1, "rgba(0,0,0,0.14)");
  context.fillStyle = light;
  context.fillRect(x, at(building.height), width, span(building.height));
  if (building.style === "brick") {
    context.fillStyle = "rgba(0,0,0,0.07)";
    for (let y = 4.2; y < building.height; y += 0.3) context.fillRect(x, at(y), width, 1);
  }
  // the upper floors
  const floors = Math.round((building.height - 4.8) / 3.3);
  if (building.style === "office") {
    const panels = Math.max(2, Math.round(metresWide / 1.6));
    const panel = width / panels;
    for (let floor = 0; floor < floors; floor++) {
      const y0 = 4.2 + floor * 3.3;
      // a band of wall at each floor, then the glass
      for (let column = 0; column < panels; column++) {
        const lit = next();
        const glass = dark
          ? (lit < 0.38 ? (next() < 0.7 ? "#f6e3b4" : "#d8e3ff") : "#141b28")
          : (["#9fb2c3", "#8ca1b4", "#b4c4d2", "#7f93a7"] as const)[Math.floor(next() * 4)];
        context.fillStyle = glass;
        context.fillRect(x + column * panel + 1.5, at(y0 + 3.3) + 2, panel - 3, span(2.5));
      }
      context.fillStyle = trim;
      context.fillRect(x, at(y0 + 0.8), width, 2);
    }
  } else {
    const bays = Math.max(1, Math.floor((metresWide - 1.2) / 2.6));
    const step = width / bays;
    for (let floor = 0; floor < floors; floor++) {
      const y0 = 4.2 + floor * 3.3 + 0.75;
      for (let bay = 0; bay < bays; bay++) {
        const cx = x + step * (bay + 0.5);
        const w = span(1.25);
        const h = span(1.9);
        // frame, glass, a cross of glazing bars, the sill
        context.fillStyle = trim;
        context.fillRect(cx - w / 2 - 3, at(y0 + 1.9) - 3, w + 6, h + 6);
        let glass: string;
        if (dark) {
          const lit = next();
          glass = lit < 0.46 ? (["#ffd38a", "#ffe3ad", "#f7c46b", "#fff1d6"] as const)[Math.floor(next() * 4)] : lit < 0.52 ? "#d6e2ff" : (next() < 0.5 ? "#121826" : "#1a2130");
        } else glass = next() < 0.12 ? "#3d4652" : "#8fa2b6";
        context.fillStyle = glass;
        context.fillRect(cx - w / 2, at(y0 + 1.9), w, h);
        if (!dark) {
          // the sky in the upper panes, a blind drawn now and then
          const sky = context.createLinearGradient(0, at(y0 + 1.9), 0, at(y0));
          sky.addColorStop(0, "rgba(220,232,242,0.75)");
          sky.addColorStop(1, "rgba(220,232,242,0)");
          context.fillStyle = sky;
          context.fillRect(cx - w / 2, at(y0 + 1.9), w, h);
          if (next() < 0.25) {
            context.fillStyle = "#e8dcc4";
            context.fillRect(cx - w / 2, at(y0 + 1.9), w, h * (0.3 + next() * 0.4));
          }
        }
        context.fillStyle = dark ? shade(building.trim, 0.3) : "rgba(60,60,60,0.55)";
        context.fillRect(cx - 1, at(y0 + 1.9), 2, h);
        context.fillRect(cx - w / 2, at(y0 + 1.15), w, 2);
        context.fillStyle = trim;
        context.fillRect(cx - w / 2 - 6, at(y0) - 1, w + 12, 5);
      }
    }
    // a string course over the shopfronts
    context.fillStyle = trim;
    context.fillRect(x, at(4.3), width, span(0.18));
  }
  // the ground floor: pilasters, the sign band with the shop's name, the shop windows and a door
  context.fillStyle = dark ? shade(building.base, 0.24) : shade(building.base, 0.82);
  context.fillRect(x, at(4.2), span(0.4), span(4.2));
  context.fillRect(x + width - span(0.4), at(4.2), span(0.4), span(4.2));
  const band = dark ? shade(building.band, 0.8) : building.band;
  context.fillStyle = band;
  context.fillRect(x + span(0.4), at(3.95), width - span(0.8), span(0.72));
  context.fillStyle = dark ? "#ffe6b0" : "#e8d39a";
  context.font = `600 ${Math.round(span(0.42))}px Georgia, "Times New Roman", serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(building.sign, x + width / 2, at(3.59), width - span(1.2));
  const shopLeft = x + span(0.55);
  const shopWidth = width - span(1.1);
  const glassTop = at(3.1);
  const glassHeight = span(2.65);
  if (dark) {
    const glow = context.createLinearGradient(0, glassTop, 0, glassTop + glassHeight);
    glow.addColorStop(0, "#ffe0a0");
    glow.addColorStop(1, "#f0a85a");
    context.fillStyle = glow;
  } else {
    const glass = context.createLinearGradient(0, glassTop, 0, glassTop + glassHeight);
    glass.addColorStop(0, "#7c8a98");
    glass.addColorStop(0.55, "#4c5864");
    glass.addColorStop(1, "#6d5a44");
    context.fillStyle = glass;
  }
  context.fillRect(shopLeft, glassTop, shopWidth, glassHeight);
  // glazing bars, and the door
  context.fillStyle = dark ? "#2a2018" : "#2e2a26";
  const panes = Math.max(2, Math.round(shopWidth / span(2.2)));
  for (let pane = 1; pane < panes; pane++) context.fillRect(shopLeft + (shopWidth * pane) / panes - 2, glassTop, 4, glassHeight);
  const doorX = shopLeft + shopWidth * (0.3 + next() * 0.4) - span(0.6);
  context.fillStyle = dark ? "#3a2a1a" : "#3a2f26";
  context.fillRect(doorX, at(2.6), span(1.2), span(2.6));
  context.fillStyle = dark ? "#ffd894" : "#5d6872";
  context.fillRect(doorX + span(0.15), at(2.45), span(0.9), span(1.4));
  // the cornice band at the top (the stage adds the cornice itself in depth)
  if (building.style !== "office") {
    context.fillStyle = trim;
    context.fillRect(x, at(building.height), width, span(0.6));
    context.fillStyle = "rgba(0,0,0,0.25)";
    context.fillRect(x, at(building.height - 0.6), width, span(0.12));
    // small dentils under the cornice
    context.fillStyle = trim;
    for (let dx = span(0.3); dx < width - span(0.3); dx += span(0.5)) context.fillRect(x + dx, at(building.height - 0.72), span(0.22), span(0.18));
  } else {
    context.fillStyle = trim;
    context.fillRect(x, at(building.height), width, span(0.4));
  }
}

// --- geometry ---------------------------------------------------------------------------------------------------------

/** Positions, texture coordinates and colours of triangles, with each quad wound to face the given way. */
class Builder {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly colours: number[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  quad(points: [number, number, number][], facing: [number, number, number], colour: THREE.Color | null, uv: [number, number][] | null = null): void {
    const [p0, p1, p2] = points;
    this.a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    this.b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    const normal = this.a.cross(this.b);
    const order = normal.x * facing[0] + normal.y * facing[1] + normal.z * facing[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const index of order) {
      this.positions.push(...points[index]);
      if (uv) this.uvs.push(...uv[index]);
      if (colour) this.colours.push(colour.r, colour.g, colour.b);
    }
  }

  /** A box between two corners: every face shaded a little differently, as if lit from above and the side. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: THREE.Color, skip: { bottom?: boolean } = {}): void {
    const tint = (k: number) => colour.clone().multiplyScalar(k);
    this.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], tint(1.06));
    if (!skip.bottom) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], tint(0.55));
    this.quad([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], tint(0.82));
    this.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], tint(0.82));
    this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], tint(0.72));
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], tint(0.9));
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    if (this.uvs.length) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.colours.length) geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** A texture drawn by `draw` on a square canvas, repeated over the ground. */
function groundTexture(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void, repeat: [number, number]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 8;
  return texture;
}

function speckle(context: CanvasRenderingContext2D, size: number, base: string, spread: number, next: () => number): void {
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  for (let index = 0; index < size * size * 0.06; index++) {
    const value = (next() - 0.5) * spread;
    context.fillStyle = value > 0 ? `rgba(255,255,255,${value})` : `rgba(0,0,0,${-value})`;
    context.fillRect(Math.floor(next() * size), Math.floor(next() * size), 2, 2);
  }
}

// --- the street -------------------------------------------------------------------------------------------------------

const MOVING = 4;

export class MainStreet {
  readonly group = new THREE.Group();
  /** The plaque over the doorway inside the hall, for pointing (userData.outside). */
  readonly plaque: THREE.Mesh;
  private readonly plaqueCanvas: HTMLCanvasElement;
  private readonly plaqueTexture: THREE.CanvasTexture;
  private readonly cars: THREE.InstancedMesh[] = [];
  private readonly textures: THREE.Texture[] = [];

  constructor(dark: boolean, doorway: Doorway) {
    const next = random(1792);
    const rows = plan(next);
    const sky = dark ? "#0b0c10" : "#efe9dc";

    // the painted fronts, one mesh a side; in the dark the lit windows are drawn bright enough to glow
    rows.forEach((row, index) => {
      const side = index === 0 ? -1 : 1;
      const texture = new THREE.CanvasTexture(paintFronts(row, side, dark, sky, next));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      this.textures.push(texture);
      const fronts = new Builder();
      const x = side * PLAN.front;
      for (const building of row) {
        const z1 = Math.min(building.z1, FRONTS.from + FRONTS.length);
        if (building.z0 >= z1) continue;
        const u = (z: number) => (side < 0 ? (FRONTS.from + FRONTS.length - z) / FRONTS.length : (z - FRONTS.from) / FRONTS.length);
        const v = building.height / FRONTS.tall;
        const y0 = PLAN.plazaLevel;
        fronts.quad([[x, y0, building.z0], [x, y0, z1], [x, y0 + building.height, z1], [x, y0 + building.height, building.z0]], [-side, 0, 0], null, [[u(building.z0), 0], [u(z1), 0], [u(z1), v], [u(building.z0), v]]);
      }
      const material = new THREE.MeshBasicMaterial({ map: texture, color: dark ? new THREE.Color(1.3, 1.3, 1.3) : 0xffffff });
      this.group.add(new THREE.Mesh(fronts.geometry(), material));
    });

    // the buildings in depth: gables, roofs, cornices, awnings, the plain blocks beyond the painted stretch
    const solid = new Builder();
    const darken = (hex: string) => new THREE.Color(dark ? shade(hex, 0.34) : hex);
    rows.forEach((row, index) => {
      const side = index === 0 ? -1 : 1;
      const front = side * PLAN.front;
      const back = side * (PLAN.front + PLAN.depth);
      const [xa, xb] = side < 0 ? [back, front] : [front, back];
      for (const building of row) {
        const top = PLAN.plazaLevel + building.height;
        const wall = darken(building.base);
        const painted = building.z0 < FRONTS.from + FRONTS.length;
        if (painted) {
          // the gable ends and the roof (the front is the painted quad)
          solid.quad([[xa, PLAN.plazaLevel, building.z0], [xb, PLAN.plazaLevel, building.z0], [xb, top, building.z0], [xa, top, building.z0]], [0, 0, -1], wall.clone().multiplyScalar(0.72));
          solid.quad([[xa, PLAN.plazaLevel, building.z1], [xb, PLAN.plazaLevel, building.z1], [xb, top, building.z1], [xa, top, building.z1]], [0, 0, 1], wall.clone().multiplyScalar(0.84));
          solid.quad([[xa, top, building.z0], [xb, top, building.z0], [xb, top, building.z1], [xa, top, building.z1]], [0, 1, 0], new THREE.Color(dark ? 0x15161a : 0x4a4644));
          const trim = darken(building.trim);
          if (building.style === "office") solid.box(Math.min(front, front - side * 0.12), Math.max(front, front - side * 0.12), top - 0.05, top + 0.5, building.z0, building.z1, trim);
          else {
            // a cornice standing out over the street, and a parapet over it
            const out = front - side * 0.55;
            solid.box(Math.min(front, out), Math.max(front, out), top - 0.55, top - 0.05, building.z0, building.z1, trim);
            solid.box(Math.min(front, front + side * 0.3), Math.max(front, front + side * 0.3), top - 0.05, top + 0.55, building.z0, building.z1, wall);
          }
          if (building.awning) {
            // a sloping awning over the shop windows, with a short valance
            const colour = darken(building.awning);
            const wallX = front - side * 0.02;
            const outX = front - side * 1.5;
            const a0 = building.z0 + 0.8;
            const a1 = building.z1 - 0.8;
            const y = PLAN.plazaLevel;
            solid.quad([[wallX, y + 3.85, a0], [wallX, y + 3.85, a1], [outX, y + 3.2, a1], [outX, y + 3.2, a0]], [-side * 0.5, 1, 0], colour);
            solid.quad([[wallX, y + 3.85, a0], [wallX, y + 3.85, a1], [outX, y + 3.2, a1], [outX, y + 3.2, a0]], [side * 0.5, -1, 0], colour.clone().multiplyScalar(0.55));
            solid.quad([[outX, y + 2.95, a0], [outX, y + 2.95, a1], [outX, y + 3.2, a1], [outX, y + 3.2, a0]], [-side, 0, 0], colour.clone().multiplyScalar(0.85));
          }
        } else {
          // beyond the painted stretch the fog takes the detail: plain blocks in the wall's colour
          solid.box(Math.min(xa, xb), Math.max(xa, xb), PLAN.plazaLevel, top, building.z0, building.z1, wall.clone().multiplyScalar(0.8), { bottom: true });
        }
      }
    });

    // the crosswalk at the head of the road, and the lamps' and street sign's iron in one piece with the rest
    const paint = new THREE.Color(dark ? 0x8a8a86 : 0xe9e6dc);
    for (let stripe = -5; stripe <= 5; stripe += 1) {
      const x = stripe * 1.05;
      solid.quad([[x - 0.3, PLAN.roadLevel + 0.006, PLAN.road + 1.2], [x + 0.3, PLAN.roadLevel + 0.006, PLAN.road + 1.2], [x + 0.3, PLAN.roadLevel + 0.006, PLAN.road + 4.2], [x - 0.3, PLAN.roadLevel + 0.006, PLAN.road + 4.2]], [0, 1, 0], paint);
    }
    // the kerbs: the step from the road up to the pavements and the square
    const kerb = new THREE.Color(dark ? 0x3a3a3c : 0xa9a49a);
    for (const side of [-1, 1]) solid.quad([[side * PLAN.roadHalf, PLAN.roadLevel, PLAN.road], [side * PLAN.roadHalf, PLAN.plazaLevel, PLAN.road], [side * PLAN.roadHalf, PLAN.plazaLevel, PLAN.end], [side * PLAN.roadHalf, PLAN.roadLevel, PLAN.end]], [-side, 0, 0], kerb);
    solid.quad([[-PLAN.roadHalf, PLAN.roadLevel, PLAN.road], [PLAN.roadHalf, PLAN.roadLevel, PLAN.road], [PLAN.roadHalf, PLAN.plazaLevel, PLAN.road], [-PLAN.roadHalf, PLAN.plazaLevel, PLAN.road]], [0, 0, 1], kerb);
    // the street sign at the corner of the square, facing the hall
    const iron = new THREE.Color(dark ? 0x101112 : 0x26282b);
    solid.box(PLAN.roadHalf + 1.25, PLAN.roadHalf + 1.35, PLAN.plazaLevel, PLAN.plazaLevel + 3.4, PLAN.road - 1.05, PLAN.road - 0.95, iron);
    this.group.add(new THREE.Mesh(solid.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true })));
    const sign = groundTexture(256, (context, size) => {
      context.fillStyle = "#1f5b3a";
      context.fillRect(0, 0, size, size);
      context.strokeStyle = "#f4f1e6";
      context.lineWidth = 8;
      context.strokeRect(10, 70, size - 20, size - 140);
      context.fillStyle = "#f4f1e6";
      context.font = "700 64px Arial, Helvetica, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("MAIN ST", size / 2, size / 2 + 4);
    }, [1, 1]);
    sign.wrapS = sign.wrapT = THREE.ClampToEdgeWrapping;
    this.textures.push(sign);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.52), new THREE.MeshBasicMaterial({ map: sign, color: dark ? 0x7a7a7a : 0xffffff }));
    (plate.geometry.getAttribute("uv") as THREE.BufferAttribute).set([0, 0.78, 1, 0.78, 0, 0.22, 1, 0.22]);
    plate.position.set(PLAN.roadHalf + 1.3, PLAN.plazaLevel + 3.15, PLAN.road - 1.1);
    plate.rotation.y = Math.PI;
    this.group.add(plate);

    // the ground: the landing and steps down from the hall, the square, the pavements, the road
    const stone = groundTexture(256, (context, size) => {
      speckle(context, size, dark ? "#3c3a37" : "#c9c2b4", 0.12, next);
      context.fillStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(90,80,70,0.35)";
      for (let line = 0; line < size; line += size / 2) {
        context.fillRect(0, line, size, 2);
        context.fillRect(line, 0, 2, size);
      }
    }, [1, 1]);
    const walk = groundTexture(256, (context, size) => {
      speckle(context, size, dark ? "#34332f" : "#b8b2a6", 0.1, next);
      context.fillStyle = dark ? "rgba(0,0,0,0.3)" : "rgba(70,65,60,0.28)";
      for (let line = 0; line < size; line += size / 2) context.fillRect(0, line, size, 2);
      context.fillRect(0, 0, 2, size);
    }, [1, 1]);
    const asphalt = groundTexture(512, (context, size) => {
      speckle(context, size, dark ? "#1b1b1d" : "#45464a", 0.16, next);
      // the centre line in yellow dashes, the parking lanes in white
      context.fillStyle = dark ? "#6b5a26" : "#d9b544";
      context.fillRect(size / 2 - 5, 0, 10, size / 2);
      context.fillStyle = dark ? "#5a5a58" : "#d8d6cf";
      for (const lane of [-1, 1]) context.fillRect(size / 2 + lane * size * 0.3 - 3, 0, 6, size);
    }, [1, 1]);
    this.textures.push(stone, walk, asphalt);
    const ground = (x0: number, x1: number, z0: number, z1: number, y: number, tile: number) => {
      const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
      for (let index = 0; index < uv.count; index++) uv.setXY(index, (uv.getX(index) * (x1 - x0)) / tile, (uv.getY(index) * (z1 - z0)) / tile);
      return geometry;
    };
    const lambert = (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map, color: dark ? 0x9a9a9a : 0xffffff });
    // stone blocks with the paving at its own scale (a box's faces each span the texture once)
    const block = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
      const box = new THREE.BoxGeometry(width, height, depth);
      const uv = box.getAttribute("uv") as THREE.BufferAttribute;
      for (let index = 0; index < uv.count; index++) uv.setXY(index, (uv.getX(index) * width) / 2.4, (uv.getY(index) * Math.max(height, depth)) / 2.4);
      return box.translate(x, y, z);
    };
    const landing = block(18, -PLAN.plazaLevel, PLAN.landing - 26.6, 0, PLAN.plazaLevel / 2 - 0.004, (26.6 + PLAN.landing) / 2);
    const steps = [1, 2].map((step) => {
      const top = -0.2 * step - 0.004;
      return block(18, top - PLAN.plazaLevel, 0.35, 0, (top + PLAN.plazaLevel) / 2, PLAN.landing + 0.35 * (step - 0.5));
    });
    const squared = mergeGeometries([landing, ...steps, ground(-PLAN.front - 6, PLAN.front + 6, PLAN.plaza, PLAN.road, PLAN.plazaLevel, 2.4)], false)!;
    this.group.add(new THREE.Mesh(squared, lambert(stone)));
    const pavements = mergeGeometries([ground(-PLAN.front, -PLAN.roadHalf, PLAN.road, PLAN.end, PLAN.plazaLevel, 1.6), ground(PLAN.roadHalf, PLAN.front, PLAN.road, PLAN.end, PLAN.plazaLevel, 1.6)], false)!;
    this.group.add(new THREE.Mesh(pavements, lambert(walk)));
    const road = ground(-PLAN.roadHalf, PLAN.roadHalf, PLAN.road, PLAN.end, PLAN.roadLevel, 2 * PLAN.roadHalf);
    this.group.add(new THREE.Mesh(road, lambert(asphalt)));

    // lamps along both kerbs, trees between them
    const lampAt: [number, number][] = [];
    const treeAt: [number, number][] = [];
    for (let z = PLAN.road + 3; z < PLAN.end - 10; z += 20) {
      for (const side of [-1, 1]) {
        lampAt.push([side * (PLAN.roadHalf + 0.7), z]);
        treeAt.push([side * (PLAN.roadHalf + 1.7), z + 10]);
      }
    }
    const matrix = new THREE.Matrix4();
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 4.6, 8), new THREE.MeshLambertMaterial({ color: dark ? 0x141516 : 0x2a2c2f }), lampAt.length);
    const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshBasicMaterial({ color: dark ? new THREE.Color(2.4, 1.85, 1.1) : new THREE.Color(0.88, 0.86, 0.8) }), lampAt.length);
    lampAt.forEach(([x, z], index) => {
      posts.setMatrixAt(index, matrix.makeTranslation(x, PLAN.plazaLevel + 2.3, z));
      lanterns.setMatrixAt(index, matrix.makeTranslation(x, PLAN.plazaLevel + 4.75, z));
    });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.17, 2.6, 7), new THREE.MeshLambertMaterial({ color: dark ? 0x1c140e : 0x5a4330 }), treeAt.length);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.55, 1), new THREE.MeshLambertMaterial({ color: dark ? 0x1d3022 : 0x5a7d44, flatShading: true }), treeAt.length);
    treeAt.forEach(([x, z], index) => {
      trunks.setMatrixAt(index, matrix.makeTranslation(x, PLAN.plazaLevel + 1.3, z));
      const size = 0.85 + ((index * 0.618) % 1) * 0.4;
      crowns.setMatrixAt(index, matrix.compose(new THREE.Vector3(x, PLAN.plazaLevel + 3.4, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index, 0)), new THREE.Vector3(size, size * 1.1, size)));
    });
    this.group.add(posts, lanterns, trunks, crowns);

    // cars parked along both kerbs, and a few driving (the first instances)
    const parked: [number, number][] = [];
    for (const side of [-1, 1]) {
      let z = PLAN.road + 9 + next() * 6;
      while (z < PLAN.end - 20) {
        if (next() < 0.7) parked.push([side * (PLAN.roadHalf - 1.25), z]);
        z += 5.6 + next() * 4;
      }
    }
    const count = MOVING + parked.length;
    const carColours = dark ? ["#2a2f38", "#3a2226", "#2b3329", "#3a3a3a", "#1f2a3a", "#3d3424"] : ["#9b2d2d", "#2d4f7c", "#d8d3c8", "#3f6b45", "#2b2b2b", "#c08a2a", "#7f8a93", "#5b3a6b"];
    const chassis = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.4, 3.9), new THREE.MeshLambertMaterial({ color: 0x111111 }), count);
    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1.82, 0.72, 4.4), new THREE.MeshLambertMaterial({ color: 0xffffff }), count);
    // the cabin narrows to the roof: a four-sided frustum turned square to the car
    const cabin = new THREE.CylinderGeometry(0.72, 1, 0.62, 4, 1).rotateY(Math.PI / 4).scale(1.6 / Math.SQRT2, 1, 2.3 / Math.SQRT2);
    const cabins = new THREE.InstancedMesh(cabin, new THREE.MeshLambertMaterial({ color: dark ? 0x1a1f26 : 0x2f3a46, flatShading: true }), count);
    const wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x151515 }), count * 4);
    for (let index = 0; index < count; index++) bodies.setColorAt(index, new THREE.Color(carColours[Math.floor(next() * carColours.length)]));
    this.cars.push(chassis, bodies, cabins, wheels);
    parked.forEach(([x, z], index) => this.placeCar(MOVING + index, x, z, 0));
    for (let index = 0; index < MOVING; index++) this.placeCar(index, index % 2 ? -1.8 : 1.8, PLAN.road + 20 + index * 40, index % 2 ? Math.PI : 0);
    this.group.add(chassis, bodies, cabins, wheels);
    if (dark) {
      // head and tail lights of the cars on the move
      const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }), MOVING * 2);
      for (let index = 0; index < MOVING * 2; index++) lights.setColorAt(index, index % 2 ? new THREE.Color(2.2, 0.25, 0.2) : new THREE.Color(2.4, 2.2, 1.7));
      this.cars.push(lights);
      this.group.add(lights);
    }
    for (const mesh of [posts, lanterns, trunks, crowns, ...this.cars]) mesh.frustumCulled = false;

    // the sky: a dome over the street, from the haze at the horizon (the hall's fog colour) to the zenith
    const dome = new THREE.SphereGeometry(300, 32, 16);
    const horizon = new THREE.Color(sky);
    const zenith = new THREE.Color(dark ? "#0e1528" : "#86aed6");
    const position = dome.getAttribute("position") as THREE.BufferAttribute;
    const colours = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index++) {
      const height = Math.max(0, position.getY(index) / 300);
      horizon.clone().lerp(zenith, Math.min(1, height * 2.2) ** 0.7).toArray(colours, index * 3);
    }
    dome.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const skyMesh = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.position.set(0, 0, doorway.wallRadius);
    skyMesh.renderOrder = -1;
    this.group.add(skyMesh);

    // the plaque over the doorway, inside the hall
    this.plaqueCanvas = document.createElement("canvas");
    this.plaqueCanvas.width = 1024;
    this.plaqueCanvas.height = 400;
    this.plaqueTexture = new THREE.CanvasTexture(this.plaqueCanvas);
    this.plaqueTexture.colorSpace = THREE.SRGBColorSpace;
    this.plaqueTexture.anisotropy = 4;
    const plaqueWidth = 4.4;
    const plaqueHeight = 1.72;
    const z = doorway.wallRadius - 0.15;
    const y = doorway.height + doorway.plaqueAbove;
    this.plaque = new THREE.Mesh(new THREE.PlaneGeometry(plaqueWidth, plaqueHeight), new THREE.MeshBasicMaterial({ map: this.plaqueTexture }));
    this.plaque.position.set(0, y, z);
    this.plaque.rotation.y = Math.PI;
    this.plaque.userData.outside = true;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(plaqueWidth + 0.16, plaqueHeight + 0.16, 0.06), new THREE.MeshStandardMaterial({ color: 0x3b2717, roughness: 0.5, metalness: 0.1 }));
    backing.position.set(0, y, z + 0.04);
    this.group.add(this.plaque, backing);
    this.paint(null);
  }

  private placeCar(index: number, x: number, z: number, heading: number): void {
    const [chassis, bodies, cabins, wheels, lights] = this.cars;
    const matrix = new THREE.Matrix4();
    const turn = new THREE.Matrix4().makeRotationY(heading);
    const at = (dx: number, dy: number, dz: number) => matrix.makeTranslation(dx, dy, dz).premultiply(turn).premultiply(new THREE.Matrix4().makeTranslation(x, PLAN.roadLevel, z));
    chassis.setMatrixAt(index, at(0, 0.32, 0));
    bodies.setMatrixAt(index, at(0, 0.82, 0));
    cabins.setMatrixAt(index, at(0, 1.49, -0.25));
    [[-0.82, 1.38], [0.82, 1.38], [-0.82, -1.38], [0.82, -1.38]].forEach(([dx, dz], wheel) => wheels.setMatrixAt(index * 4 + wheel, at(dx, 0.34, dz)));
    chassis.instanceMatrix.needsUpdate = bodies.instanceMatrix.needsUpdate = cabins.instanceMatrix.needsUpdate = wheels.instanceMatrix.needsUpdate = true;
    if (lights && index < MOVING) {
      lights.setMatrixAt(index * 2, at(0, 0.9, 2.21));
      lights.setMatrixAt(index * 2 + 1, at(0, 0.9, -2.21));
      lights.instanceMatrix.needsUpdate = true;
    }
  }

  /** The cars on the move drive up and down the street at a walking town's pace. */
  update(seconds: number): void {
    if (!this.cars.length) return;
    const length = PLAN.end - PLAN.road - 30;
    for (let index = 0; index < MOVING; index++) {
      const away = index % 2 === 0;
      const travelled = (seconds * (7 + index) + index * 37) % length;
      this.placeCar(index, away ? 1.8 : -1.8, away ? PLAN.road + 15 + travelled : PLAN.end - 15 - travelled, away ? 0 : Math.PI);
    }
  }

  /** Repaints the plaque with the quarter's money from and to outside the covered stocks (null: none). */
  paint(flow: OutsideFlow | null): void {
    const context = this.plaqueCanvas.getContext("2d")!;
    const { width, height } = this.plaqueCanvas;
    const ground = context.createLinearGradient(0, 0, 0, height);
    ground.addColorStop(0, "#1d1a17");
    ground.addColorStop(1, "#11100e");
    context.fillStyle = ground;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#b8924a";
    context.lineWidth = 6;
    context.strokeRect(9, 9, width - 18, height - 18);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#e8d6a8";
    context.font = '700 54px Cinzel, "Times New Roman", serif';
    context.fillText("MAIN STREET", width / 2, 64);
    context.font = "500 24px Arial, Helvetica, sans-serif";
    context.fillStyle = "rgba(240, 236, 226, 0.75)";
    context.fillText(flow ? `and everything outside these stocks · ${flow.quarter}` : "and everything outside these stocks", width / 2, 112);
    if (flow) {
      const most = Math.max(1, flow.arrived, flow.left);
      const bar = (label: string, value: number, top: number, colour: string) => {
        context.textAlign = "left";
        context.fillStyle = "rgba(240, 236, 226, 0.9)";
        context.font = "600 26px Arial, Helvetica, sans-serif";
        context.fillText(label, 48, top);
        context.fillStyle = "rgba(255,255,255,0.1)";
        context.fillRect(48, top + 26, width - 96, 26);
        context.fillStyle = colour;
        context.fillRect(48, top + 26, (width - 96) * (value / most), 26);
        context.textAlign = "right";
        context.fillStyle = "#ffffff";
        context.font = "700 30px Arial, Helvetica, sans-serif";
        context.fillText(money(value), width - 48, top);
      };
      bar("came in from outside", flow.arrived, 172, "#5b8def");
      bar("went out", flow.left, 272, "#e5675f");
    }
    this.plaqueTexture.needsUpdate = true;
  }

  dispose(): void {
    this.plaqueTexture.dispose();
    for (const texture of this.textures) texture.dispose();
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials) material.dispose();
    });
  }
}
