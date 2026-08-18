import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliShimStatus } from "@/lib/tauri";
import { TerminalCliCard } from "./TerminalCliCard";

const state = vi.hoisted(() => ({ current: null as CliShimStatus | null }));
const install = vi.hoisted(() => vi.fn(async () => state.current));

vi.mock("@/lib/tauri", () => ({
  isTauri: true,
  getCliShimStatus: async () => state.current,
  installCliShim: (...a: []) => install(...a),
}));

const status = (over: Partial<CliShimStatus> = {}): CliShimStatus => ({
  binary: "/Applications/Open Science.app/Contents/MacOS/osd",
  shim: "/Users/x/.local/bin/osd",
  installed: false,
  occupied: false,
  onPath: true,
  pathHint: null,
  ...over,
});

beforeEach(() => {
  install.mockClear();
  state.current = status();
});

describe("Settings → the terminal command", () => {
  it("installs the wrapper and reports where it went", async () => {
    const user = userEvent.setup();
    render(<TerminalCliCard />);
    await waitFor(() => expect(screen.getByText("/Users/x/.local/bin/osd")).toBeInTheDocument());
    expect(screen.getByText("Not installed yet.")).toBeInTheDocument();

    state.current = status({ installed: true });
    await user.click(screen.getByRole("button", { name: "Install command" }));

    expect(install).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByText(/Installed — open a new terminal/)).toBeInTheDocument(),
    );
  });

  it("shows the PATH line when the folder is not on PATH — a wrapper nobody can reach is not installed", async () => {
    state.current = status({
      installed: true,
      onPath: false,
      pathHint: 'export PATH="/Users/x/.local/bin:$PATH"',
    });
    render(<TerminalCliCard />);
    await waitFor(() =>
      expect(screen.getByText('export PATH="/Users/x/.local/bin:$PATH"')).toBeInTheDocument(),
    );
  });

  it("refuses to overwrite a file it did not write", async () => {
    state.current = status({ occupied: true });
    render(<TerminalCliCard />);
    await waitFor(() =>
      expect(screen.getByText(/A file this app did not write/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Install command" })).toBeDisabled();
  });

  it("says so plainly when the build carries no osd, instead of offering a broken button", async () => {
    state.current = status({ binary: null });
    render(<TerminalCliCard />);
    await waitFor(() =>
      expect(screen.getByText("This build does not carry the osd command.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Install command" })).toBeDisabled();
  });
});
