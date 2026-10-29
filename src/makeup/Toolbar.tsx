// The makeup kit, in the control band at the bottom, wordless, on Night
// glass. Three rows, top to bottom:
//   colours    a scrolling row of glass swatches
//   tools      brush sizes · finishes (matte, satin, shimmer)
//   actions    undo · brush or fill · clear
// Nothing sits over the face.
import type { CSSProperties, ReactNode } from "react";
import { Html } from "@react-three/drei";

import {
  BRUSH_SIZES,
  FINISHES,
  PALETTE,
  swatchHex,
  type BrushSize,
  type Finish,
  type Mode,
} from "./palette";
import { paintBook, setTool, usePaintVersion, useTool } from "./state";

const ARLES = "#f4d968";
const CYPRESS = "#232528";

const CSS = `
.ms-root { position: absolute; inset: 0; pointer-events: none; color: #fff;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
.ms-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 240px;
  background: linear-gradient(rgb(35 37 40 / 0), rgb(35 37 40 / .6)); }
.ms-band { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom) + 24px); width: min(calc(100% - 32px), 400px);
  display: flex; flex-direction: column; gap: 10px; }
.ms-glass { background: rgb(35 37 40 / .64);
  backdrop-filter: blur(20px) saturate(1.5); -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgb(235 246 253 / .18);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / .22), 0 8px 24px rgb(0 0 0 / .22); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .ms-glass { background: rgb(35 37 40 / .82); } }
.ms-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ms-btn { pointer-events: auto; border: 0; padding: 0; margin: 0; color: inherit;
  display: grid; place-items: center; cursor: pointer; outline: none; touch-action: manipulation;
  transition: transform 160ms ease-out, background-color 160ms ease-out,
    box-shadow 160ms ease-out, opacity 160ms ease-out; }
.ms-btn:active { transform: scale(0.96); }
.ms-btn:focus-visible { box-shadow: 0 0 0 2px ${ARLES}; }
.ms-round { width: 44px; height: 44px; border-radius: 50%; flex: none; }
.ms-round.off { opacity: .45; }
.ms-seg { pointer-events: auto; display: flex; gap: 2px; padding: 3px; border-radius: 999px; flex: none;
  transition: opacity 160ms ease-out; }
.ms-seg.off { opacity: .4; pointer-events: none; }
.ms-seg .ms-btn { width: 38px; height: 38px; border-radius: 50%; background: transparent; }
.ms-seg .ms-btn.on { background: ${ARLES}; color: ${CYPRESS}; }
.ms-swatches { pointer-events: auto; display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; touch-action: pan-x; padding: 4px 2px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12px, #000 calc(100% - 24px), transparent);
  mask-image: linear-gradient(90deg, transparent, #000 12px, #000 calc(100% - 24px), transparent); }
.ms-swatches::-webkit-scrollbar { display: none; }
.ms-swatch { position: relative; }
.ms-swatch .ms-dot { position: absolute; inset: 6px; border-radius: 50%;
  box-shadow: inset 0 2px 4px rgb(255 255 255 / .35), inset 0 -3px 5px rgb(0 0 0 / .25); }
.ms-swatch.on { box-shadow: 0 0 0 2px ${ARLES}, inset 0 1px 1px rgb(255 255 255 / .22),
  0 8px 24px rgb(0 0 0 / .22); }
.ms-finish .ms-ball { width: 26px; height: 26px; border-radius: 50%; }
.ms-seg .ms-btn.ms-finish.on { background: transparent; box-shadow: inset 0 0 0 2px ${ARLES}; }
@media (prefers-reduced-motion: reduce) { .ms-btn:active { transform: none; } }
`;

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width={20}
    height={20}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const BrushIcon = () => (
  <Icon>
    <path d="M20 4 11.5 12.5" strokeWidth={2.4} />
    <path
      d="M10.6 13.4c-2.6-.3-4.6 1.4-4.6 3.8 0 1.3-.9 2.2-2 2.4 1.2.9 2.7 1.4 4.2 1.4 3 0 5-2 4.9-4.6Z"
      fill="currentColor"
    />
  </Icon>
);

const FillIcon = () => (
  <Icon>
    <path
      d="M12 3.5c3.3 4 5.6 7.3 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-3.1 2.3-6.4 5.6-10.4Z"
      fill="currentColor"
    />
  </Icon>
);

const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

const ClearIcon = () => (
  <Icon>
    <path d="M4 7h16" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
);

/** Dot sizes (px) for the three brush sizes. */
const SIZE_DOT: Record<BrushSize, number> = { s: 6, m: 11, l: 17 };

/** A little ball of the current colour in each finish. */
const finishBall = (finish: Finish, hex: string): CSSProperties => {
  const base = `radial-gradient(circle at 38% 34%, color-mix(in srgb, ${hex} 82%, white), ${hex} 55%, color-mix(in srgb, ${hex} 70%, black))`;
  const sheen =
    "radial-gradient(circle at 34% 28%, rgb(255 255 255 / .7), rgb(255 255 255 / 0) 34%)";
  const flecks = [
    [62, 30],
    [30, 62],
    [70, 66],
    [48, 46],
    [24, 40],
    [56, 78],
  ]
    .map(
      ([x, y]) =>
        `radial-gradient(circle at ${x}% ${y}%, #fff 0 1.2px, rgb(255 255 255 / 0) 1.8px)`,
    )
    .join(", ");
  if (finish === "matte")
    return {
      background: `radial-gradient(circle at 40% 36%, color-mix(in srgb, ${hex} 92%, white), ${hex} 70%, color-mix(in srgb, ${hex} 85%, black))`,
    };
  if (finish === "satin") return { background: `${sheen}, ${base}` };
  return { background: `${flecks}, ${sheen}, ${base}` };
};

const LABEL: Record<Mode | BrushSize | Finish, string> = {
  brush: "Brush",
  fill: "Fill an area",
  s: "Small brush",
  m: "Medium brush",
  l: "Large brush",
  matte: "Matte",
  satin: "Satin",
  shimmer: "Shimmer",
};

export const Toolbar = () => {
  const tool = useTool();
  usePaintVersion();
  const painted = !paintBook().empty;
  const hex = swatchHex(tool.color);

  return (
    <Html fullscreen zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
      <style>{CSS}</style>
      <div className="ms-root">
        <div className="ms-scrim" />
        <div className="ms-band">
          <div className="ms-swatches" role="radiogroup" aria-label="Colour">
            {PALETTE.map((s) => (
              <button
                type="button"
                key={s.id}
                role="radio"
                aria-checked={tool.color === s.id}
                aria-label={s.id}
                className={`ms-btn ms-round ms-glass ms-swatch ${tool.color === s.id ? "on" : ""}`}
                onClick={() => setTool({ color: s.id })}
              >
                <span className="ms-dot" style={{ background: s.hex }} />
              </button>
            ))}
          </div>

          <div className="ms-row">
            <div
              className={`ms-seg ms-glass ${tool.mode === "fill" ? "off" : ""}`}
              role="radiogroup"
              aria-label="Brush size"
            >
              {BRUSH_SIZES.map((size) => (
                <button
                  type="button"
                  key={size}
                  role="radio"
                  aria-checked={tool.size === size}
                  aria-label={LABEL[size]}
                  className={`ms-btn ${tool.size === size ? "on" : ""}`}
                  onClick={() => setTool({ size })}
                >
                  <span
                    style={{
                      width: SIZE_DOT[size],
                      height: SIZE_DOT[size],
                      borderRadius: "50%",
                      background: "currentColor",
                    }}
                  />
                </button>
              ))}
            </div>
            <div
              className="ms-seg ms-glass"
              role="radiogroup"
              aria-label="Finish"
            >
              {FINISHES.map((finish) => (
                <button
                  type="button"
                  key={finish}
                  role="radio"
                  aria-checked={tool.finish === finish}
                  aria-label={LABEL[finish]}
                  className={`ms-btn ms-finish ${tool.finish === finish ? "on" : ""}`}
                  onClick={() => setTool({ finish })}
                >
                  <span className="ms-ball" style={finishBall(finish, hex)} />
                </button>
              ))}
            </div>
          </div>

          <div className="ms-row">
            <button
              type="button"
              aria-label="Undo"
              className={`ms-btn ms-round ms-glass ${painted ? "" : "off"}`}
              onClick={() => paintBook().undo()}
            >
              <UndoIcon />
            </button>
            <div
              className="ms-seg ms-glass"
              role="radiogroup"
              aria-label="Tool"
            >
              {(["brush", "fill"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  role="radio"
                  aria-checked={tool.mode === mode}
                  aria-label={LABEL[mode]}
                  className={`ms-btn ${tool.mode === mode ? "on" : ""}`}
                  onClick={() => setTool({ mode })}
                >
                  {mode === "brush" ? <BrushIcon /> : <FillIcon />}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Clear"
              className={`ms-btn ms-round ms-glass ${painted ? "" : "off"}`}
              onClick={() => paintBook().clear()}
            >
              <ClearIcon />
            </button>
          </div>
        </div>
      </div>
    </Html>
  );
};
