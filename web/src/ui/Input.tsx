import type { JSX } from '@solidjs/web';
import { createUniqueId, omit, Show } from 'solid-js';

interface FieldExtras {
  /** Visible label rendered above the control. */
  label?: string;
  /** Optional helper text rendered below the control. */
  hint?: string;
  /** Optional error text; also sets `aria-invalid` and error styling. */
  error?: string;
  /** Extra classes for the outer field wrapper. */
  containerClass?: string;
  /** Extra classes for the control itself. */
  class?: string;
}

export type InputProps = FieldExtras &
  Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class'>;
export type SelectProps = FieldExtras &
  Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, 'class' | 'children'> & {
    children?: JSX.Element;
  };

interface FieldShellProps {
  id: string;
  label?: string;
  hint?: string;
  error?: string;
  class?: string;
  children: JSX.Element;
}

function FieldShell(props: FieldShellProps): JSX.Element {
  return (
    <div class={['flex w-full flex-col gap-1.5', props.class]}>
      <Show when={props.label}>
        {(label) => (
          <label
            class="text-sm font-medium text-base-content/80"
            for={props.id}
          >
            {label()}
          </label>
        )}
      </Show>
      {props.children}
      <Show when={props.hint}>
        {(hint) => (
          <p id={`${props.id}-hint`} class="text-xs text-base-content/60">
            {hint()}
          </p>
        )}
      </Show>
      <Show when={props.error}>
        {(error) => (
          <p id={`${props.id}-error`} class="text-xs text-error" role="alert">
            {error()}
          </p>
        )}
      </Show>
    </div>
  );
}

function describedBy(
  id: string,
  hint?: string,
  error?: string,
  existing?: unknown
): string | undefined {
  const existingId =
    typeof existing === 'string' && existing.length > 0 ? existing : undefined;
  const ids = [
    existingId,
    hint ? `${id}-hint` : undefined,
    error ? `${id}-error` : undefined,
  ].filter((value): value is string => Boolean(value));
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export function Input(props: InputProps): JSX.Element {
  const generatedId = createUniqueId();
  const id = () =>
    typeof props.id === 'string' && props.id ? props.id : generatedId;
  const rest = omit(
    props,
    'label',
    'hint',
    'error',
    'containerClass',
    'class',
    'id',
    'aria-describedby'
  );

  return (
    <FieldShell
      id={id()}
      label={props.label}
      hint={props.hint}
      error={props.error}
      class={props.containerClass}
    >
      <input
        {...rest}
        id={id()}
        aria-describedby={describedBy(
          id(),
          props.hint,
          props.error,
          props['aria-describedby']
        )}
        aria-invalid={props.error ? 'true' : undefined}
        class={[
          'input w-full',
          { 'input-error': Boolean(props.error) },
          props.class,
        ]}
      />
    </FieldShell>
  );
}

export function Select(props: SelectProps): JSX.Element {
  const generatedId = createUniqueId();
  const id = () =>
    typeof props.id === 'string' && props.id ? props.id : generatedId;
  const rest = omit(
    props,
    'label',
    'hint',
    'error',
    'containerClass',
    'class',
    'id',
    'children',
    'aria-describedby'
  );

  return (
    <FieldShell
      id={id()}
      label={props.label}
      hint={props.hint}
      error={props.error}
      class={props.containerClass}
    >
      <select
        {...rest}
        id={id()}
        aria-describedby={describedBy(
          id(),
          props.hint,
          props.error,
          props['aria-describedby']
        )}
        aria-invalid={props.error ? 'true' : undefined}
        class={[
          'select w-full',
          { 'select-error': Boolean(props.error) },
          props.class,
        ]}
      >
        {props.children}
      </select>
    </FieldShell>
  );
}
