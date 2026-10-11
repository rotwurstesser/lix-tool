'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BOX_MM, chooseFit, estimateMeasure, footerItems, type Measure, type SheetFit, type SheetLayout, type SheetStats } from '@/lib/reading-sheet';
import { swissSpelling } from '@/lib/lix';

interface SheetProps {
  title: string;
  sentences: string[];
  stats: SheetStats;
}

function Boxes() {
  return (
    <table className="sheet-boxes" aria-hidden="true">
      <tbody>
        <tr>
          {Array.from({ length: BOX_MM.count }, (_, i) => (
            <td key={i} />
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** The sheet itself: title, one sentence per line, the two box rows and the footer. Styles: app/globals.css (.sheet). */
function SheetContent({ title, sentences, stats, layout }: SheetProps & { layout: SheetLayout }) {
  return (
    <div className="sheet">
      <div data-part="story">
        {title.trim() && <h1 className="sheet-title">{swissSpelling(title.trim())}</h1>}
        {sentences.map((s, i) => (
          <p key={i}>{swissSpelling(s)}</p>
        ))}
      </div>
      <div data-part="block" className={layout === 'back' ? 'sheet-back' : undefined}>
        {layout === 'bottom' && (
          <>
            <div className="sheet-gap" />
            <div className="sheet-gap" />
          </>
        )}
        <div className="sheet-keep">
          <p className="sheet-label">So viele Fehler habe ich gemacht:</p>
          <Boxes />
        </div>
        <div className="sheet-label-gap" />
        <div className="sheet-keep">
          <p className="sheet-label">So lange habe ich gebraucht, um den Text zu lesen:</p>
          <Boxes />
        </div>
        <div className="sheet-gap" />
        <p className="sheet-footer">
          {footerItems(stats).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </p>
      </div>
    </div>
  );
}

const PX_MM = 25.4 / 96;

/**
 * Where the boxes go and which line spacing the sheet uses. A hidden copy of the sheet at print width measures
 * the real text with the installed font; the line-count estimate covers the time before that.
 */
export function useSheetFit(choice: SheetLayout, title: string, sentences: string[], stats: SheetStats) {
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([choice, title, sentences]);
  const estimate = useMemo(() => chooseFit(choice, estimateMeasure(title, sentences)), [choice, title, sentences]);
  const [measured, setMeasured] = useState<{ key: string; fit: SheetFit } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      const el = ref.current;
      const story = el?.querySelector('[data-part="story"]');
      const block = el?.querySelector('[data-part="block"]');
      if (cancelled || !el || !story || !block) return;
      const measure: Measure = (part, lh) => {
        el.style.setProperty('--sheet-lh', String(lh));
        const h = story.getBoundingClientRect().height + (part === 'all' ? block.getBoundingClientRect().height : 0);
        return h * PX_MM;
      };
      setMeasured({ key, fit: chooseFit(choice, measure) });
    };
    // Measure after the fonts load: the school font, when installed, has other widths than the fallback.
    const frame = requestAnimationFrame(run);
    document.fonts?.ready.then(run).catch(() => {});
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [key, choice]);

  const fit = measured?.key === key ? measured.fit : estimate;
  const measureNode = (
    <div ref={ref} aria-hidden="true" className="sheet-measure">
      <SheetContent title={title} sentences={sentences} stats={stats} layout="bottom" />
    </div>
  );
  return { fit, measureNode };
}

/** Print-only copy of the sheet, directly under <body>, so the print CSS can hide the app around it. */
export default function ReadingSheet({ title, sentences, stats, fit }: SheetProps & { fit: SheetFit }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setHost(document.body));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!host) return null;
  return createPortal(
    <div className="print-sheet" style={{ '--sheet-lh': fit.lineHeight } as CSSProperties} data-layout={fit.layout}>
      <SheetContent title={title} sentences={sentences} stats={stats} layout={fit.layout} />
    </div>,
    host,
  );
}
