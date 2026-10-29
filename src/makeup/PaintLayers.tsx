// The paint, drawn on the live face: one SDK makeup layer per finish, each
// reading its paint texture. The face mesh follows every move and expression,
// so the paint stays where it was put.
//
// The paint is shaded like makeup, against the person's own skin and light,
// and how much it covers follows how thick it is: a light layer filters the
// skin like a tint (lipstick stain, a blush wash, the skin's texture and
// colour still there), built-up paint turns opaque like face paint, still
// lit and textured by the skin under it.
import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { GLSL3 } from "three";
import {
  MAKEUP_BLENDING,
  MAKEUP_GLSL,
  MAKEUP_RENDER_ORDER,
  MakeupDesign,
  type MakeupDesignSettings,
  type MakeupMaterialContext,
} from "@vincentt-xr/sdk/face-effects";

import { FINISHES, type Finish } from "./palette";
import { paintBook } from "./state";

/** How each finish looks: shine and, for shimmer, fine sparkling flecks. */
const FINISH_LOOK: Record<Finish, Partial<MakeupDesignSettings>> = {
  matte: { finish: "matte" },
  satin: { finish: "satin", shine: 0.6 },
  shimmer: {
    finish: "shimmer",
    shine: 1,
    sparkleDensity: 0.9,
    sparkleSize: 0.6,
    sparkleColor: "",
  },
};

/** Paint thickness (alpha) where it starts covering, and where it is opaque. */
const COVER_FROM = 0.4;
const COVER_FULL = 0.95;

/** Shimmer glitter: cell (cm), fleck radius (cm), share of cells with one, brightness. */
const GLITTER = { cell: 0.06, fleck: 0.012, share: 0.3, strength: 2.2 };

// The SDK's finish code reads one coverage for the whole layer; here it is
// per texel, from the paint's thickness.
const FINISH_PER_TEXEL = MAKEUP_GLSL.finish.replace(
  /\buCoverage\b/g,
  "paintCover",
);

const FRAGMENT = /* glsl */ `${MAKEUP_GLSL.common}${MAKEUP_GLSL.design}${MAKEUP_GLSL.shading}${MAKEUP_GLSL.sparkle}
float paintCover;
${FINISH_PER_TEXEL}

// The paint at the mesh's own atlas uv: painting writes where the face is,
// so there is no mirror flip here.
vec4 paintSample(vec2 uv) {
  vec4 texel = texture(uDesignMap, uv);
  float a = clamp(texel.a, 0.0, 1.0);
  vec3 c = clamp(texel.rgb / max(a, 1e-4), 0.0, 1.0);
  return vec4(makeupDesignDecode(c), a);
}

uniform float uTime;

float paintHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Shimmer: fine glitter flecks stuck to the skin that catch the light in
// turn, so the sparkle shows even in flat light. Flecks smaller than a pixel
// grow to one and dim to match, so they never crawl.
vec3 paintGlitter(MakeupSample s, vec3 tint) {
  if (uFinish != MAKEUP_FINISH_SHIMMER) return vec3(0.0);
  const float CELL = ${GLITTER.cell.toFixed(3)};
  const float FLECK = ${GLITTER.fleck.toFixed(4)};
  vec3 g = s.rest / CELL;
  vec3 cell = floor(g);
  float h = paintHash(cell);
  if (h > ${GLITTER.share.toFixed(3)}) return vec3(0.0);
  vec3 centre = cell + 0.5 + (vec3(
    paintHash(cell + 1.31), paintHash(cell + 2.73), paintHash(cell + 4.17)) - 0.5) * 0.6;
  float d = length(g - centre) * CELL;
  float r = max(FLECK, s.pixelCm * 0.8);
  float fleck = (1.0 - smoothstep(r * 0.35, r, d)) * min(1.0, (FLECK * FLECK) / (r * r) * 2.0);
  float rate = 1.5 + 3.0 * paintHash(cell + 5.9);
  float twinkle = pow(0.5 + 0.5 * sin(uTime * rate + paintHash(cell + 7.7) * 6.2832), 10.0);
  // Brighter where the fleck faces the camera, so a head turn sweeps them.
  float facing = 0.4 + 0.6 * max(dot(s.flakeNormal, s.viewDir), 0.0);
  return tint * fleck * twinkle * facing * ${GLITTER.strength.toFixed(2)};
}

void main() {
  MakeupSample s = makeupSampleGeometry();
  vec4 paint = paintSample(s.uv);
  if (paint.a * s.fade < 1.0 / 255.0) discard;
  makeupSampleColor(s);
  paintCover = smoothstep(${COVER_FROM.toFixed(3)}, ${COVER_FULL.toFixed(3)}, paint.a);
  MakeupLayer layer = makeupFinish(s, paint.rgb, paint.a);
  float k = clamp(paint.a, 0.0, 1.0) * s.fade * clamp(uOpacity, 0.0, 1.0);
  layer.highlight += paintGlitter(s, mix(vec3(1.0), paint.rgb, 0.35)) * k;
  makeupOutput(s, layer);
}
`;

/** Shared clock for the glitter twinkle. */
const PAINT_TIME = { value: 0 };

/** How much of the paint shows (fades in for the first look, off to compare). */
const PAINT_SHOWN = { value: 1 };
const FADE = { from: 1, to: 1, start: -1, seconds: 0.9, running: false };

/** Fades the paint to `to` (0 hidden … 1 shown) over `seconds`, strict ease-out. */
export const fadePaint = (to: number, seconds: number) => {
  FADE.from = PAINT_SHOWN.value;
  FADE.to = to;
  FADE.seconds = seconds;
  FADE.start = -1;
  FADE.running = true;
};

/** Fades the paint in from nothing. */
export const fadeInPaint = () => {
  PAINT_SHOWN.value = 0;
  fadePaint(1, 0.9);
};

/** One material per layer, made by the layer (it owns and disposes it). */
const paintMaterial = (ctx: MakeupMaterialContext<"design">) => (
  <shaderMaterial
    glslVersion={GLSL3}
    {...MAKEUP_BLENDING}
    depthWrite={false}
    uniforms={{ ...ctx.uniforms, uTime: PAINT_TIME, uOpacity: PAINT_SHOWN }}
    vertexShader={MAKEUP_GLSL.atlasVertex}
    fragmentShader={FRAGMENT}
  />
);

export const PaintLayers = () => {
  // The paint lives as long as the page (a remount keeps it); it paints
  // with the scene's renderer.
  const book = paintBook();
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    book.attach(gl);
    return () => book.attach(null);
  }, [book, gl]);
  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    PAINT_TIME.value = now;
    if (FADE.running) {
      if (FADE.start < 0) FADE.start = now;
      const t = Math.min(1, (now - FADE.start) / Math.max(1e-3, FADE.seconds));
      const k = 1 - (1 - t) ** 3;
      PAINT_SHOWN.value = FADE.from + (FADE.to - FADE.from) * k;
      FADE.running = t < 1;
    }
  });
  return (
    <>
      {FINISHES.map((f, i) => (
        <MakeupDesign
          key={f}
          texture={book.textures[f]}
          region="face"
          numFaces={1}
          material={paintMaterial}
          renderOrder={MAKEUP_RENDER_ORDER.design + i * 0.001}
          {...FINISH_LOOK[f]}
        />
      ))}
    </>
  );
};
