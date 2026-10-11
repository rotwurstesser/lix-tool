import type { GenerateResult } from './generate/loop';
import type { PullProgress } from './model-manager';
import type { SheetLayout } from './reading-sheet';
import type { SetupStep } from './setup';

// Debug builds only (LIX_SCREEN): fixed screens for the light and dark screenshots.
// Release builds have no debug_screen command, so none of this runs there.

export type DebugScreen =
  | { kind: 'setup'; step: SetupStep; download?: PullProgress }
  | {
      kind: 'generator';
      result?: GenerateResult;
      settings?: boolean;
      actions?: DebugAction[];
      sheet?: { layout: SheetLayout; print: boolean };
    };

// Steps a live check runs without clicks, through the same calls as the buttons.
export type DebugAction = 'theme-dark' | 'theme-light' | 'grammar-remove' | 'grammar-add';
const ACTIONS: ReadonlyArray<DebugAction> = ['theme-dark', 'theme-light', 'grammar-remove', 'grammar-add'];

const sentences = [
  'Xenia ist eine kleine Hexe.',
  'Sie wohnt in einem alten Haus am Waldrand.',
  'Jeden Morgen fliegt sie mit ihrem Besen über die Wiese.',
  'Heute sucht sie ihren Zauberstab.',
  'Er liegt nicht auf dem Tisch und nicht unter dem Bett.',
  'Ihre Katze Mimi hilft bei der Suche.',
  'Zusammen schauen sie in jede Ecke vom Haus.',
  'Plötzlich miaut Mimi laut im Garten.',
  'Der Zauberstab steckt im Beet zwischen den Karotten.',
  'Xenia lacht und gibt Mimi eine grosse Portion Milch.',
];

export const DEBUG_RESULT: GenerateResult = {
  title: 'Hexe Xenia',
  sentences,
  lix: 26.3,
  hit: true,
  sentenceCountOk: true,
  words: 84,
  targetTimeSeconds: 50,
  lixPath: [31.2, 29.4, 27.8, 26.3],
  calls: 14,
  rejected: 3,
  grammarRejected: 1,
  repairs: 1,
  grammarIssues: [
    {
      index: 6,
      message: 'Möglicherweise fehlende Übereinstimmung: «im Haus» oder «vom Haus» prüfen.',
      snippet: 'Ecke vom Haus',
      offset: sentences[6].indexOf('vom Haus'),
      length: 8,
      ruleId: 'DE_CASE',
      replacements: ['im Haus'],
    },
  ],
  secs: 68,
  unknownWords: [],
};

// Own sample with the counts of the teacher's sheet: title counted, 112 words, 18 long words, LIX 26, 1min 7s.
export const SHEET_TITLE = 'Kater Moritz';
export const SHEET_SENTENCES = [
  'Moritz ist ein kleiner grauer Kater mit einem weissen Fleck auf der Nase.',
  'Er wohnt bei Lena in einer kleinen Wohnung im dritten Stock.',
  'Am liebsten liegt er auf dem Fenstersims und schaut nach draussen.',
  'Dort fliegen den ganzen Tag viele Vögel von Baum zu Baum.',
  'Eines Morgens steht das Fenster in der Küche einen Spalt weit offen.',
  'Moritz springt hinaus und landet mitten im Garten der Nachbarin.',
  'Er jagt einen bunten Schmetterling und vergisst dabei die Zeit.',
  'Am Abend findet er den Weg nach Hause aber nicht mehr.',
  'Lena sucht ihn überall und ruft ganz laut seinen Namen.',
  'Endlich hört Moritz ihre Stimme und rennt glücklich zu ihr zurück.',
];

const SHEET_RESULT: GenerateResult = {
  ...DEBUG_RESULT,
  title: SHEET_TITLE,
  sentences: SHEET_SENTENCES,
  lix: 26.3,
  words: 112,
  targetTimeSeconds: 67,
  lixPath: [29.1, 27.4, 26.3],
  grammarIssues: [],
};

const DOWNLOAD: PullProgress = {
  status: 'pulling',
  completedBytes: 1_720_000_000,
  totalBytes: 4_300_000_000,
  percent: 40,
  bytesPerSec: 24_000_000,
  etaSec: 107,
};

export function parseDebugScreen(name: string | null): DebugScreen | null {
  switch (name) {
    case 'setup-welcome':
      return { kind: 'setup', step: 'welcome' };
    case 'setup-model':
      return { kind: 'setup', step: 'model', download: DOWNLOAD };
    case 'setup-grammar':
      return { kind: 'setup', step: 'grammar' };
    case 'setup-ready':
      return { kind: 'setup', step: 'ready' };
    case 'generator':
      return { kind: 'generator' };
    case 'result':
      return { kind: 'generator', result: DEBUG_RESULT };
    case 'settings':
      return { kind: 'generator', settings: true };
    default: {
      // "settings:theme-dark,grammar-remove" opens the settings and runs the steps.
      const [base, list] = (name ?? '').split(':');
      // "sheet", "sheet:back", "sheet:back,print": result with the sample text, layout preset, print on start.
      if (base === 'sheet') {
        const opts = (list ?? '').split(',');
        return {
          kind: 'generator',
          result: SHEET_RESULT,
          sheet: { layout: opts.includes('back') ? 'back' : 'bottom', print: opts.includes('print') },
        };
      }
      const actions = (list ?? '').split(',').filter((a): a is DebugAction => (ACTIONS as ReadonlyArray<string>).includes(a));
      return base === 'settings' && actions.length ? { kind: 'generator', settings: true, actions } : null;
    }
  }
}
