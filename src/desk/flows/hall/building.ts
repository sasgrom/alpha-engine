/**
 * The building of the fund-flow hall: a rotunda in an old library's manner. Marble floor, oak-panelled walls with a
 * bookcase for every sector, marble columns on the piers, a gallery, tall arched windows, a coffered dome with an
 * oculus, and at the south a square-headed doorway onto Main Street, which stands for everything outside the
 * covered stocks. Geometry is built here from the layout; materials come from Poly Haven textures (CC0) when they
 * have loaded.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { polar, ROTUNDA, TWO_PI, type HallLayout } from "./layout";

/** The hall's outer wall, behind the bookcases, in metres from the middle of the floor. */
export const WALL_RADIUS = ROTUNDA.radius + ROTUNDA.bookDepth + 0.45;
/**
 * The doorway in the south wall (towards +z): its width and height, how deep the wall is there, and how far over its
 * head the middle of the Main Street plaque hangs (the streams of money from and to outside end just over it).
 */
export const DOORWAY = { width: 9, height: 6.6, depth: 0.7, plaqueAbove: 1.76 } as const;

export interface HallTextures {
  marbleTiles: THREE.Texture[];
  darkWood: THREE.Texture[];
  marble: THREE.Texture[];
  plaster: THREE.Texture[];
  leather: THREE.Texture[];
}

const BASE = "/desk-assets/library/textures/";

/** Loads the room's textures; each list is [colour, normal, ambient-occlusion/roughness/metal]. */
export function loadHallTextures(renderer: THREE.WebGLRenderer): Promise<HallTextures> {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (name: string, colour: boolean) =>
    new Promise<THREE.Texture>((resolve, reject) =>
      loader.load(
        BASE + name,
        (texture) => {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = anisotropy;
          if (colour) texture.colorSpace = THREE.SRGBColorSpace;
          resolve(texture);
        },
        undefined,
        reject,
      ),
    );
  const set = (stem: string, maps: ("diffuse" | "nor_gl" | "arm")[]) => Promise.all(maps.map((map) => load(`${stem}_${map}.webp`, map === "diffuse")));
  return Promise.all([
    set("marble_tiles", ["diffuse", "nor_gl", "arm"]),
    set("dark_paneled_wood", ["diffuse", "nor_gl", "arm"]),
    set("marble_01", ["diffuse", "nor_gl", "arm"]),
    set("plaster_grey_04", ["diffuse", "nor_gl"]),
    set("brown_leather", ["diffuse", "nor_gl"]),
  ]).then(([marbleTiles, darkWood, marble, plaster, leather]) => ({ marbleTiles, darkWood, marble, plaster, leather }));
}

function repeated(textures: THREE.Texture[], x: number, y: number): THREE.Texture[] {
  return textures.map((texture) => {
    const copy = texture.clone();
    copy.repeat.set(x, y);
    copy.needsUpdate = true;
    return copy;
  });
}

function material(textures: THREE.Texture[] | null, options: THREE.MeshStandardMaterialParameters, repeat: [number, number] = [1, 1]): THREE.MeshStandardMaterial {
  if (!textures) return new THREE.MeshStandardMaterial(options);
  const [map, normalMap, arm] = repeated(textures, repeat[0], repeat[1]);
  return new THREE.MeshStandardMaterial({ ...options, map, normalMap, ...(arm ? { aoMap: arm, roughnessMap: arm, metalnessMap: arm } : {}) });
}

// --- geometry helpers working in the hall's angles ---------------------------------------------------------------------
/** A curved wall from angle a0 to a1 at a radius, from y0 to y1, facing the centre (or away from it). */
export function arcWall(radius: number, a0: number, a1: number, y0: number, y1: number, facing: "in" | "out" = "in", segments = Math.max(4, Math.ceil(((a1 - a0) * radius) / 1.2))): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = a0 + ((a1 - a0) * index) / segments;
    const [x, , z] = polar(angle, radius);
    const sign = facing === "in" ? -1 : 1;
    for (const y of [y0, y1]) {
      positions.push(x, y, z);
      normals.push(sign * Math.sin(angle), 0, -sign * Math.cos(angle));
      uvs.push(index / segments, y === y0 ? 0 : 1);
    }
  }
  for (let index = 0; index < segments; index++) {
    const b0 = index * 2;
    const t0 = b0 + 1;
    const b1 = b0 + 2;
    const t1 = b0 + 3;
    if (facing === "in") indices.push(b0, b1, t0, t0, b1, t1);
    else indices.push(b0, t0, b1, t0, t1, b1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv1", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** A flat ring segment at height y between two radii, facing up (or down). UVs follow the room's x and z. */
export function arcRing(r0: number, r1: number, a0: number, a1: number, y: number, facing: "up" | "down" = "up", tile = 1): THREE.BufferGeometry {
  const segments = Math.max(8, Math.ceil(((a1 - a0) * r1) / 1.0));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = a0 + ((a1 - a0) * index) / segments;
    for (const r of [r0, r1]) {
      const [x, , z] = polar(angle, r);
      positions.push(x, y, z);
      uvs.push(x / tile, z / tile);
    }
  }
  for (let index = 0; index < segments; index++) {
    const i0 = index * 2;
    const o0 = i0 + 1;
    const i1 = i0 + 2;
    const o1 = i0 + 3;
    if (facing === "up") indices.push(i0, o0, i1, i1, o0, o1);
    else indices.push(i0, i1, o0, i1, o1, o0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv1", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // the winding above faces the side asked for; make sure of it
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  if ((facing === "up" ? 1 : -1) * normal.getY(0) < 0) {
    for (let index = 0; index < normal.count; index++) normal.setY(index, -normal.getY(index));
  }
  return geometry;
}

// --- signs ------------------------------------------------------------------------------------------------------------------
export interface SignPainter {
  texture: THREE.CanvasTexture;
  /** Paints the sector's name; called again once the carved-letter font has loaded. */
  paint: () => void;
}

/** The carved sign over a bookcase: gilt Roman capitals on dark oak, the width of the bookcase. */
export function sectorSign(sector: string, widthMetres: number): SignPainter {
  const canvas = document.createElement("canvas");
  const height = 128;
  canvas.width = Math.min(2048, Math.max(512, Math.round((widthMetres / 0.9) * height)));
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const paint = () => {
    const context = canvas.getContext("2d")!;
    const wood = context.createLinearGradient(0, 0, 0, height);
    wood.addColorStop(0, "#2d1d12");
    wood.addColorStop(0.5, "#3b2717");
    wood.addColorStop(1, "#24170e");
    context.fillStyle = wood;
    context.fillRect(0, 0, canvas.width, height);
    // a gilt rule top and bottom
    context.fillStyle = "#b8924a";
    context.fillRect(0, 6, canvas.width, 3);
    context.fillRect(0, height - 9, canvas.width, 3);
    const label = sector.toUpperCase();
    let size = 64;
    context.font = `600 ${size}px Cinzel, "Times New Roman", serif`;
    while (context.measureText(label).width > canvas.width - 48 && size > 22) {
      size -= 2;
      context.font = `600 ${size}px Cinzel, "Times New Roman", serif`;
    }
    const gilt = context.createLinearGradient(0, height / 2 - size / 2, 0, height / 2 + size / 2);
    gilt.addColorStop(0, "#f3dfa2");
    gilt.addColorStop(0.55, "#c9a14f");
    gilt.addColorStop(1, "#8a6a2c");
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "rgba(0,0,0,0.6)";
    context.shadowBlur = 4;
    context.shadowOffsetY = 2;
    context.fillStyle = gilt;
    context.fillText(label, canvas.width / 2, height / 2 + 4);
    texture.needsUpdate = true;
  };
  paint();
  return { texture, paint };
}

// --- the building -----------------------------------------------------------------------------------------------------------
export interface HallBuilding {
  group: THREE.Group;
  /** Invisible panes over the bookcases for pointing (userData.sector). */
  panes: THREE.Mesh[];
  /** An invisible pane across the doorway (pointing at it names "outside the covered stocks"). */
  door: THREE.Mesh;
  signs: SignPainter[];
  /** Where streams of money start and end: over the middle of each bookcase, and in the entrance. */
  anchors: Map<string, THREE.Vector3>;
}

export function buildHall(layout: HallLayout, textures: HallTextures | null, dark: boolean): HallBuilding {
  const group = new THREE.Group();
  const { radius, galleryHeight, wallTop, domeHeight, floorRadius, entranceHalf, rows, rowHeight, shelfBase, bookDepth } = ROTUNDA;
  const wallRadius = WALL_RADIUS;
  const wallStart = -Math.PI + entranceHalf;
  const wallEnd = Math.PI - entranceHalf;

  // materials
  // light veined marble in large squares; a soft normal and a fairly rough finish, so it does not sparkle at a distance
  const floor = material(textures?.marble ?? null, { color: dark ? 0xbdb7ab : 0xf3eee4, roughness: 0.62, normalScale: new THREE.Vector2(0.25, 0.25) }, [1, 1]);
  const wood = material(textures?.darkWood ?? null, { color: dark ? 0x8a7a68 : 0xa08a72, roughness: 0.62 }, [1, 1]);
  const woodPlain = new THREE.MeshStandardMaterial({ color: dark ? 0x2b2018 : 0x4a3727, roughness: 0.55, metalness: 0.05 });
  const marble = material(textures?.marble ?? null, { color: dark ? 0xc9c4ba : 0xe2ddd2, roughness: 0.38 }, [1, 2]);
  const plaster = material(textures?.plaster ?? null, { color: dark ? 0x86817a : 0xd6cfc1, roughness: 0.9 }, [8, 2]);
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 0.85, roughness: 0.32 });

  // floor: marble squares of 2.5 m (one repeat of the texture each, its seams under the grout), a dark ring under the map table
  {
    const square = 2.5;
    const across = 2 * (floorRadius + 1.5);
    const geometry = new THREE.CircleGeometry(floorRadius + 1.5, 128);
    geometry.rotateX(-Math.PI / 2);
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let index = 0; index < uv.count; index++) uv.setXY(index, (uv.getX(index) - 0.5) * (across / square), (uv.getY(index) - 0.5) * (across / square));
    geometry.setAttribute("uv1", uv.clone());
    const mesh = new THREE.Mesh(geometry, floor);
    mesh.receiveShadow = true;
    group.add(mesh);
    // thin grout strips between the squares, as far as the floor reaches
    const strips: THREE.BufferGeometry[] = [];
    const reach = floorRadius + 1.5;
    for (let offset = -Math.floor(reach / square) * square; offset <= reach; offset += square) {
      const half = Math.sqrt(Math.max(0, reach * reach - offset * offset));
      if (half < 0.5) continue;
      strips.push(new THREE.PlaneGeometry(2 * half, 0.035).rotateX(-Math.PI / 2).translate(0, 0.004, offset));
      strips.push(new THREE.PlaneGeometry(0.035, 2 * half).rotateX(-Math.PI / 2).translate(offset, 0.004, 0));
    }
    const grout = new THREE.Mesh(mergeGeometries(strips, false)!, new THREE.MeshStandardMaterial({ color: dark ? 0x4a453f : 0x9c958a, roughness: 0.9 }));
    grout.receiveShadow = true;
    group.add(grout);
    const inlay = new THREE.Mesh(arcRing(ROTUNDA.mapRadius + 0.4, ROTUNDA.mapRadius + 1.1, 0, TWO_PI, 0.012), new THREE.MeshStandardMaterial({ color: dark ? 0x3a2f27 : 0x5b4636, roughness: 0.4 }));
    inlay.receiveShadow = true;
    group.add(inlay);
    const band = new THREE.Mesh(arcRing(ROTUNDA.crowdInner - 0.6, ROTUNDA.crowdInner - 0.4, 0, TWO_PI, 0.012), brass);
    group.add(band);
  }

  // the lower wall behind the bookcases, panelled, with the opening of the entrance
  {
    const geometry = arcWall(wallRadius, wallStart, wallEnd, 0, galleryHeight, "in");
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    const around = ((wallEnd - wallStart) * wallRadius) / 3.2;
    for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * around, uv.getY(index) * (galleryHeight / 3.2));
    geometry.setAttribute("uv1", uv.clone());
    const mesh = new THREE.Mesh(geometry, wood);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // bookcases: back, shelves, uprights at both ends, a cornice and the carved sign
  const signs: SignPainter[] = [];
  const panes: THREE.Mesh[] = [];
  const anchors = new Map<string, THREE.Vector3>();
  const caseTop = shelfBase + rows * rowHeight;
  for (const alcove of layout.alcoves) {
    const back = new THREE.Mesh(arcWall(radius + bookDepth + 0.05, alcove.start, alcove.end, 0, caseTop + 0.3, "in"), woodPlain);
    back.receiveShadow = true;
    group.add(back);
    for (let row = 0; row <= rows; row++) {
      const y = shelfBase + row * rowHeight - 0.04;
      const board = new THREE.Mesh(arcRing(radius - 0.05, radius + bookDepth + 0.05, alcove.start, alcove.end, y, "up"), woodPlain);
      board.receiveShadow = true;
      group.add(board);
      const edge = new THREE.Mesh(arcWall(radius - 0.05, alcove.start, alcove.end, y - 0.07, y, "in"), woodPlain);
      group.add(edge);
    }
    // a plinth under the lowest shelf
    group.add(new THREE.Mesh(arcWall(radius - 0.05, alcove.start, alcove.end, 0, shelfBase - 0.11, "in"), woodPlain));
    for (const angle of [alcove.start, alcove.end]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.16, caseTop + 0.4, bookDepth + 0.2), woodPlain);
      const [x, , z] = polar(angle, radius + bookDepth / 2);
      upright.position.set(x, (caseTop + 0.4) / 2, z);
      upright.rotation.y = -angle;
      upright.castShadow = true;
      group.add(upright);
    }
    const cornice = new THREE.Mesh(arcRing(radius - 0.25, radius + bookDepth + 0.1, alcove.start - 0.004, alcove.end + 0.004, caseTop + 0.32, "up"), woodPlain);
    group.add(cornice);
    // the sign, set a little forward of the bookcase above its top
    const sign = sectorSign(alcove.sector, alcove.width);
    signs.push(sign);
    const signMesh = new THREE.Mesh(arcWall(radius - 0.12, alcove.start + 0.002, alcove.end - 0.002, caseTop + 0.42, caseTop + 1.22, "in"), new THREE.MeshStandardMaterial({ map: sign.texture, roughness: 0.5, metalness: 0.1 }));
    group.add(signMesh);
    // a pane over the whole bookcase for pointing
    const pane = new THREE.Mesh(arcWall(radius - 0.2, alcove.start, alcove.end, 0, caseTop + 1.3, "in"), new THREE.MeshBasicMaterial({ visible: false }));
    pane.userData.sector = alcove.sector;
    panes.push(pane);
    group.add(pane);
    anchors.set(alcove.sector, new THREE.Vector3(...polar(alcove.mid, radius - 0.6, caseTop + 1.0)));
  }

  // piers: a marble column at each side of every bookcase, and panelling between
  const columnGeometry = new THREE.CylinderGeometry(0.42, 0.48, galleryHeight - 0.6, 24);
  const baseGeometry = new THREE.BoxGeometry(1.2, 0.5, 1.2);
  const capitalGeometry = new THREE.BoxGeometry(1.15, 0.35, 1.15);
  const columnAngles = new Set<number>();
  for (const alcove of layout.alcoves) {
    columnAngles.add(alcove.start - 0.55 / radius);
    columnAngles.add(alcove.end + 0.55 / radius);
  }
  for (const angle of columnAngles) {
    const [x, , z] = polar(angle, radius - 0.35);
    const column = new THREE.Mesh(columnGeometry, marble);
    column.position.set(x, (galleryHeight - 0.6) / 2 + 0.5, z);
    column.castShadow = true;
    column.receiveShadow = true;
    group.add(column);
    const base = new THREE.Mesh(baseGeometry, marble);
    base.position.set(x, 0.25, z);
    base.rotation.y = -angle;
    group.add(base);
    const capital = new THREE.Mesh(capitalGeometry, marble);
    capital.position.set(x, galleryHeight - 0.1 + 0.175 - 0.6 + 0.5 - 0.05, z);
    capital.rotation.y = -angle;
    group.add(capital);
  }

  // the gallery: a floor ring, its fascia, a brass rail on balusters
  {
    const inner = radius - 1.9;
    const gallery = new THREE.Mesh(arcRing(inner, wallRadius, wallStart, wallEnd, galleryHeight, "up"), woodPlain);
    gallery.receiveShadow = true;
    group.add(gallery);
    group.add(new THREE.Mesh(arcRing(inner, wallRadius, wallStart, wallEnd, galleryHeight - 0.55, "down"), woodPlain));
    group.add(new THREE.Mesh(arcWall(inner, wallStart, wallEnd, galleryHeight - 0.55, galleryHeight, "in"), wood));
    const railRadius = inner + 0.12;
    const rail = new THREE.Mesh(arcWall(railRadius, wallStart, wallEnd, galleryHeight + 1.02, galleryHeight + 1.1, "in"), brass);
    group.add(rail);
    const count = Math.floor(((wallEnd - wallStart) * railRadius) / 0.32);
    const baluster = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.05, 1.02, 8), marble, count);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < count; index++) {
      const angle = wallStart + ((index + 0.5) / count) * (wallEnd - wallStart);
      const [x, , z] = polar(angle, railRadius);
      matrix.makeTranslation(x, galleryHeight + 0.51, z);
      baluster.setMatrixAt(index, matrix);
    }
    group.add(baluster);
    // the gallery's own wall, panelled up to the windows
    group.add(new THREE.Mesh(arcWall(wallRadius, wallStart, wallEnd, galleryHeight, galleryHeight + 3.4, "in"), wood));
  }

  // the upper wall in plaster with tall arched windows over the piers
  {
    const upper = arcWall(wallRadius, -Math.PI, Math.PI, galleryHeight + 3.4, wallTop, "in", 160);
    group.add(new THREE.Mesh(upper, plaster));
    const lower = arcWall(wallRadius + 0.02, wallEnd, wallStart + TWO_PI, galleryHeight, galleryHeight + 3.4, "in", 12);
    group.add(new THREE.Mesh(lower, plaster));
    const glass = new THREE.MeshBasicMaterial({ color: dark ? 0x26324a : 0xc9d3dd, fog: false });
    const frame = new THREE.MeshStandardMaterial({ color: dark ? 0x3a3128 : 0xcfc5b3, roughness: 0.6 });
    const windowShape = (width: number, height: number) => {
      const shape = new THREE.Shape();
      shape.moveTo(-width / 2, 0);
      shape.lineTo(width / 2, 0);
      shape.lineTo(width / 2, height - width / 2);
      shape.absarc(0, height - width / 2, width / 2, 0, Math.PI, false);
      shape.lineTo(-width / 2, 0);
      return shape;
    };
    const windowAngles = layout.piers.map((pier) => (pier.start + pier.end) / 2);
    for (const alcove of layout.alcoves) if (alcove.width > 9) windowAngles.push(alcove.mid);
    windowAngles.push(Math.PI); // over the entrance
    for (const angle of windowAngles) {
      const width = 2.6;
      const height = wallTop - galleryHeight - 4.6;
      const pane = new THREE.Mesh(new THREE.ShapeGeometry(windowShape(width, height), 16), glass);
      const [x, , z] = polar(angle, wallRadius - 0.04);
      pane.position.set(x, galleryHeight + 3.9, z);
      pane.rotation.y = -angle; // the shape's front (+z) faces the centre
      group.add(pane);
      const surround = new THREE.Mesh(new THREE.ShapeGeometry(windowShape(width + 0.5, height + 0.25), 16), frame);
      surround.position.set(...polar(angle, wallRadius - 0.02, galleryHeight + 3.78));
      surround.rotation.y = -angle;
      group.add(surround);
      // mullions
      for (const offset of [-width / 6, width / 6]) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, height - 0.2, 0.06), frame);
        const along = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(offset);
        mullion.position.set(x + along.x, galleryHeight + 3.9 + (height - 0.2) / 2, z + along.z);
        mullion.rotation.y = -angle;
        group.add(mullion);
      }
    }
  }

  // cornice, dome with coffers, oculus
  {
    const cornice = new THREE.Mesh(new THREE.TorusGeometry(wallRadius - 0.15, 0.32, 10, 160), marble);
    cornice.rotation.x = Math.PI / 2;
    cornice.position.y = wallTop;
    group.add(cornice);
    const dome = new THREE.SphereGeometry(wallRadius, 96, 32, 0, TWO_PI, 0.12, Math.PI / 2 - 0.12);
    dome.scale(1, domeHeight / wallRadius, 1);
    const coffers = cofferTexture(dark);
    const domeMaterial = new THREE.MeshStandardMaterial({ map: coffers, color: 0xffffff, roughness: 0.85, side: THREE.BackSide, normalMap: textures?.plaster[1] ?? null });
    const domeMesh = new THREE.Mesh(dome, domeMaterial);
    domeMesh.position.y = wallTop;
    group.add(domeMesh);
    const oculusRadius = Math.sin(0.12) * wallRadius;
    const oculus = new THREE.Mesh(new THREE.CircleGeometry(oculusRadius, 48), new THREE.MeshBasicMaterial({ color: dark ? 0x31405e : 0xffffff, fog: false }));
    oculus.rotation.x = Math.PI / 2;
    oculus.position.y = wallTop + domeHeight * Math.cos(0.12) + 0.05;
    group.add(oculus);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(oculusRadius, 0.18, 8, 48), brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = oculus.position.y - 0.05;
    group.add(ring);
  }

  // the entrance: a tall square-headed doorway in the panelled wall, framed in dark wood with a brass bead, open
  // onto Main Street (the stage builds the street beyond it)
  const doorAngle = Math.PI;
  const { width: doorWidth, height: doorHeight, depth: doorDepth } = DOORWAY;
  const edge = Math.asin(doorWidth / 2 / wallRadius);
  const panelled = (a0: number, a1: number, y0: number, y1: number) => {
    const geometry = arcWall(wallRadius, a0, a1, y0, y1, "in");
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let index = 0; index < uv.count; index++) uv.setXY(index, (uv.getX(index) * (a1 - a0) * wallRadius) / 3.2, (y0 + uv.getY(index) * (y1 - y0)) / 3.2);
    geometry.setAttribute("uv1", uv.clone());
    const mesh = new THREE.Mesh(geometry, wood);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  // the wall either side of the doorway and over it, up to the gallery
  panelled(wallEnd, doorAngle - edge, 0, galleryHeight);
  panelled(doorAngle + edge, wallStart + TWO_PI, 0, galleryHeight);
  panelled(doorAngle - edge, doorAngle + edge, doorHeight, galleryHeight);
  // the reveal: jambs and the soffit of the lintel, as deep as the wall is thick
  const wallZ = wallRadius * Math.cos(edge);
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.5, doorHeight, doorDepth + 0.1), woodPlain);
    jamb.position.set(side * (doorWidth / 2 + 0.25), doorHeight / 2, wallZ + doorDepth / 2 - 0.05);
    group.add(jamb);
  }
  group.add(new THREE.Mesh(arcRing(wallRadius - 0.05, wallRadius + doorDepth, doorAngle - edge, doorAngle + edge, doorHeight, "down"), woodPlain));
  // the architrave round the opening and a cornice over it, standing a little out from the wall, a brass bead inside
  const trim = 0.42;
  const out = 0.14;
  for (const side of [-1, 1]) {
    const x = side * (doorWidth / 2 + trim / 2);
    const post = new THREE.Mesh(new THREE.BoxGeometry(trim, doorHeight + trim, 0.22), woodPlain);
    post.position.set(x, (doorHeight + trim) / 2, Math.sqrt(wallRadius ** 2 - x * x) - out + 0.11);
    group.add(post);
    const bead = new THREE.Mesh(new THREE.BoxGeometry(0.05, doorHeight, 0.05), brass);
    bead.position.set(side * (doorWidth / 2 + 0.04), doorHeight / 2, Math.sqrt(wallRadius ** 2 - (doorWidth / 2) ** 2) - out - 0.01);
    group.add(bead);
  }
  const head = edge + trim / wallRadius;
  group.add(new THREE.Mesh(arcWall(wallRadius - out, doorAngle - head, doorAngle + head, doorHeight, doorHeight + trim, "in"), woodPlain));
  group.add(new THREE.Mesh(arcRing(wallRadius - out, wallRadius, doorAngle - head, doorAngle + head, doorHeight, "down"), woodPlain));
  group.add(new THREE.Mesh(arcWall(wallRadius - out - 0.01, doorAngle - edge, doorAngle + edge, doorHeight - 0.05, doorHeight, "in"), brass));
  const corniceTop = doorHeight + trim + 0.22;
  const ledge = edge + (trim + 0.25) / wallRadius;
  group.add(new THREE.Mesh(arcWall(wallRadius - out - 0.2, doorAngle - ledge, doorAngle + ledge, doorHeight + trim, corniceTop, "in"), woodPlain));
  group.add(new THREE.Mesh(arcRing(wallRadius - out - 0.2, wallRadius, doorAngle - ledge, doorAngle + ledge, corniceTop, "up"), woodPlain));
  group.add(new THREE.Mesh(arcRing(wallRadius - out - 0.2, wallRadius, doorAngle - ledge, doorAngle + ledge, doorHeight + trim, "down"), woodPlain));
  // a pane across the far end of the opening for pointing ("outside the covered stocks")
  const door = new THREE.Mesh(arcWall(wallRadius + doorDepth, doorAngle - edge, doorAngle + edge, 0, doorHeight, "in"), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(door);
  // the streams from and to outside meet just over the Main Street plaque, leaving its figures and the street clear
  anchors.set("Outside", new THREE.Vector3(...polar(doorAngle, wallRadius - 0.5, doorHeight + DOORWAY.plaqueAbove + 1.25)));

  mergeStatic(group, new Set<THREE.Object3D>([door, ...panes]));
  return { group, panes, door, signs, anchors };
}

/**
 * Joins the building's pieces that share a material (and whether they cast shadows) into one mesh each: a few
 * dozen draw calls instead of several hundred. The pointing panes, the door and the instanced balusters stay apart.
 */
function mergeStatic(group: THREE.Group, keep: Set<THREE.Object3D>): void {
  group.updateMatrixWorld(true);
  const sets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; meshes: THREE.Mesh[] }>();
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || keep.has(mesh) || Array.isArray(mesh.material) || !mesh.geometry.index) return;
    const key = `${mesh.material.uuid}|${mesh.castShadow}`;
    const entry = sets.get(key) ?? sets.set(key, { material: mesh.material, cast: mesh.castShadow, receive: false, meshes: [] }).get(key)!;
    entry.receive ||= mesh.receiveShadow;
    entry.meshes.push(mesh);
  });
  for (const { material, cast, receive, meshes } of sets.values()) {
    if (meshes.length < 2) continue;
    // the same attributes on every piece: position, normal and the first texture coordinates
    const geometries = meshes.map((mesh) => {
      const geometry = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv"]) {
        const attribute = mesh.geometry.getAttribute(name);
        geometry.setAttribute(name, attribute ? attribute.clone() : new THREE.BufferAttribute(new Float32Array(mesh.geometry.getAttribute("position").count * (name === "uv" ? 2 : 3)), name === "uv" ? 2 : 3));
      }
      geometry.setIndex(mesh.geometry.index!.clone());
      geometry.applyMatrix4(mesh.matrixWorld);
      return geometry;
    });
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    const joined = new THREE.Mesh(merged, material);
    joined.castShadow = cast;
    joined.receiveShadow = receive;
    joined.matrixAutoUpdate = false;
    for (const mesh of meshes) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
    }
    group.add(joined);
  }
}

/** A coffered ceiling painted on a canvas: rows of recessed squares with gilt rosettes, lighter towards the top. */
function cofferTexture(dark: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const base = dark ? "#5a554c" : "#efe8da";
  const shade = dark ? "#3c3832" : "#d9cfbc";
  const deep = dark ? "#2c2925" : "#c6baa3";
  context.fillStyle = base;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const columns = 32;
  const rowsCount = 6;
  const cell = canvas.width / columns;
  const rowHeight = canvas.height / rowsCount;
  for (let row = 0; row < rowsCount; row++) {
    for (let column = 0; column < columns; column++) {
      const x = column * cell;
      const y = row * rowHeight;
      const inset = Math.min(cell, rowHeight) * 0.14;
      context.fillStyle = shade;
      context.fillRect(x + inset, y + inset, cell - 2 * inset, rowHeight - 2 * inset);
      context.fillStyle = deep;
      context.fillRect(x + inset * 2, y + inset * 2, cell - 4 * inset, rowHeight - 4 * inset);
      context.fillStyle = "#b8924a";
      context.beginPath();
      context.arc(x + cell / 2, y + rowHeight / 2, Math.min(cell, rowHeight) * 0.09, 0, TWO_PI);
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
