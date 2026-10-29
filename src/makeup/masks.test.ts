import { describe, expect, it } from "vitest";
import { getFaceAtlasRegionBounds } from "@vincentt-xr/sdk/face-effects";

import { fillMask } from "./masks";
import { FILL_AREAS } from "./palette";

const N = 256;

/** Texel bounds of everything above `min`. */
const extent = (m: Uint8ClampedArray, min = 8) => {
  let x0 = N;
  let x1 = -1;
  let y0 = N;
  let y1 = -1;
  for (let y = 0; y < N; y += 1)
    for (let x = 0; x < N; x += 1)
      if (m[y * N + x] > min) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return { x0, x1, y0, y1 };
};

describe("fill masks", () => {
  it.each(FILL_AREAS)("%s paints both sides alike", (area) => {
    const m = fillMask(area, N);
    let sum = 0;
    let diff = 0;
    for (let y = 0; y < N; y += 1)
      for (let x = 0; x < N; x += 1) {
        sum += m[y * N + x];
        diff += Math.abs(m[y * N + x] - m[y * N + (N - 1 - x)]);
      }
    expect(sum).toBeGreaterThan(0);
    expect(diff / sum).toBeLessThan(0.1);
  });

  it("keeps lipstick on the lips", () => {
    const b = getFaceAtlasRegionBounds("lips");
    const e = extent(fillMask("lips", N), 128);
    expect(e.x0 / N).toBeGreaterThan(b.minU - 0.02);
    expect(e.x1 / N).toBeLessThan(b.maxU + 0.02);
    expect(1 - e.y1 / N).toBeGreaterThan(b.minV - 0.02);
    expect(1 - e.y0 / N).toBeLessThan(b.maxV + 0.02);
  });

  it("puts eyeshadow and liner above the eyes, under the brows", () => {
    const lids = extent(fillMask("lids", N));
    const liner = extent(fillMask("liner", N));
    const brows = extent(fillMask("brows", N));
    // Rows grow downward: the brows start higher than either.
    expect(brows.y0).toBeLessThan(lids.y0);
    expect(lids.y0).toBeLessThan(liner.y0);
  });

  it("keeps blush on the cheeks, below the eyes", () => {
    const blush = extent(fillMask("cheeks", N), 40);
    const liner = extent(fillMask("liner", N));
    expect(blush.y0).toBeGreaterThan(liner.y1);
  });
});
