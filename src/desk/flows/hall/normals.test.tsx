import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { creasedNormals } from "./normals";

describe("smooth shading of the people", () => {
  it("never leaves a normal of zero length, also on a face of no area where seams meet", () => {
    // a square in the plane z = 0 and, on its edge, a face of no area (two of its corners at the same place)
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0], 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2]);
    const result = creasedNormals(geometry, Math.PI / 3);
    const normal = result.getAttribute("normal");
    expect(normal.count).toBe(9);
    for (let vertex = 0; vertex < normal.count; vertex++) {
      const direction = new THREE.Vector3().fromBufferAttribute(normal, vertex);
      expect(direction.length()).toBeCloseTo(1, 6);
      // the flat square faces up, and the face of no area keeps the model's own direction
      expect(direction.z).toBeCloseTo(1, 6);
    }
  });

  it("points a corner up when the model gives it no direction either", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 1, 0, 0], 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    const normal = creasedNormals(geometry, Math.PI / 3).getAttribute("normal");
    for (let vertex = 0; vertex < normal.count; vertex++) expect([normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)]).toEqual([0, 1, 0]);
  });
});
