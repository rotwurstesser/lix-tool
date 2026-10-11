// German prompts from experiments/draft_then_fix.py (v3). New: the title prompt and the low-target hints in the draft prompt.

// Below this target the draft prompt asks for mostly short words.
export const SHORT_WORDS_BELOW = 30;

// Words-per-sentence hint for the draft. LIX = words per sentence + percent of long words.
// Below LIX 35, target / 2 gives drafts that start too high: the long words add points.
// target - 17 (tuned on the dev set) meets target / 2 at 35 without a jump; target - 20 gave drafts too low.
export function wordsPerSentence(targetLix: number): number {
  return targetLix < 35 ? Math.max(5, Math.round(targetLix - 17)) : pyRound(targetLix / 2);
}

export function draftPrompt(topic: string, sentences: number, targetLix: number): string {
  const shortWords =
    targetLix < SHORT_WORDS_BELOW ? 'Verwende kurze, einfache Wörter, meist mit höchstens 6 Buchstaben. ' : '';
  return (
    `Schreibe eine Kindergeschichte auf Deutsch über ${topic}. Genau ${sentences} Sätze, im Schnitt etwa ` +
    `${wordsPerSentence(targetLix)} Wörter pro Satz. ${shortWords}` +
    'Einfache, klare, korrekte Sprache, eine richtige kleine Handlung mit Anfang und Ende. ' +
    'Kein Titel, keine Formatierung. Gib nur die Geschichte aus.'
  );
}

export function titlePrompt(story: string): string {
  return (
    'Gib dieser Kindergeschichte einen kurzen Titel mit 1 bis 3 Wörtern. Keine Satzzeichen, keine Anführungszeichen. ' +
    `Gib nur den Titel aus.\n\nGeschichte:\n${story}`
  );
}

export function editPrompt(story: string, instruction: string, text: string): string {
  return (
    `Geschichte:\n${story}\n\nAufgabe: ${instruction}\nText: ${text}\n\n` +
    'Gib 3 Varianten aus, jede auf einer eigenen Zeile, nummeriert. Korrekte deutsche Grammatik. Nur die Varianten.'
  );
}

export function grammarFixPrompt(story: string): string {
  return (
    'Korrigiere nur Grammatikfehler (Wortformen, Endungen, Zeitform) in dieser Geschichte. ' +
    `Ändere sonst nichts. Gib nur die Geschichte aus.\n\n${story}`
  );
}

export function grammarCheckPrompt(sentence: string): string {
  return (
    'Ist dieser deutsche Satz grammatisch korrekt (Wortformen, Endungen, Zeitform)? ' +
    `Antworte nur mit JA oder NEIN.\nSatz: ${sentence}`
  );
}

// One LanguageTool finding per line, with its suggested fix when there is one.
export function grammarRepairPrompt(sentence: string, issues: Array<{ message: string; snippet: string; replacements?: string[] }>): string {
  const lines = issues.map((i) => {
    const fix = i.replacements?.length ? ` Vorschlag: „${i.replacements[0]}“.` : '';
    return `- „${i.snippet}“: ${i.message}${fix}`;
  });
  return (
    `Im folgenden Satz ist ein Fehler.\nSatz: ${sentence}\nFehler:\n${lines.join('\n')}\n\n` +
    'Korrigiere nur diesen Fehler. Ändere sonst nichts. Gib nur den korrigierten Satz aus.'
  );
}

export const INSTRUCTIONS = {
  shortenWord:
    'Schreibe den Satz um. Gleiche Bedeutung, aber ersetze ein langes Wort (mehr als 6 Buchstaben) ' +
    'durch ein kurzes, echtes Wort (höchstens 6 Buchstaben). Kürze keine Wörter ab.',
  split: 'Teile den Satz in zwei kurze, natürliche Sätze. Gleiche Bedeutung.',
  lengthenWord:
    'Schreibe den Satz um. Gleiche Bedeutung, aber ersetze ein kurzes Wort durch ein passendes ' +
    'längeres Wort (mindestens 7 Buchstaben).',
  join: 'Verbinde die zwei Sätze zu einem natürlichen Satz. Gleiche Bedeutung.',
} as const;

// Python round() on an integer target: half to even (round(25 / 2) == 12).
function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}
