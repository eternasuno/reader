import { type JSX, Portal } from '@solidjs/web';
import { createEffect, onSettled, Show } from 'solid-js';
import { t } from '../i18n';
import { Button, Icon } from '../ui';

export interface ImageLightboxProps {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

const useLightboxKeyboard = (
  isOpen: () => boolean,
  onClose: () => void,
  getCloseButton: () => HTMLButtonElement | undefined
): void => {
  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isOpen()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();

        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        getCloseButton()?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  });
};

const useLightboxFocus = (
  isOpen: () => boolean,
  getCloseButton: () => HTMLButtonElement | undefined
): void => {
  let previouslyFocused: HTMLElement | null = null;

  createEffect(isOpen, (open) => {
    if (open) {
      previouslyFocused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      queueMicrotask(() => getCloseButton()?.focus());

      return;
    }

    if (previouslyFocused) {
      previouslyFocused.focus();
      previouslyFocused = null;
    }
  });
};

export function ImageLightbox(props: ImageLightboxProps): JSX.Element {
  let closeButtonRef: HTMLButtonElement | undefined;
  const isOpen = () => props.src !== null;

  useLightboxKeyboard(
    isOpen,
    () => props.onClose(),
    () => closeButtonRef
  );
  useLightboxFocus(isOpen, () => closeButtonRef);

  return (
    <Show when={props.src}>
      {(src) => (
        <Portal>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('reader.imagePreview')}
            class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-xs"
          >
            <div
              aria-hidden="true"
              class="fixed inset-0"
              onClick={() => props.onClose()}
            />
            <Button
              ref={(el) => {
                closeButtonRef = el;
              }}
              variant="icon"
              size="sm"
              class="absolute top-4 right-4 z-10 text-white/80 hover:text-white"
              aria-label={t('common.close')}
              onClick={() => props.onClose()}
            >
              <Icon name="close" size={20} />
            </Button>
            <img
              src={src()}
              alt={props.alt ?? ''}
              referrerpolicy="no-referrer"
              class="relative z-10 max-h-[85vh] max-w-[92vw] rounded-field object-contain shadow-2xl"
            />
            <Show when={props.alt && props.alt.trim().length > 0}>
              <p class="relative z-10 mt-3 max-w-2xl text-center text-xs text-white/75">
                {props.alt}
              </p>
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  );
}
