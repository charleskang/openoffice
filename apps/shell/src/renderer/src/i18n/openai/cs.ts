import type { zh } from './zh'

export const cs = {
  setupHint:
    'Používejte GPT přes API OpenAI. Uložte klíč API a model. OpenAI účtuje používání API samostatně.',
  ready: 'Připraveno k použití',
  missing: 'Přidejte klíč API',
  other: 'Další připojení AI a pokročilá nastavení',
} satisfies Record<keyof typeof zh, string>
