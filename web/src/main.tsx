import { render } from '@solidjs/web'
import './index.css'

const App = () => <div class="min-h-dvh bg-base-100 text-base-content">留白</div>

const root = document.getElementById('app')
if (root) {
  render(() => <App />, root)
}
