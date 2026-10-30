import type { zh } from './zh'

export const it = {
  setupHint:
    'Usa GPT tramite l’API OpenAI. Salva la chiave API e il modello. OpenAI addebita separatamente l’utilizzo dell’API.',
  ready: 'Pronto all’uso',
  missing: 'Aggiungi la chiave API',
  other: 'Altre connessioni IA e impostazioni avanzate',
} satisfies Record<keyof typeof zh, string>
