# LIX Text Generator

Generate texts with specific readability scores using AI. This tool creates educational content that precisely matches LIX (Läsbarhetsindex) readability constraints, powered by Claude AI.

**🌐 Live Demo:** https://remarkable-platypus-e70326.netlify.app

## What is LIX?

LIX (Läsbarhetsindex) is a readability index that indicates the difficulty of reading a text. It's calculated as:

```
LIX = (words / sentences) + (longWords * 100 / words)
```

Where:
- **Words**: Total word count
- **Sentences**: Number of sentences (ending with `.`, `!`, or `?`)
- **Long Words**: Words with more than 6 letters (7+ letters)

### Readability Levels

- **< 30**: Very Easy (Children)
- **30 - 40**: Easy (Fiction)
- **40 - 50**: Medium (Newspaper)
- **> 50**: Hard (Academic)

## Features

- **Precise Constraint Matching**: Uses advanced prompt engineering to generate texts that match exact LIX scores
- **Multi-Attempt Generation**: Automatically retries up to 3 times with detailed feedback to meet constraints
- **Real-Time Progress**: Stream updates showing each attempt and validation results
- **Error Handling**: Comprehensive error reporting with retry functionality
- **Multiple Languages**: Generate texts in any language supported by Claude
- **Model Selection**: Choose between Claude Opus 4.1, Claude Sonnet 4.5, or Claude Haiku 4.5
- **Interactive Editing**: Edit LIX calculation parameters directly in the results

## Recent Improvements

### Error Handling (Latest)
- Fixed issue where generation errors weren't displayed to users
- Proper stream error handling with user-friendly error messages
- Added "Try Again" button when errors occur

### Prompt Engineering (Latest)
Applied chain-of-thought and structured generation best practices:
- Step-by-step process with numbered instructions
- Pre-selection of long words with letter counting
- Mandatory verification before submission
- Clear definitions with examples
- Detailed error feedback with specific guidance on how to fix issues
- Emphasis on precision over creativity

These improvements dramatically increase the accuracy of constraint matching, especially for the critical long word count metric.

## Setup

### Prerequisites

- Node.js 20+
- npm, yarn, pnpm, or bun
- Anthropic API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/rotwurstesser/lix-tool.git
cd lix-tool
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env.local
```

4. Add your Anthropic API key to `.env.local`:
```
ANTHROPIC_API_KEY=your_api_key_here
# or
LIX_ANTHROPIC_KEY=your_api_key_here
```

### Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

### Build

```bash
npm run build
npm start
```

## How It Works

1. **User Input**: Enter topic, target LIX score, sentence count, and language
2. **Constraint Calculation**: System calculates required word count and long word count
3. **AI Generation**: Claude generates text using structured chain-of-thought prompting
4. **Validation**: System validates sentence count and long word count
5. **Retry Loop**: If constraints aren't met, detailed feedback is provided and generation retries (up to 3 attempts)
6. **Results**: Display generated text with actual LIX score and generation history

## Technical Details

### Prompt Engineering

The system uses advanced prompt engineering techniques:

- **Chain-of-Thought**: Forces step-by-step reasoning and planning
- **Pre-Selection**: Requires listing exact long words before writing
- **Self-Verification**: Mandatory counting and verification step
- **Structured Output**: Uses XML tags (`<thinking>` and `<text>`) to separate reasoning from output
- **Detailed Feedback**: Provides specific guidance on constraint violations

### Validation

The system validates:
- Sentence count (exact match required)
- Long word count (exact match required, words with 7+ letters)
- Total word count (approximate target)

### API

Built with Next.js App Router:
- `POST /api/generate`: Streaming endpoint for text generation
- Supports Claude 4.5 models (Opus 4.1, Sonnet 4.5, Haiku 4.5)
- Real-time streaming updates for each generation attempt

## Contributing

Improvements? You can fork this project on GitHub and submit pull requests!

## Tech Stack

- [Next.js 16](https://nextjs.org) - React framework
- [Anthropic Claude API](https://www.anthropic.com) - AI text generation
- [Tailwind CSS 4](https://tailwindcss.com) - Styling
- [TypeScript](https://www.typescriptlang.org) - Type safety

## License

MIT
