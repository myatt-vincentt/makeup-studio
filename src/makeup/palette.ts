// The kit: paint colours, brush sizes, finishes and the face areas a fill
// can colour. Pure data, shared by the paint, the controls and the demos.

/** A paint colour: from soft everyday shades to bold face-paint brights. */
export type Swatch = { id: string; hex: string };

export const PALETTE: readonly Swatch[] = [
  { id: "nude", hex: "#c98b78" },
  { id: "rose", hex: "#d4637d" },
  { id: "coral", hex: "#f2705e" },
  { id: "red", hex: "#c4122f" },
  { id: "berry", hex: "#8c2251" },
  { id: "plum", hex: "#5a2a57" },
  { id: "bronze", hex: "#8a5530" },
  { id: "espresso", hex: "#3b2a22" },
  { id: "black", hex: "#141113" },
  { id: "white", hex: "#f6f2ec" },
  { id: "gold", hex: "#e0ae48" },
  { id: "pink", hex: "#ff4fa3" },
  { id: "lilac", hex: "#9b6cf0" },
  { id: "sky", hex: "#3aa6f2" },
  { id: "mint", hex: "#2fbf8f" },
];

export const swatchHex = (id: string) =>
  (PALETTE.find((s) => s.id === id) ?? PALETTE[0]).hex;

/** How paint looks on the skin. */
export type Finish = "matte" | "satin" | "shimmer";
export const FINISHES: readonly Finish[] = ["matte", "satin", "shimmer"];

/** Brush or fill. */
export type Mode = "brush" | "fill";

/**
 * Brush sizes, on the face: radius in cm, how hard the edge is (1 = crisp,
 * 0 = all feather) and how much paint one stroke lays down (strokes build up).
 * Small is for liner and detail, medium for face paint, large for blush.
 */
export type BrushSize = "s" | "m" | "l";
export const BRUSH_SIZES: readonly BrushSize[] = ["s", "m", "l"];
export const BRUSH: Record<
  BrushSize,
  { radius: number; hardness: number; flow: number }
> = {
  s: { radius: 0.07, hardness: 0.55, flow: 0.9 },
  m: { radius: 0.2, hardness: 0.5, flow: 0.85 },
  l: { radius: 1.4, hardness: 0, flow: 0.45 },
};

/** The face areas a fill colours. */
export type FillArea = "lips" | "cheeks" | "lids" | "liner" | "brows";
export const FILL_AREAS: readonly FillArea[] = [
  "lips",
  "cheeks",
  "lids",
  "liner",
  "brows",
];

/** Paint laid down by one fill tap; tap again to build it up. */
export const FILL_FLOW: Record<FillArea, number> = {
  lips: 0.6,
  cheeks: 0.55,
  lids: 0.6,
  liner: 0.95,
  brows: 0.5,
};
