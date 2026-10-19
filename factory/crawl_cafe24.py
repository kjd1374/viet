"""카페24 쇼핑몰에서 카테고리별로 상품을 무작위로 골라, 상세 페이지의 "옷만 찍힌 상품컷"을 찾아 받는다 (시험용).

  python3 crawl_cafe24.py --site https://classic-blanc.com --cat top=25 --cat bottom=58 --cat dress=26 --cat outer=57 \
      --per 5 --out in-sample/real

- 대표 이미지는 보통 모델 착용 사진이라 쓰지 않는다. 상세 이미지 중 흰 배경 + 옷 하나 + 여백이 있는 사진(상품컷)을 고른다.
  모델컷, 색상 모음, 디테일 확대, 안내문은 걸러낸다.
- 세트 상품(상의+하의)은 한 장에 옷이 둘이라 건너뛴다.
- 받은 사진은 저장소에 올리지 않는다 (.gitignore: factory/in-sample/). 요청 사이에 쉬어서 사이트에 부담을 주지 않는다.
- 결과: <out>/<id>.jpg (상품컷), <out>/main_<id>.jpg (대표 이미지, 비교용), <out>/items.json (flat_layers.py 입력 형식)
"""

from __future__ import annotations

import argparse
import html
import io
import json
import random
import re
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from flat_layers import _foreground, _grow  # noqa: E402

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
SET_WORDS = re.compile(r"set|세트|투피스|셋업", re.I)


def get(url: str, delay: float) -> bytes:
    time.sleep(delay)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def list_products(site: str, cate_no: int, pages: int, delay: float) -> list[int]:
    nos: list[int] = []
    for page in range(1, pages + 1):
        s = get(f"{site}/product/list.html?cate_no={cate_no}&page={page}", delay).decode("utf-8", "ignore")
        for n in re.findall(r"product_no=(\d+)|/product/[^\"/]+/(\d+)/category/", s):
            v = int(n[0] or n[1])
            if v not in nos:
                nos.append(v)
    return nos


SIZE_KEYS = {  # 표 머리글 → 표준 이름 (단위 cm, 단면 기준)
    "length": ("총길이", "총장", "기장", "전체길이"), "shoulder": ("어깨",), "chest": ("가슴",), "sleeve": ("소매",),
    "waist": ("허리",), "hip": ("엉덩이", "힙"), "thigh": ("허벅지",), "rise": ("밑위",), "hem": ("밑단",),
}
PREFERRED = ("FREE", "F", "M", "S", "55", "26")


def parse_size_table(page: str) -> dict | None:
    """카페24 '사이즈 정보'(에디봇) 표 → {"size": 이름, "length": cm, "chest": cm, ...}. 없으면 None."""
    i = page.find("edinfo-sizediv")
    if i < 0:
        return None
    m = re.search(r"<table>(.*?)</table>", page[i:], re.S)
    if not m:
        return None
    cell = lambda x: html.unescape(re.sub(r"<[^>]+>", "", x)).strip()  # noqa: E731
    head = [cell(h) for h in re.findall(r"<th[^>]*scope=\"col\"[^>]*>(.*?)</th>", m[1], re.S)]
    rows = []
    for tr in re.findall(r"<tbody>.*?</tbody>", m[1], re.S)[0:1]:
        for r in re.findall(r"<tr>(.*?)</tr>", tr, re.S):
            name = cell((re.search(r"<th[^>]*>(.*?)</th>", r, re.S) or [None, ""])[1])
            vals = [cell(v) for v in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
            rows.append((name, vals))
    if not rows or len(head) < 2:
        return None
    keys = [re.sub(r"^\s*\d+\s*[.)]\s*", "", h) for h in head[1:]]
    row = next((r for p in PREFERRED for r in rows if r[0].upper() == p), rows[len(rows) // 2])
    out = {"size": row[0]}
    for k, v in zip(keys, row[1]):
        num = re.search(r"\d+(?:\.\d+)?", v)
        if not num:
            continue
        for std, names in SIZE_KEYS.items():
            if std not in out and any(n in k for n in names):
                out[std] = float(num[0])
    out["sizes"] = [r[0] for r in rows]
    return out if len(out) > 2 else None


def product_shot_score(img: Image.Image) -> tuple[float, str]:
    """상품컷 같으면 양수 점수. (점수, 이유)"""
    w, h = img.size
    if h < w * 1.05:
        return -1, "가로형"
    a, fg, bg, tol, dist, _ = _foreground(img, shadows=True)
    if bg.mean() < 225 or (bg.max() - bg.min()) > 18:
        return -1, "배경이 흰색이 아님"
    H, W = fg.shape
    frac = fg.mean()
    if not 0.12 < frac < 0.65:
        return -1, f"옷 면적 {frac:.0%}"
    ys, xs = np.nonzero(fg)
    m = min(ys.min() / H, xs.min() / W, 1 - ys.max() / H, 1 - xs.max() / W)
    if m < 0.015:
        return -1, "옷이 가장자리에 닿음(확대컷)"
    # 덩어리 하나인지: 가운데에서 키운 덩어리가 전경 대부분이어야 함 (색상 모음·여러 컷 제외)
    cy, cx = np.median(ys), np.median(xs)
    k = np.argmin((ys - cy) ** 2 + (xs - cx) ** 2)
    seed = np.zeros_like(fg)
    seed[ys[k], xs[k]] = True
    main = _grow(seed, fg)
    single = main.sum() / fg.sum()
    if single < 0.9:
        return -1, f"여러 덩어리({single:.0%})"
    # 사람 피부가 많으면 모델컷
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    skin = fg & (r > 95) & (g > 40) & (b > 20) & (r > g) & (r > b) & ((r - np.minimum(g, b)) > 15) & (abs(r - g) > 15)
    if skin.sum() / max(1, fg.sum()) > 0.12:
        return -1, "피부가 많음(모델컷)"
    contrast = float(dist[main].mean())
    return contrast, "상품컷"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True)
    ap.add_argument("--cat", action="append", default=[], help="앱분류=카테고리번호, 예: top=25")
    ap.add_argument("--per", type=int, default=5)
    ap.add_argument("--pages", type=int, default=2, help="카테고리 목록에서 볼 페이지 수")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--delay", type=float, default=0.4, help="요청 사이 쉬는 초")
    ap.add_argument("--source-name", default="")
    ap.add_argument("--update-sizes", action="store_true", help="이미 받은 <out>/items.json 상품들의 실측 사이즈만 다시 읽어 넣는다")
    a = ap.parse_args()
    if a.update_sizes:
        path = a.out / "items.json"
        items = json.loads(path.read_text(encoding="utf-8"))
        for it in items:
            m = parse_size_table(get(it["sourceUrl"], a.delay).decode("utf-8", "ignore"))
            if m:
                it["measure"] = m
            print(it["id"], m, flush=True)
        path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    site = a.site.rstrip("/")
    a.out.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(a.seed)
    items, log = [], []
    for spec in a.cat:
        cat, cate_no = spec.split("=")
        nos = list_products(site, int(cate_no), a.pages, a.delay)
        rnd.shuffle(nos)
        print(f"[{cat}] 카테고리 {cate_no}: 상품 {len(nos)}개 중 {a.per}개 고르는 중", flush=True)
        got = 0
        for no in nos:
            if got >= a.per:
                break
            page = get(f"{site}/product/detail.html?product_no={no}", a.delay).decode("utf-8", "ignore")
            title = html.unescape((re.search(r'<meta property="og:title" content="([^"]*)"', page) or [None, ""])[1])
            if not title:
                continue
            if cat != "top" and SET_WORDS.search(title) or cat == "dress" and not re.search(r"원피스|드레스", title):
                print(f"  {no} 건너뜀(세트 또는 원피스 아님): {title[:40]}", flush=True)
                continue
            price = re.search(r'product_price_text">\s*([\d,]+)', page)
            measure = parse_size_table(page)
            main_img = re.search(r'<meta property="og:image" content="([^"]*)"', page)
            details = list(dict.fromkeys(re.findall(r'src="(/web/upload/NNEditor/[^"]+\.(?:jpe?g|png|webp))"', page)))
            best, best_score, tried = None, 0.0, 0
            for u in details:
                try:
                    im = Image.open(io.BytesIO(get(site + u, a.delay))).convert("RGB")
                except Exception:  # noqa: BLE001
                    continue
                tried += 1
                score, why = product_shot_score(im)
                if score > best_score:
                    best, best_score = im, score
                    break  # 앞쪽 상품컷(보통 정면)을 쓴다
            if best is None:
                print(f"  {no} 상품컷 없음 ({tried}장 확인): {title[:40]}", flush=True)
                log.append({"no": no, "title": title, "result": "상품컷 없음"})
                continue
            pid = f"{cat[0]}{no}"
            best.save(a.out / f"{pid}.jpg", quality=92)
            if main_img:
                Image.open(io.BytesIO(get(main_img[1], a.delay))).convert("RGB").save(a.out / f"main_{pid}.jpg", quality=88)
            items.append({
                "id": pid, "title": re.sub(r"\s+", " ", title).strip(), "priceAmount": int(price[1].replace(",", "")) if price else 0,
                "currency": "KRW", "category": cat, "garmentImage": f"{pid}.jpg", "photoType": "flat-lay",
                "sourceName": a.source_name or site.split("//")[-1], "sourceUrl": f"{site}/product/detail.html?product_no={no}",
                "tradeType": "retail", "isDummy": True, **({"measure": measure} if measure else {}),
            })
            got += 1
            print(f"  {pid} 상품컷 찾음 ({tried}장째): {title[:50]}", flush=True)
    (a.out / "items.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"완료: {len(items)}개 → {a.out / 'items.json'}")


if __name__ == "__main__":
    main()
