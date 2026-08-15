import { useState } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { isTauri, pickFolder } from "@/lib/tauri";
import { baseName } from "@/components/thread/WorkspaceChip";
import { datedWorkspaceName, useRuntimeStore } from "@/lib/runtime";

/**
 * Where an empty pane's session will be created, offered while the choice still
 * costs nothing. A split continues the work in front of you, so the pane starts
 * in the folder it was split from; this is what makes the other answer — a fresh
 * dated folder, which used to be the only one — a single click instead of a trip
 * through the native picker.
 *
 * Only shown for a pane that was split off another (it has an origin). A lone
 * draft has nothing to continue, so its one destination needs no chooser; the
 * composer's folder chip still overrides it.
 *
 * Nothing here touches the filesystem or the active folder: it records the
 * pane's intent, and the first message acts on it. A pane closed without sending
 * creates nothing at all.
 */
export function DraftDestination({ draftKey }: { draftKey: string }) {
  const { t } = useTranslation("session");
  const origin = useRuntimeStore((s) => s.draftOrigins[draftKey]);
  const aimed = useRuntimeStore((s) => s.draftWorkspaces[draftKey]);
  const aimDraft = useRuntimeStore((s) => s.aimDraft);
  const sending = useRuntimeStore((s) => !!s.sendingSessions[draftKey]);
  const [busy, setBusy] = useState(false);

  if (!isTauri || !origin) return null;

  // Three states, one selected: continue in the origin, start a dated folder, or
  // sit in a folder the user picked by hand (which replaces the origin option so
  // the card never claims two homes at once).
  const elsewhere = aimed && aimed !== origin ? aimed : null;
  const continueIn = elsewhere ?? origin;
  const inheriting = !!aimed;

  const choose = async () => {
    const dir = await pickFolder();
    if (!dir) return; // cancelled — keep the current destination
    setBusy(true);
    try {
      aimDraft(draftKey, dir);
    } finally {
      setBusy(false);
    }
  };

  const option = (selected: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-input px-2.5 py-2 text-left text-sm",
      "border transition-colors disabled:opacity-60",
      selected
        ? "border-accent/40 bg-accent/10 text-text"
        : "border-transparent text-muted hover:bg-surface-2 hover:text-text",
    );

  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-card">
      <div className="px-0.5 pb-2 text-xs text-muted">{t("draftDestination.title")}</div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className={option(inheriting)}
          onClick={() => aimDraft(draftKey, continueIn)}
          disabled={busy || sending}
          aria-pressed={inheriting}
        >
          <FolderOpen size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t("draftDestination.continueIn", { name: baseName(continueIn) })}
          </span>
        </button>
        <button
          type="button"
          className={option(!inheriting)}
          onClick={() => aimDraft(draftKey, null)}
          disabled={busy || sending}
          aria-pressed={!inheriting}
        >
          <FolderPlus size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t("draftDestination.newFolder")}</span>
          <span className="shrink-0 font-mono text-xs text-muted">{datedWorkspaceName()}</span>
        </button>
      </div>
      <button
        type="button"
        className="mt-1 rounded-input px-2.5 py-1 text-xs text-muted hover:text-text disabled:opacity-60"
        onClick={() => void choose()}
        disabled={busy || sending}
      >
        {t("draftDestination.chooseOther")}
      </button>
    </div>
  );
}
