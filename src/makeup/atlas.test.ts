import { describe, expect, it } from "vitest";
import {
  FACE_ATLAS_UVS,
  getFaceAtlasAttributes,
} from "@vincentt-xr/sdk/face-effects";

import {
  dabAt,
  dabsAlong,
  polylineDistance,
  polylineYAt,
  rasterizeField,
} from "./atlas";

const rest = getFaceAtlasAttributes().restPosition;

describe("face atlas geometry", () => {
  it("finds a landmark's own uv when seen straight on", () => {
    // Landmark 1: the tip of the nose.
    const d = dabAt(rest[3], rest[4]);
    expect(d).not.toBeNull();
    expect(d!.u).toBeCloseTo(FACE_ATLAS_UVS[2], 2);
    expect(d!.v).toBeCloseTo(FACE_ATLAS_UVS[3], 2);
  });

  it("is mirror-symmetric", () => {
    const a = dabAt(-4, -1.5)!;
    const b = dabAt(4, -1.5)!;
    expect(a.u).toBeCloseTo(1 - b.u, 3);
    expect(a.v).toBeCloseTo(b.v, 3);
  });

  it("maps a centimetre on the cheek to about a twentieth of the atlas", () => {
    const { jac } = dabAt(-4, -1.5)!;
    const sx = Math.hypot(jac[0], jac[2]);
    const sy = Math.hypot(jac[1], jac[3]);
    expect(sx).toBeGreaterThan(0.025);
    expect(sx).toBeLessThan(0.07);
    expect(sy).toBeGreaterThan(0.025);
    expect(sy).toBeLessThan(0.07);
  });

  it("finds nothing off the face", () => {
    expect(dabAt(20, 20)).toBeNull();
  });

  it("spaces dabs evenly along a path", () => {
    const dabs = dabsAlong(
      [
        [-4, -1],
        [-3, -1],
      ],
      0.1,
    );
    expect(dabs.length).toBe(11);
  });

  it("measures distance and position along a polyline", () => {
    const line: Array<[number, number]> = [
      [0, 0],
      [2, 0],
    ];
    const { d, along } = polylineDistance(line, 1, 0.5);
    expect(d).toBeCloseTo(0.5);
    expect(along).toBeCloseTo(0.5);
    expect(
      polylineYAt(
        [
          [0, 0],
          [2, 2],
        ],
        1,
      ),
    ).toBeCloseTo(1);
  });

  it("rasterizes a field over its triangles only", () => {
    const m = rasterizeField(64, { triangles: [0, 1, 2] }, () => 1);
    const lit = m.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(64 * 64 * 0.05);
  });
});

describe("touching the face", () => {
  it("finds the face point under a ray from the front", async () => {
    const { raycastFace, hitUv } = await import("./atlas");
    const hit = raycastFace([rest[3], rest[4], 50], [0, 0, -1], rest);
    expect(hit).not.toBeNull();
    const [u, v] = hitUv(hit!);
    expect(u).toBeCloseTo(FACE_ATLAS_UVS[2], 2);
    expect(v).toBeCloseTo(FACE_ATLAS_UVS[3], 2);
  });

  it("misses beside the face", async () => {
    const { raycastFace } = await import("./atlas");
    expect(raycastFace([30, 0, 50], [0, 0, -1], rest)).toBeNull();
  });

  it("tells which area a tap lands on", async () => {
    const { raycastFace } = await import("./atlas");
    const { areaAt } = await import("./picking");
    const at = (landmark: number, dy = 0) =>
      areaAt(
        raycastFace(
          [rest[landmark * 3], rest[landmark * 3 + 1] + dy, 50],
          [0, 0, -1],
          rest,
        )!,
        () => 0,
      );
    expect(at(17, 0.1)).toBe("lips"); // lower lip
    expect(at(205)).toBe("cheeks"); // apple of the cheek
    expect(at(10)).toBeNull(); // top of the forehead
  });
});
