'use client';

import { useEffect, useRef, useState } from 'react';
import GeneratorForm from '@/components/GeneratorForm';
import ResultDisplay from '@/components/ResultDisplay';
import SettingsPanel, { usePrefs } from '@/components/Settings';
import Setup from '@/components/Setup';
import { card, focusRing, primary, secondary, Spinner } from '@/components/ui';
import { backendStatus, DEFAULT_KEEP_ALIVE, getSettings, restartBackend, setSettings, waitForBackend, type Settings } from '@/lib/backend';
import { OllamaClient } from '@/lib/generate/client';
import { generateText, type GenerateResult, type LoopEvent } from '@/lib/generate/loop';
import { browserSpellChecker } from '@/lib/generate/spell-tauri';
import { grammarChecker, installGrammar, removeGrammar } from '@/lib/grammar';
import { MODEL, ModelManager } from '@/lib/model-manager';
import { restartPhase, startupPhase, type Phase, type StartupDeps } from '@/lib/startup';
import { parseDebugScreen, type DebugScreen } from '@/lib/debug-screens';
import { keepAliveFor, type Prefs, type PrefsAction } from '@/lib/settings';
import { debugAutotestTopic, debugLog, debugScreen } from '@/lib/tauri';
import { GenerationParams } from '@/types';

const STEP_LABELS: Record<LoopEvent['type'], string> = {
  draft: 'Draft',
  title: 'Title',
  edit: 'Edit',
  grammar: 'Grammar pass',
  repair: 'Grammar repair',
  done: 'Done',
};

function progressText(e: LoopEvent): string {
  const parts = [STEP_LABELS[e.type] + (e.n ? ` ${e.n}` : '')];
  if (e.lix !== undefined) parts.push(`LIX ${e.lix}`);
  parts.push(`${Math.round(e.elapsedMs / 1000)} s`);
  return parts.join(' · ');
}

// Waits for the bundled Ollama, then shows the setup until the model is installed.
export default function Home() {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [auto, setAuto] = useState(false);
  const [screen, setScreen] = useState<DebugScreen | null>(null);
  const { prefs, loaded, change, saveError } = usePrefs();

  const deps: StartupDeps = {
    waitForBackend: () => waitForBackend(),
    getSettings,
    isInstalled: (url) => new ModelManager(url).isInstalled(),
    restartBackend,
  };

  const show = (next: Phase) => {
    debugLog(next.kind === 'failed' ? `backend failed: ${next.message}` : `phase ${next.kind}`);
    setPhase(next);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [topic, screenName] = await Promise.all([debugAutotestTopic(), debugScreen()]);
      const debug = parseDebugScreen(screenName);
      if (!cancelled) {
        setAuto(!!topic);
        setScreen(debug);
      }
      let next = await startupPhase(deps);
      // Debug screenshots: show the asked screen once the engine runs.
      if (debug?.kind === 'setup' && next.kind !== 'failed' && next.kind !== 'starting') {
        next = { kind: 'setup', url: next.url, step: debug.step };
      }
      if (!cancelled) show(next);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    setPhase({ kind: 'starting' });
    show(await restartPhase(deps));
  };

  // Setup finished: go straight to the generator, do not read the saved step back.
  const setupDone = async (url: string) => {
    const settings = await getSettings().catch(() => ({}) as Settings);
    show({ kind: 'generator', url, keepAlive: settings.keepAlive ?? DEFAULT_KEEP_ALIVE });
  };

  if (phase.kind === 'setup') {
    return (
      <Setup
        baseUrl={phase.url}
        initial={phase.step}
        auto={auto}
        debugDownload={screen?.kind === 'setup' ? screen.download : undefined}
        onDone={() => setupDone(phase.url)}
        onBackendFailed={(message) => setPhase({ kind: 'failed', message })}
      />
    );
  }
  if (phase.kind === 'generator') {
    return (
      <Generator
        url={phase.url}
        keepAlive={loaded ? keepAliveFor(prefs.memory) : phase.keepAlive}
        prefs={prefs}
        onPrefsChange={change}
        saveError={saveError}
        debug={screen?.kind === 'generator' ? screen : null}
        onBackendLost={(message) => show({ kind: 'failed', message })}
        onModelMissing={() => {
          setSettings({ setupStep: 'model' }).catch(() => {});
          show({ kind: 'setup', url: phase.url, step: 'model' });
        }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-bg py-16 px-4">
      <div className={`${card} max-w-xl mx-auto p-8 space-y-4`} aria-live="polite">
        {phase.kind === 'starting' ? (
          <div className="flex items-center gap-3">
            <Spinner />
            <p className="text-fg-muted">Starting the writing engine…</p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-danger">The writing engine does not start</h2>
            <EngineError message={phase.message} />
            <button autoFocus onClick={retry} className={primary}>
              Try again
            </button>
          </>
        )}
      </div>
    </main>
  );
}

// The Rust side appends " Log: <last log lines>". The teacher sees the plain message; the log stays folded.
function EngineError({ message }: { message: string }) {
  const at = message.indexOf(' Log: ');
  const text = at < 0 ? message : message.slice(0, at);
  const log = at < 0 ? '' : message.slice(at + 6);
  return (
    <>
      <p className="text-fg-muted break-words">{text} Quit the app and open it again. If it still fails, restart the Mac.</p>
      {log && (
        <details className="text-sm text-fg-subtle">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-2 break-words font-mono text-xs">{log}</p>
        </details>
      )}
    </>
  );
}

interface GeneratorProps {
  url: string;
  keepAlive: string;
  prefs: Prefs;
  onPrefsChange: (action: PrefsAction) => void;
  saveError: string | null;
  debug: Extract<DebugScreen, { kind: 'generator' }> | null;
  onBackendLost: (message: string) => void;
  onModelMissing: () => void;
}

function Generator({ url, keepAlive, prefs, onPrefsChange, saveError, debug, onBackendLost, onModelMissing }: GeneratorProps) {
  const [result, setResult] = useState<GenerateResult | null>(debug?.result ?? null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [lixPath, setLixPath] = useState<number[]>([]);
  const [lastParams, setLastParams] = useState<GenerationParams | null>(
    debug?.result ? { topic: 'eine Hexe', lix: 26, sentences: 10, tolerance: 0.5 } : null,
  );
  const [settingsOpen, setSettingsOpen] = useState(!!debug?.settings);
  const abortRef = useRef<AbortController | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Keep the running progress in view on small windows.
  useEffect(() => {
    if (isLoading) progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [isLoading]);

  const handleGenerate = async (params: GenerationParams): Promise<GenerateResult | null> => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setResult(null);
    setError(undefined);
    setLixPath([]);
    setProgress('Starting the model…');
    setLastParams(params);
    debugLog(`generate keep_alive=${keepAlive} grammar=${prefs.grammarEnabled ? 'on' : 'off'}`);

    // "Immediately" keeps the model loaded between the calls of one text and unloads it when the text is done.
    const unloadAfter = keepAlive === '0';
    const client = new OllamaClient(url, MODEL, unloadAfter ? '5m' : keepAlive);
    try {
      // LanguageTool when installed and on, else the model's own grammar check.
      const grammar = await grammarChecker(prefs.grammarEnabled);
      const res = await generateText(
        { topic: params.topic, targetLix: params.lix, sentences: params.sentences, tolerance: params.tolerance },
        { client, spell: browserSpellChecker(), grammar },
        (e) => {
          setProgress(progressText(e));
          if ((e.type === 'title' || e.type === 'edit' || e.type === 'grammar') && e.lix !== undefined) {
            setLixPath((prev) => [...prev, e.lix as number]);
          }
        },
        ctrl.signal,
      );
      if (!res.sentences.length) setError('The model returned no usable story. Please try again.');
      else setResult(res);
      return res;
    } catch (err: unknown) {
      if (ctrl.signal.aborted) {
        setError('Cancelled.');
      } else {
        console.error('Error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        setError(`${msg} (Ollama at ${url}, model ${MODEL})`);
        // A dead engine needs a restart, not a new generation: show the engine screen.
        const status = await backendStatus().catch(() => null);
        if (status?.state === 'failed') onBackendLost(status.message);
      }
      return null;
    } finally {
      if (unloadAfter) client.unload().catch((err) => console.error('Unload failed:', err));
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  // Debug builds: LIX_SCREEN=settings:<steps> runs settings steps, 5 s apart, and logs each one.
  useEffect(() => {
    const actions = debug?.actions ?? [];
    let cancelled = false;
    (async () => {
      for (const action of actions) {
        await new Promise((r) => setTimeout(r, 5000));
        if (cancelled) return;
        debugLog(`action ${action} start`);
        try {
          if (action === 'theme-dark' || action === 'theme-light') {
            onPrefsChange({ type: 'theme', theme: action === 'theme-dark' ? 'dark' : 'light' });
          } else if (action === 'grammar-remove') {
            await removeGrammar();
          } else {
            await installGrammar();
          }
          debugLog(`action ${action} done`);
        } catch (err) {
          debugLog(`action ${action} failed ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debug builds of the app: LIX_AUTOTEST=<topic> runs one generation and prints the result to stdout.
  useEffect(() => {
    let cancelled = false;
    debugAutotestTopic().then(async (topic) => {
      if (!topic || cancelled) return;
      debugLog(`autotest start origin=${window.location.origin} ollama=${url}`);
      try {
        const res = await fetch(`${url}/api/version`);
        debugLog(`fetch-probe ok status=${res.status} body=${(await res.text()).trim()}`);
      } catch (err) {
        debugLog(`fetch-probe failed ${err instanceof Error ? err.message : String(err)}`);
      }
      const t0 = Date.now();
      const res = await handleGenerate({ topic, lix: 30, sentences: 10, tolerance: 0.5 });
      const secs = Math.round((Date.now() - t0) / 1000);
      if (res) {
        debugLog(
          `autotest done lix=${res.lix} hit=${res.hit} sentences=${res.sentences.length} unknown=${res.unknownWords.length} ` +
            `repairs=${res.repairs} grammarIssues=${res.grammarIssues.length} secs=${secs} title=${res.title}`,
        );
      } else {
        debugLog(`autotest failed secs=${secs}`);
      }
    });
    return () => {
      cancelled = true;
    };
    // Runs once on start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-bg py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h1 className="text-3xl font-extrabold text-fg tracking-tight">LIX Writer</h1>
            <p className="text-fg-muted">German children&apos;s texts at the reading level you choose. Runs on this Mac.</p>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
            className={`shrink-0 p-2.5 rounded-lg border border-line bg-surface text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors ${focusRing}`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.3 4.3c.4-1.7 3-1.7 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.4 1.8 3 0 3.4a1.7 1.7 0 0 0-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.5-1c-1.6.9-3.3-.9-2.4-2.4a1.7 1.7 0 0 0-1.1-2.6c-1.7-.4-1.7-3 0-3.4a1.7 1.7 0 0 0 1.1-2.5c-.9-1.6.8-3.3 2.4-2.4a1.7 1.7 0 0 0 2.5-1.1Z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </header>

        <details className="group rounded-xl border border-accent-soft-line bg-accent-soft px-5 py-3 text-accent-soft-fg">
          <summary className={`cursor-pointer font-semibold rounded ${focusRing}`}>What is LIX?</summary>
          <p className="text-sm mt-2 mb-3">
            LIX (Läsbarhetsindex) shows how hard a text is to read: the average sentence length (words per sentence)
            plus the percentage of long words (more than 6 letters).
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pb-1">
            <div><span className="font-bold">&lt; 30</span>: very easy (children)</div>
            <div><span className="font-bold">30 - 40</span>: easy (fiction)</div>
            <div><span className="font-bold">40 - 50</span>: medium (newspaper)</div>
            <div><span className="font-bold">&gt; 50</span>: hard (academic)</div>
          </div>
        </details>

        <GeneratorForm onSubmit={handleGenerate} isLoading={isLoading} />

        {isLoading && (
          <div
            ref={progressRef}
            className={`${card} p-5 flex items-center justify-between gap-4 scroll-mb-4`}
            aria-live="polite"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Spinner />
              <div className="space-y-1 min-w-0">
                <p className="font-medium text-fg">{progress}</p>
                {lixPath.length > 0 && (
                  <p className="text-sm font-mono text-fg-subtle break-all">LIX path: {lixPath.join(' → ')}</p>
                )}
              </div>
            </div>
            <button onClick={() => abortRef.current?.abort()} className={secondary}>
              Cancel
            </button>
          </div>
        )}

        {error && (
          <div className="bg-danger-soft border border-danger-line rounded-xl p-6" role="alert">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-danger flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-danger mb-1">{error === 'Cancelled.' ? 'Stopped' : 'Generation failed'}</h3>
                <p className="text-fg-muted break-words">{error}</p>
                {lastParams && (
                  <button onClick={() => handleGenerate(lastParams)} className={`${primary} mt-4`}>
                    Try again
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {result && lastParams && (
          <ResultDisplay
            result={result}
            targetLix={lastParams.lix}
            sentences={lastParams.sentences}
            tolerance={lastParams.tolerance}
            onRetry={() => handleGenerate(lastParams)}
            debugSheet={debug?.sheet}
          />
        )}
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        onChange={onPrefsChange}
        saveError={saveError}
        baseUrl={url}
        busy={isLoading}
        onModelMissing={onModelMissing}
      />
    </main>
  );
}
