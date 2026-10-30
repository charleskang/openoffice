import { createI18n, defineStrings, type Lang } from '@genoffice/i18n'
import { zh } from './workspace/zh'
import { en } from './workspace/en'
import { ko } from './workspace/ko'
import { ja } from './workspace/ja'
import { fr } from './workspace/fr'
import { de } from './workspace/de'
import { es } from './workspace/es'
import { th } from './workspace/th'
import { id } from './workspace/id'
import { ru } from './workspace/ru'
import { ar } from './workspace/ar'
import { pt } from './workspace/pt'
import { it } from './workspace/it'
import { pl } from './workspace/pl'
import { cs } from './workspace/cs'
import { nl } from './workspace/nl'
import { ms } from './workspace/ms'
import { he } from './workspace/he'
import { hi } from './workspace/hi'
import { zhTW } from './workspace/zh-TW'
import { vi } from './workspace/vi'

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
export function workspaceText(lang: Lang, key: keyof typeof zh): string {
  return translate(lang, key)
}
