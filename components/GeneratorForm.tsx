'use client';

import { useState, useEffect } from 'react';

interface GeneratorFormProps {
  onSubmit: (data: {
    topic: string;
    lix: number;
    sentences: number;
    language: string;
    model: string;
    targetWords: number;
    targetLongWords: number;
  }) => void;
  isLoading: boolean;
  loadingMessage: string;
}

const CHILDREN_TOPICS = [
  "The Little Lost Puppy", "A Day at the Zoo", "The Magic Treehouse", "My Best Friend", "The Flying Car",
  "A Trip to the Moon", "The Secret Garden", "The Brave Knight", "The Friendly Dragon", "The Underwater City",
  "The Talking Dog", "The Magical Forest", "The Big Red Balloon", "The School Play", "The Snowman's Wish",
  "The Golden Key", "The Mystery Box", "The Time Machine", "The Robot Helper", "The Super Hero",
  "The Haunted House", "The Pirate Ship", "The Treasure Map", "The Fairy Queen", "The Giant Beanstalk",
  "The Magic Carpet", "The Enchanted Castle", "The Wishing Well", "The Invisible Boy", "The Flying Horse",
  "The Rainbow Bridge", "The Starry Night", "The Sunny Day", "The Rainy Afternoon", "The Windy Morning",
  "The Snowy Evening", "The Foggy Day", "The Stormy Night", "The Beautiful Butterfly", "The Busy Bee",
  "The Lazy Cat", "The Playful Dog", "The Wise Owl", "The Clever Fox", "The Strong Bear",
  "The Fast Cheetah", "The Slow Turtle", "The Big Elephant", "The Small Mouse", "The Tall Giraffe",
  "The Happy Dolphin", "The Scary Shark", "The Colorful Fish", "The Singing Bird", "The Dancing Frog",
  "The Jumping Kangaroo", "The Sleeping Lion", "The Hungry Wolf", "The Thirsty Camel", "The Cold Penguin",
  "The Hot Desert", "The Deep Ocean", "The High Mountain", "The Green Forest", "The Blue Sky",
  "The Bright Sun", "The White Moon", "The Twinkling Stars", "The Fluffy Clouds", "The Rolling Hills",
  "The Flowing River", "The Calm Lake", "The Raging Sea", "The Sandy Beach", "The Rocky Shore",
  "The Green Grass", "The Colorful Flowers", "The Tall Trees", "The Small Bushes", "The Singing Birds",
  "The Buzzing Bees", "The Fluttering Butterflies", "The Crawling Ants", "The Jumping Grasshoppers", "The Slithering Snakes",
  "The Hooting Owls", "The Howling Wolves", "The Roaring Lions", "The Trumpeting Elephants", "The Chattering Monkeys",
  "The Squeaking Mice", "The Croaking Frogs", "The Quacking Ducks", "The Clucking Chickens", "The Mooing Cows",
  "The Neighing Horses", "The Bleating Sheep", "The Oinking Pigs", "The Barking Dogs", "The Meowing Cats"
];

export default function GeneratorForm({ onSubmit, isLoading, loadingMessage }: GeneratorFormProps) {
  const [topic, setTopic] = useState('');
  const [lix, setLix] = useState(25);
  const [sentences, setSentences] = useState(8);
  const [language, setLanguage] = useState('German');
  const [model, setModel] = useState('claude-sonnet-4-5-20250929');
  const [placeholderTopic, setPlaceholderTopic] = useState('');

  // LIX Balancer State
  const [avgSentenceLength, setAvgSentenceLength] = useState(15);
  const [longWordPct, setLongWordPct] = useState(25);

  useEffect(() => {
    setPlaceholderTopic(CHILDREN_TOPICS[Math.floor(Math.random() * CHILDREN_TOPICS.length)]);
  }, []);

  // Sync sliders when LIX changes
  useEffect(() => {
    // Default distribution: roughly 30-40% sentence length, rest long words
    // But LIX = AvgLength + LongPct
    // Let's try to keep AvgLength reasonable (10-25)
    let newAvgLength = 15;
    if (lix < 30) newAvgLength = 10;
    else if (lix < 40) newAvgLength = 12;
    else if (lix < 50) newAvgLength = 14;
    else if (lix < 60) newAvgLength = 17;
    else newAvgLength = 20;

    // Clamp to ensure LongPct is positive
    if (newAvgLength > lix) newAvgLength = lix;

    setAvgSentenceLength(newAvgLength);
    setLongWordPct(lix - newAvgLength);
  }, [lix]);

  // Handle slider changes
  const handleLengthChange = (newLength: number) => {
    setAvgSentenceLength(newLength);
    setLongWordPct(lix - newLength);
  };

  const handlePctChange = (newPct: number) => {
    setLongWordPct(newPct);
    setAvgSentenceLength(lix - newPct);
  };

  // Calculate derived metrics for display
  const targetWords = Math.round(sentences * avgSentenceLength);
  const targetLongWords = Math.round((targetWords * longWordPct) / 100);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      topic: topic || placeholderTopic,
      lix,
      sentences,
      language,
      model,
      targetWords,
      targetLongWords
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-xl shadow-lg border border-gray-100">
      <div className="space-y-2">
        <label htmlFor="model" className="block text-sm font-medium text-gray-700">
          AI Model
        </label>
        <select
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white"
        >
          <option value="claude-opus-4-1-20250805">Claude Opus 4.1 (Best Reasoning)</option>
          <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5 (Recommended)</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Fastest)</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label htmlFor="topic" className="block text-sm font-medium text-gray-700">
            Topic
          </label>
          <input
            type="text"
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            placeholder={placeholderTopic}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="language" className="block text-sm font-medium text-gray-700">
            Language
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          >
            <option value="German">German</option>
            <option value="English">English</option>
            <option value="French">French</option>
            <option value="Italian">Italian</option>
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="lix" className="block text-sm font-medium text-gray-700">
            Target LIX Score
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLix(Math.max(10, lix - 5))}
              className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-gray-600"
              title="Decrease by 5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"></path>
              </svg>
            </button>
            <input
              type="number"
              id="lix"
              value={lix}
              onChange={(e) => setLix(Number(e.target.value))}
              min="10"
              max="100"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-center"
            />
            <button
              type="button"
              onClick={() => setLix(Math.min(100, lix + 5))}
              className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-gray-600"
              title="Increase by 5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Lower = Easier (e.g. 30), Higher = Harder (e.g. 60)
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="sentences" className="block text-sm font-medium text-gray-700">
            Number of Sentences
          </label>
          <input
            type="number"
            id="sentences"
            value={sentences}
            onChange={(e) => setSentences(Number(e.target.value))}
            min="1"
            max="50"
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      {/* LIX Balancer UI */}
      <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-gray-900">LIX Balancer</h3>
          <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border">
            Sum: {(avgSentenceLength + longWordPct).toFixed(0)} (Target: {lix})
          </span>
        </div>

        <p className="text-xs text-gray-600">
          Adjust how the LIX score is achieved. Moving one slider automatically adjusts the other.
        </p>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <label className="font-medium text-gray-700">Avg Sentence Length</label>
              <span className="text-gray-900">{avgSentenceLength.toFixed(1)} words/sentence</span>
            </div>
            <input
              type="range"
              min="5"
              max={Math.min(lix, 40)}
              step="0.5"
              value={avgSentenceLength}
              onChange={(e) => handleLengthChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <label className="font-medium text-gray-700">Long Word Percentage</label>
              <span className="text-gray-900">{longWordPct.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(0, lix - 5)}
              step="0.5"
              value={longWordPct}
              onChange={(e) => handlePctChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
        </div>

        <div className="bg-white p-4 rounded border border-gray-200 text-center space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Calculation</p>
          <div className="flex items-center justify-center gap-2 text-sm font-mono">
            <div className="flex flex-col items-center">
              <input
                type="number"
                value={avgSentenceLength.toFixed(1)}
                onChange={(e) => {
                  const newVal = parseFloat(e.target.value) || 0;
                  const clampedVal = Math.max(5, Math.min(Math.min(lix, 40), newVal));
                  handleLengthChange(clampedVal);
                }}
                step="0.1"
                className="w-16 text-blue-600 font-bold text-center bg-transparent border-b-2 border-blue-300 focus:border-blue-500 focus:outline-none hover:border-blue-400 transition-colors"
              />
              <span className="text-[10px] text-gray-400 mt-1">Avg Length</span>
            </div>
            <span className="text-gray-400">+</span>
            <div className="flex flex-col items-center">
              <input
                type="number"
                value={longWordPct.toFixed(1)}
                onChange={(e) => {
                  const newVal = parseFloat(e.target.value) || 0;
                  const clampedVal = Math.max(0, Math.min(Math.max(0, lix - 5), newVal));
                  handlePctChange(clampedVal);
                }}
                step="0.1"
                className="w-16 text-indigo-600 font-bold text-center bg-transparent border-b-2 border-indigo-300 focus:border-indigo-500 focus:outline-none hover:border-indigo-400 transition-colors"
              />
              <span className="text-[10px] text-gray-400 mt-1">Long Words %</span>
            </div>
            <span className="text-gray-400">=</span>
            <div className="flex flex-col items-center">
              <input
                type="number"
                value={(avgSentenceLength + longWordPct).toFixed(1)}
                readOnly
                step="0.1"
                className="w-16 text-gray-900 font-bold text-center bg-transparent border-b-2 border-gray-300 cursor-not-allowed"
              />
              <span className="text-[10px] text-gray-400 mt-1">LIX Score</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-200">
          <div className="text-center">
            <div className="text-xs text-gray-500">Total Words</div>
            <div className="font-mono font-bold text-gray-900">{targetWords}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">Long Words</div>
            <div className="font-mono font-bold text-gray-900">{targetLongWords}</div>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className={`w-full py-3 px-6 text-white font-semibold rounded-lg shadow-md transition-all transform hover:scale-[1.02] active:scale-[0.98] ${isLoading
          ? 'bg-gray-400 cursor-not-allowed'
          : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
          }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {loadingMessage}
          </span>
        ) : (
          'Generate Text'
        )}
      </button>
    </form>
  );
}
