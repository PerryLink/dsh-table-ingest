/**
 * Library surface of the ingest layer, for other packages.
 *
 * The plugin entry (`src/index.ts`) registers a tool with the harness; this entry
 * exposes the same conversion as plain functions, so a package that needs to read
 * a document does not have to depend on the plugin's tool registration or carry a
 * second copy of the OOXML readers.
 */

export { ingestToTable, ingestDocx, formatOf } from './ingest/ingest.ts'
export type { IngestFormat } from './ingest/ingest.ts'
export { readWorkbook, serialToDate, isDateFormat, cellRef } from './ingest/xlsx.ts'
export type { Workbook, SheetGrid } from './ingest/xlsx.ts'
export { readDelimited, parseDelimited, decodeText, sniffDelimiter } from './ingest/csv.ts'
export type { DelimitedTable } from './ingest/csv.ts'
export type {
  Candidate,
  HeaderChoice,
  IngestHint,
  IngestResult,
  SectionRow,
  TableJson,
} from './ingest/table-json.ts'
