'use client';

import { useState, useEffect } from 'react';
import { GenerationParams } from '@/types';

interface GeneratorFormProps {
  onSubmit: (data: GenerationParams) => void;
  isLoading: boolean;
}

const CHILDREN_TOPICS = [
  'einen kleinen Hund, der sich im Park verirrt',
  'einen Tag im Zoo',
  'ein Baumhaus im Wald',
  'eine Hexe, die ihren Zauberstab verliert',
  'einen freundlichen Drachen',
  'eine Reise zum Mond',
  'einen Fuchs, der einen Schlüssel findet',
  'eine Schatzkarte am Strand',
  'einen Schneemann, der sich etwas wünscht',
  'einen Roboter, der beim Kochen hilft',
  'eine mutige Maus',
  'ein Piratenschiff im Sturm',
];

const inputClass =
  'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors';

export default function GeneratorForm({ onSubmit, isLoading }: GeneratorFormProps) {
  const [topic, setTopic] = useState('');
  const [lix, setLix] = useState(30);
  const [sentences, setSentences] = useState(10);
  const [tolerance, setTolerance] = useState(0.5);
  const [placeholderTopic, setPlaceholderTopic] = useState('');

  useEffect(() => {
    // Run after mount to avoid hydration mismatch
    const randomTopic = CHILDREN_TOPICS[Math.floor(Math.random() * CHILDREN_TOPICS.length)];
    // eslint-disable-next-line
    setPlaceholderTopic(randomTopic);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ topic: topic || placeholderTopic, lix, sentences, tolerance });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-xl shadow-lg border border-gray-100">
      <div className="space-y-2">
        <label htmlFor="topic" className="block text-sm font-medium text-gray-700">
          Topic (German)
        </label>
        <input
          type="text"
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className={inputClass}
          placeholder={placeholderTopic}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-2">
          <label htmlFor="lix" className="block text-sm font-medium text-gray-700">
            Target LIX
          </label>
          <input
            type="number"
            id="lix"
            value={lix}
            onChange={(e) => setLix(Number(e.target.value))}
            min="10"
            max="60"
            step="1"
            required
            className={`${inputClass} text-center`}
          />
          <p className="text-xs text-gray-500">Counted like the teacher sheet: the title counts too.</p>
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
            min="3"
            max="30"
            required
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="tolerance" className="block text-sm font-medium text-gray-700">
            Tolerance
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              id="tolerance"
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              min="0.5"
              max="3"
              step="0.5"
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
            />
            <span className="text-sm font-bold text-gray-900 w-12 text-center">±{tolerance}</span>
          </div>
          <p className="text-xs text-gray-500">Allowed LIX deviation from the target.</p>
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
        {isLoading ? 'Generating...' : 'Generate Text'}
      </button>
    </form>
  );
}
