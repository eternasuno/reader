import { SubmitButton } from '../../atoms/submit-button';
import { FormInput } from '../../molecules/form-input';

type ArticlesSectionProps = {
  readonly class?: string;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly retention: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (form: HTMLFormElement) => void;
};

export const ArticlesSection = (props: ArticlesSectionProps) => (
  <section
    id="settings-articles"
    class={`rounded-box border border-base-300 bg-base-100 p-5 ${props.class ?? ''}`}
    aria-labelledby="settings-articles-title"
  >
    <h2 id="settings-articles-title" class="text-lg font-semibold">
      文章
    </h2>
    <p class="mt-1 text-sm leading-6 text-base-content/60">
      每个订阅源最多保留最近的文章，超出数量的旧文章会自动清理。默认保留 100
      篇。
    </p>
    <form
      class="mt-5 flex flex-col gap-4"
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit(event.currentTarget);
      }}
    >
      <FormInput
        id="settings-retention"
        name="retention"
        type="number"
        min={1}
        step={1}
        required
        label="每个订阅源保留文章数"
        hint="请输入正整数。"
        value={props.retention}
        disabled={props.busy}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
      <div>
        <SubmitButton
          pending={props.pending}
          label="保存文章设置"
          pendingLabel="保存中…"
        />
      </div>
    </form>
  </section>
);
