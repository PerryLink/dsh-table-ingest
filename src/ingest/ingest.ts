/**
 * `ingestToTable` — turn a real file into the table JSON `parseTable` accepts.
 *
 * Contract:
 *
 *     ingestToTable(buffer, '监理日志.docx', { expectedColumns: [...] })
 *       -> { ok, table, candidates, preview, confidence, warnings }
 *
 * The caller (a plugin, or the GUI's confirm step) decides what to do with a low
 * confidence result. The ingest layer never pretends: when it did not find a table it
 * says so and returns the candidates it did see.
 */

import { readZipEntries, ZipError } from './zip.ts'
import { extractDocumentTables, readDocumentPart, flattenNested } from './docx.ts'
import type { DocxTable } from './docx.ts'
import {
  confidenceOf,
  detectHeader,
  rankTables,
  renderPreview,
  tableToJson,
} from './table-json.ts'
import type { Candidate, HeaderChoice, IngestHint, IngestResult, TableJson } from './table-json.ts'

export * from './table-json.ts'
export * from './docx.ts'

export type IngestErrorCode =
  | 'unsupported-format'
  | 'not-a-package'
  | 'no-document-part'
  | 'no-table'
  | 'no-data-rows'
  | 'bad-hint'

export class IngestError extends Error {
  readonly code: IngestErrorCode
  readonly candidates: Candidate[]

  constructor(code: IngestErrorCode, message: string, candidates: Candidate[] = []) {
    super(message)
    this.name = 'IngestError'
    this.code = code
    this.candidates = candidates
  }
}

/* ------------------------------------------------------- adjacent-table merge -- */

function headerSignature(table: DocxTable, hint: IngestHint): string[] | null {
  const choice = detectHeader(table, hint)
  if (choice.synthetic) return null
  const row = table.rows[choice.index]
  if (row === undefined) return null
  return row.grid.map((cell) => cell.trim())
}

/**
 * Join a table with the next table when the next one repeats the same header.
 *
 * Word splits a long table across a page break only in display; the file keeps two
 * `w:tbl` elements and repeats the header row in the second (that is exactly what
 * `w:tblHeader` means). Read as separate tables, page 2 looks like a table with one
 * data row; joined, it is the table the user meant. Real example: the 评分表 in
 * `tender-multi-table.docx`.
 */
export function mergeAdjacentTables(
  tables: DocxTable[],
  hint: IngestHint,
): { tables: DocxTable[]; mergedInto: Map<number, number[]>; warnings: string[] } {
  if (hint.mergeAdjacent === false) return { tables, mergedInto: new Map(), warnings: [] }
  const out: DocxTable[] = []
  const mergedInto = new Map<number, number[]>()
  const warnings: string[] = []
  for (const table of tables) {
    const previous = out[out.length - 1]
    if (previous !== undefined && canMerge(previous, table, hint)) {
      const choice = detectHeader(table, hint)
      const tail = table.rows.slice(choice.index + choice.rows)
      const merged = [...(mergedInto.get(previous.index) ?? [])]
      merged.push(table.index)
      mergedInto.set(previous.index, merged)
      out[out.length - 1] = {
        ...previous,
        rows: [...previous.rows, ...tail],
        after: table.after,
        warnings: [...previous.warnings, `与第 ${table.index + 1} 张表表头相同，已按跨页续表合并`],
      }
      warnings.push(`第 ${table.index + 1} 张表与上一张表表头相同，已合并为一张`)
      continue
    }
    out.push(table)
  }
  return { tables: out, mergedInto, warnings }
}

function canMerge(previous: DocxTable, next: DocxTable, hint: IngestHint): boolean {
  if (previous.cols !== next.cols) return false
  // A paragraph between the two tables usually means a new section, not a page break.
  if (next.before.length > 0) return false
  const a = headerSignature(previous, hint)
  const b = headerSignature(next, hint)
  if (a === null || b === null) return false
  if (a.length !== b.length) return false
  return a.every((cell, index) => cell === b[index])
}

/* ----------------------------------------------------------------- docx entry -- */

export interface DocxIngest extends IngestResult {
  /** All tables before merging, for a table picker UI. */
  allTables: Candidate[]
  /** Paragraphs of the document body, for text fallback and header scalars. */
  paragraphs: string[]
  /** Tables that live inside cells of another table. */
  nestedTables: Candidate[]
}

/** Read a `.docx` into table JSON. */
export function ingestDocx(source: Buffer, filename: string, hint: IngestHint = {}): DocxIngest {
  let entries: Map<string, Buffer>
  try {
    entries = new Map(readZipEntries(source).map((entry) => [entry.name, entry.bytes]))
  } catch (error) {
    if (error instanceof ZipError) throw new IngestError('not-a-package', `docx 读取失败：${error.message}`)
    throw error
  }

  let body
  try {
    body = readDocumentPart(entries)
  } catch (error) {
    throw new IngestError('no-document-part', error instanceof Error ? error.message : String(error))
  }

  const rawTables = extractDocumentTables(body)
  const paragraphs = collectParagraphs(body)
  if (rawTables.length === 0) {
    const result = textFallbackOrError(paragraphs, filename, hint, [])
    return { ...result, allTables: [], paragraphs, nestedTables: [] }
  }

  const { tables, mergedInto, warnings: mergeWarnings } = mergeAdjacentTables(rawTables, hint)
  const nested = tables.flatMap((table) =>
    flattenNested(table).map((inner) => ({ parentTable: table.index, table: inner })),
  )

  const ranked = rankTables(tables, hint, {
    nested: nested.map((item) => ({ parentTable: item.parentTable, table: item.table })),
    mergedInto,
  })
  const allTables = rankTables(rawTables, hint, { mergedInto })

  // An explicit index wins over scoring, but an out-of-range index is an error.
  let chosen: DocxTable | undefined
  if (typeof hint.tableIndex === 'number') {
    chosen = tables.find((table) => table.index === hint.tableIndex)
    if (chosen === undefined) {
      throw new IngestError(
        'bad-hint',
        `指定了第 ${hint.tableIndex + 1} 张表，但文档只有 ${tables.length} 张表`,
        ranked,
      )
    }
  } else {
    const best = ranked[0]
    const runnerUp = ranked[1]
    const ambiguous =
      hint.ambiguous !== 'first' &&
      best !== undefined &&
      runnerUp !== undefined &&
      best.aliasHits === 0 &&
      best.tableId !== runnerUp.tableId &&
      best.score - runnerUp.score < 20
    if (ambiguous) {
      return {
        ok: false,
        table: undefined,
        candidates: ranked,
        header: null,
        preview: '',
        confidence: 'low',
        warnings: [],
        error:
          `文档中有 ${ranked.length} 张表，前两名分差 ${best.score - runnerUp.score} 分且都没有命中期望列名，` +
          `无法自动判定主表；请用 tableIndex 指定其中一张（候选：${ranked.map((c) => `#${c.tableId} ${c.cols}列`).join('、')}）`,
        allTables,
        paragraphs,
        nestedTables: ranked.filter((c) => c.parentTable !== undefined),
      }
    }
    if (best === undefined || best.score <= 0) {
      return { ...textFallbackOrError(paragraphs, filename, hint, ranked), allTables, paragraphs, nestedTables: ranked.filter((c) => c.parentTable !== undefined) }
    }
    if (best.parentTable !== undefined) {
      const parent = tables.find((table) => table.index === best.parentTable)
      chosen = parent === undefined ? undefined : flattenNested(parent).find((t) => t.id === best.tableId)
    } else {
      chosen = tables.find((table) => table.id === best.tableId)
    }
  }

  if (chosen === undefined) {
    return { ...textFallbackOrError(paragraphs, filename, hint, ranked), allTables, paragraphs, nestedTables: ranked.filter((c) => c.parentTable !== undefined) }
  }

  const choice: HeaderChoice = detectHeader(chosen, hint)
  const table = tableToJson(chosen, hint, filename)
  table.warnings.push(...mergeWarnings)
  const candidate = ranked.find((entry) => entry.tableId === chosen?.id)
  const previewLimit = hint.previewRows ?? 5
  const preview = renderPreview(table, previewLimit)

  if (table.rows.length === 0) {
    throw new IngestError(
      'no-data-rows',
      `第 ${chosen.index + 1} 张表识别出 ${table.columns.length} 列，但没有数据行`,
      ranked,
    )
  }

  return {
    ok: true,
    table,
    candidates: ranked,
    header: choice,
    preview,
    confidence: confidenceOf(choice, candidate, table.ragged),
    warnings: table.warnings,
    allTables,
    paragraphs,
    nestedTables: ranked.filter((entry) => entry.parentTable !== undefined),
  }
}

function collectParagraphs(body: { children: unknown[] }): string[] {
  // Body is an XmlElement; typed loosely here to keep the import surface small.
  const out: string[] = []
  const walk = (node: any): void => {
    if (node.kind !== 'element') return
    if (node.name === 'p') {
      const text = node.children
        .filter((child: any) => child.kind === 'element')
        .map((child: any) => (child.name === 'r' ? collectRunText(child) : ''))
        .join('')
        .replace(/[ \t\u00a0\u3000]+/g, ' ')
        .trim()
      if (text !== '') out.push(text)
      return
    }
    if (node.name === 'tbl') return // table text is not body prose
    for (const child of node.children) walk(child)
  }
  for (const child of body.children as any[]) walk(child)
  return out
}

function collectRunText(run: any): string {
  let out = ''
  for (const child of run.children) {
    if (child.kind === 'text') out += child.text
    else if (child.name === 't') out += child.children.map((c: any) => (c.kind === 'text' ? c.text : '')).join('')
  }
  return out
}

function textFallbackOrError(
  paragraphs: string[],
  filename: string,
  hint: IngestHint,
  candidates: Candidate[],
): IngestResult {
  if (hint.fallback !== 'text') {
    return {
      ok: false,
      candidates,
      header: null,
      preview: '',
      confidence: 'low',
      warnings: [],
      error:
        candidates.length === 0
          ? `${filename} 中没有找到表格（w:tbl）`
          : `${filename} 中找到 ${candidates.length} 张表，但没有任何一张看起来是数据表；最高分 ${candidates[0]?.score}`,
    }
  }
  const rows = paragraphs.map((line) => ({ 正文: line }))
  return {
    ok: true,
    table: {
      target: filename,
      tableIndex: -1,
      headerRows: [],
      columns: ['正文'],
      header: {},
      rows,
      warnings: ['没有找到表格，已降级为「整篇文本一行一列」；表格规则无法在这种材料上执行'],
      mergedCells: 0,
      sections: [],
      ragged: false,
    },
    candidates,
    header: null,
    preview: paragraphs.slice(0, 5).map((line) => `| ${line} |`).join('\n'),
    confidence: 'low',
    warnings: ['降级为纯文本模式'],
  }
}

/* ------------------------------------------------------------------ dispatch -- */

/** Formats the ingest layer can read today. */
export type IngestFormat = 'docx' | 'xlsx' | 'csv' | 'json' | 'yaml' | 'txt'

export function formatOf(filename: string): IngestFormat | undefined {
  const extension = (filename.split('.').pop() ?? '').toLowerCase()
  if (extension === 'docx' || extension === 'docm') return 'docx'
  if (extension === 'xlsx' || extension === 'xlsm') return 'xlsx'
  if (extension === 'csv') return 'csv'
  if (extension === 'json') return 'json'
  if (extension === 'yaml' || extension === 'yml') return 'yaml'
  if (extension === 'txt' || extension === 'md') return 'txt'
  return undefined
}

/**
 * Read any supported file into table JSON.
 *
 * xlsx is deliberately not wired yet: the xlsx reader has its own specification and
 * landing it here half-done would make the failure mode look like a doc layout
 * problem. The dispatch is in place so the caller's code does not change when it lands.
 */
export function ingestToTable(source: Buffer, filename: string, hint: IngestHint = {}): IngestResult {
  const format = formatOf(filename)
  switch (format) {
    case 'docx':
      return ingestDocx(source, filename, hint)
    case 'json':
    case 'yaml':
    case 'txt':
      return {
        ok: true,
        candidates: [],
        header: null,
        preview: '',
        confidence: 'high',
        warnings: ['该格式已是 parseTable 可直接读取的文本，未经过 ingest 转换'],
      }
    case 'xlsx':
      throw new IngestError('unsupported-format', 'xlsx 读取尚未接入 ingest 层（规格已设计，见设计文档第 3 节）')
    case 'csv':
      throw new IngestError('unsupported-format', 'csv 未接入 ingest 层；首行即表头、无合并单元格，接起来只需 20 行')
    default:
      throw new IngestError('unsupported-format', `不支持的文件格式：${filename}`)
  }
}
