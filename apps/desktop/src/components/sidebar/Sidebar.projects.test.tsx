import { screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useRuntimeStore } from "@/lib/runtime";
import { renderAt } from "@/test/render";

const PROJECT = {
  id: "p1",
  name: "BCI Trends",
  createdAt: 1,
  path: "/base/BCI-Trends",
  imported: false,
  pinned: false,
};

const makeProject = (id: string, name: string, extra = {}) => ({
  id,
  name,
  createdAt: 1,
  path: `/base/${id}`,
  imported: false,
  pinned: false,
  ...extra,
});

const row = (id: string, title: string, directory?: string, extra = {}) => ({
  id,
  title,
  directory,
  ...extra,
});

const expectInOrder = (labels: string[]) => {
  const elements = labels.map((label) => projectButton(label));
  for (let i = 0; i < elements.length - 1; i++) {
    expect(elements[i].compareDocumentPosition(elements[i + 1])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }
};

const projectButton = (name: string): HTMLElement => {
  const button = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.trim().startsWith(name));
  expect(button, `Expected project button for ${name}`).toBeDefined();
  return button!;
};
const projectBlock = (name: string) => screen.getByRole("group", { name });
type RuntimePatch = Partial<ReturnType<typeof useRuntimeStore.getState>>;

const setRuntimeState = (state: RuntimePatch) => {
  act(() => {
    useRuntimeStore.setState(state);
  });
};

afterEach(() => {
  window.localStorage.removeItem("ai4s.collapsedProjects");
  setRuntimeState({ projects: [], sessions: [], workspace: null, hiddenExamples: [] });
});

describe("Sidebar projects", () => {
  it("shows all projects instead of limiting recent projects", async () => {
    setRuntimeState({
      projects: [1, 2, 3, 4, 5, 6, 7].map((n) =>
        makeProject(`p${n}`, `Project ${n}`, { createdAt: n }),
      ),
    });
    renderAt("/files");

    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(await screen.findByText(`Project ${n}`)).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /See all projects/i })).not.toBeInTheDocument();
    expect(screen.queryByText("+2")).not.toBeInTheDocument();
  });

  it("groups only exact-root top-level sessions and keeps child, missing-directory, and subagent rows out of projects", async () => {
    setRuntimeState({
      projects: [PROJECT],
      sessions: [
        row("root", "root session", PROJECT.path, { updated: 10 }),
        row("child-dir", "child directory session", `${PROJECT.path}/run-1`, { updated: 20 }),
        row("missing-dir", "missing directory session", undefined, { updated: 30 }),
        row("subagent", "subagent session", PROJECT.path, { parentId: "root", updated: 40 }),
      ],
    });
    renderAt("/files");

    expect(await screen.findByText("BCI Trends")).toBeInTheDocument();
    expect(screen.getByText("root session")).toBeInTheDocument();
    expect(screen.getByText("child directory session")).toBeInTheDocument();
    expect(screen.getByText("missing directory session")).toBeInTheDocument();
    expect(screen.queryByText("subagent session")).not.toBeInTheDocument();

    const projectScope = within(projectBlock("BCI Trends"));
    expect(projectScope.getByText("root session")).toBeInTheDocument();
    expect(projectScope.queryByText("child directory session")).not.toBeInTheDocument();
    expect(projectScope.queryByText("missing directory session")).not.toBeInTheDocument();
  });

  it("groups sessions whose path only differs by a trailing separator", async () => {
    setRuntimeState({
      projects: [PROJECT],
      sessions: [row("trailing", "trailing slash session", `${PROJECT.path}/`, { updated: 100 })],
    });
    renderAt("/files");

    expect(
      await within(projectBlock("BCI Trends")).findByText("trailing slash session"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("trailing slash session")).toHaveLength(1);
  });

  it("groups Windows sessions when the project path uses a verbatim prefix", async () => {
    setRuntimeState({
      projects: [
        makeProject("windows", "Windows project", {
          path: String.raw`\\?\D:\OpenScience\Windows-project`,
        }),
      ],
      workspace: String.raw`D:\OpenScience\Windows-project`,
      sessions: [
        row(
          "windows-session",
          "Windows archived session",
          String.raw`D:\OpenScience\Windows-project`,
          { updated: 100 },
        ),
      ],
    });
    renderAt("/files");

    const block = await screen.findByRole("group", { name: "Windows project" });
    expect(within(block).getByText("Windows archived session")).toBeInTheDocument();
    expect(screen.getAllByText("Windows archived session")).toHaveLength(1);
    expect(projectButton("Windows project").querySelector(".text-accent")).toBeTruthy();
  });

  it("groups Windows sessions across verbatim and ordinary UNC paths", async () => {
    setRuntimeState({
      projects: [
        makeProject("unc", "UNC project", {
          path: String.raw`\\?\UNC\server\share\UNC-project`,
        }),
      ],
      sessions: [
        row(
          "unc-session",
          "UNC archived session",
          String.raw`\\server\share\UNC-project`,
          { updated: 100 },
        ),
      ],
    });
    renderAt("/files");

    expect(
      await within(projectBlock("UNC project")).findByText("UNC archived session"),
    ).toBeInTheDocument();
  });

  it("reflows exact-root sessions as projects are dynamically added and removed", async () => {
    const moving = row("moving", "auto archived", PROJECT.path, { updated: 100 });
    setRuntimeState({ projects: [], sessions: [moving] });
    renderAt("/files");

    expect(await screen.findByText("auto archived")).toBeInTheDocument();
    expect(screen.queryByText("BCI Trends")).not.toBeInTheDocument();
    expect(screen.getAllByText("auto archived")).toHaveLength(1);

    setRuntimeState({ projects: [PROJECT] });

    expect(await screen.findByText("BCI Trends")).toBeInTheDocument();
    expect(within(projectBlock("BCI Trends")).getByText("auto archived")).toBeInTheDocument();
    expect(screen.getAllByText("auto archived")).toHaveLength(1);

    setRuntimeState({ projects: [] });

    expect(screen.queryByText("BCI Trends")).not.toBeInTheDocument();
    expect(screen.getByText("auto archived")).toBeInTheDocument();
    expect(screen.getAllByText("auto archived")).toHaveLength(1);
  });

  it("sorts pinned projects first, then project recency, with stable name and id ties", async () => {
    setRuntimeState({
      projects: [
        makeProject("z-pin", "Zeta pinned", { pinned: true, createdAt: 1 }),
        makeProject("beta", "Beta", { createdAt: 50 }),
        makeProject("alpha-b", "Alpha", { createdAt: 10 }),
        makeProject("alpha-a", "Alpha", { createdAt: 10 }),
        makeProject("old", "Old", { createdAt: 1 }),
      ],
      sessions: [
        row("old-root", "old root", "/base/old", { updated: 500 }),
        row("beta-root", "beta root", "/base/beta", { updated: 300 }),
        row("alpha-a-root", "alpha-a root", "/base/alpha-a", { updated: 10 }),
        row("alpha-b-root", "alpha-b root", "/base/alpha-b", { updated: 10 }),
      ],
    });
    renderAt("/files");

    await screen.findByText("Zeta pinned");
    expectInOrder(["Zeta pinned", "Old", "Beta"]);
    const alphaBlocks = screen.getAllByRole("group", { name: "Alpha" });
    expect(alphaBlocks).toHaveLength(2);
    expect(within(alphaBlocks[0]).getByText("alpha-a root")).toBeInTheDocument();
    expect(within(alphaBlocks[1]).getByText("alpha-b root")).toBeInTheDocument();
  });

  it("uses a session created time for project recency when updated is missing", async () => {
    setRuntimeState({
      projects: [
        makeProject("session-created", "Session-created recency", { createdAt: 10 }),
        makeProject("project-created", "Project-created fallback", { createdAt: 100 }),
      ],
      sessions: [
        row("created-only", "created only", "/base/session-created", { created: 500 }),
      ],
    });
    renderAt("/files");

    await screen.findByText("Session-created recency");
    expectInOrder(["Session-created recency", "Project-created fallback"]);
  });

  it("keeps collapsed project sessions out of keyboard focus", async () => {
    const user = userEvent.setup();
    setRuntimeState({
      projects: [PROJECT],
      sessions: [row("root", "inside project", PROJECT.path, { updated: 10 })],
    });
    renderAt("/files");

    const button = await screen.findByRole("button", { name: /^BCI Trends/ });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");

    const collapsed = screen.getByRole("link", { name: "inside project", hidden: true }).closest("[aria-hidden]");
    expect(collapsed).toHaveAttribute("inert", "");
    button.focus();
    expect(button).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "inside project", hidden: true })).not.toHaveFocus();
  });

  it("collapse hides only project sessions and examples remain after loose real sessions", async () => {
    const user = userEvent.setup();
    setRuntimeState({
      projects: [PROJECT],
      sessions: [
        row("root", "inside project", PROJECT.path, { updated: 10 }),
        row("loose", "loose real session", "/base/loose", { updated: 20 }),
      ],
    });
    renderAt("/files");

    await screen.findByText("BCI Trends");
    const button = projectButton("BCI Trends");
    const projectSession = screen.getByText("inside project");
    expect(projectSession.closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(projectSession.closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("loose real session")).toBeInTheDocument();

    const loose = screen.getByText("loose real session");
    const example = screen.getByText("Cross-species atlas figure");
    expect(loose.compareDocumentPosition(example)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("groups sessions into their project and keeps the rest loose", async () => {
    setRuntimeState({
      projects: [PROJECT],
      sessions: [
        { id: "in", title: "paper search", directory: PROJECT.path },
        { id: "out", title: "quick question", directory: "/base/2026-07-01-0900" },
        // Subagent sessions never get a row, project or not.
        { id: "child", title: "subtask", directory: PROJECT.path, parentId: "in" },
      ],
    });
    renderAt("/files");

    expect(await screen.findByText("BCI Trends")).toBeInTheDocument();
    // Both groups render their sessions; the child session does not appear.
    expect(screen.getByText("paper search")).toBeInTheDocument();
    expect(screen.getByText("quick question")).toBeInTheDocument();
    expect(screen.queryByText("subtask")).not.toBeInTheDocument();
    // The project offers its own "new session" entry point.
    expect(
      screen.getByRole("button", { name: "New session in BCI Trends" }),
    ).toBeInTheDocument();
  });

  it("offers a new-project entry when no projects exist yet", async () => {
    renderAt("/files");
    // Header [+] (the add-project menu trigger) plus the ghost row.
    expect((await screen.findAllByRole("button", { name: "New project" })).length).toBeGreaterThan(0);
  });

  it("badges an imported project (referenced in place, not auto-committed)", async () => {
    setRuntimeState({
      projects: [{ ...PROJECT, id: "p2", name: "My Repo", path: "/home/me/my-repo", imported: true }],
    });
    renderAt("/files");
    expect(await screen.findByText("My Repo")).toBeInTheDocument();
    expect(screen.getByText("imported")).toBeInTheDocument();
  });
});
