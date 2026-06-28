import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from 'react';
import SendrealmDefault, { SendrealmWebClient } from './client';
import type {
  SendrealmInitializeResult,
  SendrealmInitializeOptions,
  SendrealmListenerSubscription,
  SendrealmPermissionStatus,
  SendrealmState
} from './types';

export interface SendrealmProviderProps {
  children: ReactNode;
  options: SendrealmInitializeOptions;
  client?: SendrealmWebClient;
  onError?: (error: unknown) => void;
}

export interface SendrealmContextValue {
  client: SendrealmWebClient;
  state: SendrealmState;
  initializing: boolean;
  error: unknown | null;
}

const initialState: SendrealmState = {
  initialized: false,
  registered: false,
  permissionGranted: false,
  subscribed: false,
  deviceId: null,
  registrationToken: null,
  tokenStatus: 'missing',
  externalUserId: null,
  userEmail: null,
  platform: 'web',
  environment: 'production',
  sdkVersion: '0.1.1'
};

const SendrealmContext = createContext<SendrealmContextValue | null>(null);

const singletonSubscribers = new Set<() => void>();
let singletonSnapshot: SendrealmContextValue = {
  client: SendrealmDefault,
  state: initialState,
  initializing: false,
  error: null
};
let singletonInitializePromise: Promise<SendrealmInitializeResult> | null = null;
let singletonPermissionSub: SendrealmListenerSubscription | null = null;
let singletonSubscriptionSub: SendrealmListenerSubscription | null = null;

function emitSingletonChange() {
  singletonSubscribers.forEach(listener => {
    listener();
  });
}

function setSingletonSnapshot(next: Partial<SendrealmContextValue>) {
  singletonSnapshot = {
    ...singletonSnapshot,
    ...next
  };
  emitSingletonChange();
}

async function refreshSingletonState() {
  const state = await SendrealmDefault.getState();
  setSingletonSnapshot({ state });
  return state;
}

function bindSingletonObservers() {
  if (singletonPermissionSub || singletonSubscriptionSub) {
    return;
  }

  singletonPermissionSub = SendrealmDefault.addPermissionObserver(() => {
    void refreshSingletonState();
  });
  singletonSubscriptionSub = SendrealmDefault.addSubscriptionObserver(() => {
    void refreshSingletonState();
  });
}

function subscribeToSingleton(listener: () => void) {
  bindSingletonObservers();
  singletonSubscribers.add(listener);
  void refreshSingletonState().catch(() => undefined);

  return () => {
    singletonSubscribers.delete(listener);
  };
}

function getSingletonSnapshot() {
  return singletonSnapshot;
}

export function getSendrealmClient() {
  return SendrealmDefault;
}

export function init(
  options: SendrealmInitializeOptions
): Promise<SendrealmInitializeResult> {
  bindSingletonObservers();

  if (singletonInitializePromise) {
    return singletonInitializePromise;
  }

  setSingletonSnapshot({
    client: SendrealmDefault,
    initializing: true,
    error: null
  });

  singletonInitializePromise = SendrealmDefault.initialize(options)
    .then(async result => {
      await refreshSingletonState();
      setSingletonSnapshot({
        initializing: false,
        error: null
      });
      return result;
    })
    .catch(error => {
      singletonInitializePromise = null;
      setSingletonSnapshot({
        initializing: false,
        error
      });
      throw error;
    });

  return singletonInitializePromise;
}

export function initialize(
  options: SendrealmInitializeOptions
): Promise<SendrealmInitializeResult> {
  return init(options);
}

export function SendrealmProvider({
  children,
  options,
  client = SendrealmDefault,
  onError
}: SendrealmProviderProps) {
  const [state, setState] = useState<SendrealmState>(initialState);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initializeProvider() {
      setInitializing(true);
      setError(null);

      try {
        await client.initialize(options);

        if (!cancelled) {
          setState(await client.getState());
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError);
          onError?.(nextError);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    }

    void initializeProvider();

    const permissionSub = client.addPermissionObserver(async () => {
      if (!cancelled) {
        setState(await client.getState());
      }
    });
    const subscriptionSub = client.addSubscriptionObserver(async () => {
      if (!cancelled) {
        setState(await client.getState());
      }
    });

    return () => {
      cancelled = true;
      permissionSub.remove();
      subscriptionSub.remove();
    };
  }, [client, options.appId, options.baseUrl, options.environment, options.serviceWorkerPath, options.serviceWorkerScope]);

  const value = useMemo(
    () => ({
      client,
      state,
      initializing,
      error
    }),
    [client, error, initializing, state]
  );

  return (
    <SendrealmContext.Provider value={value}>
      {children}
    </SendrealmContext.Provider>
  );
}

export function useSendrealm() {
  const context = useContext(SendrealmContext);
  const singletonValue = useSyncExternalStore(
    subscribeToSingleton,
    getSingletonSnapshot,
    getSingletonSnapshot
  );

  return context || singletonValue;
}

export function useSendrealmPermission() {
  const { client, state } = useSendrealm();
  const [permissionStatus, setPermissionStatus] =
    useState<SendrealmPermissionStatus>(
      state.permissionGranted ? 'authorized' : 'not_determined'
    );

  useEffect(() => {
    let cancelled = false;

    void client.getPermissionStatus().then(status => {
      if (!cancelled) {
        setPermissionStatus(status);
      }
    });

    const subscription = client.addPermissionObserver(event => {
      setPermissionStatus(event.status);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [client, state.permissionGranted]);

  return {
    permissionStatus,
    permissionGranted: state.permissionGranted,
    requestPermission: () => client.requestPermission()
  };
}

export function useSendrealmSubscription() {
  const { client, state } = useSendrealm();

  return {
    subscribed: state.subscribed,
    token: state.registrationToken,
    optIn: () => client.optIn(),
    optOut: () => client.optOut(),
    refreshRegistrationToken: (forceRefresh?: boolean) =>
      client.refreshRegistrationToken(forceRefresh)
  };
}
