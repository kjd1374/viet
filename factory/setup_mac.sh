#!/usr/bin/env bash
# 맥미니(Apple Silicon)용 레이어 공장 설치.
# 저장소 폴더에서:  bash factory/setup_mac.sh
# 필요: uv (brew install uv), git
set -euo pipefail
cd "$(dirname "$0")"

command -v uv >/dev/null || { echo "uv가 필요합니다:  brew install uv"; exit 1; }
command -v git >/dev/null || { echo "git이 필요합니다:  xcode-select --install"; exit 1; }

echo "1/4 FASHN 착용 모델 코드 받기"
[ -d vendor/fashn-vton-1.5 ] || git clone --depth 1 https://github.com/fashn-AI/fashn-vton-1.5.git vendor/fashn-vton-1.5

echo "2/4 파이썬 환경 만들기"
uv venv --python 3.11 .venv
# FASHN은 NVIDIA용 onnxruntime-gpu를 요구하지만 macOS용이 없다 → 의존성을 직접 지정하고 본체는 --no-deps로 설치
uv pip install --python .venv/bin/python \
  torch torchvision safetensors huggingface_hub pillow numpy opencv-python tqdm einops onnxruntime matplotlib fashn-human-parser
uv pip install --python .venv/bin/python --no-deps -e vendor/fashn-vton-1.5

echo "3/4 모델 가중치 받기 (약 2.3GB)"
export HF_HOME="$PWD/hf-cache"
(cd vendor/fashn-vton-1.5 && ../../.venv/bin/python scripts/download_weights.py --weights-dir ../../weights)

echo "4/4 확인"
.venv/bin/python -c "import torch, fashn_vton; print('PyTorch', torch.__version__, '/ 맥 GPU(MPS) 사용 가능:', torch.backends.mps.is_available())"
echo "설치 완료. 다음: docs/MAC-MINI-GUIDE.md 의 3단계"
