import type { RouteDefinition } from '@solidjs/router';
import { lazy } from 'solid-js';

export const routes: RouteDefinition[] = [
  { path: '/', component: lazy(() => import('./pages/index')) },
  { path: '/login', component: lazy(() => import('./pages/login')) },
  { path: '/register', component: lazy(() => import('./pages/register')) },
];
