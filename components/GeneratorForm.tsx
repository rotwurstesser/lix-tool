'use client';

import { useState, useEffect } from 'react';

interface GeneratorFormProps {
  onSubmit: (data: {
    topic: string;
    lix: number;
    sentences: number;
    language: string;
    model: string;
    targetWords: number;
    targetLongWords: number;
  }) => void;
  isLoading: boolean;
}

export default function GeneratorForm({ onSubmit, isLoading }: GeneratorFormProps) {
  const [topic, setTopic] = useState('');
  const [lix, setLix] = useState(40);
  const [sentences, setSentences] = useState(5);
  const [language, setLanguage] = useState('English');
  const [model, setModel] = useState('claude-opus-4-1-20250805');

  // LIX Balancer State
  const [avgSentenceLength, setAvgSentenceLength] = useState(15);
  const [longWordPct, setLongWordPct] = useState(25);

  // Sync sliders when LIX changes
  useEffect(() => {
    // Default distribution: roughly 30-40% sentence length, rest long words
    // But LIX = AvgLength + LongPct
    // Let's try to keep AvgLength reasonable (10-25)
    let newAvgLength = 15;
    if (lix < 30) newAvgLength = 10;
    else if (lix < 40) newAvgLength = 12;
    else if (lix < 50) newAvgLength = 14;
    else if (lix < 60) newAvgLength = 17;
    else newAvgLength = 20;

    // Clamp to ensure LongPct is positive
    if (newAvgLength > lix) newAvgLength = lix;

    setAvgSentenceLength(newAvgLength);
    setLongWordPct(lix - newAvgLength);
  }, [lix]);

  // Handle slider changes
  const handleLengthChange = (newLength: number) => {
    setAvgSentenceLength(newLength);
    setLongWordPct(lix - newLength);
  };

  const handlePctChange = (newPct: number) => {
    setLongWordPct(newPct);
    setAvgSentenceLength(lix - newPct);
  };

  // Calculate derived metrics for display
  const targetWords = Math.round(sentences * avgSentenceLength);
  const targetLongWords = Math.round((targetWords * longWordPct) / 100);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      topic,
      lix,
      sentences,
      language,
      model,
      targetWords,
      targetLongWords
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-xl shadow-lg border border-gray-100">
      <div className="space-y-2">
        <label htmlFor="model" className="block text-sm font-medium text-gray-700">
          AI Model
        </label>
        <select
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white"
        >
          <option value="claude-opus-4-1-20250805">Claude Opus 4.1 (Best Reasoning)</option>
          <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5 (Balanced)</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Fastest)</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label htmlFor="topic" className="block text-sm font-medium text-gray-700">
            Topic
          </label>
          <input
            type="text"
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            placeholder="e.g., Space Exploration"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="language" className="block text-sm font-medium text-gray-700">
            Language
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          >
            <option value="English">English</option>
            <option value="German">German</option>
            <option value="French">French</option>
            <option value="Italian">Italian</option>
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="lix" className="block text-sm font-medium text-gray-700">
            Target LIX Score
          </label>
          <input
            type="number"
            id="lix"
            value={lix}
            onChange={(e) => setLix(Number(e.target.value))}
            min="10"
            max="100"
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          />
          <p className="text-xs text-gray-500">
            Lower = Easier (e.g. 30), Higher = Harder (e.g. 60)
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="sentences" className="block text-sm font-medium text-gray-700">
            Number of Sentences
          </label>
          <input
            type="number"
            id="sentences"
            value={sentences}
            onChange={(e) => setSentences(Number(e.target.value))}
            min="1"
            max="50"
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      {/* LIX Balancer UI */}
      <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-gray-900">LIX Balancer</h3>
          <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border">
            Sum: {(avgSentenceLength + longWordPct).toFixed(0)} (Target: {lix})
          </span>
        </div>

        <p className="text-xs text-gray-600">
          Adjust how the LIX score is achieved. Moving one slider automatically adjusts the other.
        </p>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <label className="font-medium text-gray-700">Avg Sentence Length</label>
              <span className="text-gray-900">{avgSentenceLength.toFixed(1)} words/sentence</span>
            </div>
            <input
              type="range"
              min="5"
              max={Math.min(lix, 40)}
              step="0.5"
              value={avgSentenceLength}
              onChange={(e) => handleLengthChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <label className="font-medium text-gray-700">Long Word Percentage</label>
              <span className="text-gray-900">{longWordPct.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(0, lix - 5)}
              step="0.5"
              value={longWordPct}
              onChange={(e) => handlePctChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
        </div>

        <div className="bg-white p-4 rounded border border-gray-200 text-center space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Calculation</p>
          <div className="flex items-center justify-center gap-2 text-sm font-mono">
            <div className="flex flex-col items-center">
              <span className="text-blue-600 font-bold">{avgSentenceLength.toFixed(1)}</span>
              <span className="text-[10px] text-gray-400">Avg Length</span>
            </div>
            <span className="text-gray-400">+</span>
            <div className="flex flex-col items-center">
              <span className="text-indigo-600 font-bold">{longWordPct.toFixed(1)}</span>
              <span className="text-[10px] text-gray-400">Long Words %</span>
            </div>
            <span className="text-gray-400">=</span>
            <div className="flex flex-col items-center">
              <span className="text-gray-900 font-bold">{(avgSentenceLength + longWordPct).toFixed(1)}</span>
              <span className="text-[10px] text-gray-400">LIX Score</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-200">
          <div className="text-center">
            <div className="text-xs text-gray-500">Total Words</div>
            <div className="font-mono font-bold text-gray-900">{targetWords}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">Long Words</div>
            <div className="font-mono font-bold text-gray-900">{targetLongWords}</div>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className={`w-full py-3 px-6 text-white font-semibold rounded-lg shadow-md transition-all transform hover:scale-[1.02] active:scale-[0.98] ${isLoading
          ? 'bg-gray-400 cursor-not-allowed'
          : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
          }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Generating...
          </span>
        ) : (
          'Generate Text'
        )}
      </button>
    </form>
  );
}
