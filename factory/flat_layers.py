"""옷만 찍힌 상품 사진 → 배경 제거 → 고정 마네킹의 정해진 자리에 얹은 레이어 PNG. AI 생성 없음 (종이 인형 방식).

실제 질감·주름·입은 느낌은 목표가 아니다. "그 옷들을 마음대로 조합해 보기"가 목표.
시스템 python3(Pillow, numpy)만으로 돈다.

  python3 flat_layers.py --mannequin in-sample/flat/mannequin.png --items in-sample/flat/items.json --out out/flat-test

- 마네킹 기준선(어깨·허리·골반·발목)은 실루엣에서 자동으로 재서 <out>/anchors.json 에 저장한다.
  어긋나면 그 파일을 고쳐 --anchors 로 넘기면 된다.
- 상품별 미세 조정: items.json 의 상품에 "fit": {"dx": 0, "dy": 0, "scale": 1.0} (dx·dy는 마네킹 높이 대비 비율)
- 결과 형식은 make_layers.py 와 같다 (model.png, layers/, images/, catalog.json) → --publish 로 앱에 바로 반영.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
WORK_SIDE = 1200  # 배경 제거 작업 해상도 (긴 변)

# 카테고리별 맞춤 규칙: 옷의 어느 폭을 마네킹의 어느 폭에 맞추고, 어느 높이를 어디에 맞출지
#   width: (옷에서 잴 높이 구간 비율, 마네킹 기준 폭, 여유 배율)
#   align: (옷의 기준 높이, 마네킹 기준선)
RULES = {
    "top": dict(width=((0.55, 0.85), "chest", 1.15), align=("top", "collar")),
    "outer": dict(width=((0.55, 0.85), "chest", 1.30), align=("top", "collar")),
    "bottom": dict(width=((0.02, 0.10), "band", 1.12), align=("top", "band")),
    "dress": dict(width=("narrow", "waist", 1.15), align=("narrow", "waist")),
}


# ---------- 배경 제거 ----------

def _grow(seed: np.ndarray, allowed: np.ndarray) -> np.ndarray:
    """seed에서 allowed 안으로 이어진 영역 전체 (4방향). scipy 없이 반복 팽창."""
    cur = seed & allowed
    while True:
        prev = cur
        for _ in range(16):
            nxt = cur.copy()
            nxt[1:] |= cur[:-1]
            nxt[:-1] |= cur[1:]
            nxt[:, 1:] |= cur[:, :-1]
            nxt[:, :-1] |= cur[:, 1:]
            cur = nxt & allowed
        if np.array_equal(cur, prev):
            return cur


def _border(shape: tuple[int, int], k: int) -> np.ndarray:
    b = np.zeros(shape, bool)
    b[:k], b[-k:], b[:, :k], b[:, -k:] = True, True, True, True
    return b


def _foreground(img: Image.Image, shadows: bool = True):
    """작업 해상도로 줄인 뒤, 테두리와 이어진 배경색 영역을 뺀 전경 마스크. (배열, 전경, 배경색, 허용치, 거리, 축소비)"""
    img = img.convert("RGB")
    f = min(1.0, WORK_SIDE / max(img.size))
    if f < 1.0:
        img = img.resize((round(img.width * f), round(img.height * f)), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    band = _border((h, w), max(2, int(min(h, w) * 0.02)))
    bg = np.median(a[band], axis=0)
    dist = np.linalg.norm(a - bg, axis=2)
    noise = float(np.percentile(dist[band], 90))
    tol = max(10.0, noise * 1.8 + 4)  # 배경 얼룩·그라데이션만큼 여유
    background = _grow(band, dist < tol)
    if shadows:
        # 바닥 그림자: 배경과 같은 무채색인데 조금 어둡고, 결(무늬·주름)이 거의 없는 매끈한 영역 → 배경에 붙어 있으면 배경으로
        lum = a.mean(axis=2)
        chroma = a.max(axis=2) - a.min(axis=2)
        gy, gx = np.gradient(lum)
        tex = np.asarray(Image.fromarray(np.clip(np.hypot(gx, gy) * 20, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3))) / 20.0
        bg_l, bg_c = float(bg.mean()), float(bg.max() - bg.min())
        shadow = (chroma < bg_c + 8) & (lum < bg_l - 4) & (lum > bg_l - 70) & (tex < 1.2) & (dist >= tol)
        background = _grow(background, background | shadow)
    return a, ~background, bg, tol, dist, f


def _remove_dress_form(a: np.ndarray, fg: np.ndarray, max_dist: float = 45.0) -> tuple[np.ndarray, float]:
    """상품컷이 크림색 상반신 마네킹(토르소)에 입혀 찍힌 경우, 옷 위쪽 가운데(목)에서 토르소 색을 재고
    그 색에 가깝고 매끈하며 배경에 닿아 있는 영역(목·어깨·골반)을 지운다. 토르소가 없으면 그대로."""
    ys, xs = np.nonzero(fg)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    cx, hh, ww = (x0 + x1) // 2, y1 - y0, x1 - x0
    sl = (slice(y0 + int(hh * 0.01), y0 + int(hh * 0.06) + 1), slice(cx - int(ww * 0.05), cx + int(ww * 0.05) + 1))
    patch, pm = a[sl], fg[sl]
    if pm.mean() < 0.8:
        return fg, 0.0
    c = np.median(patch[pm], axis=0)
    r, g, b = c
    if not (c.mean() > 195 and 8 <= r - b <= 40 and r >= g >= b):  # 따뜻한 크림색이 아니면 토르소 아님
        return fg, 0.0
    # 토르소는 천(린넨) 결과 그늘이 있어 매끈함으로는 못 고른다 → 색(따뜻한 크림)과 토르소 색과의 거리로
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    warm = (R >= G - 2) & (G >= B - 2) & (R - B >= 5) & (R - B <= 45) & (a.mean(axis=2) > 140)
    cand = fg & warm & (np.linalg.norm(a - c, axis=2) < max_dist)
    touch = np.zeros_like(fg)
    bgm = ~fg
    touch[1:] |= bgm[:-1]
    touch[:-1] |= bgm[1:]
    touch[:, 1:] |= bgm[:, :-1]
    touch[:, :-1] |= bgm[:, 1:]
    form = _grow(cand & touch, cand)
    return fg & ~form, float(form.sum()) / max(1, fg.sum())


def cut_garment(img: Image.Image) -> tuple[Image.Image, dict]:
    """단색에 가까운 배경을 테두리에서부터 지운다. 옷과 떨어진 글자·치수 표시 등 작은 조각은 버린다."""
    a, fg, bg, tol, dist, _ = _foreground(img)
    fg, form = _remove_dress_form(a, fg)
    # 가장 큰 덩어리(옷)만: 가운데 근처 전경에서 키운다
    ys, xs = np.nonzero(fg)
    if len(ys) == 0:
        raise ValueError("옷을 찾지 못함 (배경과 구분이 안 됨)")
    # 가운데에서 가까운 덩어리부터 키워 보고, 가장 큰 덩어리를 옷으로 (바지는 가운데가 두 다리 사이 빈 곳일 수 있다)
    cy, cx = np.median(ys), np.median(xs)
    main, rest = np.zeros_like(fg), fg.copy()
    for _ in range(8):
        ys, xs = np.nonzero(rest)
        if len(ys) == 0:
            break
        seed = np.zeros_like(fg)
        k = np.argmin((ys - cy) ** 2 + (xs - cx) ** 2)
        seed[ys[k], xs[k]] = True
        comp = _grow(seed, fg)
        if comp.sum() > main.sum():
            main = comp
        rest &= ~comp
        if main.sum() >= 0.5 * fg.sum():
            break
    dropped = float((fg & ~main).sum()) / max(1, fg.sum())
    # 옷 안쪽 구멍(목둘레·트임 사이로 보이는 배경): 배경색과 거의 같은 넓은 영역만 지운다.
    # 15px 정사각형이 통째로 들어가는 영역만 남겨서 시작 → 로고 글자·작은 흰 무늬는 남는다
    hole = main & (dist < tol * 0.8)
    h8 = Image.fromarray(hole.astype(np.uint8) * 255)
    core = np.asarray(h8.filter(ImageFilter.MinFilter(15)).filter(ImageFilter.MaxFilter(15))) > 0
    holes = _grow(core & hole, hole) if core.any() else np.zeros_like(hole)
    main &= ~holes
    # 가장자리: 경계 픽셀에는 배경색이 섞여 있어 다른 옷·마네킹 위에서 흰 테두리로 보인다
    # → 2px 안쪽으로 줄인 뒤 1px 정도 부드럽게 펴고, 펴진 부분의 색은 안쪽 옷 색으로 채운다
    m8 = Image.fromarray(main.astype(np.uint8) * 255)
    inner = np.asarray(m8.filter(ImageFilter.MinFilter(5))).astype(np.float32) / 255
    alpha = np.asarray(Image.fromarray((inner * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(np.float32) / 255
    blur = lambda x: np.asarray(Image.fromarray(np.clip(x, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32)  # noqa: E731
    den = blur(inner * 255) / 255
    num = np.dstack([blur(a[..., c] * inner) for c in range(3)])
    fill = num / np.maximum(den, 1e-3)[..., None]
    rgb = np.where(inner[..., None] > 0.5, a, fill)
    rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    out = Image.fromarray(rgba, "RGBA")
    bbox = out.getbbox()
    return out.crop(bbox), {"bg": [round(float(c)) for c in bg], "tol": round(tol, 1), "dropped": round(dropped, 3),
                            "holes": round(float(holes.sum()) / max(1, fg.sum()), 3), "form": round(form, 3)}


# ---------- 마네킹 기준선 ----------

def measure_mannequin(img: Image.Image) -> dict:
    """마네킹 실루엣의 줄별 몸통 폭으로 목·어깨·가슴·허리·골반·가랑이·발목 높이와 폭을 잰다."""
    _, mask, _, _, _, fw = _foreground(img, shadows=False)  # 마네킹은 매끈한 회색이라 그림자 제거를 끈다
    H, W = mask.shape
    rows = np.nonzero(mask.any(axis=1))[0]
    top, bottom = int(rows[0]), int(rows[-1])
    cx = int(np.median(np.nonzero(mask[int(top + (bottom - top) * 0.45)])[0]))

    def run_at(y: int, x: int = cx) -> tuple[int, int] | None:
        r = mask[y]
        if not r[x]:
            return None
        l = x
        while l > 0 and r[l - 1]:
            l -= 1
        rr = x
        while rr < W - 1 and r[rr + 1]:
            rr += 1
        return l, rr

    width = np.array([(lambda s: (s[1] - s[0] + 1) if s else 0)(run_at(y)) for y in range(H)])
    span = bottom - top
    y_in = lambda a_, b_: range(int(top + span * a_), int(top + span * b_))  # noqa: E731
    neck = min(y_in(0.08, 0.20), key=lambda y: width[y] or 10**6)
    shoulder = next((y for y in range(neck, int(top + span * 0.35)) if width[y] > width[neck] * 2.6), int(top + span * 0.20))
    # 팔이 몸통에서 떨어지는 줄 아래의 몸통 폭으로 가슴·허리·골반을 잰다
    waist = min(y_in(0.30, 0.48), key=lambda y: width[y] or 10**6)
    chest = int(top + span * 0.27)
    hip = max(y_in(0.40, 0.55), key=lambda y: width[y] if width[y] < width[waist] * 2.2 else 0)
    crotch = next((y for y in y_in(0.42, 0.65) if not mask[y, cx]), int(top + span * 0.50))
    collar = round(shoulder - (shoulder - neck) * 0.3)  # 옷깃 뒷부분이 걸리는 목 아래
    band = round(waist + (hip - waist) * 0.15)  # 하의 허리밴드가 걸리는 높이 (허리 바로 아래)
    k = fw  # 작업 해상도 → 원본 좌표
    s = lambda v: round(v / k)  # noqa: E731
    return {
        "image_size": list(img.size),
        "center_x": s(cx), "top": s(top), "bottom": s(bottom),
        "neck_y": s(neck), "collar_y": s(collar), "shoulder_y": s(shoulder),
        "chest_y": s(chest), "chest_w": s(width[chest]),
        "waist_y": s(waist), "waist_w": s(width[waist]),
        "band_y": s(band), "band_w": s(width[band]),
        "hip_y": s(hip), "hip_w": s(width[hip]),
        "crotch_y": s(crotch),
    }


# ---------- 얹기 ----------

def _garment_width(mask: np.ndarray, spec) -> tuple[float, int]:
    """옷 마스크에서 기준 폭과 그 높이(행)를 잰다."""
    h = mask.shape[0]
    rows = [(y, np.nonzero(mask[y])[0]) for y in range(h)]
    ext = np.array([(xs[-1] - xs[0] + 1) if len(xs) else 0 for _, xs in rows])
    if spec == "narrow":  # 원피스 허리: 20~55% 구간에서 가장 좁은 줄
        lo, hi = int(h * 0.20), int(h * 0.55)
        y = lo + int(np.argmin(np.where(ext[lo:hi] > 0, ext[lo:hi], 10**6)))
        return float(ext[y]), y
    lo, hi = int(h * spec[0]), max(int(h * spec[0]) + 1, int(h * spec[1]))
    # 단추·끈 같은 가는 줄에 속지 않게 구간에서 넓은 쪽(상위 25%) 폭을 쓴다
    return float(np.percentile(ext[lo:hi], 75)), lo


def place(garment: Image.Image, category: str, anchors: dict, fit: dict | None = None) -> tuple[Image.Image, dict]:
    rule = RULES[category]
    fit = fit or {}
    m = np.asarray(garment.split()[-1]) > 127
    (span, ref, ease), (g_align, m_align) = rule["width"], rule["align"]
    g_w, g_row = _garment_width(m, span)
    target_w = anchors[f"{ref}_w"] * ease
    s = target_w / max(g_w, 1) * float(fit.get("scale", 1.0))
    # 폭 측정이 틀려도 터무니없는 크기가 되지 않게: 옷 높이가 마네킹 키(머리~발)의 1.1배를 넘지 않게 제한
    body = anchors["bottom"] - anchors["top"]
    s = min(s, body * 1.1 / garment.height, 4.0)
    g = garment.convert("RGBa").resize((max(1, round(garment.width * s)), max(1, round(garment.height * s))), Image.LANCZOS).convert("RGBA")
    # 세로: 옷의 기준 줄(맨 위 또는 허리)을 마네킹 기준선에
    g_y = 0 if g_align == "top" else round(g_row * s)
    m_y = anchors[f"{m_align}_y"]
    H = anchors["image_size"][1]
    y = round(m_y - g_y + float(fit.get("dy", 0)) * H)
    # 가로: 옷 기준 줄의 가운데를 마네킹 가운데에
    row = np.asarray(g.split()[-1])[min(g.height - 1, max(0, g_y + (0 if g_align != "top" else round(g.height * 0.6))))] > 127
    xs = np.nonzero(row)[0]
    gc = (xs[0] + xs[-1]) / 2 if len(xs) else g.width / 2
    x = round(anchors["center_x"] - gc + float(fit.get("dx", 0)) * H)
    layer = Image.new("RGBA", tuple(anchors["image_size"]))
    layer.alpha_composite(g, (x, y)) if x >= 0 and y >= 0 else layer.paste(g, (x, y), g)
    return layer, {"scale": round(s, 3), "x": x, "y": y}


# ---------- 확인용 ----------

def _font(size: int):
    try:
        return ImageFont.truetype("/System/Library/Fonts/AppleSDGothicNeo.ttc", size)
    except OSError:
        return ImageFont.load_default()


def sheet(panels: list[tuple[str, Image.Image]], path: Path, h: int = 720, cols: int = 5):
    """같은 높이로 줄 맞춰 나란히 (cols개씩 줄바꿈)."""
    ims = [p.convert("RGB").resize((round(p.width * h / p.height), h), Image.LANCZOS) for _, p in panels]
    top, pad = 34, 8
    rows = [list(zip(panels, ims))[i:i + cols] for i in range(0, len(ims), cols)]
    W = max(sum(im.width for _, im in r) + pad * (len(r) - 1) for r in rows)
    s = Image.new("RGB", (W, len(rows) * (h + top + pad)), "white")
    d = ImageDraw.Draw(s)
    for ri, r in enumerate(rows):
        x, y = 0, ri * (h + top + pad)
        for (t, _), im in r:
            s.paste(im, (x, y + top))
            d.text((x + 6, y + 5), t[:28], fill="black", font=_font(20))
            x += im.width + pad
    path.parent.mkdir(parents=True, exist_ok=True)
    s.save(path, quality=88)


def draw_anchors(img: Image.Image, an: dict) -> Image.Image:
    im = img.convert("RGB").copy()
    d = ImageDraw.Draw(im)
    for key, color in (("collar", "#999"), ("shoulder", "#e33"), ("chest", "#e90"), ("waist", "#3a3"), ("band", "#0aa"), ("hip", "#36c"), ("crotch", "#939")):
        y = an[f"{key}_y"]
        d.line([(0, y), (im.width, y)], fill=color, width=3)
        wv = an.get(f"{key}_w")
        if wv:
            d.line([(an["center_x"] - wv / 2, y - 6), (an["center_x"] + wv / 2, y - 6)], fill=color, width=6)
        d.text((8, y - 26), key, fill=color, font=_font(22))
    d.line([(an["center_x"], 0), (an["center_x"], im.height)], fill="#aaa", width=1)
    return im


ORDER = ("bottom", "top", "dress", "outer")  # 앱과 같은 겹치는 순서

FITTING_HTML = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>마네킹 코디 시험</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#222;--sub:#777;--line:#e2e0db;--accent:#222}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}
main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}
@media(min-width:760px){main{grid-template-columns:minmax(0,420px) minmax(0,1fr)}}
.stage{position:relative;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.stage img.base{position:relative;display:block;height:auto}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--sub);font-size:13px;margin:0 0 12px}
.tabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.tabs button,.reset{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 14px;font:inherit;cursor:pointer}
.tabs button[aria-selected=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}
.item{background:var(--card);border:2px solid transparent;border-radius:10px;padding:6px;cursor:pointer;text-align:left;font:inherit}
.item img{width:100%;aspect-ratio:3/4;object-fit:contain;background:#fafafa;border-radius:6px}
.item span{display:block;font-size:12px;margin-top:4px;color:var(--sub)}
.item.on{border-color:var(--accent)}.item.on span{color:var(--ink);font-weight:600}
.worn{margin-top:12px;color:var(--sub);font-size:13px}
</style></head><body><main>
<div class="stage" id="stage"><img class="base" src="model.png" alt="마네킹"></div>
<section><h1>마네킹 코디 시험</h1><p class="sub">옷을 누르면 입히고, 다시 누르면 벗깁니다. 원피스를 입으면 상의·하의는 벗겨져요.</p>
<div class="tabs" id="tabs"></div><div class="grid" id="grid"></div>
<p class="worn" id="worn"></p><button class="reset" id="reset">모두 벗기</button></section></main>
<script>
const P = __PRODUCTS__;
const CATS=[["top","상의"],["bottom","하의"],["dress","원피스"],["outer","아우터"]].filter(([c])=>P.some(p=>p.category===c));
const ORDER=["bottom","top","dress","outer"]; let tab=CATS[0][0]; const wear={};
const stage=document.getElementById("stage"), grid=document.getElementById("grid"), tabs=document.getElementById("tabs");
function render(){
  tabs.innerHTML=""; for(const [c,l] of CATS){const b=document.createElement("button");b.textContent=l;b.setAttribute("aria-selected",c===tab);b.onclick=()=>{tab=c;render()};tabs.append(b)}
  grid.innerHTML=""; for(const p of P.filter(p=>p.category===tab)){const b=document.createElement("button");b.className="item"+(wear[p.category]===p.id?" on":"");
    b.innerHTML=`<img src="${p.imageUrl}" alt=""><span>${p.title}</span>`;b.onclick=()=>toggle(p);grid.append(b)}
  stage.querySelectorAll("img.layer").forEach(e=>e.remove());
  for(const c of ORDER){const id=wear[c]; if(!id) continue; const im=document.createElement("img");im.className="layer";im.src=P.find(p=>p.id===id).layerUrl;stage.append(im)}
  const on=Object.values(wear).filter(Boolean).map(id=>P.find(p=>p.id===id).title);
  document.getElementById("worn").textContent=on.length?"입은 옷: "+on.join(" + "):"아무것도 입지 않음";
}
function toggle(p){ if(wear[p.category]===p.id){delete wear[p.category]} else {wear[p.category]=p.id;
  if(p.category==="dress"){delete wear.top;delete wear.bottom} if(p.category==="top"||p.category==="bottom"){delete wear.dress}} render() }
document.getElementById("reset").onclick=()=>{for(const k in wear) delete wear[k]; render()};
for(const p of P){const i=new Image();i.src=p.layerUrl}
render();
</script></body></html>
"""


def stack(model: Image.Image, layers: list[tuple[str, Image.Image]]) -> Image.Image:
    out = model.convert("RGBA").copy()
    cats = [c for c, _ in layers]
    for cat in ORDER:
        if cat in ("top", "bottom") and "dress" in cats:
            continue
        for c, l in layers:
            if c == cat:
                out.alpha_composite(l)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mannequin", required=True, type=Path)
    ap.add_argument("--items", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--anchors", type=Path, help="손으로 고친 기준선 json (없으면 자동 측정)")
    ap.add_argument("--combos", nargs="*", default=[], help="확인용 조합 예: s01+s05 s03+s06")
    ap.add_argument("--publish", action="store_true", help="결과를 ../public/catalog 로 복사 (앱에 반영)")
    args = ap.parse_args()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    model = Image.open(args.mannequin).convert("RGB")
    if max(model.size) > 1536:
        k = 1536 / max(model.size)
        model = model.resize((round(model.width * k), round(model.height * k)), Image.LANCZOS)
    model.save(out / "model.png", optimize=True)
    anchors = json.loads(args.anchors.read_text()) if args.anchors else measure_mannequin(model)
    (out / "anchors.json").write_text(json.dumps(anchors, indent=2), encoding="utf-8")
    draw_anchors(model, anchors).save(out / "anchors.jpg", quality=88)
    print("마네킹 기준선:", {k: v for k, v in anchors.items() if k != "image_size"})

    items = json.loads(args.items.read_text(encoding="utf-8"))
    base_dir = args.items.parent
    products, layers, cut_panels = [], {}, []
    for it in items:
        pid, cat = it["id"], it["category"]
        src = (base_dir / it["garmentImage"]).resolve()
        cut, info = cut_garment(Image.open(src))
        (out / "cutouts").mkdir(exist_ok=True)
        cut.save(out / "cutouts" / f"{pid}.png", optimize=True)
        layer, pos = place(cut, cat, anchors, it.get("fit"))
        (out / "layers").mkdir(exist_ok=True)
        layer.save(out / "layers" / f"{pid}.png", optimize=True)
        layers[pid] = (cat, layer)
        thumb = Image.open(src).convert("RGB")
        thumb.thumbnail((900, 1200), Image.LANCZOS)
        (out / "images").mkdir(exist_ok=True)
        thumb.save(out / "images" / f"{pid}.jpg", quality=88)
        print(f"{pid} {cat}: 배경 {info['bg']} 허용 {info['tol']}, 떨어진 조각 {info['dropped']:.1%}, 안쪽 구멍 {info['holes']:.1%}, 토르소 {info['form']:.1%}, 배율 {pos['scale']}, 위치 ({pos['x']},{pos['y']})")
        checker = Image.new("RGB", cut.size, (205, 225, 205))
        checker.paste(cut, (0, 0), cut)
        cut_panels.append((f"{pid} 원본", Image.open(src)))
        cut_panels.append((f"{pid} 배경 제거", checker))
        products.append({
            "id": pid, "title": it["title"], "priceAmount": it["priceAmount"], "currency": "USD",
            "sourceName": it["sourceName"], **({"sourceUrl": it["sourceUrl"]} if it.get("sourceUrl") else {}),
            "tradeType": it.get("tradeType", "wholesale"), **({"sizes": it["sizes"]} if it.get("sizes") else {}),
            "category": cat, "imageUrl": f"images/{pid}.jpg", "layerUrl": f"layers/{pid}.png", "isDummy": it.get("isDummy", True),
        })

    sheet(cut_panels, out / "cutouts.jpg", h=360, cols=10)
    sheet([(f"{pid} {it['title']}", stack(model, [layers[pid]])) for pid, it in ((i["id"], i) for i in items)], out / "overview.jpg")
    if args.combos:
        sheet([(c, stack(model, [layers[p] for p in c.split("+")])) for c in args.combos], out / "combos.jpg", cols=4)
    catalog = {"model": {"imageUrl": "model.png", "width": model.width, "height": model.height, "label": "기본 마네킹 · 샘플 상품"},
               "products": products}
    (out / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "fitting.html").write_text(FITTING_HTML.replace("__PRODUCTS__", json.dumps(products, ensure_ascii=False)), encoding="utf-8")
    print("완료:", out, "(fitting.html 직접 조합해 보기, cutouts.jpg 배경 제거, overview.jpg 상품별, combos.jpg 조합, anchors.jpg 기준선)")

    if args.publish:
        dst = HERE.parent / "public" / "catalog"
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir(parents=True)
        for name in ("catalog.json", "model.png"):
            shutil.copy2(out / name, dst / name)
        shutil.copytree(out / "layers", dst / "layers")
        shutil.copytree(out / "images", dst / "images")
        print("앱에 반영:", dst)


if __name__ == "__main__":
    main()
