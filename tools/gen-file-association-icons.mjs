/**
 * Generates every file-type icon the app ships, from one drawing defined in
 * this script:
 *
 *   apps/shell/src/renderer/src/assets/file-<type>.svg
 *       the home screen, Drive browser and tab strip icons (imported by
 *       Home.tsx, DriveBrowser.tsx and TabBar.tsx)
 *   apps/shell/build/<type>.ico / <type>.icns
 *       the per-type document icons electron-builder bakes into the OS file
 *       associations (apps/shell/electron-builder.cjs fileAssociations `icon`
 *       field) and that build/installer.nsh points the Open-With ProgIds at
 *   apps/shell/src/main/assets/menu-<type>.png / menu-<type>@2x.png
 *       the native window-menu icons (16 px and its retina copy)
 *   apps/<app>/src/renderer/assets/file-<kind>.png (and the mind map's and
 *   the EPUB editor's src/renderer/ai/assets copies)
 *       the AI panel's attachment-card icons, one identical set per editor
 *
 * The icons use the OfficeMax A family: a solid rounded tile and a white
 * content pictogram. SVGs retain size-specific detail for small menus and tabs.
 * No vendor logos or signature glyphs are used.
 *
 * The Hangul syllable on the HWP icon is converted to outlines from
 * Pretendard Bold (SIL OFL 1.1, packages/ui/template-fonts, listed in
 * NOTICE), so the icons do not depend on the fonts installed where they are
 * shown.
 *
 * Edit the FORMATS / GENERIC tables or the drawing below, never the generated
 * files, then run:
 *   node tools/gen-file-association-icons.mjs
 *
 * Optional: `--preview <file.png>` also writes a contact sheet (every icon at
 * 16/20/24/32/48/64/96/256 px on light and dark backgrounds); `--no-write`
 * skips writing into the repo. The sheet is never part of the repo.
 *
 * The SVG is rasterized with the system Chrome (or Edge) through
 * playwright-core. The ICO and ICNS containers are written by hand (the same
 * container code as tools/gen-brand-assets.mjs), so the script runs on any
 * host OS.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const GLYPH_FONT = join(root, 'packages/ui/template-fonts/Pretendard-Bold.otf')

// ── the family ──────────────────────────────────────────────────────────────

/**
 * One entry per format icon: the tile color, and the
 * pictogram. Formats that share an icon (xlsm/xls/csv/tsv on xlsx, hwpx on
 * hwp, htm on html, markdown on md, odt on docx) are mapped in Home.tsx,
 * DriveBrowser.tsx and electron-builder.cjs. The colors are one palette of
 * similar lightness and chroma, our own and away from any vendor's brand
 * color.
 */
const FORMATS = {
  docx: { color: '#3974CD', picto: 'paragraphs' }, // indigo
  xlsx: { color: '#19836D', picto: 'cells' }, // teal green
  pptx: { color: '#BE672F', picto: 'slide' }, // amber
  pdf: { color: '#B84A5C', picto: 'stamp' }, // crimson
  hwp: { color: '#2E7FAA', picto: 'syllable' }, // cyan blue
  tex: { color: '#8056B8', picto: 'latex' }, // violet
  md: { color: '#4A5568', picto: 'hash' }, // slate
  html: { color: '#8257B6', picto: 'tag' }, // violet
  mindmap: { color: '#B04E83', picto: 'nodes' }, // berry
  epub: { color: '#8E5B3E', picto: 'book' }, // leather brown
  txt: { color: '#858D9B', picto: 'lines' }, // gray
  json: { color: '#977A2E', picto: 'braces' }, // ochre
}

/** Attachment kinds that are not a single format. */
const GENERIC = {
  image: { color: '#4A8A3E', picto: 'picture' }, // leaf green
  video: { color: '#6E5AAE', picto: 'play' }, // blue violet
  voice: { color: '#C25A3C', picto: 'wave' }, // terracotta
  document: { color: '#858D9B', picto: 'lines' }, // gray
  general: { color: '#A0A7B2', picto: 'none' }, // light gray
}

// Rendered sizes (CSS px) up to SMALL_MAX_PX draw the 16 px drawing, from
// LARGE_MIN_PX the full drawing, the mid-size one between.
const SMALL_MAX_PX = 23.98
const LARGE_MIN_PX = 40

// ── outputs ─────────────────────────────────────────────────────────────────

const SVG_DIR = 'apps/shell/src/renderer/src/assets'
const BUILD_DIR = 'apps/shell/build'
const MENU_DIR = 'apps/shell/src/main/assets'
const MENU_TYPES = ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'mindmap', 'hwp', 'epub']

/** attachment-card file name -> icon key (FORMATS or GENERIC) */
const ATTACHMENT_ICONS = {
  'file-word.png': 'docx',
  'file-excel.png': 'xlsx',
  'file-ppt.png': 'pptx',
  'file-pdf.png': 'pdf',
  'file-image.png': 'image',
  'file-video.png': 'video',
  'file-voice.png': 'voice',
  'file-document.png': 'document',
  'file-general.png': 'general',
}
/** editor asset folder -> the attachment icons that folder carries */
const ATTACHMENT_DIRS = {
  'apps/docs/src/renderer/assets': Object.keys(ATTACHMENT_ICONS),
  'apps/sheets/src/renderer/assets': Object.keys(ATTACHMENT_ICONS),
  'apps/slides/src/renderer/assets': Object.keys(ATTACHMENT_ICONS),
  'apps/html/src/renderer/assets': Object.keys(ATTACHMENT_ICONS),
  'apps/hwp/src/renderer/assets': Object.keys(ATTACHMENT_ICONS).filter(
    (name) => name !== 'file-video.png' && name !== 'file-voice.png',
  ),
  'apps/mindmap/src/renderer/ai/assets': Object.keys(ATTACHMENT_ICONS).filter(
    (name) => name !== 'file-video.png' && name !== 'file-voice.png',
  ),
  'apps/epub/src/renderer/ai/assets': Object.keys(ATTACHMENT_ICONS).filter(
    (name) => name !== 'file-video.png' && name !== 'file-voice.png',
  ),
}
// The cards draw these at 22-26 CSS px; the 48 px bitmap is the 2x copy.
const ATTACHMENT_CSS_PX = 24

const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256]
// macOS icons carry the standard app-icon grid margin (824/1024 content, same
// treatment as build/icon-mac.png) so they sit at the same optical size as
// neighboring icons in Finder. Windows icons are conventionally full-bleed.
const MAC_CONTENT_RATIO = 824 / 1024
// ICNS entries in the order iconutil writes them: [OSType, canvas px, format].
// The two smallest slots must be packed ARGB; the rest are embedded PNGs.
const ICNS_ENTRIES = [
  ['ic12', 64, 'png'],
  ['ic07', 128, 'png'],
  ['ic13', 256, 'png'],
  ['ic08', 256, 'png'],
  ['ic04', 16, 'argb'],
  ['ic14', 512, 'png'],
  ['ic09', 512, 'png'],
  ['ic05', 32, 'argb'],
  ['ic10', 1024, 'png'],
  ['ic11', 32, 'png'],
]

// ── drawing ─────────────────────────────────────────────────────────────────
// 256-unit canvas. The 16 px drawing keeps the page and spine edges on the
// 16-unit grid (one pixel at 16 px) so the menu and tab icons stay crisp.

const num = (value) => Number(value.toFixed(2))

const glyphFont = opentype.parse(readFileSync(GLYPH_FONT).buffer)

/** One character's outline as a path element, scaled to fit and centered in a box. */
function fittedGlyph(char, { x, y, w, h }, fill) {
  const path = glyphFont.getPath(char, 0, 0, 100)
  const box = path.getBoundingBox()
  const scale = Math.min(w / (box.x2 - box.x1), h / (box.y2 - box.y1))
  const left = x + (w - (box.x2 - box.x1) * scale) / 2 - box.x1 * scale
  const top = y + (h - (box.y2 - box.y1) * scale) / 2 - box.y1 * scale
  return `<path transform="translate(${num(left)} ${num(top)}) scale(${num(scale)})" d="${path.toPathData(2)}" fill="${fill}"/>`
}

/**
 * The pictogram vocabulary, drawn in box `b` with color `fg` and stroke
 * width `sw`; `bg` is the page color (for cut-outs). `small` is the 16 px
 * drawing, which drops detail that cannot survive at that size.
 */
function pictogram(kind, b, fg, bg, sw, small) {
  const X = (u) => num(b.x + b.w * u)
  const Y = (u) => num(b.y + b.h * u)
  const stroke = (d, width = sw, color = fg) =>
    `<path d="${d}" stroke="${color}" stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"/>`
  const line = (x1, y1, x2, y2, width = sw) => stroke(`M${X(x1)} ${Y(y1)}L${X(x2)} ${Y(y2)}`, width)
  const rect = (x, y, w, h, r, fill = fg) =>
    `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(r)}" fill="${fill}"/>`
  switch (kind) {
    case 'paragraphs':
      // a heading over body text
      return (
        line(0.06, 0.16, 0.62, 0.16, sw * 1.25) +
        line(0.06, 0.5, 0.94, 0.5) +
        line(0.06, 0.84, 0.78, 0.84)
      )
    case 'lines':
      return (
        line(0.06, 0.2, 0.94, 0.2, sw * 0.8) +
        line(0.06, 0.5, 0.94, 0.5, sw * 0.8) +
        line(0.06, 0.8, 0.6, 0.8, sw * 0.8)
      )
    case 'cells': {
      // four cells
      const gap = small ? 16 : Math.max(sw * 0.5, 8)
      const r = small ? 6 : sw * 0.5
      const cw = (b.w - gap) / 2
      const ch = (b.h - gap) / 2
      let out = ''
      for (const i of [0, 1]) {
        for (const j of [0, 1]) out += rect(b.x + i * (cw + gap), b.y + j * (ch + gap), cw, ch, r)
      }
      return out
    }
    case 'slide':
      // a slide with a rising line; at 16 px a screen on a stand
      if (small) {
        return rect(X(0), Y(0.16), b.w, b.h * 0.6, sw * 0.6) + line(0.5, 0.76, 0.5, 0.94, sw * 0.9)
      }
      return (
        rect(X(0), Y(0.1), b.w, b.h * 0.8, sw * 0.9) +
        stroke(
          `M${X(0.26)} ${Y(0.66)}L${X(0.44)} ${Y(0.46)}L${X(0.58)} ${Y(0.56)}L${X(0.76)} ${Y(0.34)}`,
          sw * 0.7,
          bg,
        )
      )
    case 'stamp': {
      // a finished page: text lines and a stamp
      const radius = b.w * (small ? 0.2 : 0.17)
      return (
        line(0.06, 0.14, 0.94, 0.14) +
        line(0.06, 0.46, 0.7, 0.46) +
        (small ? '' : line(0.06, 0.78, 0.4, 0.78)) +
        `<circle cx="${num(X(1) - radius)}" cy="${num(Y(1) - radius)}" r="${num(radius)}" fill="${fg}"/>`
      )
    }
    case 'syllable':
      // a plain Hangul syllable, Korean text and nothing more; at 16 px the
      // outline turns to a blot, so its two letters are drawn as strokes there
      if (small) {
        return stroke(
          `M${X(0.06)} ${Y(0.16)}H${X(0.46)}Q${X(0.46)} ${Y(0.68)} ${X(0.08)} ${Y(0.92)}` +
            `M${X(0.78)} ${Y(0.04)}V${Y(0.96)}M${X(0.78)} ${Y(0.5)}H${X(0.98)}`,
          sw * 0.9,
        )
      }
      return fittedGlyph('가', { x: b.x, y: b.y - b.h * 0.04, w: b.w, h: b.h * 1.08 }, fg)
    case 'hash':
      return stroke(
        `M${X(0.4)} ${Y(0.04)}L${X(0.3)} ${Y(0.96)}M${X(0.76)} ${Y(0.04)}L${X(0.66)} ${Y(0.96)}` +
          `M${X(0.08)} ${Y(0.33)}H${X(0.96)}M${X(0.04)} ${Y(0.67)}H${X(0.92)}`,
      )
    case 'tag':
      return stroke(
        `M${X(0.3)} ${Y(0.2)}L${X(0.04)} ${Y(0.5)}L${X(0.3)} ${Y(0.8)}M${X(0.7)} ${Y(0.2)}L${X(0.96)} ${Y(0.5)}L${X(0.7)} ${Y(0.8)}` +
          (small ? '' : `M${X(0.58)} ${Y(0.12)}L${X(0.42)} ${Y(0.88)}`),
      )
    case 'braces': {
      const brace = (side) => {
        const bx = (u) => (side < 0 ? X(u) : X(1 - u))
        return (
          `M${bx(0.36)} ${Y(0.06)}C${bx(0.22)} ${Y(0.06)} ${bx(0.22)} ${Y(0.12)} ${bx(0.22)} ${Y(0.22)}V${Y(0.38)}` +
          `C${bx(0.22)} ${Y(0.45)} ${bx(0.16)} ${Y(0.5)} ${bx(0.06)} ${Y(0.5)}C${bx(0.16)} ${Y(0.5)} ${bx(0.22)} ${Y(0.55)} ${bx(0.22)} ${Y(0.62)}` +
          `V${Y(0.78)}C${bx(0.22)} ${Y(0.88)} ${bx(0.22)} ${Y(0.94)} ${bx(0.36)} ${Y(0.94)}`
        )
      }
      return stroke(brace(-1) + brace(1))
    }
    case 'nodes': {
      // three nodes: a root and two children
      const rootRadius = b.w * (small ? 0.2 : 0.17)
      const childRadius = b.w * (small ? 0.16 : 0.13)
      const [rx, ry] = [X(0.2), Y(0.5)]
      const children = [
        [X(0.8), Y(0.18)],
        [X(0.8), Y(0.82)],
      ]
      return (
        stroke(
          children
            .map(([x, y]) => `M${rx} ${ry}C${X(0.5)} ${ry} ${X(0.5)} ${y} ${x} ${y}`)
            .join(''),
          sw * 0.8,
        ) +
        `<circle cx="${rx}" cy="${ry}" r="${num(rootRadius)}" fill="${fg}"/>` +
        children
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${num(childRadius)}" fill="${fg}"/>`)
          .join('')
      )
    }
    case 'book': {
      // an open book: two pages bowed from the spine, with lines of text
      // cut out of them; at 16 px the pages alone
      const page = (side) => {
        const px = (u) => (side < 0 ? X(u) : X(1 - u))
        return (
          `<path d="M${px(0.02)} ${Y(0.2)}Q${px(0.25)} ${Y(0.06)} ${px(0.46)} ${Y(0.16)}` +
          `V${Y(0.94)}Q${px(0.25)} ${Y(0.84)} ${px(0.02)} ${Y(0.96)}Z" fill="${fg}"/>`
        )
      }
      const text = small
        ? ''
        : [0.42, 0.62]
            .map(
              (y) =>
                `M${X(0.12)} ${Y(y)}L${X(0.36)} ${Y(y - 0.04)}M${X(0.64)} ${Y(y - 0.04)}L${X(0.88)} ${Y(y)}`,
            )
            .join('')
      return page(-1) + page(1) + (text ? stroke(text, sw * 0.6, bg) : '')
    }
    case 'picture':
      // a picture: a hill and a sun cut out of a filled frame
      return (
        rect(X(0), Y(0.1), b.w, b.h * 0.8, sw * 0.9) +
        `<path d="M${X(0.12)} ${Y(0.78)}L${X(0.42)} ${Y(0.44)}L${X(0.62)} ${Y(0.64)}L${X(0.74)} ${Y(0.54)}L${X(0.88)} ${Y(0.78)}Z" fill="${bg}"/>` +
        (small
          ? ''
          : `<circle cx="${X(0.72)}" cy="${Y(0.3)}" r="${num(b.w * 0.08)}" fill="${bg}"/>`)
      )
    case 'play': {
      // a play mark cut out of a filled frame
      const t = Math.min(b.w, b.h) * 0.2
      const cx = X(0.53)
      const cy = Y(0.5)
      return (
        rect(X(0), Y(0.1), b.w, b.h * 0.8, sw * 0.9) +
        `<path d="M${num(cx - t * 0.8)} ${num(cy - t)}L${num(cx + t)} ${num(cy)}L${num(cx - t * 0.8)} ${num(cy + t)}Z" fill="${bg}" stroke="${bg}" stroke-width="${num(sw * 0.4)}" stroke-linejoin="round"/>`
      )
    }
    case 'wave': {
      // a sound wave: rounded bars
      const heights = small ? [0.5, 1, 0.6] : [0.4, 0.8, 1, 0.6, 0.34]
      const step = b.w / heights.length
      const bw = Math.min(step * 0.6, sw * 1.2)
      return heights
        .map((h, i) => {
          const bh = Math.max(bw, b.h * h * 0.9)
          return rect(X(0) + step * i + (step - bw) / 2, Y(0.5) - bh / 2, bw, bh, bw / 2)
        })
        .join('')
    }
    default:
      return ''
  }
}

/** The selected A artwork, shared by every OS and in-app rendering. */
function drawing(key, size) {
  const { color, picto } = FORMATS[key] ?? GENERIC[key]
  const stroke =
    'stroke="#FFFFFF" stroke-width="3.7" stroke-linecap="round" stroke-linejoin="round" fill="none"'
  const selected = {
    paragraphs: '<path d="M19 21h26M19 32h20M19 43h26" ' + stroke + '/>',
    cells:
      '<rect x="16" y="18" width="32" height="28" rx="3.5" ' +
      stroke +
      '/><path d="M27 19v26M38 19v26M17 32h30" ' +
      stroke +
      '/>',
    slide:
      '<rect x="15" y="16" width="34" height="25" rx="3.5" ' +
      stroke +
      '/><path d="M32 41v7M25 49h14M22 33v-5M32 33V23M42 33v-8" ' +
      stroke +
      '/>',
    latex:
      '<path d="M24 17h-2q-4 0-4 5v4q0 6-4 6 4 0 4 6v4q0 5 4 5h2M40 17h2q4 0 4 5v4q0 6 4 6-4 0-4 6v4q0 5-4 5h-2m-12-19 8 10m0-10-8 10" ' +
      stroke +
      '/>',
  }
  const glyph = selected[picto]
    ? '<g transform="scale(4)">' + selected[picto] + '</g>'
    : pictogram(
        picto,
        { x: 60, y: 64, w: 136, h: 128 },
        '#FFFFFF',
        color,
        size === 'small' ? 16 : 14.8,
        size === 'small',
      )
  return '<rect x="4" y="4" width="248" height="248" rx="64" fill="' + color + '"/>' + glyph
}

function svgFor(key) {
  return [
    '<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">',
    '<!-- generated by tools/gen-file-association-icons.mjs: edit the script, not this file -->',
    '<style>.s,.m{display:none}' +
      `@media (max-width:${SMALL_MAX_PX}px){.l{display:none}.s{display:inline}}` +
      `@media (min-width:${SMALL_MAX_PX + 0.01}px) and (max-width:${LARGE_MIN_PX - 0.02}px){.l{display:none}.m{display:inline}}</style>`,
    `<g class="l">${drawing(key, 'large')}</g>`,
    `<g class="m">${drawing(key, 'mid')}</g>`,
    `<g class="s">${drawing(key, 'small')}</g>`,
    '</svg>',
    '',
  ].join('\n')
}

// ── containers ──────────────────────────────────────────────────────────────

/** ICO container with PNG-compressed entries (supported since Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o) // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2) // palette
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

/**
 * ICNS run-length coding for one 8-bit channel: a control byte below 128
 * copies the next (n + 1) literal bytes, a control byte of 128 or more repeats
 * the next byte (n - 125) times (runs of 3..130).
 */
function packIcnsChannel(channel) {
  const out = []
  const runLength = (from) => {
    let n = 1
    while (from + n < channel.length && n < 130 && channel[from + n] === channel[from]) n++
    return n
  }
  let i = 0
  while (i < channel.length) {
    const run = runLength(i)
    if (run >= 3) {
      out.push(run + 125, channel[i])
      i += run
      continue
    }
    const start = i
    while (i < channel.length && i - start < 128 && runLength(i) < 3) i++
    out.push(i - start - 1, ...channel.subarray(start, i))
  }
  return Buffer.from(out)
}

/** `ARGB` ICNS payload from straight-alpha RGBA pixels (planar A, R, G, B). */
function buildIcnsArgb(rgba) {
  const pixels = rgba.length / 4
  const planes = [3, 0, 1, 2].map((channelOffset) => {
    const plane = Buffer.alloc(pixels)
    for (let p = 0; p < pixels; p++) plane[p] = rgba[p * 4 + channelOffset]
    return packIcnsChannel(plane)
  })
  return Buffer.concat([Buffer.from('ARGB', 'latin1'), ...planes])
}

function buildIcns(chunks) {
  const parts = chunks.map(({ type, data }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'latin1')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 4, 'latin1')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

// ── rasterizing ─────────────────────────────────────────────────────────────

/** Prefer an installed Chrome, then Edge, then a Playwright-managed Chromium. */
async function launchBrowser() {
  const failures = []
  for (const options of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try {
      return await chromium.launch({ ...options, headless: true })
    } catch (error) {
      failures.push(`${options.channel ?? 'bundled chromium'}: ${String(error).split('\n')[0]}`)
    }
  }
  throw new Error(`No Chromium-based browser could be launched:\n  ${failures.join('\n  ')}`)
}

const dataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

/**
 * Lays the SVG out as an <img> of contentSize CSS px, centered on a
 * transparent square of canvasSize CSS px, and screenshots it on a page whose
 * device scale factor sets the output resolution. Laying the image out at its
 * display size is what makes the SVG's media query pick the variant meant
 * for that size; the browser rasterizes the vector at the target resolution.
 * Returns the PNG and its straight-alpha RGBA pixels (for packed ICNS slots).
 */
async function rasterize(page, svg, canvasSize, contentSize) {
  await page.setViewportSize({ width: canvasSize, height: canvasSize })
  await page.setContent(
    `<body style="margin:0;background:transparent"><div style="width:${canvasSize}px;height:${canvasSize}px;display:flex;align-items:center;justify-content:center">` +
      `<img src="${dataUrl(svg)}" width="${contentSize}" height="${contentSize}"></div></body>`,
  )
  await page.locator('img').evaluate((img) => img.decode())
  const png = await page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: canvasSize, height: canvasSize },
  })
  return { png, rgba: PNG.sync.read(png).data }
}

// ── main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const previewFlag = args.indexOf('--preview')
const previewFile = previewFlag === -1 ? null : args[previewFlag + 1]
if (previewFlag !== -1 && !previewFile) throw new Error('--preview needs an output file path')
const writeRepo = !args.includes('--no-write')

function write(relativePath, data) {
  if (!writeRepo) return
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
  console.log(`wrote ${relativePath}`)
}

/** Contact sheet: every icon at the sizes the app and the OS draw it. */
async function writePreview(page, svgs, outFile) {
  const sizes = [16, 20, 24, 32, 48, 64, 96, 256]
  const row = (key, svg) =>
    `<div style="display:flex;align-items:flex-end;gap:14px;padding:8px 0"><div style="width:72px;font:12px sans-serif">${key}</div>` +
    sizes.map((s) => `<img src="${dataUrl(svg)}" width="${s}" height="${s}">`).join('') +
    '</div>'
  const block = (background, color) =>
    `<div style="background:${background};color:${color};padding:16px 24px">` +
    [...svgs].map(([key, svg]) => row(key, svg)).join('') +
    '</div>'
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.setContent(
    `<body style="margin:0;display:flex">${block('#f3f3f3', '#1f1f1f')}${block('#1e1e1e', '#e8e8e8')}</body>`,
  )
  writeFileSync(outFile, await page.screenshot({ fullPage: true }))
  console.log(`wrote preview ${outFile}`)
}

const svgs = new Map(
  [...Object.keys(FORMATS), ...Object.keys(GENERIC)].map((key) => [key, svgFor(key)]),
)

const browser = await launchBrowser()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  // retina copies: laid out at the display size, rendered at twice the pixels
  const page2x = await browser.newPage({ deviceScaleFactor: 2 })

  for (const key of Object.keys(FORMATS)) {
    const svg = svgs.get(key)
    write(`${SVG_DIR}/file-${key}.svg`, svg)

    const win = []
    for (const size of WIN_SIZES) {
      win.push({ size, png: (await rasterize(page, svg, size, size)).png })
    }
    write(`${BUILD_DIR}/${key}.ico`, buildIco(win))

    const mac = new Map()
    for (const size of new Set(ICNS_ENTRIES.map(([, size]) => size))) {
      mac.set(size, await rasterize(page, svg, size, Math.round(size * MAC_CONTENT_RATIO)))
    }
    write(
      `${BUILD_DIR}/${key}.icns`,
      buildIcns(
        ICNS_ENTRIES.map(([type, size, format]) => ({
          type,
          data: format === 'argb' ? buildIcnsArgb(mac.get(size).rgba) : mac.get(size).png,
        })),
      ),
    )

    if (MENU_TYPES.includes(key)) {
      write(`${MENU_DIR}/menu-${key}.png`, (await rasterize(page, svg, 16, 16)).png)
      write(`${MENU_DIR}/menu-${key}@2x.png`, (await rasterize(page2x, svg, 16, 16)).png)
    }
  }

  const attachments = new Map()
  for (const [name, key] of Object.entries(ATTACHMENT_ICONS)) {
    const { png } = await rasterize(page2x, svgs.get(key), ATTACHMENT_CSS_PX, ATTACHMENT_CSS_PX)
    attachments.set(name, png)
  }
  for (const [dir, names] of Object.entries(ATTACHMENT_DIRS)) {
    for (const name of names) write(`${dir}/${name}`, attachments.get(name))
  }

  if (previewFile) await writePreview(page, svgs, resolve(previewFile))
} finally {
  await browser.close()
}
