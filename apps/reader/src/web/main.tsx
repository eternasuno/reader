import { render } from 'solid-js/web';
import { App } from './routes';
import './index.css';

/** The entry: mount the router into `#root` (client rendering only). */
const root = document.getElementById('root');

if (root === null) throw new Error('Root element #root not found');

render(() => <App />, root);
