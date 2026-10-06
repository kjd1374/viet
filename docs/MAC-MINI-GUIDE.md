# 맥미니에서 레이어 공장 시험하기

목표: 맥미니(M4)에서 **옷 1벌을 고정 모델에 입혀 레이어로 만드는 데 몇 초 걸리는지**, 그리고 **겹쳤을 때 자연스러운지** 확인한다.
예상 소요: 설치 30~60분(대부분 다운로드), 시험 실행 10~30분.

명령은 **터미널** 앱에 한 줄씩 붙여 넣는다.

---

## 1. 준비물 설치 (처음 한 번)

Homebrew가 없다면 먼저 설치한다 (설치 중 맥 비밀번호를 물어보면 직접 입력):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

설치가 끝나면 화면 마지막에 나오는 `echo ... >> ~/.zprofile` 두 줄을 그대로 실행한 뒤:

```bash
brew install git node uv gh
```

## 2. 코드 받기

GitHub에 로그인 (브라우저가 열리면 승인):

```bash
gh auth login
```

```bash
cd ~ && gh repo clone kjd1374/viet && cd viet
```

이미 받아 둔 경우 최신으로:

```bash
cd ~/viet && git pull
```

## 3. 레이어 공장 설치 (약 2.3GB 다운로드)

```bash
bash factory/setup_mac.sh
```

마지막 줄에 `맥 GPU(MPS) 사용 가능: True` 가 나오면 정상.

## 4. 시험 실행

시험용 예제 사진(옷 8벌 + 기준 모델 1명)을 받는다:

```bash
cd factory && .venv/bin/python get_samples.py
```

**먼저 1벌만** (속도 확인용):

```bash
.venv/bin/python make_layers.py --model in-sample/person5.png --items in-sample/items.json --out out/mac-test --steps 20 --limit 1
```

화면에 이런 줄이 나온다 — **이 숫자가 핵심**:

```
[1/1] s01 top: 착용 12.3s, 잘라내기 0.8s, ...
```

괜찮으면 **8벌 전체 + 앱에 반영**:

```bash
.venv/bin/python make_layers.py --model in-sample/person5.png --items in-sample/items.json --out out/mac-test --steps 20 --publish
```

- 이미 만든 레이어는 건너뛴다. 처음부터 다시: `--force`
- 품질 비교: `--steps 30` 또는 `--steps 50` (느려짐) — `--out out/mac-s30` 처럼 폴더를 바꿔서
- 맥 GPU에서 오류가 나면 자동으로 CPU로 바꿔 계속한다 (로그에 경고가 뜬다)

## 5. 앱에서 확인

```bash
cd ~/viet && npm install && npm run dev -- --host
```

- 맥에서: http://localhost:5173
- 아이폰에서: 터미널의 `Network:` 주소
- 오른쪽으로 밀어 보관 → 보관함 → **보관한 옷으로 코디하기**

## 6. 알려줄 것

1. `factory/out/mac-test/timings.csv` 내용 (또는 4단계 화면의 `착용 ○○s` 숫자들)
2. 코디 화면 스크린샷 2~3장 (상의+스커트, 원피스 등)
3. `factory/out/mac-test/preview_composite.png` (자동으로 겹쳐 본 결과)
4. 어색한 곳 (경계, 얼굴, 그림자 등)

---

## (선택) AI 모델 만들기

예제 기준 모델은 휴대폰을 든 셀카라 얼굴이 가려져 있다. 실제 서비스용 고정 모델은 AI로 만든다.

가장 쉬운 방법: App Store의 **Draw Things** (무료) → 모델 **FLUX.1 [schnell]** 선택 → 크기 768×1024, Steps 4, Seed 고정 → 아래 문장으로 여러 장 만들어 마음에 드는 1장을 `factory/in/model.png` 로 저장.

```
Full-body studio fashion catalog photo of a young adult Southeast Asian woman, standing straight facing the camera,
arms relaxed slightly away from the body, hair tied back in a neat low bun, neutral expression,
wearing a plain fitted light grey tank top and plain fitted light grey bike shorts, barefoot,
plain light grey seamless studio background, soft even lighting, sharp focus, entire body visible from head to toe, centered
```

조건: 정면·전신, 팔이 몸에서 조금 떨어짐, 머리 묶음(어깨를 덮지 않게), 몸에 붙는 단색 이너, 단순한 배경.
그다음 4단계를 `--model in/model.png --out out/mac-model1 --force` 로 다시 실행.

FLUX.1 schnell은 Apache-2.0이라 결과 이미지를 상업적으로 써도 된다. 실존 인물을 닮지 않게 여러 장 중에서 고른다.
