/**
 * Under the dome: the unfinished pyramid of the Great Seal's reverse (as on the one-dollar bill), thirteen courses of
 * stone with the eye in a glowing capstone above it. The pyramid turns to face the reader wherever they stand, and the
 * eye looks straight at them. The seal is a public-domain design of the United States.
 */
import * as THREE from "three";

function eyeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext("2d")!;
  const centre = 512;
  // rays of glory round the capstone
  for (let ray = 0; ray < 48; ray++) {
    const angle = (ray / 48) * Math.PI * 2;
    const gradient = context.createLinearGradient(centre, centre, centre + Math.cos(angle) * 500, centre + Math.sin(angle) * 500);
    gradient.addColorStop(0, "rgba(255, 224, 140, 0.55)");
    gradient.addColorStop(1, "rgba(255, 224, 140, 0)");
    context.strokeStyle = gradient;
    context.lineWidth = ray % 2 ? 6 : 14;
    context.beginPath();
    context.moveTo(centre, centre + 40);
    context.lineTo(centre + Math.cos(angle) * 500, centre + 40 + Math.sin(angle) * 500);
    context.stroke();
  }
  // the triangle
  const top = 250;
  const bottom = 690;
  const half = (bottom - top) / Math.sqrt(3);
  const gold = context.createLinearGradient(0, top, 0, bottom);
  gold.addColorStop(0, "#fff0b8");
  gold.addColorStop(0.5, "#f1c75a");
  gold.addColorStop(1, "#c8942f");
  context.fillStyle = gold;
  context.strokeStyle = "#7a5a1c";
  context.lineWidth = 10;
  context.beginPath();
  context.moveTo(centre, top);
  context.lineTo(centre + half, bottom);
  context.lineTo(centre - half, bottom);
  context.closePath();
  context.fill();
  context.stroke();
  // the eye: almond, iris, pupil, a highlight, lashes of the engraving
  const eyeY = 540;
  context.fillStyle = "#fbf7ec";
  context.strokeStyle = "#3a2a10";
  context.lineWidth = 8;
  context.beginPath();
  context.moveTo(centre - 120, eyeY);
  context.quadraticCurveTo(centre, eyeY - 105, centre + 120, eyeY);
  context.quadraticCurveTo(centre, eyeY + 80, centre - 120, eyeY);
  context.closePath();
  context.fill();
  context.stroke();
  const iris = context.createRadialGradient(centre, eyeY - 4, 8, centre, eyeY - 4, 44);
  iris.addColorStop(0, "#5b7c8c");
  iris.addColorStop(1, "#22343d");
  context.fillStyle = iris;
  context.beginPath();
  context.arc(centre, eyeY - 4, 44, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#0b0b0b";
  context.beginPath();
  context.arc(centre, eyeY - 4, 19, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.9)";
  context.beginPath();
  context.arc(centre + 13, eyeY - 18, 8, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#3a2a10";
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(centre - 110, eyeY - 18);
  context.quadraticCurveTo(centre, eyeY - 132, centre + 110, eyeY - 18);
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function lettering(text: string, width: number, height: number, size: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#e9d49c";
  context.font = `600 ${size}px Cinzel, "Times New Roman", serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,0.6)";
  context.shadowBlur = 6;
  context.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Providence {
  readonly group = new THREE.Group();
  private readonly capstone: THREE.Mesh;
  private readonly textures: THREE.Texture[] = [];

  constructor(height: number) {
    this.group.position.set(0, height, 0);
    // thirteen courses of stone, the top course missing: an unfinished pyramid
    const stone = new THREE.MeshStandardMaterial({ color: 0xb59b72, roughness: 0.85 });
    const darker = new THREE.MeshStandardMaterial({ color: 0x9c8460, roughness: 0.9 });
    const base = 3.2;
    const top = 1.15;
    const courses = 13;
    const courseHeight = 0.19;
    for (let course = 0; course < courses; course++) {
      const width = base - ((base - top) * course) / (courses - 1);
      const block = new THREE.Mesh(new THREE.BoxGeometry(width, courseHeight * 0.94, width), course % 2 ? darker : stone);
      block.position.y = course * courseHeight + courseHeight / 2;
      this.group.add(block);
    }
    // the year on the base, the motto on a scroll below
    const year = lettering("MDCCLXXVI", 1024, 128, 92);
    const motto = lettering("NOVUS ORDO SECLORUM", 1536, 128, 84);
    const above = lettering("ANNUIT COEPTIS", 1536, 128, 92);
    this.textures.push(year, motto, above);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.32), new THREE.MeshBasicMaterial({ map: year, transparent: true, depthWrite: false }));
    plaque.position.set(0, 0.2, base / 2 + 0.02);
    this.group.add(plaque);
    const scroll = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.36), new THREE.MeshBasicMaterial({ map: motto, transparent: true, depthWrite: false }));
    scroll.position.set(0, -0.45, base / 2);
    this.group.add(scroll);
    // the capstone: the eye in its triangle, with the rays, floating over the missing top
    const eye = eyeTexture();
    this.textures.push(eye);
    this.capstone = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: eye, transparent: true, depthWrite: false, toneMapped: false }));
    this.capstone.position.y = courses * courseHeight + 1.35;
    this.group.add(this.capstone);
    const motto2 = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.38), new THREE.MeshBasicMaterial({ map: above, transparent: true, depthWrite: false }));
    motto2.position.y = courses * courseHeight + 3.25;
    this.capstone.add(motto2);
    motto2.position.set(0, 1.9, 0);
    const glow = new THREE.PointLight(0xffd98a, 6, 9, 1.8);
    glow.position.y = courses * courseHeight + 1.2;
    this.group.add(glow);
  }

  /** Turns the pyramid to face the reader and the eye to look straight at them. */
  watch(eye: THREE.Vector3): void {
    this.group.rotation.y = Math.atan2(eye.x - this.group.position.x, eye.z - this.group.position.z);
    this.group.updateMatrixWorld();
    this.capstone.lookAt(eye);
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | undefined;
      material?.dispose();
    });
    for (const texture of this.textures) texture.dispose();
  }
}
