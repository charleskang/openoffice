import type { zh } from './zh'

export const vi = {
  setupHint:
    'Dùng GPT qua API OpenAI. Lưu khóa API và mô hình để bắt đầu. OpenAI tính phí sử dụng API riêng.',
  ready: 'Sẵn sàng sử dụng',
  missing: 'Thêm khóa API',
  other: 'Kết nối AI khác và cài đặt nâng cao',
} satisfies Record<keyof typeof zh, string>
