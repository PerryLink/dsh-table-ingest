import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Config } from './config.ts'
import type { Config as ConfigShape } from './config.ts'
import { ingestToTable } from './ingest/ingest.ts'
import type { IngestHint } from './ingest/table-json.ts'
import { buildView } from './view.ts'

export const name = 'dsh-table-ingest'
export const inject = ['tools']
export { Config }

/** Tool id exposed to the model, and the row id in `cordis.patch.yml`. */
export const TOOL_NAME = 'table_ingest'

/**
 * Build the ingest hint from tool arguments.
 *
 * Every field is optional: an empty hint means "decide for yourself and tell me
 * what you decided", which is the common case. A supplied field overrides the
 * heuristic rather than merely biasing it.
 *
 * @param args - the tool arguments.
 * @param config - validated configuration, used for the preview default.
 * @returns a hint carrying only the fields the caller actually set.
 */
function hintOf(
  args: {
    tableIndex?: number
    headerRow?: number
    expectedColumns?: string[]
    captionKeywords?: string[]
    previewRows?: number
  },
  config: ConfigShape,
): IngestHint {
  const hint: IngestHint = {}
  if (args.tableIndex !== undefined) hint.tableIndex = args.tableIndex
  if (args.headerRow !== undefined) hint.headerRow = args.headerRow
  if ((args.expectedColumns ?? []).length > 0) hint.expectedColumns = args.expectedColumns
  if ((args.captionKeywords ?? []).length > 0) hint.captionKeywords = args.captionKeywords
  hint.previewRows = args.previewRows ?? config.previewRows
  return hint
}

/**
 * Register the ingest tool.
 *
 * Registration is an effect: `ctx.tools.register` returns the disposer that
 * removes the tool when this plugin unloads, which is what keeps the plugin
 * hot-reloadable.
 *
 * @param ctx - plugin context, with `tools` already available.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: ConfigShape): () => void {
  return ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description:
        '把 docx / xlsx / csv 文件转成规则检查器能吃的表格 JSON。会给出候选表、表头行、置信度与一张预览表，让调用方确认「抽到的是不是这张表」。' +
        '本工具只做结构转换，不做任何业务判断；抽不出表或表头判不出时会明确说明，不猜。',
      parameters: {
        file: { type: 'string', description: '文件绝对路径（.docx / .xlsx / .xlsm / .csv / .tsv）。' },
        tableIndex: {
          type: 'number',
          description: '指定第几张表（0 基）。留空则自动判定；多表歧义时本工具返回候选而不猜。',
        },
        headerRow: { type: 'number', description: '指定表头行（1 基）。留空则按排版信号自动判定。' },
        expectedColumns: {
          type: 'array',
          items: { type: 'string' },
          description: '期望的列名。传入后选表与表头判定以它为主信号，是提升准确率最有效的参数。',
        },
        captionKeywords: {
          type: 'array',
          items: { type: 'string' },
          description: '表标题可能包含的关键词，如「监理日志」「评分」。',
        },
        previewRows: { type: 'number', description: '预览表返回多少行数据，默认取自配置。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plugin: { type: 'string' },
            target: { type: 'string' },
            format: { type: 'string' },
            ok: { type: 'boolean' },
            confidence: { type: 'string' },
            tableIndex: { type: 'integer' },
            headerRow: { type: 'integer' },
            columns: { type: 'array', items: { type: 'string' } },
            rowCount: { type: 'integer' },
            candidateCount: { type: 'integer' },
            preview: { type: 'string' },
            warnings: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
            tableJson: { type: 'string' },
            markdown: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: (value as { markdown: string }).markdown }],
      },
      timeoutMs: config.timeoutMs,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (args.file === undefined || args.file.trim() === '') throw new Error('必须提供 file（文件绝对路径）')
        const path = resolve(args.file)
        exec.signal.throwIfAborted()
        const buffer = await readFile(path, { signal: exec.signal })
        exec.signal.throwIfAborted()
        const result = ingestToTable(buffer, path, hintOf(args, config))
        return buildView(result, path, name)
      },
    }),
  )
}
