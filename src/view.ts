/**
 * Model-facing projection of an {@link IngestResult}.
 *
 * `buildView` is pure and covers the whole output shape, so both the tool's
 * `output.render` and the test suite exercise exactly what the model reads.
 * `output.schema` in `index.ts` mirrors these keys.
 *
 * The wording is deliberate: an ingest result is a *proposal*, never a success
 * claim. The preview asks "is this the table you meant?" because a silently
 * misread table produces a confidently wrong report downstream.
 */

import type { IngestResult } from './ingest/table-json.ts'

/** Model-facing projection of one ingest attempt. */
export interface IngestView {
  plugin: string
  target: string
  format: string
  ok: boolean
  confidence: string
  tableIndex: number
  headerRow: number
  columns: string[]
  rowCount: number
  candidateCount: number
  preview: string
  warnings: string[]
  error: string
  tableJson: string
  markdown: string
}

const FORMAT_OF: Record<string, string> = {
  docx: 'docx',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  csv: 'csv',
  tsv: 'csv',
}

/**
 * Derive the display format from a file name.
 *
 * @param target - the file path or name.
 * @returns a short format label, or `unknown`.
 */
function formatOf(target: string): string {
  const dot = target.lastIndexOf('.')
  if (dot === -1) return 'unknown'
  return FORMAT_OF[target.slice(dot + 1).toLowerCase()] ?? 'unknown'
}

/**
 * Render one ingest attempt into the shape the model reads.
 *
 * @param result - the ingest outcome, successful or not.
 * @param target - the file the result came from.
 * @param plugin - the plugin name, echoed for traceability.
 * @returns the projection plus a human-readable markdown summary.
 */
export function buildView(result: IngestResult, target: string, plugin: string): IngestView {
  const format = formatOf(target)
  const columns = result.table?.columns ?? []
  const rowCount = result.table?.rows.length ?? 0
  const lines: string[] = []

  lines.push(`# 表格摄取 · ${target}`)
  lines.push('')
  lines.push(`- 格式：${format}`)
  lines.push(
    result.ok
      ? `- 结果：抽到 ${result.candidates.length} 张表，选定第 ${result.table?.tableIndex ?? 0} 张`
      : '- 结果：未能确定主表',
  )
  if (result.ok) {
    lines.push(`- 置信度：${result.confidence}`)
    lines.push(`- 表头：第 ${(result.table?.headerRows ?? []).join('、')} 行`)
    lines.push(`- 规模：${rowCount} 行 × ${columns.length} 列`)
    lines.push(`- 列名：${columns.join(' | ')}`)
  }
  lines.push('')

  if (!result.ok) {
    lines.push('## 需要你指定')
    lines.push('')
    lines.push(result.error ?? '无法自动判定主表。')
    if (result.candidates.length > 0) {
      lines.push('')
      lines.push('候选表：')
      for (const [index, candidate] of result.candidates.entries()) {
        lines.push(
          `- 第 ${index} 张（${candidate.tableId}）：${candidate.rows} 行 × ${candidate.cols} 列` +
            (candidate.headerRow === null ? '，未识别出表头' : `，表头第 ${candidate.headerRow} 行`) +
            (candidate.caption === '' ? '' : `，标题「${candidate.caption}」`),
        )
      }
      lines.push('')
      lines.push('用 tableIndex 指定其中一张后重试。')
    }
  } else {
    lines.push('## 预览')
    lines.push('')
    lines.push(result.preview)
    lines.push('')
    lines.push('> 请确认「抽到的是不是这张表」。表抽错时，下游规则会报出并不存在的差异。')
  }

  if (result.warnings.length > 0) {
    lines.push('')
    lines.push('## 提示')
    lines.push('')
    for (const warning of result.warnings) lines.push(`- ${warning}`)
  }

  lines.push('')

  return {
    plugin,
    target,
    format,
    ok: result.ok,
    confidence: result.confidence,
    tableIndex: result.table?.tableIndex ?? 0,
    headerRow: result.table?.headerRows[0] ?? 0,
    columns,
    rowCount,
    candidateCount: result.candidates.length,
    preview: result.preview,
    warnings: [...result.warnings],
    error: result.error ?? '',
    tableJson: result.table === undefined ? '' : JSON.stringify(result.table),
    markdown: lines.join('\n'),
  }
}
