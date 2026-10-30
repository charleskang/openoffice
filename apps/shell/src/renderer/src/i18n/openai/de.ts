import type { zh } from './zh'

export const de = {
  setupHint:
    'Nutzen Sie GPT über die OpenAI API. Speichern Sie API-Schlüssel und Modell. OpenAI berechnet die API-Nutzung separat.',
  ready: 'Einsatzbereit',
  missing: 'API-Schlüssel hinzufügen',
  other: 'Weitere KI-Verbindungen und erweiterte Einstellungen',
} satisfies Record<keyof typeof zh, string>
