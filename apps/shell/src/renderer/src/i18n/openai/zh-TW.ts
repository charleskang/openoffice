import type { zh } from './zh'

export const zhTW = {
  setupHint: '預設使用 GPT API。儲存 API 金鑰和模型即可開始；OpenAI 會另行計費。',
  ready: '已就緒',
  missing: '請新增 API 金鑰',
  other: '其他 AI 連線與進階設定',
} satisfies Record<keyof typeof zh, string>
