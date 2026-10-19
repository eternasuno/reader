import './index.css';
import { Router } from '@solidjs/router';
import { routes } from './router';

const App = () => (
  <Router
    root={(props) => (
      <>
        <h1 class="sr-only">稍后阅读</h1>
        {props.children}
      </>
    )}
  >
    {routes}
  </Router>
);

export default App;
