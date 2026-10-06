"""레이어 공장: 상품 사진 → 고정 모델에 착용 → 옷만 떼어낸 레이어 PNG → 앱용 catalog.json

사용 예 (factory 폴더에서):
  python make_layers.py --model in/model.png --items in/items.json --out out
  python make_layers.py ... --publish            # 결과를 ../public/catalog 로 복사 (앱이 바로 읽음)

items.json 형식은 items.example.json 참고. 이미 만든 레이어는 건너뛴다(--force 로 다시 생성).
속도 기록: out/timings.csv (장치·상품별 초)

라이선스 주의: 착용 모델(FASHN VTON v1.5)은 Apache-2.0이지만, 함께 쓰는 fashn-human-parser는
NVIDIA SegFormer 라이선스(연구·평가 목적만)다. 지금은 품질 평가용으로만 쓰고, 서비스 전에 교체해야 한다.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import platform
import shutil
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from extract import composite, extract_layer, segment_masks  # noqa: E402

# 앱 분류 → FASHN 분류. 아우터도 상반신 옷으로 입힌다.
TO_FASHN = {"top": "tops", "outer": "tops", "bottom": "bottoms", "dress": "one-pieces"}

log = logging.getLogger("factory")


def pick_device(name: str) -> str:
    import torch

    if name != "auto":
        return name
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_rgb(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGB"))


def save_png(arr: np.ndarray, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path, optimize=True)


def label_mask(seg: np.ndarray, ids: list[int]) -> np.ndarray:
    return (np.isin(seg, ids)).astype(np.uint8) * 255


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, type=Path, help="고정 모델 사진 (정면, 팔을 몸에서 조금 뗀 자세)")
    ap.add_argument("--items", required=True, type=Path, help="상품 목록 JSON")
    ap.add_argument("--out", default=HERE / "out", type=Path)
    ap.add_argument("--weights", default=HERE / "weights", type=Path)
    ap.add_argument("--device", default="auto", help="auto | mps | cuda | cpu")
    ap.add_argument("--steps", type=int, default=30, help="20=빠름, 30=균형, 50=품질")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--limit", type=int, default=0, help="앞에서 N개만 (시험용)")
    ap.add_argument("--force", action="store_true", help="이미 만든 레이어도 다시 생성")
    ap.add_argument("--no-segmentation", action="store_true", help="옷 영역 분할 없이 색차만으로 잘라내기")
    ap.add_argument("--publish", action="store_true", help="결과를 ../public/catalog 로 복사")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    os.environ.setdefault("HF_HOME", str(HERE / "hf-cache"))
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    # 맥 GPU(MPS)가 지원하지 않는 연산은 CPU로 대신 처리
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

    out: Path = args.out
    items = json.loads(args.items.read_text(encoding="utf-8"))
    if args.limit:
        items = items[: args.limit]
    items_dir = args.items.parent

    from fashn_human_parser import BODY_COVERAGE_TO_LABELS, CATEGORY_TO_BODY_COVERAGE, IDENTITY_LABELS, LABELS_TO_IDS
    from fashn_vton import TryOnPipeline

    device = pick_device(args.device)
    log.info("장치: %s (%s %s)", device, platform.system(), platform.machine())
    t0 = time.perf_counter()
    try:
        pipe = TryOnPipeline(weights_dir=str(args.weights), device=device)
    except Exception as e:  # noqa: BLE001 - 맥 GPU 미지원 등: 시험이 멈추지 않게 CPU로 전환
        if device == "cpu":
            raise
        log.warning("%s에서 모델을 올리지 못해 CPU로 전환합니다: %s", device, e)
        device = "cpu"
        pipe = TryOnPipeline(weights_dir=str(args.weights), device=device)
    log.info("모델 로드 %.1fs", time.perf_counter() - t0)

    # 고정 모델: 앱에 그대로 쓰일 기준 이미지. 착용 모델 입력 해상도 이하로 맞춰 둔다.
    base_img = Image.open(args.model).convert("RGB")
    h_in, w_in = pipe.tryon_model.input_shape
    scale = min(1.0, max(h_in, w_in) / max(base_img.size))
    if scale < 1.0:
        base_img = base_img.resize((round(base_img.width * scale), round(base_img.height * scale)), Image.LANCZOS)
    base = np.array(base_img)
    save_png(base, out / "model.png")

    # 보호 영역(얼굴·머리 등): 고정 모델에서 한 번만 계산. out/protect.png 를 손으로 고쳐도 된다.
    protect_path = out / "protect.png"
    if protect_path.exists() and not args.force:
        protect = (np.array(Image.open(protect_path).convert("L")) > 127).astype(np.uint8) * 255
    else:
        seg = pipe.hp_model.predict(base)
        protect = label_mask(seg, [LABELS_TO_IDS[l] for l in IDENTITY_LABELS if l in LABELS_TO_IDS])
        protect = cv2.erode(protect, np.ones((3, 3), np.uint8))  # 경계는 옷이 덮을 수 있게 살짝 안쪽만
        save_png(protect, protect_path)
    log.info("보호 영역 %.1f%% (%s)", protect.mean() / 2.55, ", ".join(IDENTITY_LABELS))

    timings_path = out / "timings.csv"
    new_file = not timings_path.exists()
    tf = open(timings_path, "a", newline="", encoding="utf-8")
    tw = csv.writer(tf)
    if new_file:
        tw.writerow(["id", "category", "device", "steps", "tryon_sec", "extract_sec", "coverage", "outside_noise", "protected_changed"])

    products = []
    layers_for_preview: dict[str, np.ndarray] = {}
    for i, it in enumerate(items, 1):
        pid, cat = it["id"], it["category"]
        layer_path = out / "layers" / f"{pid}.png"
        img_path = out / "images" / f"{pid}.jpg"
        garment_src = (items_dir / it["garmentImage"]).resolve()

        if not img_path.exists() or args.force:
            g = Image.open(garment_src).convert("RGB")
            g.thumbnail((900, 1200), Image.LANCZOS)
            img_path.parent.mkdir(parents=True, exist_ok=True)
            g.save(img_path, quality=88)

        if layer_path.exists() and not args.force:
            log.info("[%d/%d] %s 건너뜀 (이미 있음)", i, len(items), pid)
        else:
            garment = Image.open(garment_src).convert("RGB")
            call = dict(
                person_image=base_img,
                garment_image=garment,
                category=TO_FASHN[cat],
                garment_photo_type=it.get("photoType", "model"),
                num_timesteps=args.steps,
                seed=args.seed,
            )
            t1 = time.perf_counter()
            try:
                res = pipe(**call)
            except Exception as e:  # noqa: BLE001
                if device == "cpu":
                    raise
                log.warning("%s 생성 중 오류로 CPU로 전환해 다시 시도합니다: %s", device, e)
                device = "cpu"
                pipe = TryOnPipeline(weights_dir=str(args.weights), device=device)
                t1 = time.perf_counter()
                res = pipe(**call)
            t_tryon = time.perf_counter() - t1
            tryon = np.array(res.images[0].convert("RGB").resize(base_img.size, Image.LANCZOS))
            save_png(tryon, out / "raw" / f"{pid}.png")

            t2 = time.perf_counter()
            gmask = excl = skin = None
            if not args.no_segmentation:
                seg = pipe.hp_model.predict(tryon)
                cov = CATEGORY_TO_BODY_COVERAGE[TO_FASHN[cat]]
                gmask, excl, skin = segment_masks(seg, BODY_COVERAGE_TO_LABELS[cov], LABELS_TO_IDS)
            layer, st = extract_layer(base, tryon, garment_mask=gmask, exclude=excl, shadow_allowed=skin, protect=protect)
            t_ext = time.perf_counter() - t2
            save_png(layer, layer_path)
            tw.writerow([pid, cat, device, args.steps, f"{t_tryon:.1f}", f"{t_ext:.1f}", f"{st.coverage:.3f}", f"{st.outside_noise:.2f}", f"{st.protected_changed:.2f}"])
            tf.flush()
            log.info(
                "[%d/%d] %s %s: 착용 %.1fs, 잘라내기 %.1fs, 덮는 면적 %.0f%%, 바깥 잡음 %.1f, 얼굴 변화 %.1f",
                i, len(items), pid, cat, t_tryon, t_ext, st.coverage * 100, st.outside_noise, st.protected_changed,
            )

        layers_for_preview[cat] = np.array(Image.open(layer_path).convert("RGBA"))
        products.append(
            {
                "id": pid,
                "title": it["title"],
                "priceAmount": it["priceAmount"],
                "currency": "USD",
                "sourceName": it["sourceName"],
                **({"sourceUrl": it["sourceUrl"]} if it.get("sourceUrl") else {}),
                "tradeType": it.get("tradeType", "wholesale"),
                **({"sizes": it["sizes"]} if it.get("sizes") else {}),
                "category": cat,
                "imageUrl": f"images/{pid}.jpg",
                "layerUrl": f"layers/{pid}.png",
                "isDummy": it.get("isDummy", True),
            }
        )
    tf.close()

    # 확인용: 하의 → 상의/원피스 → 아우터 순으로 하나씩 겹친 미리보기
    order = [c for c in ("bottom", "top", "dress", "outer") if c in layers_for_preview]
    if "dress" in order:
        order = [c for c in order if c not in ("top", "bottom")]
    save_png(composite(base, [layers_for_preview[c][..., :4] for c in order]), out / "preview_composite.png")

    catalog = {
        "model": {"imageUrl": "model.png", "width": base.shape[1], "height": base.shape[0], "label": "AI 생성 모델 · 샘플 상품"},
        "products": products,
    }
    (out / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("catalog.json: 상품 %d개 → %s", len(products), out)

    if args.publish:
        dst = HERE.parent / "public" / "catalog"
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir(parents=True)
        for name in ("catalog.json", "model.png"):
            shutil.copy2(out / name, dst / name)
        shutil.copytree(out / "layers", dst / "layers")
        shutil.copytree(out / "images", dst / "images")
        log.info("앱에 반영: %s (npm run dev 후 확인)", dst)


if __name__ == "__main__":
    main()
