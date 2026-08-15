import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftKeyFor, inheritedDraftFolder, useRuntimeStore } from "@/lib/runtime";
import { DraftDestination } from "./DraftDestination";

const mocks = vi.hoisted(() => ({ pickedFolder: null as string | null }));

vi.mock("@/lib/tauri", () => ({
  isTauri: true,
  logDebug: async () => {},
  detectTools: async () => [],
  startRuntime: async () => "http://127.0.0.1:1",
  workspacePath: async () => "/ws/base",
  setWorkspace: async (path: string) => path,
  newDatedWorkspace: async (name: string) => `/ws/${name}`,
  pickFolder: async () => mocks.pickedFolder,
  getApprovalMode: async () => "approve",
  setApprovalMode: async () => {},
}));
vi.mock("@/lib/kernel", () => ({ kernelReset: async () => {} }));

const KEY = draftKeyFor("leaf-2");

describe("DraftDestination", () => {
  beforeEach(() => {
    mocks.pickedFolder = null;
    useRuntimeStore.setState({
      draftWorkspaces: {},
      draftOrigins: {},
      sendingSessions: {},
      sessions: [],
      workspace: "/ws/base",
    });
  });

  it("offers the folder the pane was split from, selected", () => {
    useRuntimeStore.setState({
      draftOrigins: { [KEY]: "/ws/bci-trends" },
      draftWorkspaces: { [KEY]: "/ws/bci-trends" },
    });
    render(<DraftDestination draftKey={KEY} />);

    expect(screen.getByRole("button", { name: /Continue in bci-trends/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /New folder/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  // The whole point of the card: "new folder" must be reachable in one click AND
  // reversible. Clearing the origin along with the aim would make it one-way.
  it("switches to a dated folder and back", async () => {
    useRuntimeStore.setState({
      draftOrigins: { [KEY]: "/ws/bci-trends" },
      draftWorkspaces: { [KEY]: "/ws/bci-trends" },
    });
    render(<DraftDestination draftKey={KEY} />);

    await userEvent.click(screen.getByRole("button", { name: /New folder/ }));
    expect(useRuntimeStore.getState().draftWorkspaces[KEY]).toBeUndefined();
    expect(screen.getByRole("button", { name: /New folder/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: /Continue in bci-trends/ }));
    expect(useRuntimeStore.getState().draftWorkspaces[KEY]).toBe("/ws/bci-trends");
  });

  it("a hand-picked folder replaces the inherited one rather than adding a third home", async () => {
    mocks.pickedFolder = "/ws/mine";
    useRuntimeStore.setState({
      draftOrigins: { [KEY]: "/ws/bci-trends" },
      draftWorkspaces: { [KEY]: "/ws/bci-trends" },
    });
    render(<DraftDestination draftKey={KEY} />);

    await userEvent.click(screen.getByRole("button", { name: /Choose another folder/ }));
    await waitFor(() => expect(useRuntimeStore.getState().draftWorkspaces[KEY]).toBe("/ws/mine"));
    expect(screen.getByRole("button", { name: /Continue in mine/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText(/bci-trends/)).not.toBeInTheDocument();
  });

  // A pane the user opened on its own has nothing to continue — one destination,
  // so no chooser (the composer's folder chip still overrides it).
  it("stays out of the way for a draft that was not split off anything", () => {
    const { container } = render(<DraftDestination draftKey={KEY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("locks while the pane's own first message is in flight", () => {
    useRuntimeStore.setState({
      draftOrigins: { [KEY]: "/ws/bci-trends" },
      draftWorkspaces: { [KEY]: "/ws/bci-trends" },
      sendingSessions: { [KEY]: true },
    });
    render(<DraftDestination draftKey={KEY} />);
    expect(screen.getByRole("button", { name: /New folder/ })).toBeDisabled();
  });
});

describe("inheritedDraftFolder", () => {
  const state = {
    sessions: [{ id: "ses_1", directory: "/ws/bci-trends" }],
    draftWorkspaces: { [draftKeyFor("leaf-9")]: "/ws/aimed" },
  } as unknown as Parameters<typeof inheritedDraftFolder>[1];

  it("takes a bound pane's session folder", () => {
    expect(inheritedDraftFolder({ leafId: "leaf-1", sessionId: "ses_1" }, state)).toBe(
      "/ws/bci-trends",
    );
  });

  it("takes an unbound pane's own aim, so a chain of splits keeps the folder", () => {
    expect(inheritedDraftFolder({ leafId: "leaf-9", sessionId: null }, state)).toBe("/ws/aimed");
  });

  // Splitting a pane that would itself make a dated folder propagates exactly
  // that — not the active workspace, which follows whatever was last opened (#69).
  it("propagates 'new folder' as null", () => {
    expect(inheritedDraftFolder({ leafId: "leaf-x", sessionId: null }, state)).toBeNull();
    expect(inheritedDraftFolder({ leafId: "leaf-1", sessionId: "ses_gone" }, state)).toBeNull();
    expect(inheritedDraftFolder(null, state)).toBeNull();
  });
});
