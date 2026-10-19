import type { Category } from './figure';
import { replaceCatalog, type Currency, type Product, type TradeType } from './products';

/**
 * public/catalog/catalog.json 을 읽는다 (factory/publish_board.py 또는 예전 make_layers.py의 출력).
 * 없거나 형식이 틀리면 내장 더미를 그대로 쓴다. ?catalog=dummy 로 강제할 수 있다 (테스트용).
 */
type CatalogFile = {
  model?: { imageUrl: string; width: number; height: number; label?: string };
  products: {
    id: string;
    title: string;
    priceAmount: number;
    currency?: Currency;
    sourceName: string;
    sourceUrl?: string;
    tradeType: TradeType;
    sizes?: string[];
    category: Category;
    imageUrl: string;
    boardImageUrl?: string;
    layerUrl?: string;
    isDummy?: boolean;
  }[];
};

const CATEGORIES: Category[] = ['top', 'bottom', 'dress', 'outer'];
const CURRENCIES: Currency[] = ['USD', 'KRW', 'VND'];

function valid(c: unknown): c is CatalogFile {
  const x = c as CatalogFile;
  return (
    !!x &&
    (x.model === undefined || (!!x.model.imageUrl && x.model.width > 0 && x.model.height > 0)) &&
    Array.isArray(x.products) &&
    x.products.length > 0 &&
    x.products.every(
      (p) =>
        typeof p.id === 'string' &&
        typeof p.title === 'string' &&
        typeof p.priceAmount === 'number' &&
        CATEGORIES.includes(p.category) &&
        (p.currency === undefined || CURRENCIES.includes(p.currency)) &&
        !!p.imageUrl,
    ) &&
    new Set(x.products.map((p) => p.id)).size === x.products.length
  );
}

export async function loadCatalog(): Promise<'file' | 'dummy'> {
  if (new URLSearchParams(location.search).get('catalog') === 'dummy') return 'dummy';
  const base = new URL('catalog/', new URL(import.meta.env.BASE_URL, location.href));
  try {
    const res = await fetch(new URL('catalog.json', base), { cache: 'no-cache' });
    if (!res.ok) return 'dummy';
    const json: unknown = await res.json();
    if (!valid(json)) {
      console.warn('[catalog] catalog.json 형식이 맞지 않아 더미를 사용합니다');
      return 'dummy';
    }
    const abs = (u: string) => new URL(u, base).href;
    const products: Product[] = json.products.map((p) => ({
      id: p.id,
      title: p.title,
      priceAmount: p.priceAmount,
      currency: p.currency ?? 'USD',
      sourceName: p.sourceName,
      ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
      tradeType: p.tradeType,
      ...(p.sizes?.length ? { sizes: p.sizes } : {}),
      isDummy: p.isDummy ?? true,
      category: p.category,
      imageUrl: abs(p.imageUrl),
      ...(p.boardImageUrl ? { boardImageUrl: abs(p.boardImageUrl) } : {}),
      ...(p.layerUrl ? { layerUrl: abs(p.layerUrl) } : {}),
    }));
    replaceCatalog(
      products,
      json.model && {
        url: abs(json.model.imageUrl),
        width: json.model.width,
        height: json.model.height,
        label: json.model.label ?? 'AI 생성 모델 · 샘플 상품',
      },
    );
    return 'file';
  } catch {
    return 'dummy';
  }
}
