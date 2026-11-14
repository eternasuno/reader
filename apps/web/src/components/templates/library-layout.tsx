import type { JSX } from 'solid-js';

type LibraryLayoutProps = {
  readonly reading: boolean;
  readonly navOpen: boolean;
  readonly mobileBar: JSX.Element;
  readonly sidebar: JSX.Element;
  readonly list: JSX.Element;
  readonly reader: JSX.Element;
  readonly children?: JSX.Element;
};

export const LibraryLayout = (props: LibraryLayoutProps) => (
  <>
    <div
      class="group/workspace grid h-dvh grid-cols-[16rem_24rem_minmax(0,1fr)] overflow-hidden bg-[#121212] font-sans text-sm text-base-content max-xl:grid-cols-[13rem_20rem_minmax(0,1fr)] max-lg:grid-cols-[13rem_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[3.25rem_minmax(0,1fr)]"
      data-reading={props.reading}
      data-nav={props.navOpen}
    >
      {props.mobileBar}
      <aside class="min-h-0 min-w-0 border-r border-base-300 bg-base-100 max-sm:col-start-1 max-sm:row-start-2 max-sm:hidden max-sm:group-data-[nav=true]/workspace:flex">
        {props.sidebar}
      </aside>
      <section
        class="min-h-0 min-w-0 overflow-hidden border-r border-base-300 bg-base-100 max-sm:col-start-1 max-sm:row-start-2 max-sm:group-data-[nav=true]/workspace:hidden max-lg:group-data-[reading=true]/workspace:hidden"
        aria-label="文章列表"
      >
        {props.list}
      </section>
      <section
        class="min-h-0 min-w-0 overflow-hidden max-sm:col-start-1 max-sm:row-start-2 max-sm:group-data-[nav=true]/workspace:hidden max-lg:hidden max-lg:group-data-[reading=true]/workspace:block"
        aria-label="正文"
      >
        {props.reader}
      </section>
    </div>
    {props.children}
  </>
);
