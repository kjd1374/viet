// 코디 가능성 검증용: 고정 모델 1명 + 상품별 "착용 레이어".
// 모든 레이어는 모델과 같은 캔버스(300×640)에 그려진 투명 배경 이미지다.
// 실제 서비스에서는 이 자리에 "고정 모델 사진에 맞춰 정렬된 투명 PNG"가 들어간다 (AI 착용 후 의류 영역만 잘라낸 결과).
// 화면 쪽 합성 코드는 이미지 출처와 무관하게 그대로 쓰인다.

import { patternDef, type GarmentKind, type Pattern } from './garments';

export const CANVAS = { w: 300, h: 640 };

type J = [x: number, y: number, half: number];

// 고정 골격 (A 포즈: 팔이 몸통과 겹치지 않아 소매·아우터 레이어가 단순해진다)
const ARM_L: J[] = [[106, 122, 14], [82, 232, 10.5], [66, 328, 8]];
const LEG_L: J[] = [[127, 296, 24], [126, 455, 15], [128, 598, 9.5]];
const mirror = (js: J[]): J[] => js.map(([x, y, h]) => [CANVAS.w - x, y, h]);
const ARM_R = mirror(ARM_L);
const LEG_R = mirror(LEG_L);

/** 관절 목록을 따라 [from,to] 구간(전체 길이 비율)의 팔다리 다각형을 만든다. ease만큼 두껍게. */
function limb(js: J[], from: number, to: number, ease = 0, flare = 0): string {
  const seg = js.slice(1).map((p, i) => Math.hypot(p[0] - js[i][0], p[1] - js[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const at = (f: number): J => {
    let d = f * total;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const t = Math.min(1, d / seg[i]);
        const a = js[i];
        const b = js[i + 1];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
      d -= seg[i];
    }
    return js[js.length - 1];
  };
  const steps = 8;
  const pts: J[] = [];
  for (let i = 0; i <= steps; i++) pts.push(at(from + ((to - from) * i) / steps));
  const left: string[] = [];
  const right: string[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = p[2] + ease + flare * (i / steps);
    left.push(`${(p[0] + nx * w).toFixed(1)},${(p[1] + ny * w).toFixed(1)}`);
    right.push(`${(p[0] - nx * w).toFixed(1)},${(p[1] - ny * w).toFixed(1)}`);
  });
  return `M${left.join(' L')} L${right.reverse().join(' L')} Z`;
}

const svgUri = (body: string, defs = '') =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.w} ${CANVAS.h}" width="${CANVAS.w * 2}" height="${CANVAS.h * 2}"><defs>${defs}</defs>${body}</svg>`,
  )}`;

const SKIN = '#e6c1a3';
const SKIN_SHADE = '#d4a98a';
const HAIR = '#2b2420';
const INNER = '#cfc7bc';

const TORSO =
  'M139 98 Q124 108 104 113 L95 124 L104 150 Q112 200 114 245 Q104 272 103 300 L150 314 L197 300 Q196 272 186 245 Q188 200 196 150 L205 124 L196 113 Q176 108 161 98 Z';

/** 고정 모델 (일러스트). 얼굴·체형·자세가 절대 바뀌지 않는다. */
export function modelSvg(): string {
  const shade = `<linearGradient id="sk" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".10"/><stop offset=".4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>`;
  const body = `
<ellipse cx="150" cy="624" rx="70" ry="8" fill="#000" opacity=".08"/>
<path d="M126 34 Q150 6 174 34 L178 70 Q150 82 122 70 Z" fill="${HAIR}"/>
<rect x="139" y="80" width="22" height="28" fill="${SKIN_SHADE}"/>
<path d="${limb(LEG_L, 0, 1)}" fill="${SKIN}"/><path d="${limb(LEG_R, 0, 1)}" fill="${SKIN}"/>
<path d="${limb(LEG_L, 0, 1)}" fill="url(#sk)"/><path d="${limb(LEG_R, 0, 1)}" fill="url(#sk)"/>
<ellipse cx="124" cy="610" rx="10" ry="16" fill="${SKIN_SHADE}"/><ellipse cx="176" cy="610" rx="10" ry="16" fill="${SKIN_SHADE}"/>
<path d="${limb(ARM_L, 0, 1)}" fill="${SKIN}"/><path d="${limb(ARM_R, 0, 1)}" fill="${SKIN}"/>
<ellipse cx="62" cy="346" rx="8" ry="15" transform="rotate(10 62 346)" fill="${SKIN_SHADE}"/>
<ellipse cx="238" cy="346" rx="8" ry="15" transform="rotate(-10 238 346)" fill="${SKIN_SHADE}"/>
<path d="${TORSO}" fill="${SKIN}"/><path d="${TORSO}" fill="url(#sk)"/>
<path d="M128 104 L134 104 L137 132 Q150 140 163 132 L166 104 L172 104 L178 130 L195 150 Q188 200 186 245 Q196 272 197 300 L150 326 L103 300 Q104 272 114 245 Q112 200 105 150 L122 130 Z" fill="${INNER}"/>
<ellipse cx="150" cy="54" rx="24" ry="30" fill="${SKIN}"/>
<path d="M126 48 Q128 22 150 22 Q172 22 174 48 Q164 34 150 34 Q136 34 126 48 Z" fill="${HAIR}"/>
<circle cx="150" cy="16" r="12" fill="${HAIR}"/>`;
  return svgUri(body, shade);
}

export type Category = 'top' | 'bottom' | 'dress' | 'outer';

export const CATEGORY_OF: Record<GarmentKind, Category> = {
  tshirt: 'top',
  shirt: 'top',
  blouse: 'top',
  knit: 'top',
  pants: 'bottom',
  skirt: 'bottom',
  shorts: 'bottom',
  dress: 'dress',
  jacket: 'outer',
  coat: 'outer',
};

function topBody(hem: number, ease: number, neck: 'crew' | 'v' | 'collar'): string {
  const n =
    neck === 'v' ? 'L150 140' : neck === 'collar' ? 'L144 104 L150 124 L156 104' : 'Q150 120 162 100';
  return `M${neck === 'crew' ? 138 : 136} 100 ${n} L${neck === 'crew' ? 162 : 164} 100 Q178 106 ${198 + ease / 2} 112 L${202 + ease / 2} 126 L${198 + ease} 152 Q${190 + ease} 200 ${188 + ease} 245 Q${196 + ease} 272 ${198 + ease} ${hem} L${102 - ease} ${hem} Q${104 - ease} 272 ${112 - ease} 245 Q${110 - ease} 200 ${102 - ease} 152 L${98 - ease / 2} 126 L${102 - ease / 2} 112 Q122 106 136 100 Z`;
}

function layerBody(kind: GarmentKind): { fill: string; detail: string } {
  switch (kind) {
    case 'tshirt':
      return {
        fill: `${topBody(312, 4, 'crew')} ${limb(ARM_L, 0, 0.3, 5)} ${limb(ARM_R, 0, 0.3, 5)}`,
        detail: 'M138 100 Q150 120 162 100',
      };
    case 'shirt':
      return {
        fill: `${topBody(318, 3, 'collar')} ${limb(ARM_L, 0, 0.96, 4)} ${limb(ARM_R, 0, 0.96, 4)}`,
        detail: 'M150 124 L150 316 M144 104 L140 118 L150 124 M156 104 L160 118 L150 124',
      };
    case 'blouse':
      return {
        fill: `${topBody(298, 5, 'crew')} ${limb(ARM_L, 0, 0.26, 9, 2)} ${limb(ARM_R, 0, 0.26, 9, 2)}`,
        detail: 'M138 100 Q150 120 162 100 M106 296 L194 296',
      };
    case 'knit':
      return {
        fill: `${topBody(304, 6, 'crew')} ${limb(ARM_L, 0, 0.94, 6)} ${limb(ARM_R, 0, 0.94, 6)}`,
        detail: 'M104 294 L196 294 M138 100 Q150 122 162 100',
      };
    case 'pants':
      return {
        fill: `M112 238 L188 238 L198 300 L150 320 L102 300 Z ${limb(LEG_L, 0, 0.97, 5)} ${limb(LEG_R, 0, 0.97, 5)}`,
        detail: 'M112 248 L188 248 M150 248 L150 300',
      };
    case 'shorts':
      return {
        fill: `M112 238 L188 238 L198 300 L150 320 L102 300 Z ${limb(LEG_L, 0, 0.3, 7)} ${limb(LEG_R, 0, 0.3, 7)}`,
        detail: 'M112 248 L188 248',
      };
    case 'skirt':
      return {
        fill: 'M113 238 L187 238 Q200 300 216 432 Q150 446 84 432 Q100 300 113 238 Z',
        detail: 'M113 248 L187 248',
      };
    case 'dress':
      return {
        fill: 'M128 104 L136 104 L138 128 Q150 134 162 128 L164 104 L172 104 L180 128 L196 150 Q188 200 186 245 Q206 340 224 480 Q150 498 76 480 Q94 340 114 245 Q112 200 104 150 L120 128 Z',
        detail: 'M114 245 Q150 255 186 245',
      };
    case 'jacket':
    case 'coat': {
      const hem = kind === 'coat' ? 476 : 322;
      const flare = kind === 'coat' ? 10 : 0;
      const l = `M140 98 Q120 106 96 114 L88 124 L96 152 Q104 200 104 245 Q${96 - flare} ${hem - 40} ${96 - flare} ${hem} L146 ${hem} L146 196 L130 120 Z`;
      const r = `M160 98 Q180 106 204 114 L212 124 L204 152 Q196 200 196 245 Q${204 + flare} ${hem - 40} ${204 + flare} ${hem} L154 ${hem} L154 196 L170 120 Z`;
      return {
        fill: `${l} ${r} ${limb(ARM_L, 0, 1, 7)} ${limb(ARM_R, 0, 1, 7)}`,
        detail: `M140 98 L130 120 L146 196 M160 98 L170 120 L154 196 M110 ${hem - 60} L134 ${hem - 60} M166 ${hem - 60} L190 ${hem - 60}`,
      };
    }
  }
}

/** 상품 하나의 착용 레이어 (투명 배경, 모델과 같은 캔버스). */
export function layerSvg(opts: { kind: GarmentKind; pattern: Pattern; base: string; accent: string }): string {
  const { fill, detail } = layerBody(opts.kind);
  const defs = `${patternDef(opts.pattern, opts.base, opts.accent, 0.55)}
<linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
<filter id="ds" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".22"/></filter>`;
  // 조각마다 별도 path: 겹치는 조각의 감김 방향이 달라도 구멍이 생기지 않게
  const parts = fill.split(/(?=M)/).map((d) => d.trim()).filter(Boolean);
  const each = (attrs: string) => parts.map((d) => `<path d="${d}" ${attrs}/>`).join('');
  const body = `<g filter="url(#ds)">${each('fill="url(#p)"')}</g>
${each('fill="url(#sh)"')}
${each('fill="none" stroke="#000" stroke-opacity=".18" stroke-width="1"')}
<path d="${detail}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="1.4" stroke-linecap="round"/>`;
  return svgUri(body, defs);
}
