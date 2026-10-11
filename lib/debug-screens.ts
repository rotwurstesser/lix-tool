import type { GenerateResult } from './generate/loop';
import type { PullProgress } from './model-manager';
import type { SetupStep } from './setup';

// Debug builds only (LIX_SCREEN): fixed screens for the light and dark screenshots.
// Release builds have no debug_screen command, so none of this runs there.

export type DebugScreen =
  | { kind: 'setup'; step: SetupStep; download?: PullProgress }
  | { kind: 'generator'; result?: GenerateResult; settings?: boolean; actions?: DebugAction[] };

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
      const actions = (list ?? '').split(',').filter((a): a is DebugAction => (ACTIONS as ReadonlyArray<string>).includes(a));
      return base === 'settings' && actions.length ? { kind: 'generator', settings: true, actions } : null;
    }
  }
}
