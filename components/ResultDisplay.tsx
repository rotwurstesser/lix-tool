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
      <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Generated Text</h2>
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
