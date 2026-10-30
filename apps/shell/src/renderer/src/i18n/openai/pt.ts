import type { zh } from './zh'

export const pt = {
  setupHint:
    'Use o GPT pela API da OpenAI. Salve sua chave de API e modelo. O uso da API é cobrado separadamente pela OpenAI.',
  ready: 'Pronto para usar',
  missing: 'Adicione sua chave de API',
  other: 'Outras conexões de IA e configurações avançadas',
} satisfies Record<keyof typeof zh, string>
