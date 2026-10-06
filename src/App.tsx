import { useCallback, useEffect, useMemo, useState } from 'react';
import { PRODUCT_BY_ID } from './data/products';
import { useRoute } from './route';
import { countOf, deckOf, listOf } from './store/appStore';
import { DEV, store, useApp } from './store/instance';
import { Deck } from './components/Deck';
import { Guide } from './components/Guide';
import { IconBookmark, IconHelp, IconPause } from './components/Icons';
import { ListView } from './components/ListView';
import { Sheet } from './components/Sheet';
import { Styling } from './components/Styling';
import { DevPanel, SyncBadge, Toasts } from './components/Status';

export function App() {
  const app = useApp();
  const { route, go, home, back, openSheet, closeSheet } = useRoute();
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);

  // 첫 로딩 후 한 번: 숨기기를 선택하지 않았다면 안내를 연다
  useEffect(() => {
    if (app.ready && guideOpen === null) setGuideOpen(!app.guideHidden);
  }, [app.ready, app.guideHidden, guideOpen]);

  const closeGuide = useCallback((hide: boolean) => {
    store.setGuideHidden(hide);
    setGuideOpen(false);
  }, []);

  const deck = useMemo(() => deckOf(app.decisions), [app.decisions]);
  const saved = useMemo(() => listOf(app.decisions, 'saved'), [app.decisions]);
  const held = useMemo(() => listOf(app.decisions, 'held'), [app.decisions]);

  if (app.loadError)
    return (
      <div className="app center">
        <p>저장된 기록을 불러오지 못했어요.</p>
        <p className="muted small">{app.loadError}</p>
        <button className="btn" onClick={() => location.reload()}>다시 시도</button>
      </div>
    );
  if (!app.ready) return <div className="app" aria-busy="true" />;

  const sheetProduct = route.sheet ? PRODUCT_BY_ID.get(route.sheet) : undefined;
  const overlayOpen = !!sheetProduct || !!guideOpen;

  return (
    <div className="app" data-view={route.view}>
      {route.view === 'deck' ? (
        <>
          <header className="top-bar">
            <button className="nav-btn" onClick={() => go('saved')} aria-label={`보관함 ${saved.length}개`}>
              <IconBookmark size={20} />
              <span>보관함</span>
              <b className="nav-count">{saved.length}</b>
            </button>
            <div className="top-center" />
            <button className="nav-btn" onClick={() => go('held')} aria-label={`보류 목록 ${held.length}개`}>
              <IconPause size={18} />
              <span>보류</span>
              <b className="nav-count">{held.length}</b>
            </button>
            <button className="icon-btn" onClick={() => setGuideOpen(true)} aria-label="사용 안내 보기">
              <IconHelp size={22} />
            </button>
          </header>

          {deck.length > 0 ? (
            <Deck cards={deck} overlayOpen={overlayOpen} onInfo={openSheet} />
          ) : (
            <div className="stage">
              <div className="empty deck-empty">
                <p className="empty-title">모든 상품을 확인했어요</p>
                <p className="empty-hint">
                  삭제한 {countOf(app.decisions, 'deleted')}개는 다시 나오지 않아요.
                  <br />
                  보관하거나 보류한 상품을 다시 살펴보세요.
                </p>
                <div className="row">
                  <button className="btn btn-save" onClick={() => go('saved')}>보관함 {saved.length}</button>
                  <button className="btn btn-hold" onClick={() => go('held')}>보류 목록 {held.length}</button>
                </div>
              </div>
            </div>
          )}
          {deck.length === 0 && <div className="actions" />}
          <div className="sync-slot">
            <SyncBadge sync={app.sync} />
          </div>
          <Toasts undo={app.undo} error={app.error} />
        </>
      ) : route.view === 'styling' ? (
        <>
          <Styling saved={saved} outfit={app.outfit} onBack={() => back('saved')} onDeck={() => go('deck')} onInfo={openSheet} />
          <Toasts undo={app.undo} error={app.error} />
        </>
      ) : (
        <>
          <ListView
            kind={route.view}
            items={route.view === 'saved' ? saved : held}
            onBack={home}
            onOpen={openSheet}
            onGoOther={() => {
              // 목록끼리 이동은 기록을 쌓지 않고 교체한다 → 뒤로가기 한 번에 탐색으로
              history.replaceState({ nav: true }, '', route.view === 'saved' ? '#/held' : '#/saved');
              dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
            }}
            otherCount={route.view === 'saved' ? held.length : saved.length}
            onStyling={route.view === 'saved' ? () => go('styling') : undefined}
          />
          <Toasts undo={app.undo} error={app.error} />
        </>
      )}

      {sheetProduct && (
        <Sheet
          product={sheetProduct}
          state={app.decisions[sheetProduct.id]?.state ?? 'unseen'}
          context={route.view}
          onClose={closeSheet}
        />
      )}
      {guideOpen && route.view === 'deck' && <Guide hidden={app.guideHidden} onClose={closeGuide} />}
      {DEV && <DevPanel sync={app.sync} />}
    </div>
  );
}
