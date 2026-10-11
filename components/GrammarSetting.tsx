'use client';

import { useEffect, useState } from 'react';
import {
  cancelGrammarInstall,
  formatGrammarProgress,
  grammarDiskBytes,
  grammarPercent,
  grammarStatus,
  installGrammar,
  onGrammarStatus,
  removeGrammar,
  type GrammarStatus,
} from '@/lib/grammar';
import { primary, ProgressBar, secondary, Spinner } from './ui';

export const GRAMMAR_QUESTION =
  'Check grammar with LanguageTool? Catches most of the remaining grammar slips (about 1 in 20 texts). Downloads about 300 MB, uses about 560 MB of disk. Recommended.';

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Grammar checker status, kept up to date by the download events. */
export function useGrammar() {
  const [status, setStatus] = useState<GrammarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    grammarStatus()
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((err) => setError(message(err)));

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    grammarStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch((err) => !cancelled && setError(message(err)));
    onGrammarStatus((s) => !cancelled && setStatus(s))
      .then((u) => (cancelled ? u() : (unlisten = u)))
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const run = async (call: () => Promise<GrammarStatus>) => {
    setError(null);
    try {
      setStatus(await call());
    } catch (err) {
      setError(message(err));
    }
  };

  return {
    status,
    error,
    refresh,
    add: () => run(installGrammar),
    cancel: () => cancelGrammarInstall().catch(() => {}),
    remove: () => run(removeGrammar),
  };
}

/** Progress of a running download, with cancel. Steps without a byte count show a spinner. */
export function GrammarProgress({ status, onCancel }: { status: GrammarStatus; onCancel: () => void }) {
  const percent = grammarPercent(status);
  const counted = status.progress?.step === 'download' && !!status.progress.total;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {!counted && <Spinner />}
        <p className="text-fg-muted">{formatGrammarProgress(status) || 'Preparing the download'}</p>
      </div>
      {counted && <ProgressBar percent={percent} />}
      <button className={secondary} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

interface GrammarSettingProps {
  enabled: boolean;
  onEnabledChange: (on: boolean) => void;
  /** A generation runs: removing LanguageTool now would break its checks. */
  busy?: boolean;
  /** Called after an add or remove finished, so disk numbers can refresh. */
  onDiskChange?: () => void;
}

/** Settings group: grammar check on or off, add or remove LanguageTool. */
export default function GrammarSetting({ enabled, onEnabledChange, busy = false, onDiskChange }: GrammarSettingProps) {
  const { status, error, refresh, add, cancel, remove } = useGrammar();
  const [diskMB, setDiskMB] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  const install = status?.install;
  useEffect(() => {
    if (install === 'installed') grammarDiskBytes().then((b) => setDiskMB(Math.round(b / 1e6)));
    if (install === 'installed' || install === 'missing') onDiskChange?.();
    // Reacts to install changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [install]);

  if (!status) {
    return error ? (
      <div className="space-y-2">
        <p className="text-danger">{error}</p>
        <button className={secondary} onClick={refresh}>
          Try again
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-3 text-fg-muted">
        <Spinner /> Checking LanguageTool
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-live="polite">
      {status.install === 'installing' ? (
        <GrammarProgress status={status} onCancel={cancel} />
      ) : status.install === 'installed' ? (
        <>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 w-4 h-4 accent-accent"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
            />
            <span>
              <span className="block font-medium text-fg">Check grammar with LanguageTool</span>
              <span className="block text-sm text-fg-subtle">
                {enabled ? 'Every text gets a final grammar check.' : 'Off: the model checks its own grammar.'}
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              LanguageTool is installed{diskMB !== null ? ` (${diskMB} MB on disk)` : ''}.
            </p>
            <button
              className={secondary}
              disabled={busy || removing}
              title={busy ? 'Wait until the text is ready.' : undefined}
              onClick={async () => {
                setRemoving(true);
                await remove().finally(() => setRemoving(false));
              }}
            >
              {removing ? (
                <span className="flex items-center gap-2">
                  <Spinner className="w-4 h-4" /> Removing
                </span>
              ) : (
                'Remove'
              )}
            </button>
          </div>
        </>
      ) : (
        <>
          {status.install === 'failed' && <p className="text-danger">{status.message}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted min-w-0 flex-1">
              LanguageTool is not installed: the model checks its own grammar. Adding it downloads about 300 MB (about
              560 MB on disk).
            </p>
            <button className={primary} disabled={busy} onClick={add}>
              {status.install === 'failed' ? 'Try again' : 'Add'}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-danger text-sm">{error}</p>}
    </div>
  );
}
