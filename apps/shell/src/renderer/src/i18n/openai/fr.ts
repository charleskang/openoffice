import type { zh } from './zh'

export const fr = {
  setupHint:
    'Utilisez GPT via l’API OpenAI. Enregistrez votre clé API et votre modèle. L’utilisation de l’API est facturée séparément par OpenAI.',
  ready: 'Prêt à utiliser',
  missing: 'Ajoutez votre clé API',
  other: 'Autres connexions IA et paramètres avancés',
} satisfies Record<keyof typeof zh, string>
