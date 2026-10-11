'use client';

import { useEffect, useRef, useState } from 'react';
import type { GrammarIssue } from '@/lib/generate/grammar';
import type { GenerateResult } from '@/lib/generate/loop';
import { formatTargetTime } from '@/lib/lix';
import { card, focusRing, primary } from './ui';

interface ResultDisplayProps {
  result: GenerateResult;
  targetLix: number;
  sentences: number;
  tolerance: number;
  onRetry: () => void;
}

/** Copies through the Clipboard API, with the old selection-based copy as fallback. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** LanguageTool issues with a position inside the sentence; other issues have none. */
function located(issue: GrammarIssue, sentence: string): issue is GrammarIssue & { offset: number; length: number } {
  return (
    issue.offset !== undefined &&
    issue.length !== undefined &&
    issue.length > 0 &&
    issue.offset >= 0 &&
    issue.offset + issue.length <= sentence.length
  );
}

/** A sentence with its flagged words underlined. Overlapping matches keep the first one. */
function Sentence({ text, issues }: { text: string; issues: GrammarIssue[] }) {
  const marks = issues.filter((i) => located(i, text)).sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of marks) {
    const start = m.offset ?? 0;
    const end = start + (m.length ?? 0);
    if (start < pos) continue;
    parts.push(text.slice(pos, start));
    parts.push(
      <span
        key={start}
        title={m.message}
        className="underline decoration-wavy decoration-warn underline-offset-4 decoration-[1.5px]"
      >
        {text.slice(start, end)}
      </span>,
    );
    pos = end;
  }
  parts.push(text.slice(pos));
  return <p>{parts}</p>;
}

function flagged(issue: GrammarIssue, sentence: string | undefined): string {
  if (sentence && located(issue, sentence)) return sentence.slice(issue.offset, issue.offset + issue.length);
  return issue.snippet;
}

export default function ResultDisplay({ result, targetLix, sentences, tolerance, onRetry }: ResultDisplayProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const regionRef = useRef<HTMLElement>(null);
  const diff = Math.abs(result.lix - targetLix);
  const text = [result.title, ...result.sentences].filter(Boolean).join('\n');

  const copy = async () => {
    setCopyState((await copyText(text)) ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  // Show the new result: scroll to it and move the focus there, so Cmd+C and Tab start at the text.
  useEffect(() => {
    regionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    regionRef.current?.focus({ preventScroll: true });
  }, [result]);

  // Cmd+C without a selection copies the whole text. With a selection the normal copy runs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'c') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], dialog[open]')) return;
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      copy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const issuesBySentence = (i: number) => result.grammarIssues.filter((g) => g.index === i);

  return (
    <section
      ref={regionRef}
      tabIndex={-1}
      aria-label="Generated text"
      className="space-y-6 scroll-mt-4 focus:outline-none"
    >
      {!result.hit && (
        <div className="bg-warn-soft border border-warn-line p-4 rounded-lg text-warn text-sm">
          Target missed: LIX {result.lix} is {diff.toFixed(1)} away from {targetLix} (tolerance ±{tolerance}). This is
          the closest text the model found.
        </div>
      )}

      {!result.sentenceCountOk && (
        <div className="bg-warn-soft border border-warn-line p-3 rounded-lg text-warn text-sm">
          The text has {result.sentences.length} sentences; you asked for {sentences} (allowed ±2).
        </div>
      )}

      <div className={`${card} p-6 sm:p-8`}>
        <div className="flex justify-between items-center gap-4 mb-4">
          <h2 className="text-xl font-bold text-fg">Generated text</h2>
          <button
            onClick={copy}
            className={`text-sm font-medium px-3 py-1.5 rounded-md border border-line bg-surface-2 hover:bg-line text-fg transition-colors ${focusRing}`}
            title="Copy the text (Cmd+C)"
          >
            {copyState === 'copied' ? (
              <span className="text-success">Copied</span>
            ) : copyState === 'failed' ? (
              <span className="text-danger">Copy failed: select the text and press Cmd+C</span>
            ) : (
              'Copy'
            )}
          </button>
        </div>
        <div className="p-5 sm:p-6 bg-surface-2 rounded-lg border border-line text-fg leading-relaxed space-y-1 select-text">
          {result.title && <h3 className="text-2xl font-bold text-fg mb-3">{result.title}</h3>}
          {result.sentences.map((s, i) => (
            <Sentence key={i} text={s} issues={issuesBySentence(i)} />
          ))}
        </div>

        {result.grammarIssues.length > 0 && (
          <div className="mt-4 text-sm text-fg-muted">
            <h3 className="font-medium text-fg">Possible grammar issues</h3>
            <p className="text-fg-subtle mb-2">The grammar check still flags these words. Please read them once.</p>
            <ul className="space-y-1.5">
              {result.grammarIssues.map((g, i) => {
                const words = flagged(g, result.sentences[g.index]);
                return (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden="true" className="text-warn">•</span>
                    <span className="min-w-0 break-words">
                      <span className="font-medium text-fg">«{words.length > 80 ? `${words.slice(0, 80)}…` : words}»</span>{' '}
                      {g.message}
                      {g.replacements?.length ? ` (suggestion: ${g.replacements.slice(0, 2).join(', ')})` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`${card} p-6`}>
          <h3 className="text-lg font-semibold text-fg mb-4">LIX analysis</h3>
          <div className="space-y-3">
            <Row label="Target LIX" value={targetLix} />
            <Row
              label="Actual LIX (title counted)"
              value={<span className={result.hit ? 'text-success' : 'text-danger'}>{result.lix}</span>}
            />
            <Row label="LIX path" value={<span className="font-mono text-sm break-all">{result.lixPath.join(' → ')}</span>} />
          </div>
          {!result.hit && (
            <button onClick={onRetry} className={`${primary} mt-6 w-full py-3`}>
              Try again
            </button>
          )}
        </div>

        <div className={`${card} p-6`}>
          <h3 className="text-lg font-semibold text-fg mb-4">Statistics</h3>
          <div className="space-y-3">
            <Row label="Words (title counted)" value={result.words} />
            <Row label="Zielzeit (maximal)" value={formatTargetTime(result.targetTimeSeconds)} />
            <Row label="Model calls / time" value={`${result.calls} / ${result.secs} s`} />
            {result.unknownWords.length > 0 && <Row label="Unknown words" value={result.unknownWords.join(', ')} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-4 p-3 bg-surface-2 rounded-lg">
      <span className="text-fg-muted">{label}</span>
      <span className="font-bold text-fg text-right min-w-0 break-words">{value}</span>
    </div>
  );
}
