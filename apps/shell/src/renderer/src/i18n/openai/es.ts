import type { zh } from './zh'

export const es = {
  setupHint:
    'Usa GPT mediante la API de OpenAI. Guarda tu clave API y modelo. OpenAI factura el uso de la API por separado.',
  ready: 'Listo para usar',
  missing: 'Añade tu clave API',
  other: 'Otras conexiones de IA y ajustes avanzados',
} satisfies Record<keyof typeof zh, string>
