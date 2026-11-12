/**
 * Book spines: the company's logo on a badge at the head of the spine, its ticker in gilt capitals below it, and gilt
 * bands at the head and the foot. The tickers are painted once into one texture (a cell per book), the logos come from
 * a prepared atlas (public/desk-assets/library/logos); a small shader lays both over the spine face, so the books stay
 * one instanced draw and keep their own colour (the quarter's flow) underneath.
 */
import * as THREE from "three";

/** Cells of the ticker atlas: 32 across and 16 down, each 32×256 pixels (a spine standing upright). */
export const SPINE_ATLAS = { columns: 32, rows: 16, width: 32, height: 256 } as const;

/** The logo atlas's layout, as written by the logo build (atlas.json). */
export interface LogoAtlas { cell: number; columns: number; rows: number; tickers: Record<string, number> }

/** Where a cell sits in an atlas of `columns` × `rows`: column and row (row 0 at the bottom, as texture coordinates count). */
export function atlasCell(index: number, columns: number, rows: number): [number, number] {
  const cell = index % (columns * rows);
  return [cell % columns, rows - 1 - Math.floor(cell / columns)];
}

/** Paints the tickers into the atlas (white on transparent; the shader turns white into gilt), below the logo's place. */
export function spineAtlas(tickers: string[]): THREE.CanvasTexture {
  const { columns, rows, width, height } = SPINE_ATLAS;
  const canvas = document.createElement("canvas");
  canvas.width = columns * width;
  canvas.height = rows * height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  tickers.slice(0, columns * rows).forEach((ticker, index) => {
    const x = (index % columns) * width;
    const y = Math.floor(index / columns) * height;
    // gilt bands at the head and the foot
    context.fillRect(x + 3, y + 8, width - 6, 3);
    context.fillRect(x + 3, y + height - 11, width - 6, 3);
    context.fillRect(x + 3, y + height - 16, width - 6, 1.5);
    // the ticker reads upwards in the lower half of the spine (the logo has the upper part)
    context.save();
    context.translate(x + width / 2, y + height * 0.7);
    context.rotate(-Math.PI / 2);
    let size = 21;
    context.font = `700 ${size}px Cinzel, "Times New Roman", serif`;
    while (context.measureText(ticker).width > height * 0.46 && size > 9) {
      size -= 1;
      context.font = `700 ${size}px Cinzel, "Times New Roman", serif`;
    }
    context.fillText(ticker, 0, 1);
    context.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The material of the spine face. Per instance: `spine` (ticker cell: column, row), `logo` (logo cell: column, row,
 * and 1 when the company has a logo) and `shape` (the book's thickness over its height).
 */
export function spineMaterial(tickers: THREE.Texture, logos: THREE.Texture | null, logoAtlas: Pick<LogoAtlas, "columns" | "rows"> | null, base: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(base);
  const { columns, rows } = SPINE_ATLAS;
  const logoColumns = (logoAtlas?.columns ?? 1).toFixed(1);
  const logoRows = (logoAtlas?.rows ?? 1).toFixed(1);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSpines = { value: tickers };
    shader.uniforms.uLogos = { value: logos };
    shader.uniforms.uHasLogos = { value: logos ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 spine;\nattribute vec3 logo;\nattribute float shape;\nvarying vec2 vSpineUv;\nvarying vec2 vFaceUv;\nvarying vec3 vLogo;\nvarying float vShape;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvSpineUv = vec2((spine.x + uv.x) / ${columns.toFixed(1)}, (spine.y + uv.y) / ${rows.toFixed(1)});\nvFaceUv = uv;\nvLogo = logo;\nvShape = shape;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uSpines;\nuniform sampler2D uLogos;\nuniform float uHasLogos;\nvarying vec2 vSpineUv;\nvarying vec2 vFaceUv;\nvarying vec3 vLogo;\nvarying float vShape;")
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float gilt = texture2D(uSpines, vSpineUv).a;",
          "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.83, 0.66, 0.33), gilt * 0.92);",
          // the logo: a square at the head of the spine, as wide as the book, at most 40% of its height
          "if (uHasLogos > 0.5 && vLogo.z > 0.5) {",
          "  float side = min(vShape, 0.4);",
          "  float across = side / max(vShape, 0.0001);",
          "  float top = 0.955;",
          "  vec2 local = vec2((vFaceUv.x - 0.5) / across + 0.5, (vFaceUv.y - (top - side)) / side);",
          "  if (local.x > 0.04 && local.x < 0.96 && local.y > 0.04 && local.y < 0.96) {",
          `    vec4 badge = texture2D(uLogos, vec2((vLogo.x + local.x) / ${logoColumns}, (vLogo.y + local.y) / ${logoRows}));`,
          "    diffuseColor.rgb = mix(diffuseColor.rgb, badge.rgb, badge.a);",
          "  }",
          "}",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "hall-spine";
  return material;
}
