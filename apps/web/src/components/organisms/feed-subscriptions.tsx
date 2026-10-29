import { resultError } from '../../lib/errors';
import { Button } from '../atoms/button';
import type { FeedReaderModel } from './feed-reader';

export const FeedSubscribeForm = (props: { model: FeedReaderModel }) => (
  <form
    class="flex items-center gap-2 pt-2"
    onSubmit={(event) => {
      event.preventDefault();
      if (!props.model.pending()) {
        void props.model.subscribe(event.currentTarget);
      }
    }}
  >
    <label class="sr-only" for="feed-url">
      订阅地址
    </label>
    <input
      class="input input-bordered min-w-0 flex-1"
      id="feed-url"
      name="url"
      type="url"
      required
      maxLength={4096}
      placeholder="RSS / Atom 订阅地址"
      aria-label="订阅地址"
      disabled={props.model.pending()}
    />
    <Button
      class="btn btn-neutral"
      type="submit"
      disabled={props.model.pending()}
      aria-busy={props.model.pending()}
    >
      {props.model.pending() ? '处理中…' : '订阅'}
    </Button>
  </form>
);

export const FeedManagement = (props: { model: FeedReaderModel }) => {
  const message = () =>
    resultError(props.model.mutation()) || props.model.notice();
  const failed = () => resultError(props.model.mutation()) !== '';

  return (
    <section aria-label="添加订阅" class="py-2">
      <h2 class="text-lg font-semibold tracking-tight">添加订阅</h2>
      <p class="mt-2 text-sm text-base-content/60">
        添加 RSS 或 Atom 地址，订阅源每 30 分钟自动更新。
      </p>
      <FeedSubscribeForm model={props.model} />
      <p
        class="mt-2 min-h-5 text-sm"
        classList={{ 'text-error': failed(), 'text-success': !failed() }}
        role={failed() ? 'alert' : 'status'}
      >
        {message()}
      </p>
    </section>
  );
};
