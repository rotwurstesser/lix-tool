'use client';

import { useMemo } from 'react';
import { calculateLix } from '../lib/lix-calculator';

interface ResultDisplayProps {
  text: string;
  targetLix: number;
  onRetry: () => void;
}

export default function ResultDisplay({ text, targetLix, onRetry }: ResultDisplayProps) {
  const stats = useMemo(() => {
    if (!text) return null;
    return calculateLix(text);
  }, [text]);

  if (!text || !stats) return null;

  const diff = Math.abs(stats.score - targetLix);
  const isGoodMatch = diff <= 5;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
          {text}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">LIX Analysis</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <span className="text-gray-600">Target Score</span>
              <span className="font-mono font-bold text-gray-900">{targetLix}</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <span className="text-gray-600">Actual Score</span>
              <span className={`font-mono font-bold ${isGoodMatch ? 'text-green-600' : 'text-orange-600'}`}>
                {stats.score}
              </span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <span className="text-gray-600">Difference</span>
              <span className={`font-mono font-bold ${isGoodMatch ? 'text-green-600' : 'text-orange-600'}`}>
                {diff.toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Statistics</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <span className="text-gray-600">Word Count</span>
              <span className="font-mono font-bold text-gray-900">{stats.words}</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <span className="text-gray-600">Sentence Count</span>
              <span className="font-mono font-bold text-gray-900">{stats.sentences}</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <span className="text-gray-600">Long Words (&gt;6 chars)</span>
              <span className="font-mono font-bold text-gray-900">{stats.longWords}</span>
            </div>
          </div>
        </div>
      </div>

      {!isGoodMatch && (
        <div className="flex justify-center">
          <button
            onClick={onRetry}
            className="px-8 py-3 bg-white border-2 border-orange-500 text-orange-600 font-semibold rounded-lg hover:bg-orange-50 transition-colors shadow-sm"
          >
            Score Mismatch - Retry Generation
          </button>
        </div>
      )}
    </div>
  );
}
