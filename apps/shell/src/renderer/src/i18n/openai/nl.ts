import type { zh } from './zh'

export const nl = {
  setupHint:
    'Gebruik GPT via de OpenAI API. Sla uw API-sleutel en model op. OpenAI brengt API-gebruik afzonderlijk in rekening.',
  ready: 'Klaar voor gebruik',
  missing: 'Voeg uw API-sleutel toe',
  other: 'Andere AI-verbindingen en geavanceerde instellingen',
} satisfies Record<keyof typeof zh, string>
