# dsh-table-ingest — Table ingest

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

<!-- topblock:v1 -->
> **What it is** — Converts docx, xlsx and csv into table JSON and reports the headers and columns it recognised.
> **Who it is for** — staff converting tables for checks.
> **What you give it** — docx, xlsx or csv files converted into table JSON
> **What it does not do** — no compliance verdict, no liability finding, no replacement for the reviewer; differences only.
> **How to start** — from the command line (not sold separately yet):
> `dsh plugin --profile <name> add dsh-table-ingest`
<!-- /topblock:v1 -->

[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-table-ingest?metric=downloads)](https://dshfind.com/en/plugins/PerryLink/dsh-table-ingest?ref=badge)

`dsh-table-ingest` converts a `.docx`, `.xlsx`, `.xlsm`, `.csv` or `.tsv` file into the table JSON that this family's rule checkers consume. A checker can only read a table it can recognise; most real workplace documents are Word files with several tables, merged cells and a title row above the header. This package is the step that turns one into the other, and — more importantly — tells you when it could not, instead of guessing.

It performs no business judgement. It does not decide whether a document is compliant, and it has no rules of its own: `rules/table-ingest.yaml` is deliberately empty.

## Install

```sh
dsh plugin --profile <name> add dsh-table-ingest
dsh --profile <name> --dump-config | grep 'dsh-table-ingest'
```

## What it looks like

![Workflow diagram for dsh-table-ingest: document → rule pack → findings.](docs/assets/dsh-table-ingest-flow.svg)

*Workflow overview: document → rule pack → findings.*

**Boundary:** this is a converter, not a checker. It never reports a finding, never scores a document, and never writes to the file it read. When a document has several plausible tables it returns the candidates and asks which one you meant, because a silently misread table makes the downstream checker report differences that do not exist — which is far more expensive than one extra question. It also does not read `.doc` (BIFF), scanned images, or PDFs: those need a converter or OCR that this family deliberately does not carry.

## What it answers

- Which tables does this document actually contain, and how big is each one?
- Which row is the header, and what are the column names?
- Is the chosen table reliable enough to run rules against, or should a human confirm first?
- If there is no usable table, is that because the document has none, or because it needs OCR?

## Standards it follows

This package encodes no legal or regulatory clause, so its rule pack is empty and there is no evidence directory to cite. What it does encode is the OOXML structure of `word/document.xml` and `xl/worksheets/*.xml`:

- `<w:tbl>`, `<w:tr>`, `<w:tc>` for table structure; `<w:gridSpan>` for horizontal merges and `<w:vMerge/>` (no `w:val`) for "continue the cell above" — the latter is *empty* in the XML, so filling it down is required or a complete document looks like it is missing dates.
- `<w:tblHeader>` plus shading and bold as header hints; there is no normative definition of "header row" in the format, so header detection is a scored heuristic and its result is reported with a confidence level.
- `sharedStrings.xml` for shared strings (the `<v>` is an *index*, not the value), inline strings (`t="inlineStr"`, whose value is not in `<v>`), and the three-level indirection from `c@style` → `cellXfs` → `numFmtId` that decides whether a number is a date.

## Compatibility

| Surface | Status |
|---|---|
| Harness | peer range `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | all (pure ESM; no native code, no network, no model call) |

## What it does

There are no rules. The tool exposes one operation, `table_ingest`, which takes a file path and optional hints and returns:

| Field | Meaning |
|---|---|
| `ok` | Whether a single table could be identified with enough confidence |
| `tableIndex`, `headerRow`, `columns` | What was chosen |
| `rowCount`, `candidateCount` | How much was read, and how many tables were found |
| `confidence` | `high`, `medium` or `low` — `low` means "a human should look at this" |
| `preview` | A markdown table of the first rows, for confirmation |
| `tableJson` | The table in the shape a rule checker accepts |
| `warnings`, `error` | What was odd, or why no table was chosen |

The chosen table is emitted in the same shape `parseTable` accepts, so a checker can consume it directly.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `rules/table-ingest.yaml` | 规则库路径 |

## Material format

A `.docx` with a title row, a header row and two data rows:

```
序号 | 日期        | 施工部位   | 监理情况
1    | 2026-10-08  | 1#楼三层   | 旁站检查…
2    | 2026-10-08  | 1#楼三层   | 旁站全过程…
```

becomes:

```json
{
  "target": "site-log.docx",
  "tableIndex": 0,
  "headerRows": [2],
  "columns": ["序号", "日期", "施工部位", "监理情况"],
  "header": {},
  "rows": [
    { "序号": "1", "日期": "2026-10-08", "施工部位": "1#楼三层", "监理情况": "旁站检查…" },
    { "序号": "2", "日期": "2026-10-08", "施工部位": "1#楼三层", "监理情况": "旁站全过程…" }
  ],
  "warnings": ["1 个单元格为空，已从上方合并单元格补值"],
  "mergedCells": 1,
  "sections": [],
  "ragged": false
}
```

For `.csv` and `.tsv` the same shape is produced with `headerRows: [1]`.

## Rule sources

This package cites no clause, so it has no `rules/evidence/` directory and its rule pack is empty by design. Confirm that with:

```sh
pnpm run check:citations   # expects 0 segments, 0 placeholders, 0 untraceable
```

Known limits, stated rather than hidden:

- **Header detection is a heuristic.** It scores bold, shading, `tblHeader`, short text, absence of digits and a small vocabulary, over the first six rows. A header further down is reported as "no header" rather than searched for indefinitely.
- **Two-level headers are not merged by default.** Merging them breaks the alias matching downstream (`金额（元）/合计` is not `合计`), so the most specific row is used, and the parent label is only prefixed when a child name repeats.
- **A ragged table is reported, not repaired.** When a row's cells do not add up to the declared width, the result is marked `ragged` and `low` confidence; there is no information in the file to recover the author's intent.
- **`expectedColumns` is the strongest signal you can give.** Supplying it turns an ambiguous four-table document into a deterministic choice.

## Troubleshooting

- **The plugin installs but the tool never appears**: check that `main` resolves to `lib/index.mjs` and that `pnpm run build` produced it.
- **`dsh plugin add` rejects the package**: the peer range covers `0.1.x` and `0.2.x`; outside it, grant an explicit exemption.
- **A rule did not run**: read the `skipped` array.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
node ../scripts/sync-shared.mjs dsh-table-ingest
```

## PerryLink DSH Plugin Family

Full family index: [choose a checker by material](https://perrylink.github.io/zh/checkers/choose/) and [all plugins](https://github.com/PerryLink). This repository is one of them.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-table-ingest contributors.
