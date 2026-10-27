# Changelog

## 0.2.1

- **ZIP output budgets.** DOCX/XLSX input is untrusted. A package is now rejected
  before decompression when it declares more than 256 entries, an entry name over
  4 KiB, or a compressed entry over 8 MiB. Deflate output is bounded per entry
  (8 MiB) and cumulatively (32 MiB) via `inflateRawSync({ maxOutputLength })`, so a
  valid but hostile deflate stream cannot expand without limit.
- **Central-directory bounds.** Name, extra, comment and local-header lengths are
  checked against the buffer before reading; a truncated directory or a local
  offset outside the package raises `ZipError` instead of returning partial data.
- No change to the conversion output for documents within these limits. The limits
  are security ceilings, not tunables; callers may pass lower `ZipLimits` values
  (used by the tests).

## 0.2.0

- **Library entry `dsh-table-ingest/api`.** The plugin entry registers a tool;
  this entry exposes the same conversion as plain functions (`ingestToTable`,
  `readWorkbook`, `readDelimited`, …) so another package can read a document
  without depending on tool registration or copying the OOXML readers.
- No behaviour change to the tool itself.

## 0.1.0

First release.

- Convert `.docx`, `.xlsx`, `.xlsm`, `.csv` and `.tsv` into the table JSON this
  family's rule checkers consume.
- docx: `w:tbl` / `w:tr` / `w:tc` with `w:gridSpan` expansion and `w:vMerge`
  continuation fill-down, nested tables surfaced separately, ragged tables
  flagged rather than repaired.
- Table selection across several candidates, with a refusal to guess when the
  scores tie; `tableIndex` and `headerRow` override the heuristic.
- `expectedColumns` as a first-class signal: it turns an ambiguous multi-table
  document into a deterministic choice.
- Header detection scored over the first six rows with a confidence level;
  two-level headers are deliberately not merged.
- A confirmation preview whose wording asks "is this the table you meant?"
  rather than announcing success.
- Correction carried over from the family engine: the locator writes `column`
  rather than the previously dropped `field`, so row-level findings name the
  field they concern.

## 0.1.1

0.1.0 advertised `.xlsx`, `.xlsm`, `.csv` and `.tsv` but only `.docx` was wired:
the other four threw `unsupported-format`. That is a correctness bug in the
release, not a missing feature, so it is fixed here rather than left in the
description.

- **xlsx / xlsm reader.** Shared strings (the `<v>` is an index, not the value),
  inline strings (the value is in `<is>`, so reading `<v>` yields `''`), formula
  cells read through their cached `<v>` without recalculation, sheet order taken
  from `workbook.xml` plus `_rels` rather than assuming `sheet1.xml`, and dates
  resolved through `c@style` → `cellXfs` → `numFmtId` with quoted literals
  stripped so a unit suffix such as `0"月"` is not mistaken for a date token.
  A `0` in a date-formatted cell is treated as empty rather than as 1899-12-30.
- **csv / tsv reader.** RFC 4180 quoting, delimiter sniffing, and a GB18030
  fallback when the bytes are not valid UTF-8 — Chinese CSV exported from Excel
  on Windows is frequently GB18030, and decoding it as UTF-8 turns every column
  name into replacement characters.
- Both formats go through the same table-ranking, header-detection and preview
  pipeline as docx, so behaviour is identical across the three.
- 10 further tests (25 total): shared-string indirection, inline strings,
  formula caching, custom date formats, `tableIndex` on a later sheet, GB18030
  decoding, and leading-zero preservation.
