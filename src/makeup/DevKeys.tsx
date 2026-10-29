// Dev only: paint without a finger.
//   1 natural look · 2 bold look · 3 face paint (each on a clean face)
//   q lips · w cheeks · e lids · r liner · t brows: fill with the picked colour and finish
//   b blush strokes · n liner strokes · h a heart on the cheek
//   z undo · x clear
// window.__makeup exposes the paint, the tool and these actions for debugging,
// plus where a face landmark is on screen (for driving touches in tests).
// Scene.tsx lazy-imports this behind an inline NODE_ENV check, so it never
// reaches production.
import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { useFaceAtlasSurface } from "@vincentt-xr/sdk/face-effects";

import {
  blushStroke,
  fillOp,
  heartPath,
  linerStroke,
  paintLook,
  strokeOp,
  type LookName,
} from "./demo";
import type { FillArea } from "./palette";
import { getTool, paintBook, setTool } from "./state";

const LOOK_KEYS: Record<string, LookName> = {
  "1": "natural",
  "2": "bold",
  "3": "facePaint",
};
const FILL_KEYS: Record<string, FillArea> = {
  q: "lips",
  w: "cheeks",
  e: "lids",
  r: "liner",
  t: "brows",
};

const DevKeys = () => {
  const face = useFaceAtlasSurface({ numFaces: 1 });
  const faceRef = useRef(face);
  faceRef.current = face;
  const gl = useThree((st) => st.gl);
  const camera = useThree((st) => st.camera);
  useEffect(() => {
    const book = paintBook();
    const fill = (area: FillArea) => {
      const { color, finish } = getTool();
      book.apply(fillOp(area, color, finish));
    };
    const api = {
      book,
      getTool,
      setTool,
      look: (name: LookName) => paintLook(book, name),
      fill,
      clear: () => book.clear(),
      undo: () => book.undo(),
      /** Where landmark `i` of the live face is, in page pixels (null without a face). */
      landmarkScreen: (i: number) => {
        const f = faceRef.current;
        if (!f || f.surface.presence < 0.5) return null;
        const pos = f.geometry.getAttribute("position");
        f.group.updateWorldMatrix(true, false);
        const p = new Vector3()
          .fromBufferAttribute(pos, i)
          .applyMatrix4(f.group.matrixWorld)
          .project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        return {
          x: rect.left + ((p.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - p.y) / 2) * rect.height,
        };
      },
    };
    (window as unknown as Record<string, unknown>).__makeup = api;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { color, finish } = getTool();
      if (LOOK_KEYS[e.key]) api.look(LOOK_KEYS[e.key]);
      else if (FILL_KEYS[e.key]) fill(FILL_KEYS[e.key]);
      else if (e.key === "b") {
        book.apply(blushStroke(-1, color));
        book.apply(blushStroke(1, color));
      } else if (e.key === "n") {
        book.apply(linerStroke(-1, color));
        book.apply(linerStroke(1, color));
      } else if (e.key === "h") {
        book.apply(strokeOp(heartPath(-4.2, -1.2, 1.9), "m", color, finish, 1));
      } else if (e.key === "z") api.undo();
      else if (e.key === "x") api.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gl, camera]);
  return null;
};

export default DevKeys;
