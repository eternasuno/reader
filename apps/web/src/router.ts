import type { RouteDefinition } from '@solidjs/router';
import { lazy } from 'solid-js';

const EmptyRoute = () => null;

export const routes: Array<RouteDefinition> = [
  {
    path: '/',
    component: lazy(() => import('./pages/library')),
    children: [
      { path: '/', component: EmptyRoute },
      { path: '/rss', component: EmptyRoute },
      { path: '/read/:kind/:key', component: EmptyRoute },
    ],
  },
  { path: '/settings', component: lazy(() => import('./pages/settings')) },
  { path: '/login', component: lazy(() => import('./pages/login')) },
  { path: '/register', component: lazy(() => import('./pages/register')) },
];
