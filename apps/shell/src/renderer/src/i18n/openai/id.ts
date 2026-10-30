import type { zh } from './zh'

export const id = {
  setupHint:
    'Gunakan GPT melalui API OpenAI. Simpan kunci API dan model Anda. Penggunaan API ditagih terpisah oleh OpenAI.',
  ready: 'Siap digunakan',
  missing: 'Tambahkan kunci API',
  other: 'Koneksi AI lain dan pengaturan lanjutan',
} satisfies Record<keyof typeof zh, string>
