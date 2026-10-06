"""잘라내기 정확도 테스트 (합성 데이터: 정답 마스크를 알고 있는 가짜 착용 결과).

실행: python -m unittest factory/test_extract.py   (저장소 루트에서)
"""

import io
import os
import sys
import unittest

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract import composite, extract_layer  # noqa: E402

H, W = 1024, 768
rng = np.random.default_rng(7)


def make_base():
    y, x = np.mgrid[0:H, 0:W]
    bg = np.dstack([235 - y * 0.03, 232 - y * 0.03, 226 - y * 0.02]).astype(np.float32)
    bg += rng.normal(0, 2.0, bg.shape)
    img = np.clip(bg, 0, 255).astype(np.uint8)
    skin = (226, 190, 165)
    cv2.ellipse(img, (384, 150), (70, 90), 0, 0, 360, skin, -1)  # 얼굴
    cv2.ellipse(img, (384, 95), (78, 50), 0, 180, 360, (45, 35, 30), -1)  # 머리카락
    cv2.rectangle(img, (250, 250), (518, 980), skin, -1)  # 몸
    cv2.rectangle(img, (270, 260), (498, 560), (205, 198, 188), -1)  # 기본 이너(탱크톱)
    protect = np.zeros((H, W), np.uint8)
    cv2.ellipse(protect, (384, 140), (82, 110), 0, 0, 360, 255, -1)
    return img, protect


def garment_truth():
    m = np.zeros((H, W), np.uint8)
    pts = np.array([[240, 255], [528, 255], [560, 420], [520, 640], [248, 640], [208, 420]], np.int32)
    cv2.fillPoly(m, [pts], 255)
    return m


def fake_tryon(base, truth, *, face_shift=6.0, global_noise=1.5, jpeg=92):
    out = base.astype(np.float32)
    # 줄무늬 옷
    y, x = np.mgrid[0:H, 0:W]
    stripe = ((y // 14) % 2 == 0)
    garment = np.where(stripe[..., None], np.array([40, 70, 140], np.float32), np.array([235, 235, 240], np.float32))
    out = np.where(truth[..., None] > 0, garment, out)
    # 옷 아래 그림자
    ring = cv2.dilate(truth, np.ones((17, 17), np.uint8)) & ~truth
    ring[:600] = 0
    out[ring > 0] *= 0.82
    # AI가 전체를 다시 그리며 생기는 미세 변화 + 얼굴의 약한 변화
    out += rng.normal(0, global_noise, out.shape)
    face = np.zeros((H, W), np.uint8)
    cv2.ellipse(face, (384, 150), (70, 90), 0, 0, 360, 255, -1)
    out[face > 0] += face_shift
    out = np.clip(out, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, format="JPEG", quality=jpeg)
    return np.array(Image.open(buf).convert("RGB"))


def iou(a, b):
    a, b = a > 0, b > 0
    return (a & b).sum() / max(1, (a | b).sum())


class ExtractTest(unittest.TestCase):
    def setUp(self):
        self.base, self.protect = make_base()
        self.truth = garment_truth()
        self.tryon = fake_tryon(self.base, self.truth)

    def test_color_diff_only(self):
        layer, stats = extract_layer(self.base, self.tryon, protect=self.protect)
        got = (layer[..., 3] > 127).astype(np.uint8) * 255
        self.assertGreater(iou(got, self.truth), 0.95, stats)
        self.assertEqual(int(layer[..., 3][self.protect > 0].max()), 0, "얼굴·머리는 레이어에 없어야 함")

    def test_with_imperfect_segmentation(self):
        seg = cv2.erode(self.truth, np.ones((7, 7), np.uint8))  # 분할이 가장자리를 조금 놓친 경우
        layer, _ = extract_layer(self.base, self.tryon, garment_mask=seg, protect=self.protect)
        got = (layer[..., 3] > 127).astype(np.uint8) * 255
        self.assertGreater(iou(got, self.truth), 0.96)

    def test_segmentation_fills_low_contrast_area(self):
        # 옷 일부가 base와 거의 같은 색이면 색차만으로는 구멍이 난다 → 분할이 메워야 함
        tryon = self.tryon.copy()
        patch = np.zeros_like(self.truth)
        cv2.rectangle(patch, (300, 300), (460, 380), 255, -1)
        tryon[patch > 0] = self.base[patch > 0]
        layer, _ = extract_layer(self.base, tryon, garment_mask=self.truth, protect=self.protect)
        self.assertGreater(float((layer[..., 3][patch > 0] > 127).mean()), 0.99)

    def test_composite_reproduces_tryon_in_garment(self):
        layer, _ = extract_layer(self.base, self.tryon, protect=self.protect)
        comp = composite(self.base, [layer])
        inner = cv2.erode(self.truth, np.ones((9, 9), np.uint8)) > 0
        err = np.abs(comp.astype(int) - self.tryon.astype(int))[inner].mean()
        self.assertLess(err, 2.0)
        # 레이어 밖은 base 그대로 (AI 잡음이 섞이지 않음)
        far = cv2.dilate(self.truth, np.ones((41, 41), np.uint8)) == 0
        far &= self.protect == 0
        self.assertLess(np.abs(comp.astype(int) - self.base.astype(int))[far].mean(), 0.5)

    def _shadow_ring(self):
        # 옷 가장자리의 부드러운 경계(약 4px) 바깥, 그림자가 있는 띠만
        ring = cv2.dilate(self.truth, np.ones((15, 15), np.uint8)) & ~cv2.dilate(self.truth, np.ones((9, 9), np.uint8))
        ring[:620] = 0
        return ring > 0

    def test_shadow_is_black_and_semi_transparent(self):
        layer, _ = extract_layer(self.base, self.tryon, protect=self.protect)
        ring = self._shadow_ring()
        a = layer[..., 3][ring].astype(float) / 255
        self.assertGreater(a.mean(), 0.08)
        self.assertLess(a.mean(), 0.6)
        self.assertLess(layer[..., :3][ring].mean(), 40, "그림자는 피부색이 아니라 검정이어야 함")
        comp = composite(self.base, [layer])
        self.assertLess(np.abs(comp.astype(int) - self.tryon.astype(int))[ring].mean(), 4.0)

    def test_shadow_does_not_paint_skin_over_another_bottom(self):
        # 같은 상의 레이어를 '파란 치마'를 입은 모델 위에 겹친다 → 그림자 자리는 파란색이 어두워져야지 피부색이 나오면 안 됨
        layer, _ = extract_layer(self.base, self.tryon, protect=self.protect)
        other = self.base.copy()
        other[600:] = (40, 60, 150)
        comp = composite(other, [layer])
        ring = self._shadow_ring()
        got = comp[ring].astype(float).mean(axis=0)
        self.assertGreater(got[2], got[0] + 40, f"그림자 자리 색 {got} — 파란 계열이어야 함")

if __name__ == "__main__":
    unittest.main()
