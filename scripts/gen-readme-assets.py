#!/usr/bin/env python3
"""Generate README image assets for dsh-table-ingest (docs/assets/).

Outputs (idempotent overwrite):
  dsh-table-ingest-flow-light.svg / dsh-table-ingest-flow-dark.svg
      Hero pipeline diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is command-surface tokens only
      (table_ingest, candidates[], tableJson, headerScanRows, ...), so all
      five README languages share the same pair.

This plugin has no UI and no benchmark data, so there is no screenshot to
process and no evidence chart to draw. The older single-skin assets
(dsh-table-ingest-flow.svg, -hero.png, -demo.gif, quickstart.png) are kept
untouched for external deep links; the READMEs reference only the new pair.

Run once:  python scripts/gen-readme-assets.py
Requires:  nothing beyond the standard library (the CJK font probe stays for
           parity with the family pipeline, so a localized bitmap added later
           fails loudly instead of rendering tofu boxes)
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e"),
}

# --- CJK font probe: kept for parity with the family pipeline --------------
# The SVGs below carry command tokens only (ASCII), so no CJK font is needed
# for them; the probe stays so that adding a localized bitmap later fails
# loudly instead of rendering tofu boxes.
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")


# ---------------------------------------------------------------------------
# 1. Hero pipeline SVG (light + dark)
# ---------------------------------------------------------------------------
# The pipeline is the one src/ingest/ actually runs: a file is sniffed by
# format, read by the format-specific OOXML/delimited reader, ranked into
# candidates, given a header row with a confidence level, then emitted as the
# tableJson a downstream rule checker consumes.
FLOW_NODES = [
    ("file", ".docx · .xlsx · .csv"),
    ("readers", "w:tbl · sharedStrings"),
    ("candidates[]", "tableIndex · expectedColumns"),
    ("headerRow", "headerScanRows · confidence"),
    ("tableJson", "parseTable-ready"),
]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 400
    nw, nh, gap = 180, 96, 45
    y0 = 150
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" aria-label="dsh-table-ingest '
        f'pipeline">',
        f'<title>dsh-table-ingest pipeline</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="62" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">'
        f'dsh-table-ingest</text>',
        f'<text x="60" y="94" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="16">docx / xlsx / csv &#8594; table JSON · '
        f'refuses to guess</text>',
        f'<line x1="60" y1="116" x2="1140" y2="116" stroke="{s["border"]}"/>',
    ]
    for i, (label, sub) in enumerate(FLOW_NODES):
        x = 60 + i * (nw + gap)
        accent = GREEN[skin] if i == len(FLOW_NODES) - 1 else (
            FAMILY if i == 1 else s["border"])
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 40}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="16" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 68}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="11">{sub}</text>')
        if i < len(FLOW_NODES) - 1:
            ax = x + nw + 6
            ay = y0 + nh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{gap - 12}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + gap - 14} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
    # config bar under nodes 2..4 (readers / candidates / headerRow)
    bx, bw, by, bh = 285, 715, 285, 52
    for cx in (375, 600, 825):  # node2 / node3 / node4 center-bottom connectors
        parts.append(
            f'<path d="M{cx} {y0 + nh}v{by - y0 - nh}" '
            f'stroke="{FAMILY}" stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="12" '
        f'fill="{s["box"]}" stroke="{FAMILY}" stroke-width="2"/>')
    parts.append(
        f'<text x="{bx + bw // 2}" y="{by + 33}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="14">config · timeoutMs · headerScanRows · previewRows'
        f'</text>')
    parts.append(
        f'<text x="60" y="378" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="13">ok:false + candidates[] instead of a '
        f'guess · warnings[] + error · zip limits 256 entries / 8 MiB per '
        f'entry / 32 MiB total</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(
                OUT, f"dsh-table-ingest-flow-{skin}.svg"),
                "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    print("wrote 2 SVG assets to docs/assets/")


if __name__ == "__main__":
    main()
