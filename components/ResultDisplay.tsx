'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GrammarIssue } from '@/lib/generate/grammar';
import type { GenerateResult } from '@/lib/generate/loop';
import { formatTargetTime, lix, swissSpelling, round1 } from '@/lib/lix';
import { footerText, sheetFileName, sheetStats, type SheetLayout } from '@/lib/reading-sheet';
import { debugLog } from '@/lib/tauri';
import ReadingSheet, { useSheetFit } from './ReadingSheet';
import { card, focusRing, primary } from './ui';

interface ResultDisplayProps {
  result: GenerateResult;
  targetLix: number;
  sentences: number;
  tolerance: number;
  onRetry: () => void;
  // Debug builds (LIX_SCREEN=sheet...): preset layout, and print once on start.
  debugSheet?: { layout: SheetLayout; print: boolean };
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

export default function ResultDisplay({ result, targetLix, sentences, tolerance, onRetry, debugSheet }: ResultDisplayProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const regionRef = useRef<HTMLElement>(null);
  // The teacher can change the title before printing. LIX and word count follow it.
  const [shown, setShown] = useState(result);
  const [title, setTitle] = useState(result.title);
  if (shown !== result) {
    setShown(result);
    setTitle(result.title);
  }
  const [layout, setLayout] = useState<SheetLayout>(debugSheet?.layout ?? 'bottom');
  const [printError, setPrintError] = useState<string | null>(null);
  const stats = useMemo(() => sheetStats(title, result.sentences), [title, result.sentences]);
  const { fit, measureNode } = useSheetFit(layout, title, result.sentences, stats);
  // Unrounded for the hit check, so it agrees with the generator's tolerance.
  const exactLix = result.sentences.length ? lix(result.sentences, { title: swissSpelling(title.trim()) }) : 0;
  const actualLix = round1(exactLix);
  const diff = Math.abs(exactLix - targetLix);
  const hit = diff <= tolerance;
  const text = [title.trim(), ...result.sentences].filter(Boolean).join('\n');

  // The macOS print dialog takes the PDF name from the page title.
  const print = async () => {
    setPrintError(null);
    document.title = sheetFileName(stats.lix, title);
    try {
      await window.print();
      const sheet = document.querySelector<HTMLElement>('.print-sheet');
      debugLog(`print opened title=${document.title} layout=${sheet?.dataset.layout} lineHeight=${sheet?.style.getPropertyValue('--sheet-lh')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog(`print failed ${msg}`);
      setPrintError(`Printing does not start: ${msg}`);
    }
  };

  useEffect(() => () => void (document.title = 'LIX Writer'), []);

  // Debug builds: show the sheet card for screenshots, and open the print dialog once, so a script can save the PDF.
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!debugSheet) return;
    const show = setTimeout(() => sheetRef.current?.scrollIntoView({ block: 'start' }), 1500);
    const id = debugSheet.print ? setTimeout(() => void print(), 3000) : undefined;
    return () => {
      clearTimeout(show);
      clearTimeout(id);
    };
    // Runs once on start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {!hit && (
        <div className="bg-warn-soft border border-warn-line p-4 rounded-lg text-warn text-sm">
          Target missed: LIX {actualLix} is {diff.toFixed(1)} away from {targetLix} (tolerance ±{tolerance}). This is
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
          {title.trim() && <h3 className="text-2xl font-bold text-fg mb-3">{title.trim()}</h3>}
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

      <div ref={sheetRef} className={`${card} p-6 sm:p-8 space-y-5 scroll-mt-4`}>
        <h2 className="text-xl font-bold text-fg">Reading sheet</h2>
        <div className="space-y-1.5">
          <label htmlFor="sheet-title" className="block text-sm font-medium text-fg-muted">
            Title on the sheet
          </label>
          <input
            id="sheet-title"
            type="text"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full px-3 py-2 rounded-lg border border-line-strong bg-surface text-fg ${focusRing}`}
          />
          <p className="text-sm text-fg-subtle">The title counts for LIX and words, like on the teacher&apos;s sheet.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg-muted mb-1">Fill-in boxes and footer</legend>
          {(
            [
              ['bottom', 'Boxes at the bottom'],
              ['back', 'Boxes on the back (two-sided)'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-fg cursor-pointer w-fit">
              <input
                type="radio"
                name="sheet-layout"
                value={value}
                checked={layout === value}
                onChange={() => setLayout(value)}
                className="accent-accent w-4 h-4"
              />
              {label}
            </label>
          ))}
          {fit.overflow ? (
            <p className="text-sm text-warn" role="status">
              The text is longer than one page, so the sheet has more than 2 pages. Ask for fewer sentences to fit it.
            </p>
          ) : (
            fit.moved && (
              <p className="text-sm text-warn" role="status">
                The text does not fit one page, so the boxes go on the back. Print two-sided.
              </p>
            )
          )}
          {fit.layout === 'bottom' && fit.lineHeight < 1.5 && (
            <p className="text-sm text-fg-subtle" role="status">
              Line spacing {fit.lineHeight} instead of 1.5, so the sheet fits one page.
            </p>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <p className="text-sm text-fg-muted whitespace-pre-wrap min-w-0">{footerText(stats)}</p>
          <button onClick={print} className={primary}>
            Print sheet…
          </button>
        </div>
        {printError && (
          <p className="text-sm text-danger" role="alert">
            {printError}
          </p>
        )}
        {measureNode}
        <ReadingSheet title={title} sentences={result.sentences} stats={stats} fit={fit} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`${card} p-6`}>
          <h3 className="text-lg font-semibold text-fg mb-4">LIX analysis</h3>
          <div className="space-y-3">
            <Row label="Target LIX" value={targetLix} />
            <Row
              label="Actual LIX (title counted)"
              value={<span className={hit ? 'text-success' : 'text-danger'}>{actualLix}</span>}
            />
            <Row label="LIX path" value={<span className="font-mono text-sm break-all">{result.lixPath.join(' → ')}</span>} />
          </div>
          {!hit && (
            <button onClick={onRetry} className={`${primary} mt-6 w-full py-3`}>
              Try again
            </button>
          )}
        </div>

        <div className={`${card} p-6`}>
          <h3 className="text-lg font-semibold text-fg mb-4">Statistics</h3>
          <div className="space-y-3">
            <Row label="Words (title counted)" value={stats.words} />
            <Row label="Zielzeit (maximal)" value={formatTargetTime(stats.targetSeconds)} />
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
