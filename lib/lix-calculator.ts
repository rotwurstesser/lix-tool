export function calculateLix(text: string): { score: number; words: number; sentences: number; longWords: number } {
  if (!text.trim()) {
    return { score: 0, words: 0, sentences: 0, longWords: 0 };
  }

  // Remove extra whitespace
  const cleanText = text.trim().replace(/\s+/g, ' ');

  // Split into sentences (approximation using periods, exclamation marks, question marks)
  // We filter out empty strings resulting from split
  const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length || 1; // Avoid division by zero

  // Split into words
  // Remove punctuation for word counting
  const words = cleanText.replace(/[.!?,"'();:]/g, '').split(' ').filter(w => w.length > 0);
  const wordCount = words.length || 1; // Avoid division by zero

  // Count long words (> 6 characters)
  const longWords = words.filter(w => w.length > 6);
  const longWordCount = longWords.length;

  // LIX Formula: (A / B) + (C * 100 / A)
  // A = Number of words
  // B = Number of periods (sentences)
  // C = Number of long words (more than 6 letters)

  const score = (wordCount / sentenceCount) + (longWordCount * 100 / wordCount);

  return {
    score: Math.round(score * 10) / 10, // Round to 1 decimal place
    words: wordCount,
    sentences: sentenceCount,
    longWords: longWordCount
  };
}
