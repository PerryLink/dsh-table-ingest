/**
 * CSV / TSV reader.
 *
 * Deliberately small: a delimited text file has no merged cells, no styles and no
 * multiple tables, so the only decisions are the delimiter, the quoting and the
 * character encoding. The encoding matters in practice — Chinese CSV exported
 * from Excel on Windows is frequently GB18030, not UTF-8, and decoding it as
 * UTF-8 yields replacement characters in every column name.
 */

/** Result of reading a delimited text file. */
export interface DelimitedTable {
  /** Row-major grid; every row is padded to the width of the widest row. */
  grid: string[][]
  /** The delimiter that was used. */
  delimiter: string
  /** The encoding that was used to decode the bytes. */
  encoding: string
  warnings: string[]
}

/** Raised when the bytes cannot be decoded as text. */
export class DelimitedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DelimitedError'
  }
}

/**
 * Decode bytes, falling back to GB18030 when the file is not valid UTF-8.
 *
 * @param buffer - raw file bytes.
 * @returns the text and the encoding used.
 */
export function decodeText(buffer: Buffer): { text: string; encoding: string } {
  // A UTF-8 BOM is authoritative when present.
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8' }
  }
  const asUtf8 = buffer.toString('utf8')
  // Replacement characters mean the bytes were not UTF-8.
  if (!asUtf8.includes('\uFFFD')) return { text: asUtf8, encoding: 'utf-8' }
  try {
    const decoder = new TextDecoder('gb18030')
    return { text: decoder.decode(buffer), encoding: 'gb18030' }
  } catch {
    throw new DelimitedError('文件既不是 UTF-8 也不是 GB18030，无法确定编码')
  }
}

/**
 * Guess the delimiter from the first non-empty line.
 *
 * @param text - the decoded file.
 * @returns the delimiter with the highest count on the first line.
 */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/u).find((line) => line.trim() !== '') ?? ''
  const candidates = [',', '\t', ';', '|']
  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

/**
 * Parse delimited text into a grid, honouring RFC 4180 quoting.
 *
 * @param text - the decoded file.
 * @param delimiter - field separator.
 * @returns rows of fields, padded to equal width.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const character = text[index] ?? ''
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }
    if (character === '"' && field === '') {
      quoted = true
      continue
    }
    if (character === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (character === '\r') continue
    if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += character
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop a trailing row that is entirely empty (the file's final newline).
  while (rows.length > 0 && (rows[rows.length - 1] ?? []).every((cell) => cell.trim() === '')) rows.pop()

  const width = rows.reduce((max, current) => Math.max(max, current.length), 0)
  for (const current of rows) while (current.length < width) current.push('')
  return rows
}

/**
 * Read a `.csv` / `.tsv` file into a grid.
 *
 * @param buffer - raw bytes.
 * @param filename - used only to prefer the tab delimiter for `.tsv`.
 * @returns the grid plus what was inferred.
 */
export function readDelimited(buffer: Buffer, filename: string): DelimitedTable {
  const { text, encoding } = decodeText(buffer)
  const warnings: string[] = []
  const byExtension = filename.toLowerCase().endsWith('.tsv') ? '\t' : undefined
  const delimiter = byExtension ?? sniffDelimiter(text)
  if (byExtension !== undefined && text.includes(',')) {
    warnings.push('.tsv 扩展名按制表符切分；文件中同时出现逗号，若切分不对请另存为 .csv')
  }
  const grid = parseDelimited(text, delimiter)
  if (grid.length === 0) throw new DelimitedError('文件为空或没有任何数据行')
  if (encoding !== 'utf-8') warnings.push(`文件不是 UTF-8，已按 ${encoding} 解码`)
  const widths = new Set(grid.map((row) => row.length))
  if (widths.size > 1) warnings.push(`各行列数不一致（${[...widths].join('/')}），已按最宽行补齐`)
  return { grid, delimiter, encoding, warnings }
}
