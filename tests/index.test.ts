/**
 * The ingest contract, exercised on real docx files rather than hand-built JSON.
 *
 * Two properties matter more than accuracy:
 *
 *  - A table that cannot be identified is *not guessed*. A wrong table produces a
 *    confidently wrong report downstream, which is worse than asking.
 *  - The output is accepted by the engine's own `parseTable`, so "ingest worked"
 *    means the checker can actually consume it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ingestToTable } from '../src/ingest/ingest.ts'
import { buildView } from '../src/view.ts'

const HERE = import.meta.dirname
const fixture = (name: string): Buffer => readFileSync(join(HERE, 'fixtures', name))

describe('docx ingest', () => {
  it('reads a single-table document and skips the in-table title row', () => {
    const result = ingestToTable(fixture('E-site-log.docx'), 'E-site-log.docx')
    expect(result.ok).toBe(true)
    expect(result.table?.columns).toEqual([
      '序号',
      '日期',
      '天气',
      '施工部位',
      '施工内容',
      '监理情况',
      '存在问题',
      '备注',
    ])
    expect(result.table?.rows).toHaveLength(8)
    expect(result.confidence).toBe('medium')
  })

  it('fills a vMerge-continued cell down from the cell above', () => {
    const result = ingestToTable(fixture('E-site-log.docx'), 'E-site-log.docx')
    const rows = result.table?.rows ?? []
    // Rows 3 and 4 belong to the same date; the second one repeats it through
    // <w:vMerge/>. Without the fill it reads empty and a "missing date" rule
    // fires on a document that is in fact complete.
    expect(rows[3]?.['日期']).toBe(rows[2]?.['日期'])
    expect(rows[3]?.['日期']).toBe('2026-10-09')
    expect(result.warnings.join('')).toContain('从上方合并单元格补值')
  })

  it('merges a table that continues across a page break', () => {
    const result = ingestToTable(fixture('B-tender-multi-table.docx'), 'B-tender-multi-table.docx')
    expect(result.ok).toBe(true)
    expect(result.table?.columns).toEqual(['评审因素', '分值', '评分标准'])
    // Two source tables with the same header and no paragraph between them become
    // one; the merge is announced rather than done silently.
    expect(result.warnings.join('')).toContain('按跨页续表合并')
    expect(result.table?.rows.length).toBe(4)
    // A full-width merged row after the header is a group label, not a data row.
    expect(result.warnings.join('')).toContain('分组行')
  })

  it('refuses to pick a table when several are equally plausible', () => {
    const result = ingestToTable(fixture('C-hedui-baogao.docx'), 'C-hedui-baogao.docx')
    expect(result.ok).toBe(false)
    expect(result.candidates.length).toBeGreaterThan(1)
    expect(result.error ?? '').toContain('tableIndex')
  })

  it('uses expectedColumns to resolve the ambiguity deterministically', () => {
    const ambiguous = ingestToTable(fixture('C-hedui-baogao.docx'), 'C-hedui-baogao.docx')
    const resolved = ingestToTable(fixture('C-hedui-baogao.docx'), 'C-hedui-baogao.docx', {
      expectedColumns: ['文件', '条目', '读取方式'],
    })
    expect(ambiguous.ok).toBe(false)
    expect(resolved.ok).toBe(true)
    expect(resolved.confidence === 'high' || resolved.confidence === 'medium').toBe(true)
    expect(resolved.table?.columns).toContain('读取方式')
  })

  it('reports low confidence for a ragged table instead of pretending it is clean', () => {
    const result = ingestToTable(fixture('A-tender-sample.docx'), 'A-tender-sample.docx')
    // The fixture declares 4 columns but some rows carry 3 cells, so a column
    // shifts. The honest answer is "low", not "ok".
    expect(result.confidence).toBe('low')
  })

  it('says so when there is no table at all, rather than faking a one-column table', () => {
    const result = ingestToTable(fixture('I-no-table.docx'), 'I-no-table.docx')
    // Falling back to "one column of text" would be accepted by nothing: the
    // engine's column aliases would reject it. Reporting the absence is the
    // honest answer.
    expect(result.ok).toBe(false)
    expect(result.table).toBeUndefined()
    expect(result.error ?? '').toContain('没有找到表格')
  })

  it('rejects a file that is not a zip', () => {
    expect(() => ingestToTable(fixture('corrupt.docx'), 'corrupt.docx')).toThrow()
  })
})

describe('view', () => {
  it('asks the caller to confirm rather than announcing success', () => {
    const result = ingestToTable(fixture('E-site-log.docx'), 'E-site-log.docx')
    const view = buildView(result, 'E-site-log.docx', 'dsh-table-ingest')
    expect(view.ok).toBe(true)
    expect(view.markdown).toContain('请确认「抽到的是不是这张表」')
    expect(view.markdown).not.toContain('转换成功')
    expect(view.tableJson).not.toBe('')
  })

  it('lists candidates and the tableIndex remedy when it cannot decide', () => {
    const result = ingestToTable(fixture('C-hedui-baogao.docx'), 'C-hedui-baogao.docx')
    const view = buildView(result, 'C-hedui-baogao.docx', 'dsh-table-ingest')
    expect(view.ok).toBe(false)
    expect(view.markdown).toContain('用 tableIndex 指定')
    expect(view.markdown).toContain('第 0 张')
  })
})
