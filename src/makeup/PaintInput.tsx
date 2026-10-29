// Painting with a finger (or the mouse) on your own face.
//
// Brush: touch and drag. Each point under the finger is found on the live
// face mesh (a ray from the camera through the touch), and a soft dab lands
// at that spot of the face, so the stroke stays on the skin as you move.
// Between two touch samples the gap is filled with more dabs found the same
// way, so a fast drag never leaves holes.
// Fill: tap a face area (lips, eye, lid, brow, cheek) to colour it.
//
// When a face first appears, a soft natural look fades on by itself, so
// there is makeup to see at once; clear takes it off.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Matrix4, Ray, Raycaster, Vector2 } from "three";
import { useFaceAtlasSurface } from "@vincentt-xr/sdk/face-effects";

import { dabAtHit, dabScale, raycastFace, type Dab } from "./atlas";
import { fillOp, looks } from "./demo";
import { fadeInPaint } from "./PaintLayers";
import { areaAt } from "./picking";
import { BRUSH, swatchHex } from "./palette";
import { getTool, paintBook } from "./state";

/** Dab spacing along a stroke, as a share of the brush radius. */
const SPACING = 0.22;
/** Most dabs filled in between two touch samples. */
const MAX_FILL = 48;
/** A tap moves less than this (px). */
const TAP_SLOP = 12;
/**
 * Jitter smoothing: a tiny move is eased (this share of it is taken), a move
 * of `SMOOTH_PX` or more is taken whole, so fast corners are never cut.
 */
const SMOOTHING = 0.45;
const SMOOTH_PX = 10;
/** The face must be this present before the first look appears. */
const LOOK_PRESENCE = 0.6;

type Point = { x: number; y: number };

export const PaintInput = () => {
  const face = useFaceAtlasSurface({ numFaces: 1 });
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const faceRef = useRef(face);
  faceRef.current = face;
  const greeted = useRef(false);

  // The first face gets the natural look, once per visit.
  useFrame(() => {
    const f = faceRef.current;
    if (greeted.current || !f || f.surface.presence < LOOK_PRESENCE) return;
    greeted.current = true;
    const book = paintBook();
    if (!book.empty) return;
    looks.natural().forEach((op) => book.apply(op));
    fadeInPaint();
  });

  // The fill masks, built while idle.
  useEffect(() => paintBook().prepareMasks(), []);

  useEffect(() => {
    const el = gl.domElement;
    const book = paintBook();
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const inverse = new Matrix4();
    const local = new Ray();

    /** The face point under a screen point, or null. */
    const hitAt = (p: Point) => {
      const f = faceRef.current;
      if (!f || f.surface.presence < 0.5) return null;
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((p.x - rect.left) / rect.width) * 2 - 1,
        -((p.y - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      f.group.updateWorldMatrix(true, false);
      inverse.copy(f.group.matrixWorld).invert();
      local.copy(raycaster.ray).applyMatrix4(inverse);
      const positions = f.geometry.getAttribute("position").array;
      return raycastFace(
        [local.origin.x, local.origin.y, local.origin.z],
        [local.direction.x, local.direction.y, local.direction.z],
        positions,
      );
    };

    let pointer: number | null = null;
    let down: Point = { x: 0, y: 0 };
    let moved = 0;
    let last: { p: Point; dab: Dab } | null = null;
    let smooth: Point | null = null;

    /** Dabs from the last point to `p`, found on the face. */
    const dabsTo = (p: Point): Dab[] => {
      const hit = hitAt(p);
      if (!hit) {
        last = null;
        return [];
      }
      const dab = dabAtHit(hit);
      if (!last) {
        last = { p, dab };
        return [dab];
      }
      const { radius } = BRUSH[getTool().size];
      const cm =
        Math.hypot(dab.u - last.dab.u, dab.v - last.dab.v) / dabScale(dab);
      const steps = Math.min(MAX_FILL, Math.ceil(cm / (radius * SPACING)));
      const out: Dab[] = [];
      for (let k = 1; k < steps; k += 1) {
        const f = k / steps;
        const h = hitAt({
          x: last.p.x + (p.x - last.p.x) * f,
          y: last.p.y + (p.y - last.p.y) * f,
        });
        if (h) out.push(dabAtHit(h));
      }
      out.push(dab);
      last = { p, dab };
      return out;
    };

    const onDown = (e: PointerEvent) => {
      if (pointer !== null || (e.pointerType === "mouse" && e.button !== 0))
        return;
      pointer = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      down = { x: e.clientX, y: e.clientY };
      moved = 0;
      last = null;
      smooth = { ...down };
      const tool = getTool();
      if (tool.mode === "brush") {
        const b = BRUSH[tool.size];
        book.beginStroke({
          kind: "stroke",
          radius: b.radius,
          hardness: b.hardness,
          flow: b.flow,
          color: swatchHex(tool.color),
          finish: tool.finish,
        });
        book.extendStroke(dabsTo(down));
      }
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      moved = Math.max(
        moved,
        Math.hypot(e.clientX - down.x, e.clientY - down.y),
      );
      if (getTool().mode !== "brush") return;
      const samples = e.getCoalescedEvents?.() ?? [];
      const events = samples.length > 0 ? samples : [e];
      const dabs: Dab[] = [];
      events.forEach((s) => {
        const prev = smooth ?? { x: s.clientX, y: s.clientY };
        const step = Math.hypot(s.clientX - prev.x, s.clientY - prev.y);
        const k = Math.min(1, SMOOTHING + (1 - SMOOTHING) * (step / SMOOTH_PX));
        smooth = {
          x: prev.x + (s.clientX - prev.x) * k,
          y: prev.y + (s.clientY - prev.y) * k,
        };
        dabs.push(...dabsTo(smooth));
      });
      book.extendStroke(dabs);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      const tool = getTool();
      if (tool.mode === "brush") {
        if (e.type === "pointercancel") book.cancelStroke();
        else {
          // Reach the finger's last spot, then let the stroke join the paint.
          book.extendStroke(dabsTo({ x: e.clientX, y: e.clientY }));
          book.endStroke();
        }
        return;
      }
      if (e.type === "pointercancel" || moved > TAP_SLOP) return;
      const hit = hitAt({ x: e.clientX, y: e.clientY });
      if (!hit) return;
      const d = dabAtHit(hit);
      const area = areaAt(hit, (a) => book.areaStrength(a, d.u, d.v));
      if (area) book.apply(fillOp(area, tool.color, tool.finish));
    };

    const { touchAction } = el.style;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.style.touchAction = touchAction;
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      book.cancelStroke();
    };
  }, [gl, camera]);

  return null;
};
