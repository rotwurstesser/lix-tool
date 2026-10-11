'use client';

import { useRef, useState } from 'react';
import GeneratorForm from '@/components/GeneratorForm';
import ResultDisplay from '@/components/ResultDisplay';
import { OllamaClient } from '@/lib/generate/client';
import { generateText, type GenerateResult, type LoopEvent } from '@/lib/generate/loop';
import { NoopSpellChecker } from '@/lib/generate/spell';
import { GenerationParams } from '@/types';

// Server URL and model become settings in slice 4.
const OLLAMA_URL = process.env.NEXT_PUBLIC_OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = 'gemma4:e2b-it-qat';

const STEP_LABELS: Record<LoopEvent['type'], string> = {
  draft: 'Draft',
  title: 'Title',
  edit: 'Edit',
  grammar: 'Grammar pass',
  done: 'Done',
};

function progressText(e: LoopEvent): string {
  const parts = [STEP_LABELS[e.type] + (e.n ? ` ${e.n}` : '')];
  if (e.lix !== undefined) parts.push(`LIX ${e.lix}`);
  parts.push(`${Math.round(e.elapsedMs / 1000)} s`);
  return parts.join(' · ');
}

export default function Home() {
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [lixPath, setLixPath] = useState<number[]>([]);
  const [lastParams, setLastParams] = useState<GenerationParams | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate = async (params: GenerationParams) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setResult(null);
    setError(undefined);
    setLixPath([]);
    setProgress('Starting model...');
    setLastParams(params);

    try {
      const res = await generateText(
        { topic: params.topic, targetLix: params.lix, sentences: params.sentences, tolerance: params.tolerance },
        { client: new OllamaClient(OLLAMA_URL, MODEL), spell: new NoopSpellChecker() },
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
    } catch (err: unknown) {
      if (ctrl.signal.aborted) {
        setError('Cancelled.');
      } else {
        console.error('Error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        setError(`${msg} (Ollama at ${OLLAMA_URL}, model ${MODEL})`);
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl tracking-tight">
            LIX Text Generator
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Generate texts with specific readability scores for educational or testing purposes.
            Runs on a local model (Ollama).
          </p>
          <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 text-left max-w-3xl mx-auto">
            <h3 className="font-semibold text-blue-900 mb-2">What is LIX?</h3>
            <p className="text-sm text-blue-800 mb-3">
              LIX (Läsbarhetsindex) is a readability index that indicates the difficulty of reading a text.
              It is calculated as the sum of the average sentence length (words per sentence) and the percentage of long words (more than 6 letters).
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-blue-700">
              <div><span className="font-bold">&lt; 30</span>: Very Easy (Children)</div>
              <div><span className="font-bold">30 - 40</span>: Easy (Fiction)</div>
              <div><span className="font-bold">40 - 50</span>: Medium (Newspaper)</div>
              <div><span className="font-bold">&gt; 50</span>: Hard (Academic)</div>
            </div>
          </div>
        </div>

        <GeneratorForm onSubmit={handleGenerate} isLoading={isLoading} />

        {isLoading && (
          <div className="bg-white rounded-xl shadow border border-gray-100 p-6 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="font-medium text-gray-800">{progress}</p>
              {lixPath.length > 0 && <p className="text-sm font-mono text-gray-500">LIX path: {lixPath.join(' → ')}</p>}
            </div>
            <button
              onClick={() => abortRef.current?.abort()}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 shadow-md">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-900 mb-1">Generation Failed</h3>
                <p className="text-red-700">{error}</p>
                {lastParams && (
                  <button
                    onClick={() => handleGenerate(lastParams)}
                    className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                  >
                    Try Again
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
          />
        )}

        <footer className="mt-16 pt-8 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-500">
            Improvements? You can{' '}
            <a
              href="https://github.com/rotwurstesser/lix-tool"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              fork me on GitHub
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
