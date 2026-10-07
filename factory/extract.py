"""착용 결과 이미지에서 '옷 레이어'만 떼어낸다.

전제: 모든 착용 결과는 같은 고정 모델 사진(base)에서 출발한다. FASHN은 사람 사진 전체를 다시 그리므로
얼굴·배경도 미세하게 달라질 수 있다. 그래서
  1) base와의 색 차이(어디가 바뀌었나) + 2) 옷 영역 분할(선택) 을 함께 써서 옷만 고르고,
  3) 얼굴·머리(보호 영역)는 절대 레이어에 넣지 않으며,
  4) 가장자리는 부드럽게, 옷이 피부에 드리운 그림자는 반투명으로 남긴다.
결과는 base와 같은 크기의 RGBA PNG → 앱에서 base 위에 겹치기만 하면 된다.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class LayerStats:
    coverage: float  # 레이어가 덮는 화면 비율
    outside_noise: float  # 레이어 밖에서 base와 달라진 정도(평균 색차). 클수록 AI가 다른 곳도 바꿨다는 뜻
    protected_changed: float  # 보호 영역(얼굴·머리)에서의 평균 색차
    covered_other: float = 0.0  # 원래 옷 자리를 덮으면서 다른 옷(예: 하의)까지 레이어에 들어간 화면 비율. 크면 조합 시 어색할 수 있음


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    h, w = mask.shape
    flood = mask.copy()
    ff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, ff, (0, 0), 255)
    return mask | cv2.bitwise_not(flood)


def _keep_large(mask: np.ndarray, min_frac: float) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros_like(mask)
    min_area = min_frac * mask.size
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            keep[labels == i] = 255
    return keep


def extract_layer(
    base: np.ndarray,
    tryon: np.ndarray,
    *,
    garment_mask: np.ndarray | None = None,
    exclude: np.ndarray | None = None,
    shadow_allowed: np.ndarray | None = None,
    protect: np.ndarray | None = None,
    orig_mask: np.ndarray | None = None,
    base_skin: np.ndarray | None = None,
    orig_dilate: int = 6,
    diff_thresh: float = 14.0,
    feather: float = 1.0,
    shadow_ring: int = 0,
    min_component: float = 0.002,
) -> tuple[np.ndarray, LayerStats]:
    """
    base, tryon: HxWx3 uint8 RGB (tryon은 base 크기로 맞춰서 넘길 것)
    garment_mask: 분할 모델이 찾은 옷 영역(0/255). 있으면 이것을 중심으로, 색차로 가장자리를 보강한다.
    exclude: 분할 모델이 피부·다른 종류의 옷으로 판정한 영역(0/255). 색차로 보강할 때 딸려 들어오지 않게 뺀다
             (예: 상의 밑단에 원래 모델의 청바지 허리띠가 묻어 나오는 것)
    shadow_allowed: 그림자를 남겨도 되는 영역(피부). 원래 옷이 다른 옷으로 바뀐 자리를 그림자로 오판하지 않게 한다.
    protect: 얼굴·머리 등 레이어에 절대 넣지 않을 영역(0/255)
    orig_mask: base에서 원래 입고 있던 같은 종류 옷의 영역(0/255). orig_dilate px 넓혀서, 새 옷이 덮지 않는 부분은
               착용 결과(AI가 그린 피부·배경)로 채운다 → 원래 옷이 새 옷 밖으로 비치거나 테두리로 남지 않는다.
    base_skin: base의 피부 영역(0/255). 새 옷 둘레 orig_dilate px 안의 피부도 착용 결과로 채운다.
               민소매 모델에 반팔을 입히면 base의 맨어깨가 새 옷 가장자리 밖으로 1~2px 비쳐 살색 번짐이 생기고,
               소매 밑 팔의 실제 그림자도 이 띠에 그대로 담긴다.
    shadow_ring: 옷 둘레 피부를 "검은 반투명"으로 어둡게 하는 폭(px). base_skin 띠가 실제 그림자를 담으므로 기본은 끔.
                 켜면 AI 결과 피부가 전체적으로 어두울 때 팔에 검은 얼룩이 생긴다 (std-m01에서 확인).
    반환: HxWx4 uint8 RGBA, 품질 지표
    """
    assert base.shape == tryon.shape, "tryon을 base 크기로 맞춰야 합니다"
    lab_b = cv2.cvtColor(base, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab_t = cv2.cvtColor(tryon, cv2.COLOR_RGB2LAB).astype(np.float32)
    blur = lambda x: cv2.GaussianBlur(x, (5, 5), 0)  # noqa: E731
    d = blur(np.linalg.norm(lab_t - lab_b, axis=2))
    d_light = blur(lab_t[..., 0] - lab_b[..., 0])
    d_color = blur(np.linalg.norm(lab_t[..., 1:] - lab_b[..., 1:], axis=2))
    changed = (d > diff_thresh).astype(np.uint8) * 255
    # 그림자: 색은 그대로인데 밝기만 떨어진 곳. 옷이 아니라 "아래를 어둡게 하는 막"으로 따로 다룬다.
    shadow_like = ((d_light < -3) & (d_color < 6)).astype(np.uint8) * 255

    if garment_mask is not None:
        near = cv2.dilate(garment_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        extra = changed & near & cv2.bitwise_not(shadow_like)
        if exclude is not None:
            extra = extra & cv2.bitwise_not(exclude)
        core = garment_mask | extra
    else:
        core = changed & cv2.bitwise_not(shadow_like)

    if protect is not None:
        core = core & cv2.bitwise_not(protect)

    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    k7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    core = cv2.morphologyEx(core, cv2.MORPH_OPEN, k3)
    core = cv2.morphologyEx(core, cv2.MORPH_CLOSE, k7)
    core = _keep_large(core, min_component)
    core = _fill_holes(core)
    if exclude is not None:
        core = core & cv2.bitwise_not(exclude)
    if protect is not None:
        core = core & cv2.bitwise_not(protect)

    # 원래 옷 가리기: 새 옷(core) 밖으로 남는 원래 옷 자리 + 몇 px 여유. 가장자리 처리는 core와 합친 영역 기준으로 한다.
    garment = core
    cover = np.zeros_like(core)
    if orig_mask is not None and orig_mask.any():
        o = orig_mask
        if orig_dilate > 0:
            o = cv2.dilate(o, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * orig_dilate + 1,) * 2))
        cover = o & cv2.bitwise_not(core)
    if base_skin is not None and orig_dilate > 0:
        near = cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * orig_dilate + 1,) * 2))
        cover = cover | (base_skin & near & cv2.bitwise_not(core))
    if protect is not None:
        cover = cover & cv2.bitwise_not(protect)
    core = core | cover

    # 옷: 가장자리를 "안쪽으로" 부드럽게 한다 (경계에서 0 → 안쪽 약 2σ에서 1).
    # 바깥으로 번지게 하면 착용 결과의 피부·원래 옷 색이 테두리로 묻어 나와, 다른 옷 위에 겹칠 때 띠가 보인다.
    if feather > 0:
        a_g = np.clip(2.0 * cv2.GaussianBlur(core.astype(np.float32) / 255.0, (0, 0), feather) - 1.0, 0.0, 1.0)
    else:
        a_g = core.astype(np.float32) / 255.0

    # 가장자리 색 정리: 반투명 테두리의 색을 안쪽 옷 색으로 바꾼다 (정규화 블러로 안쪽 색만 바깥으로 번지게)
    # 새 옷 가장자리 중 레이어 바깥과 맞닿은 곳만. 원래 옷 가린 자리(cover)는 AI가 그린 피부·배경 색을 그대로 둔다
    # (여기에 옷 색을 번지게 하면 cover 바깥 테두리에 검은 선이 생긴다).
    r = max(1, int(np.ceil(2.5 * feather)))
    kr = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    inner = cv2.erode(garment, kr)
    if inner.any():
        known = (inner > 0).astype(np.float32)
        num = cv2.GaussianBlur(tryon.astype(np.float32) * known[..., None], (0, 0), r)
        den = cv2.GaussianBlur(known, (0, 0), r)[..., None]
        inside_color = num / np.maximum(den, 1e-4)
        outer_edge = cv2.erode(core, kr) == 0
        band = ((a_g > 0) & (a_g < 0.98) & (garment > 0) & (inner == 0) & outer_edge & (den[..., 0] > 0.02))[..., None]
        tryon = np.where(band, np.clip(inside_color, 0, 255), tryon.astype(np.float32)).astype(np.uint8)

    # 그림자: 옷 주변 띠에서 base 대비 어두워진 비율만큼 "검은색 반투명".
    # 피부색을 싣지 않으므로 어떤 하의 위에 겹쳐도 그 하의를 자연스럽게 어둡게만 한다.
    a_s = np.zeros_like(a_g)
    if shadow_ring > 0:
        ring = cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * shadow_ring + 1,) * 2))
        ring = ring & cv2.bitwise_not(core) & shadow_like
        if shadow_allowed is not None:
            ring = ring & shadow_allowed
        if protect is not None:
            ring = ring & cv2.bitwise_not(protect)
        y_b = base.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
        y_t = tryon.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
        dark = np.clip(1.0 - (y_t + 1.0) / (y_b + 1.0), 0.0, 0.6)
        a_s = cv2.GaussianBlur(np.where(ring > 0, dark, 0.0).astype(np.float32), (0, 0), 1.0)

    alpha = np.clip(a_g + a_s * (1.0 - a_g), 0.0, 1.0)
    if protect is not None:
        alpha[protect > 0] = 0.0
    # 직선(비곱셈) 알파의 색: 옷 부분은 착용 결과 색, 그림자 부분은 검정
    rgb = tryon.astype(np.float32) * (a_g / np.maximum(alpha, 1e-6))[..., None]
    rgba = np.dstack([np.clip(rgb + 0.5, 0, 255).astype(np.uint8), (alpha * 255 + 0.5).astype(np.uint8)])

    outside = (cv2.dilate(core, k7) == 0) & ((protect == 0) if protect is not None else True)
    other = cover > 0
    if exclude is not None:
        other &= exclude > 0
        if shadow_allowed is not None:
            other &= shadow_allowed == 0
    else:
        other[:] = False
    stats = LayerStats(
        coverage=float((alpha > 0.5).mean()),
        outside_noise=float(d[outside].mean()) if np.any(outside) else 0.0,
        protected_changed=float(d[protect > 0].mean()) if protect is not None and np.any(protect) else 0.0,
        covered_other=float(other.mean()),
    )
    return rgba, stats


def composite(base: np.ndarray, layers: list[np.ndarray]) -> np.ndarray:
    """앱과 같은 방식으로 겹친다 (검증·미리보기용)."""
    out = base.astype(np.float32)
    for lay in layers:
        a = lay[..., 3:4].astype(np.float32) / 255.0
        out = lay[..., :3].astype(np.float32) * a + out * (1 - a)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


SKIN_LABELS = ("arms", "hands", "legs", "feet", "torso")


def segment_masks(seg: np.ndarray, coverage_labels: list[str], labels_to_ids: dict[str, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """분할 결과 → (이 옷 영역, 빼야 할 영역=배경·이 옷을 제외한 모든 것, 피부 영역)"""
    keep = [labels_to_ids[l] for l in coverage_labels if l in labels_to_ids]
    bg = labels_to_ids.get("background", 0)
    garment = np.isin(seg, keep)
    exclude = ~garment & (seg != bg)
    skin = np.isin(seg, [labels_to_ids[l] for l in SKIN_LABELS if l in labels_to_ids])
    return garment.astype(np.uint8) * 255, exclude.astype(np.uint8) * 255, skin.astype(np.uint8) * 255
