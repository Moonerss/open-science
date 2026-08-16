import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertLeaf, leaves, makeLeaf, useLayoutStore } from "@/lib/layout";
import { PaneTree } from "./PaneTree";

vi.mock("./SessionView", () => ({
  SessionView: ({ onClose }: { onClose?: () => void }) => (
    <button onClick={onClose} disabled={!onClose}>
      Request close
    </button>
  ),
}));

/** What LiveSessionPage renders: every screen mounted, the active one shown. */
function Screens() {
  const groups = useLayoutStore((s) => s.groups);
  const activeGroupId = useLayoutStore((s) => s.activeGroupId);
  return (
    <>
      {groups.map((g) => (
        <div key={g.id} hidden={g.id !== activeGroupId}>
          <PaneTree group={g} active={g.id === activeGroupId} laidOut />
        </div>
      ))}
    </>
  );
}

describe("PaneTree panel close", () => {
  beforeEach(() => {
    const first = makeLeaf("session-a");
    const tree = insertLeaf(first, first.id, "right", makeLeaf("session-b"));
    useLayoutStore.setState({
      groups: [{ id: "screen-a", name: "", tree, focusedLeafId: first.id, zoomedLeafId: null }],
      activeGroupId: "screen-a",
      tree,
      focusedLeafId: first.id,
      zoomedLeafId: null,
      ephemeralGroupId: null,
    });
  });

  it("keeps a Session panel until the user confirms", async () => {
    render(<Screens />);
    await userEvent.click(screen.getAllByRole("button", { name: "Request close" })[0]);
    expect(screen.getByRole("alertdialog", { name: "Close this panel?" })).toBeInTheDocument();
    expect(leaves(useLayoutStore.getState().tree!)).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(leaves(useLayoutStore.getState().tree!)).toHaveLength(1);
  });
});
