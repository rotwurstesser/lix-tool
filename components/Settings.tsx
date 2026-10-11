'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getSettings, modelsDiskBytes, openDataDir, setSettings } from '@/lib/backend';
import { grammarDiskBytes } from '@/lib/grammar';
import { formatProgress, formatSpeed, ModelManager, PullError, PULL_MESSAGES, type PullProgress } from '@/lib/model-manager';
import {
  applyTheme,
  DEFAULT_PREFS,
  MEMORY_OPTIONS,
  prefsReducer,
  settingsPatch,
  THEME_OPTIONS,
  type Prefs,
  type PrefsAction,
} from '@/lib/settings';
import GrammarSetting from './GrammarSetting';
import { danger, primary, ProgressBar, secondary, Spinner } from './ui';

/**
 * Preferences, loaded from settings.json and saved on every change. The theme applies at once;
 * a failed save keeps the change for this session and returns the error.
 */
export function usePrefs() {
  const [prefs, dispatch] = useReducer(prefsReducer, DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        dispatch({ type: 'loaded', settings });
        applyTheme(prefsReducer(DEFAULT_PREFS, { type: 'loaded', settings }).theme, document.documentElement);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const change = useCallback((action: PrefsAction) => {
    dispatch(action);
    if (action.type === 'theme') applyTheme(action.theme, document.documentElement);
    const patch = settingsPatch(action);
    if (!patch) return;
    setSaveError(null);
    setSettings(patch).catch((err) => setSaveError(`Not saved: ${err instanceof Error ? err.message : String(err)}`));
  }, []);

  return { prefs, loaded, change, saveError };
}

type Redownload =
  | { phase: 'idle' }
  | { phase: 'confirm' }
  | { phase: 'running'; progress: PullProgress | null }
  | { phase: 'stopped'; message: string }
  | { phase: 'done' };

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  prefs: Prefs;
  onChange: (action: PrefsAction) => void;
  saveError: string | null;
  baseUrl: string;
  /** A generation runs: storage actions wait. */
  busy: boolean;
  /** The model is gone after a stopped re-download: the app shows the setup download step. */
  onModelMissing: () => void;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 py-5 border-t border-line first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

/** Radio buttons that look like a segmented control. Arrow keys move between them. */
function Segmented<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-line bg-surface-2 p-1 gap-1">
      {options.map((o) => (
        <label
          key={o.value}
          className={`px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
            value === o.value ? 'bg-accent text-on-accent font-medium' : 'text-fg-muted hover:text-fg hover:bg-line'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function gb(bytes: number | null): string {
  if (bytes === null) return '…';
  if (bytes === 0) return 'not installed';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

export default function Settings({ open, onClose, prefs, onChange, saveError, baseUrl, busy, onModelMissing }: SettingsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [disk, setDisk] = useState<{ model: number | null; grammar: number | null }>({ model: null, grammar: null });
  const [redownload, setRedownload] = useState<Redownload>({ phase: 'idle' });
  const [folderError, setFolderError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloading = redownload.phase === 'running';

  const loadDisk = useCallback(() => {
    Promise.all([modelsDiskBytes(), grammarDiskBytes()]).then(([model, grammar]) => setDisk({ model, grammar }));
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      loadDisk();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, loadDisk]);

  const close = () => {
    if (downloading) return;
    if (redownload.phase === 'stopped') onModelMissing();
    setRedownload((r) => (r.phase === 'done' || r.phase === 'confirm' ? { phase: 'idle' } : r));
    setFolderError(null);
    onClose();
  };

  const startRedownload = async () => {
    if (busy) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRedownload({ phase: 'running', progress: null });
    const mm = new ModelManager(baseUrl);
    try {
      await mm.remove();
      loadDisk();
      await mm.pull((progress) => setRedownload({ phase: 'running', progress }), ctrl.signal);
      if (!(await mm.isInstalled())) throw new PullError('other', 'The model is not listed after the download.');
      setRedownload({ phase: 'done' });
    } catch (err) {
      const message = ctrl.signal.aborted
        ? 'Download stopped. The model is incomplete: continue the download to write texts again.'
        : err instanceof PullError
          ? `${PULL_MESSAGES[err.kind]} (${err.message})`
          : String(err);
      setRedownload({ phase: 'stopped', message });
    } finally {
      abortRef.current = null;
      loadDisk();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="settings-title"
      onCancel={(e) => {
        // Esc closes, except while the model downloads.
        e.preventDefault();
        close();
      }}
      className="mx-auto mt-4 sm:mt-12 w-[min(560px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-6rem)] rounded-xl border border-line bg-surface text-fg shadow-card p-0 overflow-hidden backdrop:bg-black/45"
    >
      <div className="flex max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-6rem)] flex-col">
        <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-line">
          <h2 id="settings-title" className="text-lg font-semibold">
            Settings
          </h2>
          <button className={`${secondary} px-3 py-1.5 text-sm`} onClick={close} disabled={downloading}>
            Done
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          <Group title="Appearance">
            <Segmented
              name="theme"
              label="Theme"
              value={prefs.theme}
              options={THEME_OPTIONS}
              onChange={(theme) => onChange({ type: 'theme', theme })}
            />
          </Group>

          <Group title="Memory">
            <p className="text-sm text-fg-muted">
              Free the memory when the app is idle. The writing model uses about 4 GB of RAM while it is loaded;
              LanguageTool stops after the same time (at least 30 s).
            </p>
            <Segmented
              name="memory"
              label="Free the memory"
              value={prefs.memory}
              options={MEMORY_OPTIONS}
              onChange={(memory) => onChange({ type: 'memory', memory })}
            />
            {prefs.memory === 'now' && (
              <p className="text-sm text-fg-subtle">Each text then starts a few seconds slower.</p>
            )}
          </Group>

          <Group title="Grammar">
            <GrammarSetting
              enabled={prefs.grammarEnabled}
              onEnabledChange={(on) => onChange({ type: 'grammarEnabled', on })}
              busy={busy}
              onDiskChange={loadDisk}
            />
          </Group>

          <Group title="Storage">
            <dl className="text-sm divide-y divide-line rounded-lg border border-line">
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-fg-muted">Writing model</dt>
                <dd className="font-medium">{gb(disk.model)}</dd>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-fg-muted">LanguageTool</dt>
                <dd className="font-medium">{gb(disk.grammar)}</dd>
              </div>
            </dl>

            {redownload.phase === 'confirm' && (
              <div className="rounded-lg border border-warn-line bg-warn-soft p-4 space-y-3 text-sm text-warn">
                <p>
                  This deletes the writing model and downloads it again (4.3 GB, needs internet). Use it when texts
                  fail with a model error.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button className={danger} autoFocus disabled={busy} onClick={startRedownload}>
                    Delete and download
                  </button>
                  <button className={secondary} onClick={() => setRedownload({ phase: 'idle' })}>
                    Keep the model
                  </button>
                </div>
              </div>
            )}
            {redownload.phase === 'running' && (
              <div className="space-y-3" aria-live="polite">
                <div className="flex items-center gap-3">
                  {!redownload.progress?.percent && <Spinner />}
                  <p className="text-sm text-fg-muted">
                    {redownload.progress ? formatProgress(redownload.progress) : 'Deleting the old model'}
                  </p>
                </div>
                <ProgressBar percent={redownload.progress?.percent ?? 0} />
                <div className="flex items-center justify-between text-sm text-fg-subtle">
                  <span>{redownload.progress?.percent != null ? `${Math.floor(redownload.progress.percent)}%` : ''}</span>
                  <span>{formatSpeed(redownload.progress?.bytesPerSec ?? null)}</span>
                </div>
                <button className={secondary} onClick={() => abortRef.current?.abort()}>
                  Cancel
                </button>
              </div>
            )}
            {redownload.phase === 'stopped' && (
              <div className="space-y-3" aria-live="polite">
                <p className="text-sm text-danger">{redownload.message}</p>
                <button className={primary} autoFocus onClick={startRedownload}>
                  Continue download
                </button>
              </div>
            )}
            {redownload.phase === 'done' && <p className="text-sm text-success">The writing model is downloaded again.</p>}

            <div className="flex flex-wrap gap-3">
              {(redownload.phase === 'idle' || redownload.phase === 'done') && (
                <button
                  className={secondary}
                  disabled={busy}
                  title={busy ? 'Wait until the text is ready.' : undefined}
                  onClick={() => setRedownload({ phase: 'confirm' })}
                >
                  Re-download model
                </button>
              )}
              <button
                className={secondary}
                onClick={() => {
                  setFolderError(null);
                  openDataDir().catch((err) => setFolderError(err instanceof Error ? err.message : String(err)));
                }}
              >
                Open data folder
              </button>
            </div>
            {folderError && <p className="text-sm text-danger">{folderError}</p>}
          </Group>

          {saveError && <p className="text-sm text-danger pt-2">{saveError}</p>}
        </div>
      </div>
    </dialog>
  );
}

