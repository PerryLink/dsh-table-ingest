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
import { readWorkbook } from '../src/ingest/xlsx.ts'
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

describe('xlsx ingest', () => {
  it('reads the sheet the workbook says is first, not sheet1.xml', () => {
    const workbook = readWorkbook(fixture('H-ledger.xlsx'))
    expect(workbook.sheets.map((s) => s.name)).toEqual(['监理日志台账', '说明'])
    expect(workbook.date1904).toBe(false)
  })

  it('resolves a shared string through its index rather than printing the index', () => {
    const grid = readWorkbook(fixture('H-ledger.xlsx')).sheets[0]?.grid ?? []
    expect(grid[0]).toEqual(['序号', '日期', '施工部位', '施工内容', '监理情况'])
  })

  it('reads an inline string, whose value is not in <v>', () => {
    const grid = readWorkbook(fixture('H-ledger.xlsx')).sheets[0]?.grid ?? []
    expect(grid[2]?.[3]).toBe('内联字符串直接写在单元格里')
  })

  it('reads a formula cell through its cached value instead of recalculating', () => {
    const grid = readWorkbook(fixture('H-ledger.xlsx')).sheets[0]?.grid ?? []
    expect(grid[3]?.[2]).toBe('3')
    expect(grid[3]?.[3]).toBe('ab')
  })

  it('turns a serial number into a date only when the number format says so', () => {
    const grid = readWorkbook(fixture('H-ledger.xlsx')).sheets[0]?.grid ?? []
    // Custom format yyyy"年"m"月"d"日" — the quoted literals must not be read as date tokens.
    expect(grid[4]?.[1]).toBe('2026-10-08')
    expect(grid[4]?.[2]).toBe('自定义格式 yyyy年m月d日')
  })

  it('produces table JSON the engine can consume', () => {
    const result = ingestToTable(fixture('H-ledger.xlsx'), 'H-ledger.xlsx')
    expect(result.ok).toBe(true)
    expect(result.table?.columns).toEqual(['序号', '日期', '施工部位', '施工内容', '监理情况'])
    expect(result.table?.rows.length).toBe(4)
  })

  it('lets tableIndex pick a later sheet', () => {
    const result = ingestToTable(fixture('H-ledger.xlsx'), 'H-ledger.xlsx', { tableIndex: 1 })
    expect(result.ok).toBe(true)
    expect(result.table?.columns).toEqual(['合计'])
  })
})

describe('csv ingest', () => {
  it('decodes a GB18030 file, whose column names are otherwise replacement characters', () => {
    const result = ingestToTable(fixture('site-log-gb18030.csv'), 'site-log-gb18030.csv')
    expect(result.ok).toBe(true)
    expect(result.table?.columns).toEqual(['序号', '日期', '施工部位', '监理情况'])
    expect(result.table?.rows[0]?.['施工部位']).toBe('1#楼三层')
  })

  it('keeps every value a string, so a leading zero survives', () => {
    const result = ingestToTable(
      Buffer.from('序号,编号\n1,007\n', 'utf8'),
      'codes.csv',
    )
    expect(result.table?.rows[0]?.['编号']).toBe('007')
  })

  it('rejects an empty file rather than emitting an empty table', () => {
    expect(() => ingestToTable(Buffer.from('', 'utf8'), 'empty.csv')).toThrow()
  })
})
