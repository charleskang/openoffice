import type { zh } from './zh'

export const he = {
  setupHint:
    'השתמשו ב-GPT דרך OpenAI API. שמרו את מפתח ה-API ואת המודל. OpenAI מחייבת בנפרד על השימוש ב-API.',
  ready: 'מוכן לשימוש',
  missing: 'הוסיפו מפתח API',
  other: 'חיבורי AI נוספים והגדרות מתקדמות',
} satisfies Record<keyof typeof zh, string>
