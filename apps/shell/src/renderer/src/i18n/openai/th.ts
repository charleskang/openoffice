import type { zh } from './zh'

export const th = {
  setupHint:
    'ใช้ GPT ผ่าน OpenAI API บันทึกคีย์ API และโมเดลเพื่อเริ่มใช้งาน โดย OpenAI จะเรียกเก็บค่าบริการ API แยกต่างหาก',
  ready: 'พร้อมใช้งาน',
  missing: 'เพิ่มคีย์ API',
  other: 'การเชื่อมต่อ AI อื่นและการตั้งค่าขั้นสูง',
} satisfies Record<keyof typeof zh, string>
