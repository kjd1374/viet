# 프로젝트 인수인계 (Claude Code용)

이 파일은 다른 기기(맥미니 등)의 Claude Code가 이전 작업 맥락을 이어받기 위한 요약이다. 대화 기록은 기기 간에 넘어가지 않는다.

## 무엇을 만드는가

베트남 의류 판매자용 서비스. 흐름: **스와이프로 상품 고르기 → 보관함 → 보관한 옷만으로 코디(고정 AI 모델에 옷 레이어 입히기) → 원 판매처로 구매 연결**.
운영자는 데이터만 정리하고 판매·결제·배송은 하지 않는다.

- 사용자(대표)와는 **한국어**로 대화한다. MVP 우선, UI 세부 결정은 위임하는 편. 아이폰 실기기 확인은 대표가 직접 한다.
- 대표는 **코디(레이어 착용)를 서비스의 핵심 차별점**으로 본다. 데이터 수집·서버·베트남어는 상대적으로 쉬운 일로 본다.

## 현재 상태 (2026-10-06)

1. **스와이프 MVP 완료** — 더미 20개, 브라우저(IndexedDB) 저장, 실제 iPhone Safari에서 대표가 확인. 자세한 기획·합격 기준: [PLAN.md](PLAN.md), [README.md](README.md)
2. **코디 화면 프로토타입 완료** — 고정 모델 + 슬롯별 레이어, 상의만 바꾸면 하의 유지, 원피스·아우터 규칙. 보관함 → "보관한 옷으로 코디하기"
3. **레이어 공장(factory/)** — 상품 사진 → FASHN VTON v1.5로 고정 모델에 착용 → 옷만 떼어낸 투명 PNG → `public/catalog/catalog.json`(앱이 자동으로 읽음)
   - Windows 노트북 CPU 실측: 1벌 약 77분(20단계). 티셔츠+스커트 레이어 겹치기 자연스러움 확인
   - 결과·발견 사항: [docs/STYLING-FEASIBILITY.md](docs/STYLING-FEASIBILITY.md)

## 다음 할 일: 맥미니 시험

[docs/MAC-MINI-GUIDE.md](docs/MAC-MINI-GUIDE.md) 순서대로 진행한다.

1. 설치: `bash factory/setup_mac.sh` (Homebrew 설치처럼 맥 비밀번호가 필요한 단계는 대표가 직접 입력)
2. 예제로 **1벌만** 먼저 돌려 속도 측정 → `착용 ○○s` 숫자가 핵심 (맥 GPU = MPS)
3. 8벌 전체 + `--publish` → `npm install && npm run dev -- --host` → 코디 화면에서 확인
4. (선택) Draw Things(FLUX.1 schnell)로 **살색 속옷 차림 기본 모델** 생성 → `--model in/model.png --force`로 재실행
5. 결과(속도 표, 스크린샷, 어색한 점)를 docs/STYLING-FEASIBILITY.md에 추가하고 커밋·푸시

## 결정 사항

- 통화 USD, UI 한국어, 보관함은 2열 그리드
- 코디는 **레이어 방식**: 상품 등록 때 레이어를 미리 만들고, 사용자가 누르면 겹치기만 한다(즉시 적용). 클릭 때 AI를 돌리지 않는다
- **기본 모델 = AI로 만든 성인, 살색 최소 속옷 차림, 빈손, 팔을 몸에서 조금 뗀 정면 자세.** 레이어는 원래 옷을 덮을 뿐 벗길 수 없다(PC 시험에서 청반바지가 스커트 아래로 보였음). 완전 노출은 플랫폼·법적 위험으로 제외
- 시스루 표현은 나중에 따로 시험

## 주의

- **라이선스**: FASHN VTON v1.5는 Apache-2.0(상업 가능). 함께 쓰는 `fashn-human-parser`는 NVIDIA SegFormer 라이선스(**연구·평가 전용**) → 실서비스 전에 교체 필요
- 저장소는 **공개** 상태(대표가 나중에 비공개 전환 예정). 비밀키·개인정보·실제 상품 사진을 커밋하지 않는다
- 커밋하지 않는 것: `factory/vendor`, `.venv`, `weights`, `hf-cache`, `out`, `in-sample`(FASHN 예제 사진), `public/catalog`
- 테스트: `npm test`(단위), `npm run test:e2e`(Playwright — Windows에서는 시스템 Edge 사용), 잘라내기 `python -m unittest factory/test_extract.py`
- Windows 전용 이슈: PyTorch `WinError 1114` → README의 VC++ 런타임 항목 참고 (맥은 해당 없음)
