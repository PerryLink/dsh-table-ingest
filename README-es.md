# dsh-table-ingest — Table ingest (Español)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-table-ingest?metric=downloads)](https://dshfind.com/en/plugins/PerryLink/dsh-table-ingest?ref=badge)

`dsh-table-ingest` convierte un archivo `.docx`, `.xlsx`, `.xlsm`, `.csv` o `.tsv` en el JSON de tabla que consumen los verificadores de reglas de esta familia. Un verificador solo puede leer una tabla que reconoce; los documentos reales de oficina suelen ser archivos Word con varias tablas, celdas combinadas y una fila de título encima del encabezado. Este paquete es el paso que convierte uno en otro y —más importante— avisa cuando no pudo, en lugar de adivinar.

No emite ningún juicio de negocio: no decide si un documento cumple, y no tiene reglas propias; `rules/table-ingest.yaml` está vacío a propósito.

## Install

```sh
dsh plugin --profile <name> add dsh-table-ingest
dsh --profile <name> --dump-config | grep 'dsh-table-ingest'
```

## What it looks like

![Workflow diagram for dsh-table-ingest: document → rule pack → findings.](docs/assets/dsh-table-ingest-flow.svg)

*Workflow overview: document → rule pack → findings.*

**Límite:** es un conversor, no un verificador. Nunca emite un hallazgo, nunca puntúa un documento y nunca escribe en el archivo que leyó. Cuando un documento tiene varias tablas plausibles devuelve los candidatos y pregunta cuál querías, porque una tabla mal leída hace que el verificador posterior informe diferencias que no existen —mucho más caro que una pregunta extra. Tampoco lee `.doc` binario, imágenes escaneadas ni PDF: eso requiere un conversor u OCR que esta familia deliberadamente no incluye.

## What it answers

- ¿Qué tablas contiene realmente este documento y de qué tamaño es cada una?
- ¿Qué fila es el encabezado y cuáles son los nombres de columna?
- ¿La tabla elegida es lo bastante fiable para ejecutar reglas, o conviene que una persona confirme?
- Si no hay tabla utilizable, ¿es porque el documento no tiene, o porque necesita OCR?

## Standards it follows

Este paquete no codifica ninguna cláusula legal ni reglamentaria, por lo que su paquete de reglas está vacío y no hay directorio de evidencia que citar. Lo que sí codifica es la estructura OOXML de `word/document.xml` y `xl/worksheets/*.xml`:

- `<w:tbl>`, `<w:tr>`, `<w:tc>` para la estructura; `<w:gridSpan>` para combinaciones horizontales y `<w:vMerge/>` (sin `w:val`) para "continuar la celda superior" —esta última queda *vacía* en el XML, así que rellenarla hacia abajo es obligatorio o un documento completo parece tener fechas faltantes.
- `<w:tblHeader>` junto con sombreado y negrita como indicios de encabezado; el formato no define normativamente "fila de encabezado", así que la detección es una heurística puntuada y su resultado se informa con un nivel de confianza.
- `sharedStrings.xml` para cadenas compartidas (la `<v>` es un *índice*, no el valor), cadenas en línea (`t="inlineStr"`, cuyo valor no está en `<v>`), y la indirección de tres niveles `c@style` → `cellXfs` → `numFmtId` que decide si un número es una fecha.

## Compatibility

| Surface | Status |
|---|---|
| Harness | peer range `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | all (pure ESM; no native code, no network, no model call) |

## What it does

There are no rules. The tool exposes one operation, `table_ingest`, which takes a file path and optional hints and returns `ok`, `tableIndex`, `headerRow`, `columns`, `rowCount`, `candidateCount`, `confidence` (`high` / `medium` / `low`), a markdown `preview` for confirmation, `tableJson` in the shape a rule checker accepts, plus `warnings` and `error`.

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

This package cites no clause, so it has no `rules/evidence/` directory and its rule pack is empty by design. Confirm that with `pnpm run check:citations` (expects 0 segments, 0 placeholders, 0 untraceable).

Known limits, stated rather than hidden: header detection is a heuristic scored over the first six rows; two-level headers are not merged by default because merging breaks the alias matching downstream; a ragged table is reported, not repaired; and `expectedColumns` is the strongest signal a caller can supply.

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
