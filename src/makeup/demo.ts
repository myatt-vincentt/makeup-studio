// Ready-made paint, for previewing without a finger: strokes drawn on the
// face seen straight on (cm) and area fills, gathered into three looks.
import {
  FACE_ATLAS_POLYLINES,
  faceAtlasAnchorPosition,
} from "@vincentt-xr/sdk/face-effects";

import { dabsAlong, polylineXY } from "./atlas";
import {
  BRUSH,
  FILL_FLOW,
  swatchHex,
  type BrushSize,
  type FillArea,
  type Finish,
} from "./palette";
import type { PaintBook, PaintOp } from "./paint";

type XY = [number, number];

/** Dab spacing, as a share of the brush radius. */
const SPACING = 0.22;

export const strokeOp = (
  path: XY[],
  size: BrushSize,
  color: string,
  finish: Finish,
  flow = BRUSH[size].flow,
): PaintOp => {
  const b = BRUSH[size];
  return {
    kind: "stroke",
    dabs: dabsAlong(path, Math.max(0.01, b.radius * SPACING)),
    radius: b.radius,
    hardness: b.hardness,
    color: swatchHex(color),
    finish,
    flow,
  };
};

export const fillOp = (
  area: FillArea,
  color: string,
  finish: Finish,
  flow = FILL_FLOW[area],
): PaintOp => ({
  kind: "fill",
  area,
  color: swatchHex(color),
  finish,
  flow,
});

/** A named face point on the canonical -X side (-1) or +X side (1). */
const anchor = (
  name: Parameters<typeof faceAtlasAnchorPosition>[0],
  side: 1 | -1,
): XY => {
  const [x, y] = faceAtlasAnchorPosition(name, side < 0 ? "negX" : "posX");
  return [x, y];
};

/** A smooth path through points (Catmull-Rom), `n` steps per span. */
const spline = (pts: XY[], n = 8): XY[] => {
  const out: XY[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k += 1) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + c) * t +
          (2 * a - 5 * b + 4 * c - d) * t2 +
          (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
};

/** Blush swept from the apple of the cheek up toward the cheekbone. */
export const blushStroke = (side: 1 | -1, color = "rose", flow?: number) => {
  const apple = anchor("cheekApple", side);
  const bone = anchor("cheekbone", side);
  const at = (f: number, lift: number): XY => [
    apple[0] + (bone[0] - apple[0]) * f,
    apple[1] + (bone[1] - apple[1]) * f + lift,
  ];
  return strokeOp(
    spline([at(0.05, -0.05), at(0.3, 0.12), at(0.5, 0.12)]),
    "l",
    color,
    "matte",
    flow,
  );
};

/** Liner along the upper lashes, inner to outer corner, with a flick. */
export const linerStroke = (side: 1 | -1, color = "black") => {
  // The lash polyline is the -X instance; mirror it for +X.
  const lash = polylineXY(FACE_ATLAS_POLYLINES.upperLash.points)
    .map(([x, y]): XY => [-x * side, y + 0.05])
    .reverse();
  const outer = lash[lash.length - 1];
  const wing: XY = [outer[0] + 0.65 * side, outer[1] + 0.3];
  return strokeOp(spline([...lash, wing], 4), "s", color, "matte");
};

/** A heart outline (cm across) centred at (cx, cy). */
export const heartPath = (cx: number, cy: number, size: number): XY[] => {
  const pts: XY[] = [];
  const k = size / 34;
  for (let i = 0; i <= 64; i += 1) {
    const t = (i / 64) * Math.PI * 2;
    pts.push([
      cx + k * 16 * Math.sin(t) ** 3,
      cy +
        k *
          (13 * Math.cos(t) -
            5 * Math.cos(2 * t) -
            2 * Math.cos(3 * t) -
            Math.cos(4 * t)),
    ]);
  }
  return pts;
};

/** A five-point star outline (cm across) centred at (cx, cy). */
export const starPath = (cx: number, cy: number, size: number): XY[] => {
  const pts: XY[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const r = (i % 2 === 0 ? 0.5 : 0.21) * size;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
};

/** A tiny closed loop: a painted dot. */
const dotPath = (cx: number, cy: number, r: number): XY[] =>
  Array.from({ length: 9 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as XY;
  });

export type LookName = "natural" | "bold" | "facePaint";
export const LOOK_NAMES: readonly LookName[] = ["natural", "bold", "facePaint"];

/** The three demo looks, as the paint each lays down. */
export const looks: Record<LookName, () => PaintOp[]> = {
  /** Everyday: a sheer blush wash and a soft rose lip tint. */
  natural: () => [
    fillOp("cheeks", "rose", "matte", 0.4),
    fillOp("lips", "rose", "satin", 0.45),
  ],
  /** Evening: shimmering bronze lids, a black winged liner, red lips built up twice. */
  bold: () => [
    fillOp("lids", "bronze", "shimmer", 0.85),
    linerStroke(-1),
    linerStroke(1),
    fillOp("lips", "red", "satin", 0.9),
    fillOp("lips", "red", "satin", 0.9),
    blushStroke(-1, "berry", 0.35),
    blushStroke(1, "berry", 0.35),
  ],
  /** Face paint: a pink heart, a gold star and a row of sky-blue dots. */
  facePaint: () => {
    const apple = anchor("cheekApple", -1);
    const bone = anchor("cheekbone", 1);
    const corner = anchor("outerEyeCorner", 1);
    const star: XY = [corner[0] + 0.6, corner[1] - 1.1];
    return [
      strokeOp(
        heartPath(apple[0] - 0.4, apple[1] + 0.3, 1.9),
        "m",
        "pink",
        "matte",
        1,
      ),
      strokeOp(starPath(star[0], star[1], 1.9), "m", "gold", "shimmer", 1),
      ...[0, 1, 2].map((i) =>
        strokeOp(
          dotPath(bone[0] - 2.1 + i * 0.65, bone[1] - 2 - i * 0.4, 0.12),
          "m",
          "sky",
          "matte",
          1,
        ),
      ),
    ];
  },
};

/** Paints a look on a clean face. */
export const paintLook = (book: PaintBook, name: LookName) => {
  book.clear();
  looks[name]().forEach((op) => book.apply(op));
};
