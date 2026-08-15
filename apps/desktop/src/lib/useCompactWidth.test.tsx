import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useCompactWidth } from "./useCompactWidth";

/**
 * The hook used to start at "wide" and correct itself from the ResizeObserver's
 * first callback, which arrives after paint — so every mount of a narrow pane
 * drew the labels and dropped them a frame later. Switching to a Screen with
 * tiled panes remounts these, so it flashed on every switch. jsdom has no
 * layout and no ResizeObserver, which is exactly the case that isolates the
 * FIRST measurement: whatever the initial render shows is what the user sees
 * before any observer could fire.
 */
function Probe({ minPx }: { minPx: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const compact = useCompactWidth(ref, minPx);
  return (
    <div ref={ref} data-testid="box">
      {compact ? "icon" : "icon+label"}
    </div>
  );
}

const withWidth = (px: number) => {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: px, height: 0, top: 0, left: 0, right: px, bottom: 0, x: 0, y: 0 }),
  });
};

describe("useCompactWidth", () => {
  it("is already compact on the first paint of a narrow element", () => {
    withWidth(200);
    render(<Probe minPx={420} />);
    // Exact, not toHaveTextContent: that matches substrings, and "icon+label"
    // contains "icon" — the assertion would hold either way.
    expect(screen.getByTestId("box").textContent).toBe("icon");
  });

  it("keeps the labels when the element is wide enough", () => {
    withWidth(900);
    render(<Probe minPx={420} />);
    expect(screen.getByTestId("box").textContent).toBe("icon+label");
  });
});
