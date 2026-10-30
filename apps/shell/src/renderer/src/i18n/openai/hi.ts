import type { zh } from './zh'

export const hi = {
  setupHint:
    'OpenAI API से GPT का उपयोग करें। अपनी API कुंजी और मॉडल सहेजें। OpenAI API उपयोग का शुल्क अलग से लेता है।',
  ready: 'उपयोग के लिए तैयार',
  missing: 'अपनी API कुंजी जोड़ें',
  other: 'अन्य AI कनेक्शन और उन्नत सेटिंग',
} satisfies Record<keyof typeof zh, string>
