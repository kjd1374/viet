# 의류 스와이프 — 1차 MVP

베트남 의류 판매자용 상품 정리 시제품. 상품 한 장을 보고 **왼쪽=삭제 / 오른쪽=보관 / 위=구매 정보 / 하단 버튼=보류**로 정리한다.
기획: [PLAN.md](PLAN.md)

> **MVP 범위**: 서버·로그인·실상품 데이터 없음. 선택 기록은 **이 브라우저(IndexedDB)에만** 저장되며 다른 기기와 동기화되지 않는다. 상품 20개는 모두 코드로 만든 더미(SVG)이고 가격은 USD 샘플 값이다.

## 실행

```bash
npm install
```

```bash
npm run dev -- --host
```

- PC: http://localhost:5173
- 같은 와이파이의 휴대폰: 터미널에 나오는 `Network` 주소 (예: `http://192.168.x.x:5173`). 안 열리면 Windows 방화벽에서 Node.js의 개인 네트워크 접근을 허용.
- 검증용 개발 모드: 주소 뒤에 `?dev` → 왼쪽 아래 `DEV` 패널에서 서버 지연(2초/6초), 서버 실패, 응답 유실, 오프라인, 기기 저장 실패를 주입하고 카드 전환 시간(p50/p95)을 본다.

## 테스트

```bash
npm test
```

```bash
npm run test:e2e
```

- `npm test` — 저장·동기화·코디 규칙 단위 테스트 25개 (Vitest + fake-indexeddb)
- `npm run test:e2e` — 브라우저 E2E 30개 (Playwright + **시스템 Edge**). 실제 터치 이벤트(CDP)로 스와이프하고 `docs/screenshots/`에 화면을 남긴다.

## 코디 (가능성 검증 프로토타입)

보관함 → "보관한 옷으로 코디하기". 고정 모델 1명에 보관한 옷만 레이어로 입힌다. 상의만 바꾸면 하의는 그대로, 원피스는 상의·하의 자리를 덮고, 아우터는 맨 위. 모델·옷은 모두 일러스트 더미다.
실제 사진으로 가는 방법과 위험: [docs/STYLING-FEASIBILITY.md](docs/STYLING-FEASIBILITY.md)

## 레이어 공장 (factory/)

실제 상품 사진 → 고정 모델에 AI 착용(FASHN VTON v1.5) → 옷만 떼어낸 투명 PNG → `public/catalog/catalog.json`.
앱은 이 파일이 있으면 더미 대신 그것을 읽는다 (`?catalog=dummy`로 더미 강제).

- 맥미니: [docs/MAC-MINI-GUIDE.md](docs/MAC-MINI-GUIDE.md)
- 잘라내기 테스트 (저장소 폴더에서): Windows `factory\.venv\Scripts\python -m unittest factory/test_extract.py`, 맥 `factory/.venv/bin/python -m unittest factory/test_extract.py`
- 라이선스: 착용 모델은 Apache-2.0, 함께 쓰는 사람 영역 분석(fashn-human-parser)은 **연구·평가 전용** → 서비스 전 교체 필요
- Windows에서 PyTorch가 `WinError 1114`로 안 뜨면 (PC의 VC++ 런타임이 오래된 경우): 가상환경에 `pip install msvc-runtime` 후 `.venv/Scripts`의 `msvcp140*.dll`, `vcruntime140*.dll`, `concrt140.dll`을 `.venv/Lib/site-packages/torch/lib`로 복사

## 구조

| 파일 | 역할 |
|---|---|
| `src/data/garments.ts` | 의류 실루엣 SVG 생성기 (외부 이미지 없음, 모든 이미지에 SAMPLE 표기) |
| `src/data/products.ts` | 더미 상품 20개 (고정 ID `p001`~`p020`, USD) |
| `src/store/appStore.ts` | 단일 결정 경로 `commit()` — 화면 즉시 전환 → 기기 원자 저장 → 실패 시 되돌림 |
| `src/store/idbLocal.ts` | IndexedDB: 결정과 보낼 작업을 한 트랜잭션으로 기록 |
| `src/store/sync.ts` | 배경 동기화 큐 (FIFO, 같은 actionId로 재시도, 지수 백오프) |
| `src/store/mockServer.ts` | **모의 서버** (브라우저 안 별도 DB). actionId 중복 차단, 구버전 무시, 장애 주입 |
| `src/components/Deck.tsx` | 카드 스택과 제스처 (Pointer Events, 축 잠금, 거리·속도 판정, fly-out) |
| `src/components/Sheet.tsx` | 구매 정보 바텀시트 (history 항목 1개 → 닫기·뒤로가기 한 번) |
| `src/data/figure.ts` | 고정 모델과 상품별 착용 레이어 (같은 300×640 캔버스, 투명 배경) |
| `src/store/outfit.ts` | 코디 규칙 (슬롯 독립, 원피스·아우터, 보관함에서 빠진 옷 숨김) |
| `src/components/Styling.tsx` | 코디 화면 |
| `src/route.ts` | 해시 라우팅 + 시트용 history.state |

## 합격 기준 결과 (2026-10-06)

환경: Windows 11, Node 24, Edge(Chromium) 헤드리스 — 모바일 프로젝트는 390×844 @3x, 터치 활성, iPhone UA.

| # | 기준 | 결과 | 근거 |
|---|---|---|---|
| 1 | 신규 상태에서 고유 더미 20개, 한국어 UI | ✅ 통과 | 단위 + E2E `1단계` |
| 2 | 삭제 후 새로고침·재진입·소진에도 안 되살아남 | ✅ 통과 | E2E 터치 삭제→새로고침, 20개 소진→새로고침 |
| 3 | 보관함에 정확히 한 번, 연타가 다음 카드 오염 안 함 | ✅ 통과 | E2E 더블탭 → 1개만, 단위 4연속 commit → 1개 |
| 4 | 보류 목록에서 보관·삭제 변경, 양쪽 목록 반영 | ✅ 통과 | E2E `3단계` |
| 5 | 상세 열고 닫기·뒤로가기 1회 → 같은 상품 | ✅ 통과 | E2E 위 스와이프/버튼/아래로 끌기/외부 페이지 왕복 |
| 6 | 안내 숨기기 유지 + 재표시 | ✅ 통과 | E2E `6단계` |
| 7 | 진행 상태·미완료 작업 새로고침 후 복원 | ✅ 통과 | E2E 오프라인 3건 → 새로고침 → 3건 대기 → 재개 |
| 8 | 2초 지연에도 카드 안 기다림, 실패·재시도 중복 없음 | ✅ 통과 (**모의 서버 기준**) | 아래 측정, E2E `5단계`, 단위 테스트 |
| 9 | 늦은 응답 / 연속 변경 / 새로고침 직전 동작 | ✅ 통과 | 단위 테스트 |
| 9 | 계정 전환 / 두 탭 충돌 | ➖ 해당 없음 | 서버·인증 없음 (PLAN 8.B로 이월) |
| 10 | 데스크톱 클릭 | ✅ 통과 | E2E 마우스 드래그·버튼·키보드(←→↑↓, Z) |
| 10 | 실제 iPhone Safari | ✅ 사용자 직접 확인 (2026-10-06) | 실기기에서 정상 동작 보고 |

### 속도 측정 (서버 2초 지연 주입)

- 측정: 동작 확정 → 다음 카드가 그려진 **다음 프레임**(이중 rAF, 보수적), 터치 스와이프 10회
- 결과(Edge 헤드리스, 이 PC): **p50 16.1ms / p95 22.9ms / 최대 22.9ms** — 목표 100ms 이내
- 같은 시점 모의 서버에는 응답 대기 작업이 쌓여 있었고(2초 뒤 처리), 10건 모두 정확히 1회 적용, 중복 0
- 한계: 실기기 수치가 아니다. 휴대폰에서는 `?dev` 패널의 p50/p95로 직접 확인 가능.

### 스크린샷

`docs/screenshots/` — 첫 안내(01), 덱(02), 왼쪽/오른쪽/위로 끄는 중(03·04·09), 되돌리기(05), 보류 목록·시트(06·07), 보관함(08), 구매 정보(10), 모의 서버 대기·실패(11·12), 오프라인 복원(13), 기기 저장 실패(14), 덱 소진(15), 데스크톱(20), 작은 화면·가로·태블릿(30-*)

## 실기기 체크리스트 (iPhone Safari)

1. 좌우 스와이프가 페이지 스크롤과 싸우지 않는가
2. 위로 밀면 구매 정보가 열리고, 손잡이를 아래로 끌면 닫히는가
3. **화면 왼쪽 끝에서 미는 Safari 뒤로가기**와 카드 스와이프가 충돌하지 않는가 (카드는 좌우 20px 띄워 둠)
4. 주소창이 접히고 펼쳐질 때 하단 버튼이 잘리지 않는가 (`100dvh` + 안전 영역)
5. 카드를 길게 눌렀을 때 텍스트 선택·이미지 저장 메뉴가 뜨지 않는가
6. 구매 정보를 연 뒤 Safari 뒤로가기 한 번에 같은 카드로 돌아오는가

## 알려진 한계

- **Safari(WebKit) 엔진 미검증**: Playwright WebKit 다운로드가 이 환경에서 실패해 Edge로만 자동 검증했다.
- 햅틱은 Android에서만 동작 (iOS Safari는 `navigator.vibrate` 미지원).
- **두 탭 동시 사용은 미지원**: 탭끼리 화면이 즉시 맞춰지지 않고, 두 탭에서 같은 상품을 다르게 결정하면 나중에 저장한 쪽이 이 브라우저 기록에 남으며 모의 서버 기록과 어긋날 수 있다. 한 번에 한 탭으로 사용. (탭 간 동기화는 PLAN 8.B)
- 버튼·키 연타 가드 300ms: 같은 버튼을 300ms 안에 다시 누르면 두 번째는 무시된다 (실수 더블탭 방지).
