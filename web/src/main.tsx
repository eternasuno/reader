import { render } from '@solidjs/web';
import { App } from './App';
import './index.css';

const root = document.getElementById('app');
if (root) render(() => <App />, root);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
