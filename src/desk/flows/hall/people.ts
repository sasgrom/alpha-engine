/**
 * The people in the hall. Every fund is a person: a figure from Quaternius's animated people (CC0) when its firm's
 * leader is known from public sources, a wooden mannequin otherwise. A figure's size follows the money it manages,
 * its jacket the quarter's net flow, its clothes the mix of what it holds. People stand, breathe, and walk to their
 * new place when the quarter changes.
 *
 * Each figure is drawn in one call: the model's parts are merged into one skinned mesh whose colours sit in the
 * vertices, with the jacket painted from a per-person colour in the shader. People do not carry skeletons of their
 * own: a few shared rigs per figure (standing in four phases, walking at three paces) are animated once a frame and
 * every person is drawn from one of them where it stands, so hundreds of people cost a few dozen animations.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { Carry } from "./character";
import { polar, ROTUNDA, walkLength, walkPoint, type Slot } from "./layout";

export type FigureKind = "man-suit" | "man-longsleeves" | "man-a" | "man-b" | "woman" | "woman-casual" | "woman-dress" | "woman-tanktop";
export type BodyKind = FigureKind | "mannequin";

/**
 * The parts of a figure that take a person's own colours, painted in the shader: 1 the jacket (the quarter's net
 * flow), 2 the trousers, 3 the shirt under a jacket, 4 the hair, 6 a mannequin's wood. 0 keeps the model's colour.
 */
const PART = { other: 0, jacket: 1, pants: 2, shirt: 3, hair: 4, wood: 6 } as const;
type Parts = Partial<Record<"jacket" | "pants" | "shirt" | "hair", string[]>>;

const FIGURES: Record<FigureKind, { file: string; parts: Parts }> = {
  "man-suit": { file: "man-suit.glb", parts: { jacket: ["Shirt"], pants: ["Pants"], shirt: ["Details"], hair: ["Hair"] } },
  "man-longsleeves": { file: "man-longsleeves.glb", parts: { jacket: ["Shirt"], pants: ["Pants"], hair: ["Hair"] } },
  "man-a": { file: "man-a.glb", parts: { jacket: ["Shirt"], pants: ["Pants"], hair: ["Hair"] } },
  "man-b": { file: "man-b.glb", parts: { jacket: ["Shirt", "Shirt2"], pants: ["Pants"], hair: ["Hair", "Hair2"] } },
  woman: { file: "woman.glb", parts: { jacket: ["Jacket", "LightJacket"], pants: ["Pants"], shirt: ["Shirt"], hair: ["Hair", "HairBase"] } },
  "woman-casual": { file: "woman-casual.glb", parts: { jacket: ["Shirt"], pants: ["Pants"], hair: ["Hair", "HairBase"] } },
  "woman-dress": { file: "woman-dress.glb", parts: { jacket: ["Dress"], hair: ["Hair"] } },
  "woman-tanktop": { file: "woman-tanktop.glb", parts: { jacket: ["Shirt"], pants: ["Pants"], hair: ["Hair", "HairBase"] } },
};

function partOf(parts: Parts, material: string): number {
  for (const [name, materials] of Object.entries(parts) as [keyof Parts, string[]][]) if (materials.includes(material)) return PART[name];
  return PART.other;
}

/** A person stands this tall at scale 1, in metres. */
const STANDING = 1.74;

interface Prototype {
  scene: THREE.Object3D;
  clips: { idle: THREE.AnimationClip; walk: THREE.AnimationClip };
  /** Scale and lift that bring the model to STANDING metres with its feet on the floor. */
  unit: number;
  lift: number;
  /** The merged body whose geometry every person of this figure shares. */
  mesh: THREE.SkinnedMesh;
  /** A sphere round the standing figure in the rig's space, roomy enough for its movements: people out of view are not drawn. */
  sphere: THREE.Sphere;
}

export type Prototypes = Map<BodyKind, Prototype>;

/** A person's own colours: the jacket from the quarter, the rest from its look. */
export interface Colours {
  jacket: THREE.Color;
  pants: THREE.Color;
  shirt: THREE.Color;
  hair: THREE.Color;
  wood: THREE.Color;
}

const NEUTRAL: Colours = { jacket: new THREE.Color(0x777777), pants: new THREE.Color(0x333333), shirt: new THREE.Color(0xeeeeee), hair: new THREE.Color(0x2a2220), wood: new THREE.Color(0xc9a27a) };

/** A material that paints the vertices' colours, and each person's parts from uniforms of its own. */
function personMaterial(colours: Colours): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.02 });
  const uniforms = { uJacket: { value: colours.jacket }, uPants: { value: colours.pants }, uShirt: { value: colours.shirt }, uHair: { value: colours.hair }, uWood: { value: colours.wood } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float part;\nvarying float vPart;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPart = part;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uJacket;\nuniform vec3 uPants;\nuniform vec3 uShirt;\nuniform vec3 uHair;\nuniform vec3 uWood;\nvarying float vPart;")
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float personPart = floor(vPart + 0.5);",
          "if (personPart == 1.0) diffuseColor.rgb = uJacket;",
          "else if (personPart == 2.0) diffuseColor.rgb = uPants;",
          "else if (personPart == 3.0) diffuseColor.rgb = uShirt;",
          "else if (personPart == 4.0) diffuseColor.rgb = uHair;",
          "else if (personPart == 6.0) diffuseColor.rgb = uWood;",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "hall-person";
  material.userData.colours = colours;
  return material;
}

/** Merges the parts of a loaded figure into one skinned mesh with vertex colours and a part number per vertex. */
function mergeFigure(scene: THREE.Object3D, partNames: Parts): THREE.SkinnedMesh {
  const parts: THREE.SkinnedMesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) parts.push(object as THREE.SkinnedMesh);
  });
  if (!parts.length) throw new Error("The figure has no skinned mesh");
  const geometries = parts.map((part) => {
    const source = part.geometry;
    const geometry = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "skinIndex", "skinWeight"]) geometry.setAttribute(name, source.getAttribute(name));
    if (source.index) geometry.setIndex(source.index);
    const count = source.getAttribute("position").count;
    const material = (Array.isArray(part.material) ? part.material[0] : part.material) as THREE.MeshStandardMaterial;
    const color = material.color?.clone() ?? new THREE.Color(0.6, 0.6, 0.6);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) colors.set([color.r, color.g, color.b], index * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("part", new THREE.BufferAttribute(new Float32Array(count).fill(partOf(partNames, material.name)), 1));
    // smooth shading over the low-poly surfaces, keeping the edges sharper than 60 degrees
    return toCreasedNormals(geometry, Math.PI / 3);
  });
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error("The figure's parts could not be merged");
  const first = parts[0];
  const mesh = new THREE.SkinnedMesh(merged, personMaterial(NEUTRAL));
  mesh.name = "person-body";
  mesh.bind(first.skeleton, first.bindMatrix);
  first.parent!.add(mesh);
  for (const part of parts) part.parent?.remove(part);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * A dressed wooden mannequin on the same skeleton as the men: a rigid piece for every limb, a jacket over the chest
 * and arms, trousers, shoes; head, neck and hands in the person's own wood. It stands for a fund whose leader is not
 * known from a public source.
 */
function buildMannequin(prototype: THREE.Object3D): THREE.SkinnedMesh {
  let body: THREE.SkinnedMesh | null = null;
  prototype.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) body = object as THREE.SkinnedMesh;
  });
  if (!body) throw new Error("No body to take the skeleton from");
  const source = body as THREE.SkinnedMesh;
  const skeleton = source.skeleton;
  // These files keep the mesh in a small raw space on its side (z up) under a group that turns and enlarges it.
  // The pieces are shaped in the scene's space with the figure standing in its bind pose (y up), then carried into
  // the raw space by the inverse of the root bone's rest transform (its world matrix times its inverse bind matrix).
  // A joint's bind position is its inverse bind matrix's origin carried out of the raw space the same way (some
  // joints' rest pose in the file differs from the bind pose, so their world matrices are not used).
  prototype.updateMatrixWorld(true);
  const rest = new THREE.Matrix4().multiplyMatrices(skeleton.bones[0].matrixWorld, skeleton.boneInverses[0]);
  const toMesh = rest.clone().invert();
  // the loader drops the dots of the file's bone names ("Foot.L" becomes "FootL"); compare letters and digits only
  const plain = (name: string) => name.replace(/[^A-Za-z0-9]/g, "");
  const at = (name: string) => {
    const index = skeleton.bones.findIndex((bone) => plain(bone.name) === plain(name));
    if (index < 0) throw new Error(`No bone ${name}`);
    const point = new THREE.Vector3().applyMatrix4(new THREE.Matrix4().copy(skeleton.boneInverses[index]).invert()).applyMatrix4(rest);
    return { index, point };
  };
  const pieces: THREE.BufferGeometry[] = [];
  const shoe = new THREE.Color(0x221c18);
  const white = new THREE.Color(0xffffff);
  const add = (geometry: THREE.BufferGeometry, bone: number, part: number, color = white) => {
    geometry.applyMatrix4(toMesh);
    const count = geometry.getAttribute("position").count;
    const kept = new THREE.BufferGeometry();
    kept.setAttribute("position", geometry.getAttribute("position"));
    kept.setAttribute("normal", geometry.getAttribute("normal"));
    if (geometry.index) kept.setIndex(geometry.index);
    kept.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4).map((_, item) => (item % 4 === 0 ? bone : 0)), 4));
    kept.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, item) => (item % 4 === 0 ? 1 : 0)), 4));
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) colors.set([color.r, color.g, color.b], index * 3);
    kept.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    kept.setAttribute("part", new THREE.BufferAttribute(new Float32Array(count).fill(part), 1));
    pieces.push(kept);
  };
  // the model's own height sets the thickness of the limbs
  const head = at("Head").point;
  const footL = at("Foot.L").point;
  const height = head.y - footL.y;
  const limb = (from: string, to: string, radius: number, part: number, bone = from) => {
    const a = at(from).point;
    const b = at(to).point;
    const length = Math.max(0.01, a.distanceTo(b));
    const capsule = new THREE.CapsuleGeometry(radius * height, Math.max(0.001, length - radius * height), 4, 10);
    capsule.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    capsule.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add(capsule, at(bone).index, part);
  };
  const ball = (name: string, radius: number, part: number, offset = new THREE.Vector3()) => {
    const sphere = new THREE.SphereGeometry(radius * height, 14, 10);
    const point = at(name).point.clone().add(offset.clone().multiplyScalar(height));
    sphere.translate(point.x, point.y, point.z);
    add(sphere, at(name).index, part);
  };
  limb("Hips", "Abdomen", 0.085, PART.pants);
  limb("Abdomen", "Torso", 0.088, PART.jacket);
  limb("Torso", "Neck", 0.1, PART.jacket);
  limb("Neck", "Head", 0.03, PART.wood);
  // the head: an egg above the neck
  {
    const egg = new THREE.SphereGeometry(0.07 * height, 18, 14);
    egg.scale(1, 1.22, 1.05);
    egg.translate(head.x, head.y + 0.08 * height, head.z);
    add(egg, at("Head").index, PART.wood);
  }
  for (const side of ["L", "R"]) {
    limb(`Shoulder.${side}`, `UpperArm.${side}`, 0.04, PART.jacket);
    limb(`UpperArm.${side}`, `LowerArm.${side}`, 0.034, PART.jacket);
    limb(`LowerArm.${side}`, `Palm.${side}`, 0.03, PART.jacket);
    ball(`Palm.${side}`, 0.034, PART.wood);
    ball(`LowerArm.${side}`, 0.036, PART.jacket);
    limb(`UpperLeg.${side}`, `LowerLeg.${side}`, 0.05, PART.pants);
    limb(`LowerLeg.${side}`, `Foot.${side}`, 0.042, PART.pants);
    ball(`LowerLeg.${side}`, 0.045, PART.pants);
    ball(`UpperLeg.${side}`, 0.055, PART.pants);
    // the foot: a wooden block pointing forward
    const foot = at(`Foot.${side}`).point;
    const block = new THREE.BoxGeometry(0.06 * height, 0.035 * height, 0.13 * height);
    block.translate(foot.x, foot.y - 0.02 * height, foot.z + 0.04 * height);
    add(block, at(`Foot.${side}`).index, PART.other, shoe);
  }
  const merged = mergeGeometries(pieces, false)!;
  const mesh = new THREE.SkinnedMesh(merged, personMaterial(NEUTRAL));
  mesh.name = "person-body";
  mesh.bind(skeleton, source.bindMatrix);
  source.parent!.add(mesh);
  source.parent!.remove(source);
  mesh.frustumCulled = false;
  return mesh;
}

function clipNamed(clips: THREE.AnimationClip[], pattern: RegExp): THREE.AnimationClip {
  const clip = clips.find((item) => pattern.test(item.name));
  if (!clip) throw new Error(`No clip ${pattern}`);
  return clip;
}

/** Loads the eight figures and builds the mannequin. */
export async function loadPrototypes(base = "/desk-assets/library/people/"): Promise<Prototypes> {
  const loader = new GLTFLoader();
  const prototypes: Prototypes = new Map();
  const entries = Object.entries(FIGURES) as [FigureKind, { file: string; parts: Parts }][];
  const loaded = await Promise.all(entries.map(([, figure]) => loader.loadAsync(base + figure.file)));
  const settle = (scene: THREE.Object3D) => {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true);
    const height = Math.max(0.01, box.max.y - box.min.y);
    // a third larger than the standing figure, so arms and legs in motion stay inside
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius *= 1.35;
    return { unit: STANDING / height, lift: -box.min.y * (STANDING / height), sphere };
  };
  for (let index = 0; index < entries.length; index++) {
    const [kind, figure] = entries[index];
    const gltf = loaded[index];
    const mesh = mergeFigure(gltf.scene, figure.parts);
    const { unit, lift, sphere } = settle(gltf.scene);
    prototypes.set(kind, { scene: gltf.scene, clips: { idle: clipNamed(gltf.animations, /(Man|Female)_Idle$/), walk: clipNamed(gltf.animations, /(Man|Female)_Walk$/) }, unit, lift, mesh, sphere });
  }
  // the mannequin wears the men's skeleton and moves with their clips
  const suit = loaded[entries.findIndex(([kind]) => kind === "man-suit")];
  const scene = cloneSkinned(prototypes.get("man-suit")!.scene);
  const mannequin = buildMannequin(scene);
  const { unit, lift, sphere } = settle(scene);
  prototypes.set("mannequin", { scene, clips: { idle: clipNamed(suit.animations, /Man_Idle$/), walk: clipNamed(suit.animations, /Man_Walk$/) }, unit, lift, mesh: mannequin, sphere });
  return prototypes;
}

export interface PersonSpec {
  cik: number;
  body: BodyKind;
  /** Height as a share of a grown person's (it follows the money). */
  scale: number;
  /** Width and depth on top of that: slimmer for the smallest funds, broader for the largest. */
  girth: number;
  colours: Colours;
  /** What the person carries or rides, and its walking pace against an ordinary walk. */
  carry: Carry;
  pace: number;
}

/** A shared skeleton with its animation, at the origin and out of the scene; people are drawn from it where they stand. */
interface Rig {
  scene: THREE.Object3D;
  skeleton: THREE.Skeleton;
  mixer: THREE.AnimationMixer;
  users: number;
}

/** Standing rigs per figure, each in its own phase of breathing; walking rigs per figure, one per pace. */
const IDLE_PHASES = 4;
const WALK_PACES = [1.0, 1.8, 2.6];

interface Person {
  spec: PersonSpec;
  body: BodyKind;
  root: THREE.Group;
  figure: THREE.Group;
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshStandardMaterial;
  picker: THREE.Mesh;
  rig: Rig;
  slot: Slot | null;
  face: number;
  /** A walk in progress: from, to, how far along (0–1), metres per second, seconds to wait before setting off. */
  trip: { from: Slot; to: Slot; t: number; speed: number; wait: number; length: number } | null;
  /** On the way out through the entrance, or already outside (out of sight, not pickable). */
  leaving: boolean;
  away: boolean;
}

/** Where people come in and go out: just inside the entrance. */
const DOOR: Slot = (() => {
  const [x, , z] = polar(Math.PI, ROTUNDA.radius - 0.4);
  return { x, z, angle: Math.PI };
})();

/** A person faces this way when its yaw is 0 (the figures face +z). */
const yawTowards = (dx: number, dz: number) => Math.atan2(dx, dz);

/** A soft dark disc under each person: cheaper than a cast shadow for a crowd of hundreds, and it grounds them. */
function blobTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.3)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const MAX_SHADOWS = 1024;

export class Crowd {
  readonly group = new THREE.Group();
  readonly pickers: THREE.Mesh[] = [];
  private readonly people = new Map<number, Person>();
  private readonly prototypes: Prototypes;
  private readonly rigs = new Map<string, Rig>();
  private readonly pickerGeometry = new THREE.CapsuleGeometry(0.34, 1.05, 4, 8);
  private readonly pickerMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private readonly calm: boolean;
  private readonly shadows: THREE.InstancedMesh;

  constructor(prototypes: Prototypes, calm: boolean) {
    this.prototypes = prototypes;
    this.calm = calm;
    const disc = new THREE.CircleGeometry(0.55, 20);
    disc.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }), MAX_SHADOWS);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.group.add(this.shadows);
  }

  /** The shared rig of a figure standing in a phase (0–3) or walking at a pace (0–2), made when first needed. */
  private rig(body: BodyKind, walking: boolean, variant: number): Rig {
    const key = `${body}|${walking ? "walk" : "idle"}|${variant}`;
    const existing = this.rigs.get(key);
    if (existing) return existing;
    const prototype = this.prototypes.get(body)!;
    const scene = cloneSkinned(prototype.scene);
    let skeleton: THREE.Skeleton | null = null;
    scene.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh && !skeleton) skeleton = (object as THREE.SkinnedMesh).skeleton;
    });
    const mixer = new THREE.AnimationMixer(scene);
    const clip = walking ? prototype.clips.walk : prototype.clips.idle;
    const action = mixer.clipAction(clip);
    if (walking) action.timeScale = WALK_PACES[variant];
    else {
      // the standing rigs breathe out of step with each other
      action.time = (variant / IDLE_PHASES) * clip.duration;
      action.timeScale = 0.86 + 0.09 * variant;
    }
    action.play();
    mixer.update(0);
    scene.updateMatrixWorld(true);
    const rig: Rig = { scene, skeleton: skeleton!, mixer, users: 0 };
    this.rigs.set(key, rig);
    return rig;
  }

  /** Draws a person from another rig (standing or walking). */
  private use(person: Person, rig: Rig): void {
    if (person.rig === rig) return;
    person.rig.users--;
    rig.users++;
    person.rig = rig;
    person.mesh.skeleton = rig.skeleton;
  }

  private standing(person: Person): Rig {
    return this.rig(person.body, false, person.spec.cik % IDLE_PHASES);
  }

  /** Adds, changes and removes people so that exactly `specs` are in the hall. */
  sync(specs: PersonSpec[]): void {
    const wanted = new Set(specs.map((spec) => spec.cik));
    for (const [cik, person] of this.people) if (!wanted.has(cik)) this.remove(cik, person);
    for (const spec of specs) {
      const person = this.people.get(spec.cik);
      if (person && person.spec.body === spec.body) {
        person.spec = spec;
        const colours = person.material.userData.colours as Colours;
        for (const key of Object.keys(colours) as (keyof Colours)[]) colours[key].copy(spec.colours[key]);
        this.applyScale(person);
        continue;
      }
      const slot = person?.slot ?? null;
      if (person) this.remove(spec.cik, person);
      this.add(spec, slot);
    }
  }

  private applyScale(person: Person): void {
    const prototype = this.prototypes.get(person.body)!;
    person.figure.scale.setScalar(prototype.unit);
    person.figure.position.y = prototype.lift;
    person.root.scale.set(person.spec.scale * person.spec.girth, person.spec.scale, person.spec.scale * person.spec.girth);
  }

  private add(spec: PersonSpec, slot: Slot | null): void {
    const body: BodyKind = this.prototypes.has(spec.body) ? spec.body : "mannequin";
    const prototype = this.prototypes.get(body)!;
    const material = personMaterial({ jacket: spec.colours.jacket.clone(), pants: spec.colours.pants.clone(), shirt: spec.colours.shirt.clone(), hair: spec.colours.hair.clone(), wood: spec.colours.wood.clone() });
    // drawn from a shared rig: detached, so the person's own place in the hall positions the posed body
    const mesh = new THREE.SkinnedMesh(prototype.mesh.geometry, material);
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.frustumCulled = true;
    mesh.boundingSphere = prototype.sphere.clone();
    // the blob under the feet stands in for a cast shadow
    mesh.castShadow = false;
    const figure = new THREE.Group();
    figure.add(mesh);
    const root = new THREE.Group();
    root.add(figure);
    const picker = new THREE.Mesh(this.pickerGeometry, this.pickerMaterial);
    picker.position.y = 0.88;
    picker.userData.cik = spec.cik;
    root.add(picker);
    this.pickers.push(picker);
    const rig = this.rig(body, false, spec.cik % IDLE_PHASES);
    rig.users++;
    // an explicit bind matrix keeps the shared skeleton's inverses as they are
    mesh.bind(rig.skeleton, new THREE.Matrix4());
    const person: Person = { spec, body, root, figure, mesh, material, picker, rig, slot, face: 0, trip: null, leaving: false, away: false };
    this.applyScale(person);
    // somebody new comes in through the entrance (and walks to its place when the quarter changes)
    root.position.set(slot ? slot.x : DOOR.x, 0, slot ? slot.z : DOOR.z);
    this.people.set(spec.cik, person);
    this.group.add(root);
  }

  private remove(cik: number, person: Person): void {
    person.rig.users--;
    person.material.dispose();
    this.group.remove(person.root);
    const index = this.pickers.indexOf(person.picker);
    if (index >= 0) this.pickers.splice(index, 1);
    this.people.delete(cik);
  }

  /**
   * Sends a person to a place, facing `face` (a point in the hall) once there. A first placement, a short
   * distance or calm motion moves it at once; otherwise it walks there, setting off after a short pause.
   */
  place(cik: number, slot: Slot, face: { x: number; z: number }, walk: boolean): void {
    const person = this.people.get(cik);
    if (!person) return;
    person.leaving = false;
    if (person.away) {
      this.show(person);
      person.root.position.set(DOOR.x, 0, DOOR.z);
      person.trip = null;
    }
    const yaw = yawTowards(face.x - slot.x, face.z - slot.z);
    const from = person.slot ?? slot;
    const distance = Math.hypot(slot.x - person.root.position.x, slot.z - person.root.position.z);
    person.slot = slot;
    person.face = yaw;
    if (!walk || this.calm || !person.trip && distance < 0.4) {
      person.trip = null;
      person.root.position.set(slot.x, 0, slot.z);
      person.root.rotation.y = yaw;
      this.settle(person);
      return;
    }
    const current = { x: person.root.position.x, z: person.root.position.z, angle: Math.atan2(person.root.position.x, -person.root.position.z) };
    const length = walkLength(current, slot);
    // nobody takes more than about six seconds to cross the hall
    const speed = Math.min(8, Math.max(1.4, length / 5.5) * person.spec.pace);
    person.trip = { from: person.trip ? current : { ...from, x: current.x, z: current.z, angle: current.angle }, to: slot, t: 0, speed, length: Math.max(0.01, length), wait: ((cik * 0.377) % 1) * 1.1 };
  }

  private settle(person: Person): void {
    this.use(person, this.standing(person));
  }

  /** Moves the walkers, plays the rigs in use (once each, however many people they draw) and places the blobs. */
  update(seconds: number): void {
    const matrix = new THREE.Matrix4();
    let shadow = 0;
    for (const person of this.people.values()) {
      const trip = person.trip;
      if (trip) {
        if (trip.wait > 0) {
          trip.wait -= seconds;
        } else {
          // the walking rig whose pace is nearest the person's speed
          this.use(person, person.spec.carry === "scooter" ? this.standing(person) : this.rig(person.body, true, trip.speed < 2.4 ? 0 : trip.speed < 4.2 ? 1 : 2));
          trip.t = Math.min(1, trip.t + (seconds * trip.speed) / trip.length);
          const [x, z] = walkPoint(trip.from, trip.to, trip.t);
          const [ax, az] = walkPoint(trip.from, trip.to, Math.min(1, trip.t + 0.02));
          if (Math.hypot(ax - x, az - z) > 1e-4) person.root.rotation.y = yawTowards(ax - x, az - z);
          person.root.position.set(x, 0, z);
          if (trip.t >= 1) {
            person.trip = null;
            person.root.rotation.y = person.face;
            this.settle(person);
            if (person.leaving) this.hide(person);
          }
        }
      }
      if (shadow < MAX_SHADOWS && !person.away) {
        const size = person.spec.scale * person.spec.girth;
        matrix.makeScale(size, 1, size).setPosition(person.root.position.x, 0.02, person.root.position.z);
        this.shadows.setMatrixAt(shadow++, matrix);
      }
    }
    this.shadows.count = shadow;
    this.shadows.instanceMatrix.needsUpdate = true;
    for (const rig of this.rigs.values()) {
      if (rig.users <= 0) continue;
      rig.mixer.update(seconds);
      rig.scene.updateMatrixWorld(true);
    }
  }

  /**
   * Sends a person out through the entrance (walking, unless motion is calm or `walk` is false) and out of sight:
   * the switch between all funds, the winners and the losers of a quarter.
   */
  leave(cik: number, walk: boolean): void {
    const person = this.people.get(cik);
    if (!person || person.away || person.leaving) return;
    if (!walk || this.calm) {
      person.trip = null;
      this.hide(person);
      return;
    }
    person.leaving = true;
    const current = { x: person.root.position.x, z: person.root.position.z, angle: Math.atan2(person.root.position.x, -person.root.position.z) };
    const length = walkLength(current, DOOR);
    person.trip = { from: current, to: DOOR, t: 0, speed: Math.min(6.5, Math.max(1.4, length / 5.5)), length: Math.max(0.01, length), wait: ((cik * 0.377) % 1) * 0.8 };
  }

  private hide(person: Person): void {
    person.leaving = false;
    person.away = true;
    person.root.visible = false;
    const index = this.pickers.indexOf(person.picker);
    if (index >= 0) this.pickers.splice(index, 1);
  }

  private show(person: Person): void {
    person.away = false;
    person.root.visible = true;
    if (!this.pickers.includes(person.picker)) this.pickers.push(person.picker);
  }

  /** The point above a person's head (labels, threads), or null. */
  headOf(cik: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const person = this.people.get(cik);
    if (!person || person.away) return null;
    return out.set(person.root.position.x, 1.92 * person.spec.scale, person.root.position.z);
  }

  /** Every person in the hall (not outside): its fund, the group that carries it, what it carries, and whether it is on its way. */
  forEachPresent(visit: (cik: number, root: THREE.Object3D, carry: Carry, moving: boolean) => void): void {
    for (const person of this.people.values()) if (!person.away) visit(person.spec.cik, person.root, person.spec.carry, Boolean(person.trip && person.trip.wait <= 0));
  }

  /** Standing at its place, in the hall: free to set off on a visit. */
  idle(cik: number): boolean {
    const person = this.people.get(cik);
    return Boolean(person && !person.trip && !person.away && !person.leaving);
  }

  /** People still on their way. */
  walking(): number {
    let count = 0;
    for (const person of this.people.values()) if (person.trip) count++;
    return count;
  }

  dispose(): void {
    for (const [cik, person] of [...this.people]) this.remove(cik, person);
    for (const rig of this.rigs.values()) rig.mixer.stopAllAction();
    this.rigs.clear();
    this.pickerGeometry.dispose();
    this.pickerMaterial.dispose();
    this.shadows.geometry.dispose();
    const material = this.shadows.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
  }
}
