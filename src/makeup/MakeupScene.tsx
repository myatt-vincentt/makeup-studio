// Makeup Studio: paint your own makeup on your face. The paint sits on the
// live face (PaintLayers.tsx) and the kit sits in the control band
// (Toolbar.tsx).
import { PaintLayers } from "./PaintLayers";
import { Toolbar } from "./Toolbar";

export const MakeupScene = () => (
  <>
    <PaintLayers />
    <Toolbar />
  </>
);
