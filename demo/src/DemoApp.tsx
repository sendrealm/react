import { useEffect, useMemo, useState } from 'react';
import {
  init,
  useSendrealm,
  useSendrealmPermission,
  useSendrealmSubscription,
  type SendrealmDiagnostics,
  type SendrealmNotificationOpenResult
} from '../../src';

interface DemoAppProps {
  appId: string;
  baseUrl: string;
}

type LogEntry = {
  id: number;
  label: string;
  detail?: unknown;
};

export function DemoApp({ appId, baseUrl }: DemoAppProps) {
  const { client, state, initializing, error } = useSendrealm();
  const { permissionStatus, requestPermission } = useSendrealmPermission();
  const { subscribed, token, optIn, optOut, refreshRegistrationToken } =
    useSendrealmSubscription();
  const [externalUserId, setExternalUserId] = useState('demo-user-123');
  const [email, setEmail] = useState('demo-user@example.com');
  const [tagKey, setTagKey] = useState('demo_segment');
  const [tagValue, setTagValue] = useState('web_push');
  const [eventName, setEventName] = useState('demo.web_push.clicked');
  const [diagnostics, setDiagnostics] = useState<SendrealmDiagnostics | null>(
    null
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const supportSummary = useMemo(
    () => ({
      secureContext: window.isSecureContext,
      notification: 'Notification' in window,
      serviceWorker: 'serviceWorker' in navigator,
      pushManager: 'PushManager' in window
    }),
    []
  );

  function appendLog(label: string, detail?: unknown) {
    setLogs(current => [
      {
        id: Date.now() + Math.random(),
        label,
        detail
      },
      ...current.slice(0, 7)
    ]);
  }

  useEffect(() => {
    void init({
      appId,
      baseUrl,
      autoRequestPermission: false
    }).catch(nextError => {
      appendLog('init failed', String((nextError as Error)?.message || nextError));
      console.error(nextError);
    });
  }, [appId, baseUrl]);

  async function runAction(label: string, action: () => Promise<unknown>) {
    try {
      const result = await action();
      appendLog(label, result);
    } catch (nextError) {
      appendLog(`${label} failed`, String((nextError as Error)?.message || nextError));
    } finally {
      void refreshDiagnostics();
    }
  }

  async function refreshDiagnostics() {
    const nextDiagnostics = await client.getDiagnostics();
    setDiagnostics(nextDiagnostics);
    return nextDiagnostics;
  }

  useEffect(() => {
    const clickSub = client.addNotificationClickListener(
      (event: SendrealmNotificationOpenResult) => {
        appendLog('notification opened', event);
      }
    );
    const actionSub = client.addNotificationActionListener(event => {
      appendLog('notification action', event);
    });
    const foregroundSub = client.addForegroundNotificationListener(event => {
      appendLog('push received', event);
    });

    void refreshDiagnostics();

    return () => {
      clickSub.remove();
      actionSub.remove();
      foregroundSub.remove();
    };
  }, [client]);

  useEffect(() => {
    void refreshDiagnostics();
  }, [
    client,
    state.initialized,
    state.registered,
    state.permissionGranted,
    state.subscribed,
    state.registrationToken
  ]);

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Sendrealm React SDK</p>
          <h1>Web Push Demo</h1>
        </div>
        <div className="statusCluster">
          <StatusPill label="Init" active={state.initialized} />
          <StatusPill label="Permission" active={state.permissionGranted} />
          <StatusPill label="Subscribed" active={subscribed} />
        </div>
      </section>

      <section className="grid">
        <div className="panel controlPanel">
          <div className="panelHeader">
            <h2>Controls</h2>
            <span>{initializing ? 'Starting' : 'Ready'}</span>
          </div>

          <div className="buttonGrid">
            <button onClick={() => runAction('permission', requestPermission)}>
              Request permission
            </button>
            <button onClick={() => runAction('opt in', optIn)}>Opt in</button>
            <button onClick={() => runAction('opt out', optOut)}>Opt out</button>
            <button
              onClick={() =>
                runAction('refresh subscription', () =>
                  refreshRegistrationToken(true)
                )
              }
            >
              Refresh subscription
            </button>
          </div>

          <div className="formGrid">
            <label>
              External ID
              <input
                onChange={event => setExternalUserId(event.target.value)}
                value={externalUserId}
              />
            </label>
            <label>
              Email
              <input
                onChange={event => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </label>
            <button
              className="wide"
              onClick={() =>
                runAction('login', () => client.login(externalUserId, email))
              }
            >
              Login identity
            </button>
            <button
              className="wide secondary"
              onClick={() => runAction('logout', () => client.logout())}
            >
              Logout identity
            </button>
          </div>

          <div className="formGrid">
            <label>
              Tag key
              <input
                onChange={event => setTagKey(event.target.value)}
                value={tagKey}
              />
            </label>
            <label>
              Tag value
              <input
                onChange={event => setTagValue(event.target.value)}
                value={tagValue}
              />
            </label>
            <button
              className="wide"
              onClick={() =>
                runAction('add tag', () => client.addTag(tagKey, tagValue))
              }
            >
              Save tag
            </button>
            <button
              className="wide secondary"
              onClick={() => runAction('remove tag', () => client.removeTag(tagKey))}
            >
              Remove tag
            </button>
          </div>

          <div className="formGrid single">
            <label>
              Event
              <input
                onChange={event => setEventName(event.target.value)}
                value={eventName}
              />
            </label>
            <button
              onClick={() =>
                runAction('track event', () =>
                  client.trackEvent(eventName, {
                    source: 'react_demo',
                    subscribed
                  })
                )
              }
            >
              Track event
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <h2>State</h2>
            <button className="small" onClick={() => void refreshDiagnostics()}>
              Refresh
            </button>
          </div>

          {error ? <div className="errorBox">{String(error)}</div> : null}

          <dl className="stateList">
            <Field label="App ID" value={appId} />
            <Field label="API" value={baseUrl} />
            <Field label="Device" value={state.deviceId || 'none'} />
            <Field label="Permission" value={permissionStatus} />
            <Field label="Token" value={token || 'none'} />
            <Field label="Environment" value={state.environment} />
          </dl>

          <div className="supportGrid">
            {Object.entries(supportSummary).map(([key, value]) => (
              <StatusPill key={key} label={key} active={Boolean(value)} />
            ))}
          </div>

          <pre>{JSON.stringify(diagnostics || state, null, 2)}</pre>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>Events</h2>
          <button className="small secondary" onClick={() => setLogs([])}>
            Clear
          </button>
        </div>

        <div className="eventList">
          {logs.length === 0 ? (
            <div className="empty">No events yet</div>
          ) : (
            logs.map(entry => (
              <article className="eventRow" key={entry.id}>
                <strong>{entry.label}</strong>
                {entry.detail === undefined ? null : (
                  <code>{JSON.stringify(entry.detail, null, 2)}</code>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={active ? 'pill active' : 'pill'}>
      <span />
      {label}
    </span>
  );
}
