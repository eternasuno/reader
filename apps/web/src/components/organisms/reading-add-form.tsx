import { Button } from '../atoms/button';

type ReadingAddFormProps = {
  pending: boolean;
  error: string;
  onAdd: (url: string, form: HTMLFormElement) => void;
};

const submitAdd = (
  event: SubmitEvent & { currentTarget: HTMLFormElement },
  onAdd: ReadingAddFormProps['onAdd']
) => {
  event.preventDefault();
  const url = new FormData(event.currentTarget).get('url');
  if (typeof url === 'string') {
    onAdd(url, event.currentTarget);
  }
};

export const ReadingAddForm = (props: ReadingAddFormProps) => (
  <section class="py-2" aria-labelledby="save-heading">
    <h2 id="save-heading" class="text-lg font-semibold tracking-tight">
      留给下一次专注。
    </h2>
    <p class="mt-2 text-sm text-base-content/60">先存下来，有空再慢慢读。</p>
    <form
      class="mt-4 flex flex-wrap items-center gap-2"
      onSubmit={(event) => submitAdd(event, props.onAdd)}
    >
      <label class="sr-only" for="link-url">
        文章网址
      </label>
      <input
        class="input input-bordered min-w-48 flex-1"
        id="link-url"
        name="url"
        type="url"
        required
        maxlength={4096}
        placeholder="粘贴文章链接…"
        disabled={props.pending}
      />
      <Button
        class="btn btn-neutral"
        type="submit"
        disabled={props.pending}
        aria-busy={props.pending}
      >
        {props.pending ? '处理中…' : '添加链接'}
      </Button>
    </form>
    <p role="status" class="mt-2 min-h-5 text-sm text-error">
      {props.error}
    </p>
  </section>
);
