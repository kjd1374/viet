"""모델 사진이 표준 포즈인지 DWPose 키포인트로 검사한다.

표준: 정면 전신, A포즈(팔을 몸통에서 살짝 뗌), 손·팔이 상체를 가리지 않음, 단색 배경, 같은 촬영 거리.
자세한 촬영 방법: docs/MODEL-PHOTO-GUIDE.md

  python pose_check.py in-sample/person*.png        # 여러 장 한 번에
  → 사진마다 통과 / 주의 / 불합격 과 이유를 출력하고, out/pose-check/ 에 키포인트를 그린 확인용 이미지를 저장

불합격(오류): 손목·팔꿈치·아래팔이 몸통과 겹침, 정면이 아님, 전신이 아님, 사람을 못 찾음 → 착용 생성에서 건너뛴다
주의: A포즈가 아님(팔이 몸에 붙음), 사람 크기·위치가 표준과 다름, 배경이 단색이 아님 → 생성은 하되 품질이 떨어질 수 있음
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent

# OpenPose 18점 순서 (DWPose 출력). R/L은 사람 기준 (정면 사진에서 R은 화면 왼쪽)
KP = dict(nose=0, neck=1, r_shoulder=2, r_elbow=3, r_wrist=4, l_shoulder=5, l_elbow=6, l_wrist=7,
          r_hip=8, r_knee=9, r_ankle=10, l_hip=11, l_knee=12, l_ankle=13, r_eye=14, l_eye=15, r_ear=16, l_ear=17)
VISIBLE = 0.3

# 판정 기준 (데모 사진 7장으로 맞춤. 표준 사진이 모이면 다시 조정)
TORSO_SHRINK = 0.9  # 몸통 사각형(양 어깨·양 골반)을 중심 쪽으로 이만큼 줄여서 겹침 판정 (경계에 걸친 건 봐줌)
MAX_SHOULDER_TILT = 10.0  # 어깨선 기울기(도)
MAX_NOSE_OFFSET = 0.25  # 코가 어깨 중앙에서 어깨너비의 몇 배까지 벗어나도 되나
MIN_SHOULDER_RATIO = 0.55  # 어깨너비 / 몸통 길이(목~골반 중앙). 옆으로 돌면 작아진다
MIN_ARM_ANGLE = 8.0  # A포즈: 어깨→손목 선이 수직에서 바깥쪽으로 벌어진 각도(도)
MIN_KNEE_RATIO = 0.55  # 골반→무릎 세로 거리 / 몸통 길이. 서 있으면 0.75 이상, 앉으면 0.4 안팎
HEIGHT_RANGE = (0.70, 0.95)  # 사람 키(머리~발목) / 사진 높이
MAX_BG_STD = 18.0  # 좌우 가장자리 배경 밝기 표준편차


@dataclass
class PoseResult:
    path: str
    status: str = "통과"  # 통과 | 주의 | 불합격
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    keypoints: dict[str, list[float]] = field(default_factory=dict)  # 이름 → [x, y, 점수] (픽셀)
    size: tuple[int, int] = (0, 0)  # (가로, 세로)

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_json(self) -> dict:
        return {"image": self.path, "status": self.status, "errors": self.errors, "warnings": self.warnings,
                "width": self.size[0], "height": self.size[1], "keypoints": self.keypoints}


def load_detector(weights: Path = HERE / "weights"):
    from fashn_vton.dwpose.wholebody import Wholebody

    return Wholebody(checkpoints_dir=str(weights / "dwpose"), device="cpu")


def detect(detector, rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """가장 크게 찍힌 사람 한 명의 18점 (픽셀 좌표 18x2, 점수 18)."""
    kps, scores = detector(rgb[..., ::-1].copy())  # DWPose는 BGR
    if len(kps) == 0:
        return None
    body, sc = kps[:, :18], scores[:, :18]
    areas = []
    for k, s in zip(body, sc):
        v = k[s > VISIBLE]
        areas.append(0 if len(v) < 2 else np.ptp(v[:, 0]) * np.ptp(v[:, 1]))
    i = int(np.argmax(areas))
    return body[i].astype(np.float64), sc[i].astype(np.float64)


def _inside(poly: np.ndarray, pt: np.ndarray) -> bool:
    return cv2.pointPolygonTest(poly.astype(np.float32), (float(pt[0]), float(pt[1])), False) > 0


def _outward_angle(shoulder: np.ndarray, wrist: np.ndarray, side: str) -> float:
    """어깨→손목 선이 수직에서 몸 바깥쪽으로 벌어진 각도(도). 안쪽이면 음수. 화면 왼쪽이 사람의 오른쪽."""
    v = wrist - shoulder
    dx = -v[0] if side == "r" else v[0]
    return float(np.degrees(np.arctan2(dx, max(v[1], 1e-6))))


def check(detector, rgb: np.ndarray, path: str = "") -> PoseResult:
    h, w = rgb.shape[:2]
    res = PoseResult(path=path, size=(w, h))
    found = detect(detector, rgb)
    if found is None:
        res.errors.append("사람을 찾지 못함")
        res.status = "불합격"
        return res
    pts, sc = found
    res.keypoints = {n: [round(float(pts[i][0]), 1), round(float(pts[i][1]), 1), round(float(sc[i]), 3)] for n, i in KP.items()}
    vis = lambda n: sc[KP[n]] > VISIBLE  # noqa: E731
    P = lambda n: pts[KP[n]]  # noqa: E731

    # 1) 전신: 어깨·골반·무릎·발목이 모두 보여야 함
    missing = [n for n in ("r_shoulder", "l_shoulder", "r_hip", "l_hip", "r_knee", "l_knee", "r_ankle", "l_ankle") if not vis(n)]
    if missing:
        res.errors.append("전신이 아님 (안 보이는 곳: " + ", ".join(missing) + ")")
        res.status = "불합격"
        return res

    rs, ls, rh, lh = P("r_shoulder"), P("l_shoulder"), P("r_hip"), P("l_hip")
    sw = float(np.linalg.norm(ls - rs))
    mid_s, mid_h = (rs + ls) / 2, (rh + lh) / 2
    torso_len = float(np.linalg.norm(mid_h - mid_s))

    knee_y = (P("r_knee")[1] + P("l_knee")[1]) / 2
    if (knee_y - mid_h[1]) / max(torso_len, 1e-6) < MIN_KNEE_RATIO:
        res.errors.append("서 있는 자세가 아님 (앉았거나 무릎을 굽힘)")

    # 2) 정면: 화면 왼쪽에 사람의 오른쪽 어깨, 어깨선 수평, 얼굴이 어깨 중앙, 어깨가 충분히 넓게 보임
    if rs[0] >= ls[0] or rh[0] >= lh[0]:
        res.errors.append("뒷모습이거나 몸이 크게 돌아감 (좌우 어깨·골반 순서가 반대)")
    tilt = float(np.degrees(np.arctan2(abs(ls[1] - rs[1]), max(abs(ls[0] - rs[0]), 1e-6))))
    if tilt > MAX_SHOULDER_TILT:
        res.errors.append(f"어깨선이 {tilt:.0f}° 기울어짐 (최대 {MAX_SHOULDER_TILT:.0f}°)")
    if sw / max(torso_len, 1e-6) < MIN_SHOULDER_RATIO:
        res.errors.append(f"정면이 아님 (어깨너비/몸통길이 {sw / torso_len:.2f}, 최소 {MIN_SHOULDER_RATIO})")
    if vis("nose"):
        off = abs(P("nose")[0] - mid_s[0]) / max(sw, 1e-6)
        if off > MAX_NOSE_OFFSET:
            res.errors.append(f"얼굴이 옆을 봄 (코가 어깨 중앙에서 어깨너비의 {off:.2f}배 벗어남)")
    if not (vis("r_eye") and vis("l_eye")):
        res.errors.append("두 눈이 다 보이지 않음 (얼굴이 가려졌거나 돌아감)")

    # 3) 손·팔이 상체를 가리는지: 손목·팔꿈치·아래팔이 몸통 사각형 안에 들어오면 불합격
    torso = np.array([rs, ls, lh, rh])
    c = torso.mean(axis=0)
    torso_in = c + (torso - c) * TORSO_SHRINK
    covered = set()
    for side, label in (("r", "오른"), ("l", "왼")):
        e, wr = f"{side}_elbow", f"{side}_wrist"
        hits = []
        if vis(e) and _inside(torso_in, P(e)):
            hits.append("팔꿈치")
        if vis(wr) and _inside(torso_in, P(wr)):
            hits.append("손목")
        if not hits and vis(e) and vis(wr):
            if any(_inside(torso_in, P(e) + (P(wr) - P(e)) * t) for t in np.linspace(0.1, 0.9, 9)):
                hits.append("아래팔")
        if hits:
            covered.add(side)
            res.errors.append(f"{label}팔이 상체를 가림 ({', '.join(hits)})")
        elif not vis(wr):
            res.warnings.append(f"{label}손목이 안 보임 (가려졌거나 화면 밖)")

    # 4) A포즈: 팔이 몸통에서 살짝 떨어져야 함 (주의만)
    for side, label in (("r", "오른"), ("l", "왼")):
        wr = f"{side}_wrist"
        if side not in covered and vis(wr):
            ang = _outward_angle(P(f"{side}_shoulder"), P(wr), side)
            if ang < MIN_ARM_ANGLE:
                res.warnings.append(f"{label}팔이 몸에 붙음 (바깥으로 벌린 각도 {ang:.0f}°, 권장 {MIN_ARM_ANGLE:.0f}° 이상)")

    # 5) 촬영 거리·위치 (주의만)
    top = min(p[1] for n, p in zip(KP, pts) if sc[KP[n]] > VISIBLE)
    bottom = max(P("r_ankle")[1], P("l_ankle")[1])
    frac = (bottom - top) / h
    if not (HEIGHT_RANGE[0] <= frac <= HEIGHT_RANGE[1]):
        res.warnings.append(f"사람 크기가 표준과 다름 (머리~발목이 사진 높이의 {frac:.0%}, 권장 {HEIGHT_RANGE[0]:.0%}~{HEIGHT_RANGE[1]:.0%})")
    cx = (mid_s[0] + mid_h[0]) / 2 / w
    if abs(cx - 0.5) > 0.1:
        res.warnings.append(f"사람이 가운데에 있지 않음 (가로 위치 {cx:.0%})")

    # 6) 배경: 좌우 가장자리 띠의 밝기 편차 (주의만)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    band = max(4, int(w * 0.08))
    bg_std = float(np.concatenate([gray[:, :band].ravel(), gray[:, -band:].ravel()]).std())
    if bg_std > MAX_BG_STD:
        res.warnings.append(f"배경이 단색이 아님 (가장자리 밝기 편차 {bg_std:.0f}, 권장 {MAX_BG_STD:.0f} 이하)")

    res.status = "불합격" if res.errors else ("주의" if res.warnings else "통과")
    return res


def draw(rgb: np.ndarray, res: PoseResult) -> np.ndarray:
    img = rgb.copy()
    k = {n: (int(v[0]), int(v[1])) for n, v in res.keypoints.items() if v[2] > VISIBLE}
    if all(n in k for n in ("r_shoulder", "l_shoulder", "l_hip", "r_hip")):
        poly = np.array([k["r_shoulder"], k["l_shoulder"], k["l_hip"], k["r_hip"]], np.int32)
        cv2.polylines(img, [poly], True, (255, 200, 0), 2)
    for a, b in (("r_shoulder", "r_elbow"), ("r_elbow", "r_wrist"), ("l_shoulder", "l_elbow"), ("l_elbow", "l_wrist"),
                 ("r_hip", "r_knee"), ("r_knee", "r_ankle"), ("l_hip", "l_knee"), ("l_knee", "l_ankle")):
        if a in k and b in k:
            cv2.line(img, k[a], k[b], (0, 200, 255), 2)
    for p in k.values():
        cv2.circle(img, p, 4, (255, 0, 80), -1)
    color = {"통과": (40, 170, 60), "주의": (230, 150, 0), "불합격": (220, 30, 30)}[res.status]
    cv2.rectangle(img, (0, 0), (img.shape[1], 10), color, -1)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", nargs="+", type=Path)
    ap.add_argument("--out", default=HERE / "out" / "pose-check", type=Path, help="확인용 이미지·키포인트 저장 폴더")
    ap.add_argument("--weights", default=HERE / "weights", type=Path)
    args = ap.parse_args()

    det = load_detector(args.weights)
    args.out.mkdir(parents=True, exist_ok=True)
    n_bad = 0
    for p in args.images:
        rgb = np.array(Image.open(p).convert("RGB"))
        res = check(det, rgb, str(p))
        n_bad += not res.ok
        print(f"[{res.status}] {p.name}")
        for e in res.errors:
            print("   ✗", e)
        for wmsg in res.warnings:
            print("   !", wmsg)
        Image.fromarray(draw(rgb, res)).save(args.out / f"{p.stem}.jpg", quality=88)
        (args.out / f"{p.stem}.json").write_text(json.dumps(res.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"확인용 이미지: {args.out}")
    sys.exit(1 if n_bad else 0)


if __name__ == "__main__":
    main()
