#!/usr/bin/env python3
"""README visuals for dsh-table-ingest, derived from the shipped ingest pipeline.

Two figures, both read off the real code and the real quickstart sample:

  hero 1440x576 (Pillow, 4 files: zh/en x light/dark)
      A deck of candidate tables. The front card is the selected table for
      `samples/quickstart/input/B-tender-multi-table.docx`: 3 columns
      (评审因素 / 分值 / 评分标准), 4 data rows, confidence medium. The two
      cards behind it are the other candidates; the footer records that two
      same-header tables were merged and that three warnings were emitted.
      The left column carries the plugin name, two value lines, the five
      formats, and the read-only/offline boundary. The cell values are
      illustrative; the columns, row count, confidence and warning count come
      from the sample, not from imagination.

  flow 1100x660 (hand-written SVG, 2 files: light/dark)
      The pipeline is not a row of arrows. A document and its three readers
      sit on the left. The centre is a candidate scoreboard: every table gets
      a score, the winner is marked, and a selection guard sits directly
      below it. When the top two scores are within 20 points and no
      `expectedColumns` alias was hit, the guard drops straight down into the
      amber ok:false door, which returns `candidates[]` plus `error` instead
      of inventing a table. Otherwise the winner moves right into the header
      stage: a 3-cell header strip (the sample's three columns, translated for
      the shared five-language figure), the eight layout
      signals that `detectHeader` scores over the first six rows, and the
      resulting confidence. It then drops into the green ok:true door with
      `tableJson`, `preview` and `warnings[]`. The two doors are the actual
      two returns of `ingestToTable`; the layout is an asymmetric dual exit,
      not a five-node strip.

Every label is a real field, token or threshold from this repository:
  src/ingest/ingest.ts        candidates, tableIndex, ambiguity guard (<20)
  src/ingest/table-json.ts    rankTables / scoreTable (alias +120), detectHeader
                              (w:tblHeader 40, shading 25, bold 15, <=20 chars 10,
                              no numeric 10, lexicon <=45, next row data 20,
                              no blanks 5), confidenceOf, renderPreview
  src/config.ts               headerScanRows 6, previewRows 10, timeoutMs 60000
  README.md                   formats, merge/continuation warnings, ok:false
  samples/quickstart/...      docx, 4 rows x 3 columns, confidence medium,
                              columns 评审因素 | 分值 | 评分标准, 3 warnings

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow + Windows fonts msyh.ttc / msyhbd.ttc / consola(b).ttf.
"""
from __future__ import annotations

import argparse
import os
from html import escape

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError as exc:  # pragma: no cover - a clear failure beats a traceback
    raise SystemExit(
        "FATAL: Pillow is required to draw the hero banner. "
        "Install it (python -m pip install Pillow) and re-run.") from exc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"
for _path in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_MONO_BOLD):
    if not os.path.exists(_path):
        raise SystemExit(f"FATAL: font missing: {_path}")

RADIUS = 20
_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    key = (path, int(size))
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(path, int(size))
    return _FONT_CACHE[key]


def _hex(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# palettes
# ---------------------------------------------------------------------------
HERO_SKIN = {
    "light": dict(
        bg1="#f9f6fd", bg2="#e4eaf8",
        text="#141419", sub="#4d5261", faint="#8f94a4",
        accent="#4B67B4", accent_ink="#ffffff", accent_soft="#ece7f9", accent_wash="#f4f1fd",
        card="#ffffff", card_back1="#f1eefb", card_back2="#f6f2fc",
        edge="#e2dff0", edge_soft="#ece8f6", edge_back="#dcd5ec",
        grid="#e7e4f0", row="#fbfafe",
        green="#16a34a", green_soft="#eaf7ee",
        amber="#b45309", amber_soft="#fdf3e9",
        shadow=(27, 23, 53), shadow_alpha=58,
        glow=(75, 103, 180), glow_alpha=26,
    ),
    "dark": dict(
        bg1="#131a2a", bg2="#0c1016",
        text="#f2f3f8", sub="#a6adbf", faint="#6d7891",
        accent="#8496f5", accent_ink="#0c1016", accent_soft="#232c44", accent_wash="#1c2438",
        card="#1a2233", card_back1="#161e2f", card_back2="#182135",
        edge="#2b3448", edge_soft="#333e55", edge_back="#39445c",
        grid="#2a3346", row="#192133",
        green="#3fb950", green_soft="#16281d",
        amber="#f0a35e", amber_soft="#2a2118",
        shadow=(0, 0, 0), shadow_alpha=120,
        glow=(132, 150, 245), glow_alpha=22,
    ),
}

FLOW_SKIN = {
    "light": dict(
        bg1="#f9f6fd", bg2="#e4eaf8",
        card="#ffffff", card2="#fbfaff",
        edge="#e2dff0", edge_soft="#eeeaf7",
        text="#141419", sub="#4d5261", faint="#8f94a4",
        accent="#4B67B4", accent_soft="#ece7f9", accent_wash="#f4f1fd",
        accent_ink="#ffffff",
        green="#16a34a", green_soft="#eaf7ee",
        amber="#b45309", amber_soft="#fdf3e9", amber_edge="#e8c9a4",
        grid="#e7e4f0", dot="#e7e4f0",
        shadow=(27, 23, 53), shadow_alpha=42,
        mono_ink="#141419",
    ),
    "dark": dict(
        bg1="#131a2a", bg2="#0c1016",
        card="#1a2233", card2="#161e2f",
        edge="#2b3448", edge_soft="#252f43",
        text="#f2f3f8", sub="#a6adbf", faint="#6d7891",
        accent="#8496f5", accent_soft="#232c44", accent_wash="#1c2438",
        accent_ink="#0c1016",
        green="#3fb950", green_soft="#16281d",
        amber="#f0a35e", amber_soft="#2a2118", amber_edge="#5a4630",
        grid="#2a3346", dot="#2a3346",
        shadow=(0, 0, 0), shadow_alpha=105,
        mono_ink="#f2f3f8",
    ),
}

HERO_COPY = {
    "zh": dict(
        kicker="DSH 插件 · 结构转换",
        value1="五种格式，一次读成表格 JSON，",
        value2="选哪张、表头在哪、可信吗，都说清。",
        subtitle="多表、合并单元格、标题行，都能读；读不出就说。",
        meta="v0.2.3 · 只读 · 无网络 · 无模型调用",
        footer="PerryLink · DSH 插件家族 · Apache-2.0",
        candidate="candidate #0",
        merged="合并 2 张",
        selected="已选中",
        headers=["评审因素", "分值", "评分标准"],
        rows=[
            ["监理日志", "10", "旁站记录"],
            ["评分表", "20", "按项打分"],
            ["资质", "30", "证书有效"],
            ["合计", "60", "—"],
        ],
        confidence="置信度",
        chips=["high", "medium", "low"],
        footer_card="4 行 × 3 列 · 同表头 ×2 已合并 · warnings 3",
        top_pill="candidates[] · 3 → 1",
        out_pill="tableJson → parseTable",
        ok_pill="ok: true",
    ),
    "en": dict(
        kicker="DSH PLUGIN · STRUCTURE CONVERTER",
        value1="Five formats, one table JSON —",
        value2="which table, which header, how sure.",
        subtitle="Merged cells, title rows, many tables — never guessed.",
        meta="v0.2.3 · read-only · offline · no model call",
        footer="PerryLink · DSH plugin family · Apache-2.0",
        candidate="candidate #0",
        merged="merged ×2",
        selected="selected",
        headers=["Review item", "Score", "Criteria"],
        rows=[
            ["Site log", "10", "on-site record"],
            ["Scoring", "20", "per item"],
            ["License", "30", "valid"],
            ["Total", "60", "—"],
        ],
        confidence="confidence",
        chips=["high", "medium", "low"],
        footer_card="4 rows × 3 cols · merged ×2 · warnings 3",
        top_pill="candidates[] · 3 → 1",
        out_pill="tableJson → parseTable",
        ok_pill="ok: true",
    ),
}


# ---------------------------------------------------------------------------
# shared Pillow helpers
# ---------------------------------------------------------------------------
def _gradient(w: int, h: int, c1: str, c2: str, diagonal: float = 0.32) -> Image.Image:
    a, b = _hex(c1), _hex(c2)
    small = Image.new("RGB", (96, 96))
    px = small.load()
    for yy in range(96):
        for xx in range(96):
            t = diagonal * (xx / 95.0) + (1.0 - diagonal) * (yy / 95.0)
            px[xx, yy] = _mix(a, b, t)
    return small.resize((w, h), Image.BICUBIC).convert("RGBA")


def _glow(base: Image.Image, center: tuple[int, int], radius: int,
          color: tuple[int, int, int], alpha: int) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius),
              fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.42))
    base.alpha_composite(layer)


def _dots(base: Image.Image, color: str, alpha: int, step: int = 26) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rgb = _hex(color)
    w, h = base.size
    for y in range(14, h, step):
        for x in range(14, w, step):
            d.ellipse((x - 1.15, y - 1.15, x + 1.15, y + 1.15), fill=rgb + (alpha,))
    base.alpha_composite(layer)


def _shadow(base: Image.Image, box: tuple[int, int, int, int], radius: int,
            color: tuple[int, int, int], alpha: int, blur: int = 24,
            dy: int = 9) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((box[0], box[1] + dy, box[2], box[3] + dy),
                        radius=radius, fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(layer)


def _card(base: Image.Image, box: tuple[int, int, int, int], radius: int,
          fill: str, edge: str, width: int = 1, shadow: bool = True,
          skin: dict | None = None) -> None:
    if shadow and skin is not None:
        _shadow(base, box, radius, skin["shadow"], skin["shadow_alpha"])
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=edge, width=width)


def _text(base: Image.Image, xy: tuple[float, float], s: str,
          font: ImageFont.FreeTypeFont, fill: str, anchor: str = "ls") -> None:
    ImageDraw.Draw(base).text(xy, s, font=font, fill=fill, anchor=anchor)


def _need(base: Image.Image, s: str, font: ImageFont.FreeTypeFont,
          maxw: float, label: str) -> float:
    w = ImageDraw.Draw(base).textlength(s, font=font)
    if w > maxw:
        raise SystemExit(f"FATAL hero overflow: {label} = {w:.1f}px > {maxw:.1f}px :: {s}")
    return w


# ---------------------------------------------------------------------------
# hero: 1440 x 576
# ---------------------------------------------------------------------------
def draw_hero(lang: str, skin_name: str) -> Image.Image:
    s = HERO_SKIN[skin_name]
    c = HERO_COPY[lang]
    w, h = 1440, 576
    img = _gradient(w, h, s["bg1"], s["bg2"])
    _glow(img, (1160, 290), 360, s["glow"], s["glow_alpha"])
    _glow(img, (620, 60), 240, s["glow"], max(8, s["glow_alpha"] // 3))
    _dots(img, s["grid"], 26 if skin_name == "light" else 34)

    # left column ----------------------------------------------------------- #
    kicker_font = _font(FONT_MONO_BOLD if lang == "en" else FONT_CJK_BOLD, 24)
    title_font = _font(FONT_MONO_BOLD, 80)
    value_font = _font(FONT_CJK_BOLD, 35)
    sub_font = _font(FONT_CJK, 25)
    meta_font = _font(FONT_MONO if lang == "en" else FONT_CJK, 21)
    foot_font = _font(FONT_MONO if lang == "en" else FONT_CJK, 20)
    fmt_font = _font(FONT_MONO, 22)

    x0 = 84
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x0, 78, x0 + 6, 112), radius=3, fill=s["accent"])
    _text(img, (x0 + 22, 105), c["kicker"], kicker_font, s["accent"])

    prefix, suffix = "dsh-table-", "ingest"
    _text(img, (x0, 220), prefix, title_font, s["text"])
    _text(img, (x0 + title_font.getlength(prefix), 220), suffix, title_font, s["accent"])
    _need(img, "dsh-table-ingest", title_font, 716, "title")

    _text(img, (x0, 266), "docx · xlsx · xlsm · csv · tsv", fmt_font, s["accent"])

    _need(img, c["value1"], value_font, 716, "value1")
    _need(img, c["value2"], value_font, 716, "value2")
    _text(img, (x0, 332), c["value1"], value_font, s["text"])
    _text(img, (x0, 380), c["value2"], value_font, s["text"])
    _need(img, c["subtitle"], sub_font, 716, "subtitle")
    _text(img, (x0, 432), c["subtitle"], sub_font, s["sub"])

    # read-only dot + meta
    d.ellipse((x0, 468, x0 + 9, 477), fill=s["green"])
    _need(img, c["meta"], meta_font, 690, "meta")
    _text(img, (x0 + 19, 480), c["meta"], meta_font, s["sub"])

    d.line((x0, 512, 770, 512), fill=s["edge"], width=1)
    _need(img, c["footer"], foot_font, 690, "footer")
    _text(img, (x0, 544), c["footer"], foot_font, s["faint"])

    # right: a deck of candidate tables ------------------------------------- #
    back2 = (930, 92, 1392, 432)
    back1 = (886, 120, 1348, 460)
    front = (840, 154, 1306, 500)

    _card(img, back2, 22, s["card_back1"], s["edge_back"], width=1, skin=s)
    _card(img, back1, 22, s["card_back2"], s["edge_back"], width=1, skin=s)

    # paper lines on the exposed top strips of the two back cards
    bd = ImageDraw.Draw(img)
    for bx, by in ((back2[0] + 26, back2[1] + 26), (back1[0] + 26, back1[1] + 22)):
        for i in range(3):
            bd.rounded_rectangle((bx + i * 84, by, bx + i * 84 + 58, by + 5),
                                 radius=2.5, fill=s["grid"])

    # #2 / #1 tags on the back cards
    tag_font = _font(FONT_MONO_BOLD, 14)
    for box, label in ((back2, "#2"), (back1, "#1")):
        tx, ty = box[2] - 50, box[1] + 14
        bd.rounded_rectangle((tx, ty, tx + 36, ty + 22), radius=11,
                             fill=s["card"], outline=s["edge"], width=1)
        _text(img, (tx + 18, ty + 16), label, tag_font, s["faint"], anchor="ms")

    # front card
    _card(img, front, 22, s["card"], s["edge"], width=2, shadow=True, skin=s)

    nfont = _font(FONT_MONO_BOLD, 20)
    _text(img, (862, 183), c["candidate"], nfont, s["text"])

    mfont = _font(FONT_CJK_BOLD, 14)
    mw = mfont.getlength(c["merged"]) + 24
    bd.rounded_rectangle((1016, 162, 1016 + mw, 188), radius=13,
                         fill=s["accent_soft"], outline=s["accent"], width=1)
    _text(img, (1016 + mw / 2, 179), c["merged"], mfont, s["accent"], anchor="ms")

    # selected check
    chk = _font(FONT_CJK_BOLD, 16)
    _text(img, (1234, 181), c["selected"], chk, s["green"], anchor="rs")
    bd.ellipse((1250, 165, 1274, 189), outline=s["green"], width=2)
    bd.line((1256, 177, 1261, 182, 1269, 172), fill=s["green"], width=2, joint="curve")

    # table ---------------------------------------------------------------- #
    tx, ty, tw = 862, 202, 422
    head_h, row_h = 42, 37
    col_w = [176, 68, 178]
    hfont = _font(FONT_CJK_BOLD, 21)
    cell_font = _font(FONT_CJK, 19)
    num_font = _font(FONT_MONO, 19)
    bd.rounded_rectangle((tx, ty, tx + tw, ty + head_h), radius=8, fill=s["accent"])
    bd.rectangle((tx, ty + head_h - 8, tx + tw, ty + head_h), fill=s["accent"])
    cx = tx
    for i, name in enumerate(c["headers"]):
        _text(img, (cx + col_w[i] / 2, ty + 27), name, hfont, s["accent_ink"], anchor="ms")
        if i < 2:
            bd.line((cx + col_w[i], ty + 8, cx + col_w[i], ty + head_h - 8),
                    fill=s["card"], width=1)
        cx += col_w[i]

    for r, row in enumerate(c["rows"]):
        ry = ty + head_h + r * row_h
        if r % 2 == 1:
            bd.rectangle((tx, ry, tx + tw, ry + row_h), fill=s["row"])
        bd.line((tx, ry + row_h, tx + tw, ry + row_h), fill=s["grid"], width=1)
        cx = tx
        for i, value in enumerate(row):
            fnt = num_font if i == 1 else cell_font
            anchor = "ms" if i == 1 else "ls"
            px = cx + col_w[i] / 2 if i == 1 else cx + 12
            _text(img, (px, ry + 25), value, fnt, s["text"], anchor=anchor)
            cx += col_w[i]
    bd.line((tx, ty, tx, ty + head_h + row_h * len(c["rows"])), fill=s["grid"], width=1)
    bd.line((tx + tw, ty, tx + tw, ty + head_h + row_h * len(c["rows"])), fill=s["grid"], width=1)

    # confidence meter
    lab_font = _font(FONT_CJK, 15)
    _text(img, (862, 421), c["confidence"], lab_font, s["faint"])
    chips = c["chips"]
    chip_font = _font(FONT_MONO, 14)
    positions = [(976, 64), (1048, 78), (1134, 56)]
    for i, (label, (px, cw)) in enumerate(zip(chips, positions)):
        fill = s["amber_soft"] if i == 1 else None
        edge = s["amber"] if i == 1 else s["edge"]
        txtc = s["amber"] if i == 1 else s["faint"]
        bd.rounded_rectangle((px, 403, px + cw, 431), radius=14,
                             fill=fill, outline=edge, width=1)
        _text(img, (px + cw / 2, 421), label, chip_font, txtc, anchor="ms")

    bd.line((862, 444, 1284, 444), fill=s["grid"], width=1)
    ff = _font(FONT_MONO if lang == "en" else FONT_CJK, 16)
    _text(img, (862, 474), c["footer_card"], ff, s["sub"])

    # floating pills ------------------------------------------------------- #
    top_font = _font(FONT_MONO_BOLD, 17)
    top_w = 292
    bd.rounded_rectangle((1396 - top_w, 54, 1396, 90), radius=18,
                         fill=s["card"], outline=s["edge"], width=1)
    bd.ellipse((1396 - top_w + 18, 67, 1396 - top_w + 28, 77), fill=s["accent"])
    _text(img, (1396 - top_w + 40, 76), c["top_pill"], top_font, s["text"])

    out_font = _font(FONT_MONO_BOLD, 17)
    bd.rounded_rectangle((840, 514, 1120, 550), radius=18,
                         fill=s["card"], outline=s["edge"], width=1)
    _text(img, (857, 536), c["out_pill"], out_font, s["accent"])

    ok_w = 126
    bd.rounded_rectangle((1262 - ok_w, 514, 1262, 550), radius=18,
                         fill=s["green_soft"], outline=s["green"], width=1)
    _text(img, (1262 - ok_w / 2, 536), c["ok_pill"], out_font, s["green"], anchor="ms")

    return img


# ---------------------------------------------------------------------------
# flow: 1100 x 660, hand-written SVG
# ---------------------------------------------------------------------------
SANS = "'Microsoft YaHei','Segoe UI','Noto Sans CJK SC',sans-serif"
MONO = "Consolas,'Cascadia Mono','SFMono-Regular',ui-monospace,monospace"


class Fig:
    def __init__(self, skin_name: str) -> None:
        self.skin_name = skin_name
        self.s = FLOW_SKIN[skin_name]
        self.parts: list[str] = []
        self.overflows: list[str] = []

    # -- primitives ------------------------------------------------------- #
    def add(self, raw: str) -> None:
        self.parts.append(raw)

    def _width(self, text: str, size: float, mono: bool, bold: bool) -> float:
        base = FONT_MONO if mono else FONT_CJK
        if bold:
            base = FONT_MONO_BOLD if mono else FONT_CJK_BOLD
        return _font(base, max(1, int(round(size)))).getlength(text)

    def text(self, x: float, y: float, text: str, size: float = 13,
             fill: str | None = None, bold: bool = False, mono: bool = False,
             anchor: str = "start", opacity: float | None = None) -> None:
        fill = self.s["text"] if fill is None else fill
        weight = ' font-weight="700"' if bold else ""
        op = f' opacity="{opacity}"' if opacity is not None else ""
        family = MONO if mono else SANS
        anchor_attr = ' text-anchor="middle"' if anchor == "middle" else (
            ' text-anchor="end"' if anchor == "end" else "")
        width = self._width(text, size, mono, bold)
        left = x - (width / 2 if anchor == "middle" else width if anchor == "end" else 0)
        right = left + width
        if left < 8 or right > 1100 - 8:
            self.overflows.append(
                f"{text!r} size={size} x={x} span=({left:.0f},{right:.0f})")
        self.add(
            f'<text x="{x}" y="{y}" fill="{fill}" font-family="{family}" '
            f'font-size="{size}"{weight}{anchor_attr}{op}>{escape(text)}</text>')

    def rect(self, x: float, y: float, w: float, h: float, r: float = 0,
             fill: str = "none", stroke: str | None = None, sw: float = 1,
             dash: str | None = None, opacity: float | None = None,
             shadow: bool = False) -> None:
        attrs = [f'x="{x}"', f'y="{y}"', f'width="{w}"', f'height="{h}"']
        if r:
            attrs.append(f'rx="{r}"')
        attrs.append(f'fill="{fill}"')
        if stroke:
            attrs.append(f'stroke="{stroke}" stroke-width="{sw}"')
        if dash:
            attrs.append(f'stroke-dasharray="{dash}"')
        if opacity is not None:
            attrs.append(f'opacity="{opacity}"')
        raw = f'<rect {" ".join(attrs)}/>'
        if shadow:
            raw = f'<g filter="url(#soft)">{raw}</g>'
        self.add(raw)

    def line(self, x1: float, y1: float, x2: float, y2: float,
             color: str | None = None, sw: float = 1.2,
             dash: str | None = None, marker: str | None = None,
             opacity: float | None = None) -> None:
        color = self.s["edge"] if color is None else color
        attrs = [f'x1="{x1}"', f'y1="{y1}"', f'x2="{x2}"', f'y2="{y2}"',
                 f'stroke="{color}"', f'stroke-width="{sw}"']
        if dash:
            attrs.append(f'stroke-dasharray="{dash}"')
        if marker:
            attrs.append(f'marker-end="url(#{marker})"')
        if opacity is not None:
            attrs.append(f'opacity="{opacity}"')
        self.add(f'<line {" ".join(attrs)}/>')

    def path(self, d: str, color: str, sw: float = 2,
             dash: str | None = None, marker: str | None = None) -> None:
        attrs = [f'd="{d}"', f'fill="none"', f'stroke="{color}"',
                 f'stroke-width="{sw}"', 'stroke-linecap="round"',
                 'stroke-linejoin="round"']
        if dash:
            attrs.append(f'stroke-dasharray="{dash}"')
        if marker:
            attrs.append(f'marker-end="url(#{marker})"')
        self.add(f'<path {" ".join(attrs)}/>')

    def pill(self, x: float, y: float, w: float, h: float, label: str,
             fill: str, edge: str, ink: str, size: float = 12,
             mono: bool = True, bold: bool = True) -> None:
        self.rect(x, y, w, h, r=h / 2, fill=fill, stroke=edge, sw=1)
        self.text(x + w / 2, y + h / 2 + size * 0.36, label, size=size,
                  fill=ink, mono=mono, bold=bold, anchor="middle")

    # -- composite -------------------------------------------------------- #
    def card(self, x: float, y: float, w: float, h: float, r: float = 18,
             fill: str | None = None, edge: str | None = None, sw: float = 1.4,
             shadow: bool = True, dash: str | None = None) -> None:
        self.rect(x, y, w, h, r=r, fill=fill or self.s["card"],
                  stroke=edge or self.s["edge"], sw=sw, dash=dash, shadow=shadow)

    def section(self, x: float, y: float, num: str, label: str, width: float = 260) -> None:
        self.text(x, y, num, size=12, fill=self.s["accent"], mono=True, bold=True)
        self.text(x + 34, y, f"· {label}", size=12, fill=self.s["sub"], mono=True, bold=True)
        self.line(x, y + 7, x + width, y + 7, color=self.s["edge_soft"], sw=1)

    def mini_table(self, x: float, y: float, w: float, rows: int,
                   header_fill: str, grid: str, cell_bg: str,
                   dash_header: bool = False) -> None:
        head_h = 13
        row_h = 10
        h = head_h + rows * row_h
        self.rect(x, y, w, head_h, r=2.5, fill=header_fill)
        if dash_header:
            self.line(x, y + head_h, x + w, y + head_h, color=grid, sw=1, dash="3 4")
        for r in range(rows):
            ry = y + head_h + r * row_h
            if r % 2 == 1:
                self.rect(x, ry, w, row_h, fill=cell_bg, opacity=0.55)
            self.line(x, ry + row_h, x + w, ry + row_h, color=grid, sw=0.8)
        for i in range(1, 3):
            self.line(x + w * i / 3, y, x + w * i / 3, y + h, color=grid, sw=0.8)
        # tiny content bars, not text: the table is a document, not a quote
        for r in range(rows):
            for cidx in range(3):
                bx = x + w * cidx / 3 + 5
                by = y + head_h + r * row_h + 4
                bw = w / 3 * (0.42 if cidx == 1 else 0.58)
                self.rect(bx, by, bw, 2.4, r=1.2, fill=grid, opacity=0.95)

    def build(self) -> str:
        if self.overflows:
            raise SystemExit("FATAL flow text overflow:\n  " + "\n  ".join(self.overflows))
        return "\n".join(self.parts) + "\n"


def flow_svg(skin_name: str) -> str:
    f = Fig(skin_name)
    s = f.s
    W, H = 1100, 660
    f.add(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" aria-labelledby="figTitle figDesc">')
    f.add(
        '<title id="figTitle">dsh-table-ingest structure: one file, ranked '
        'candidates, a header decision, and two honest exits</title>')
    f.add(
        '<desc id="figDesc">A docx with two same-header tables is read by the '
        'format readers. The centre scoreboard ranks every candidate table; a '
        'selection guard sends the ambiguous case straight down to the amber '
        'ok:false door, which returns candidates[] and error instead of '
        'guessing. A clear winner moves right into header detection over the '
        'first six rows, then down into the green ok:true door with tableJson, '
        'preview and warnings. Both doors are returns of ingestToTable.</desc>')
    f.add('<defs>')
    f.add(
        f'<linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">'
        f'<stop offset="0" stop-color="{s["bg1"]}"/>'
        f'<stop offset="1" stop-color="{s["bg2"]}"/></linearGradient>')
    f.add(
        f'<filter id="soft" x="-30%" y="-30%" width="170%" height="185%">'
        f'<feDropShadow dx="0" dy="7" stdDeviation="10" '
        f'flood-color="{"#1b1735" if skin_name == "light" else "#000000"}" '
        f'flood-opacity="{0.13 if skin_name == "light" else 0.45}"/></filter>')
    f.add(
        f'<pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">'
        f'<circle cx="1.2" cy="1.2" r="1.2" fill="{s["dot"]}"/></pattern>')
    for name, color in (("arr", s["accent"]), ("arramber", s["amber"]),
                        ("arrfaint", s["faint"])):
        f.add(
            f'<marker id="{name}" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="6.4" markerHeight="6.4" orient="auto-start-reverse">'
            f'<path d="M0 0 L10 5 L0 10 z" fill="{color}"/></marker>')
    f.add('</defs>')
    f.add(f'<rect width="{W}" height="{H}" rx="22" fill="url(#bg)"/>')
    f.add(f'<rect width="{W}" height="{H}" rx="22" fill="url(#dots)" opacity=".5"/>')

    # header --------------------------------------------------------------- #
    f.text(44, 58, "dsh-table-ingest", size=29, mono=True, bold=True)
    f.text(44, 88,
           "5 formats → 3 readers → ranked candidates → header → tableJson · "
           "when unsure, it says so", size=14.5, fill=s["sub"])
    f.text(1056, 52, "read-only · offline · no model call", size=12,
           fill=s["faint"], mono=True, anchor="end")
    f.text(1056, 74, "headerScanRows 6 · previewRows 10", size=12,
           fill=s["faint"], mono=True, anchor="end")
    f.line(44, 102, 1056, 102, color=s["edge"], sw=1.2)

    # left: one document, three readers ------------------------------------ #
    f.section(36, 130, "01", "INGEST")
    f.card(36, 142, 260, 182, r=18)
    f.text(52, 168, "B-tender-multi-table.docx", size=13, mono=True, bold=True)
    f.text(52, 186, "docx · 2 × w:tbl · 1 title paragraph", size=11, fill=s["sub"])
    f.text(52, 208, "table 1", size=11, fill=s["faint"], mono=True)
    f.mini_table(52, 214, 228, 3, s["accent"], s["grid"], s["accent_wash"])
    f.text(52, 272, "table 2 · same header → merged", size=11, fill=s["amber"], mono=True)
    f.mini_table(52, 278, 228, 1, s["accent"], s["grid"], s["accent_wash"],
                 dash_header=True)
    f.line(286, 214, 286, 288, color=s["amber"], sw=1.1, dash="3 4")
    f.line(280, 214, 286, 214, color=s["amber"], sw=1.1)
    f.line(280, 288, 286, 288, color=s["amber"], sw=1.1)
    f.text(52, 314, "read-only · original never modified", size=11, fill=s["faint"])

    f.card(36, 336, 260, 148, r=18)
    f.text(52, 356, "format readers", size=13, bold=True)
    f.text(52, 374, "one path · five formats", size=11, fill=s["sub"])
    readers = [
        ("docx", "w:tbl · gridSpan · vMerge"),
        ("xlsx / xlsm", "sharedStrings · cellXfs"),
        ("csv / tsv", "RFC 4180 · GB18030"),
    ]
    for i, (name, detail) in enumerate(readers):
        y = 400 + i * 26
        f.add(f'<circle cx="55" cy="{y - 3}" r="2.4" fill="{s["accent"]}"/>')
        f.text(66, y, name, size=13, bold=True)
        detail_x = (112, 150, 132)[i]
        f.text(detail_x, y, detail, size=11, fill=s["sub"], mono=True)
    f.text(52, 472, "values stay strings · zeros kept", size=11, fill=s["faint"])

    # centre: candidate scoreboard and guard ------------------------------- #
    f.section(320, 130, "02", "CANDIDATES", 396)
    f.card(320, 142, 396, 250, r=18)
    f.text(336, 168, "candidates[] · rankTables", size=13, bold=True)
    f.text(700, 168, "ranked by score", size=11.5, fill=s["faint"], mono=True, anchor="end")
    f.text(336, 186, "several tables, no guess", size=11, fill=s["sub"])

    candidates = [
        ("#0", "table 0 · merged continuation", "4 rows × 3 cols · header row 1", 82, True),
        ("#1", "table 1", "6 rows × 4 cols · header row 2", 45, False),
        ("#2", "table 2", "2 rows × 2 cols · header not found", 20, False),
    ]
    for i, (idx, name, meta, bar, chosen) in enumerate(candidates):
        y = 198 + i * 60
        if chosen:
            f.rect(332, y, 372, 54, r=13, fill=s["accent_wash"], stroke=s["accent"], sw=1.4)
        else:
            f.rect(332, y, 372, 54, r=13, fill=s["card2"], stroke=s["edge_soft"], sw=1)
        f.text(346, y + 22, idx, size=12.5, mono=True, bold=True,
               fill=s["accent"] if chosen else s["faint"])
        f.text(372, y + 20, name, size=13, bold=True,
               fill=s["text"] if chosen else s["sub"])
        f.text(372, y + 40, meta, size=11.5, fill=s["sub"] if chosen else s["faint"])
        f.rect(610, y + 30, 80, 8, r=4, fill=s["grid"])
        f.rect(610, y + 30, 80 * bar / 100, 8, r=4,
               fill=s["accent"] if chosen else s["faint"])
        if chosen:
            f.pill(610, y + 8, 58, 18, "selected", s["green_soft"], s["green"], s["green"],
                   size=11)
        else:
            f.text(610, y + 20, "score", size=11, fill=s["faint"], mono=True)
    f.text(336, 384, "same header across a page break → merged first", size=11, fill=s["faint"])

    f.card(320, 404, 396, 64, r=16, edge=s["amber_edge"], sw=1.4)
    f.add(f'<circle cx="336" cy="424" r="3.2" fill="{s["amber"]}"/>')
    f.text(346, 429, "selection guard", size=13, bold=True, fill=s["amber"])
    f.text(336, 447, "top1 − top2 < 20 and no expectedColumns hit → no choice",
           size=11.5, fill=s["sub"])
    f.text(336, 463, "expectedColumns hit → +120 per column", size=11.5, fill=s["sub"])

    # success path
    f.line(296, 260, 316, 260, color=s["accent"], sw=2.2, marker="arr")
    f.line(716, 260, 734, 260, color=s["accent"], sw=2.2, marker="arr")
    f.path("M518 468 V484", s["amber"], sw=2, marker="arramber")
    f.text(526, 482, "ambiguous", size=11, fill=s["amber"], mono=True)

    # right: header detection and ok:true exit ------------------------------ #
    f.section(736, 130, "03", "HEADER", 328)
    f.card(736, 142, 328, 334, r=18)
    f.text(752, 168, "headerRow · detectHeader", size=13, bold=True)
    f.text(1048, 168, "first 6 rows", size=11, fill=s["faint"], mono=True, anchor="end")
    f.text(752, 186, "chosen table · headerRow 1", size=11, fill=s["sub"])

    hx, hy, hw = 752, 196, 296
    colw = [150, 56, 90]
    f.rect(hx, hy, hw, 40, r=7, fill=s["accent"])
    f.rect(hx, hy + 32, hw, 8, fill=s["accent"])
    cx = hx
    for i, label in enumerate(("Review item", "Score", "Criteria")):
        f.text(cx + colw[i] / 2, hy + 26, label, size=13.5, bold=True,
               fill=s["accent_ink"], anchor="middle")
        if i < 2:
            f.line(cx + colw[i], hy + 7, cx + colw[i], hy + 33, color=s["card"], sw=1)
        cx += colw[i]
    f.text(752, 252, "scan rows 1–6 · headerScanRows 6", size=11, fill=s["faint"], mono=True)

    signals_left = [
        ("w:tblHeader", "+40"),
        ("row shaded", "+25"),
        ("row bold", "+15"),
        ("cells ≤20 chars", "+10"),
    ]
    signals_right = [
        ("no numeric cell", "+10"),
        ("lexicon hit", "≤+45"),
        ("next row is data", "+20"),
        ("no blank cells", "+5"),
    ]
    for col, items in ((0, signals_left), (1, signals_right)):
        bx = 752 + col * 156
        for i, (label, points) in enumerate(items):
            y = 276 + i * 24
            f.add(f'<circle cx="{bx + 4}" cy="{y - 4}" r="2" fill="{s["accent"]}"/>')
            f.text(bx + 12, y, label, size=12, fill=s["sub"])
            f.text(bx + 134, y, points, size=11.5, fill=s["accent"], mono=True, anchor="end")
    f.line(752, 374, 1048, 374, color=s["edge_soft"], sw=1)
    f.text(752, 398, "confidence", size=12, fill=s["sub"])
    f.pill(828, 382, 88, 26, "medium", s["amber_soft"], s["amber"],
           s["amber"], size=12, mono=False)
    f.text(752, 426, "score ≥60 + alias hit → high", size=11, fill=s["faint"])
    f.text(752, 444, "else medium / low · low = a human should look", size=11,
           fill=s["faint"])
    f.line(900, 476, 900, 490, color=s["accent"], sw=2.2, marker="arr")

    # two exits ------------------------------------------------------------ #
    f.card(36, 492, 676, 142, r=20, edge=s["amber_edge"], sw=1.5)
    f.text(52, 520, "when no single table is certain → ok:false", size=14, bold=True,
           fill=s["amber"])
    f.text(52, 540,
           "returns the candidates and the reason; never fabricates a table",
           size=12, fill=s["sub"])
    exits = [
        ("candidates[]", "rows × cols · header row · caption", 52),
        ("error", "names tableIndex · no table found", 264),
        ("override", "tableIndex · expectedColumns", 476),
    ]
    for label, detail, ex in exits:
        f.rect(ex, 552, 200 if ex != 476 else 220, 64, r=12,
               fill=s["amber_soft"], stroke=s["amber_edge"], sw=1)
        f.text(ex + 14, 574, label, size=12, mono=True, bold=True, fill=s["amber"])
        f.text(ex + 14, 594, detail, size=11, fill=s["sub"])

    f.card(736, 492, 328, 142, r=20, edge=s["green"], sw=1.5)
    f.text(752, 518, "tableJson → parseTable", size=13, bold=True)
    f.pill(976, 500, 72, 22, "ok: true", s["green_soft"], s["green"], s["green"],
           size=11)
    f.text(752, 544, "columns: Review item · Score · Criteria", size=11.5,
           fill=s["sub"], mono=True)
    f.text(752, 564, "rows: 4 · headerRows: [1] · warnings: 3", size=11.5,
           fill=s["sub"], mono=True)
    f.text(752, 584, "preview: is this the table you meant?", size=11.5,
           fill=s["text"], mono=True)
    f.text(752, 612, "confidence medium · 3 warnings", size=11, fill=s["faint"])

    f.add('</svg>')
    return f.build()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=("hero", "flow"), default=None,
                        help="generate one figure family only")
    args = parser.parse_args()

    os.makedirs(OUT, exist_ok=True)
    if args.only in (None, "hero"):
        for lang in ("zh", "en"):
            for skin in ("light", "dark"):
                img = draw_hero(lang, skin)
                path = os.path.join(
                    OUT, f"dsh-table-ingest-hero-{lang}-{skin}.webp")
                img.convert("RGB").save(path, "WEBP", quality=90, method=6)
                print(f"wrote {os.path.relpath(path, ROOT)}")
    if args.only in (None, "flow"):
        for skin in ("light", "dark"):
            path = os.path.join(
                OUT, f"dsh-table-ingest-flow-v5-{skin}.svg")
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(flow_svg(skin))
            print(f"wrote {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
