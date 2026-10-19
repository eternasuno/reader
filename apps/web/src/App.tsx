import './index.css';
import { Router } from '@solidjs/router';
import { routes } from './router';

const App = () => (
  <Router
    root={(props) => (
      <div class="[&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-3 [&_:focus-visible]:outline-primary motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:scroll-auto motion-reduce:[&_*]:transition-none">
        <h1 class="sr-only">稍后阅读</h1>
        {props.children}
      </div>
    )}
  >
    {routes}
  </Router>
);

export default App;
