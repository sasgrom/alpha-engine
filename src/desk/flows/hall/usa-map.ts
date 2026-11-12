/**
 * The map table in the middle of the hall: the United States as the table top, every state a tile tinted by the
 * quarter's net flow into the companies headquartered there, brass inlay along the borders, and a flag on a pin where
 * the money was large (taller for more dollars; blue bought, red sold). Companies headquartered abroad share one flag
 * out in the Atlantic. Outlines: us-atlas `states-albers-10m` (Census Bureau 2017 cartographic boundaries, projected
 * to Albers USA in a 975×610 frame; ISC licence).
 */
import * as THREE from "three";

export interface UsaTopology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: {
    states: { geometries: { id: string; type: "Polygon" | "MultiPolygon"; arcs: number[][] | number[][][]; properties: { name: string } }[] };
    nation: { geometries: { type: "Polygon" | "MultiPolygon"; arcs: number[][] | number[][][] }[] };
  };
}

/** Two-letter postal codes of the states by their FIPS code, the ids of the topology. */
export const FIPS_STATES: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY",
};

type Point = [number, number];

export interface StateShape {
  code: string;
  name: string;
  /** Polygons, each a list of rings (the first the outline, the others holes), in the map's 975×610 frame. */
  polygons: Point[][][];
  /** Where its flag stands: the centre of its largest polygon. */
  anchor: Point;
}

/** Decodes the quantized, delta-coded arcs of a topology into absolute points of the map's frame. */
export function decodeArcs(topology: Pick<UsaTopology, "transform" | "arcs">): Point[][] {
  const { scale, translate } = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as Point;
    });
  });
}

/** A ring from its arcs in order; a negative index is the arc ~index walked backwards. Joints are not repeated. */
export function ringOf(arcs: Point[][], indexes: number[]): Point[] {
  const points: Point[] = [];
  for (const index of indexes) {
    const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
    arc.forEach((point, at) => {
      if (at > 0 || points.length === 0) points.push(point);
    });
  }
  return points;
}

function polygonsOf(arcs: Point[][], geometry: { type: "Polygon" | "MultiPolygon"; arcs: number[][] | number[][][] }): Point[][][] {
  const list = geometry.type === "Polygon" ? [geometry.arcs as number[][]] : (geometry.arcs as number[][][]);
  return list.map((rings) => rings.map((ring) => ringOf(arcs, ring)));
}

/** Area and centre of a ring (shoelace formula); the area's sign follows the winding. */
export function ringArea(ring: Point[]): { area: number; centre: Point } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  return { area, centre: area === 0 ? ring[0] : [cx / (6 * area), cy / (6 * area)] };
}

export function decodeStates(topology: UsaTopology): StateShape[] {
  const arcs = decodeArcs(topology);
  return topology.objects.states.geometries.flatMap((geometry) => {
    const code = FIPS_STATES[geometry.id];
    if (!code) return [];
    const polygons = polygonsOf(arcs, geometry);
    const largest = polygons.map((rings) => ringArea(rings[0])).sort((a, b) => Math.abs(b.area) - Math.abs(a.area))[0];
    return [{ code, name: geometry.properties.name, polygons, anchor: largest.centre }];
  });
}

/** The map's frame: 975×610, its middle on the table's centre; this many metres a unit. */
const FRAME = { width: 975, height: 610, metres: 10.2 / 975 };
/** Out in the Atlantic, off the coast of the Carolinas: the flag of the companies headquartered abroad. */
export const ABROAD: Point = [935, 330];

export const TABLE = { top: 0.86, slab: 0.1, tile: 0.035 } as const;

/** A map point on the table, in the hall (north away from the entrance). */
export function onTable([x, y]: Point, height: number = TABLE.top): THREE.Vector3 {
  return new THREE.Vector3((x - FRAME.width / 2) * FRAME.metres, height, (y - FRAME.height / 2) * FRAME.metres);
}

function shapeOf(rings: Point[][]): THREE.Shape {
  // in the shape's plane: x east, y north; the extrusion is turned to stand up afterwards
  const toPlane = ([x, y]: Point) => new THREE.Vector2((x - FRAME.width / 2) * FRAME.metres, -(y - FRAME.height / 2) * FRAME.metres);
  const shape = new THREE.Shape(rings[0].map(toPlane));
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(toPlane)));
  return shape;
}

function slab(polygons: Point[][][], depth: number, bottom: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(polygons.map(shapeOf), { depth, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return geometry;
}

export interface StateFlow { net: number; companies: number }

export class MapTable {
  readonly group = new THREE.Group();
  /** The state tiles, for pointing (userData.state). */
  readonly tiles: THREE.Mesh[] = [];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly states: StateShape[];
  private readonly poles: THREE.InstancedMesh;
  private readonly cloths: THREE.InstancedMesh;
  private readonly dark: boolean;

  constructor(topology: UsaTopology, dark: boolean, wood: THREE.Material) {
    this.dark = dark;
    this.states = decodeStates(topology);
    const arcs = decodeArcs(topology);
    // the slab: the nation's outline in dark wood, on a pedestal
    const nation = topology.objects.nation.geometries.flatMap((geometry) => polygonsOf(arcs, geometry));
    const base = new THREE.Mesh(slab(nation, TABLE.slab, TABLE.top - TABLE.slab), wood);
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(4.6, TABLE.top - TABLE.slab, 2.2), wood);
    pedestal.position.set(0.3, (TABLE.top - TABLE.slab) / 2, 0.2);
    pedestal.castShadow = true;
    this.group.add(pedestal);
    // a tile per state, a little proud of the slab
    for (const state of this.states) {
      const material = new THREE.MeshStandardMaterial({ color: dark ? 0x2c3a30 : 0x3f5a47, roughness: 0.7, metalness: 0.05 });
      const tile = new THREE.Mesh(slab(state.polygons, TABLE.tile, TABLE.top), material);
      tile.receiveShadow = true;
      tile.userData.state = state.code;
      this.materials.set(state.code, material);
      this.tiles.push(tile);
      this.group.add(tile);
    }
    // brass inlay along every border
    const segments: number[] = [];
    for (const arc of arcs) {
      for (let index = 1; index < arc.length; index++) {
        const a = onTable(arc[index - 1], TABLE.top + TABLE.tile + 0.003);
        const b = onTable(arc[index], TABLE.top + TABLE.tile + 0.003);
        segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const borders = new THREE.BufferGeometry();
    borders.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
    this.group.add(new THREE.LineSegments(borders, new THREE.LineBasicMaterial({ color: 0xc9a14f, transparent: true, opacity: dark ? 0.75 : 0.9 })));
    // flags: a brass pin and a pennant, one per state that moved enough money, and one for abroad
    const capacity = this.states.length + 1;
    this.poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.018, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 0.8, roughness: 0.35 }), capacity);
    const pennant = new THREE.BufferGeometry();
    // a swallow-tailed pennant on the pin's right, 0.34 long, 0.2 high, its top at the pin's top
    pennant.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.34, 0, 0, 0.27, -0.1, 0, 0.34, -0.2, 0, 0, -0.2, 0], 3));
    pennant.setIndex([0, 4, 2, 0, 2, 1, 4, 3, 2]);
    pennant.computeVertexNormals();
    this.cloths = new THREE.InstancedMesh(pennant, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.85 }), capacity);
    this.poles.count = 0;
    this.cloths.count = 0;
    this.poles.castShadow = true;
    this.group.add(this.poles, this.cloths);
  }

  /**
   * Tints the states and plants the flags for a quarter: `flows` by state code, `abroad` for the companies
   * headquartered outside the United States.
   */
  update(flows: Map<string, StateFlow>, abroad: StateFlow, positive: string, negative: string, mix: (from: string, to: string, t: number) => string): void {
    const values = [...flows.values()].map((flow) => Math.abs(flow.net)).sort((a, b) => a - b);
    const limit = Math.max(1, values[Math.floor(values.length * 0.9)] ?? 0);
    const most = Math.max(1, ...values, Math.abs(abroad.net));
    const rest = this.dark ? "#2c3a30" : "#3f5a47";
    for (const [code, material] of this.materials) {
      const flow = flows.get(code);
      material.color.set(flow && flow.net !== 0 ? mix(rest, flow.net > 0 ? positive : negative, 0.25 + 0.75 * Math.min(1, Math.abs(flow.net) / limit)) : rest);
    }
    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    let count = 0;
    const plant = (anchor: Point, flow: StateFlow) => {
      // a flag where the money was at least a twentieth of the largest
      if (Math.abs(flow.net) < most / 20) return;
      const height = 0.28 + 1.3 * Math.sqrt(Math.abs(flow.net) / most);
      const foot = onTable(anchor, TABLE.top + TABLE.tile);
      this.poles.setMatrixAt(count, matrix.makeScale(1, height, 1).setPosition(foot));
      this.cloths.setMatrixAt(count, matrix.makeTranslation(foot.x + 0.012, foot.y + height, foot.z));
      this.cloths.setColorAt(count, colour.set(flow.net > 0 ? positive : negative));
      count++;
    };
    for (const state of this.states) {
      const flow = flows.get(state.code);
      if (flow) plant(state.anchor, flow);
    }
    plant(ABROAD, abroad);
    this.poles.count = count;
    this.cloths.count = count;
    this.poles.instanceMatrix.needsUpdate = true;
    this.cloths.instanceMatrix.needsUpdate = true;
    if (this.cloths.instanceColor) this.cloths.instanceColor.needsUpdate = true;
  }

  /** The flags flutter a little. */
  flutter(seconds: number): void {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < this.cloths.count; index++) {
      this.cloths.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      rotation.setFromAxisAngle(up, Math.sin(seconds * 2.2 + index * 1.7) * 0.35);
      this.cloths.setMatrixAt(index, matrix.compose(position, rotation, scale));
    }
    this.cloths.instanceMatrix.needsUpdate = true;
  }

  nameOf(code: string): string | null {
    return this.states.find((item) => item.code === code)?.name ?? null;
  }

  stateAt(code: string): THREE.Vector3 | null {
    const state = this.states.find((item) => item.code === code);
    return state ? onTable(state.anchor, TABLE.top + TABLE.tile) : null;
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    for (const material of this.materials.values()) material.dispose();
    (this.poles.material as THREE.Material).dispose();
    (this.cloths.material as THREE.Material).dispose();
  }
}
