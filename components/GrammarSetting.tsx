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

const primary =
  'px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50';
const secondary =
  'px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50';

export const GRAMMAR_QUESTION =
  'Check grammar with LanguageTool? Catches most of the remaining grammar slips (about 1 in 20 texts). Downloads about 300 MB, uses about 560 MB of disk. Recommended.';

/** Grammar checker status, kept up to date by the download events. */
export function useGrammar() {
  const [status, setStatus] = useState<GrammarStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    grammarStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => {});
    onGrammarStatus((s) => !cancelled && setStatus(s))
      .then((u) => (cancelled ? u() : (unlisten = u)))
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return {
    status,
    add: async () => setStatus(await installGrammar()),
    cancel: () => cancelGrammarInstall(),
    remove: async () => setStatus(await removeGrammar()),
  };
}

/** Progress bar of a running download, with cancel. */
export function GrammarProgress({ status, onCancel }: { status: GrammarStatus; onCancel: () => void }) {
  const percent = grammarPercent(status);
  return (
    <>
      <p className="text-gray-800">{formatGrammarProgress(status)}</p>
      <div
        className="h-3 w-full bg-gray-200 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className="h-full bg-blue-600 transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <button className={secondary} onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}

/** Settings row: add or remove the grammar checker. */
export default function GrammarSetting({ disabled = false }: { disabled?: boolean }) {
  const { status, add, cancel, remove } = useGrammar();
  const [diskMB, setDiskMB] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const install = status?.install;
  useEffect(() => {
    if (install === 'installed') grammarDiskBytes().then((b) => setDiskMB(Math.round(b / 1e6)));
  }, [install]);

  if (!status) return null;
  return (
    <section className="bg-white rounded-xl shadow border border-gray-100 p-6 space-y-4" aria-live="polite">
      <h2 className="text-lg font-semibold text-gray-900">Grammar check</h2>
      {status.install === 'installing' ? (
        <GrammarProgress status={status} onCancel={cancel} />
      ) : status.install === 'installed' ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-gray-700">
            LanguageTool is on{diskMB !== null ? ` (${diskMB} MB on disk)` : ''}. Every text gets a final grammar check.
          </p>
          <button
            className={secondary}
            disabled={disabled || busy}
            onClick={async () => {
              setBusy(true);
              await remove().finally(() => setBusy(false));
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <>
          {status.install === 'failed' && <p className="text-red-700">{status.message}</p>}
          <div className="flex items-center justify-between gap-4">
            <p className="text-gray-700">LanguageTool is off: the model checks its own grammar. Adding it downloads about 300 MB (about 560 MB on disk).</p>
            <button className={primary} disabled={disabled} onClick={add}>
              Add
            </button>
          </div>
        </>
      )}
    </section>
  );
}
