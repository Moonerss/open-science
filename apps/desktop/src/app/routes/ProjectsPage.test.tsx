import { screen, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRuntimeStore } from "@/lib/runtime";
import { renderAt } from "@/test/render";

const base = {
  createdAt: 1_000,
  imported: false,
  pinned: false,
};

afterEach(() => useRuntimeStore.setState({ projects: [], sessions: [] }));

describe("ProjectsPage", () => {
  it("lists projects, filters by search, and expands sessions", async () => {
    useRuntimeStore.setState({
      projects: [
        { ...base, id: "p1", name: "Alpha", path: "/base/alpha-dir" },
        { ...base, id: "p2", name: "Beta", path: "/home/me/beta-repo", imported: true },
      ],
      sessions: [
        { id: "s1", title: "first pass", directory: "/base/alpha-dir", updated: 2_000 },
        { id: "s2", title: "second pass", directory: "/base/alpha-dir", updated: 3_000 },
      ],
    });
    renderAt("/projects");
    // Scope to the page's main region — the sidebar also lists project names.
    await screen.findByPlaceholderText("Search projects");
    const page = within(screen.getByRole("main"));

    // Both projects render; the imported one carries the source folder name.
    expect(page.getByText("Alpha")).toBeInTheDocument();
    expect(page.getByText("Beta")).toBeInTheDocument();
    expect(page.getByText("beta-repo")).toBeInTheDocument(); // Sources chip = folder basename

    // Sessions are hidden until the project row is expanded.
    expect(page.queryByText("first pass")).not.toBeInTheDocument();
    fireEvent.click(page.getByRole("button", { name: "Alpha" }));
    expect(page.getByText("second pass")).toBeInTheDocument();
    expect(page.getByText("first pass")).toBeInTheDocument();

    // Search filters the list by name.
    fireEvent.change(screen.getByPlaceholderText("Search projects"), {
      target: { value: "bet" },
    });
    expect(page.queryByText("Alpha")).not.toBeInTheDocument();
    expect(page.getByText("Beta")).toBeInTheDocument();
  });

  it("shows an empty state when the search matches nothing", async () => {
    useRuntimeStore.setState({
      projects: [{ ...base, id: "p1", name: "Alpha", path: "/base/Alpha" }],
    });
    renderAt("/projects");
    fireEvent.change(await screen.findByPlaceholderText("Search projects"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No projects match.")).toBeInTheDocument();
  });

  it("expands only exact top-level sessions in newest-first order", async () => {
    useRuntimeStore.setState({
      projects: [{ ...base, id: "p1", name: "Alpha", path: "/base/alpha-dir" }],
      sessions: [
        { id: "older", title: "older exact session", directory: "/base/alpha-dir", updated: 2_000 },
        { id: "trailing", title: "trailing slash session", directory: "/base/alpha-dir/", updated: 3_000 },
        { id: "child-dir", title: "child directory session", directory: "/base/alpha-dir/child", updated: 5_000 },
        {
          id: "subagent",
          title: "subagent session",
          directory: "/base/alpha-dir",
          parentId: "older",
          updated: 6_000,
        },
        { id: "newer", title: "newer exact session", directory: "/base/alpha-dir", updated: 4_000 },
      ],
    });

    renderAt("/projects");
    await screen.findByPlaceholderText("Search projects");
    const page = within(screen.getByRole("main"));

    fireEvent.click(page.getByRole("button", { name: "Alpha" }));

    const newer = page.getByText("newer exact session");
    const trailing = page.getByText("trailing slash session");
    const older = page.getByText("older exact session");
    expect(page.queryByText("child directory session")).not.toBeInTheDocument();
    expect(page.queryByText("subagent session")).not.toBeInTheDocument();
    expect(newer.compareDocumentPosition(trailing)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(trailing.compareDocumentPosition(older)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("uses session created time when sorting sessions and project recency without updated", async () => {
    useRuntimeStore.setState({
      projects: [
        { ...base, id: "old-project", name: "Old project", path: "/base/old-project", createdAt: 100 },
        { ...base, id: "created-only", name: "Created-only latest", path: "/base/created-only", createdAt: 10 },
      ],
      sessions: [
        { id: "older", title: "older created session", directory: "/base/created-only", created: 300 },
        { id: "newer", title: "newer created session", directory: "/base/created-only", created: 500 },
      ],
    });

    renderAt("/projects");
    await screen.findByPlaceholderText("Search projects");
    const page = within(screen.getByRole("main"));

    const createdOnly = page.getByRole("button", { name: "Created-only latest" });
    const oldProject = page.getByRole("button", { name: "Old project" });
    expect(createdOnly.compareDocumentPosition(oldProject)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(createdOnly);
    const newer = page.getByText("newer created session");
    const older = page.getByText("older created session");
    expect(newer.compareDocumentPosition(older)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
