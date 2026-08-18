import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Terminal } from "lucide-react";
import { Row, Section } from "@/components/settings/Section";
import { chipCls } from "@/components/settings/inputCls";
import { toast } from "@/lib/toast";
import { getCliShimStatus, installCliShim, isTauri, type CliShimStatus } from "@/lib/tauri";

/** Where the wrapper goes. Shown while the real answer is still on its way from
 *  the backend, which resolves the same path from the user's home directory. */
const DEFAULT_SHIM = "~/.local/bin/osd";

/** Settings → Remote Access → the terminal command. The installer already
 *  carries `osd` next to the app binary; this puts a wrapper on the user's PATH
 *  (a wrapper, not a symlink — see `cli_shim.rs`) and, when that folder is not
 *  on PATH, shows the one line that fixes it. The app never edits PATH itself. */
export function TerminalCliCard() {
  const { t } = useTranslation(["settings"]);
  const [status, setStatus] = useState<CliShimStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void getCliShimStatus().then(setStatus);
  }, []);
  useEffect(refresh, [refresh]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("remote.copied"));
    } catch {
      /* Clipboard denied: the line is on screen to copy by hand. */
    }
  };

  const install = () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        const next = await installCliShim();
        if (next) setStatus(next);
        toast.success(t("cli.installed"));
      } catch (e) {
        toast.error(`${t("cli.error")}: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    })();
  };

  if (!isTauri) return null;

  const available = Boolean(status?.binary);
  return (
    <Section title={t("cli.title")} hint={t("cli.hint")} flush>
      <Row
        title={
          <span className="inline-flex items-center gap-2">
            <Terminal size={13} className="shrink-0 text-muted" />
            <code className="font-mono text-[12.5px]">{status?.shim ?? DEFAULT_SHIM}</code>
          </span>
        }
        hint={
          !available
            ? t("cli.unavailable")
            : status?.occupied
              ? t("cli.occupied")
              : status?.installed
                ? t("cli.installed")
                : t("cli.notInstalled")
        }
        control={
          <button
            type="button"
            className={chipCls("shrink-0")}
            disabled={busy || !available || status?.occupied}
            onClick={install}
          >
            {status?.installed ? (
              <span className="inline-flex items-center gap-1.5">
                <Check size={13} />
                {t("cli.reinstall")}
              </span>
            ) : (
              t("cli.install")
            )}
          </button>
        }
      >
        {/* A wrapper nobody can reach is not installed in any useful sense, so
            the PATH line is shown whenever the folder is missing from PATH —
            before installing as much as after. */}
        {available && status?.pathHint && (
          <div className="mt-2.5">
            <p className="text-xs leading-relaxed text-muted">{t("cli.pathHint")}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto whitespace-pre rounded-input bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-text">
                {status.pathHint}
              </code>
              <button
                type="button"
                className="rounded-input p-2 text-muted transition-colors hover:bg-surface-2 hover:text-text"
                aria-label={t("remote.copy")}
                title={t("remote.copy")}
                onClick={() => void copy(status.pathHint ?? "")}
              >
                <Copy size={15} />
              </button>
            </div>
          </div>
        )}
      </Row>
    </Section>
  );
}
