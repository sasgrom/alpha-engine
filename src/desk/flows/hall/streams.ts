/**
 * Streams of money in the hall. A stream is a ribbon as wide as the dollars it carries, red where the money left and
 * blue where it arrived, with bands that flow along it and bubbles marked "$" riding on it: more money, more bubbles.
 * Rotation streams arc under the dome from bookcase to bookcase; threads run between a person and the books it
 * traded. The reader can show all of it, only what was bought (the money going in, in blue) or only what was sold
 * (the money coming out, in red).
 */
import * as THREE from "three";

/** Which streams show: all, only the money going in where it was bought (blue), or coming out where it was sold (red). */
export type StreamPart = "all" | "bought" | "sold";

/**
 * How much of one stream shows under a choice: all of it, none, or the part towards where the money arrived (it was
 * bought there) or from where it left (it was sold there). A cut stream fades out three quarters of the way along, so
 * it still points the way the money went.
 */
type Cut = "whole" | "arriving" | "leaving" | "none";
const CUT_CODE: Record<Cut, number> = { whole: 0, arriving: 1, leaving: 2, none: 3 };
const FADE = { arriving: [0.2, 0.45], leaving: [0.55, 0.8] } as const;

function cutOf(spec: StreamSpec, part: StreamPart): Cut {
  if (part === "all") return "whole";
  // a thread is all bought or all sold; a rotation stream was sold where it starts and bought where it ends
  if (spec.side) return spec.side === part ? "whole" : "none";
  return part === "bought" ? "arriving" : "leaving";
}

/** Whether the point a share `t` along a stream shows under a cut (the bubbles and pointing follow the fade's middle). */
function showing(cut: Cut, t: number): boolean {
  if (cut === "whole") return true;
  if (cut === "arriving") return t >= (FADE.arriving[0] + FADE.arriving[1]) / 2;
  if (cut === "leaving") return t <= (FADE.leaving[0] + FADE.leaving[1]) / 2;
  return false;
}

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
  /** A thread is money bought (into a book) or sold (out of it); rotation streams carry both and leave this out. */
  side?: "bought" | "sold";
}

/** Each ribbon's own shader values: how much of it shows, and the single colour it takes when only one side shows. */
interface StreamUniforms { streamCut: { value: number }; streamSolid: { value: number }; streamTone: { value: THREE.Color } }

interface Built {
  spec: StreamSpec;
  curve: THREE.QuadraticBezierCurve3;
  length: number;
  mesh: THREE.Mesh;
  uniforms: StreamUniforms;
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

/**
 * As `fadeNear`, for a ribbon: and only the part of it the reader chose, in one colour when only one side shows (the
 * position along the stream is `along`; the values are the ribbon's own `uniforms`).
 */
function ribbonShader(material: THREE.Material, uniforms: StreamUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float along;\nuniform float streamSolid;\nuniform vec3 streamTone;\nvarying float vAlong;\nvarying float vEyeDistance;")
      .replace("#include <color_vertex>", "#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, streamTone, streamSolid);")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvEyeDistance = -mvPosition.z;\nvAlong = along;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float streamCut;\nvarying float vAlong;\nvarying float vEyeDistance;")
      .replace(
        "#include <opaque_fragment>",
        `float keep = streamCut < 0.5 ? 1.0 : streamCut < 1.5 ? smoothstep(${FADE.arriving[0]}, ${FADE.arriving[1]}, vAlong) : streamCut < 2.5 ? 1.0 - smoothstep(${FADE.leaving[0]}, ${FADE.leaving[1]}, vAlong) : 0.0;
diffuseColor.a *= smoothstep(3.0, 12.0, vEyeDistance) * keep;
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
  /** Which streams show (see `StreamPart`). */
  private part: StreamPart = "all";
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
      const uniforms: StreamUniforms = { streamCut: { value: 0 }, streamSolid: { value: 0 }, streamTone: { value: new THREE.Color() } };
      ribbonShader(material, uniforms);
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
      mesh.userData.built = streamIndex;
      const item = { spec, curve, length, mesh, uniforms };
      this.built.push(item);
      this.apply(item);
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

  /** Shows all the streams, only what was bought (the money going in, in blue) or only what was sold (coming out, in red). */
  setPart(part: StreamPart): void {
    this.part = part;
    for (const item of this.built) this.apply(item);
    this.update(this.seconds, this.fade);
  }

  /** One stream under the current choice: how much of it shows, and in which single colour when only one side shows. */
  private apply(item: Built): void {
    const cut = cutOf(item.spec, this.part);
    item.uniforms.streamCut.value = CUT_CODE[cut];
    item.uniforms.streamSolid.value = this.part === "all" ? 0 : 1;
    item.uniforms.streamTone.value.copy(this.part === "sold" ? item.spec.start : item.spec.end);
    item.mesh.visible = cut !== "none";
  }

  /** Whether the point of a stream at these texture coordinates is showing (a hidden part cannot be pointed at). */
  showsAt(mesh: THREE.Object3D, uv: THREE.Vector2 | undefined): boolean {
    const item = this.built[mesh.userData.built as number];
    if (!item || this.part === "all") return true;
    if (!uv) return mesh.visible;
    return showing(cutOf(item.spec, this.part), uv.x / ((mesh.userData.repeats as number | undefined) ?? 1));
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
    // only the bubbles on the part of the streams that shows are drawn, in the stream's colour there
    let shown = 0;
    for (const rider of this.riders) {
      const item = this.built[rider.stream];
      const t = (rider.phase + seconds * rider.speed) % 1;
      if (!showing(cutOf(item.spec, this.part), t)) continue;
      item.curve.getPoint(t, point);
      // the bubbles ride a little above the ribbon so they read against it
      positions.setXYZ(shown, point.x, point.y + 0.22, point.z);
      if (this.part === "all") color.copy(item.spec.start).lerp(item.spec.end, THREE.MathUtils.smoothstep(t, 0.15, 0.85));
      else color.copy(this.part === "sold" ? item.spec.start : item.spec.end);
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
