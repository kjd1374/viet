# viet — 가상 피팅 레이어 파이프라인 (맥미니 작업 환경)

## 작업 방식
- 답변과 설명은 한국어로, 짧고 직접적으로. 결정된 사항은 옵션을 다시 나열하지 말고 바로 실행할 것.
- 이상적인 결과보다 실제로 깨질 수 있는 지점(메모리, 디바이스, 품질)을 먼저 짚을 것.
- 사용자는 개발자가 아님. 터미널 명령은 복사해서 바로 실행 가능한 형태로 제시할 것.
- 오래 걸리는 실행(이미지 생성)은 돌리기 전에 예상 소요 시간을 알릴 것.

## 환경
- 머신: Mac mini M4, RAM 16GB, macOS 26.6.2 (2026-10-06 확인)
- 디스크 여유 4.9GB (2026-10-07, 98% 사용). 메모리 부족 시 스왑할 공간이 적어 위험 → 큰 모델 다운로드 금지, 사용자에게 정리 권유
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
- 표준 모델 사진(사용자가 AI로 생성, 1024x1536): in-sample/m01.png 슬림·base / m02.png m01과 같은 체형+안경 / m03.png 곡선 체형
  (2026-10-07 받은 파일은 m02·m03이 뒤바뀌어 있어 이름을 맞바꿈). in-sample/models.json: m01·m02 그룹 S(m01 base), m03 그룹 M base
- 데모 입력: in-sample/person0~6.png(FASHN 데모), items.json
- 포즈 검사: factory/pose_check.py (DWPose 키포인트). 촬영 가이드: docs/MODEL-PHOTO-GUIDE.md
- 출력: factory/out/<폴더>/ (레이어, preview_composite.png, catalog.json)

## 실행 명령 (MPS)
```
cd ~/viet/factory
PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.7 PYTORCH_MPS_LOW_WATERMARK_RATIO=0.5 \
.venv/bin/python make_layers.py --model in-sample/m01.png --items in-sample/items.json \
--out out/<새폴더> --steps 20 --limit 1
```
- 두 환경변수는 필수. 없으면 맥이 메모리 부족으로 먹통이 된 후 재부팅됨(실제 발생).
- HIGH만 1.4 미만으로 주면 "invalid low watermark ratio" 에러로 CPU 폴백됨 → 반드시 LOW를 HIGH보다 작게.
- 이제 make_layers.py가 두 값을 자동 설정함(HIGH 0.7, LOW 0.5). 위처럼 직접 줘도 됨.
- 정밀도: --dtype auto|fp32|bf16|fp16 (맥 기본 bf16). 폴백 시 traceback 전체가 로그에 남음.
- 출력 폴더는 매번 새 이름으로(mac-test ~ mac-test5, mac-test3b, std-m01, std-m01-fp32, final-test 사용됨).
  이미 있는 폴더면 만든 상품은 건너뜀(시작 시 안내 출력). 다시 만들려면 --force
- 생성 전에 모델 사진 포즈 검사. 불합격이면 종료(코드 2). 셀카(person5) 등으로 시험하려면 --skip-pose-check

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
| out/mac-test5 | mac-test4 다시 잘라내기(--orig-dilate 6) | - | - | 파란 테두리 사라짐. 사용자 OK 기준 충족 |
| out/mac-test3b | mac-test3 다시 잘라내기(--orig-dilate 6) | - | - | 허리 핑크 띠 사라짐. 그 자리는 AI가 그린 반바지 허리로 채워짐(다른 옷 덮음 0.6%) |
| out/std-m01 | MPS / bfloat16, m01(표준 A포즈) | 9.8s | 197s | raw 깨끗. 합성본만 어깨 살색 번짐 + 소매 밑 팔에 검은 얼룩 (원인·수정은 아래 "합성 경계 수정") |
| out/std-m01-fp32 | MPS / float32, m01 | 13.4s | 268s | std-m01과 동일 → 정밀도 무관 확정. 맥 기본은 bf16 유지 |
| out/final-test | MPS / bfloat16, m01, 경계 수정 후 | 11.3s | 226s | 합성본 깨끗(어깨 번짐·팔 얼룩 없음, raw와 거의 같음). 종료 abort 없음. **판단: 이 방식 유지 → 다음은 체형 그룹 재사용** |

- 세 테스트 모두 상의 1개, 덮는 면적 5%, 보호 영역 3%(face, hair, jewelry, bag, glasses, hat).
- 테스트 모델 사진은 거울 셀카(폰을 든 손이 상체를 가림) — 최악 조건임.
- mac-test4부터는 FASHN 데모 person2(정면 전신, 손이 상체 안 가림, 티+면바지). person0~6은 in-sample에 받아 둠(get_samples.py와 같은 출처).

## mac-test3 분석 결과 (2026-10-06)
- 원인은 bf16이 아니라 레이어 합성 방식. AI가 새 티를 원래 핑크 티보다 짧게 만들었고(반바지 허리도 올림),
  레이어에는 새 옷만 들어가므로 그 아래 원래 핑크 옷이 그대로 비침 → 허리 핑크 띠.
- 즉 "새 옷이 원래 옷보다 작으면 원래 옷이 보인다"는 구조적 문제. 마스크 몇 px 확장(4-2)으로는 이 띠를 못 덮음.
- 대책: 모델 사진 표준에서 "몸에 붙는 얇은 기본 옷"을 입히는 것 + 원래 옷 영역을 레이어에 포함하는 보정.
- 비교 이미지: factory/out/compare/mac-test3-분석.jpg

## 원래 옷 테두리 제거 (4-2, 완료 2026-10-06)
- extract.py: base에서 원래 입던 같은 종류 옷 영역을 --orig-dilate px(기본 6) 넓혀, 새 옷이 안 덮는 부분은
  AI 착용 결과(피부·배경)로 채움. 가장자리 색 정리는 새 옷의 바깥 테두리에만 적용(안 그러면 검은 선 생김).
- make_layers.py / reextract.py 둘 다 --orig-dilate 옵션. 테두리 남으면 키우고, 배경이 번져 보이면 줄임.
- "다른 옷 덮음 %" 로그: 새 옷이 원래 옷보다 작아 그 자리에 하의 등이 레이어에 들어간 비율. 0.5% 넘으면 경고.
  이 경우 다른 하의와 조합하면 어색할 수 있음 → 모델은 몸에 붙는 얇은 기본 옷을 입고 촬영해야 근본 해결.

## 합성 경계 수정 (2026-10-07, std-m01 문제)
- 진단: 분할 마스크는 정확(실제 옷 경계와 1~2px). raw는 깨끗하고 합성 단계만 문제.
  1) 어깨 살색 번짐: base는 민소매라 맨어깨가 새 티 가장자리 밖으로 1~2px 튀어나옴 + 안쪽 feather로 그 살이 비침.
  2) 소매 밑 팔의 검은 얼룩: "검은 반투명 그림자"(shadow_ring)가 소매 주변 피부를 넓게 어둡게 함.
- 수정(extract.py): 새 옷 둘레 --orig-dilate px 안의 base 피부도 AI 결과로 채움(base_skin) → 번짐 제거, 실제 그림자는 이 띠에 담김.
  shadow_ring 기본 0(끔), feather 1.6→1.0(경계 선명). 기존 원래 옷 가리기(4-2)는 그대로.
- 출력 추가: out/<폴더>/raw.png(첫 상품 생성 원본), compare.png [원본 모델 | raw | 합성본], compare/<상품>.png,
- 2배 업스케일은 생략: 원본 고해상도 사진 위에 레이어만 키워 얹는 방식(1초)은 어깨에 원본 살이 튀어나오고
  소매 밑 피부 띠에 화질 차이가 보여 합성본보다 나빴음. 제대로 하려면 Real-ESRGAN 등 AI 업스케일러가 필요한데
  모델·패키지 추가 다운로드가 필요하고 디스크 여유가 4.9GB라 보류. 디스크 정리 후 재검토.
- 종료 시 "libc++abi recursive_mutex lock failed" abort: 결과 저장 후 os._exit로 파이썬 정리 단계를 건너뛰어 해결.

## 표준 모델 사진 검사 (4-3, 완료 2026-10-06)
- pose_check.py: 불합격(생성 건너뜀) = 전신 아님, 앉음, 정면 아님(좌우 반전·어깨 기울기>10°·어깨너비/몸통<0.55·코 치우침), 두 눈 안 보임,
  손목·팔꿈치·아래팔이 몸통 사각형(양 어깨·양 골반, 90% 축소) 안. 주의 = 팔 벌림<8°, 키 비율 70~95% 밖, 가운데 아님, 배경 편차>18.
- 기준값은 데모 7장으로 맞춤: person2·6 주의, 나머지(셀카·앉은 사진) 불합격. 표준 사진이 모이면 재조정.
- 결과는 out/pose-check/<이름>.jpg(관절 그림) + .json(키포인트). 4-4에서 키포인트 json 재사용 예정.
- 가이드 핵심: 모델은 몸에 붙는 연회색 민소매+바이커 쇼츠(원래 옷 비침 방지), 머리 묶기, 액세서리 없음, 삼각대·배꼽 높이·3m·바닥 테이프.
- 아직 표준 포즈 실제 사진 없음 → 사용자가 가이드대로 촬영 후 m01.png 등으로 넣어야 4-4 시험 가능.

## GPT(Codex) 생성 시험 (2026-10-07) — 로컬 FASHN 1.5 대체 후보
- 사용자 판단: 로컬 결과(576x864, 4분/벌)는 실사용 수준이 아님 → 외부 생성 검토.
- 맥에 Codex 앱 설치·ChatGPT 구독 로그인 상태. 앱 내장 CLI: /Applications/Codex.app/Contents/Resources/codex (0.137 alpha)
  - 기본 모델(gpt-6-astra)은 이 CLI 버전에서 거부됨 → `-m gpt-5.5` 지정. Codex 앱 업데이트 권장.
  - `-i` 는 여러 파일을 받으므로 프롬프트는 stdin(heredoc)으로 넘길 것. 이미지 생성은 구독 사용량을 텍스트보다 3~5배 빨리 씀.
- 명령 예 (out/gpt-test):
  `codex exec -m gpt-5.5 --skip-git-repo-check -s workspace-write -C <출력폴더> -i m01.png -i garment.jpg <<'EOF' ... EOF`
  프롬프트: 첫 이미지의 탱크톱만 두 번째 이미지 옷으로 교체, 나머지(얼굴·체형·포즈·배경·구도) 동일, 1024x1536, gpt_tryon.png로 저장.
- 결과: 약 1분, 1024x1536. 옷 주름·로고 선명, 로컬보다 확연히 좋음. 로고 아이콘 세부는 약간 다시 그려짐.
  포즈 이동: 코·손목 0.5px, 어깨 3px, 골반 5~7px, 발목 2px(1536 높이 기준). 배경 거의 동일, 얼굴은 약간 달라짐(색차 6).
- GPT 결과로 기존 잘라내기(extract.py, orig_dilate 10, feather 1.6, 원본 해상도) → 합성본 깨끗, 얼굴은 원본 m01 그대로 유지.
  비교: factory/out/compare/gpt-vs-local.jpg, gpt-레이어합성.jpg
- `--engine gpt` 구현 (factory/gpt_tryon.py). 실행:
  `cd ~/viet/factory && .venv/bin/python make_layers.py --engine gpt --model in-sample/m01.png --items in-sample/items.json --out out/<새폴더>`
  - 기본 엔진은 여전히 fashn(로컬). gpt는 FASHN 모델을 안 올리고 분할 모델만 CPU로. 기준 이미지 최대 1536px, 가장자리 폭은 해상도에 비례.
  - 한 상품 실패해도 다음으로 진행, 사용량 한도면 중단(다시 실행하면 만든 것은 건너뜀). 구독 사용량은 ~/.codex/sessions 기록에서 읽어 로그에 표시.
  - 결과 폴더에 overview.jpg(상품별 단독 합성본 한눈에 보기) 추가.
- out/gpt-all (m01, 8개 전부): 개당 48~84초, 총 약 10분, 구독 사용량(7일 기준) 19%→20% (8장 ≈ 1%).
  단독 합성본은 8개 모두 깨끗(무늬·프린트·시퀸·트임 재현 좋음). 비교: out/compare/gpt-all-1.jpg, gpt-all-2.jpg
- **조합 문제(out/compare/gpt-조합.jpg)**: 크롭 상의(s02, s04) + 하의 조합에서 허리에 회색 띠, s01+s05도 허리에 회색 조각.
  원인: base(m01)가 허리를 덮는 긴 탱크톱. ① 크롭 상의는 탱크톱 자리를 AI가 그린 맨배+회색 반바지 허리로 채워 레이어에 담고(다른 옷 덮음 1.3~1.4%),
  ② 하의는 탱크톱에 가려진 허리 부분이 레이어에 없음 → 조합하면 그 사이로 회색이 보임.
  대책 후보: base 모델을 배꼽 위 스포츠브라 + 짧은 쇼츠로 바꿈(GPT로 m01을 수정해 만들 수 있음) → 상의·하의 사이가 base의 맨살.
  그래도 남으면 레이어를 "옷"과 "밑깔림(가린 자리 채움)" 두 장으로 나눠 앱에서 밑깔림을 먼저 그리게(src/components/Styling.tsx) 변경.
  대량 생산은 구독 한도 대신 OpenAI API(gpt-image-1-mini 중간 화질 1024x1536 약 $0.015/장) 또는 FASHN API($0.075) 검토.

## 최종 품질 테스트 (2026-10-07) — 다음 단계 결정
- 재실행 명령: `cd ~/viet/factory && .venv/bin/python make_layers.py --model in-sample/m01.png --items in-sample/items.json --out out/final-test2 --steps 20 --limit 1`
- 결과: out/final-test/compare.png. 합성본이 raw와 거의 같은 수준으로 깨끗 → 레이어 방식 유지.
- 다음: 2순위 과제(체형 그룹 재사용: --models, transfer_layers.py). m01(base)·m02(같은 그룹 S)·m03(그룹 M base) 준비됨.
- 종료 시 "resource_tracker: leaked semaphore" 경고 1줄은 os._exit 때문에 나오는 무해한 메시지.

## 1순위 과제: mac-test3 품질 원인 파악 (위 분석으로 정밀도 원인은 배제됨, 완료)
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
