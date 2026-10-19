"""크롤링한 상품(crawl_cafe24.py의 items.json)을 앱 카탈로그로 내보낸다 (코디 보드용). AI·배경 제거 없음.

  python3 publish_board.py --items in-sample/real/items.json            # → ../public/catalog (앱이 바로 읽음)

- 탐색(스와이프) 카드: 대표 이미지(main_<id>.jpg, 보통 모델 착용컷). 없으면 상품컷.
- 코디 보드: 옷만 찍힌 상품컷(<id>.jpg).
- 구매 정보의 착용 사진(참고용): 모델 착용컷(photos/<id>_N.jpg, crawl_cafe24.py가 모음).
- 사진은 긴 변 1200px 이하 JPEG로 줄여 넣는다. public/catalog 는 저장소에 올리지 않는다 (.gitignore).
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent


def save_small(src: Path, dst: Path, side: int = 1200):
    im = Image.open(src).convert("RGB")
    im.thumbnail((side, side), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, quality=86, optimize=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--items", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=HERE.parent / "public" / "catalog")
    a = ap.parse_args()
    items = json.loads(a.items.read_text(encoding="utf-8"))
    src_dir = a.items.parent
    if a.out.exists():
        shutil.rmtree(a.out)
    products = []
    for it in items:
        pid = it["id"]
        shot = src_dir / it["garmentImage"]
        main = src_dir / f"main_{pid}.jpg"
        save_small(shot, a.out / "board" / f"{pid}.jpg")
        save_small(main if main.exists() else shot, a.out / "images" / f"{pid}.jpg")
        sizes = (it.get("measure") or {}).get("sizes")
        photos = []
        for name in it.get("modelImages", []):
            dst = f"photos/{Path(name).name}"
            save_small(src_dir / name, a.out / dst, side=1000)
            photos.append(dst)
        products.append({
            "id": pid, "title": it["title"], "priceAmount": it["priceAmount"], "currency": it.get("currency", "USD"),
            "sourceName": it["sourceName"], **({"sourceUrl": it["sourceUrl"]} if it.get("sourceUrl") else {}),
            "tradeType": it.get("tradeType", "retail"), **({"sizes": sizes} if sizes else {}),
            "category": it["category"], "imageUrl": f"images/{pid}.jpg", "boardImageUrl": f"board/{pid}.jpg",
            **({"modelImageUrls": photos} if photos else {}),
            "isDummy": it.get("isDummy", True),
        })
    (a.out / "catalog.json").write_text(json.dumps({"products": products}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"앱 카탈로그: 상품 {len(products)}개 → {a.out}")


if __name__ == "__main__":
    main()
