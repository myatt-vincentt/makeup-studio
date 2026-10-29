// The face atlas as plain geometry: where a point on the face lands in the
// paint texture, how big a brush dab is there, and a rasterizer that paints a
// shape described on the face (in canonical centimetres) into the texture.
//
// Paint lives in one square texture laid out like the SDK's face atlas
// (FACE_ATLAS_UVS). Image row 0 is the top of the atlas (the forehead, v = 1),
// as in a canvas. Every shape here is described on the canonical face: x to
// the face's -X side is negative, +Y up, +Z out of the face, in centimetres.
import {
  FACE_ATLAS_TRIANGLES,
  FACE_ATLAS_UVS,
  getFaceAtlasAttributes,
} from "@vincentt-xr/sdk/face-effects";

/** The rest position, uv and feature distances of one landmark. */
const attrs = getFaceAtlasAttributes();
const REST = attrs.restPosition;
const { eyeRing: EYE_RING, lipEdge: LIP_EDGE } = attrs;
const UV = FACE_ATLAS_UVS;
const TRI = FACE_ATLAS_TRIANGLES;
const TRI_COUNT = TRI.length / 3;

/** A point on the atlas mesh: a triangle and its barycentric weights. */
export type SurfaceHit = { tri: number; b0: number; b1: number; b2: number };

/** 2×2 matrix, row-major: [a, b, c, d] maps (s, t) to (a·s + b·t, c·s + d·t). */
export type Mat2 = [number, number, number, number];

/** A brush dab placed on the face: its atlas uv and the local cm → uv map. */
export type Dab = { u: number; v: number; jac: Mat2 };

const corner = (tri: number, k: number) => TRI[tri * 3 + k];

/** The atlas uv of a point on the mesh. */
export const hitUv = (hit: SurfaceHit): [number, number] => {
  const i0 = corner(hit.tri, 0);
  const i1 = corner(hit.tri, 1);
  const i2 = corner(hit.tri, 2);
  return [
    UV[i0 * 2] * hit.b0 + UV[i1 * 2] * hit.b1 + UV[i2 * 2] * hit.b2,
    UV[i0 * 2 + 1] * hit.b0 + UV[i1 * 2 + 1] * hit.b1 + UV[i2 * 2 + 1] * hit.b2,
  ];
};

/**
 * How the atlas stretches on one triangle: the matrix taking centimetres on
 * the face surface (s along the face's +X as seen in the triangle, t at a
 * right angle to it, toward +Y) to atlas uv. A round dab of radius r cm is the
 * ellipse `jac · circle(r)` in the atlas.
 */
export const triangleJacobian = (tri: number): Mat2 => {
  const i0 = corner(tri, 0);
  const i1 = corner(tri, 1);
  const i2 = corner(tri, 2);
  const p = (i: number, k: number) => REST[i * 3 + k];
  const e1 = [p(i1, 0) - p(i0, 0), p(i1, 1) - p(i0, 1), p(i1, 2) - p(i0, 2)];
  const e2 = [p(i2, 0) - p(i0, 0), p(i2, 1) - p(i0, 1), p(i2, 2) - p(i0, 2)];
  // Normal, then a tangent frame: +X projected into the plane, and n × that.
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  n[0] /= nl;
  n[1] /= nl;
  n[2] /= nl;
  let tx = [1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]];
  const tl = Math.hypot(tx[0], tx[1], tx[2]);
  tx = tl > 1e-6 ? tx.map((c) => c / tl) : [0, 1, 0];
  const ty = [
    n[1] * tx[2] - n[2] * tx[1],
    n[2] * tx[0] - n[0] * tx[2],
    n[0] * tx[1] - n[1] * tx[0],
  ];
  const dot = (a: number[], b: number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // Edges in the tangent frame (cm) and in uv.
  const a1 = [dot(e1, tx), dot(e1, ty)];
  const a2 = [dot(e2, tx), dot(e2, ty)];
  const u1 = [UV[i1 * 2] - UV[i0 * 2], UV[i1 * 2 + 1] - UV[i0 * 2 + 1]];
  const u2 = [UV[i2 * 2] - UV[i0 * 2], UV[i2 * 2 + 1] - UV[i0 * 2 + 1]];
  // jac = [u1 u2] · inverse([a1 a2]).
  const det = a1[0] * a2[1] - a2[0] * a1[1];
  if (Math.abs(det) < 1e-9) return [0, 0, 0, 0];
  const inv = [a2[1] / det, -a2[0] / det, -a1[1] / det, a1[0] / det];
  return [
    u1[0] * inv[0] + u2[0] * inv[2],
    u1[0] * inv[1] + u2[0] * inv[3],
    u1[1] * inv[0] + u2[1] * inv[2],
    u1[1] * inv[1] + u2[1] * inv[3],
  ];
};

/**
 * The point of the face seen straight on at (x, y) cm: the front-most
 * triangle under it. Null off the face (and over the eye and mouth
 * openings, which the atlas fills but makeup never paints, still count).
 */
export const locateFront = (x: number, y: number): SurfaceHit | null => {
  let best: SurfaceHit | null = null;
  let bestZ = -Infinity;
  for (let t = 0; t < TRI_COUNT; t += 1) {
    const i0 = corner(t, 0);
    const i1 = corner(t, 1);
    const i2 = corner(t, 2);
    const x0 = REST[i0 * 3];
    const y0 = REST[i0 * 3 + 1];
    const x1 = REST[i1 * 3];
    const y1 = REST[i1 * 3 + 1];
    const x2 = REST[i2 * 3];
    const y2 = REST[i2 * 3 + 1];
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(det) > 1e-9) {
      const b0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det;
      const b1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det;
      const b2 = 1 - b0 - b1;
      if (b0 >= -1e-6 && b1 >= -1e-6 && b2 >= -1e-6) {
        const z =
          REST[i0 * 3 + 2] * b0 + REST[i1 * 3 + 2] * b1 + REST[i2 * 3 + 2] * b2;
        if (z > bestZ) {
          bestZ = z;
          best = { tri: t, b0, b1, b2 };
        }
      }
    }
  }
  return best;
};

/** A dab at the face point seen straight on at (x, y) cm, or null off the face. */
export const dabAt = (x: number, y: number): Dab | null => {
  const hit = locateFront(x, y);
  if (!hit) return null;
  const [u, v] = hitUv(hit);
  return { u, v, jac: triangleJacobian(hit.tri) };
};

/**
 * Dabs along a path drawn on the face seen straight on (cm), spaced `step`
 * cm apart. Points off the face are skipped.
 */
export const dabsAlong = (
  path: ReadonlyArray<readonly [number, number]>,
  step: number,
): Dab[] => {
  const out: Dab[] = [];
  const push = (x: number, y: number) => {
    const d = dabAt(x, y);
    if (d) out.push(d);
  };
  if (path.length === 0) return out;
  push(path[0][0], path[0][1]);
  let carry = 0;
  for (let k = 1; k < path.length; k += 1) {
    const [ax, ay] = path[k - 1];
    const [bx, by] = path[k];
    const len = Math.hypot(bx - ax, by - ay);
    let s = step - carry;
    while (s <= len) {
      const f = s / len;
      push(ax + (bx - ax) * f, ay + (by - ay) * f);
      s += step;
    }
    carry = len - (s - step);
  }
  return out;
};

/** What a field function sees at each texel: the face point and its feature distances. */
export type FieldPoint = {
  x: number;
  y: number;
  z: number;
  /** Edge hops to the nearer lash line (0 on it, 3 at the brow's lower edge). */
  eyeRing: number;
  /** 0 on the outer lip line, 1 on the inner one and off the lips. */
  lipEdge: number;
};

/** Which triangles to rasterize, optionally only near a box on the face (cm, both sides). */
export type FieldArea = {
  triangles: ArrayLike<number>;
  /** |x| and y range of the shape, in cm; triangles outside it are skipped. */
  box?: { minAbsX: number; maxAbsX: number; minY: number; maxY: number };
};

/**
 * Paints `fn` (0..1 at a face point) over `area` into a `size`² single
 * channel mask, row 0 at the top of the atlas, 255 = full.
 */
export const rasterizeField = (
  size: number,
  area: FieldArea,
  fn: (p: FieldPoint) => number,
): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(size * size);
  const p: FieldPoint = { x: 0, y: 0, z: 0, eyeRing: 0, lipEdge: 0 };
  const { box } = area;
  for (let n = 0; n < area.triangles.length; n += 1) {
    const t = area.triangles[n];
    const i0 = corner(t, 0);
    const i1 = corner(t, 1);
    const i2 = corner(t, 2);
    let skip = false;
    if (box) {
      const ax = [i0, i1, i2].map((i) => Math.abs(REST[i * 3]));
      const ay = [i0, i1, i2].map((i) => REST[i * 3 + 1]);
      skip =
        Math.max(...ax) < box.minAbsX ||
        Math.min(...ax) > box.maxAbsX ||
        Math.max(...ay) < box.minY ||
        Math.min(...ay) > box.maxY;
    }
    if (!skip) {
      const px0 = UV[i0 * 2] * size;
      const py0 = (1 - UV[i0 * 2 + 1]) * size;
      const px1 = UV[i1 * 2] * size;
      const py1 = (1 - UV[i1 * 2 + 1]) * size;
      const px2 = UV[i2 * 2] * size;
      const py2 = (1 - UV[i2 * 2 + 1]) * size;
      const det = (py1 - py2) * (px0 - px2) + (px2 - px1) * (py0 - py2);
      if (Math.abs(det) > 1e-9) {
        const minX = Math.max(0, Math.floor(Math.min(px0, px1, px2)));
        const maxX = Math.min(size - 1, Math.ceil(Math.max(px0, px1, px2)));
        const minY = Math.max(0, Math.floor(Math.min(py0, py1, py2)));
        const maxY = Math.min(size - 1, Math.ceil(Math.max(py0, py1, py2)));
        for (let py = minY; py <= maxY; py += 1) {
          const cy = py + 0.5;
          for (let px = minX; px <= maxX; px += 1) {
            const cx = px + 0.5;
            const b0 =
              ((py1 - py2) * (cx - px2) + (px2 - px1) * (cy - py2)) / det;
            const b1 =
              ((py2 - py0) * (cx - px2) + (px0 - px2) * (cy - py2)) / det;
            const b2 = 1 - b0 - b1;
            // A hair of slack so shared edges leave no gaps.
            if (b0 >= -1e-3 && b1 >= -1e-3 && b2 >= -1e-3) {
              p.x = REST[i0 * 3] * b0 + REST[i1 * 3] * b1 + REST[i2 * 3] * b2;
              p.y =
                REST[i0 * 3 + 1] * b0 +
                REST[i1 * 3 + 1] * b1 +
                REST[i2 * 3 + 1] * b2;
              p.z =
                REST[i0 * 3 + 2] * b0 +
                REST[i1 * 3 + 2] * b1 +
                REST[i2 * 3 + 2] * b2;
              p.eyeRing =
                EYE_RING[i0] * b0 + EYE_RING[i1] * b1 + EYE_RING[i2] * b2;
              p.lipEdge =
                LIP_EDGE[i0] * b0 + LIP_EDGE[i1] * b1 + LIP_EDGE[i2] * b2;
              const v = Math.round(Math.min(1, Math.max(0, fn(p))) * 255);
              const k = py * size + px;
              if (v > out[k]) out[k] = v;
            }
          }
        }
      }
    }
  }
  return out;
};

/** Box blur (`radius` texels, run twice: close to a Gaussian) of a mask. */
export const blurMask = (
  mask: Uint8ClampedArray,
  size: number,
  radius: number,
): Uint8ClampedArray => {
  if (radius < 1) return mask;
  const w = radius * 2 + 1;
  const pass = (src: ArrayLike<number>, horizontal: boolean) => {
    const dst = new Float32Array(size * size);
    const at = (line: number, i: number) => {
      const c = Math.min(size - 1, Math.max(0, i));
      return horizontal ? src[line * size + c] : src[c * size + line];
    };
    for (let line = 0; line < size; line += 1) {
      let acc = 0;
      for (let i = -radius; i <= radius; i += 1) acc += at(line, i);
      for (let i = 0; i < size; i += 1) {
        dst[horizontal ? line * size + i : i * size + line] = acc / w;
        acc += at(line, i + radius + 1) - at(line, i - radius);
      }
    }
    return dst;
  };
  let out: ArrayLike<number> = mask;
  for (let n = 0; n < 2; n += 1) out = pass(pass(out, true), false);
  return Uint8ClampedArray.from(out as Float32Array);
};

/** Smooth 0 → 1 between edges a and b (either order). */
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A polyline on the face, as [x, y] cm pairs, from a flat xyz array. */
export const polylineXY = (
  points: ArrayLike<number>,
): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let k = 0; k + 2 < points.length; k += 3)
    out.push([points[k], points[k + 1]]);
  return out;
};

/**
 * Distance (cm) from (x, y) to a polyline, and how far along it the nearest
 * point is (0 at the first point, 1 at the last).
 */
export const polylineDistance = (
  line: ReadonlyArray<readonly [number, number]>,
  x: number,
  y: number,
): { d: number; along: number } => {
  let best = Infinity;
  let bestAlong = 0;
  let total = 0;
  const lens: number[] = [];
  for (let k = 1; k < line.length; k += 1) {
    const l = Math.hypot(
      line[k][0] - line[k - 1][0],
      line[k][1] - line[k - 1][1],
    );
    lens.push(l);
    total += l;
  }
  let run = 0;
  for (let k = 1; k < line.length; k += 1) {
    const [ax, ay] = line[k - 1];
    const [bx, by] = line[k];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-12;
    const f = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2));
    const d = Math.hypot(x - (ax + dx * f), y - (ay + dy * f));
    if (d < best) {
      best = d;
      bestAlong = (run + lens[k - 1] * f) / (total || 1);
    }
    run += lens[k - 1];
  }
  return { d: best, along: bestAlong };
};

/** The y of a polyline at x (linear between its points; clamped at the ends). */
export const polylineYAt = (
  line: ReadonlyArray<readonly [number, number]>,
  x: number,
): number => {
  for (let k = 1; k < line.length; k += 1) {
    const [ax, ay] = line[k - 1];
    const [bx, by] = line[k];
    if ((x - ax) * (x - bx) <= 0 && ax !== bx) {
      return ay + ((by - ay) * (x - ax)) / (bx - ax);
    }
  }
  const first = line[0];
  const last = line[line.length - 1];
  return Math.abs(x - first[0]) < Math.abs(x - last[0]) ? first[1] : last[1];
};
