'use client';

import { useMemo, useState } from 'react';
import { calculateLix } from '../lib/lix-calculator';
import { Attempt } from '@/types';

interface ResultDisplayProps {
  text: string;
  targetLix: number;
  onRetry: () => void;
  attempts?: Attempt[];
  warning?: string;
}

export default function ResultDisplay({ text, targetLix, onRetry, attempts, warning }: ResultDisplayProps) {
  const stats = useMemo(() => {
    if (!text) return null;
    return calculateLix(text);
  }, [text]);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  if (!text || !stats) return null;

  const actualLix = stats.score;
  const diff = Math.abs(actualLix - targetLix);
  const isClose = diff <= 5;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {warning && (
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg text-yellow-800 text-sm flex items-start gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <span>{warning}</span>
        </div>
      )}

      <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 relative group">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Generated Text</h2>
          <button
            onClick={() => {
              navigator.clipboard.writeText(text);
              const btn = document.getElementById('copy-btn');
              if (btn) {
                const originalText = btn.innerHTML;
                btn.innerHTML = '<span class="text-green-600 flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!</span>';
                setTimeout(() => {
                  btn.innerHTML = originalText;
                }, 2000);
              }
            }}
            id="copy-btn"
            className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1 transition-colors px-3 py-1 rounded-md hover:bg-blue-50"
            title="Copy to clipboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
        </div>
        <div className="prose max-w-none p-6 bg-gray-50 rounded-lg border border-gray-200 text-gray-700 leading-relaxed">
          {text.replace("ß", "ss")}
        </div>
      </div>

      {attempts && attempts.length > 1 && (
        <div className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
          <button
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Generation History</span>
              <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                {attempts.length} attempts
              </span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transform transition-transform ${isHistoryOpen ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          {isHistoryOpen && (
            <div className="divide-y divide-gray-100">
              {attempts.map((attempt: Attempt, idx: number) => (
                <div key={idx} className={`p-6 ${attempt.isSuccess ? 'bg-green-50/30' : 'bg-red-50/30'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900">Attempt {attempt.attempt}</span>
                      {attempt.isSuccess ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">Success</span>
                      ) : (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">Failed</span>
                      )}
                    </div>
                  </div>

                  {!attempt.isSuccess && attempt.errors && (
                    <div className="mb-3 space-y-1">
                      {attempt.errors.map((err: string, i: number) => (
                        <div key={i} className="text-xs text-red-600 flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                          </svg>
                          {err} | LIX: {attempt.stats.score}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-sm text-gray-600 bg-white p-3 rounded border border-gray-200 font-mono text-xs whitespace-pre-wrap">
                    {attempt.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">LIX Analysis</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Target Score</span>
              <span className="font-bold text-gray-900 text-lg">{targetLix}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Actual Score</span>
              <span className={`font-bold text-lg ${isClose ? 'text-green-600' : 'text-red-600'}`}>
                {actualLix}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Difference</span>
              <span className={`font-bold text-lg ${isClose ? 'text-green-600' : 'text-red-600'}`}>
                {diff.toFixed(1)}
              </span>
            </div>
          </div>

          {!isClose && (
            <div className="mt-6">
              <button
                onClick={onRetry}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6"></path>
                  <path d="M1 20v-6h6"></path>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                Retry Generation
              </button>
              <p className="text-xs text-center text-gray-500 mt-2">
                The generated text deviates from the target LIX score. Try regenerating.
              </p>
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Statistics</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Word Count</span>
              <span className="font-bold text-gray-900">{stats.words}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Sentence Count</span>
              <span className="font-bold text-gray-900">{stats.sentences}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Long Words (&gt;6 chars)</span>
              <span className="font-bold text-gray-900">{stats.longWords}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
