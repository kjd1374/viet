"""이미 만든 착용 결과(out/.../raw/*.png)로 레이어만 다시 떼어낸다. 착용 생성을 다시 하지 않으므로 몇 초면 끝난다.
잘라내기 설정을 바꿨을 때 사용.

  python reextract.py --out out/mac-test            # raw가 있는 모든 상품
  python reextract.py --out out/mac-test --ids s01 s05
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from extract import composite, extract_layer, segment_masks  # noqa: E402

TO_COVERAGE = {"top": "upper", "outer": "upper", "bottom": "lower", "dress": "full"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--no-segmentation", action="store_true")
    ap.add_argument("--orig-dilate", type=int, default=6, help="원래 옷 영역을 몇 px 넓혀서 가릴지 (0=끔)")
    args = ap.parse_args()
    os.environ.setdefault("HF_HOME", str(HERE / "hf-cache"))
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

    out: Path = args.out
    cat = json.loads((out / "catalog.json").read_text(encoding="utf-8")) if (out / "catalog.json").exists() else {"products": []}
    category = {p["id"]: p["category"] for p in cat["products"]}
    ids = args.ids or sorted(p.stem for p in (out / "raw").glob("*.png"))
    base = np.array(Image.open(out / "model.png").convert("RGB"))
    protect = (np.array(Image.open(out / "protect.png").convert("L")) > 127).astype(np.uint8) * 255

    parser = None
    if not args.no_segmentation:
        from fashn_human_parser import BODY_COVERAGE_TO_LABELS, LABELS_TO_IDS, FashnHumanParser

        parser = FashnHumanParser(device="cpu")
        base_seg = parser.predict(base)

    layers = {}
    for pid in ids:
        tryon = np.array(Image.open(out / "raw" / f"{pid}.png").convert("RGB"))
        c = category.get(pid)
        gmask = excl = skin = orig = None
        if parser is not None and c:
            seg = parser.predict(tryon)
            cov_labels = BODY_COVERAGE_TO_LABELS[TO_COVERAGE[c]]
            gmask, excl, skin = segment_masks(seg, cov_labels, LABELS_TO_IDS)
            orig = np.isin(base_seg, [LABELS_TO_IDS[l] for l in cov_labels if l in LABELS_TO_IDS]).astype(np.uint8) * 255
        layer, st = extract_layer(base, tryon, garment_mask=gmask, exclude=excl, shadow_allowed=skin, protect=protect,
                                  orig_mask=orig, orig_dilate=args.orig_dilate)
        Image.fromarray(layer).save(out / "layers" / f"{pid}.png", optimize=True)
        layers[c or pid] = layer
        print(f"{pid} ({c}): 덮는 면적 {st.coverage * 100:.0f}%, 바깥 잡음 {st.outside_noise:.1f}, 다른 옷 덮음 {st.covered_other * 100:.1f}%")

    order = [k for k in ("bottom", "top", "dress", "outer") if k in layers]
    if order:
        Image.fromarray(composite(base, [layers[k] for k in order])).save(out / "preview_composite.png")
        print("미리보기:", out / "preview_composite.png")


if __name__ == "__main__":
    main()
