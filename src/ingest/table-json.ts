/**
 * Turn extracted docx tables into the table JSON the engine eats.
 *
 * `parseTable` (checkers/_shared/src/table.ts) accepts JSON text of the shape
 *
 *     { "header": { ... }, "rows": [ { "列名": "值", ... } ] }
 *
 * so the ingest layer's job is to produce exactly that, plus enough diagnostics for
 * the user to confirm the extraction before any rule runs.
 *
 * Everything here is a heuristic, and each one is named and counted so the design
 * discussion has real numbers instead of a vibe.
 */

import { raggedRows } from './docx.ts'
import type { DocxRow, DocxTable } from './docx.ts'

/* --------------------------------------------------------------------- types -- */

export type HeaderMode = 'auto' | number

export interface IngestHint {
  /** 0-based table index inside the document; `auto` scores the candidates. */
  tableIndex?: number | 'auto'
  /** Header row index inside the chosen table; `auto` scores the rows. */
  headerRow?: HeaderMode
  /** Force a second header row (two-level header: 技术分 / 技术方案). */
  headerRows?: 1 | 2
  /**
   * Column aliases the calling plugin understands. These double as the strongest
   * table-selection signal: the table whose header carries these words is almost
   * always the table the plugin wants.
   */
  expectedColumns?: readonly string[]
  /** Extra name aliases, canonical field -> source header text. */
  columnMap?: Record<string, string>
  /** Words in the caption above the table that identify the main table. */
  captionKeywords?: readonly string[]
  /** Emit a `列1..列N` header when no header row is detected. Default true. */
  syntheticHeader?: boolean
  /** What to do when no table is found. Default `error`. */
  fallback?: 'error' | 'text'
  /** Rows to include in the confirmation preview. Default 5. */
  previewRows?: number
  /** When the top two tables are within 20 points and no alias matched: ask or take the first. */
  ambiguous?: 'fail' | 'first'
  /** Join a table with the next one when both repeat the same header. Default true. */
  mergeAdjacent?: boolean
  /** Keep `w:trPr/w:tblHeader` continuation tables as separate candidates. */
  separatePageTables?: boolean
}

export interface TableJson {
  target: string
  tableIndex: number
  /** Header row indices used (1 or 2 entries). */
  headerRows: number[]
  /** Column names, in grid order, after phantom columns are dropped. */
  columns: string[]
  /** Scalars found outside the table (report number, project name). */
  header: Record<string, string>
  rows: Record<string, string>[]
  warnings: string[]
  /** Cells that were empty in the XML and filled from a vMerge above. */
  mergedCells: number
  /** Group-label rows dropped from the data, kept so the UI can show them. */
  sections: SectionRow[]
  /** True when some row's cell spans did not add up to the grid width. */
  ragged: boolean
}

export interface SectionRow {
  /** The dropped row's position among the kept data rows (1-based). */
  beforeRow: number
  name: string
}

export interface Candidate {
  /** Stable identity, e.g. "0" or "0.1" for a nested table. */
  tableId: string
  tableIndex: number
  score: number
  rows: number
  cols: number
  headerRow: number | null
  caption: string
  reasons: string[]
  /** How many of `hint.expectedColumns` the header matched. */
  aliasHits: number
  /** Set when the table sits inside another table's cell. */
  parentTable?: number
  /** Tables merged into this one because they continue its header. */
  mergedFrom?: number[]
}

export interface HeaderChoice {
  index: number
  /** 1 or 2: a two-level header consumes two rows. */
  rows: number
  score: number
  synthetic: boolean
  reasons: string[]
}

export interface IngestResult {
  ok: boolean
  table?: TableJson
  candidates: Candidate[]
  header: HeaderChoice | null
  /** Markdown table for "I extracted this, is it right?" confirmation. */
  preview: string
  confidence: 'high' | 'medium' | 'low'
  warnings: string[]
  error?: string
  /** Paragraph text, when the source had no usable table. */
  textFallback?: string[]
}

/* ------------------------------------------------------- heuristic primitives -- */

/** Header vocabulary. Presence of these words is itself evidence of a header row. */
const HEADER_LEXICON: readonly string[] = [
  '序号', '编号', '项目', '名称', '内容', '单位', '数量', '金额', '单价', '合价', '合计',
  '日期', '时间', '备注', '说明', '标准', '分值', '得分', '评分', '评分标准', '结果',
  '类别', '类型', '规格', '型号', '部位', '工序', '责任人', '负责人', '签字', '状态',
  '检查项', '检查内容', '问题', '整改', '依据', '条款', '页码', '数量', '比例', '占比',
  'no', 'no.', 'item', 'name', 'date', 'amount', 'qty', 'unit', 'price', 'remark',
]

/** Rows that look like a caption or an explanatory note rather than a header. */
const CAPTION_PATTERNS: readonly RegExp[] = [
  /^表\s*[0-9一二三四五六七八九十]+/,
  /^(附表|续表|表|表一|表二)/,
  /^(注|说明|备注)[：:]/,
  /^(单位|金额单位)[：:]/,
  /^\d+(\.\d+)*\s/,
]

const NUMERIC_CELL = /^[-+]?[\d,]+(\.\d+)?%?$/
/** Looser: a cell that is mostly digits and separators, e.g. "0 / 10 / 0" or "28 / 3". */
const NUMERIC_ISH = /^[\d\s.,/:;%+\-()（）]+$/
function numericish(cell: string): boolean {
  const text = cell.trim()
  return text !== '' && /\d/.test(text) && NUMERIC_ISH.test(text)
}
const PROSE_END = /[。；;]$/

export function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[\s\u3000_-]/g, '')
}

function isBlank(text: string): boolean {
  return text.trim() === ''
}

function nonEmpty(row: DocxRow): string[] {
  return row.grid.filter((cell) => !isBlank(cell))
}

function cellLength(cell: string): number {
  return [...cell.replace(/\s/g, '')].length
}

function rowShaded(row: DocxRow): boolean {
  const cells = row.cells.filter((cell) => !isBlank(cell.text))
  return cells.length > 0 && cells.every((cell) => cell.shaded)
}

function rowBold(row: DocxRow): boolean {
  const cells = row.cells.filter((cell) => !isBlank(cell.text))
  return cells.length > 0 && cells.every((cell) => cell.bold)
}

function isCaptionText(text: string): boolean {
  return CAPTION_PATTERNS.some((pattern) => pattern.test(text.trim()))
}

/** True when the row looks like data: it carries a number or a long sentence. */
function looksLikeData(row: DocxRow): boolean {
  const cells = nonEmpty(row)
  if (cells.length === 0) return false
  const numeric = cells.filter((cell) => NUMERIC_CELL.test(cell.trim())).length
  const long = cells.filter((cell) => cellLength(cell) > 30).length
  return numeric > 0 || long > 0
}

/* ------------------------------------------------------------ header scoring -- */

interface ScoreDetail {
  score: number
  reasons: string[]
}

/**
 * Score one row as a header candidate.
 *
 * The weights are ordered by how much the signal is worth in practice: Word's own
 * repeat-header flag beats styling, styling beats text shape, text shape beats
 * position. A negative score disqualifies the row outright.
 */
function scoreHeaderRow(table: DocxTable, index: number): ScoreDetail {
  const row = table.rows[index]
  const reasons: string[] = []
  if (row === undefined) return { score: -1000, reasons: ['行不存在'] }
  if (row.titleRow) return { score: -1000, reasons: ['整行合并为标题行'] }
  const cells = nonEmpty(row)
  if (cells.length < 2) return { score: -1000, reasons: ['有效单元格少于 2 个'] }

  let score = 0
  const push = (points: number, why: string): void => {
    score += points
    reasons.push(`${points > 0 ? '+' : ''}${points} ${why}`)
  }

  if (row.repeatHeader) push(40, 'w:tblHeader（Word 标记为重复标题行）')
  if (rowShaded(row)) push(25, '整行有底纹')
  if (rowBold(row)) push(15, '整行加粗')
  if (cells.every((cell) => cellLength(cell) <= 20)) push(10, '每格文字不超过 20 字')
  if (!cells.some((cell) => NUMERIC_CELL.test(cell.trim()))) push(10, '没有纯数字单元格')
  if (cells.length === row.grid.filter((cell) => cell !== '').length) push(5, '没有空格')

  const lexiconHits = cells.filter((cell) =>
    HEADER_LEXICON.some((word) => normaliseName(cell).includes(normaliseName(word))),
  ).length
  if (lexiconHits > 0) push(Math.min(15 * lexiconHits, 45), `${lexiconHits} 个单元格命中表头词表`)

  const below = table.rows[index + 1]
  if (below !== undefined && looksLikeData(below)) push(20, '下一行像数据行')
  if (below !== undefined && nonEmpty(below).length >= cells.length) push(5, '下一行单元格数不少于本行')

  if (cells.some((cell) => PROSE_END.test(cell))) push(-30, '单元格以句号/分号结尾，像正文')
  if (cells.some((cell) => cellLength(cell) > 40)) push(-25, '单元格超过 40 字，像正文')
  if (cells.filter((cell) => isCaptionText(cell)).length >= Math.ceil(cells.length / 2)) {
    push(-60, '整行像题注或说明')
  }

  // A key-value grid (差异合计 | 10 | 错误/提示/参考 | 0/10/0) has no header: every
  // row is label/value pairs. The tell is that a column holds a number in this row
  // *and* in the rows below it, which a real header column never does.
  if (isKeyValueGrid(table, index)) {
    reasons.push('与下方数据行在同一列都出现数字，判定为无表头的键值表')
    return { score: Math.min(score, 20), reasons }
  }

  return { score, reasons }
}

/** True when this row's numeric columns stay numeric in every row below. */
function isKeyValueGrid(table: DocxTable, index: number): boolean {
  const head = table.rows[index]
  const below = table.rows.slice(index + 1).filter((row) => nonEmpty(row).length > 0)
  if (head === undefined || below.length < 2) return false
  for (let col = 0; col < head.grid.length; col++) {
    if (!numericish(head.grid[col] ?? '')) continue
    const kept = below.filter((row) => (row.grid[col] ?? '').trim() !== '')
    if (kept.length < below.length) continue
    if (kept.every((row) => numericish(row.grid[col] ?? ''))) return true
  }
  return false
}

/** Pick the header row(s) of one table. */
export function detectHeader(table: DocxTable, hint: IngestHint): HeaderChoice {
  const forced = hint.headerRow
  if (typeof forced === 'number') {
    const twoLevel = hint.headerRows === 2 && forced + 1 < table.rows.length
    return {
      index: forced,
      rows: twoLevel ? 2 : 1,
      score: 1000,
      synthetic: false,
      reasons: ['用户指定表头行'],
    }
  }

  let best: HeaderChoice | null = null
  const limit = Math.min(6, table.rows.length)
  for (let index = 0; index < limit; index++) {
    const { score, reasons } = scoreHeaderRow(table, index)
    if (best === null || score > best.score) {
      best = { index, rows: 1, score, synthetic: false, reasons }
    }
  }

  const twoLevel = best !== null && hint.headerRows === 2 && best.index + 1 < table.rows.length
  if (best !== null && best.score >= 40) {
    if (twoLevel) {
      const child = table.rows[best.index + 1]
      const plausible = child !== undefined && nonEmpty(child).length >= 2 && !looksLikeData(child)
      if (plausible) {
        best.rows = 2
        best.reasons.push('下一行没有数字且不少于 2 格，按两级表头合并')
      }
    }
    return best
  }

  // No row looks like a header. Name the columns by position and say so.
  const firstData = table.rows.findIndex((row) => !row.titleRow && nonEmpty(row).length > 0)
  const index = firstData < 0 ? 0 : firstData
  return {
    index,
    rows: 0,
    score: best?.score ?? -1000,
    synthetic: true,
    reasons: [`最高分 ${best?.score ?? -1000} 未达 40 分阈值，按无表头处理`],
  }
}

/* --------------------------------------------------------- column name build -- */

/** Join the two levels of a two-level header cell. */
function joinHeader(parent: string, child: string): string {
  const a = parent.trim().replace(/\n/g, ' ')
  const b = child.trim().replace(/\n/g, ' ')
  if (a === '' && b === '') return ''
  if (a === '' || a === b) return b === '' ? a : b
  if (b === '') return a
  return `${a}/${b}`
}

function headerNames(table: DocxTable, choice: HeaderChoice, cols: number): string[] {
  const names: string[] = []
  const parentRow = table.rows[choice.index]
  const childRow = choice.rows === 2 ? table.rows[choice.index + 1] : undefined
  for (let col = 0; col < cols; col++) {
    const parent = parentRow?.grid[col] ?? ''
    const child = childRow?.grid[col] ?? ''
    names.push(choice.rows === 2 ? joinHeader(parent, child) : parent.trim().replace(/\n/g, ' '))
  }
  return names
}

/** Label of the spanning cell above column `col`, when there is one. */
function parentLabel(table: DocxTable, choice: HeaderChoice, col: number): string {
  for (let index = choice.index - 1; index >= 0; index--) {
    const row = table.rows[index]
    if (row === undefined) break
    for (const cell of row.cells) {
      if (cell.gridCol <= col && col < cell.gridCol + cell.colSpan && cell.colSpan > 1 && cell.text.trim() !== '') {
        return cell.text.trim().replace(/\n/g, ' ')
      }
    }
  }
  return ''
}

/** Make duplicate and empty names unique and non-empty. */
function settleNames(raw: string[], synthetic: boolean, warnings: string[], labelOf?: (col: number) => string): string[] {
  // A duplicate leaf name (上半年 / 下半年 under 2025 年 and 2026 年) is meaningless
  // once numbered, so borrow the spanning parent label for the duplicated columns.
  const counts = new Map<string, number>()
  for (const name of raw) counts.set(name.trim(), (counts.get(name.trim()) ?? 0) + 1)
  const resolved = raw.map((name, index) => {
    const base = name.trim()
    if (base === '' || (counts.get(base) ?? 0) < 2 || labelOf === undefined) return name
    const parent = labelOf(index)
    if (parent === '' || parent === base) return name
    warnings.push(`表头「${base}」重复，第 ${index + 1} 列改用上级表头「${parent}/${base}」`)
    return `${parent}/${base}`
  })

  const seen = new Map<string, number>()
  return resolved.map((name, index) => {
    let base = name.trim()
    if (base === '') {
      base = synthetic ? `列${index + 1}` : `未命名列${index + 1}`
      warnings.push(`第 ${index + 1} 列表头为空，暂命名为「${base}」`)
    }
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    if (count === 0) return base
    const unique = `${base}(${count + 1})`
    warnings.push(`表头「${base}」重复，第 ${index + 1} 列改名为「${unique}」`)
    return unique
  })
}

/* -------------------------------------------------------------- table assembly -- */

/** Drop grid columns that are empty in every row — the phantom half of a merge. */
function dropPhantomColumns(
  gridRows: string[][],
  columns: string[],
  warnings: string[],
): { gridRows: string[][]; columns: string[] } {
  const width = columns.length
  const keep: number[] = []
  for (let col = 0; col < width; col++) {
    const used = gridRows.some((row) => !isBlank(row[col] ?? ''))
    if (used) keep.push(col)
  }
  if (keep.length === width) return { gridRows, columns }
  const dropped = width - keep.length
  if (dropped > 0) warnings.push(`有 ${dropped} 个网格列在所有行中都为空（合并单元格的占位列），已删除`)
  return {
    gridRows: gridRows.map((row) => keep.map((col) => row[col] ?? '')),
    columns: keep.map((col) => columns[col] ?? ''),
  }
}

function isBlankRow(row: DocxRow): boolean {
  return row.grid.every((cell) => isBlank(cell))
}

/**
 * Build the table JSON for one docx table.
 *
 * @param table - extracted table.
 * @param hint - caller's hints.
 * @param target - description of the source for the report.
 */
export function tableToJson(table: DocxTable, hint: IngestHint, target: string): TableJson {
  const warnings: string[] = [...table.warnings]
  const choice = detectHeader(table, hint)
  const cols = table.cols

  const names = settleNames(
    headerNames(table, choice, cols),
    choice.synthetic || hint.syntheticHeader !== false,
    warnings,
    (col) => parentLabel(table, choice, col),
  )
  const firstData = choice.index + choice.rows
  const dataRows: DocxRow[] = []
  const sections: SectionRow[] = []
  for (let index = firstData; index < table.rows.length; index++) {
    const row = table.rows[index]
    if (row === undefined) continue
    if (isBlankRow(row)) {
      warnings.push(`第 ${index + 1} 行整行为空，已跳过`)
      continue
    }
    if (row.titleRow) {
      // After the header, a full-width merged row is a group label ("服务部分"),
      // not a table title: keeping it as a data row gives it blank 分值/标准 cells
      // and every per-row rule fires on it.
      const name = row.grid.find((cell) => !isBlank(cell)) ?? ''
      sections.push({ beforeRow: dataRows.length + 1, name })
      warnings.push(`第 ${index + 1} 行是整行合并的分组行「${name}」，已跳过（未作为数据行）`)
      continue
    }
    dataRows.push(row)
  }

  const merged = table.rows.flatMap((row) => row.cells.filter((cell) => cell.inherited && cell.text !== '')).length
  if (merged > 0) warnings.push(`${merged} 个单元格为空，已从上方合并单元格补值`)

  const uneven = raggedRows(table)
  const ragged = uneven.length > 0
  if (ragged) {
    warnings.push(
      `第 ${uneven.map((index) => index + 1).join('、')} 行的单元格跨度与表宽 ${table.cols} 列不一致，` +
        '该行之后的列可能整体错位；需人工确认或指定列修复方式',
    )
  }

  const gridRows = dataRows.map((row) => row.grid.map((cell) => cell.trim()))
  const columns = [...names]
  const dropped = dropPhantomColumns(gridRows, columns, warnings)

  const rows = dropped.gridRows.map((values) => {
    const record: Record<string, string> = {}
    dropped.columns.forEach((name, index) => {
      record[name] = values[index] ?? ''
    })
    return record
  })

  return {
    target,
    tableIndex: table.index,
    headerRows: choice.rows === 0 ? [] : Array.from({ length: choice.rows }, (_v, i) => choice.index + i + 1),
    columns: dropped.columns,
    header: {},
    rows,
    warnings,
    mergedCells: merged,
    sections,
    ragged,
  }
}

/* ------------------------------------------------------------ table selection -- */

function tableCaption(table: DocxTable): string {
  const before = table.before[table.before.length - 1] ?? ''
  if (before !== '') return before
  return table.after[0] ?? ''
}

/**
 * Score a table as "the one the caller wants".
 *
 * Alias hits dominate: when the plugin expects 评分标准/分值, the table whose header
 * literally contains those words is the table, regardless of position or size.
 */
export function scoreTable(
  table: DocxTable,
  hint: IngestHint,
  choice: HeaderChoice,
  parentTable?: number,
): { detail: ScoreDetail; aliasHits: number } {
  const reasons: string[] = []
  let score = 0
  const push = (points: number, why: string): void => {
    score += points
    reasons.push(`${points > 0 ? '+' : ''}${points} ${why}`)
  }

  const headerRow = table.rows[choice.index]
  const headerCells = headerRow === undefined ? [] : nonEmpty(headerRow)
  const headerKeys = new Set(headerCells.map(normaliseName))
  const aliases = hint.expectedColumns ?? []
  let aliasHits = 0
  for (const alias of aliases) {
    const wanted = normaliseName(alias)
    if ([...headerKeys].some((key) => key === wanted || key.includes(wanted) || wanted.includes(key))) aliasHits += 1
  }
  if (aliasHits > 0) push(120 * aliasHits, `表头命中 ${aliasHits} 个期望列名`)
  else if (aliases.length > 0) push(-40, '表头未命中任何期望列名')

  const dataRows = Math.max(0, table.rows.length - choice.index - choice.rows)
  if (dataRows === 0) return { detail: { score: -1000, reasons: ['没有数据行'] }, aliasHits }
  push(Math.min(dataRows, 30), `${dataRows} 个数据行`)
  push(Math.min(table.cols, 8) * 2, `${table.cols} 列`)

  if (choice.synthetic) push(-25, '未识别出表头')
  const singleCell = table.rows.filter((row) => row.cells.length <= 1).length
  if (singleCell / Math.max(table.rows.length, 1) > 0.5) push(-80, '多数行只有 1 个单元格，像排版用表格')
  if (dataRows <= 1 && table.cols <= 2) push(-50, '过小，像排版占位表')
  if (parentTable !== undefined) push(-15, `位于第 ${parentTable + 1} 张表的单元格内`)

  const caption = tableCaption(table)
  const keywords = hint.captionKeywords ?? []
  if (caption !== '' && keywords.some((word) => caption.includes(word))) {
    push(40, `上方文字命中标题关键词「${caption.slice(0, 20)}」`)
  }
  const joined = [...table.rows.slice(0, 3).flatMap((row) => row.grid), caption].join(' ')
  if (/目录|\.{5,}/.test(joined)) push(-60, '内容像目录')

  return { detail: { score, reasons }, aliasHits }
}

export interface RankOptions {
  /** Nested tables, with the top-level table they live in. */
  nested?: { parentTable: number; table: DocxTable }[]
  /** Table index -> the top-level tables merged into it. */
  mergedInto?: Map<number, number[]>
}

/** Rank every table in the document, nested tables included. */
export function rankTables(tables: DocxTable[], hint: IngestHint, options: RankOptions = {}): Candidate[] {
  const entries: { table: DocxTable; parentTable?: number }[] = tables.map((table) => ({ table }))
  for (const item of options.nested ?? []) entries.push({ table: item.table, parentTable: item.parentTable })

  return entries
    .map(({ table, parentTable }) => {
      const choice = detectHeader(table, hint)
      const { detail, aliasHits } = scoreTable(table, hint, choice, parentTable)
      return {
        tableId: table.id,
        tableIndex: table.index,
        score: detail.score,
        rows: table.rows.length,
        cols: table.cols,
        headerRow: choice.synthetic ? null : choice.index + 1,
        caption: tableCaption(table).slice(0, 40),
        reasons: detail.reasons,
        aliasHits,
        ...(parentTable === undefined ? {} : { parentTable }),
        ...(options.mergedInto?.has(table.index) ? { mergedFrom: options.mergedInto.get(table.index) } : {}),
      }
    })
    .sort((a, b) => b.score - a.score)
}

/* ----------------------------------------------------------------- rendering -- */

/** Markdown preview, so the user can confirm the extraction before rules run. */
export function renderPreview(table: TableJson, limit = 5): string {
  const head = `| ${table.columns.map(escapeCell).join(' | ')} |`
  const rule = `| ${table.columns.map(() => '---').join(' | ')} |`
  const body = table.rows
    .slice(0, limit)
    .map((row) => `| ${table.columns.map((name) => escapeCell(row[name] ?? '')).join(' | ')} |`)
  const more = table.rows.length > limit ? `\n\n… 另有 ${table.rows.length - limit} 行未显示` : ''
  return [head, rule, ...body].join('\n') + more
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '⏎')
}

/** Confidence for the confirmation UI. */
export function confidenceOf(
  choice: HeaderChoice,
  candidate: Candidate | undefined,
  ragged = false,
): 'high' | 'medium' | 'low' {
  if (choice.synthetic || ragged) return 'low'
  if (candidate === undefined) return 'low'
  if (candidate.aliasHits > 0 && choice.score >= 60) return 'high'
  if (candidate.aliasHits > 0 || choice.score >= 60) return 'medium'
  return 'low'
}
