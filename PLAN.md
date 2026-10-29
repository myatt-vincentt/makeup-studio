# Plan

Makeup Studio: paint your own makeup on your face with a finger, or tap an area
to colour it. From a sheer everyday look to bold face paint.

## How it works

- **Paint on the face.** The paint lives in three textures laid out like the
  SDK's face atlas, one per finish (matte, satin, shimmer). The SDK draws each
  on the live face mesh (`MakeupDesign` with a custom material), so the paint
  follows every move and expression.
- **Looks like makeup.** The paint is shaded against the person's own skin and
  light. A thin layer filters the skin like a tint (stain, wash); built-up
  paint covers like face paint, still lit and textured by the skin. Shimmer
  adds fine glitter flecks that catch the light.
- **Brush.** A stroke is a run of soft round dabs placed on the face, sized in
  centimetres on the skin. Within a stroke the dabs keep their strongest value,
  so a stroke is even; strokes build up over each other.
- **Fill.** Lips, cheeks (blush), upper lids (shadow), lash line (liner with a
  flick) and brows, as soft masks described on the canonical face.
- **Controls.** In the bottom control band, wordless, on Night glass: colours,
  brush sizes, finishes, undo, brush or fill, clear.

## Steps

1. Looks: the paint layer, fills, finishes, demo strokes and the controls laid
   out. Done.
2. Finger painting and tap-to-fill, undo, hold to compare, photo capture.
