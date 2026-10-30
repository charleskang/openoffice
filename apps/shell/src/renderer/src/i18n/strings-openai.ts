import { createI18n, defineStrings, type Lang } from '@genoffice/i18n'
import { zh } from './openai/zh'
import { en } from './openai/en'
import { ko } from './openai/ko'
import { ja } from './openai/ja'
import { fr } from './openai/fr'
import { de } from './openai/de'
import { es } from './openai/es'
import { th } from './openai/th'
import { id } from './openai/id'
import { ru } from './openai/ru'
import { ar } from './openai/ar'
import { pt } from './openai/pt'
import { it } from './openai/it'
import { pl } from './openai/pl'
import { cs } from './openai/cs'
import { nl } from './openai/nl'
import { ms } from './openai/ms'
import { he } from './openai/he'
import { hi } from './openai/hi'
import { zhTW } from './openai/zh-TW'
import { vi } from './openai/vi'

const strings = defineStrings({
  zh,
  en,
  ko,
  ja,
  fr,
  de,
  es,
  th,
  id,
  ru,
  ar,
  pt,
  it,
  pl,
  cs,
  nl,
  ms,
  he,
  hi,
  'zh-TW': zhTW,
  vi,
})
const translate = createI18n(strings)
export function openAiText(lang: Lang, key: keyof typeof zh): string {
  return translate(lang, key)
}
