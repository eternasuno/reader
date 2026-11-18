import type * as contractErrors from '../../contract/errors';

type ContractErrorClass = (typeof contractErrors)[keyof typeof contractErrors];

/**
 * Every tag the contract can answer with. It is read off the error classes, so a
 * new contract error is a compile error until `messages.ts` has a wording for it.
 */
export type ContractErrorTag = InstanceType<ContractErrorClass>['_tag'];

/** The failures the transport adds to the contract's own tags. */
export type TransportFailureTag =
  | 'Unauthorized'
  | 'Forbidden'
  | 'RequestFailed'
  | 'NetworkError'
  | 'InvalidResponse';

/** The tag of every failure an API function can reject with. */
export type ApiFailureTag = ContractErrorTag | TransportFailureTag;

/**
 * What every `api/` function rejects with: the contract's error tag (`_tag` of
 * the decoded error body, e.g. `SavedPageAlreadyExists`) or one of the transport
 * tags `Unauthorized`, `Forbidden`, `RequestFailed`, `NetworkError`,
 * `InvalidResponse`. `id` and `url` are the detail a contract error carries,
 * when it has one. `messageOf` (`messages.ts`) turns a failure into its Chinese
 * wording; the `message` here is the tag and is not shown to the user.
 */
export class ApiFailure extends Error {
  readonly tag: ApiFailureTag;
  readonly id: string | undefined;
  readonly url: string | undefined;

  constructor(
    tag: ApiFailureTag,
    detail: {
      readonly id?: string | undefined;
      readonly url?: string | undefined;
    } = {}
  ) {
    super(tag);
    this.name = 'ApiFailure';
    this.tag = tag;
    this.id = detail.id;
    this.url = detail.url;
  }
}

/** The `_tag` of a decoded error body, or undefined for a value without one. */
export const tagOf = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;

  const tag: unknown = Reflect.get(value, '_tag');

  return typeof tag === 'string' ? tag : undefined;
};

/** The `id` or `url` a decoded contract error carries, when it carries one. */
export const detailOf = (value: unknown) => {
  if (typeof value !== 'object' || value === null) return {};

  return {
    id: textOf(value, 'id'),
    url: textOf(value, 'url'),
  };
};

const textOf = (value: object, key: string): string | undefined => {
  const field: unknown = Reflect.get(value, key);

  return typeof field === 'string' ? field : undefined;
};
