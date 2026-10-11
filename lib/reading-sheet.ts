// Reading sheet after the teacher's template: numbers, footer, file name and the one-page fit rule.
import { countWords, formatTargetTime, lix, swissSpelling, targetTimeSeconds } from './lix.ts';

export type SheetLayout = 'bottom' | 'back';

export interface SheetStats {
  // LIX the teacher's way: title counted, rounded to a whole number.
  lix: number;
  words: number;
  targetSeconds: number;
}

export function sheetStats(title: string, sentences: string[]): SheetStats {
  // The sheet prints the title in Swiss spelling (ss for ß), so count that form.
  const t = swissSpelling(title.trim());
  const words = countWords(sentences, { title: t });
  return { lix: Math.round(lix(sentences, { title: t })), words, targetSeconds: targetTimeSeconds(words) };
}

export function footerItems(stats: SheetStats): string[] {
  return [`LIX: ${stats.lix}`, `Anzahl Wörter: ${stats.words}`, `Zielzeit (maximal): ${formatTargetTime(stats.targetSeconds)}`];
}

export function footerText(stats: SheetStats): string {
  return footerItems(stats).join('   ');
}

// Suggested PDF name without ".pdf", like the teacher's files: Lesetraining_LIX26_Hexe_Xenia.
export function sheetFileName(lixValue: number, title: string): string {
  const safe = swissSpelling(title)
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('_');
  return safe ? `Lesetraining_LIX${lixValue}_${safe}` : `Lesetraining_LIX${lixValue}`;
}

// Page geometry from the template (word/document.xml, w:pgMar in twips): A4, top 1123, sides 1417, bottom 372.
export const PAGE_MM = { width: 210, height: 297, top: 19.8, side: 25, bottom: 6.6 } as const;
export const CONTENT_WIDTH_MM = PAGE_MM.width - 2 * PAGE_MM.side;
// Screen and print text can wrap a little differently, so the fit check keeps a reserve.
export const FIT_RESERVE_MM = 4;
export const CONTENT_HEIGHT_MM = PAGE_MM.height - PAGE_MM.top - PAGE_MM.bottom - FIT_RESERVE_MM;

// Line spacing 1.5 as in the template's Word settings. Lower steps only when the boxes otherwise go to the back.
// 1.15 is single spacing: the template preview (teacher-template.png) shows its 10 sentences at about that spacing.
export const LINE_HEIGHTS = [1.5, 1.4, 1.3, 1.2, 1.15] as const;

export interface SheetFit {
  layout: SheetLayout;
  lineHeight: number;
  // True when the teacher chose "at the bottom" but the text does not fit one page.
  moved: boolean;
  // True when the story alone is longer than page 1 even at the lowest spacing: the boxes print after page 2.
  overflow: boolean;
}

// Height in mm of the title and story alone ("story") or of the whole first page with the boxes ("all").
export type Measure = (part: 'story' | 'all', lineHeight: number) => number;

/**
 * The boxes stay at the bottom at the largest line spacing that fits one page.
 * When no step fits, they go to the back. The back layout uses the largest spacing that keeps the story on page 1.
 */
export function chooseFit(choice: SheetLayout, measure: Measure, available = CONTENT_HEIGHT_MM): SheetFit {
  if (choice === 'bottom') {
    const lh = LINE_HEIGHTS.find((h) => measure('all', h) <= available);
    if (lh !== undefined) return { layout: 'bottom', lineHeight: lh, moved: false, overflow: false };
  }
  const lh = LINE_HEIGHTS.find((h) => measure('story', h) <= available);
  return {
    layout: 'back',
    lineHeight: lh ?? LINE_HEIGHTS[LINE_HEIGHTS.length - 1],
    moved: choice === 'bottom',
    overflow: lh === undefined,
  };
}

// Sizes in pt and mm, shared by the print CSS (components/ReadingSheet.tsx) and the estimate below.
export const SHEET_PT = { title: 28, body: 20, label: 16 } as const;
export const BOX_MM = { width: 19.8, height: 13.8, count: 8 } as const;
const PT_MM = 25.4 / 72;
// Average letter width of German text in a sans font, in em. Wide on purpose: the real font is not known.
const AVG_CHAR_EM = 0.5;

// Greedy word wrap with a fixed number of characters per line.
export function wrapLines(text: string, charsPerLine: number): number {
  let lines = 0;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (lines && used + 1 + word.length <= charsPerLine) {
      used += 1 + word.length;
    } else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

function charsPerLine(pt: number): number {
  return Math.floor(CONTENT_WIDTH_MM / (pt * PT_MM * AVG_CHAR_EM));
}

/** Measure without a DOM: line-count estimate. The app measures the real layout and uses this before fonts load. */
export function estimateMeasure(title: string, sentences: string[]): Measure {
  return (part, lh) => {
    const line = (pt: number) => pt * PT_MM * lh;
    const titleLines = title.trim() ? wrapLines(title, charsPerLine(SHEET_PT.title)) : 0;
    const storyLines = sentences.reduce((n, s) => n + Math.max(1, wrapLines(s, charsPerLine(SHEET_PT.body))), 0);
    const story = titleLines * line(SHEET_PT.title) + storyLines * line(SHEET_PT.body);
    if (part === 'story') return story;
    const footerLines = wrapLines(footerText({ lix: 99, words: 999, targetSeconds: 599 }), charsPerLine(SHEET_PT.body));
    // Two empty lines, label, boxes, empty label line, label, boxes, empty line, footer.
    const block =
      2 * line(SHEET_PT.body) +
      3 * line(SHEET_PT.label) +
      2 * BOX_MM.height +
      line(SHEET_PT.body) +
      footerLines * line(SHEET_PT.body);
    return story + block;
  };
}
