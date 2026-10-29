// Which face area a tap lands on, for tap-to-fill: the lips, the eye itself
// (liner), the upper lid (shadow), the brows, or the cheek (blush).
import {
  FACE_ATLAS_POLYLINES,
  getFaceAtlasRegionTriangles,
} from "@vincentt-xr/sdk/face-effects";

import { hitRest, polylineXY, polylineYAt, type SurfaceHit } from "./atlas";
import type { FillArea } from "./palette";

const UPPER_LASH = polylineXY(FACE_ATLAS_POLYLINES.upperLash.points);

const regionOf = new Map<number, string>();
// Later regions win: the specific ones go last.
(["face", "cheeks", "lids", "brows", "eyes", "lips", "mouth"] as const).forEach(
  (r) => {
    const tris = getFaceAtlasRegionTriangles(r);
    for (let k = 0; k < tris.length; k += 1) regionOf.set(tris[k], r);
  },
);

/**
 * The fill area under a point on the face, or null where no fill applies
 * (forehead, nose, chin). `strength` tells how strongly a soft area (the
 * blush) reaches a point outside its own region.
 */
export const areaAt = (
  hit: SurfaceHit,
  strength: (area: FillArea) => number,
): FillArea | null => {
  const region = regionOf.get(hit.tri);
  if (region === "lips" || region === "mouth") return "lips";
  if (region === "eyes") return "liner";
  if (region === "brows") return "brows";
  if (region === "lids") {
    const [x, y] = hitRest(hit);
    const lashY = polylineYAt(UPPER_LASH, -Math.abs(x));
    return y > lashY - 0.05 ? "lids" : "cheeks";
  }
  if (region === "cheeks") return "cheeks";
  return strength("cheeks") > 0.2 ? "cheeks" : null;
};
