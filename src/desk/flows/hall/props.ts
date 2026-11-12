/**
 * A few small details in the hall: a bronze emblem over every bookcase that says its sector at a glance (a chip for
 * technology, a mast for communication, coins for finance, a cross for health care, a bag for consumer goods, a jar
 * for staples, a gear for industry, a drop of oil for energy, a bolt for utilities, a house for real estate, ingots for
 * materials), and the laptops the technology holders carry. Built from simple shapes; nothing loads.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const merge = (parts: THREE.BufferGeometry[]) => {
  const plain = parts.map((part) => {
    const geometry = part.index ? part.toNonIndexed() : part;
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    return geometry;
  });
  return mergeGeometries(plain, false) ?? new THREE.BufferGeometry();
};

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function extruded(points: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 }).translate(0, 0, -depth / 2);
}

/** Each emblem about a metre tall, standing on y = 0, facing +z (the stage turns it to face the hall). */
const EMBLEMS: Record<string, () => THREE.BufferGeometry> = {
  "Information Technology": () => {
    const parts: THREE.BufferGeometry[] = [box(0.7, 0.7, 0.12, 0, 0.45)];
    for (let index = 0; index < 5; index++) {
      const at = -0.28 + index * 0.14;
      parts.push(box(0.05, 0.14, 0.05, at, 0.03), box(0.05, 0.14, 0.05, at, 0.87), box(0.14, 0.05, 0.05, -0.42, 0.17 + index * 0.14), box(0.14, 0.05, 0.05, 0.42, 0.17 + index * 0.14));
    }
    return merge(parts);
  },
  "Communication Services": () => {
    const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.02, 0.06, 0.95, 8).translate(0, 0.475, 0), new THREE.SphereGeometry(0.06, 12, 8).translate(0, 0.98, 0)];
    for (const [radius, y] of [[0.2, 0.98], [0.32, 0.98], [0.44, 0.98]] as const) parts.push(new THREE.TorusGeometry(radius, 0.018, 6, 24, Math.PI * 0.7).rotateZ(Math.PI * 0.15).translate(0, y, 0));
    return merge(parts);
  },
  Financials: () => merge(Array.from({ length: 6 }, (_, index) => new THREE.CylinderGeometry(0.26, 0.26, 0.07, 28).translate((index % 2) * 0.03, 0.035 + index * 0.075, 0)).concat([new THREE.CylinderGeometry(0.26, 0.26, 0.07, 28).rotateX(Math.PI / 2).translate(0.42, 0.26, 0)])),
  "Health Care": () => merge([box(0.24, 0.8, 0.14, 0, 0.4), box(0.8, 0.24, 0.14, 0, 0.45)]),
  "Consumer Discretionary": () => merge([box(0.6, 0.62, 0.26, 0, 0.31), new THREE.TorusGeometry(0.15, 0.025, 6, 20, Math.PI).translate(0, 0.62, 0)]),
  "Consumer Staples": () => merge([new THREE.CylinderGeometry(0.24, 0.27, 0.7, 24).translate(0, 0.35, 0), new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24).translate(0, 0.75, 0)]),
  Industrials: () => {
    const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.34, 0.34, 0.14, 32).rotateX(Math.PI / 2).translate(0, 0.5, 0)];
    for (let tooth = 0; tooth < 10; tooth++) {
      const angle = (tooth / 10) * Math.PI * 2;
      parts.push(box(0.12, 0.14, 0.14).translate(0, 0.38, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(angle)).translate(0, 0.5, 0));
    }
    return merge(parts);
  },
  Energy: () => {
    const drop = new THREE.LatheGeometry(
      Array.from({ length: 16 }, (_, index) => {
        const t = index / 15;
        // a drop: round at the bottom, pointed at the top
        const angle = t * Math.PI;
        return new THREE.Vector2(Math.max(0.001, Math.sin(angle) * 0.3 * (1 - t * 0.55)), 0.3 - Math.cos(angle) * 0.3 + t * t * 0.45);
      }),
      24,
    );
    return merge([drop]);
  },
  Utilities: () => extruded([[0.06, 1], [-0.22, 0.42], [0.02, 0.42], [-0.08, 0], [0.24, 0.6], [0.0, 0.6], [0.16, 1]], 0.1),
  "Real Estate": () => {
    const roof = extruded([[-0.42, 0.55], [0.42, 0.55], [0, 0.95]], 0.5);
    return merge([box(0.66, 0.55, 0.5, 0, 0.275), roof, box(0.14, 0.26, 0.02, 0, 0.13, 0.26)]);
  },
  Materials: () => {
    const ingot = () => extruded([[-0.24, 0], [0.24, 0], [0.19, 0.13], [-0.19, 0.13]], 0.2);
    return merge([ingot().translate(-0.2, 0, 0), ingot().translate(0.2, 0, 0), ingot().translate(0, 0.15, 0)]);
  },
};

/** The bronze emblem of a sector, or null for a sector without one. */
export function emblemFor(sector: string): THREE.BufferGeometry | null {
  const make = EMBLEMS[sector];
  if (!make) return null;
  const geometry = make();
  geometry.computeVertexNormals();
  return geometry;
}

export const BRONZE = () => new THREE.MeshStandardMaterial({ color: 0xa8823f, metalness: 0.85, roughness: 0.38 });

/** A closed laptop as carried under the arm: dark grey shell, a thin bright edge. Centre at the origin, long side along x. */
export function laptopGeometry(): THREE.BufferGeometry {
  return merge([box(0.34, 0.024, 0.24), box(0.34, 0.004, 0.24, 0, 0.014)]);
}

/** A walking stick with a crook, standing on y = 0, 0.9 m tall. */
export function caneGeometry(): THREE.BufferGeometry {
  return merge([
    new THREE.CylinderGeometry(0.012, 0.014, 0.84, 8).translate(0, 0.42, 0),
    new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI).translate(0.05, 0.84, 0),
    new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8).translate(0, 0.01, 0),
  ]);
}

/** A kick scooter, its deck along z (forward), standing on y = 0. */
export function scooterGeometry(): THREE.BufferGeometry {
  const wheel = () => new THREE.CylinderGeometry(0.065, 0.065, 0.035, 14).rotateZ(Math.PI / 2);
  return merge([
    box(0.13, 0.03, 0.56, 0, 0.085, 0),
    wheel().translate(0, 0.065, 0.31),
    wheel().translate(0, 0.065, -0.29),
    // the stem leans back a little from the front wheel to the handlebar
    new THREE.CylinderGeometry(0.016, 0.016, 0.86, 8).rotateX(-0.14).translate(0, 0.5, 0.27),
    new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8).rotateZ(Math.PI / 2).translate(0, 0.92, 0.21),
  ]);
}

/** A bicycle pushed by the saddle, its length along z, standing on y = 0. */
export function bikeGeometry(): THREE.BufferGeometry {
  const wheel = (z: number) => new THREE.TorusGeometry(0.3, 0.018, 6, 28).rotateY(Math.PI / 2).translate(0, 0.32, z);
  const tube = (from: [number, number], to: [number, number], radius = 0.016) => {
    const [z0, y0] = from;
    const [z1, y1] = to;
    const length = Math.hypot(z1 - z0, y1 - y0);
    return new THREE.CylinderGeometry(radius, radius, length, 6)
      .rotateX(Math.atan2(z1 - z0, y1 - y0))
      .translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
  };
  const rear: [number, number] = [-0.5, 0.32];
  const front: [number, number] = [0.5, 0.32];
  const pedals: [number, number] = [-0.05, 0.3];
  const seat: [number, number] = [-0.2, 0.78];
  const head: [number, number] = [0.38, 0.8];
  return merge([
    wheel(-0.5),
    wheel(0.5),
    tube(rear, pedals),
    tube(pedals, seat),
    tube(seat, rear),
    tube(pedals, head),
    tube(seat, head),
    tube(head, front),
    box(0.09, 0.03, 0.2, 0, 0.82, -0.22),
    new THREE.CylinderGeometry(0.014, 0.014, 0.46, 8).rotateZ(Math.PI / 2).translate(0, 0.92, 0.36),
  ]);
}
