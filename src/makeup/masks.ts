// The face areas a fill colours, as soft masks in the paint texture: lips,
// blush on the cheeks, shadow on the upper lids, a liner along the upper
// lashes with a small flick, and the brows. Each is described on the
// canonical face (cm) and rasterized once, both sides at a time.
import {
  FACE_ATLAS_POLYLINES,
  faceAtlasAnchorPosition,
  getFaceAtlasRegionTriangles,
} from "@vincentt-xr/sdk/face-effects";

import {
  blurMask,
  polylineDistance,
  polylineXY,
  polylineYAt,
  rasterizeField,
  smooth,
} from "./atlas";
import type { FillArea } from "./palette";

/** The upper lash line on the face's -X side, outer corner → inner corner. */
const UPPER_LASH = polylineXY(FACE_ATLAS_POLYLINES.upperLash.points);

/** Liner: half-widths (cm) at the outer and inner corner, and the flick. */
export const LINER = {
  outer: 0.17,
  inner: 0.05,
  /** Flick length (cm) and angle above the eye's corner line (degrees). */
  wing: 0.85,
  wingAngle: 20,
  /** Edge softness (cm). */
  feather: 0.015,
};

/** Liner strength at a point on the -X side (cm). */
const linerAt = (x: number, y: number) => {
  const { d, along } = polylineDistance(UPPER_LASH, x, y);
  const w = LINER.outer + (LINER.inner - LINER.outer) * along ** 0.7;
  // Above the lashes only: never under the outer corner.
  const lashY = polylineYAt(UPPER_LASH, x);
  const line =
    (1 - smooth(w - LINER.feather, w + LINER.feather, d)) *
    smooth(lashY - 0.06, lashY - 0.01, y);
  // The flick: from the outer corner, out and up, tapering to a point.
  const [ox, oy] = UPPER_LASH[0];
  const [ix, iy] = UPPER_LASH[UPPER_LASH.length - 1];
  const base = Math.atan2(oy - iy, ox - ix);
  // Outward is -X here, so "up" turns the direction clockwise.
  const a = base - (LINER.wingAngle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const t = Math.min(
    1,
    Math.max(0, ((x - ox) * dx + (y - oy) * dy) / LINER.wing),
  );
  const wd = Math.hypot(
    x - (ox + dx * LINER.wing * t),
    y - (oy + dy * LINER.wing * t),
  );
  const ww = LINER.outer * (1 - t) * 0.9;
  const wing =
    t > 0 ? 1 - smooth(ww - LINER.feather, ww + LINER.feather, wd) : 0;
  return Math.max(line, wing);
};

/** Upper-lid shadow strength at a point on the -X side (cm). */
const lidAt = (x: number, y: number, eyeRing: number) => {
  const lashY = polylineYAt(UPPER_LASH, x);
  const above = smooth(lashY - 0.08, lashY + 0.06, y);
  // Deepest at the lashes, blended out toward the brow and past the corners.
  const [ox] = UPPER_LASH[0];
  const [ix] = UPPER_LASH[UPPER_LASH.length - 1];
  const sides = smooth(ox - 1.1, ox - 0.1, x) * smooth(ix + 0.35, ix - 0.25, x);
  const up = 1 - smooth(0.5, 2.6, eyeRing);
  return above * sides * up * up;
};

/** Blush: a soft oval from the apple of the cheek up toward the cheekbone. */
const blushAt = (
  x: number,
  y: number,
  eyeRing: number,
  apple: ArrayLike<number>,
  cheekbone: ArrayLike<number>,
) => {
  const ax = cheekbone[0] - apple[0];
  const ay = cheekbone[1] - apple[1];
  const len = Math.hypot(ax, ay);
  const ux = ax / len;
  const uy = ay / len;
  const cx = apple[0] + ax * 0.3;
  const cy = apple[1] + ay * 0.3;
  const s = (x - cx) * ux + (y - cy) * uy;
  const t = -(x - cx) * uy + (y - cy) * ux;
  const r2 = (s / 2.2) ** 2 + (t / 1.35) ** 2;
  return Math.exp(-2.2 * r2) * smooth(1.8, 3.4, eyeRing);
};

/**
 * The mask of one fill area: `size`² bytes, row 0 at the top of the atlas,
 * 255 = full colour.
 */
export const fillMask = (area: FillArea, size: number): Uint8ClampedArray => {
  const px = size / 1024;
  switch (area) {
    case "lips":
      return blurMask(
        rasterizeField(
          size,
          { triangles: getFaceAtlasRegionTriangles("lips") },
          () => 1,
        ),
        size,
        Math.round(2 * px),
      );
    case "brows":
      return blurMask(
        rasterizeField(
          size,
          { triangles: getFaceAtlasRegionTriangles("brows") },
          () => 1,
        ),
        size,
        Math.round(4 * px),
      );
    case "lids":
      return rasterizeField(
        size,
        { triangles: getFaceAtlasRegionTriangles("lids") },
        (p) => lidAt(-Math.abs(p.x), p.y, p.eyeRing),
      );
    case "liner":
      return rasterizeField(
        size,
        {
          triangles: getFaceAtlasRegionTriangles("face"),
          box: { minAbsX: 1.5, maxAbsX: 5.6, minY: 2.1, maxY: 3.8 },
        },
        (p) => linerAt(-Math.abs(p.x), p.y),
      );
    case "cheeks": {
      const apple = faceAtlasAnchorPosition("cheekApple", "negX");
      const bone = faceAtlasAnchorPosition("cheekbone", "negX");
      return rasterizeField(
        size,
        {
          triangles: getFaceAtlasRegionTriangles("skin"),
          box: { minAbsX: 1.2, maxAbsX: 8, minY: -4.5, maxY: 2.6 },
        },
        (p) => blushAt(-Math.abs(p.x), p.y, p.eyeRing, apple, bone),
      );
    }
    default:
      return new Uint8ClampedArray(size * size);
  }
};
