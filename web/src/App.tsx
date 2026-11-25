import type { JSX } from '@solidjs/web';
import { t } from './i18n';
import type { AppRouter } from './routes';
import { createAppRouter } from './routes';
import { ToastViewport } from './ui';

export interface AppProps {
  /** Optional router instance (tests use a memory history adapter). */
  router?: AppRouter;
}

const defaultRouter = createAppRouter();

/** Root component: router outlet plus the single app-wide toast viewport (`LIB-TOAST-1`). */
export function App(props: AppProps): JSX.Element {
  const Router = props.router ?? defaultRouter;

  return (
    <>
      <Router>{(section) => section.children}</Router>
      <ToastViewport closeLabel={t('common.close')} />
    </>
  );
}
