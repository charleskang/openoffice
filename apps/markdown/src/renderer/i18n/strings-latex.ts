import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './latex/zh'
import { en } from './latex/en'
import { ko } from './latex/ko'
import { ja } from './latex/ja'
import { fr } from './latex/fr'
import { de } from './latex/de'
import { es } from './latex/es'
import { th } from './latex/th'
import { id } from './latex/id'
import { ru } from './latex/ru'
import { ar } from './latex/ar'
import { pt } from './latex/pt'
import { it } from './latex/it'
import { pl } from './latex/pl'
import { cs } from './latex/cs'
import { nl } from './latex/nl'
import { ms } from './latex/ms'
import { he } from './latex/he'
import { hi } from './latex/hi'
import { zhTW } from './latex/zh-TW'
import { vi } from './latex/vi'

const translate = createI18n(
  defineStrings({
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
  }),
)
export function latexText(lang: Lang, key: keyof typeof zh, params?: Params): string {
  return translate(lang, key, params)
}
