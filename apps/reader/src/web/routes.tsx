import {
  Navigate,
  type RouteDefinition,
  Router,
  type RouteSectionProps,
} from '@solidjs/router';
import { LoginPage } from './account/login-page';
import { RegisterPage } from './account/register-page';
import { SessionGuard } from './account/session-guard';
import { LibraryPage } from './library';
import { SettingsPage } from './setting/settings-page';
import { ToastContainer } from './ui/toast';

/** Wraps every route: it is where the toast store's container lives. */
const Root = (props: RouteSectionProps) => (
  <>
    {props.children}
    <ToastContainer />
  </>
);

/** `/` is the later list (`reader-spec`: Routes). */
const LaterRedirect = () => <Navigate href="/later" />;

/**
 * A library path renders the shell above it, so switching scope or article only
 * changes the route's parameters and never remounts the shell (LIB-VIEW).
 */
const LibraryRoute = () => null;

/**
 * Every route of `reader-spec` Routes. `/login` and `/register` are public; every
 * other route sits under the one `SessionGuard`, which redirects without a
 * session (AC-SESSION-4). The library paths are children of one `LibraryPage`
 * shell; `/settings` renders `SettingsPage`.
 */
export const routes: Array<RouteDefinition> = [
  { path: '/login', component: LoginPage },
  { path: '/register', component: RegisterPage },
  {
    path: '/',
    component: SessionGuard,
    children: [
      { path: '/', component: LaterRedirect },
      {
        component: LibraryPage,
        children: [
          { path: '/later', component: LibraryRoute },
          { path: '/later/:pageId', component: LibraryRoute },
          { path: '/all', component: LibraryRoute },
          { path: '/all/:itemId', component: LibraryRoute },
          { path: '/feed/:feedId', component: LibraryRoute },
          { path: '/feed/:feedId/:itemId', component: LibraryRoute },
          { path: '/folder/:folderId', component: LibraryRoute },
          { path: '/folder/:folderId/:itemId', component: LibraryRoute },
        ],
      },
      { path: '/settings', component: SettingsPage },
    ],
  },
];

/** The router; `main.tsx` renders it into `#root`. */
export const App = () => <Router root={Root}>{routes}</Router>;
