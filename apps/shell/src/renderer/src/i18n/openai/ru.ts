import type { zh } from './zh'

export const ru = {
  setupHint:
    'Используйте GPT через API OpenAI. Сохраните ключ API и модель. OpenAI отдельно взимает плату за использование API.',
  ready: 'Готово к работе',
  missing: 'Добавьте ключ API',
  other: 'Другие подключения ИИ и расширенные настройки',
} satisfies Record<keyof typeof zh, string>
