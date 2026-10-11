'use client';

import { useState, useEffect } from 'react';
import { GenerationParams } from '@/types';
import { card, focusRing } from './ui';

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
  'w-full px-4 py-2 bg-surface text-fg placeholder:text-fg-subtle border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-accent transition-colors';

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
    <form onSubmit={handleSubmit} className={`${card} space-y-6 p-6 sm:p-8`}>
      <div className="space-y-2">
        <label htmlFor="topic" className="block text-sm font-medium text-fg-muted">
          Topic (German)
        </label>
        <input
          type="text"
          id="topic"
          autoFocus
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className={inputClass}
          placeholder={placeholderTopic}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="space-y-2">
          <label htmlFor="lix" className="block text-sm font-medium text-fg-muted">
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
            className={inputClass}
          />
          <p className="text-xs text-fg-subtle">Counted like the teacher sheet: the title counts too.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="sentences" className="block text-sm font-medium text-fg-muted">
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
          <label htmlFor="tolerance" className="block text-sm font-medium text-fg-muted">
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
              className="flex-1 cursor-pointer accent-accent"
            />
            <span className="text-sm font-bold text-fg w-12 text-center">±{tolerance}</span>
          </div>
          <p className="text-xs text-fg-subtle">Allowed LIX deviation from the target.</p>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className={`w-full py-3 px-6 text-on-accent font-semibold rounded-lg transition-colors bg-accent hover:bg-accent-hover disabled:opacity-70 disabled:cursor-not-allowed ${focusRing}`}
      >
        {isLoading ? 'Generating…' : 'Generate text'}
      </button>
    </form>
  );
}
