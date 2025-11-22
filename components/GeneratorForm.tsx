'use client';

import { useState } from 'react';

interface GeneratorFormProps {
  onSubmit: (data: {
    topic: string;
    lix: number;
    sentences: number;
    language: string;
  }) => void;
  isLoading: boolean;
}

export default function GeneratorForm({ onSubmit, isLoading }: GeneratorFormProps) {
  const [topic, setTopic] = useState('');
  const [lix, setLix] = useState(40);
  const [sentences, setSentences] = useState(5);
  const [language, setLanguage] = useState('English');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ topic, lix, sentences, language });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-xl shadow-lg border border-gray-100">
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
            min="1"
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
