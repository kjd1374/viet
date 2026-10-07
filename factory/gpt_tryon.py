"""GPT 이미지 생성(ChatGPT 구독, Codex CLI)으로 착용 이미지를 만든다. make_layers.py --engine gpt 에서 쓴다.

맥에 Codex 앱이 ChatGPT 계정으로 로그인돼 있으면 추가 결제 없이 구독 사용량 안에서 돈다
(이미지 생성은 텍스트보다 사용량을 3~5배 빨리 쓴다). API 키는 쓰지 않는다.

단독 시험:
  python gpt_tryon.py --model in-sample/m01.png --garment in-sample/garment7.jpg --category top --out out/gpt-one.png
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

APP_CODEX = "/Applications/Codex.app/Contents/Resources/codex"
# 맥 Codex 앱에 들어 있는 CLI(0.137 alpha)는 기본 모델(gpt-6-astra)을 거부한다 → 지원되는 모델을 지정. 앱을 업데이트하면 바꿀 수 있다
DEFAULT_MODEL = "gpt-5.5"

WHAT = {
    "top": ("top", "in place of the top she is currently wearing. Keep her current bottoms (shorts) exactly as they are"),
    "outer": ("outerwear", "worn over the top she is currently wearing. Keep her current top and bottoms as they are"),
    "bottom": ("bottoms", "in place of the bottoms (shorts) she is currently wearing. Keep her current top exactly as it is, untucked"),
    "dress": ("one-piece dress", "in place of both the top and the bottoms she is currently wearing"),
}


@dataclass
class GptResult:
    path: Path
    seconds: float
    usage: str  # 구독 사용량 표시 (모르면 빈 문자열)


def find_codex() -> str:
    exe = shutil.which("codex") or (APP_CODEX if Path(APP_CODEX).exists() else None)
    if not exe:
        raise RuntimeError("Codex CLI를 찾을 수 없습니다. Codex 앱을 설치하고 ChatGPT 계정으로 로그인하세요")
    return exe


def build_prompt(category: str, title: str, out_name: str, size: tuple[int, int]) -> str:
    noun, where = WHAT[category]
    return f"""Use your built-in image generation tool directly (do not write scripts, do not call any API).
Image 1 is the base fashion model photo. Image 2 is a product photo of a garment ({noun}; product name: "{title}").
Edit image 1 so the model wears ONLY that {noun} from image 2, {where}.
If image 2 shows a person or several garments, ignore everything in it except that {noun}.
Reproduce the garment faithfully: color, fabric, pattern, print or logo, neckline, sleeves, length and silhouette, fitted naturally to her body.
Keep everything else identical to image 1: same face, hair, body shape, pose, arm and hand positions, bare feet, background, lighting, framing and camera position. Do not crop, zoom or shift the image.
Output a portrait image {size[0]}x{size[1]}. Save the final image as {out_name} in the current directory and reply with its path."""


def _usage_from_sessions(since: float) -> str:
    """Codex 세션 기록(~/.codex/sessions)에서 구독 사용량(%)을 읽는다. exec --json 출력에는 없다. 형식이 바뀌면 빈 문자열."""
    root = Path.home() / ".codex" / "sessions"
    files = sorted((f for f in root.rglob("*.jsonl") if f.stat().st_mtime >= since), key=lambda f: f.stat().st_mtime)
    if not files:
        return ""
    return _usage_from_events(files[-1].read_text(encoding="utf-8", errors="ignore").splitlines())


def _usage_from_events(lines: list[str]) -> str:
    last = None
    for ln in lines:
        if "rate_limits" not in ln:
            continue
        try:
            ev = json.loads(ln)
        except json.JSONDecodeError:
            continue
        stack = [ev]
        while stack:
            x = stack.pop()
            if isinstance(x, dict):
                if "rate_limits" in x and isinstance(x["rate_limits"], dict):
                    last = x["rate_limits"]
                stack.extend(x.values())
            elif isinstance(x, list):
                stack.extend(x)
    if not last:
        return ""
    parts = []
    for key in ("primary", "secondary"):
        r = last.get(key)
        if isinstance(r, dict) and "used_percent" in r:
            win = r.get("window_minutes") or 0
            label = f"{win // 1440}일" if win >= 1440 else f"{win // 60}시간"
            parts.append(f"구독 사용량({label} 기준) {r['used_percent']:.0f}%")
    return ", ".join(parts)


def tryon_gpt(model_image: Path, garment_image: Path, category: str, title: str, out_path: Path, *,
              size: tuple[int, int] = (1024, 1536), codex: str | None = None, gpt_model: str = DEFAULT_MODEL,
              timeout: int = 600, retries: int = 1) -> GptResult:
    codex = codex or find_codex()
    work = out_path.parent / "gpt_work" / out_path.stem
    work.mkdir(parents=True, exist_ok=True)
    out_name = "result.png"
    prompt = build_prompt(category, title, out_name, size)
    cmd = [codex, "exec", "--json", "-m", gpt_model, "--skip-git-repo-check", "-s", "workspace-write", "-C", str(work),
           "-i", str(Path(model_image).resolve()), "-i", str(Path(garment_image).resolve())]
    last_err = ""
    for attempt in range(retries + 1):
        (work / out_name).unlink(missing_ok=True)
        t0, wall0 = time.perf_counter(), time.time()
        # -i 는 파일을 여러 개 받아서 뒤에 오는 글자도 파일로 읽는다 → 프롬프트는 stdin으로
        p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout)
        dt = time.perf_counter() - t0
        lines = p.stdout.splitlines()
        (work / f"codex_{attempt}.jsonl").write_text(p.stdout + "\n--- stderr ---\n" + p.stderr, encoding="utf-8")
        if (work / out_name).exists():
            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(work / out_name, out_path)
            return GptResult(out_path, dt, _usage_from_sessions(wall0 - 1))
        errs = [ln for ln in lines if '"error"' in ln or "usage limit" in ln.lower()]
        last_err = (errs[-1] if errs else p.stderr.strip().splitlines()[-1:] or ["결과 파일 없음"])
        last_err = last_err if isinstance(last_err, str) else last_err[0]
        if "usage limit" in last_err.lower() or "rate limit" in last_err.lower():
            break  # 사용량 한도: 재시도해도 소용없음
    raise RuntimeError(f"GPT 생성 실패 ({garment_image.name}): {last_err[:300]}  (로그: {work})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, type=Path)
    ap.add_argument("--garment", required=True, type=Path)
    ap.add_argument("--category", required=True, choices=list(WHAT))
    ap.add_argument("--title", default="")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--gpt-model", default=DEFAULT_MODEL)
    a = ap.parse_args()
    r = tryon_gpt(a.model, a.garment, a.category, a.title, a.out, gpt_model=a.gpt_model)
    print(f"완료 {r.path} ({r.seconds:.0f}s) {r.usage}")


if __name__ == "__main__":
    main()
