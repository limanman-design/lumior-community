import { createRoot } from 'react-dom/client';
import { setLanguage } from '@/app/i18n-core';
import App from './catalog';

setLanguage('zh', false);
createRoot(document.getElementById('root')!).render(<App/>);
