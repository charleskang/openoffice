/** Embedded workbook updates preserve chart styling and validate structural range edits. */
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'
import type { OpenedPptx } from './index'
import { matchesElementRef } from './identity'
import { resolveTarget } from './zip'
import { escapeXmlText } from './xml-utils'
import {
  transformChartWorkbookStructure,
  validateChartStructuralOps,
  type ChartWorkbookStructuralOp,
} from './chart-workbook-structure'

const MAX_BYTES = 16 * 1024 * 1024
const CACHE_RE =
  /<(?:c:(?:numCache|strCache)|c\d+:dlblRangeCache)\b[^>]*(?:\/>|>[\s\S]*?<\/(?:c:(?:numCache|strCache)|c\d+:dlblRangeCache)>)/g
const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false })
const list = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const text = (v: unknown): string =>
  typeof v === 'object' && v !== null
    ? String((v as Record<string, unknown>)['#text'] ?? '')
    : String(v ?? '')

export interface EmbeddedChartWorkbook {
  chartPath: string
  workbookPath: string
  chartXml: string
  workbook: Uint8Array
  chartHash: string
  workbookHash: string
}

export function getEmbeddedChartWorkbook(
  opened: OpenedPptx,
  slideIndex: number,
  sourceId: string,
): EmbeddedChartWorkbook | null {
  const slide = opened.deck.slides[slideIndex]
  const element = slide?.elements.find((e) => matchesElementRef(e, sourceId))
  if (!element || element.type !== 'chart') return null
  const rid = /<c:chart\b[^>]*\br:id=["']([^"']+)["']/.exec(element.anchor.originalXml)?.[1]
  const relation = rid && opened.archive.readRels(slide.path).get(rid)
  if (!relation || relation.targetMode === 'External' || !relation.type.endsWith('/chart'))
    return null
  const chartPath = resolveTarget(slide.path, relation.target)
  return bindingForPart(opened, chartPath)
}

function bindingForPart(
  opened: OpenedPptx,
  chartPath: string,
  known?: EmbeddedChartWorkbook,
): EmbeddedChartWorkbook | null {
  const chartXml = opened.archive.readText(chartPath)
  if (!chartXml) return null
  const workbookRid = /<c:externalData\b[^>]*\br:id=["']([^"']+)["']/.exec(chartXml)?.[1]
  const workbookRel = workbookRid && opened.archive.readRels(chartPath).get(workbookRid)
  if (
    !workbookRel ||
    workbookRel.targetMode === 'External' ||
    !workbookRel.type.endsWith('/package')
  )
    return null
  const workbookPath = resolveTarget(chartPath, workbookRel.target)
  const workbook = opened.archive.readBytes(workbookPath)
  if (!workbook || !workbookPath.startsWith('ppt/embeddings/') || !/\.xlsx$/i.test(workbookPath))
    return null
  if (workbook.byteLength > MAX_BYTES)
    throw new Error('Embedded workbook exceeds the 16 MiB editing limit.')
  return {
    chartPath,
    workbookPath,
    chartXml,
    workbook,
    chartHash: hash(chartXml),
    workbookHash: known?.workbookPath === workbookPath ? known.workbookHash : hash(workbook),
  }
}

function linkedCharts(opened: OpenedPptx, binding: EmbeddedChartWorkbook): EmbeddedChartWorkbook[] {
  const linked: EmbeddedChartWorkbook[] = []
  for (const path of opened.archive.entries.keys()) {
    if (path === binding.chartPath || !/^ppt\/charts\/[^/]+\.xml$/.test(path)) continue
    const other = bindingForPart(opened, path, binding)
    if (other?.workbookPath === binding.workbookPath) linked.push(other)
  }
  return linked
}

export interface ChartWorkbookUpdate {
  chartHash: string
  workbookHash: string
  chartXml: string
  workbookBase64: string
  structuralOps?: readonly ChartWorkbookStructuralOp[]
  relatedCharts?: Array<{ chartPath: string; chartHash: string; chartXml: string }>
}

/** Load only local cached cell values. Formulas are calculated by the sheets editor. */
export async function prepareChartWorkbookUpdate(
  binding: EmbeddedChartWorkbook,
  bytes: Uint8Array,
  structuralOps: readonly ChartWorkbookStructuralOp[] = [],
  opened?: OpenedPptx,
): Promise<ChartWorkbookUpdate> {
  const chartSource = transformChartWorkbookStructure(binding.chartXml, structuralOps)
  if (bytes.byteLength > MAX_BYTES)
    throw new Error('Embedded workbook exceeds the 16 MiB editing limit.')
  await assertZipInflatesWithinLimits(bytes, {
    maxParts: 10000,
    maxPartBytes: 32 * 1024 * 1024,
    maxTotalBytes: 64 * 1024 * 1024,
  })
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true })
  const read = async (path: string) => {
    const entry = zip.file(path)
    if (!entry) throw new Error('Missing workbook part: ' + path)
    const value = await entry.async('string')
    if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('Unsupported workbook XML declaration.')
    return xml.parse(value)
  }
  const book = (await read('xl/workbook.xml')).workbook
  const rels = list(
    (await read('xl/_rels/workbook.xml.rels')).Relationships?.Relationship,
  ) as Array<Record<string, string>>
  const strings = zip.file('xl/sharedStrings.xml')
    ? list((await read('xl/sharedStrings.xml')).sst?.si)
    : []
  const richText = (node: Record<string, unknown> | undefined): string =>
    node
      ? text(node.t) ||
        list(node.r as Record<string, unknown>[])
          .map((r) => text(r.t))
          .join('')
      : ''
  const sharedStrings = strings.map((s) => richText(s as Record<string, unknown>))
  const sheets = new Map<
    string,
    Map<string, { value: string | null; type: string; uncalculated: boolean }>
  >()
  for (const sheet of list(book?.sheets?.sheet) as Array<Record<string, string>>) {
    const rel = rels.find((r) => r['@_Id'] === sheet['@_id'])
    if (!rel || rel['@_TargetMode'] === 'External')
      throw new Error('Unsupported worksheet relationship.')
    const path = resolveTarget('xl/workbook.xml', rel['@_Target'])
    if (!path.startsWith('xl/')) throw new Error('Worksheet path is outside the workbook.')
    const worksheet = (await read(path)).worksheet
    const cells = new Map<string, { value: string | null; type: string; uncalculated: boolean }>()
    for (const row of list(worksheet?.sheetData?.row) as Array<Record<string, unknown>>) {
      for (const cell of list(row.c as Record<string, unknown>[])) {
        const type = String(cell['@_t'] ?? 'n')
        const raw = cell.v == null ? null : text(cell.v)
        const value =
          type === 's'
            ? (sharedStrings[Number(raw)] ?? null)
            : type === 'inlineStr'
              ? richText(cell.is as Record<string, unknown>)
              : raw
        cells.set(String(cell['@_r']), { value, type, uncalculated: cell.f != null && raw == null })
      }
    }
    sheets.set(sheet['@_name'], cells)
  }
  const vector = (formula: string, numeric: boolean, auxiliary = false): Array<string | null> => {
    const match =
      /^(?:'((?:[^']|'')+)'|([^'![\]]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(
        formula,
      )
    if (!match) throw new Error('Unsupported chart data reference: ' + formula)
    const sheet = sheets.get((match[1]?.replace(/''/g, "'") ?? match[2])!)
    if (!sheet) throw new Error('A worksheet used by the chart was removed or renamed.')
    const col = (s: string) =>
      [...s.toUpperCase()].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0)
    const c1 = col(match[3]!),
      c2 = col(match[5] ?? match[3]!)
    const r1 = Number(match[4]),
      r2 = Number(match[6] ?? match[4])
    if (
      (c1 !== c2 && r1 !== r2) ||
      c1 > c2 ||
      r1 > r2 ||
      c2 > 16384 ||
      r1 < 1 ||
      r2 > 1048576 ||
      Math.max(c2 - c1, r2 - r1) > 100000
    )
      throw new Error('Unsupported chart data range.')
    const name = (n: number): string =>
      n > 0 ? name(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)) : ''
    const values: Array<string | null> = []
    for (let i = 0; i <= Math.max(c2 - c1, r2 - r1); i++) {
      const cell = sheet.get(name(c1 + (c2 === c1 ? 0 : i)) + (r1 + (r2 === r1 ? 0 : i)))
      if (cell?.uncalculated || cell?.type === 'e')
        throw new Error('A chart data formula has no calculated value or contains an error.')
      let value = cell?.value ?? null
      if (numeric && value !== null && (value.trim() === '' || !Number.isFinite(Number(value))))
        if (auxiliary)
          value = '0' // Office's filtered numeric series cache text cells as zero.
        else throw new Error('A numeric chart data cell contains text.')
      values.push(value)
    }
    return values
  }
  if (/<c:multiLvlStrRef\b/.test(chartSource))
    throw new Error('Multi-level category ranges cannot be edited here.')
  let references = 0
  let chartXml = chartSource.replace(
    /<c:(numRef|strRef)\b[^>]*>[\s\S]*?<\/c:\1>/g,
    (block, kind: string) => {
      references++
      // Office stores filtered/auxiliary series references in c15:formulaRef.
      const rawFormula =
        /<c:f\b[^>]*>([\s\S]*?)<\/c:f>/.exec(block)?.[1] ??
        /<(?:[\w.-]+:)?sqref\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?sqref>/.exec(block)?.[1]
      if (!rawFormula) throw new Error('Chart data reference is missing its formula.')
      const formula = text(xml.parse('<v>' + rawFormula + '</v>').v)
      // Filtered Office series can retain text categories in a numCache. Keep
      // their original cache type; active numeric series still reject text edits.
      const existingText = [...block.matchAll(/<c:v\b[^>]*>([\s\S]*?)<\/c:v>/g)].some((m) => {
        const v = text(xml.parse('<v>' + m[1] + '</v>').v)
        return v.trim() !== '' && !Number.isFinite(Number(v))
      })
      const values = vector(formula, kind === 'numRef' && !existingText, !/<c:f\b/.test(block))
      const cacheTag = kind === 'numRef' ? 'numCache' : 'strCache'
      const previous = new RegExp(
        '<c:' + cacheTag + '\\b[^>]*(?:/>|>[\\s\\S]*?</c:' + cacheTag + '>)',
      ).exec(block)?.[0]
      const format =
        (previous && /<c:formatCode\b[^>]*>[\s\S]*?<\/c:formatCode>/.exec(previous)?.[0]) || ''
      const points = values
        .flatMap((v, i) =>
          v == null ? [] : [`<c:pt idx="${i}"><c:v>${escapeXmlText(v)}</c:v></c:pt>`],
        )
        .join('')
      const cache = `<c:${cacheTag}>${format}<c:ptCount val="${values.length}"/>${points}</c:${cacheTag}>`
      return previous
        ? block.replace(previous, cache)
        : block.replace('</c:' + kind + '>', cache + '</c:' + kind + '>')
    },
  )
  chartXml = chartXml.replace(/<(c\d+:datalabelsRange)\b[^>]*>[\s\S]*?<\/\1>/g, (block) => {
    const raw = /<(?:c|c\d+):f\b[^>]*>([\s\S]*?)<\/(?:c|c\d+):f>/.exec(block)?.[1]
    if (!raw) return block
    const values = vector(text(xml.parse('<v>' + raw + '</v>').v), false)
    return block.replace(
      /<(c\d+:dlblRangeCache)\b[^>]*>[\s\S]*?<\/\1>/,
      (_, tag: string) =>
        '<' +
        tag +
        '><c:ptCount val="' +
        values.length +
        '"/>' +
        values
          .flatMap((v, i) =>
            v === null ? [] : ['<c:pt idx="' + i + '"><c:v>' + escapeXmlText(v) + '</c:v></c:pt>'],
          )
          .join('') +
        '</' +
        tag +
        '>',
    )
  })
  if (XMLValidator.validate(chartXml) !== true)
    throw new Error('Chart XML is invalid after editing its data.')
  if (!references && !structuralOps.length) throw new Error('This chart has no linked cell ranges.')
  const relatedCharts: NonNullable<ChartWorkbookUpdate['relatedCharts']> = []
  if (opened)
    for (const other of linkedCharts(opened, binding)) {
      const next = await prepareChartWorkbookUpdate(other, bytes, structuralOps)
      relatedCharts.push({
        chartPath: other.chartPath,
        chartHash: other.chartHash,
        chartXml: next.chartXml,
      })
    }
  return {
    chartHash: binding.chartHash,
    workbookHash: binding.workbookHash,
    chartXml,
    workbookBase64: Buffer.from(bytes).toString('base64'),
    ...(structuralOps.length ? { structuralOps: [...structuralOps] } : {}),
    ...(relatedCharts.length ? { relatedCharts } : {}),
  }
}

export function validateChartWorkbookUpdate(
  binding: EmbeddedChartWorkbook | null,
  value: unknown,
  opened?: OpenedPptx,
): asserts value is ChartWorkbookUpdate {
  if (!binding || !value || typeof value !== 'object')
    throw new Error('Embedded chart workbook is unavailable.')
  const u = value as ChartWorkbookUpdate
  if (u.chartHash !== binding.chartHash || u.workbookHash !== binding.workbookHash)
    throw new Error(
      'The chart changed while its data was being edited. Close and reopen its data editor.',
    )
  const operations = u.structuralOps ?? []
  validateChartStructuralOps(operations)
  const expected = transformChartWorkbookStructure(binding.chartXml, operations)
  if (
    typeof u.chartXml !== 'string' ||
    u.chartXml.length > 32 * 1024 * 1024 ||
    u.chartXml.replace(CACHE_RE, '') !== expected.replace(CACHE_RE, '')
  )
    throw new Error('A data edit cannot change chart formatting or references.')
  if (
    typeof u.workbookBase64 !== 'string' ||
    u.workbookBase64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(u.workbookBase64)
  )
    throw new Error('Invalid embedded workbook data.')
  const bytes = Buffer.from(u.workbookBase64, 'base64')
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw new Error('Invalid embedded workbook package.')
  const related = u.relatedCharts ?? []
  const expectedRelated = opened ? linkedCharts(opened, binding) : []
  if (!Array.isArray(related) || related.length !== expectedRelated.length)
    throw new Error('A shared chart workbook requires every linked chart to be updated.')
  for (const other of expectedRelated) {
    const found = related.filter((r) => r.chartPath === other.chartPath)
    if (found.length !== 1 || found[0]!.chartHash !== other.chartHash)
      throw new Error('A linked chart changed while the worksheet was being saved.')
    const expectedXml = transformChartWorkbookStructure(other.chartXml, operations)
    if (
      typeof found[0]!.chartXml !== 'string' ||
      found[0]!.chartXml.length > 32 * 1024 * 1024 ||
      found[0]!.chartXml.replace(CACHE_RE, '') !== expectedXml.replace(CACHE_RE, '')
    )
      throw new Error('A shared chart data edit cannot change unrelated formatting.')
  }
}

export function applyChartWorkbookUpdate(
  opened: OpenedPptx,
  slideIndex: number,
  sourceId: string,
  update: ChartWorkbookUpdate,
): void {
  const binding = getEmbeddedChartWorkbook(opened, slideIndex, sourceId)
  validateChartWorkbookUpdate(binding, update, opened)
  opened.archive.entries.set(binding!.chartPath, Buffer.from(update.chartXml, 'utf8'))
  opened.archive.entries.set(binding!.workbookPath, Buffer.from(update.workbookBase64, 'base64'))
  for (const other of update.relatedCharts ?? [])
    opened.archive.entries.set(other.chartPath, Buffer.from(other.chartXml, 'utf8'))
}
