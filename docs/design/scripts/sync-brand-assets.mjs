import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const geometry = JSON.parse(readFileSync(join(root, 'brand/logo-geometry.json'), 'utf8'))
const css = readFileSync(join(root, 'exports/src/styles/variables.css'), 'utf8')
const light = css.slice(0, css.indexOf('[data-theme="dark"]'))
const token = (name) => {
  const value = light.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i'))?.[1]
  if (!value) throw new Error(`Missing solid-color source token: ${name}`)
  return value.toUpperCase()
}
const palette = {
  white: token('--yj-color-bg-card'),
  graphite: token('--yj-color-text-primary'),
  lime: token('--yj-color-brand-primary'),
}

function mark(body, flap) {
  return [
    ...geometry.mark_body_paths.map((d) => `  <path d="${d}" fill="${body}"/>`),
    `  <path d="${geometry.mark_flap_path}" fill="${flap}"/>`,
  ].join('\n')
}

function svg(name, box, label, content) {
  const id = name.replace(/\.svg$/, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box[2]}" height="${box[3]}" viewBox="${box.join(' ')}" fill="none" role="img" aria-labelledby="${id}-title ${id}-desc">
  <title id="${id}-title">${label}</title>
  <desc id="${id}-desc">易界商品包裹折面与 YJ 负形标志。纯矢量轮廓，无位图和字体依赖。</desc>
  <!-- Generated from brand/logo-geometry.json and exports/src/styles/variables.css. -->
${content}
</svg>
`
}

function horizontal(body, flap) {
  return `${mark(body, flap)}
  <g transform="${geometry.wordmark_transform}" fill="${body}" fill-rule="evenodd">
    <path d="${geometry.wordmark_paths.join(' ')}"/>
  </g>`
}

const icon = geometry.app_icon
const rect = icon.background
const specs = [
  ['yijie-mark.svg', geometry.mark_view_box, '易界 Logo · 亮底', mark(palette.graphite, palette.lime)],
  ['yijie-mark-dark.svg', geometry.mark_view_box, '易界 Logo · 暗底', mark(palette.white, palette.lime)],
  ['yijie-mark-mono.svg', geometry.mark_view_box, '易界 Logo · 石墨单色', mark(palette.graphite, palette.graphite)],
  ['yijie-mark-mono-inverse.svg', geometry.mark_view_box, '易界 Logo · 白色单色', mark(palette.white, palette.white)],
  ['yijie-horizontal.svg', geometry.horizontal_view_box, '易界 YIJIE 横版 Logo · 亮底', horizontal(palette.graphite, palette.lime)],
  ['yijie-horizontal-dark.svg', geometry.horizontal_view_box, '易界 YIJIE 横版 Logo · 暗底', horizontal(palette.white, palette.lime)],
  ['yijie-app-icon.svg', icon.view_box, '易界 App Icon', `  <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${rect.rx}" fill="${palette.graphite}"/>
  <g transform="${icon.mark_transform}">
${mark(palette.white, palette.lime)}
  </g>`],
]
const outputs = new Map(specs.map(([name, box, label, content]) => [name, svg(name, box, label, content)]))
// The legacy filename stays byte-identical to the canonical mark for existing consumers.
outputs.set('yijie-bag-logo.svg', outputs.get('yijie-mark.svg'))
const check = process.argv.includes('--check')
const errors = []
for (const folder of ['docs/public/brand', 'exports/src/assets/brand']) {
  if (!check) mkdirSync(join(root, folder), { recursive: true })
  for (const [name, expected] of outputs) {
    const path = join(root, folder, name)
    if (check) {
      let actual
      try { actual = readFileSync(path, 'utf8') } catch { actual = null }
      if (actual !== expected) errors.push(`${folder}/${name}`)
    } else {
      writeFileSync(path, expected)
    }
  }
}
if (errors.length) {
  throw new Error(`Brand assets differ from their vector/color source:\n${errors.join('\n')}`)
}
console.log(`${check ? 'Verified' : 'Generated'} ${outputs.size * 2} SVG assets from one vector source.`)
