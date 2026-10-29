import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  type Setter,
  useContext,
} from 'solid-js';
import { makeFeedAtoms } from '../lib/feeds';
import { makeReadingAtoms } from '../lib/links';

type WorkspaceData = {
  readonly reading: ReturnType<typeof makeReadingAtoms>;
  readonly feeds: ReturnType<typeof makeFeedAtoms>;
  readonly onlyUnread: Accessor<boolean>;
  readonly setOnlyUnread: Setter<boolean>;
};

const WorkspaceDataContext = createContext<WorkspaceData>();

export const WorkspaceDataProvider = (props: {
  readonly children: JSX.Element;
}) => {
  const [onlyUnread, setOnlyUnread] = createSignal(true);
  const value: WorkspaceData = {
    reading: makeReadingAtoms(),
    feeds: makeFeedAtoms(),
    onlyUnread,
    setOnlyUnread,
  };

  return (
    <WorkspaceDataContext.Provider value={value}>
      {props.children}
    </WorkspaceDataContext.Provider>
  );
};

export const useWorkspaceData = (): WorkspaceData => {
  const value = useContext(WorkspaceDataContext);
  if (!value) {
    throw new Error('Workspace data is unavailable');
  }

  return value;
};
