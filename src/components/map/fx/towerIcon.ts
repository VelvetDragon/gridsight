/**
 * Hand-drawn lattice transmission tower icons, rasterised once into an atlas.
 *
 * Each frame is 40 x 80 design units (drawn at 2x), base at the bottom centre.
 * Two views per colour: "face" (cross-arms across the screen, line running
 * up/down) and "side" (arms towards the viewer, line running left/right).
 */

/** Conductor attachment points in tower heights: x from the centre, y above the base. */
export const PHASES: [number, number][] = [
  [-0.2, 0.5],
  [0, 0.5],
  [0.2, 0.5],
];
export const EARTH_WIRES: [number, number][] = [
  [-0.1375, 0.8875],
  [0.1375, 0.8875],
];

export const TOWER_STYLES = ["neutral", "desc", "gpc"] as const;
export type TowerStyle = (typeof TOWER_STYLES)[number];

const PALETTE: Record<TowerStyle, { leg: string; brace: string }> = {
  neutral: { leg: "#4E5664", brace: "#7D8594" },
  desc: { leg: "#0B6564", brace: "#3D9998" },
  gpc: { leg: "#A8380A", brace: "#D06A3E" },
};

const W = 40;
const H = 80;
const SCALE = 2;

type Seg = [number, number, number, number];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Point on a leg running from (x0, 80) at the base to (x1, 32) at the waist. */
function legX(x0: number, x1: number, y: number) {
  return lerp(x0, x1, (80 - y) / 48);
}

function lattice(l0: number, l1: number, r0: number, r1: number, levels: number[]): { legs: Seg[]; braces: Seg[] } {
  const legs: Seg[] = [
    [l0, 80, l1, 32],
    [r0, 80, r1, 32],
  ];
  const braces: Seg[] = [];
  for (let i = 0; i < levels.length; i++) {
    const y = levels[i];
    braces.push([legX(l0, l1, y), y, legX(r0, r1, y), y]);
    if (i > 0) {
      const yb = levels[i - 1];
      braces.push([legX(l0, l1, yb), yb, legX(r0, r1, y), y]);
      braces.push([legX(r0, r1, yb), yb, legX(l0, l1, y), y]);
    }
  }
  return { legs, braces };
}

function faceView(): { legs: Seg[]; braces: Seg[]; insulators: [number, number][] } {
  const { legs, braces } = lattice(8, 16.5, 32, 23.5, [80, 67, 56, 46, 38, 32]);
  // Cross-arm truss.
  legs.push([2, 31, 38, 31], [2, 31, 16.5, 25], [38, 31, 23.5, 25]);
  braces.push([9, 31, 11, 27.6], [9, 31, 16.5, 27.6], [31, 31, 29, 27.6], [31, 31, 23.5, 27.6]);
  // Peak with two earth-wire horns.
  legs.push([16.5, 25, 18, 14], [23.5, 25, 22, 14], [18, 14, 14.5, 9], [22, 14, 25.5, 9]);
  braces.push([16.5, 25, 22, 14], [23.5, 25, 18, 14], [18, 14, 22, 14], [17.2, 19.5, 22.8, 19.5]);
  return { legs, braces, insulators: [[4, 31], [20, 31], [36, 31]] };
}

function sideView(): { legs: Seg[]; braces: Seg[]; insulators: [number, number][] } {
  const { legs, braces } = lattice(13, 18, 27, 22, [80, 67, 56, 46, 38, 32]);
  legs.push([16, 31, 24, 31], [18, 32, 18, 14], [22, 32, 22, 14], [18, 14, 20, 9], [22, 14, 20, 9]);
  braces.push([18, 25, 22, 25], [18, 32, 22, 25], [22, 32, 18, 25], [18, 25, 22, 14], [22, 25, 18, 14], [18, 19.5, 22, 19.5]);
  return { legs, braces, insulators: [[20, 31]] };
}

function segPath(segs: Seg[]): string {
  return segs.map(([a, b, c, d]) => `M${a.toFixed(2)} ${b.toFixed(2)}L${c.toFixed(2)} ${d.toFixed(2)}`).join("");
}

function towerSvg(view: "face" | "side", style: TowerStyle, dx: number): string {
  const { legs, braces, insulators } = view === "face" ? faceView() : sideView();
  const c = PALETTE[style];
  const legD = segPath(legs);
  const braceD = segPath(braces);
  const ins = insulators
    .map(
      ([x, y]) =>
        `<path d="M${x} ${y}L${x} ${y + 9}" stroke="#2B3038" stroke-width="1.5"/>` +
        [2.5, 5, 7.5].map((o) => `<ellipse cx="${x}" cy="${y + o}" rx="1.9" ry="0.75" fill="#9AA4B2"/>`).join(""),
    )
    .join("");
  const halo = `<g stroke="#FAF8F4" stroke-opacity="0.9" stroke-linecap="round" stroke-width="4.6" fill="none"><path d="${legD}"/><path d="${braceD}" stroke-width="3"/></g>`;
  return (
    `<g transform="translate(${dx} 0)">${halo}` +
    `<path d="${braceD}" stroke="${c.brace}" stroke-width="1.25" stroke-linecap="round" fill="none"/>` +
    `<path d="${legD}" stroke="${c.leg}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    `${ins}</g>`
  );
}

export interface IconFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

/** Frame key: `${style}-${view}`. */
export const TOWER_ICON_MAPPING: Record<string, IconFrame> = {};
const frames: string[] = [];
TOWER_STYLES.forEach((style, si) => {
  (["face", "side"] as const).forEach((view, vi) => {
    const i = si * 2 + vi;
    frames.push(towerSvg(view, style, i * W));
    TOWER_ICON_MAPPING[`${style}-${view}`] = {
      x: i * W * SCALE,
      y: 0,
      width: W * SCALE,
      height: H * SCALE,
      anchorX: (W * SCALE) / 2,
      anchorY: H * SCALE,
    };
  });
});

const ATLAS_W = frames.length * W;
const ATLAS_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ATLAS_W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${ATLAS_W} ${H}">` +
  frames.join("") +
  `</svg>`;

let atlasPromise: Promise<HTMLCanvasElement> | null = null;

/** Rasterises the atlas once (client only). */
export function loadTowerAtlas(): Promise<HTMLCanvasElement> {
  if (!atlasPromise) {
    atlasPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = ATLAS_W * SCALE;
        canvas.height = H * SCALE;
        canvas.getContext("2d")?.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error("tower atlas failed to load"));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ATLAS_SVG)}`;
    });
  }
  return atlasPromise;
}
