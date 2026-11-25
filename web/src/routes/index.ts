import {
  createRouter,
  defineRoutes,
  type RouterHistory,
} from '@solidjs/router';
import type { Component } from 'solid-js';
import { createComponent } from 'solid-js';
import { LibraryPage } from './LibraryPage';
import { LoginPage } from './LoginPage';
import { QuickSavePage } from './QuickSavePage';
import { Redirect, withSession } from './SessionGuard';
import { SettingsPage } from './SettingsPage';

const RedirectToLibrary: Component = () =>
  createComponent(Redirect, { to: '/later' });
const ProtectedLibrary = withSession(LibraryPage);
const ProtectedQuickSave = withSession(QuickSavePage);
const ProtectedSettings = withSession(SettingsPage);
const ScopeOutlet: Component = () => null;

/**
 * `AC-AUTH-4`: only `/login` renders without the session guard. Every library scope is a child
 * of one pathless layout route that renders the guarded `LibraryPage`, so switching between
 * `/later`, `/all`, `/feed/:id`, and `/folder/:id` never remounts the page or re-verifies the
 * session — that preserves loaded rows (`LIB-RELOAD-1`) and lets focus recovery (`LIB-VIEW-1`)
 * see which panel CSS just hid. The children render nothing: the URL is the source of truth and
 * `LibraryPage` reads it. Unknown paths redirect to `/later`.
 */
export const appRoutes = defineRoutes([
  { path: '/', component: RedirectToLibrary },
  { path: '/login', component: LoginPage },
  { path: '/save', component: ProtectedQuickSave },
  { path: '/settings', component: ProtectedSettings },
  {
    component: ProtectedLibrary,
    children: [
      { path: '/later/:pageId?', component: ScopeOutlet },
      { path: '/all/:itemId?', component: ScopeOutlet },
      { path: '/feed/:feedId/:itemId?', component: ScopeOutlet },
      { path: '/folder/:folderId/:itemId?', component: ScopeOutlet },
    ],
  },
  { path: '*404', component: RedirectToLibrary },
]);

export type AppRouter = ReturnType<typeof createAppRouter>;

/** Builds a router instance; tests pass a `memoryHistory()` adapter to control the location. */
export const createAppRouter = (history?: RouterHistory) =>
  createRouter({ routes: appRoutes, history });
