/** Reference-preserving chart edits driven by the worksheet's ordered row/column journal. */
import { escapeXmlText } from './xml-utils'
import { parseChartXml } from './chart'

export interface ChartWorkbookStructuralOp {
  sheetName: string
  kind: 'insert-rows' | 'remove-rows' | 'insert-cols' | 'remove-cols'
  /** Zero-based, in the coordinate space left by earlier operations. */
  index: number
  count: number
}

interface Ref {
  sheet: string
  token: string
  c1: number
  r1: number
  c2: number
  r2: number
  marks: [string, string, string, string]
  range: boolean
}
type Axis = 'row' | 'col'
interface Series {
  token: string
  source: string
  group: number
  ref: Ref | null
  axis: Axis
  result: string
  before: string[]
  after: string[]
}
const ROLES = /<c:(tx|cat|val|xVal|yVal|bubbleSize)\b[^>]*>[\s\S]*?<\/c:\1>/g
const FORMULAS = /(<(?:c|c\d+):(?:f|sqref)\b[^>]*>)([\s\S]*?)(<\/(?:c|c\d+):(?:f|sqref)>)/g
const COLORS = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']
const decode = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, code: string) => {
    if (code[0] === '#')
      return String.fromCodePoint(
        code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)),
      )
    return (
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[code] ?? _
    )
  })
const col = (s: string): number =>
  [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
const letters = (n: number): string =>
  n >= 0 ? letters(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26)) : ''

function parseRef(s: string): Ref | null {
  const m =
    /^(('(?:[^']|'')+'|[^'![\]]+))!(\$?)([A-Z]+)(\$?)(\d+)(?::(\$?)([A-Z]+)(\$?)(\d+))?$/i.exec(s)
  if (!m) return null
  const sheet = m[1]!.startsWith("'") ? m[1]!.slice(1, -1).replace(/''/g, "'") : m[1]!
  const ref: Ref = {
    sheet,
    token: m[1]!,
    c1: col(m[4]!),
    r1: Number(m[6]) - 1,
    c2: col(m[8] ?? m[4]!),
    r2: Number(m[10] ?? m[6]) - 1,
    marks: [m[3]!, m[5]!, m[7] ?? m[3]!, m[9] ?? m[5]!],
    range: m[8] !== undefined,
  }
  if (ref.r1 < 0 || ref.r2 > 1048575 || ref.c2 > 16383 || ref.c1 > ref.c2 || ref.r1 > ref.r2)
    throw new Error('Chart reference is outside the worksheet.')
  return ref
}
function formatRef(r: Ref): string {
  const start = r.marks[0] + letters(r.c1) + r.marks[1] + (r.r1 + 1)
  const end = r.marks[2] + letters(r.c2) + r.marks[3] + (r.r2 + 1)
  return r.token + '!' + start + (r.range || r.r1 !== r.r2 || r.c1 !== r.c2 ? ':' + end : '')
}
function axisOf(op: ChartWorkbookStructuralOp): Axis {
  return op.kind.endsWith('rows') ? 'row' : 'col'
}
function insertion(op: ChartWorkbookStructuralOp): boolean {
  return op.kind.startsWith('insert')
}
function span(ref: Ref, axis: Axis): [number, number] {
  return axis === 'row' ? [ref.r1, ref.r2] : [ref.c1, ref.c2]
}
function withSpan(ref: Ref, axis: Axis, lo: number, hi: number): Ref {
  return axis === 'row' ? { ...ref, r1: lo, r2: hi } : { ...ref, c1: lo, c2: hi }
}
function shift(ref: Ref, op: ChartWorkbookStructuralOp, expand: boolean): Ref | null {
  if (ref.sheet.toLowerCase() !== op.sheetName.toLowerCase()) return ref
  const axis = axisOf(op),
    [lo, hi] = span(ref, axis),
    at = op.index,
    n = op.count
  let a = lo,
    b = hi
  if (insertion(op)) {
    if (at < lo || (!expand && at === lo)) {
      a += n
      b += n
    } else if (at <= hi || (expand && at === hi + 1)) b += n
  } else {
    const last = at + n - 1
    if (last < lo) {
      a -= n
      b -= n
    } else if (at <= hi) {
      const removed = Math.min(hi, last) - Math.max(lo, at) + 1
      if (removed >= hi - lo + 1) return null
      a = lo < at ? lo : at
      b = a + (hi - lo + 1 - removed) - 1
    }
  }
  const limit = axis === 'row' ? 1048575 : 16383
  if (a < 0 || b > limit) throw new Error('The chart range would leave the worksheet.')
  return withSpan(ref, axis, a, b)
}
function firstRef(xml: string): Ref | null {
  const m = /<(?:c|c\d+):(?:f|sqref)\b[^>]*>([\s\S]*?)<\/(?:c|c\d+):(?:f|sqref)>/.exec(xml)
  return m ? parseRef(decode(m[1]!)) : null
}
function role(xml: string, name: string): string | undefined {
  return new RegExp('<c:' + name + '\\b[^>]*>[\\s\\S]*?</c:' + name + '>').exec(xml)?.[0]
}
function valueRef(xml: string): Ref | null {
  return firstRef(role(xml, 'yVal') ?? role(xml, 'val') ?? '')
}
function orientation(ref: Ref): Axis {
  return ref.c1 !== ref.c2 ? 'col' : 'row'
}
function valueSize(ref: Ref | null): number {
  return ref ? Math.max(ref.r2 - ref.r1, ref.c2 - ref.c1) + 1 : 0
}
function cachedName(xml: string): string {
  return /<c:v\b[^>]*>([\s\S]*?)<\/c:v>/.exec(role(xml, 'tx') ?? '')?.[1] ?? ''
}

function rewriteRefs(
  xml: string,
  op: ChartWorkbookStructuralOp,
  pointAxis?: Axis,
): { xml: string; deleted: boolean } {
  let deleted = false
  const result = xml.replace(FORMULAS, (all, open: string, raw: string, close: string) => {
    const ref = parseRef(decode(raw))
    if (!ref) return all
    const expand = pointAxis
      ? axisOf(op) === pointAxis
      : valueSize(ref) > 1 && axisOf(op) === orientation(ref)
    const moved = shift(ref, op, expand)
    if (!moved) {
      deleted = true
      return open + '#REF!' + close
    }
    const formatted = formatRef(moved)
    return formatted === decode(raw) ? all : open + escapeXmlText(formatted) + close
  })
  return { xml: result, deleted }
}
function literal(name: string, count: number): string {
  const numeric = name !== 'cat'
  const tag = numeric ? 'numLit' : 'strLit'
  const pts = Array.from(
    { length: count },
    (_, i) => `<c:pt idx="${i}"><c:v>${i + 1}</c:v></c:pt>`,
  ).join('')
  return `<c:${name}><c:${tag}>${numeric ? '<c:formatCode>General</c:formatCode>' : ''}<c:ptCount val="${count}"/>${pts}</c:${tag}></c:${name}>`
}
function remapPointStyles(
  xml: string,
  before: Ref,
  after: Ref | null,
  axis: Axis,
  op: ChartWorkbookStructuralOp,
): string {
  if (axis !== axisOf(op) || before.sheet.toLowerCase() !== op.sheetName.toLowerCase()) return xml
  const oldStart = span(before, axis)[0],
    newStart = after ? span(after, axis)[0] : 0
  return xml.replace(/<c:(dPt|dLbl)\b[^>]*>[\s\S]*?<\/c:\1>/g, (block) => {
    const idx = /<c:idx\b[^>]*\bval=["'](\d+)["']/.exec(block)
    if (!idx) return block
    const old = oldStart + Number(idx[1])
    if (!after || (!insertion(op) && old >= op.index && old < op.index + op.count)) return ''
    const at = insertion(op)
      ? old >= op.index
        ? old + op.count
        : old
      : old >= op.index + op.count
        ? old - op.count
        : old
    return block.replace(/(<c:idx\b[^>]*\bval=["'])\d+/, '$1' + (at - newStart))
  })
}
function transformSeries(series: Series, op: ChartWorkbookStructuralOp): string {
  const before = series.ref
  if (!before) return rewriteRefs(series.source, op).xml
  const after = shift(before, op, axisOf(op) === series.axis)
  if (!after && axisOf(op) !== series.axis) return ''
  let result = series.source.replace(ROLES, (block, name: string) => {
    const moved = rewriteRefs(block, op, name === 'tx' ? undefined : series.axis)
    if (!moved.deleted) return moved.xml
    if (name === 'tx') return '<c:tx><c:v>' + cachedName(series.source) + '</c:v></c:tx>'
    if (name === 'val' || name === 'yVal' || name === 'bubbleSize') return literal(name, 0)
    return literal(name, valueSize(after))
  })
  result = result.replace(/<c:errBars\b[^>]*>[\s\S]*?<\/c:errBars>/g, (block) => {
    const moved = rewriteRefs(block, op)
    return moved.deleted ? '' : moved.xml
  })
  const held: string[] = []
  result = result.replace(
    /<c:(tx|cat|val|xVal|yVal|bubbleSize|errBars)\b[^>]*>[\s\S]*?<\/c:\1>/g,
    (block) => {
      const token = '\u0001CHART_ROLE_' + held.length + '\u0001'
      held.push(block)
      return token
    },
  )
  result = result.replace(/<(c\d+:datalabelsRange)\b[^>]*>[\s\S]*?<\/\1>/g, (block) => {
    const moved = rewriteRefs(block, op, series.axis)
    if (moved.deleted) return ''
    const token = '\u0001CHART_ROLE_' + held.length + '\u0001'
    held.push(moved.xml)
    return token
  })
  const other = rewriteRefs(result, op)
  if (other.deleted) throw new Error('A chart annotation references deleted cells.')
  result = other.xml
  held.forEach((block, i) => {
    result = result.replace('\u0001CHART_ROLE_' + i + '\u0001', block)
  })
  result = result.replace(/<c:ext\b[^>]*>\s*<\/c:ext>/g, '')
  result = remapPointStyles(result, before, after, series.axis, op)
  return result
}
function setTagValue(xml: string, tag: string, value: number): string {
  return xml.replace(new RegExp('(<c:' + tag + '\\b[^>]*\\bval=["\'])[^"\']+'), '$1' + value)
}
function newSeries(template: string, axis: Axis, lane: number, idx: number): string {
  const other: Axis = axis === 'row' ? 'col' : 'row'
  let result = template
    .replace(/<c:extLst\b[^>]*>[\s\S]*?<\/c:extLst>/g, '')
    .replace(
      /<c:(?:trendline|errBars|dPt|dLbl)\b[^>]*>[\s\S]*?<\/c:(?:trendline|errBars|dPt|dLbl)>/g,
      '',
    )
  result = result.replace(ROLES, (block, name: string) => {
    if (name !== 'tx' && name !== 'val' && name !== 'yVal' && name !== 'bubbleSize') return block
    return block.replace(FORMULAS, (all: string, open: string, raw: string, close: string) => {
      const ref = parseRef(decode(raw))
      return ref ? open + escapeXmlText(formatRef(withSpan(ref, other, lane, lane))) + close : all
    })
  })
  if (!firstRef(role(result, 'tx') ?? '')) {
    const ref = valueRef(result)
    const start = ref ? span(ref, axis)[0] : 0
    const header = ref && start > 0 ? withSpan(ref, axis, start - 1, start - 1) : null
    const name = header
      ? '<c:tx><c:strRef><c:f>' +
        escapeXmlText(formatRef({ ...header, range: false })) +
        '</c:f><c:strCache><c:ptCount val="0"/></c:strCache></c:strRef></c:tx>'
      : '<c:tx><c:v>Series ' + (idx + 1) + '</c:v></c:tx>'
    result = role(result, 'tx')
      ? result.replace(ROLES, (block, tag: string) => (tag === 'tx' ? name : block))
      : result.replace(/(<c:order\b[^>]*\/>)/, '$1' + name)
  }
  const color = COLORS[idx % COLORS.length]!
  result = result.replace(/<c:(spPr|marker)\b[^>]*>[\s\S]*?<\/c:\1>/g, (block) =>
    block.replace(
      /<a:(?:srgbClr|schemeClr)\b[^>]*(?:\/>|>[\s\S]*?<\/a:(?:srgbClr|schemeClr)>)/g,
      `<a:srgbClr val="${color}"/>`,
    ),
  )
  return setTagValue(result, 'idx', idx)
}

/** Filtered Office series sit below extension wrappers and are not plot members. */
function directSeries(xml: string): Set<number> {
  const stack: string[] = [],
    starts = new Set<number>()
  for (const tag of xml.matchAll(/<\/?([A-Za-z_][\w:.-]*)\b[^>]*>/g)) {
    if (tag[0].startsWith('</')) {
      stack.pop()
      continue
    }
    if (tag[1] === 'c:ser' && /^c:[a-zA-Z][a-zA-Z0-9]*Chart$/.test(stack.at(-1) ?? ''))
      starts.add(tag.index!)
    if (!tag[0].endsWith('/>')) stack.push(tag[1]!)
  }
  return starts
}

function legendIds(xml: string): number[] {
  const model = parseChartXml(xml.replace(/<c:legendEntry\b[^>]*>[\s\S]*?<\/c:legendEntry>/g, ''))
  if (!model) return []
  return (model.legendOrder ?? model.series.map((_, i) => i)).map(
    (i) => model.series[i]?.paletteIdx ?? i,
  )
}
function moveLegend(xml: string, original: string): string {
  const before = legendIds(original),
    after = legendIds(xml)
  return xml.replace(/<c:legendEntry\b[^>]*>[\s\S]*?<\/c:legendEntry>/g, (block) => {
    const position = Number(/<c:idx\b[^>]*\bval=["'](\d+)/.exec(block)?.[1])
    const id = before[position],
      next = id === undefined ? -1 : after.indexOf(id)
    return next < 0 ? '' : setTagValue(block, 'idx', next)
  })
}

export function validateChartStructuralOps(
  value: unknown,
): asserts value is readonly ChartWorkbookStructuralOp[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error('Invalid chart structural operations.')
  for (const raw of value) {
    const op = raw as ChartWorkbookStructuralOp
    if (
      !op ||
      typeof op.sheetName !== 'string' ||
      !op.sheetName ||
      !['insert-rows', 'remove-rows', 'insert-cols', 'remove-cols'].includes(op.kind) ||
      !Number.isInteger(op.index) ||
      !Number.isInteger(op.count) ||
      op.index < 0 ||
      op.count < 1 ||
      op.count > 10000 ||
      op.index + op.count > (op.kind.endsWith('rows') ? 1048576 : 16384)
    )
      throw new Error('Invalid chart row/column operation.')
  }
}

/** Only data references, series membership/order and point-indexed styles may change. */
export function transformChartWorkbookStructure(
  source: string,
  ops: readonly ChartWorkbookStructuralOp[],
): string {
  validateChartStructuralOps(ops)
  let xml = source
  for (const op of ops) {
    if (
      ![...xml.matchAll(FORMULAS)].some(
        (m) => parseRef(decode(m[2]!))?.sheet.toLowerCase() === op.sheetName.toLowerCase(),
      )
    )
      continue
    const original = xml
    const groups = [...xml.matchAll(/<c:([a-zA-Z][a-zA-Z0-9]*Chart)\b[^>]*>[\s\S]*?<\/c:\1>/g)].map(
      (m) => ({
        start: m.index!,
        end: m.index! + m[0].length,
        tag: m[1]!,
      }),
    )
    const direct = directSeries(xml)
    const records: Series[] = [
      ...xml.matchAll(/<(?:c|c\d+):ser\b[^>]*>[\s\S]*?<\/(?:c|c\d+):ser>/g),
    ].map((m, i) => {
      const ref = valueRef(m[0])
      return {
        token: '\u0001CHART_SER_' + i + '\u0001',
        source: m[0],
        group: direct.has(m.index!)
          ? groups.findIndex((g) => m.index! > g.start && m.index! < g.end)
          : -1,
        ref,
        axis: ref ? orientation(ref) : 'row',
        result: '',
        before: [],
        after: [],
      }
    })
    const active = records.filter((r) => r.group >= 0 && r.ref)
    // One-point ranges borrow the orientation of the surrounding data table.
    const point = active.find((r) => valueSize(r.ref) > 1)
    const single = active.find((r) => {
      const name = firstRef(role(r.source, 'tx') ?? '')
      return name && name.r1 === r.ref!.r1 && name.c1 < r.ref!.c1
    })
    const direction = point?.axis ?? (single ? 'col' : 'row')
    for (const r of records) if (r.ref && valueSize(r.ref) === 1) r.axis = direction
    let nextIdx =
      Math.max(
        -1,
        ...records.map((r) => Number(/<c:idx\b[^>]*\bval=["'](\d+)/.exec(r.source)?.[1] ?? -1)),
      ) + 1
    for (const r of records) {
      r.result = transformSeries(r, op)
    }
    if (insertion(op) && active.length) {
      const first = active[0]!,
        axis = first.axis,
        other: Axis = axis === 'row' ? 'col' : 'row'
      const lanes = active.map((r) => span(r.ref!, other)[0]).sort((a, b) => a - b)
      const [start, end] = span(first.ref!, axis)
      const regular =
        !active.some(
          (r) =>
            role(r.source, 'bubbleSize') || /^(?:pie|doughnut|ofPie)/i.test(groups[r.group]!.tag),
        ) &&
        active.every(
          (r) =>
            r.axis === axis &&
            r.ref!.sheet.toLowerCase() === op.sheetName.toLowerCase() &&
            span(r.ref!, axis)[0] === start &&
            span(r.ref!, axis)[1] === end &&
            span(r.ref!, other)[0] === span(r.ref!, other)[1],
        ) &&
        lanes.every((lane, i) => i === 0 || lane === lanes[i - 1]! + 1)
      if (
        regular &&
        axisOf(op) === other &&
        op.index >= lanes[0]! &&
        op.index <= lanes.at(-1)! + 1
      ) {
        if (active.length + op.count > 256)
          throw new Error('A chart cannot contain more than 256 series.')
        const candidates = [...active].sort(
          (a, b) => span(a.ref!, other)[0] - span(b.ref!, other)[0],
        )
        const template =
          [...candidates].reverse().find((r) => span(r.ref!, other)[0] < op.index) ?? candidates[0]!
        const siblings = active.filter((r) => r.group === template.group)
        const successor = siblings.find((r) => {
          const ref = valueRef(r.result)
          return ref && span(ref, other)[0] >= op.index + op.count
        })
        const target = successor ?? siblings.at(-1)!
        const added = Array.from({ length: op.count }, (_, i) =>
          newSeries(template.result, axis, op.index + i, nextIdx++),
        )
        if (successor) target.before.push(...added)
        else target.after.push(...added)
      }
    }
    let n = 0
    xml = xml.replace(
      /<(?:c|c\d+):ser\b[^>]*>[\s\S]*?<\/(?:c|c\d+):ser>/g,
      () => records[n++]!.token,
    )
    const outside = rewriteRefs(xml, op)
    if (outside.deleted) throw new Error('A chart annotation references deleted cells.')
    xml = outside.xml
    for (const r of records)
      xml = xml.replace(r.token, r.before.join('') + r.result + r.after.join(''))
    xml = xml.replace(/<(c\d+:filtered\w*Series)\b[^>]*>\s*<\/\1>/g, '')
    if (records.some((r) => !r.result || r.before.length || r.after.length)) {
      const order = new Map<number, number>()
      const indexOf = (block: string) => Number(/<c:idx\b[^>]*\bval=["'](\d+)/.exec(block)?.[1])
      const orderOf = (block: string) =>
        Number(/<c:order\b[^>]*\bval=["'](\d+)/.exec(block)?.[1] ?? 0)
      // Hidden Office series also own a full-collection order. Keep their
      // relative slots while inserting/removing displayed series around them.
      for (const r of [...records].sort((a, b) => orderOf(a.source) - orderOf(b.source))) {
        for (const block of [...r.before, r.result, ...r.after].filter(Boolean))
          order.set(indexOf(block), order.size)
      }
      xml = xml.replace(/<(?:c|c\d+):ser\b[^>]*>[\s\S]*?<\/(?:c|c\d+):ser>/g, (block) =>
        setTagValue(block, 'order', order.get(indexOf(block)) ?? 0),
      )
    }
    const pie = active.find((r) => /^(?:pie|doughnut|ofPie)/i.test(groups[r.group]!.tag))
    if (pie?.ref && pie.axis === axisOf(op)) {
      const moved = shift(pie.ref, op, true)
      // A pie legend is indexed by data point, rather than by series.
      xml = xml.replace(/<c:legendEntry\b[^>]*>[\s\S]*?<\/c:legendEntry>/g, (block) => {
        const wrapper = block.replace(/c:legendEntry/g, 'c:dPt')
        return remapPointStyles(wrapper, pie.ref!, moved, pie.axis, op).replace(
          /c:dPt/g,
          'c:legendEntry',
        )
      })
    } else if (
      records.some((r) => (r.group >= 0 && !r.result) || r.before.length || r.after.length)
    )
      xml = moveLegend(xml, original)
    if (
      active.some(
        (r) =>
          r.result &&
          firstRef(role(r.source, 'xVal') ?? '') &&
          !firstRef(role(r.result, 'xVal') ?? ''),
      )
    ) {
      xml = xml.replace(/<c:valAx\b[^>]*>[\s\S]*?<\/c:valAx>/g, (block) =>
        /<c:axPos\b[^>]*\bval=["'][bt]["']/.test(block)
          ? block.replace(/<c:(?:min|max)\b[^>]*\/>/g, '')
          : block,
      )
    }
  }
  return xml
}
