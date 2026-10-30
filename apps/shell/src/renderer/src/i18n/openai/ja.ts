import type { zh } from './zh'

export const ja = {
  setupHint:
    'GPT APIを使用します。APIキーとモデルを保存してください。APIの利用料金はOpenAIから別途請求されます。',
  ready: '利用可能',
  missing: 'APIキーを追加してください',
  other: '他のAI接続と詳細設定',
} satisfies Record<keyof typeof zh, string>
