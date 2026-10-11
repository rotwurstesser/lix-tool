'use client';

import { useEffect, useRef, useState } from 'react';
import { freeDiskBytes, modelsDiskBytes, setSettings } from '@/lib/backend';
import {
  diskCheck,
  formatGB,
  formatProgress,
  formatSpeed,
  ModelManager,
  PullError,
  PULL_MESSAGES,
  type PullProgress,
} from '@/lib/model-manager';
import { nextStep, type SetupEvent, type SetupStep } from '@/lib/setup';
import { debugLog } from '@/lib/tauri';
import { GRAMMAR_QUESTION, GrammarProgress, useGrammar } from './GrammarSetting';

interface SetupProps {
  baseUrl: string;
  initial: SetupStep;
  /** Debug autotest: start the download and finish without clicks. */
  auto?: boolean;
  onDone: () => void;
  onBackendFailed: (message: string) => void;
}

type Download =
  | { phase: 'idle' }
  | { phase: 'running'; progress: PullProgress | null }
  | { phase: 'paused' }
  | { phase: 'error'; message: string };

const card = 'bg-white rounded-xl shadow-lg border border-gray-100 p-8 space-y-6';
const primary =
  'px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';
const secondary =
  'px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400';

export default function Setup({ baseUrl, initial, auto = false, onDone, onBackendFailed }: SetupProps) {
  const [step, setStep] = useState<SetupStep>(initial);
  const [download, setDownload] = useState<Download>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const grammar = useGrammar();
  // Set by "Add": the step moves on once the install finishes.
  const [grammarRequested, setGrammarRequested] = useState(false);

  const go = async (event: SetupEvent) => {
    const next = nextStep(step, event);
    setStep(next);
    // Save first: the app must not leave setup before the step is stored. A failed save
    // only means the "Ready" screen shows once more on the next start.
    await setSettings({ setupStep: next }).catch(() => {});
    if (next === 'done') onDone();
  };

  const startDownload = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setDownload({ phase: 'running', progress: null });
    // A resumed download needs only the rest of the model.
    const [free, onDisk] = await Promise.all([freeDiskBytes(), modelsDiskBytes()]);
    const disk = diskCheck(free, onDisk);
    if (!disk.ok) {
      setDownload({
        phase: 'error',
        message: `Not enough disk space. The writing model needs ${formatGB(disk.needBytes)} GB free, this Mac has ${formatGB(disk.freeBytes ?? 0)} GB.`,
      });
      return;
    }
    const mm = new ModelManager(baseUrl);
    let logged = -10;
    try {
      await mm.pull((progress) => {
        setDownload({ phase: 'running', progress });
        if (auto && progress.percent !== null && progress.percent - logged >= 10) {
          logged = progress.percent;
          debugLog(`setup pull ${progress.percent.toFixed(1)}% ${formatProgress(progress)} ${formatSpeed(progress.bytesPerSec)}`);
        }
      }, ctrl.signal);
      if (!(await mm.isInstalled())) throw new PullError('other', 'model not listed after pull');
      setDownload({ phase: 'idle' });
      if (auto) debugLog('setup pull done');
      setStep((s) => {
        const next = nextStep(s, 'modelInstalled');
        setSettings({ setupStep: next }).catch(() => {});
        return next;
      });
    } catch (err) {
      if (ctrl.signal.aborted) {
        setDownload({ phase: 'paused' });
      } else if (err instanceof PullError && err.kind === 'backend') {
        onBackendFailed(PULL_MESSAGES.backend);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        if (auto) debugLog(`setup pull failed ${message}`);
        setDownload({ phase: 'error', message });
      }
    } finally {
      abortRef.current = null;
    }
  };

  const addGrammar = () => {
    setGrammarRequested(true);
    grammar.add();
  };

  useEffect(() => {
    if (step === 'grammar' && grammarRequested && grammar.status?.install === 'installed') {
      if (auto) debugLog('setup grammar installed');
      go('grammarDone');
    }
    if (auto && grammar.status?.install === 'failed') debugLog(`setup grammar failed ${grammar.status.message}`);
    // Reacts to install changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, grammarRequested, grammar.status?.install]);

  // Debug autotest: run the steps without clicks.
  const autoRan = useRef(false);
  const autoGrammar = useRef(false);
  useEffect(() => {
    if (!auto) return;
    if (step === 'welcome') {
      go('start');
    } else if (step === 'model' && !autoRan.current) {
      autoRan.current = true;
      startDownload();
    } else if (step === 'grammar' && grammar.status && !autoGrammar.current) {
      // Autotest takes the recommended answer.
      autoGrammar.current = true;
      debugLog('setup grammar add');
      addGrammar();
    } else if (step === 'ready') {
      const timer = setTimeout(() => go('finish'), 1500);
      return () => clearTimeout(timer);
    }
    // Reacts to step changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, step, grammar.status === null]);

  // Stop a running download when the screen goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <main className="min-h-screen bg-gray-50 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight text-center">LIX Writer</h1>

        {step === 'welcome' && (
          <section className={card}>
            <h2 className="text-xl font-semibold text-gray-900">Welcome</h2>
            <p className="text-gray-700">
              LIX Writer writes German children&apos;s texts at the reading level you choose, on this Mac.
            </p>
            <p className="text-gray-700">Setup needs about 4.6 GB and an internet connection once.</p>
            <button
              className={primary}
              autoFocus
              onClick={() => {
                go('start');
                startDownload();
              }}
            >
              Start setup
            </button>
          </section>
        )}

        {step === 'model' && (
          <section className={card} aria-live="polite">
            <h2 className="text-xl font-semibold text-gray-900">Writing model</h2>
            {download.phase === 'idle' && (
              <>
                <p className="text-gray-700">The app needs its writing model (4.3 GB) before you can write texts.</p>
                <button className={primary} autoFocus onClick={startDownload}>
                  Download the writing model
                </button>
              </>
            )}
            {download.phase === 'running' && (
              <>
                <p className="text-gray-800">{download.progress ? formatProgress(download.progress) : 'Checking disk space'}</p>
                <div
                  className="h-3 w-full bg-gray-200 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(download.progress?.percent ?? 0)}
                >
                  <div
                    className="h-full bg-blue-600 transition-[width] duration-500"
                    style={{ width: `${download.progress?.percent ?? 0}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>
                    {download.progress?.percent != null ? `${Math.floor(download.progress.percent)}%` : ''}
                  </span>
                  <span>{formatSpeed(download.progress?.bytesPerSec ?? null)}</span>
                </div>
                <button className={secondary} onClick={() => abortRef.current?.abort()}>
                  Cancel
                </button>
              </>
            )}
            {download.phase === 'paused' && (
              <>
                <p className="text-gray-700">Download stopped. It continues where it stopped.</p>
                <button className={primary} autoFocus onClick={startDownload}>
                  Continue download
                </button>
              </>
            )}
            {download.phase === 'error' && (
              <>
                <p className="text-red-700">{download.message}</p>
                <button className={primary} autoFocus onClick={startDownload}>
                  Try again
                </button>
              </>
            )}
          </section>
        )}

        {step === 'grammar' && grammar.status && (
          <section className={card} aria-live="polite">
            <h2 className="text-xl font-semibold text-gray-900">Grammar checker</h2>
            {grammar.status.install === 'installing' ? (
              <GrammarProgress status={grammar.status} onCancel={grammar.cancel} />
            ) : grammar.status.install === 'installed' && !grammarRequested ? (
              <>
                <p className="text-gray-700">LanguageTool is already installed.</p>
                <button className={primary} autoFocus onClick={() => go('grammarDone')}>
                  Continue
                </button>
              </>
            ) : (
              <>
                <p className="text-gray-700">{GRAMMAR_QUESTION}</p>
                {grammar.status.install === 'failed' && <p className="text-red-700">{grammar.status.message}</p>}
                {grammar.status.install === 'missing' && grammar.status.message && (
                  <p className="text-gray-500">{grammar.status.message}</p>
                )}
                <div className="flex gap-3">
                  <button className={primary} autoFocus onClick={addGrammar}>
                    {grammar.status.install === 'failed' ? 'Try again' : 'Add'}
                  </button>
                  <button className={secondary} onClick={() => go('grammarDone')}>
                    Skip
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {step === 'ready' && (
          <section className={card}>
            <h2 className="text-xl font-semibold text-gray-900">Ready</h2>
            <p className="text-gray-700">
              The writing model is installed{grammar.status?.install === 'installed' ? ', and LanguageTool checks the grammar' : ''}.
              The app now works without internet.
            </p>
            <button className={primary} autoFocus onClick={() => go('finish')}>
              Start writing
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
