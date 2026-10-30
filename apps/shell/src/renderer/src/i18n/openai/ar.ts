import type { zh } from './zh'

export const ar = {
  setupHint:
    'استخدم GPT عبر OpenAI API. احفظ مفتاح API والنموذج للبدء. تفرض OpenAI رسوم استخدام API بشكل منفصل.',
  ready: 'جاهز للاستخدام',
  missing: 'أضف مفتاح API',
  other: 'اتصالات ذكاء اصطناعي أخرى وإعدادات متقدمة',
} satisfies Record<keyof typeof zh, string>
