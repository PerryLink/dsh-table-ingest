/**
 * Minimal xlsx / xlsm reader.
 *
 * Scope: read the first visible worksheet (or a named/indexed one) into a grid of
 * strings, resolving the four things that make a naive reader silently wrong:
 *
 *  1. A shared string cell carries an *index* in `<v>`, not the string.
 *  2. An inline string keeps its text in `<is>`, so reading `<v>` yields `''`.
 *  3. A date is a number plus three levels of indirection: `c@style` → `cellXfs`
 *     → `numFmtId`; ids ≥ 164 live in `<numFmts>`.
 *  4. Sheet order comes from `workbook.xml` plus `_rels`, so `sheet1.xml` is not
 *     necessarily the first sheet.
 *
 * Formula cells contribute their cached `<v>`; nothing is recalculated, because a
 * rule that says "the total must equal the sum of the rows" has to see the number
 * the user's file actually contains.
 */

import { zipMap } from './zip.ts'
import { childrenNamed, findAll, parseXml, type XmlElement } from './xml.ts'

/** One worksheet reduced to text. */
export interface SheetGrid {
  /** Sheet name as shown in Excel. */
  name: string
  /** Package path of the worksheet part, e.g. `xl/worksheets/sheet1.xml`. */
  part: string
  /** Row-major grid of cell text; trailing empty cells are trimmed per row. */
  grid: string[][]
  /** True when the sheet tab is hidden. */
  hidden: boolean
  /** Warnings collected while reading this sheet. */
  warnings: string[]
}

/** Everything read out of one workbook. */
export interface Workbook {
  sheets: SheetGrid[]
  /** `true` when the file declares the 1904 date system (older Mac files). */
  date1904: boolean
  warnings: string[]
}

/** Raised when a workbook cannot be read at all. */
export class XlsxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxError'
  }
}

/**
 * Split a spreadsheet cell reference into zero-based row and column indices.
 *
 * @param reference - e.g. `B7`.
 * @returns `{ row: 6, col: 1 }`; both are 0 when the reference is unparseable.
 */
export function cellRef(reference: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/u.exec(reference.trim().toUpperCase())
  if (match === null) return { row: 0, col: 0 }
  const letters = match[1] ?? ''
  const digits = match[2] ?? '0'
  let col = 0
  for (const character of letters) col = col * 26 + (character.charCodeAt(0) - 64)
  return { row: Number.parseInt(digits, 10) - 1, col: col - 1 }
}

/** Text of every `<t>` under a node, concatenating rich-text runs. */
function textOf(node: XmlElement): string {
  return findAll(node, 't')
    .map((t) => t.children.map((child) => (child.kind === 'text' ? child.text : '')).join(''))
    .join('')
}

/** The shared string table, in index order. */
function readSharedStrings(entries: Map<string, Buffer>): string[] {
  const raw = entries.get('xl/sharedStrings.xml')
  if (raw === undefined) return []
  const root = parseXml(raw.toString('utf8'))
  return childrenNamed(root, 'si').map((si) => textOf(si))
}

/** Map from style index to number-format id, plus the custom format codes. */
function readStyles(entries: Map<string, Buffer>): {
  styleFormats: number[]
  customFormats: Map<number, string>
} {
  const raw = entries.get('xl/styles.xml')
  if (raw === undefined) return { styleFormats: [], customFormats: new Map() }
  const root = parseXml(raw.toString('utf8'))
  const customFormats = new Map<number, string>()
  for (const format of findAll(root, 'numFmt')) {
    const id = Number.parseInt(format.attrs.numFmtId ?? '', 10)
    if (Number.isFinite(id)) customFormats.set(id, format.attrs.formatCode ?? '')
  }
  const cellXfs = childrenNamed(root, 'cellXfs')[0]
  const styleFormats = cellXfs === undefined
    ? []
    : childrenNamed(cellXfs, 'xf').map((xf) => Number.parseInt(xf.attrs.numFmtId ?? '0', 10))
  return { styleFormats, customFormats }
}

/** Built-in number-format ids that mean "this number is a date". */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57])

/**
 * Whether a number format renders a date.
 *
 * Quoted literals must be removed first: a unit suffix such as `0"月"` contains
 * `月`, not a date token, and treating it as a date turns `12` into 1900-01-12.
 *
 * @param code - the format code, e.g. `yyyy-mm-dd`.
 * @returns true when the format carries a date or time token.
 */
export function isDateFormat(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/gu, '').replace(/\[[^\]]*\]/gu, '')
  return /[ymdhs]/iu.test(stripped) && !/^[#0.,%\s]*$/u.test(stripped)
}

/**
 * Convert an Excel serial number to an ISO date.
 *
 * @param serial - days since the workbook epoch.
 * @param date1904 - whether the workbook uses the 1904 date system.
 * @returns `YYYY-MM-DD`, or `''` when the serial is not a usable date.
 */
export function serialToDate(serial: number, date1904: boolean): string {
  // Excel's 1900 system counts from 1899-12-30 to absorb its own leap-year bug.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  if (!Number.isFinite(serial) || serial <= 0) return ''
  const ms = epoch + Math.round(serial * 86_400_000)
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/** Resolve the sheet list and their relationship targets. */
function readSheetList(entries: Map<string, Buffer>): {
  sheets: { name: string; part: string; hidden: boolean }[]
  date1904: boolean
} {
  const workbookRaw = entries.get('xl/workbook.xml')
  if (workbookRaw === undefined) throw new XlsxError('xlsx 包中缺少 xl/workbook.xml，可能不是 Excel 文件')
  const workbook = parseXml(workbookRaw.toString('utf8'))
  const bookPr = findAll(workbook, 'workbookPr')[0]
  const date1904 = (bookPr?.attrs.date1904 ?? '0') === '1' || bookPr?.attrs.date1904 === 'true'

  const relsRaw = entries.get('xl/_rels/workbook.xml.rels')
  const targets = new Map<string, string>()
  if (relsRaw !== undefined) {
    for (const rel of childrenNamed(parseXml(relsRaw.toString('utf8')), 'Relationship')) {
      const id = rel.attrs.Id ?? ''
      const target = rel.attrs.Target ?? ''
      if (id !== '' && target !== '') {
        targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//u, '')}`)
      }
    }
  }

  const sheets: { name: string; part: string; hidden: boolean }[] = []
  for (const sheet of findAll(workbook, 'sheet')) {
    const id = sheet.attrs['r:id'] ?? sheet.attrs.id ?? ''
    const part = targets.get(id)
    if (part === undefined) continue
    const state = sheet.attrs.state ?? 'visible'
    sheets.push({ name: sheet.attrs.name ?? '', part, hidden: state !== 'visible' })
  }
  if (sheets.length === 0) throw new XlsxError('xlsx 中没有任何工作表')
  return { sheets, date1904 }
}

/**
 * Read one worksheet into a grid of strings.
 *
 * @param root - the parsed `<worksheet>` element.
 * @param shared - the shared string table.
 * @param styles - style index to number-format id, plus custom codes.
 * @param date1904 - workbook epoch.
 * @param warnings - collector for recoverable oddities.
 * @returns the grid, with rows padded to the widest row.
 */
function readSheetGrid(
  root: XmlElement,
  shared: readonly string[],
  styles: { styleFormats: number[]; customFormats: Map<number, string> },
  date1904: boolean,
  warnings: string[],
): string[][] {
  const sheetData = childrenNamed(root, 'sheetData')[0]
  if (sheetData === undefined) return []

  const grid: string[][] = []
  let expectedRow = 0

  for (const rowNode of childrenNamed(sheetData, 'row')) {
    const declared = Number.parseInt(rowNode.attrs.r ?? '', 10)
    const rowIndex = Number.isFinite(declared) ? declared - 1 : expectedRow
    expectedRow = rowIndex + 1
    // A sparse row (r="7" after r="3") still occupies its position: skipping the
    // gap would silently shift every row after it.
    while (grid.length < rowIndex) grid.push([])
    const cells: string[] = []

    for (const cell of childrenNamed(rowNode, 'c')) {
      const reference = cell.attrs.r ?? ''
      const position = reference === '' ? { row: rowIndex, col: cells.length } : cellRef(reference)
      while (cells.length < position.col) cells.push('')

      const type = cell.attrs.t ?? 'n'
      const valueNode = childrenNamed(cell, 'v')[0]
      const rawValue = valueNode?.children.map((child) => (child.kind === 'text' ? child.text : '')).join('') ?? ''
      let text = ''

      if (type === 's') {
        const index = Number.parseInt(rawValue, 10)
        text = Number.isFinite(index) ? shared[index] ?? '' : ''
        if (text === '' && rawValue !== '') warnings.push(`共享字符串索引 ${rawValue} 越界（${reference}）`)
      } else if (type === 'inlineStr') {
        const inline = childrenNamed(cell, 'is')[0]
        text = inline === undefined ? '' : textOf(inline)
      } else if (type === 'str') {
        text = rawValue
      } else if (type === 'b') {
        text = rawValue === '1' ? 'TRUE' : 'FALSE'
      } else if (type === 'e') {
        text = ''
        warnings.push(`单元格 ${reference} 是错误值 ${rawValue}，已按空处理`)
      } else {
        const styleIndex = Number.parseInt(cell.attrs.s ?? '', 10)
        const formatId = Number.isFinite(styleIndex) ? styles.styleFormats[styleIndex] : undefined
        const customCode = formatId === undefined ? undefined : styles.customFormats.get(formatId)
        const looksLikeDate =
          (formatId !== undefined && DATE_FORMAT_IDS.has(formatId)) ||
          (customCode !== undefined && isDateFormat(customCode))
        if (looksLikeDate && rawValue !== '') {
          const serial = Number.parseFloat(rawValue)
          // 0 in a date-formatted cell means "empty", not 1899-12-30.
          const asDate = serialToDate(serial, date1904)
          text = serial > 0 && asDate !== '' ? asDate : ''
        } else {
          text = rawValue
        }
      }

      cells[position.col] = text
      while (cells.length > position.col + 1 && cells[cells.length - 1] === '') cells.pop()
    }

    grid[rowIndex] = cells
  }

  // Pad every row to the widest, so the header scorer sees a rectangle.
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0)
  for (const row of grid) while (row.length < width) row.push('')
  return grid
}

/**
 * Read a workbook into per-sheet grids.
 *
 * @param buffer - the `.xlsx` / `.xlsm` bytes.
 * @returns every sheet, in workbook order.
 * @throws XlsxError when the file is not a readable workbook.
 */
export function readWorkbook(buffer: Buffer): Workbook {
  let entries: Map<string, Buffer>
  try {
    entries = zipMap(buffer)
  } catch (error) {
    throw new XlsxError(`xlsx 不是有效的 ZIP 包：${error instanceof Error ? error.message : String(error)}`)
  }
  const warnings: string[] = []
  const { sheets, date1904 } = readSheetList(entries)
  const shared = readSharedStrings(entries)
  const styles = readStyles(entries)

  const out: SheetGrid[] = []
  for (const sheet of sheets) {
    const raw = entries.get(sheet.part)
    if (raw === undefined) {
      warnings.push(`工作表「${sheet.name}」的部件 ${sheet.part} 不存在，已跳过`)
      continue
    }
    const sheetWarnings: string[] = []
    const grid = readSheetGrid(parseXml(raw.toString('utf8')), shared, styles, date1904, sheetWarnings)
    out.push({ name: sheet.name, part: sheet.part, grid, hidden: sheet.hidden, warnings: sheetWarnings })
  }
  if (out.filter((sheet) => !sheet.hidden).length === 0) {
    throw new XlsxError('xlsx 中所有工作表都是隐藏的')
  }
  return { sheets: out, date1904, warnings }
}
