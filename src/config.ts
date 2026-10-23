import Schema from '@deepseek-ai/schemastery'

/**
 * Every tunable lives here so an operator can change behaviour from
 * `cordis.yml` without editing code (the family's "no hard-coded tunables"
 * redline).
 *
 * This package is a converter, not a rule checker, so there is no rule pack and
 * no disabled/only rule ids: the knobs are the heuristics' ceilings and the tool
 * timeout.
 */
export interface Config {
  /** Tool timeout budget in milliseconds. */
  timeoutMs: number
  /** Rows scanned when looking for a header, from the top of the table. */
  headerScanRows: number
  /** Default number of data rows echoed in the confirmation preview. */
  previewRows: number
}

export const Config: Schema<Config> = Schema.object({
  timeoutMs: Schema.number().default(60_000).description('工具超时预算（毫秒）。'),
  headerScanRows: Schema.number()
    .default(6)
    .description('向下扫描多少行来判定表头；超过这个范围的表头会被判为「无表头」。'),
  previewRows: Schema.number().default(10).description('确认预览默认返回多少行数据。'),
})
