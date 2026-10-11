'use client';

import { useState } from 'react';
import type { GenerateResult } from '@/lib/generate/loop';
import { formatTargetTime } from '@/lib/lix';

interface ResultDisplayProps {
  result: GenerateResult;
  targetLix: number;
  sentences: number;
  tolerance: number;
  onRetry: () => void;
}

export default function ResultDisplay({ result, targetLix, sentences, tolerance, onRetry }: ResultDisplayProps) {
  const [copied, setCopied] = useState(false);
  const diff = Math.abs(result.lix - targetLix);
  const text = [result.title, ...result.sentences].filter(Boolean).join('\n');

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {!result.hit && (
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg text-yellow-800 text-sm">
          Target missed: LIX {result.lix} is {diff.toFixed(1)} away from {targetLix} (tolerance ±{tolerance}). This is
          the closest text the model found.
        </div>
      )}

      {!result.sentenceCountOk && (
        <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-yellow-800 text-xs">
          The text has {result.sentences.length} sentences; you asked for {sentences} (allowed ±2).
        </div>
      )}

      <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Generated Text</h2>
          <button
            onClick={copy}
            className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1 transition-colors px-3 py-1 rounded-md hover:bg-blue-50"
            title="Copy to clipboard"
          >
            {copied ? <span className="text-green-600">Copied!</span> : 'Copy'}
          </button>
        </div>
        <div className="p-6 bg-gray-50 rounded-lg border border-gray-200 text-gray-700 leading-relaxed space-y-1">
          {result.title && <h3 className="text-2xl font-bold text-gray-900 mb-3">{result.title}</h3>}
          {result.sentences.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">LIX Analysis</h3>
          <div className="space-y-4">
            <Row label="Target LIX" value={targetLix} />
            <Row
              label="Actual LIX (title counted)"
              value={<span className={result.hit ? 'text-green-600' : 'text-red-600'}>{result.lix}</span>}
            />
            <Row label="LIX path" value={<span className="font-mono text-sm">{result.lixPath.join(' → ')}</span>} />
          </div>
          {!result.hit && (
            <button
              onClick={onRetry}
              className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Retry Generation
            </button>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Statistics</h3>
          <div className="space-y-4">
            <Row label="Words (title counted)" value={result.words} />
            <Row label="Zielzeit (maximal)" value={formatTargetTime(result.targetTimeSeconds)} />
            <Row label="Model calls / time" value={`${result.calls} / ${result.secs} s`} />
            {result.unknownWords.length > 0 && <Row label="Unknown words" value={result.unknownWords.join(', ')} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-4 p-3 bg-gray-50 rounded-lg">
      <span className="text-gray-600">{label}</span>
      <span className="font-bold text-gray-900 text-right">{value}</span>
    </div>
  );
}
