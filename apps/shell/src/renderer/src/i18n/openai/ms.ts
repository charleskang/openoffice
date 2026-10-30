import type { zh } from './zh'

export const ms = {
  setupHint:
    'Gunakan GPT melalui API OpenAI. Simpan kunci API dan model anda. Penggunaan API dibilkan secara berasingan oleh OpenAI.',
  ready: 'Sedia digunakan',
  missing: 'Tambah kunci API anda',
  other: 'Sambungan AI lain dan tetapan lanjutan',
} satisfies Record<keyof typeof zh, string>
