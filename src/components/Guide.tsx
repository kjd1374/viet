import { useEffect, useState } from 'react';
import { IconBookmark, IconPause, IconUp, IconX } from './Icons';

type Props = { hidden: boolean; onClose: (hideNextTime: boolean) => void };

export function Guide({ hidden, onClose }: Props) {
  const [hide, setHide] = useState(hidden);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(hide);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hide, onClose]);

  return (
    <div className="guide-root" role="dialog" aria-modal="true" aria-labelledby="guide-title" data-testid="guide">
      <div className="guide">
        <h2 id="guide-title">이렇게 정리해요</h2>
        <ul className="guide-list">
          <li>
            <span className="g-ico g-del"><IconX size={20} /></span>
            <div><b>왼쪽으로 밀기 · 삭제</b><small>탐색에서 빠지고 다시 나오지 않아요</small></div>
          </li>
          <li>
            <span className="g-ico g-save"><IconBookmark size={20} /></span>
            <div><b>오른쪽으로 밀기 · 보관</b><small>보관함에 저장돼요</small></div>
          </li>
          <li>
            <span className="g-ico g-info"><IconUp size={20} /></span>
            <div><b>위로 밀기 · 구매 정보</b><small>출처와 가격을 봐요. 카드는 그대로예요</small></div>
          </li>
          <li>
            <span className="g-ico g-hold"><IconPause size={20} /></span>
            <div><b>아래 보류 버튼</b><small>보류 목록에 모아 두고 나중에 결정해요</small></div>
          </li>
        </ul>
        <p className="guide-note">실수했다면 바로 뜨는 ‘되돌리기’를 누르세요. 기록은 이 브라우저에만 저장됩니다.</p>
        <label className="check">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />
          다음부터 안내 숨기기
        </label>
        <button className="btn btn-primary" onClick={() => onClose(hide)} autoFocus>
          시작하기
        </button>
      </div>
    </div>
  );
}
