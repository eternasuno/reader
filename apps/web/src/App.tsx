import './index.css';
import { Router } from '@solidjs/router';
import { routes } from './router';

const App = () => (
  <Router
    root={(props) => (
      <>
        <h1 class="sr-only">Solid Surreal Starter</h1>
        {props.children}
      </>
    )}
  >
    {routes}
  </Router>
);

export default App;
