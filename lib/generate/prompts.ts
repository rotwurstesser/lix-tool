// German prompts, copied 1:1 from experiments/draft_then_fix.py (v3). The title prompt is new.

export function draftPrompt(topic: string, sentences: number, targetLix: number): string {
  const wps = pyRound(targetLix / 2);
  return (
    `Schreibe eine Kindergeschichte auf Deutsch über ${topic}. Genau ${sentences} Sätze, im Schnitt etwa ${wps} ` +
    'Wörter pro Satz. Einfache, klare, korrekte Sprache, eine richtige kleine Handlung mit Anfang und Ende. ' +
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
