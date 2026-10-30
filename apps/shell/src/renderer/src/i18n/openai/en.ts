import type { zh } from './zh'

export const en = {
  setupHint:
    'Use GPT through the OpenAI API. Save your API key and model to get started. OpenAI bills API usage separately.',
  ready: 'Ready to use',
  missing: 'Add your API key',
  other: 'Other AI connections and advanced settings',
} satisfies Record<keyof typeof zh, string>
