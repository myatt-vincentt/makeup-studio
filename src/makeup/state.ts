// What the controls show: the picked colour, brush or fill, brush size and
// finish. A tiny store the controls read with useSyncExternalStore.
import { useSyncExternalStore } from "react";

import { PALETTE, type BrushSize, type Finish, type Mode } from "./palette";
import { PaintBook } from "./paint";

export type Tool = {
  color: string;
  mode: Mode;
  size: BrushSize;
  finish: Finish;
};

let tool: Tool = {
  color: PALETTE[1].id,
  mode: "brush",
  size: "m",
  finish: "satin",
};
const listeners = new Set<() => void>();

export const getTool = () => tool;

export const setTool = (patch: Partial<Tool>) => {
  tool = { ...tool, ...patch };
  listeners.forEach((fn) => fn());
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const useTool = () => useSyncExternalStore(subscribe, getTool, getTool);

/** The paint on the face, shared by the layers, the controls and the dev keys. */
let book: PaintBook | null = null;
export const paintBook = () => {
  if (!book) book = new PaintBook();
  return book;
};

/** Re-renders when the paint changes (for the clear button's state). */
export const usePaintVersion = () => {
  const b = paintBook();
  return useSyncExternalStore(
    (fn) => b.subscribe(fn),
    () => b.version,
    () => b.version,
  );
};
