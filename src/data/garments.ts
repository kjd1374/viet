// 더미 상품용 의류 실루엣 SVG 생성기.
// 외부 이미지에 의존하지 않고, 실제 판매 사진으로 오해되지 않도록 모든 이미지에 SAMPLE 표기를 넣는다.

export type GarmentKind =
  | 'tshirt' | 'shirt' | 'blouse' | 'dress' | 'jacket'
  | 'coat' | 'knit' | 'pants' | 'skirt' | 'shorts';

export type Pattern = 'solid' | 'stripe' | 'dot' | 'check';

// viewBox 300x400 (3:4) 기준 실루엣
const SILHOUETTES: Record<GarmentKind, string> = {
  tshirt:
    'M112 78 L132 68 Q150 84 168 68 L188 78 L236 112 L216 150 L192 136 L192 328 Q150 336 108 328 L108 136 L84 150 L64 112 Z',
  shirt:
    'M114 74 L134 64 L150 82 L166 64 L186 74 L222 96 L246 268 L218 274 L194 150 L194 330 Q150 338 106 330 L106 150 L82 274 L54 268 L78 96 Z',
  blouse:
    'M118 82 Q134 70 150 92 Q166 70 182 82 L208 92 Q248 108 240 158 L210 166 L198 140 L204 318 Q150 332 96 318 L102 140 L90 166 L60 158 Q52 108 92 92 Z',
  dress:
    'M124 62 L136 62 Q150 82 164 62 L176 62 L184 138 Q178 152 186 168 L238 350 Q150 366 62 350 L114 168 Q122 152 116 138 Z',
  jacket:
    'M112 70 L136 62 L150 112 L164 62 L188 70 L224 92 L250 276 L220 282 L198 150 L200 334 L156 334 L150 120 L144 334 L100 334 L102 150 L80 282 L50 276 L76 92 Z',
  coat:
    'M114 58 L136 52 L150 104 L164 52 L186 58 L222 82 L250 292 L220 298 L200 150 L212 368 L156 368 L150 112 L144 368 L88 368 L100 150 L80 298 L50 292 L78 82 Z',
  knit:
    'M118 76 Q150 92 182 76 L214 90 Q236 104 244 150 L252 286 L222 292 L202 160 L202 316 Q150 326 98 316 L98 160 L78 292 L48 286 L56 150 Q64 104 86 90 Z',
  pants:
    'M98 54 L202 54 L206 82 L226 356 L174 360 L152 150 L148 150 L126 360 L74 356 L94 82 Z',
  skirt:
    'M110 74 L190 74 L194 100 L240 318 Q150 340 60 318 L106 100 Z',
  shorts:
    'M92 92 L208 92 L212 118 L236 254 L168 262 L152 168 L148 168 L132 262 L64 254 L88 118 Z',
};

// 실루엣별 디테일 선(접힘, 여밈, 허리선)
const DETAILS: Record<GarmentKind, string> = {
  tshirt: 'M132 68 Q150 92 168 68',
  shirt: 'M150 82 L150 330 M134 64 L142 92 M166 64 L158 92',
  blouse: 'M150 92 L150 140',
  dress: 'M116 150 Q150 160 184 150',
  jacket: 'M150 120 L150 334 M118 210 L136 210 M164 210 L182 210',
  coat: 'M150 112 L150 368 M104 290 L136 290 M164 290 L196 290',
  knit: 'M98 304 L202 304 M118 76 Q150 98 182 76',
  pants: 'M98 82 L202 82 M150 82 L150 150',
  skirt: 'M106 100 L194 100',
  shorts: 'M90 118 L210 118 M150 118 L150 168',
};

export function patternDef(pattern: Pattern, base: string, accent: string, scale = 1): string {
  const s = scale === 1 ? '' : ` scale(${scale})`;
  switch (pattern) {
    case 'stripe':
      return `<pattern id="p" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(90)${s}"><rect width="18" height="18" fill="${base}"/><rect width="7" height="18" fill="${accent}"/></pattern>`;
    case 'dot':
      return `<pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse"${s ? ` patternTransform="${s.trim()}"` : ''}><rect width="20" height="20" fill="${base}"/><circle cx="10" cy="10" r="3.2" fill="${accent}"/></pattern>`;
    case 'check':
      return `<pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse"${s ? ` patternTransform="${s.trim()}"` : ''}><rect width="28" height="28" fill="${base}"/><rect width="28" height="9" fill="${accent}" opacity=".55"/><rect width="9" height="28" fill="${accent}" opacity=".55"/></pattern>`;
    default:
      return `<pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${base}"/></pattern>`;
  }
}

export function garmentSvg(opts: {
  kind: GarmentKind;
  pattern: Pattern;
  base: string;
  accent: string;
  bgFrom: string;
  bgTo: string;
}): string {
  const { kind, pattern, base, accent, bgFrom, bgTo } = opts;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="600" height="800">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bgFrom}"/><stop offset="1" stop-color="${bgTo}"/></linearGradient>
<linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".14"/><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
${patternDef(pattern, base, accent)}
<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity=".18"/></filter>
</defs>
<rect width="300" height="400" fill="url(#bg)"/>
<ellipse cx="150" cy="378" rx="96" ry="8" fill="#000" opacity=".07"/>
<g filter="url(#sh)"><path d="${SILHOUETTES[kind]}" fill="url(#p)"/></g>
<path d="${SILHOUETTES[kind]}" fill="url(#shade)"/>
<path d="${DETAILS[kind]}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/>
<text x="150" y="394" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" letter-spacing="3" fill="#000" fill-opacity=".28">SAMPLE IMAGE</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
