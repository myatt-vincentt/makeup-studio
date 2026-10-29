// The paint on the face: one transparent texture per finish (matte, satin,
// shimmer), laid out like the face atlas, plus the list of everything painted
// so far. All drawing happens on the GPU, so painting never re-uploads a
// texture.
//
// A brush stroke is a run of soft round dabs placed on the face; a fill is a
// face-area mask. Either is first drawn as coverage into a scratch texture
// (dabs keep the strongest value where they overlap, so one stroke is even
// and keeps its soft edge), then laid onto its finish's texture in its colour
// at the stroke's flow: a second stroke over it builds the colour up.
// Painting with one finish also wipes the same amount from the other two, so
// the newest paint is the one you see.
//
// Each finish has two textures: the committed paint, and what the face shows
// (the committed paint plus the stroke still being drawn). Undo repaints the
// committed paint from the list without its last entry.
import {
  AddEquation,
  BufferAttribute,
  Color,
  BufferGeometry,
  CustomBlending,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MaxEquation,
  Mesh,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  WebGLRenderTarget,
  ZeroFactor,
  type WebGLRenderer,
} from "three";

import type { Dab } from "./atlas";
import { fillMask } from "./masks";
import { FILL_AREAS, FINISHES, type FillArea, type Finish } from "./palette";

/** Paint texture size (texels). The face spans ~20 cm across it: 0.2 mm a texel. */
export const PAINT_SIZE = 1024;

/** One thing painted. */
export type PaintOp =
  | {
      kind: "stroke";
      dabs: Dab[];
      /** Dab radius on the face (cm) and edge hardness 0..1. */
      radius: number;
      hardness: number;
      color: string;
      finish: Finish;
      flow: number;
    }
  | {
      kind: "fill";
      area: FillArea;
      color: string;
      finish: Finish;
      flow: number;
    };

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** A dab: full to `uHardness` of its radius, then a smooth fade to the rim. */
const dabMaterial = () =>
  new ShaderMaterial({
    uniforms: { uHardness: { value: 0.5 } },
    vertexShader: /* glsl */ `
      attribute vec2 local;
      varying vec2 vLocal;
      void main() {
        vLocal = local;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHardness;
      varying vec2 vLocal;
      void main() {
        float d = length(vLocal);
        float hard = 1.0 - smoothstep(uHardness, 1.0, d);
        // The softest brushes fade like powder: a bell with no edge to it.
        float soft = exp(-4.5 * d * d) * (1.0 - smoothstep(0.75, 1.0, d));
        gl_FragColor = vec4(mix(soft, hard, smoothstep(0.0, 0.3, uHardness)));
      }`,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendEquationAlpha: MaxEquation,
    depthTest: false,
    depthWrite: false,
  });

/** A face-area mask (row 0 at the top of the atlas) as coverage. */
const maskMaterial = () =>
  new ShaderMaterial({
    uniforms: { uMask: { value: null as Texture | null } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y)).r);
      }`,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendEquationAlpha: MaxEquation,
    depthTest: false,
    depthWrite: false,
  });

/**
 * The scratch coverage laid onto a finish texture: premultiplied colour
 * over it (`erase` false), or the same amount wiped from it (`erase` true).
 * Colours stay in sRGB numbers, as the paint shader expects.
 */
const layMaterial = (erase: boolean) =>
  new ShaderMaterial({
    uniforms: {
      uCoverage: { value: null as Texture | null },
      uColor: { value: new Vector3(1, 1, 1) },
      uFlow: { value: 1 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCoverage;
      uniform vec3 uColor;
      uniform float uFlow;
      varying vec2 vUv;
      void main() {
        float a = texture2D(uCoverage, vUv).r * uFlow;
        gl_FragColor = vec4(${erase ? "vec3(0.0)" : "uColor * a"}, a);
      }`,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendEquationAlpha: AddEquation,
    blendSrc: erase ? ZeroFactor : OneFactor,
    blendSrcAlpha: erase ? ZeroFactor : OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
  });

/** A plain copy of one texture into another. */
const copyMaterial = () =>
  new ShaderMaterial({
    uniforms: { uSource: { value: null as Texture | null } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uSource, vUv); }`,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });

/** "#rrggbb" as sRGB numbers 0..1 (no colour management: the shader decodes). */
const srgb = (hex: string, out: Vector3) => {
  const h = hex.replace("#", "");
  const c = (k: number) => parseInt(h.slice(k, k + 2), 16) / 255;
  return out.set(c(0), c(2), c(4));
};

const paintTarget = (mips: boolean) =>
  new WebGLRenderTarget(PAINT_SIZE, PAINT_SIZE, {
    depthBuffer: false,
    generateMipmaps: mips,
    minFilter: mips ? LinearMipmapLinearFilter : LinearFilter,
    magFilter: LinearFilter,
  });

/**
 * One quad per dab, in atlas uv: the dab's circle of radius `r` cm mapped
 * through its local cm → uv matrix, `local` running −1..1 across it.
 */
const dabGeometry = (dabs: Dab[], r: number) => {
  const pos = new Float32Array(dabs.length * 12);
  const local = new Float32Array(dabs.length * 8);
  const index = new Uint32Array(dabs.length * 6);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  dabs.forEach((d, i) => {
    const [a, b, c, e] = d.jac;
    corners.forEach(([s, t], k) => {
      pos[i * 12 + k * 3] = d.u + (a * s + b * t) * r;
      pos[i * 12 + k * 3 + 1] = d.v + (c * s + e * t) * r;
      local[i * 8 + k * 2] = s;
      local[i * 8 + k * 2 + 1] = t;
    });
    index.set(
      [0, 1, 2, 0, 2, 3].map((v) => v + i * 4),
      i * 6,
    );
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("local", new BufferAttribute(local, 2));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
};

/** Clears a paint texture to transparent. */
const clearTarget = (gl: WebGLRenderer, target: WebGLRenderTarget) => {
  gl.setRenderTarget(target);
  gl.setClearColor(0x000000, 0);
  gl.clear(true, false, false);
};

/** A stroke being drawn: everything but its dabs is known from the start. */
export type StrokeStart = Omit<Extract<PaintOp, { kind: "stroke" }>, "dabs">;

export class PaintBook {
  /** The paint textures the face layers read, one per finish. */
  readonly textures: Record<Finish, Texture>;

  /** Everything painted, oldest first. */
  readonly ops: PaintOp[] = [];

  /** Bumped on every change. */
  version = 0;

  /** The committed paint, per finish. */
  private readonly base: Record<Finish, WebGLRenderTarget>;

  /** What the face shows, per finish. */
  private readonly shown: Record<Finish, WebGLRenderTarget>;

  private readonly scratch = paintTarget(false);

  private readonly masks = new Map<FillArea, DataTexture>();

  private readonly maskData = new Map<FillArea, Uint8ClampedArray>();

  private readonly listeners = new Set<() => void>();

  private readonly camera = new OrthographicCamera(0, 1, 1, 0, -1, 1);

  private readonly scene = new Scene();

  private readonly quad = new PlaneGeometry(1, 1).translate(0.5, 0.5, 0);

  private readonly dab = dabMaterial();

  private readonly mask = maskMaterial();

  private readonly lay = layMaterial(false);

  private readonly wipe = layMaterial(true);

  private readonly copy = copyMaterial();

  private renderer: WebGLRenderer | null = null;

  /** Ops already in the committed paint; the rest wait for a renderer. */
  private drawn = 0;

  /** The stroke being drawn, if any. */
  private live: Extract<PaintOp, { kind: "stroke" }> | null = null;

  constructor() {
    const base = {} as Record<Finish, WebGLRenderTarget>;
    const shown = {} as Record<Finish, WebGLRenderTarget>;
    const textures = {} as Record<Finish, Texture>;
    FINISHES.forEach((f) => {
      base[f] = paintTarget(false);
      shown[f] = paintTarget(true);
      textures[f] = shown[f].texture;
    });
    this.base = base;
    this.shown = shown;
    this.textures = textures;
    this.lay.uniforms.uCoverage.value = this.scratch.texture;
    this.wipe.uniforms.uCoverage.value = this.scratch.texture;
  }

  /** Gives the book the renderer to paint with; anything waiting is drawn. */
  attach(renderer: WebGLRenderer | null) {
    this.renderer = renderer;
    if (!renderer) return;
    this.repaint();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Paints one thing and remembers it. */
  apply(op: PaintOp) {
    this.cancelStroke();
    this.ops.push(op);
    this.flush();
    this.changed();
  }

  /** Takes back the last thing painted. */
  undo() {
    this.cancelStroke();
    if (this.ops.length === 0) return;
    this.ops.pop();
    this.repaint();
    this.changed();
  }

  /** Wipes the face clean. */
  clear() {
    this.live = null;
    this.ops.length = 0;
    this.repaint();
    this.changed();
  }

  /** True when nothing is painted. */
  get empty() {
    return this.ops.length === 0 && !this.live;
  }

  /** Starts a brush stroke; dabs follow with `extendStroke`. */
  beginStroke(stroke: StrokeStart) {
    this.cancelStroke();
    this.live = { ...stroke, kind: "stroke", dabs: [] };
    this.withRenderer((gl) => clearTarget(gl, this.scratch));
  }

  /** Adds dabs to the stroke being drawn and shows it. */
  extendStroke(dabs: Dab[]) {
    const { live } = this;
    if (!live || dabs.length === 0) return;
    live.dabs.push(...dabs);
    this.withRenderer((gl) => {
      this.drawDabs(gl, dabs, live.radius, live.hardness);
      // The face shows the committed paint with the stroke over it.
      this.copyInto(gl, this.base[live.finish], this.shown[live.finish]);
      this.setLay(live);
      gl.setRenderTarget(this.shown[live.finish]);
      this.render(gl, new Mesh(this.quad, this.lay));
    });
  }

  /** Finishes the stroke: it joins the paint (and the undo list). */
  endStroke() {
    const { live } = this;
    this.live = null;
    if (!live) return;
    if (live.dabs.length === 0) {
      this.syncShown(live.finish);
      return;
    }
    this.ops.push(live);
    this.withRenderer((gl) => {
      // The scratch already holds the stroke's coverage.
      this.layScratch(gl, live);
      FINISHES.forEach((f) => this.copyInto(gl, this.base[f], this.shown[f]));
    });
    this.drawn = this.ops.length;
    this.changed();
  }

  /** Drops the stroke being drawn. */
  cancelStroke() {
    const { live } = this;
    if (!live) return;
    this.live = null;
    this.syncShown(live.finish);
  }

  /** How strongly fill `area` covers the atlas texel at (u, v), 0..1. */
  areaStrength(area: FillArea, u: number, v: number) {
    const m = this.maskArray(area);
    const x = Math.min(PAINT_SIZE - 1, Math.max(0, Math.floor(u * PAINT_SIZE)));
    const y = Math.min(
      PAINT_SIZE - 1,
      Math.max(0, Math.floor((1 - v) * PAINT_SIZE)),
    );
    return m[y * PAINT_SIZE + x] / 255;
  }

  /**
   * Builds the fill masks a little at a time while the page is idle, so the
   * first tap on an area never waits. Returns a cancel.
   */
  prepareMasks() {
    let cancelled = false;
    const idle =
      window.requestIdleCallback ??
      ((fn: () => void) => window.setTimeout(fn, 50));
    const next = (k: number) => {
      if (cancelled || k >= FILL_AREAS.length) return;
      idle(() => {
        if (cancelled) return;
        this.maskTexture(FILL_AREAS[k]);
        next(k + 1);
      });
    };
    next(0);
    return () => {
      cancelled = true;
    };
  }

  private changed() {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  /** Clears the committed paint and paints every op again. */
  private repaint() {
    this.drawn = 0;
    this.withRenderer((gl) => {
      FINISHES.forEach((f) => clearTarget(gl, this.base[f]));
    });
    this.flush();
    this.withRenderer((gl) => {
      FINISHES.forEach((f) => this.copyInto(gl, this.base[f], this.shown[f]));
    });
  }

  private flush() {
    this.withRenderer((gl) => {
      const from = this.drawn;
      while (this.drawn < this.ops.length) {
        this.draw(gl, this.ops[this.drawn]);
        this.drawn += 1;
      }
      if (this.drawn > from)
        FINISHES.forEach((f) => this.copyInto(gl, this.base[f], this.shown[f]));
    });
  }

  private syncShown(finish: Finish) {
    this.withRenderer((gl) =>
      this.copyInto(gl, this.base[finish], this.shown[finish]),
    );
  }

  /** Runs `fn` with the renderer, leaving its target and clear state as they were. */
  private withRenderer(fn: (gl: WebGLRenderer) => void) {
    const gl = this.renderer;
    if (!gl) return;
    const target = gl.getRenderTarget();
    const { autoClear } = gl;
    const xr = gl.xr.enabled;
    const clearAlpha = gl.getClearAlpha();
    const clearColor = gl.getClearColor(new Color());
    gl.autoClear = false;
    gl.xr.enabled = false;
    try {
      fn(gl);
    } finally {
      gl.setRenderTarget(target);
      gl.setClearColor(clearColor, clearAlpha);
      gl.autoClear = autoClear;
      gl.xr.enabled = xr;
    }
  }

  private render(gl: WebGLRenderer, mesh: Mesh) {
    this.scene.add(mesh);
    gl.render(this.scene, this.camera);
    this.scene.remove(mesh);
  }

  private copyInto(
    gl: WebGLRenderer,
    from: WebGLRenderTarget,
    to: WebGLRenderTarget,
  ) {
    this.copy.uniforms.uSource.value = from.texture;
    gl.setRenderTarget(to);
    this.render(gl, new Mesh(this.quad, this.copy));
  }

  private maskArray(area: FillArea) {
    let m = this.maskData.get(area);
    if (!m) {
      m = fillMask(area, PAINT_SIZE);
      this.maskData.set(area, m);
    }
    return m;
  }

  private maskTexture(area: FillArea) {
    let t = this.masks.get(area);
    if (!t) {
      t = new DataTexture(
        this.maskArray(area),
        PAINT_SIZE,
        PAINT_SIZE,
        RedFormat,
      );
      t.minFilter = LinearFilter;
      t.magFilter = LinearFilter;
      t.needsUpdate = true;
      this.masks.set(area, t);
    }
    return t;
  }

  private drawDabs(
    gl: WebGLRenderer,
    dabs: Dab[],
    r: number,
    hardness: number,
  ) {
    const geometry = dabGeometry(dabs, r);
    this.dab.uniforms.uHardness.value = Math.min(0.95, Math.max(0, hardness));
    gl.setRenderTarget(this.scratch);
    this.render(gl, new Mesh(geometry, this.dab));
    geometry.dispose();
  }

  private setLay(op: PaintOp) {
    const flow = Math.min(1, Math.max(0, op.flow));
    srgb(op.color, this.lay.uniforms.uColor.value);
    this.lay.uniforms.uFlow.value = flow;
    this.wipe.uniforms.uFlow.value = flow;
  }

  /** Lays the scratch coverage onto its finish and wipes it from the others. */
  private layScratch(gl: WebGLRenderer, op: PaintOp) {
    this.setLay(op);
    FINISHES.forEach((f) => {
      gl.setRenderTarget(this.base[f]);
      this.render(
        gl,
        new Mesh(this.quad, f === op.finish ? this.lay : this.wipe),
      );
    });
  }

  private draw(gl: WebGLRenderer, op: PaintOp) {
    clearTarget(gl, this.scratch);
    if (op.kind === "fill") {
      this.mask.uniforms.uMask.value = this.maskTexture(op.area);
      gl.setRenderTarget(this.scratch);
      this.render(gl, new Mesh(this.quad, this.mask));
    } else if (op.dabs.length > 0) {
      this.drawDabs(gl, op.dabs, op.radius, op.hardness);
    }
    this.layScratch(gl, op);
  }
}
