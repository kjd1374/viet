import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadCatalog } from './data/catalog';
import './styles.css';

// 카탈로그를 먼저 확정한 뒤 앱을 불러온다 (상품 목록을 쓰는 모듈이 바뀐 목록을 보게)
loadCatalog().then(async () => {
  const { App } = await import('./App');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
