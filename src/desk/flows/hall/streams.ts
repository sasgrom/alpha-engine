/**
 * Streams of money in the hall. A stream is a ribbon as wide as the dollars it carries, red where the money left and
 * blue where it arrived, with bands that flow along it and bubbles marked "$" riding on it: more money, more bubbles.
 * Rotation streams arc under the dome from bookcase to bookcase; threads run between a person and the books it
 * traded. The reader can show every stream whole, or only the blue half of each (where the money arrived) or only the
 * red half (where it left).
 */
import * as THREE from "three";

/** Which part of every stream shows: all of it, the half where the money arrived (blue), or where it left (red). */
export type StreamPart = "all" | "arriving" | "leaving";
const PART_CODE: Record<StreamPart, number> = { all: 0, arriving: 1, leaving: 2 };
/** The halves meet in the middle of a stream, with a soft edge this wide either side. */
const HALF = { middle: 0.5, edge: 0.12 } as const;
const shows = (part: number, t: number) => part === 0 || (part === 1 ? t >= HALF.middle : t < HALF.middle);

export interface StreamSpec {
  from: THREE.Vector3;
  to: THREE.Vector3;
  usd: number;
  start: THREE.Color;
  end: THREE.Color;
  kind: "rotation" | "thread";
  /** Dimmed when another sector is in focus. */
  lit: boolean;
  /** What the stream joins, for its tooltip (rotation streams). */
  label?: { from: string; to: string };
}

interface Built {
  spec: StreamSpec;
  curve: THREE.QuadraticBezierCurve3;
  length: number;
  mesh: THREE.Mesh;
}

const SEGMENTS = 64;
const MAX_BUBBLES = 3600;

function bubbleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const body = context.createRadialGradient(56, 52, 6, 64, 64, 62);
  body.addColorStop(0, "rgba(255,255,255,0.95)");
  body.addColorStop(0.55, "rgba(255,255,255,0.55)");
  body.addColorStop(0.9, "rgba(255,255,255,0.35)");
  body.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = body;
  context.beginPath();
  context.arc(64, 64, 62, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = "rgba(255,255,255,0.95)";
  context.beginPath();
  context.arc(64, 64, 56, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "rgba(20,20,24,0.9)";
  context.font = "bold 80px Georgia, 'Times New Roman', serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("$", 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Streams and bubbles close to the eye fade away (fully gone within three metres, whole again from twelve), so the
 * reader sees past the money passing overhead to the dome and the hall beyond.
 */
function fadeNear(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vEyeDistance;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvEyeDistance = -mvPosition.z;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vEyeDistance;")
      .replace("#include <opaque_fragment>", "diffuseColor.a *= smoothstep(3.0, 12.0, vEyeDistance);\n#include <opaque_fragment>");
  };
  material.customProgramCacheKey = () => "hall-stream-near";
}

/** As `fadeNear`, for a ribbon: and only the part of it the reader chose (its position along the stream is `along`). */
function ribbonShader(material: THREE.Material, part: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.streamPart = part;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float along;\nvarying float vAlong;\nvarying float vEyeDistance;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvEyeDistance = -mvPosition.z;\nvAlong = along;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float streamPart;\nvarying float vAlong;\nvarying float vEyeDistance;")
      .replace(
        "#include <opaque_fragment>",
        `float arriving = smoothstep(${(HALF.middle - HALF.edge).toFixed(2)}, ${(HALF.middle + HALF.edge).toFixed(2)}, vAlong);
diffuseColor.a *= smoothstep(3.0, 12.0, vEyeDistance) * (streamPart < 0.5 ? 1.0 : streamPart < 1.5 ? arriving : 1.0 - arriving);
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "hall-stream-part";
}

function bandTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 4;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 256, 0);
  for (let stop = 0; stop <= 8; stop++) gradient.addColorStop(stop / 8, stop % 2 ? "rgb(255,255,255)" : "rgb(170,170,170)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A ribbon along a curve, as wide as `width` in the middle and tapering at both ends, coloured start → end. */
function ribbon(curve: THREE.QuadraticBezierCurve3, width: number, start: THREE.Color, end: THREE.Color, repeats: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const along: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  let side = new THREE.Vector3(1, 0, 0);
  const color = new THREE.Color();
  for (let index = 0; index <= SEGMENTS; index++) {
    const t = index / SEGMENTS;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const next = new THREE.Vector3().crossVectors(tangent, up);
    if (next.lengthSq() > 1e-6) side = next.normalize();
    const taper = Math.min(1, t / 0.07, (1 - t) / 0.07);
    const half = (width / 2) * (0.35 + 0.65 * taper);
    positions.push(point.x - side.x * half, point.y - side.y * half, point.z - side.z * half, point.x + side.x * half, point.y + side.y * half, point.z + side.z * half);
    color.copy(start).lerp(end, THREE.MathUtils.smoothstep(t, 0.15, 0.85));
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    uvs.push(t * repeats, 0, t * repeats, 1);
    along.push(t, t);
  }
  for (let index = 0; index < SEGMENTS; index++) {
    const a = index * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
  geometry.setIndex(indices);
  return geometry;
}

export class MoneyStreams {
  readonly group = new THREE.Group();
  private readonly bubbles: THREE.Points;
  private readonly bubbleTexture = bubbleTexture();
  private readonly bandTexture = bandTexture();
  private built: Built[] = [];
  private riders: { stream: number; phase: number; speed: number }[] = [];
  private readonly dark: boolean;
  private fade = 1;
  /** Shared by every ribbon's shader: which part of the streams shows (see `StreamPart`). */
  private readonly part = { value: 0 };
  private seconds = 0;

  constructor(dark: boolean) {
    this.dark = dark;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BUBBLES * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_BUBBLES * 3), 3));
    geometry.setDrawRange(0, 0);
    this.bubbles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.5, map: this.bubbleTexture, vertexColors: true, transparent: true, alphaTest: 0.04, depthWrite: false, sizeAttenuation: true }),
    );
    fadeNear(this.bubbles.material as THREE.Material);
    this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);
  }

  /** Replaces the streams. The widest rotation stream is 2.4 m wide, the widest thread 0.7 m; width follows the dollars. */
  set(specs: StreamSpec[]): void {
    for (const item of this.built) {
      item.mesh.geometry.dispose();
      (item.mesh.material as THREE.Material).dispose();
      this.group.remove(item.mesh);
    }
    this.built = [];
    this.riders = [];
    const top = { rotation: Math.max(1, ...specs.filter((spec) => spec.kind === "rotation").map((spec) => spec.usd)), thread: Math.max(1, ...specs.filter((spec) => spec.kind === "thread").map((spec) => spec.usd)) };
    for (const spec of specs) {
      const span = spec.from.distanceTo(spec.to);
      const middle = spec.from.clone().add(spec.to).multiplyScalar(0.5);
      const control =
        spec.kind === "rotation"
          ? new THREE.Vector3(middle.x * 0.35, Math.max(spec.from.y, spec.to.y) + 2.5 + span * 0.14, middle.z * 0.35)
          : new THREE.Vector3(middle.x, Math.max(spec.from.y, spec.to.y) + 1.5 + span * 0.18, middle.z);
      const curve = new THREE.QuadraticBezierCurve3(spec.from, control, spec.to);
      const length = curve.getLength();
      const share = spec.usd / (spec.kind === "rotation" ? top.rotation : top.thread);
      const width = spec.kind === "rotation" ? 0.18 + 2.2 * share : 0.06 + 0.64 * share;
      const material = new THREE.MeshBasicMaterial({
        map: this.bandTexture,
        vertexColors: true,
        transparent: true,
        opacity: spec.lit ? (this.dark ? 0.82 : 0.9) : 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      ribbonShader(material, this.part);
      material.userData.opacity = material.opacity;
      material.opacity *= this.fade;
      const repeats = Math.max(1, Math.round(length / 6));
      const mesh = new THREE.Mesh(ribbon(curve, width, spec.start, spec.end, repeats), material);
      mesh.userData.repeats = repeats;
      if (spec.label && spec.lit) mesh.userData.stream = { from: spec.label.from, to: spec.label.to, usd: spec.usd };
      mesh.renderOrder = spec.kind === "thread" ? 3 : 2;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const streamIndex = this.built.length;
      this.built.push({ spec, curve, length, mesh });
      if (!spec.lit) continue;
      const count = Math.round(Math.max(spec.kind === "rotation" ? 6 : 3, Math.min(spec.kind === "rotation" ? 140 : 30, share * (spec.kind === "rotation" ? 140 : 30))));
      for (let index = 0; index < count && this.riders.length < MAX_BUBBLES; index++) {
        // evenly spaced and all at the stream's pace (about four and a half metres a second), so they never bunch up
        this.riders.push({ stream: streamIndex, phase: (index + ((streamIndex * 0.37) % 1)) / count, speed: 4.5 / length });
      }
    }
    this.bubbles.geometry.setDrawRange(0, this.riders.length);
    this.update(0, this.fade);
  }

  /**
   * Moves the bands and the bubbles to the time `seconds`. `fade` (0–1) thins the streams out, so that from high up
   * under the dome the people below show through them.
   */
  /** The streams that can be pointed at (lit rotation streams). */
  get pickable(): THREE.Mesh[] {
    return this.built.filter((item) => item.mesh.userData.stream).map((item) => item.mesh);
  }

  /** Shows every stream whole, or only the half of each where the money arrived (blue) or where it left (red). */
  setPart(part: StreamPart): void {
    this.part.value = PART_CODE[part];
    this.update(this.seconds, this.fade);
  }

  /** Whether the point of a stream at these texture coordinates is showing (a hidden half cannot be pointed at). */
  showsAt(mesh: THREE.Object3D, uv: THREE.Vector2 | undefined): boolean {
    if (!uv || this.part.value === 0) return true;
    return shows(this.part.value, uv.x / ((mesh.userData.repeats as number | undefined) ?? 1));
  }

  update(seconds: number, fade = 1): void {
    this.seconds = seconds;
    this.bandTexture.offset.x = -seconds * 0.35;
    if (fade !== this.fade) {
      this.fade = fade;
      for (const item of this.built) {
        const material = item.mesh.material as THREE.MeshBasicMaterial;
        material.opacity = (material.userData.opacity as number) * fade;
      }
      (this.bubbles.material as THREE.PointsMaterial).opacity = Math.min(1, fade * 1.2);
    }
    const positions = this.bubbles.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = this.bubbles.geometry.getAttribute("color") as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    const color = new THREE.Color();
    // only the bubbles on the part of the streams that shows are drawn
    let shown = 0;
    for (const rider of this.riders) {
      const item = this.built[rider.stream];
      const t = (rider.phase + seconds * rider.speed) % 1;
      if (!shows(this.part.value, t)) continue;
      item.curve.getPoint(t, point);
      // the bubbles ride a little above the ribbon so they read against it
      positions.setXYZ(shown, point.x, point.y + 0.22, point.z);
      color.copy(item.spec.start).lerp(item.spec.end, THREE.MathUtils.smoothstep(t, 0.15, 0.85));
      colors.setXYZ(shown, color.r, color.g, color.b);
      shown++;
    }
    this.bubbles.geometry.setDrawRange(0, shown);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  dispose(): void {
    for (const item of this.built) {
      item.mesh.geometry.dispose();
      (item.mesh.material as THREE.Material).dispose();
    }
    this.bubbles.geometry.dispose();
    (this.bubbles.material as THREE.Material).dispose();
    this.bubbleTexture.dispose();
    this.bandTexture.dispose();
  }
}
