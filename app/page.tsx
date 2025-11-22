'use client';

import { useState } from 'react';
import GeneratorForm from '@/components/GeneratorForm';
import ResultDisplay from '@/components/ResultDisplay';

interface GenerationParams {
  topic: string;
  lix: number;
  sentences: number;
  language: string;
  model: string;
  targetWords: number;
  targetLongWords: number;
}

export default function Home() {
  const [generatedText, setGeneratedText] = useState('');
  const [attempts, setAttempts] = useState<any[]>([]);
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [lastParams, setLastParams] = useState<GenerationParams | null>(null);

  const handleGenerate = async (params: GenerationParams) => {
    setIsLoading(true);
    setGeneratedText('');
    setAttempts([]);
    setWarning(undefined);
    setLastParams(params);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate text');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);

            if (data.type === 'attempt') {
              setAttempts(prev => [...prev, data.data]);
            } else if (data.type === 'success') {
              setGeneratedText(data.text);
              if (data.attempts) setAttempts(data.attempts);
            } else if (data.type === 'warning') {
              setGeneratedText(data.text);
              if (data.attempts) setAttempts(data.attempts);
              setWarning(data.warning);
            } else if (data.type === 'error') {
              throw new Error(data.error);
            }
          } catch (e) {
            console.error('Error parsing stream chunk:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to generate text. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    if (lastParams) {
      handleGenerate(lastParams);
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
            Powered by Claude AI.
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

        {generatedText && lastParams && (
          <ResultDisplay
            text={generatedText}
            targetLix={lastParams.lix}
            onRetry={() => handleGenerate(lastParams)}
            attempts={attempts}
            warning={warning}
          />
        )}
      </div>
    </main>
  );
}
