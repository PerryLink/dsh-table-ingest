# Changelog

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
