import type { zh } from './zh'

export const pl = {
  setupHint:
    'Korzystaj z GPT przez API OpenAI. Zapisz klucz API i model. OpenAI nalicza opłaty za API oddzielnie.',
  ready: 'Gotowe do użycia',
  missing: 'Dodaj klucz API',
  other: 'Inne połączenia AI i ustawienia zaawansowane',
} satisfies Record<keyof typeof zh, string>
