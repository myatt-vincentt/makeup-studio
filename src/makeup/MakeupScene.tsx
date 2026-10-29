// Makeup Studio: paint your own makeup on your face. The paint sits on the
// live face (PaintLayers.tsx), your finger paints it (PaintInput.tsx) and the
// kit sits in the control band (Toolbar.tsx).
import { PaintInput } from "./PaintInput";
import { PaintLayers } from "./PaintLayers";
import { Toolbar } from "./Toolbar";

export const MakeupScene = () => (
  <>
    <PaintLayers />
    <PaintInput />
    <Toolbar />
  </>
);
