# viet — 가상 피팅 레이어 파이프라인 (맥미니 작업 환경)

## 작업 방식
- 답변과 설명은 한국어로, 짧고 직접적으로. 결정된 사항은 옵션을 다시 나열하지 말고 바로 실행할 것.
- 이상적인 결과보다 실제로 깨질 수 있는 지점(메모리, 디바이스, 품질)을 먼저 짚을 것.
- 사용자는 개발자가 아님. 터미널 명령은 복사해서 바로 실행 가능한 형태로 제시할 것.
- 오래 걸리는 실행(이미지 생성)은 돌리기 전에 예상 소요 시간을 알릴 것.

## 환경
- 머신: Mac mini M4, RAM 16GB, macOS 26.6.2 (2026-10-06 확인)
- 저장소: https://github.com/kjd1374/viet (브랜치 main)
- 로컬 경로: ~/viet (Claude Code 신뢰 폴더)
- 파이프라인 폴더: ~/viet/factory — 모든 실행은 여기서
- 파이썬: ~/viet/factory/.venv/bin/python (venv는 factory 안에 있음. ~/viet 루트에는 없음)
- 맥미니 안내 문서: ~/viet/docs/MAC-MINI-GUIDE.md
- 이 프로젝트는 원래 다른 PC에서 Claude Code로 개발했음. 그쪽 맥락은 없으니, 필요하면 git log와 코드를 직접 읽고 파악할 것.

## 구성 요소
- 진입점: factory/make_layers.py
- 착용 모델: factory/vendor/fashn-vton-1.5 (FASHN VTON 1.5, MMDiT 계열)
  - 가중치: factory/weights/model.safetensors
- 포즈 인식: DWPose — factory/weights/dwpose
- 인체 파싱: FashnHumanParser — Hugging Face fashn-ai/fashn-human-parser (실행 시 원격 확인 요청 발생)
- 테스트 입력: factory/in-sample/person5.png, factory/in-sample/items.json
- 출력: factory/out/<폴더>/ (레이어, preview_composite.png, catalog.json)

## 실행 명령 (MPS)
```
cd ~/viet/factory
PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.7 PYTORCH_MPS_LOW_WATERMARK_RATIO=0.5 \
.venv/bin/python make_layers.py --model in-sample/person5.png --items in-sample/items.json \
--out out/<새폴더> --steps 20 --limit 1
```
- 두 환경변수는 필수. 없으면 맥이 메모리 부족으로 먹통이 된 후 재부팅됨(실제 발생).
- HIGH만 1.4 미만으로 주면 "invalid low watermark ratio" 에러로 CPU 폴백됨 → 반드시 LOW를 HIGH보다 작게.
- 이제 make_layers.py가 두 값을 자동 설정함(HIGH 0.7, LOW 0.5). 위처럼 직접 줘도 됨.
- 정밀도: --dtype auto|fp32|bf16|fp16 (맥 기본 bf16). 폴백 시 traceback 전체가 로그에 남음.
- 출력 폴더는 매번 새 이름으로(mac-test, mac-test2, mac-test3 사용됨).

## 이미 적용한 수정 (유지할 것)
- factory/vendor/fashn-vton-1.5/src/fashn_vton/tryon_mmdit.py 35번째 줄 (RoPE):
  `dtype=torch.float64` → `dtype=(torch.float32 if pos.device.type == "mps" else torch.float64)`
  이유: MPS는 float64 미지원. 이 수정 전에는 생성 첫 스텝에서 CPU로 폴백됐음.
- vendor는 .gitignore 대상(서브모듈 아님) → 수정은 factory/patches/fashn-vton-mps.patch로 커밋,
  setup_mac.sh가 클론 직후 자동 적용함. vendor를 고치면 이 patch 파일도 다시 만들 것:
  `git -C factory/vendor/fashn-vton-1.5 diff > factory/patches/fashn-vton-mps.patch`

## 지금까지 테스트 결과
| 폴더 | 디바이스 / 정밀도 | 스텝당 | 착용 전체 | 품질 |
|---|---|---|---|---|
| out/mac-test | CPU / float32 | 24.3s | 491s | 옷 교체 깔끔. 단, 오른쪽 어깨·소매 끝에 원래 옷(핑크) 테두리가 남음 |
| out/mac-test2 | CPU / float32 (MPS 실패 폴백) | 22.2s | 450s | mac-test와 동일 수준 |
| out/mac-test3 | MPS / bfloat16 | 8.9s | 190s | 합성 결과는 엉망. 단, AI 생성 원본(raw/s01.png)은 CPU만큼 깨끗함 → 정밀도 문제 아님 |
| out/mac-test4 | MPS / bfloat16, 정면 사진 person2 | 9.7s | 199s | 깔끔. 핑크 띠 같은 문제 없음. 소매 끝·밑단에 원래 옷(파랑) 얇은 테두리만 남음 |

- 세 테스트 모두 상의 1개, 덮는 면적 5%, 보호 영역 3%(face, hair, jewelry, bag, glasses, hat).
- 테스트 모델 사진은 거울 셀카(폰을 든 손이 상체를 가림) — 최악 조건임.
- mac-test4부터는 FASHN 데모 person2(정면 전신, 손이 상체 안 가림, 티+면바지). person0~6은 in-sample에 받아 둠(get_samples.py와 같은 출처).

## mac-test3 분석 결과 (2026-10-06)
- 원인은 bf16이 아니라 레이어 합성 방식. AI가 새 티를 원래 핑크 티보다 짧게 만들었고(반바지 허리도 올림),
  레이어에는 새 옷만 들어가므로 그 아래 원래 핑크 옷이 그대로 비침 → 허리 핑크 띠.
- 즉 "새 옷이 원래 옷보다 작으면 원래 옷이 보인다"는 구조적 문제. 마스크 몇 px 확장(4-2)으로는 이 띠를 못 덮음.
- 대책: 모델 사진 표준에서 "몸에 붙는 얇은 기본 옷"을 입히는 것 + 원래 옷 영역을 레이어에 포함하는 보정.
- 비교 이미지: factory/out/compare/mac-test3-분석.jpg

## 1순위 과제: mac-test3 품질 원인 파악 (위 분석으로 정밀도 원인은 배제됨)
- CPU float32는 깔끔했고 MPS bfloat16은 망가짐 → 먼저 정밀도를 의심.
- MPS에서 float32 강제로 한 번 돌려 비교할 것 (메모리 압력 확인하면서). 깨끗하면 bfloat16이 원인.
- float32로 메모리가 부족하면 float16 시도. bfloat16은 MPS에서 연산 정확도 문제가 있을 수 있음.
- 그래도 깨지면 float32 수정 외 MPS 연산 차이(attention, 보간 등) 확인.
- 결과 판단은 수치 로그만 보지 말고 preview_composite.png를 사용자에게 확인받을 것.

## 2순위 과제: 체형 그룹 기반 레이어 재사용 구조
### 배경
현재는 모델 × 상품마다 AI 착용 생성(MPS 약 3분, CPU 약 8분). 레이어는 그 모델의 체형·포즈에 맞춰진 것이라 다른 모델에 그대로 못 씀.
→ 체형 그룹별 대표 모델에만 생성하고, 같은 그룹의 다른 모델에는 레이어를 변형해서 재사용.

### 1. 모델 사진 표준 (입력 검증)
- 정면 전신, A포즈(팔을 몸통에서 살짝 뗌), 손이 상체를 가리지 않을 것
- 단색 배경, 같은 촬영 거리·높이
- DWPose 키포인트로 자동 검사: 손목·팔꿈치가 몸통 영역과 겹치면 경고 후 건너뜀

### 2. 모델 목록: in-sample/models.json
```
[
  {"id": "m01", "image": "in-sample/m01.png", "group": "M", "base": true},
  {"id": "m02", "image": "in-sample/m02.png", "group": "M", "base": false}
]
```
- group마다 base: true인 대표 모델은 정확히 1명

### 3. make_layers.py 변경
- --models in-sample/models.json 옵션 추가 (기존 --model 유지)
- AI 생성은 base 모델에만
- 레이어 저장 시 base 모델의 DWPose 키포인트도 json으로 저장

### 4. 새 스크립트: transfer_layers.py
- 같은 group의 비대표 모델에 base 레이어를 옮겨 얹음
- 단순 비율 확대 금지. 키포인트 기준 정렬: 상의는 양 어깨·양 골반, 하의는 골반·무릎. 어파인 또는 구간별 변형
- 원본 모델 사진 위에 합성해서 저장. AI 생성 없음, 개당 수 초 목표

### 5. 검증 출력
- out/<폴더>/compare/에 [base 결과 | 옮겨 얹은 결과] 나란히 저장
- 옮긴 결과마다 어깨·골반 정렬 오차(px) 로그 출력

### 6. 유지
- tryon_mmdit.py MPS 수정 유지
- catalog.json 형식 유지, 모델 id·group 필드만 추가

### 7. 나중 단계 (지금 구현 금지)
- 상품 실측 사이즈(총장, 어깨너비)로 레이어 길이 보정

### 예상되는 실패 지점
- 소매·밑단 끝 어긋남 (팔 길이·각도 차이)
- base 모델 몸의 주름·그림자가 그대로 옮겨감 → 체형 차이가 크면 어색. 그룹을 잘게 나눌 것
- 상의·하의 레이어 조합 시 겹치는 부분(넣어 입기, 아우터) 어색할 수 있음
- 원래 옷 테두리 잔존(mac-test에서 확인) → 원본 옷 영역 마스크를 약간 확장하는 보정 검토

## 작업 규칙
- 수정 후 반드시 git commit + push (다른 PC와 동기화).
- vendor 코드 수정은 이 파일의 "이미 적용한 수정"에 기록.
- 새 테스트 결과는 "지금까지 테스트 결과" 표에 추가.
