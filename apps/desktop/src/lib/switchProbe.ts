import { logDebug } from "./tauri";

/**
 * How long a Screen switch takes to reach the glass, split into the phases that
 * have different cures, in debug.log:
 *
 *   screen switch: total=71ms react=5ms effects=44ms paint=22ms warm
 *
 * `react`   — the store update, every component that re-rendered, and the
 *             layout effects of that commit (which force layout).
 * `effects`  — what the app then does off the back of the switch: openSession,
 *             stream re-binding, per-pane queries. Not the browser's work.
 * `paint`    — what is left: the browser laying out and painting the frame.
 * `warm`/`cold` — whether the incoming Screen still had its layout.
 *
 * Screens stay mounted, so none of this is a rebuild — it is the cost of
 * revealing one, and the split says which phase to attack.
 */
let startedAt = 0;
let committedAt = 0;
let armed = false;

/** From the tab click, before the store update that switches screens. */
export function beginScreenSwitch(): void {
  startedAt = performance.now();
  armed = true;
}

/** From the layout effect of the commit that reveals the incoming Screen. */
export function markScreenSwitchCommit(): void {
  if (armed) committedAt = performance.now();
}

/** From the LAST passive effect of that same commit. */
export function markScreenSwitchEffects(warm: boolean): void {
  if (!armed) return;
  armed = false;
  const afterEffects = performance.now();
  // Two frames: the first runs before the paint this commit triggers, the
  // second once that paint is on screen.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const painted = performance.now();
      const ms = (from: number, to: number) => Math.round(to - from);
      void logDebug(
        // eslint-disable-next-line i18next/no-literal-string -- diagnostic line, not UI copy
        `screen switch: total=${ms(startedAt, painted)}ms react=${ms(startedAt, committedAt)}ms ` +
          `effects=${ms(committedAt, afterEffects)}ms paint=${ms(afterEffects, painted)}ms ` +
          `${warm ? "warm" : "cold"}`,
      );
    }),
  );
}
