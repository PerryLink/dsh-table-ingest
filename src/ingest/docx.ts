/**
 * Extract the tables of a `.docx` from `word/document.xml`.
 *
 * This is the part `dsh-nsfc-form-check` never had: that package reads
 * `word/document.xml` only to flatten paragraphs into text, so every table becomes a
 * stream of lines with the cell boundaries gone. Here the table structure is kept.
 *
 * The XML shapes that matter, all under the `w` namespace:
 *
 *   w:tbl            a table
 *     w:tblPr        table properties (width, borders, style)
 *     w:tblGrid      the column grid, one w:gridCol per column (often no w attribute!)
 *     w:tr           a row
 *       w:trPr       row properties; may carry w:tblHeader (repeat as header row)
 *       w:tc         a cell
 *         w:tcPr     cell properties: w:gridSpan, w:vMerge, w:shd, w:vAlign
 *         w:p        paragraph(s) inside the cell
 *           w:r      run
 *             w:t    text
 *         w:tbl      a nested table
 *
 * Two things are easy to get wrong and both change the header:
 *
 *  - `w:gridSpan w:val="2"` makes the cell occupy two grid columns. A header row that
 *    uses gridSpan has *fewer* `w:tc` than the table has columns, so a naive row
 *    reader produces a header with fewer names than data columns.
 *  - `w:vMerge` marks vertical merge. `<w:vMerge/>` (no value) means "continue the
 *    cell above"; `<w:vMerge w:val="restart"/>` starts a merge. A continuation cell
 *    is usually empty in the XML — drop it and the 序号 of that row vanishes.
 */

import { childNamed, childrenNamed, findAll, parseXml, textContent } from './xml.ts'
import type { XmlElement } from './xml.ts'

export type VMerge = 'restart' | 'continue' | null

export interface DocxCell {
  /** 0-based row index inside its own table. */
  row: number
  /** 0-based starting grid column after span accounting. */
  gridCol: number
  colSpan: number
  vMerge: VMerge
  /** Text of the cell's own paragraphs, `\n`-joined. Excludes nested tables. */
  text: string
  paragraphs: string[]
  /** `w:shd/@w:fill` set to something other than auto/white. */
  shaded: boolean
  /** Every text-bearing run in the cell is bold. */
  bold: boolean
  /** Number of nested `w:tbl` found directly in this cell. */
  nestedTableCount: number
  /** The cell was empty in the XML but inherited its value from a vMerge above. */
  inherited: boolean
}

export interface DocxRow {
  index: number
  cells: DocxCell[]
  /** Cell text per grid column, length = table.cols, vMerge filled down. */
  grid: string[]
  /** `w:trPr/w:tblHeader` — Word would repeat this row on every page. */
  repeatHeader: boolean
  /** One cell spanning every column: a title row inside the table. */
  titleRow: boolean
}

export interface DocxTable {
  /** 0-based position among all top-level tables in the body. */
  index: number
  /** Stable identity: "0" for the first top-level table, "0.1" for its first nested table. */
  id: string
  depth: number
  rows: DocxRow[]
  cols: number
  /** Paragraph text immediately before the table (caption candidate). */
  before: string[]
  /** Paragraph text immediately after the table. */
  after: string[]
  /** Nested tables, with their parent cell coordinates. */
  nested: NestedTable[]
  warnings: string[]
}

export interface NestedTable {
  /** Where the nested table sits in its parent, 0-based. */
  parentRow: number
  parentCol: number
  table: Omit<DocxTable, 'nested'> & { nested: NestedTable[] }
}

/** Read the body element of a docx package's main part. */
export function readDocumentPart(entries: Map<string, Buffer>): XmlElement {
  const xml = entries.get('word/document.xml')
  if (xml === undefined) throw new Error('docx 包中缺少 word/document.xml，可能不是 Word 文档')
  const root = parseXml(xml.toString('utf8'))
  if (root.name !== 'document') throw new Error(`word/document.xml 根元素是 ${root.name}，不是 document`)
  const body = childNamed(root, 'body')
  if (body === undefined) throw new Error('word/document.xml 缺少 w:body')
  return body
}

/* ------------------------------------------------------------------ cell text -- */

/** True when the element is a revision artefact whose text is not part of the document. */
function isDeletedContext(element: XmlElement): boolean {
  return element.name === 'del' || element.name === 'moveFrom' || element.name === 'delText'
}

/** Text of one `w:p`, with run boundaries, tabs and breaks honoured. */
function paragraphText(paragraph: XmlElement): string {
  let out = ''
  const walk = (node: XmlElement): void => {
    if (isDeletedContext(node)) return
    if (node.name === 'instrText') return // field code, not display text
    if (node.name === 'txbxContent') return // text boxes are not the cell's own text
    if (node.name === 't') {
      out += textContent(node)
      return
    }
    if (node.name === 'tab') {
      out += '\t'
      return
    }
    if (node.name === 'br' || node.name === 'cr') {
      out += '\n'
      return
    }
    for (const child of node.children) if (child.kind === 'element') walk(child)
  }
  walk(paragraph)
  return out
}

function collapseCellText(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
}

/** Every run in the paragraph that carries text, and whether each is bold. */
function runBoldFlags(paragraph: XmlElement): boolean[] {
  const flags: boolean[] = []
  for (const run of findAll(paragraph, 'r')) {
    const text = childrenNamed(run, 't').map(textContent).join('')
    if (text.trim() === '') continue
    const rPr = childNamed(run, 'rPr')
    const bold = rPr !== undefined && childNamed(rPr, 'b') !== undefined
    const boldOff = rPr !== undefined && childNamed(rPr, 'b')?.attrs['val'] === '0'
    flags.push(bold && !boldOff)
  }
  return flags
}

function readCell(cell: XmlElement, row: number): DocxCell {
  const tcPr = childNamed(cell, 'tcPr')
  const spanRaw = tcPr === undefined ? undefined : childNamed(tcPr, 'gridSpan')?.attrs['val']
  const colSpan = spanRaw === undefined ? 1 : Math.max(1, Number.parseInt(spanRaw, 10) || 1)

  let vMerge: VMerge = null
  if (tcPr !== undefined) {
    const merge = childNamed(tcPr, 'vMerge')
    if (merge !== undefined) vMerge = merge.attrs['val'] === 'restart' ? 'restart' : 'continue'
  }

  const fill = tcPr === undefined ? undefined : childNamed(tcPr, 'shd')?.attrs['fill']
  const shaded = fill !== undefined && fill !== '' && fill.toLowerCase() !== 'auto' && fill.toLowerCase() !== 'ffffff'

  const paragraphs: string[] = []
  let nestedTableCount = 0
  const boldFlags: boolean[] = []
  for (const node of cell.children) {
    if (node.kind !== 'element') continue
    if (node.name === 'p') {
      const text = collapseCellText(paragraphText(node))
      if (text !== '') paragraphs.push(text)
      boldFlags.push(...runBoldFlags(node))
    } else if (node.name === 'tbl') {
      nestedTableCount += 1
    }
  }

  let text = paragraphs.join('\n')
  if (nestedTableCount > 0) text = text === '' ? '〔嵌套表〕' : `${text}\n〔嵌套表〕`
  const bold = boldFlags.length > 0 && boldFlags.every(Boolean)

  return {
    row,
    gridCol: 0, // filled in when the row is laid out on the grid
    colSpan,
    vMerge,
    text,
    paragraphs,
    shaded,
    bold,
    nestedTableCount,
    inherited: false,
  }
}

/* --------------------------------------------------------------- table layout -- */

function readRow(tr: XmlElement, rowIndex: number): { cells: DocxCell[]; repeatHeader: boolean } {
  const trPr = childNamed(tr, 'trPr')
  const repeatHeader = trPr !== undefined && childNamed(trPr, 'tblHeader') !== undefined
  const cells = childrenNamed(tr, 'tc').map((tc) => readCell(tc, rowIndex))
  return { cells, repeatHeader }
}

/**
 * Lay the cells of one table on its grid.
 *
 * The grid width comes from `w:tblGrid` when present, and is widened when a row
 * actually reaches further right (Word tolerates cells past the declared grid).
 */
function layOutTable(tbl: XmlElement): { rows: DocxRow[]; cols: number; warnings: string[] } {
  const warnings: string[] = []
  const grid = childNamed(tbl, 'tblGrid')
  const declared = grid === undefined ? 0 : childrenNamed(grid, 'gridCol').length
  const raw = childrenNamed(tbl, 'tr')

  const rows: DocxRow[] = []
  let cols = declared
  for (const [index, tr] of raw.entries()) {
    const { cells, repeatHeader } = readRow(tr, index)
    const gridRow: string[] = []
    let cursor = 0
    let ragged = false
    for (const cell of cells) {
      if (cell.gridCol === 0 && cursor > 0) cell.gridCol = cursor
      while (gridRow.length < cursor) gridRow.push('')
      gridRow[cursor] = cell.text
      for (let k = 1; k < cell.colSpan; k++) gridRow[cursor + k] = ''
      cursor += cell.colSpan
      if (cell.vMerge !== null) cell.inherited = cell.text === ''
    }
    if (declared > 0 && gridRow.length !== declared) ragged = true
    cols = Math.max(cols, gridRow.length)
    const only = cells[0]
    const titleRow = cells.length === 1 && only !== undefined && only.colSpan >= Math.max(cols, declared, 2)
    rows.push({ index, cells, grid: gridRow, repeatHeader, titleRow })
    if (ragged) warnings.push(`第 ${index + 1} 行的单元格跨度为 ${gridRow.length}，与表格声明的 ${declared} 列不符`)
  }

  for (const row of rows) while (row.grid.length < cols) row.grid.push('')

  // Fill vMerge continuations down from the cell above, so a merged 序号/日期 survives.
  for (let r = 1; r < rows.length; r++) {
    const current = rows[r]
    const above = rows[r - 1]
    if (current === undefined || above === undefined) continue
    for (const cell of current.cells) {
      if (cell.vMerge !== 'continue') continue
      const inherited = above.grid[cell.gridCol] ?? ''
      if (inherited === '') continue
      if (cell.text === '') {
        cell.text = inherited
        cell.inherited = true
        for (let k = 0; k < cell.colSpan; k++) current.grid[cell.gridCol + k] = k === 0 ? inherited : ''
      }
    }
  }

  return { rows, cols, warnings }
}

/* ------------------------------------------------------------------- document -- */

function plainText(paragraph: XmlElement): string {
  return collapseCellText(paragraphText(paragraph)).replace(/\n/g, ' ')
}

/** Nearest preceding paragraphs, skipping the empty ones Word leaves around tables. */
function contextBefore(blocks: XmlElement[], at: number, want = 2): string[] {
  const out: string[] = []
  for (let i = at - 1; i >= 0 && out.length < want; i--) {
    const block = blocks[i]
    if (block === undefined || block.name !== 'p') break
    const text = plainText(block)
    if (text !== '') out.unshift(text)
  }
  return out
}

function contextAfter(blocks: XmlElement[], at: number, want = 2): string[] {
  const out: string[] = []
  for (let i = at + 1; i < blocks.length && out.length < want; i++) {
    const block = blocks[i]
    if (block === undefined || block.name !== 'p') break
    const text = plainText(block)
    if (text !== '') out.push(text)
  }
  return out
}

function extractNested(tbl: XmlElement, depth: number, parentId: string): NestedTable[] {
  const out: NestedTable[] = []
  const rows = childrenNamed(tbl, 'tr')
  for (const [r, tr] of rows.entries()) {
    for (const [c, tc] of childrenNamed(tr, 'tc').entries()) {
      for (const inner of childrenNamed(tc, 'tbl')) {
        const table = extractTable(inner, depth + 1)
        table.id = `${parentId}.${out.length + 1}`
        table.nested = extractNested(inner, depth, table.id)
        out.push({ parentRow: r, parentCol: c, table })
      }
    }
  }
  return out
}

/** Extract one `w:tbl` element. */
export function extractTable(tbl: XmlElement, depth = 0): DocxTable {
  const { rows, cols, warnings } = layOutTable(tbl)
  return {
    index: 0,
    id: '0',
    depth,
    rows,
    cols,
    before: [],
    after: [],
    nested: [],
    warnings: cols === 0 ? [...warnings, '表格没有任何行'] : warnings,
  }
}

/**
 * Extract every top-level table in the document, in reading order.
 *
 * Top-level means "a direct child of `w:body`": tables inside table cells, headers,
 * footers and text boxes are not top-level and would otherwise be counted twice.
 */
export function extractDocumentTables(body: XmlElement): DocxTable[] {
  const blocks = body.children.filter((node): node is XmlElement => node.kind === 'element')
  const out: DocxTable[] = []
  for (const [i, block] of blocks.entries()) {
    if (block.name !== 'tbl') continue
    const table = extractTable(block, 0)
    table.index = out.length
    table.id = String(out.length)
    table.nested = extractNested(block, 0, table.id)
    table.before = contextBefore(blocks, i)
    table.after = contextAfter(blocks, i)
    out.push(table)
    if (table.nested.length > 0) {
      table.warnings.push(`该表含 ${table.nested.length} 张嵌套表（父格已标为〔嵌套表〕）`)
    }
  }
  return out
}

/** Flatten a nested table chain for reporting. */
export function flattenNested(table: DocxTable, into: DocxTable[] = []): DocxTable[] {
  for (const item of table.nested) {
    into.push(item.table as DocxTable)
    flattenNested(item.table as DocxTable, into)
  }
  return into
}

/** Rows whose cell spans do not add up to the table's grid width. */
export function raggedRows(table: DocxTable): number[] {
  return table.rows
    .filter((row) => {
      if (row.cells.length === 0) return false
      const total = row.cells.reduce((sum, cell) => sum + cell.colSpan, 0)
      return total !== table.cols
    })
    .map((row) => row.index)
}
