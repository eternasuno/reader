import { render } from '@solidjs/web';
import { App } from './App';
import './index.css';

const root = document.getElementById('app');
if (root) render(() => <App />, root);

const registerServiceWorker = async (): Promise<void> => {
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch {
    console.warn('Service worker registration failed');
  }
};

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void registerServiceWorker();
  });
}
