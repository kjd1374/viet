"""시험용 예제 이미지를 내려받고 items.json을 만든다 (FASHN 공식 데모의 예제 사진).

품질·속도 평가 전용이다. 이 사진들은 저장소에 올리지 않는다 (.gitignore: factory/in-sample/).
실행: python get_samples.py
"""

import json
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DST = HERE / "in-sample"
URL = "https://huggingface.co/spaces/fashn-ai/fashn-vton-1.5/resolve/main/assets/examples/"

FILES = [f"garment{i}.{ext}" for i, ext in enumerate(["png", "jpeg", "webp", "jpeg", "webp", "jpeg", "webp", "jpg"])]
FILES += ["person5.png"]

# 앱 분류: top | bottom | dress | outer
ITEMS = [
    {"id": "s01", "title": "베이직 블랙 티셔츠", "priceAmount": 6.5, "category": "top", "garmentImage": "garment7.jpg", "photoType": "flat-lay", "tradeType": "wholesale", "sizes": ["S", "M", "L"]},
    {"id": "s02", "title": "오프숄더 크롭 블라우스", "priceAmount": 12.0, "category": "top", "garmentImage": "garment3.jpeg", "photoType": "flat-lay", "tradeType": "retail"},
    {"id": "s03", "title": "그래픽 오버핏 티셔츠", "priceAmount": 9.9, "category": "top", "garmentImage": "garment2.webp", "photoType": "model", "tradeType": "retail", "sizes": ["M", "L", "XL"]},
    {"id": "s04", "title": "홀터넥 플로럴 탑", "priceAmount": 14.0, "category": "top", "garmentImage": "garment4.webp", "photoType": "model", "tradeType": "retail"},
    {"id": "s05", "title": "러플 티어드 미니스커트", "priceAmount": 11.5, "category": "bottom", "garmentImage": "garment5.jpeg", "photoType": "flat-lay", "tradeType": "wholesale", "sizes": ["S", "M"]},
    {"id": "s06", "title": "플로럴 와이드 팬츠", "priceAmount": 18.0, "category": "bottom", "garmentImage": "garment4.webp", "photoType": "model", "tradeType": "retail"},
    {"id": "s07", "title": "퍼프 소매 레드 미니 원피스", "priceAmount": 24.0, "category": "dress", "garmentImage": "garment1.jpeg", "photoType": "model", "tradeType": "retail"},
    {"id": "s08", "title": "오프숄더 시퀸 롱 드레스", "priceAmount": 39.0, "category": "dress", "garmentImage": "garment6.webp", "photoType": "model", "tradeType": "retail"},
]


def main():
    DST.mkdir(exist_ok=True)
    for f in FILES:
        p = DST / f
        if not p.exists():
            print("다운로드", f)
            urllib.request.urlretrieve(URL + f, p)
    items = [{**it, "sourceName": "FASHN 데모 예제 (시험용)", "isDummy": True} for it in ITEMS]
    (DST / "items.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print("완료:", DST / "items.json", "/ 기준 모델:", DST / "person5.png")


if __name__ == "__main__":
    main()
