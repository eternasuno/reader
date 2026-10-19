import type { RouteDefinition } from '@solidjs/router';
import { lazy } from 'solid-js';

const EmptyRoute = () => null;

export const routes: RouteDefinition[] = [
  {
    path: '/',
    component: lazy(() => import('./pages/index')),
    children: [
      { path: '/', component: EmptyRoute },
      { path: '/rss', component: EmptyRoute },
      { path: '/settings', component: EmptyRoute },
      { path: '/read/:kind/:key', component: EmptyRoute },
    ],
  },
  { path: '/login', component: lazy(() => import('./pages/login')) },
  { path: '/register', component: lazy(() => import('./pages/register')) },
];
