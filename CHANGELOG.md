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
