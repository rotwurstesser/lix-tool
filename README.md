# LIX Text Generator

Generate texts with specific readability scores using AI. This tool creates educational content that precisely matches LIX (Läsbarhetsindex) readability constraints, powered by OpenRouter AI.

![LIX Generator Screenshot](/screenshot.png)

## Features

- **Precision LIX Scoring**: Calculates exact readability metrics including sentence count, word count, and long word analysis
- **Story Generation**: Creates coherent, engaging children's stories on any topic
- **Multiple Languages**: Generate texts in German, English, French, and Italian
- **Model Selection**: Choose between DeepSeek R1 Distill 70B (Fast & Precise), TNG R1t Chimera (Storyteller), or GPT-4o
- **Real-time Feedback**: See generation attempts and validation errors in real-time
- **LIX Balancer**: Adjust the balance between average sentence length and long word percentage
- **Responsive Design**: Clean, modern UI that works on all devices

## Getting Started

### Prerequisites

- Node.js 18+
- OpenRouter API Key

### Installation

1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Clone the repository
3. Install dependencies: `npm install`
4. Add your OpenRouter API key to `.env.local`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

5. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## How it works

1. **Input Parameters**: User sets topic, target LIX score, number of sentences, and language.
2. **Formula Calculation**: The app calculates the required average sentence length and percentage of long words (7+ chars).
3. **AI Generation**: The specialized model generates text using structured chain-of-thought prompting (`<thinking>` tags) to plan exact word counts.
4. **Validation**: The app verifies the output against the strict mathematical constraints.
5. **Auto-Correction**: If the output is incorrect, it feeds the specific error back to the model and retries automatically (up to 3 times).

## Tech Stack

- [Next.js 16](https://nextjs.org) - React framework
- [OpenRouter API](https://openrouter.ai) - AI text generation
- [DeepSeek R1 Distill](https://openrouter.ai/deepseek/deepseek-r1-distill-llama-70b) - Fast Reasoning Model
- [Tailwind CSS 4](https://tailwindcss.com) - Styling
- [TypeScript](https://www.typescriptlang.org) - Type safety

## License

MIT
