import { CANVAS, CATEGORY_OF, layerSvg, modelSvg, type Category } from './figure';
import { garmentSvg, type GarmentKind, type Pattern } from './garments';

export type TradeType = 'wholesale' | 'retail';

export type Product = {
  id: string;
  imageUrl: string;
  title: string;
  priceAmount: number;
  currency: 'USD';
  sourceName: string;
  sourceUrl?: string;
  tradeType: TradeType;
  sizes?: string[];
  /** 실거래 상품이 아님 (더미·시험용). 화면에 표시한다. */
  isDummy: boolean;
  category: Category;
  /** 고정 모델 캔버스에 정렬된 투명 착용 레이어. 실제 서비스에서는 AI 착용 결과에서 의류 영역만 잘라낸 PNG. */
  layerUrl: string;
};

type Seed = {
  title: string;
  kind: GarmentKind;
  pattern: Pattern;
  base: string;
  accent: string;
  bg: [string, string];
  price: number;
  trade: TradeType;
  source: string;
  sizes?: string[];
};

// 출처명은 실존 판매처로 오해되지 않도록 모두 "샘플" 접두어를 붙인 가상 이름이다.
const SEEDS: Seed[] = [
  { title: '오버핏 코튼 반팔 티셔츠', kind: 'tshirt', pattern: 'solid', base: '#e8e2d6', accent: '#e8e2d6', bg: ['#f3efe8', '#e2dbcf'], price: 4.2, trade: 'wholesale', source: '샘플 도매처 A', sizes: ['S', 'M', 'L', 'XL'] },
  { title: '스트라이프 옥스포드 셔츠', kind: 'shirt', pattern: 'stripe', base: '#f2f4f7', accent: '#7c9cc4', bg: ['#e9eef4', '#d5dee9'], price: 18.5, trade: 'retail', source: '샘플 소매처 B', sizes: ['M', 'L'] },
  { title: '퍼프 소매 린넨 블라우스', kind: 'blouse', pattern: 'solid', base: '#f4d9cf', accent: '#f4d9cf', bg: ['#fbf1ec', '#efdcd3'], price: 6.8, trade: 'wholesale', source: '샘플 도매처 C', sizes: ['Free'] },
  { title: '플로럴 도트 롱 원피스', kind: 'dress', pattern: 'dot', base: '#2f3e5c', accent: '#f0e3c4', bg: ['#e7e9ef', '#cfd4df'], price: 32, trade: 'retail', source: '샘플 소매처 D' },
  { title: '크롭 데님 자켓', kind: 'jacket', pattern: 'solid', base: '#5b7da8', accent: '#5b7da8', bg: ['#e8edf2', '#cdd7e2'], price: 11.9, trade: 'wholesale', source: '샘플 도매처 A', sizes: ['S', 'M', 'L'] },
  { title: '울 블렌드 싱글 코트', kind: 'coat', pattern: 'solid', base: '#a8825c', accent: '#a8825c', bg: ['#f2ece4', '#ddd1c1'], price: 44, trade: 'retail', source: '샘플 소매처 E', sizes: ['M', 'L'] },
  { title: '꽈배기 라운드 니트', kind: 'knit', pattern: 'solid', base: '#d9c8a5', accent: '#d9c8a5', bg: ['#f5f1e7', '#e3dac6'], price: 7.5, trade: 'wholesale', source: '샘플 도매처 F' },
  { title: '와이드 슬랙스', kind: 'pants', pattern: 'solid', base: '#3a3a3c', accent: '#3a3a3c', bg: ['#ececec', '#d6d6d6'], price: 21, trade: 'retail', source: '샘플 소매처 B', sizes: ['26', '27', '28', '29', '30'] },
  { title: '체크 A라인 미니스커트', kind: 'skirt', pattern: 'check', base: '#e9dcc4', accent: '#8b4a3c', bg: ['#f6efe4', '#e6d9c5'], price: 5.4, trade: 'wholesale', source: '샘플 도매처 C', sizes: ['S', 'M'] },
  { title: '코튼 버뮤다 반바지', kind: 'shorts', pattern: 'solid', base: '#b9c4a0', accent: '#b9c4a0', bg: ['#f0f2ea', '#d9dfcc'], price: 14, trade: 'retail', source: '샘플 소매처 G' },
  { title: '보더 스트라이프 티셔츠', kind: 'tshirt', pattern: 'stripe', base: '#f6f4ef', accent: '#1f2d4a', bg: ['#eceef2', '#d3d8e1'], price: 3.6, trade: 'wholesale', source: '샘플 도매처 F', sizes: ['M', 'L', 'XL'] },
  { title: '실크 터치 셔츠', kind: 'shirt', pattern: 'solid', base: '#efe6d2', accent: '#efe6d2', bg: ['#f7f3ea', '#e6dccb'], price: 26, trade: 'retail', source: '샘플 소매처 D', sizes: ['S', 'M', 'L'] },
  { title: '도트 프릴 블라우스', kind: 'blouse', pattern: 'dot', base: '#fbf8f2', accent: '#2b2b2b', bg: ['#efefec', '#dadad5'], price: 16.5, trade: 'retail', source: '샘플 소매처 E' },
  { title: '슬리브리스 미디 원피스', kind: 'dress', pattern: 'solid', base: '#7a8f6a', accent: '#7a8f6a', bg: ['#eef1ea', '#d5dccd'], price: 9.8, trade: 'wholesale', source: '샘플 도매처 A', sizes: ['Free'] },
  { title: '체크 트위드 자켓', kind: 'jacket', pattern: 'check', base: '#ece4d8', accent: '#3c3a52', bg: ['#f3f1ed', '#dfdad1'], price: 38, trade: 'retail', source: '샘플 소매처 G', sizes: ['S', 'M'] },
  { title: '롱 트렌치 코트', kind: 'coat', pattern: 'solid', base: '#c9b18a', accent: '#c9b18a', bg: ['#f4efe6', '#e0d5c2'], price: 19.9, trade: 'wholesale', source: '샘플 도매처 C', sizes: ['M', 'L', 'XL'] },
  { title: '스트라이프 브이넥 니트', kind: 'knit', pattern: 'stripe', base: '#f1ebe0', accent: '#b5543f', bg: ['#f7f1ea', '#e7dbcd'], price: 24, trade: 'retail', source: '샘플 소매처 B' },
  { title: '스트레이트 데님 팬츠', kind: 'pants', pattern: 'solid', base: '#4d6a92', accent: '#4d6a92', bg: ['#e9edf2', '#cfd8e3'], price: 8.7, trade: 'wholesale', source: '샘플 도매처 F', sizes: ['S', 'M', 'L'] },
  { title: '플리츠 롱스커트', kind: 'skirt', pattern: 'stripe', base: '#2e4a43', accent: '#36564e', bg: ['#e9efed', '#cfdcd8'], price: 27.5, trade: 'retail', source: '샘플 소매처 E', sizes: ['Free'] },
  { title: '린넨 밴딩 반바지', kind: 'shorts', pattern: 'check', base: '#f0ebe1', accent: '#9aa7b8', bg: ['#f2f2ef', '#dddcd6'], price: 4.9, trade: 'wholesale', source: '샘플 도매처 A' },
];

export const PRODUCTS: Product[] = SEEDS.map((s, i) => ({
  id: `p${String(i + 1).padStart(3, '0')}`,
  imageUrl: garmentSvg({ kind: s.kind, pattern: s.pattern, base: s.base, accent: s.accent, bgFrom: s.bg[0], bgTo: s.bg[1] }),
  title: s.title,
  priceAmount: s.price,
  currency: 'USD',
  sourceName: s.source,
  tradeType: s.trade,
  ...(s.sizes ? { sizes: s.sizes } : {}),
  isDummy: true,
  category: CATEGORY_OF[s.kind],
  layerUrl: layerSvg({ kind: s.kind, pattern: s.pattern, base: s.base, accent: s.accent }),
}));

export const PRODUCT_BY_ID: ReadonlyMap<string, Product> = new Map(PRODUCTS.map((p) => [p.id, p]));

/** 코디의 고정 모델. 기본은 일러스트, catalog.json이 있으면 AI 생성 모델 사진으로 바뀐다. */
export const MODEL = { url: modelSvg(), width: CANVAS.w, height: CANVAS.h, label: '일러스트 모델 · 더미 상품' };

/**
 * 외부 카탈로그로 교체한다 (앱 렌더 전에 한 번).
 * 배열·맵을 제자리에서 바꾸므로 이를 가져다 쓰는 모듈은 그대로 동작한다.
 */
export function replaceCatalog(products: Product[], model: typeof MODEL) {
  PRODUCTS.length = 0;
  PRODUCTS.push(...products);
  const map = PRODUCT_BY_ID as Map<string, Product>;
  map.clear();
  for (const p of products) map.set(p.id, p);
  Object.assign(MODEL, model);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function formatPrice(p: Product): string {
  return usd.format(p.priceAmount);
}

export const TRADE_LABEL: Record<TradeType, string> = { wholesale: '도매', retail: '소매' };
