/**
 * The view through the entrance: Main Street at dusk, where the money from outside the covered stocks comes from and
 * goes to (other shares, bonds, cash; for many funds their clients' money, much of it ordinary savers'). Painted on a
 * canvas, lit softly so it does not outshine the hall, with a small panel of what came in and what went out.
 */
import * as THREE from "three";

export interface OutsideFlow { arrived: number; left: number; quarter: string }

const money = (value: number) => (Math.abs(value) >= 1e12 ? `$${(value / 1e12).toFixed(2)}T` : Math.abs(value) >= 1e9 ? `$${(value / 1e9).toFixed(1)}bn` : `$${(value / 1e6).toFixed(0)}m`);

/** A small deterministic sequence, so the street looks the same every time. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return state / 4294967296;
  };
}

export class MainStreet {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly dark: boolean;
  private street: ImageData | null = null;

  constructor(dark: boolean) {
    this.dark = dark;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 768;
    this.canvas.height = 1152;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.paintStreet();
    this.paint(null);
  }

  /** The street itself: sky, two rows of shopfronts in perspective, lamps, pavement, people. Painted once. */
  private paintStreet(): void {
    const context = this.canvas.getContext("2d")!;
    const { width, height } = this.canvas;
    const next = random(1792);
    const horizon = height * 0.56;
    const vanish = width / 2;
    // dusk sky
    const sky = context.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, this.dark ? "#141b2e" : "#4d6488");
    sky.addColorStop(0.65, this.dark ? "#3a3550" : "#c08a6a");
    sky.addColorStop(1, this.dark ? "#6b4a45" : "#e7b27f");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, horizon);
    // the street and pavements, converging on the vanishing point
    context.fillStyle = this.dark ? "#1f1d1c" : "#3b3733";
    context.beginPath();
    context.moveTo(vanish - 8, horizon);
    context.lineTo(vanish + 8, horizon);
    context.lineTo(width * 0.86, height);
    context.lineTo(width * 0.14, height);
    context.fill();
    context.fillStyle = this.dark ? "#2c2925" : "#5a544c";
    for (const side of [-1, 1]) {
      context.beginPath();
      context.moveTo(vanish + side * 8, horizon);
      context.lineTo(vanish + side * 30, horizon);
      context.lineTo(side < 0 ? 0 : width, height * 0.93);
      context.lineTo(side < 0 ? 0 : width, height);
      context.lineTo(side < 0 ? width * 0.14 : width * 0.86, height);
      context.fill();
    }
    // the centre line
    context.strokeStyle = "rgba(232, 196, 92, 0.7)";
    context.lineWidth = 3;
    context.setLineDash([22, 26]);
    context.beginPath();
    context.moveTo(vanish, horizon + 4);
    context.lineTo(vanish, height);
    context.stroke();
    context.setLineDash([]);
    // shopfronts on both sides: blocks that get smaller towards the horizon, lit windows, signs
    const palette = ["#7a4b3a", "#5d6b7a", "#8a7a5a", "#6b4f6a", "#4f6a5b", "#8c5f4a", "#59585f"];
    for (const side of [-1, 1]) {
      for (let block = 0; block < 9; block++) {
        const near = 1 - block / 9;
        const far = 1 - (block + 1) / 9;
        const edge = (t: number) => vanish + side * (30 + (width / 2 - 30) * t);
        const x0 = edge(far ** 1.6);
        const x1 = edge(near ** 1.6);
        const top0 = horizon - (height * 0.5) * far ** 1.6 * (0.7 + next() * 0.5);
        const top1 = horizon - (height * 0.5) * near ** 1.6 * (0.7 + next() * 0.3);
        const bottom0 = horizon + (height * 0.37) * far ** 1.6;
        const bottom1 = horizon + (height * 0.37) * near ** 1.6;
        context.fillStyle = palette[(block * 3 + (side > 0 ? 1 : 0)) % palette.length];
        context.beginPath();
        context.moveTo(x0, top0);
        context.lineTo(x1, top1);
        context.lineTo(x1, bottom1);
        context.lineTo(x0, bottom0);
        context.fill();
        // windows above, a lit shop window below
        for (let row = 0; row < 3; row++) {
          for (let column = 0; column < 2; column++) {
            if (next() < 0.25) continue;
            const t = 0.2 + column * 0.4;
            const wx = x0 + (x1 - x0) * t;
            const wTop = top0 + (top1 - top0) * t;
            const wBottom = bottom0 + (bottom1 - bottom0) * t;
            const y = wTop + (wBottom - wTop) * (0.12 + row * 0.16);
            const size = Math.abs(x1 - x0) * 0.22;
            context.fillStyle = next() < 0.7 ? "rgba(255, 214, 140, 0.85)" : "rgba(120, 150, 180, 0.6)";
            context.fillRect(wx, y, size, size * 1.3);
          }
        }
        const shopTop = top0 + (top1 - top0) * 0.5 + ((bottom0 + bottom1) / 2 - (top0 + top1) / 2) * 0.62;
        context.fillStyle = "rgba(255, 226, 170, 0.9)";
        context.fillRect(Math.min(x0, x1) + Math.abs(x1 - x0) * 0.1, shopTop, Math.abs(x1 - x0) * 0.8, ((bottom0 + bottom1) / 2 - shopTop) * 0.75);
        // a lamp post at the kerb
        if (block % 2 === 0) {
          const lx = x1 + side * -6;
          context.strokeStyle = "#1a1a1a";
          context.lineWidth = Math.max(1, 4 * near);
          context.beginPath();
          context.moveTo(lx, bottom1 + 10 * near);
          context.lineTo(lx, bottom1 - 160 * near ** 1.6);
          context.stroke();
          const glow = context.createRadialGradient(lx, bottom1 - 160 * near ** 1.6, 0, lx, bottom1 - 160 * near ** 1.6, 40 * near + 6);
          glow.addColorStop(0, "rgba(255, 220, 150, 0.95)");
          glow.addColorStop(1, "rgba(255, 220, 150, 0)");
          context.fillStyle = glow;
          context.fillRect(lx - 50, bottom1 - 210 * near ** 1.6, 100, 100);
        }
      }
    }
    // people walking on the pavements: small silhouettes
    for (let person = 0; person < 26; person++) {
      const depth = next() ** 1.3;
      const side = next() < 0.5 ? -1 : 1;
      const x = vanish + side * (40 + (width / 2 - 70) * depth) * (0.85 + next() * 0.2);
      const y = horizon + (height * 0.37) * depth + 6;
      const tall = 14 + 90 * depth;
      context.fillStyle = `rgba(${20 + Math.floor(next() * 40)}, ${20 + Math.floor(next() * 30)}, ${30 + Math.floor(next() * 40)}, 0.95)`;
      context.beginPath();
      context.ellipse(x, y - tall * 0.9, tall * 0.09, tall * 0.1, 0, 0, Math.PI * 2);
      context.fill();
      context.fillRect(x - tall * 0.11, y - tall * 0.8, tall * 0.22, tall * 0.5);
      context.fillRect(x - tall * 0.09, y - tall * 0.32, tall * 0.07, tall * 0.32);
      context.fillRect(x + tall * 0.02, y - tall * 0.32, tall * 0.07, tall * 0.32);
    }
    // the street sign
    context.fillStyle = "#1f5b3a";
    context.fillRect(width * 0.08, height * 0.62, 190, 46);
    context.strokeStyle = "#f4f1e6";
    context.lineWidth = 3;
    context.strokeRect(width * 0.08 + 4, height * 0.62 + 4, 182, 38);
    context.fillStyle = "#f4f1e6";
    context.font = "700 28px Arial, Helvetica, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("MAIN ST", width * 0.08 + 95, height * 0.62 + 24);
    context.strokeStyle = "#5a5a5a";
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(width * 0.08 + 95, height * 0.62 + 46);
    context.lineTo(width * 0.08 + 95, height);
    context.stroke();
    this.street = context.getImageData(0, 0, width, height);
  }

  /** Repaints the panel with the quarter's money from and to outside the covered stocks (null: none). */
  paint(flow: OutsideFlow | null): void {
    const context = this.canvas.getContext("2d")!;
    const { width, height } = this.canvas;
    if (this.street) context.putImageData(this.street, 0, 0);
    if (flow) {
      const x = width * 0.18;
      const y = height * 0.08;
      const w = width * 0.64;
      const h = 250;
      context.fillStyle = "rgba(14, 14, 18, 0.72)";
      context.beginPath();
      context.roundRect(x, y, w, h, 18);
      context.fill();
      context.strokeStyle = "rgba(201, 161, 79, 0.9)";
      context.lineWidth = 3;
      context.stroke();
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#e8d6a8";
      context.font = '600 30px Cinzel, "Times New Roman", serif';
      context.fillText("MAIN STREET", x + w / 2, y + 40);
      context.font = "500 19px Arial, Helvetica, sans-serif";
      context.fillStyle = "rgba(240, 236, 226, 0.85)";
      context.fillText(`and everything outside these stocks · ${flow.quarter}`, x + w / 2, y + 74);
      const most = Math.max(1, flow.arrived, flow.left);
      const bar = (label: string, value: number, row: number, colour: string) => {
        const top = y + 104 + row * 66;
        context.textAlign = "left";
        context.fillStyle = "rgba(240, 236, 226, 0.9)";
        context.font = "600 20px Arial, Helvetica, sans-serif";
        context.fillText(label, x + 24, top + 12);
        context.fillStyle = "rgba(255,255,255,0.12)";
        context.fillRect(x + 24, top + 28, w - 48, 18);
        context.fillStyle = colour;
        context.fillRect(x + 24, top + 28, (w - 48) * (value / most), 18);
        context.textAlign = "right";
        context.fillStyle = "#ffffff";
        context.fillText(money(value), x + w - 24, top + 12);
      };
      bar("came in from outside", flow.arrived, 0, "#5b8def");
      bar("went out", flow.left, 1, "#e5675f");
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
