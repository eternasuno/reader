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

/**
 * `AC-AUTH-4`: only `/login` renders without the session guard. Scope routes use optional article
 * params (`/later/:pageId?`) so opening or closing an article keeps the same `LibraryPage`
 * instance mounted — that preserves loaded rows (`LIB-RELOAD-1`) and lets focus recovery
 * (`LIB-VIEW-1`) see which panel CSS just hid.
 */
export const appRoutes = defineRoutes([
  { path: '/', component: RedirectToLibrary },
  { path: '/login', component: LoginPage },
  { path: '/save', component: ProtectedQuickSave },
  { path: '/later/:pageId?', component: ProtectedLibrary },
  { path: '/all/:itemId?', component: ProtectedLibrary },
  { path: '/feed/:feedId/:itemId?', component: ProtectedLibrary },
  { path: '/folder/:folderId/:itemId?', component: ProtectedLibrary },
  { path: '/settings', component: ProtectedSettings },
  { path: '*404', component: RedirectToLibrary },
]);

export type AppRouter = ReturnType<typeof createAppRouter>;

/** Builds a router instance; tests pass a `memoryHistory()` adapter to control the location. */
export const createAppRouter = (history?: RouterHistory) =>
  createRouter({ routes: appRoutes, history });
