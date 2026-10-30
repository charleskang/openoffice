import type { zh } from './zh'

export const ko = {
  setupHint:
    'GPT API를 기본으로 사용합니다. API 키와 모델을 저장하면 사용할 수 있습니다. API 사용료는 OpenAI에서 별도로 청구됩니다.',
  ready: '사용 준비됨',
  missing: 'API 키를 연결하세요',
  other: '다른 AI 연결 및 고급 설정',
} satisfies Record<keyof typeof zh, string>
