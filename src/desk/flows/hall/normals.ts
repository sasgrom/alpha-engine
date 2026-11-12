import * as THREE from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Smooth shading that keeps edges sharper than `angle`, as three.js's `toCreasedNormals`, but never a normal of zero
 * length. A face of no area (the people's models have a few where seams meet) gives its corners no direction; once
 * skinning pulls such a face open it is drawn, the shader normalises a zero vector, and the invalid colour spreads
 * through the bloom over the whole frame. Those corners keep the model's own normal, or point up when it has none.
 */
export function creasedNormals(geometry: THREE.BufferGeometry, angle: number): THREE.BufferGeometry {
  const original = geometry.getAttribute("normal");
  const index = geometry.index;
  const result = toCreasedNormals(geometry, angle);
  const normal = result.getAttribute("normal");
  const own = new THREE.Vector3();
  for (let vertex = 0; vertex < normal.count; vertex++) {
    if (normal.getX(vertex) ** 2 + normal.getY(vertex) ** 2 + normal.getZ(vertex) ** 2 > 1e-12) continue;
    // without an index the result keeps the input's order; with one, vertex k of the result is the input's index[k]
    const source = index ? index.getX(vertex) : vertex;
    if (original && source < original.count) own.fromBufferAttribute(original, source);
    else own.set(0, 0, 0);
    if (!(own.lengthSq() > 1e-12)) own.set(0, 1, 0);
    own.normalize();
    normal.setXYZ(vertex, own.x, own.y, own.z);
  }
  normal.needsUpdate = true;
  return result;
}
