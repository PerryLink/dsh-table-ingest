# dsh-table-ingest — Table ingest (हिन्दी)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-table-ingest?metric=downloads)](https://dshfind.com/en/plugins/PerryLink/dsh-table-ingest?ref=badge)

`dsh-table-ingest` किसी `.docx`, `.xlsx`, `.xlsm`, `.csv` या `.tsv` फ़ाइल को उस तालिका-JSON में बदलता है जिसे इस परिवार के नियम-जाँचकर्ता पढ़ते हैं। जाँचकर्ता केवल उसी तालिका को पढ़ सकता है जिसे वह पहचानता है; वास्तविक कार्यालय दस्तावेज़ प्रायः कई तालिकाओं, मर्ज किए गए कक्षों और शीर्षक-पंक्ति वाले Word फ़ाइल होते हैं। यह पैकेज वही रूपांतरण करता है और — इससे भी महत्वपूर्ण — जब नहीं कर पाता तो बताता है, अनुमान नहीं लगाता।

यह कोई व्यावसायिक निर्णय नहीं देता: न तय करता है कि दस्तावेज़ अनुरूप है, न इसके अपने नियम हैं; `rules/table-ingest.yaml` जानबूझकर खाली है।

## Install

```sh
dsh plugin --profile <name> add dsh-table-ingest
dsh --profile <name> --dump-config | grep 'dsh-table-ingest'
```

## What it looks like

![Workflow diagram for dsh-table-ingest: document → rule pack → findings.](docs/assets/dsh-table-ingest-flow.svg)

*Workflow overview: document → rule pack → findings.*

**सीमा:** यह परिवर्तक है, जाँचकर्ता नहीं। यह कोई निष्कर्ष नहीं देता, दस्तावेज़ को अंक नहीं देता और पढ़ी गई फ़ाइल में कभी नहीं लिखता। जब कई तालिकाएँ समान रूप से संभावित हों तो यह उम्मीदवार लौटाकर पूछता है कि आप कौन-सी चाहते थे, क्योंकि गलत तालिका चुनने पर आगे का जाँचकर्ता ऐसी भिन्नताएँ बताता है जो मौजूद ही नहीं — एक अतिरिक्त प्रश्न से कहीं महँगा। यह बाइनरी `.doc`, स्कैन की गई छवियाँ और PDF भी नहीं पढ़ता: उनके लिए परिवर्तक या OCR चाहिए जो यह परिवार जानबूझकर नहीं रखता।

## What it answers

- इस दस्तावेज़ में वास्तव में कौन-सी तालिकाएँ हैं और प्रत्येक कितनी बड़ी है?
- कौन-सी पंक्ति शीर्षक है और स्तंभों के नाम क्या हैं?
- चुनी गई तालिका नियम चलाने लायक विश्वसनीय है, या किसी व्यक्ति को पहले पुष्टि करनी चाहिए?
- यदि कोई उपयोगी तालिका नहीं है, तो क्या दस्तावेज़ में है ही नहीं, या उसे OCR चाहिए?

## Standards it follows

यह पैकेज किसी कानूनी या नियामक खंड को कूटबद्ध नहीं करता, इसलिए इसका नियम-पैक खाली है और उद्धृत करने के लिए कोई साक्ष्य-निर्देशिका नहीं है। यह जो कूटबद्ध करता है वह है `word/document.xml` और `xl/worksheets/*.xml` की OOXML संरचना:

- संरचना के लिए `<w:tbl>`, `<w:tr>`, `<w:tc>`; क्षैतिज मर्ज के लिए `<w:gridSpan>` और "ऊपर का कक्ष जारी रखें" के लिए `<w:vMerge/>` (बिना `w:val`) — यह XML में *खाली* रहता है, इसलिए नीचे तक भरना ज़रूरी है, वरना पूरा दस्तावेज़ तिथियाँ गुम होने जैसा दिखता है।
- शीर्षक के संकेत के रूप में `<w:tblHeader>` के साथ छाया और बोल्ड; प्रारूप "शीर्षक-पंक्ति" को मानक रूप से परिभाषित नहीं करता, इसलिए पहचान एक अंकित अनुमान है और परिणाम विश्वास-स्तर के साथ बताया जाता है।
- साझा स्ट्रिंग के लिए `sharedStrings.xml` (`<v>` *सूचकांक* है, मान नहीं), इनलाइन स्ट्रिंग (`t="inlineStr"`, जिसका मान `<v>` में नहीं), और तीन-स्तरीय अप्रत्यक्षता `c@style` → `cellXfs` → `numFmtId` जो तय करती है कि कोई संख्या तिथि है या नहीं।

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
