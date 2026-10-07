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
from extract import SKIN_LABELS, composite, extract_layer, segment_masks  # noqa: E402
import gpt_tryon  # noqa: E402
import pose_check  # noqa: E402

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


def side_by_side(panels: list[tuple[str, np.ndarray]], path: Path):
    """[제목, 이미지] 들을 같은 높이로 나란히 저장 (확인용)."""
    from PIL import ImageDraw, ImageFont

    h = max(im.shape[0] for _, im in panels)
    ims = [Image.fromarray(im).resize((round(im.shape[1] * h / im.shape[0]), h), Image.LANCZOS) for _, im in panels]
    top, pad = 36, 8
    sheet = Image.new("RGB", (sum(i.width for i in ims) + pad * (len(ims) - 1), h + top), "white")
    try:
        font = ImageFont.truetype("/System/Library/Fonts/AppleSDGothicNeo.ttc", 22)
    except OSError:
        font = ImageFont.load_default()
    draw, x = ImageDraw.Draw(sheet), 0
    for (title, _), im in zip(panels, ims):
        sheet.paste(im, (x, top))
        draw.text((x + 6, 6), title, fill="black", font=font)
        x += im.width + pad
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, type=Path, help="고정 모델 사진 (정면, 팔을 몸에서 조금 뗀 자세)")
    ap.add_argument("--items", required=True, type=Path, help="상품 목록 JSON")
    ap.add_argument("--out", default=HERE / "out", type=Path)
    ap.add_argument("--weights", default=HERE / "weights", type=Path)
    ap.add_argument("--engine", default="fashn", choices=["fashn", "gpt"],
                    help="착용 생성기. fashn: 맥에서 FASHN 1.5 직접 실행(576x864, 약 4분/벌). "
                         "gpt: ChatGPT 구독의 Codex 이미지 생성(1024x1536, 약 1분/벌, 구독 사용량 소모)")
    ap.add_argument("--gpt-model", default=gpt_tryon.DEFAULT_MODEL, help="--engine gpt 일 때 Codex 모델")
    ap.add_argument("--device", default="auto", help="auto | mps | cuda | cpu")
    ap.add_argument("--dtype", "--precision", dest="dtype", default="auto", choices=["auto", "fp32", "bf16", "fp16"],
                    help="정밀도. auto: 맥 GPU는 bf16(메모리 절반, 원본 착용 이미지 정상 확인), 그 외 fp32")
    ap.add_argument("--mps-memory", type=float, default=0.7,
                    help="맥 GPU 메모리 상한 비율 (권장 최대치 대비). 넘으면 맥이 멈추는 대신 오류 → CPU로 전환")
    ap.add_argument("--steps", type=int, default=30, help="20=빠름, 30=균형, 50=품질")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--limit", type=int, default=0, help="앞에서 N개만 (시험용)")
    ap.add_argument("--force", action="store_true", help="이미 만든 레이어도 다시 생성")
    ap.add_argument("--no-segmentation", action="store_true", help="옷 영역 분할 없이 색차만으로 잘라내기")
    ap.add_argument("--orig-dilate", type=int, default=6,
                    help="원래 옷 영역을 몇 px 넓혀서 가릴지. 원래 옷 테두리가 남으면 키우고, 주변 배경까지 번져 보이면 줄인다 (0=끔)")
    ap.add_argument("--publish", action="store_true", help="결과를 ../public/catalog 로 복사")
    ap.add_argument("--skip-pose-check", action="store_true",
                    help="모델 사진 표준 포즈 검사에서 불합격이어도 생성 (시험용. 품질 보장 안 됨)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    os.environ.setdefault("HF_HOME", str(HERE / "hf-cache"))
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    # 맥 GPU(MPS)가 지원하지 않는 연산은 CPU로 대신 처리
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    # 16GB 맥미니에서 메모리를 다 써 버려 재부팅되는 것을 막는다 (torch import 전에 설정해야 적용됨)
    # HIGH만 낮추면 기본 LOW(1.4)가 더 커서 "invalid low watermark ratio" 오류 → 반드시 LOW < HIGH
    os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", str(args.mps_memory))
    os.environ.setdefault("PYTORCH_MPS_LOW_WATERMARK_RATIO", str(round(float(os.environ["PYTORCH_MPS_HIGH_WATERMARK_RATIO"]) * 5 / 7, 3)))

    out: Path = args.out
    if (out / "layers").exists() and any((out / "layers").glob("*.png")) and not args.force:
        log.info("출력 폴더가 이미 있습니다: %s → 이미 만든 상품은 건너뜁니다. 다시 만들려면 --force(덮어씀) 또는 새 --out 이름", out)
    items = json.loads(args.items.read_text(encoding="utf-8"))
    if args.limit:
        items = items[: args.limit]
    items_dir = args.items.parent

    from fashn_human_parser import BODY_COVERAGE_TO_LABELS, CATEGORY_TO_BODY_COVERAGE, IDENTITY_LABELS, LABELS_TO_IDS
    from fashn_vton import TryOnPipeline

    import gc

    import torch

    def build(dev: str):
        p = TryOnPipeline(weights_dir=str(args.weights), device=dev)
        want = {"fp32": torch.float32, "bf16": torch.bfloat16, "fp16": torch.float16}.get(args.dtype)
        if want is None and dev == "mps":
            want = torch.bfloat16
        if want is not None and p.inference_dtype != want:
            p.tryon_model.to(dtype=want)
            p.inference_dtype = want
        log.info("정밀도: %s", str(p.inference_dtype).replace("torch.", ""))
        return p

    def free_memory():
        gc.collect()
        if hasattr(torch, "mps") and torch.backends.mps.is_available():
            torch.mps.empty_cache()

    # 모델 사진 검사: 무거운 착용 모델을 올리기 전에 먼저 (몇 초)
    pc = pose_check.check(pose_check.load_detector(args.weights), np.array(Image.open(args.model).convert("RGB")), str(args.model))
    log.info("모델 사진 검사: %s", pc.status)
    for e in pc.errors:
        log.warning("  ✗ %s", e)
    for w in pc.warnings:
        log.info("  ! %s", w)
    if not pc.ok:
        if not args.skip_pose_check:
            log.error("표준 포즈가 아니라 건너뜁니다 (docs/MODEL-PHOTO-GUIDE.md 참고). 그래도 돌리려면 --skip-pose-check")
            sys.exit(2)
        log.warning("--skip-pose-check: 불합격이지만 계속 진행합니다")

    t0 = time.perf_counter()
    if args.engine == "gpt":
        from fashn_human_parser import FashnHumanParser

        pipe, device = None, "gpt"
        hp = FashnHumanParser(device="cpu")  # 옷·피부 영역 분할만 맥에서
        max_side = 1536  # GPT 이미지 출력 최대 세로
        log.info("착용 생성: GPT (Codex %s, 모델 %s)", gpt_tryon.find_codex(), args.gpt_model)
    else:
        device = pick_device(args.device)
        log.info("장치: %s (%s %s)", device, platform.system(), platform.machine())
        try:
            pipe = build(device)
        except Exception as e:  # noqa: BLE001 - 맥 GPU 미지원 등: 시험이 멈추지 않게 CPU로 전환
            if device == "cpu":
                raise
            log.warning("%s에서 모델을 올리지 못해 CPU로 전환합니다: %s", device, e, exc_info=True)
            device = "cpu"
            pipe = build(device)
        hp = pipe.hp_model
        max_side = max(pipe.tryon_model.input_shape)
    log.info("모델 로드 %.1fs", time.perf_counter() - t0)

    # 고정 모델: 앱에 그대로 쓰일 기준 이미지. 착용 생성기 출력 해상도 이하로 맞춰 둔다.
    base_img = Image.open(args.model).convert("RGB")
    scale = min(1.0, max_side / max(base_img.size))
    if scale < 1.0:
        base_img = base_img.resize((round(base_img.width * scale), round(base_img.height * scale)), Image.LANCZOS)
    base = np.array(base_img)
    save_png(base, out / "model.png")

    # 보호 영역(얼굴·머리 등): 고정 모델에서 한 번만 계산. out/protect.png 를 손으로 고쳐도 된다.
    # base 분할: 보호 영역과 "원래 입고 있던 옷" 영역(테두리 잔존 방지)에 쓴다.
    base_seg = None if args.no_segmentation else hp.predict(base)
    # 가장자리 폭(--orig-dilate, feather)은 세로 864px 기준값 → 해상도에 비례해서 키운다
    px = base.shape[0] / 864
    orig_dilate, feather = round(args.orig_dilate * px), 1.0 * px
    protect_path = out / "protect.png"
    if protect_path.exists() and not args.force:
        protect = (np.array(Image.open(protect_path).convert("L")) > 127).astype(np.uint8) * 255
    else:
        seg = base_seg if base_seg is not None else hp.predict(base)
        protect = label_mask(seg, [LABELS_TO_IDS[l] for l in IDENTITY_LABELS if l in LABELS_TO_IDS])
        protect = cv2.erode(protect, np.ones((3, 3), np.uint8))  # 경계는 옷이 덮을 수 있게 살짝 안쪽만
        save_png(protect, protect_path)
    base_skin = None if base_seg is None else label_mask(base_seg, [LABELS_TO_IDS[l] for l in SKIN_LABELS if l in LABELS_TO_IDS])
    log.info("보호 영역 %.1f%% (%s)", protect.mean() / 2.55, ", ".join(IDENTITY_LABELS))

    timings_path = out / "timings.csv"
    new_file = not timings_path.exists()
    tf = open(timings_path, "a", newline="", encoding="utf-8")
    tw = csv.writer(tf)
    if new_file:
        tw.writerow(["id", "category", "device", "steps", "tryon_sec", "extract_sec", "coverage", "outside_noise", "protected_changed", "covered_other"])

    products = []
    layers_for_preview: dict[str, np.ndarray] = {}
    first_raw = None
    singles: list[tuple[str, np.ndarray]] = []  # 상품별 단독 합성본 (한눈에 보기용)
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
            log.info("[%d/%d] %s 건너뜀 (이미 있음, --force로 다시 생성)", i, len(items), pid)
        else:
            if args.engine == "gpt":
                try:
                    r = gpt_tryon.tryon_gpt(args.model, garment_src, cat, it["title"], out / "raw" / f"{pid}.png", gpt_model=args.gpt_model)
                except Exception as e:  # noqa: BLE001 - 한 상품 실패로 전체가 멈추지 않게
                    log.error("[%d/%d] %s 생성 실패: %s", i, len(items), pid, e)
                    if "limit" in str(e).lower():
                        log.error("구독 사용량 한도에 걸린 것 같습니다. 나머지는 한도가 풀린 뒤 같은 명령으로 이어서 (만든 것은 건너뜀)")
                        break
                    continue
                t_tryon = r.seconds
                log.info("[%d/%d] %s GPT 생성 %.0fs %s", i, len(items), pid, t_tryon, r.usage)
                tryon = np.array(Image.open(r.path).convert("RGB").resize(base_img.size, Image.LANCZOS))
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
                    log.warning("%s 생성 중 오류로 CPU로 전환해 다시 시도합니다: %s", device, e, exc_info=True)
                    pipe = None  # GPU에 올린 모델을 먼저 놓아준 뒤 CPU로 다시 올린다
                    free_memory()
                    device = "cpu"
                    pipe = build(device)
                    t1 = time.perf_counter()
                    res = pipe(**call)
                t_tryon = time.perf_counter() - t1
                tryon = np.array(res.images[0].convert("RGB").resize(base_img.size, Image.LANCZOS))
            save_png(tryon, out / "raw" / f"{pid}.png")

            t2 = time.perf_counter()
            gmask = excl = skin = orig = None
            if not args.no_segmentation:
                seg = hp.predict(tryon)
                cov_labels = BODY_COVERAGE_TO_LABELS[CATEGORY_TO_BODY_COVERAGE[TO_FASHN[cat]]]
                gmask, excl, skin = segment_masks(seg, cov_labels, LABELS_TO_IDS)
                orig = label_mask(base_seg, [LABELS_TO_IDS[l] for l in cov_labels if l in LABELS_TO_IDS])
            layer, st = extract_layer(base, tryon, garment_mask=gmask, exclude=excl, shadow_allowed=skin, protect=protect,
                                      orig_mask=orig, base_skin=base_skin, orig_dilate=orig_dilate, feather=feather)
            t_ext = time.perf_counter() - t2
            save_png(layer, layer_path)
            tw.writerow([pid, cat, device, args.steps if pipe is not None else "", f"{t_tryon:.1f}", f"{t_ext:.1f}", f"{st.coverage:.3f}", f"{st.outside_noise:.2f}", f"{st.protected_changed:.2f}", f"{st.covered_other:.4f}"])
            tf.flush()
            log.info(
                "[%d/%d] %s %s: 착용 %.1fs, 잘라내기 %.1fs, 덮는 면적 %.0f%%, 바깥 잡음 %.1f, 얼굴 변화 %.1f, 다른 옷 덮음 %.1f%%",
                i, len(items), pid, cat, t_tryon, t_ext, st.coverage * 100, st.outside_noise, st.protected_changed,
                st.covered_other * 100,
            )
            if st.covered_other > 0.005:
                log.warning("  %s: 새 옷이 원래 옷보다 작아 그 자리에 다른 옷(하의 등)이 그려졌습니다. 다른 하의와 조합하면 어색할 수 있음", pid)

        layers_for_preview[cat] = np.array(Image.open(layer_path).convert("RGBA"))
        raw_path = out / "raw" / f"{pid}.png"
        if raw_path.exists():
            raw = np.array(Image.open(raw_path).convert("RGB"))
            if first_raw is None:
                first_raw = raw
            single = composite(base, [layers_for_preview[cat]])
            side_by_side([("원본 모델", base), (f"AI 생성 원본 {pid}", raw), (f"{pid}만 합성", single)], out / "compare" / f"{pid}.png")
            singles.append((f"{pid} {it['title']}", single[::2, ::2]))
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
    preview_layers = [layers_for_preview[c][..., :4] for c in order]
    preview = composite(base, preview_layers)
    save_png(preview, out / "preview_composite.png")
    # 판단용: 잘라내기 전 생성 원본(raw.png)과 [원본 모델 | raw | 합성본] 비교
    if first_raw is not None:
        save_png(first_raw, out / "raw.png")
        side_by_side([("원본 모델", base), ("AI 생성 원본 (raw)", first_raw), ("합성본", preview)], out / "compare.png")
        log.info("비교 이미지: %s", out / "compare.png")
    if len(singles) > 1:
        side_by_side(singles, out / "overview.jpg")
        log.info("상품별 한눈에 보기: %s", out / "overview.jpg")

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
    code = 0
    try:
        main()
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        code = 1
    # 정상 종료 시 파이썬 정리 단계에서 onnxruntime·MPS 스레드가 꼬여
    # "libc++abi: ... recursive_mutex lock failed" 로 abort 된다. 결과 파일은 이미 다 썼으므로 정리를 건너뛰고 끝낸다.
    logging.shutdown()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
