import { getModules } from '@valenced/modules/finders';
import { withProps } from '@valenced/modules/finders/filters';
import { getStore, onFluxEventDispatched } from '@valenced/discord/flux';
import { AppState } from 'react-native';
import {
  commandRequest,
  nextRepeat,
  normalizePlayback,
  positionAt,
  type Command,
  type Playback,
} from './playback';

const API_BASE = 'https://api.spotify.com/v1/me/player';
const SETTLE_MS = 1200;

type Method = 'get' | 'put' | 'post';
type Query = Record<string, string | number | boolean>;
export type State = { playback: Playback | null; status: string; busy: boolean; connected: boolean };
const listeners = new Set<() => void>();
let state: State = {
  playback: null,
  status: 'Connecting to Discord’s Spotify session…',
  busy: false,
  connected: false,
};
let active = false,
  generation = 0,
  readRevision = 0;
let spotify: any, accounts: any, actions: any, http: any;
let credential: { accountId: string; accessToken: string } | null = null;
let device: { id: string; is_active: boolean } | null = null;
let seeking = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Set<AbortController>();
let refreshPromise: Promise<void> | null = null;
let bootstrapPromise: Promise<void> | null = null;
function update(change: Partial<State>) {
  state = { ...state, ...change };
  for (const fn of listeners) fn();
}
export const getState = () => state;
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function session() {
  try {
    const current = spotify?.getActiveSocketAndDevice?.();
    if (current?.socket?.accessToken)
      return { accountId: current.socket.accountId, accessToken: current.socket.accessToken };
  } catch {}
  return credential;
}
function safeError(status: unknown): string {
  if (status === 401) return 'Spotify session expired. Tap Reconnect in settings.';
  if (status === 403) return 'Spotify rejected this control. Check Premium and playback permissions.';
  if (status === 404) return 'Start a song on a Spotify device, then refresh.';
  if (status === 429) return 'Spotify is limiting requests. Wait a moment before trying again.';
  return typeof status === 'number'
    ? 'Spotify could not complete the request (' + status + ').'
    : 'Could not reach Spotify.';
}
const statusOf = (error: any): unknown => error?.status ?? error?.response?.status;
async function viaFetch(method: Method, url: string, query: Query, accessToken: string) {
  const search = Object.keys(query)
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key])))
    .join('&');
  const controller = new AbortController();
  pending.add(controller);
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(search ? url + '?' + search : url, {
      method: method.toUpperCase(),
      headers: { Authorization: 'Bearer ' + accessToken },
      signal: controller.signal,
    });
    if (!response.ok) throw { status: response.status };
    return method !== 'get' || response.status !== 200 ? null : { body: await response.json() };
  } finally {
    clearTimeout(timeout);
    pending.delete(controller);
  }
}
async function direct(
  method: Method,
  auth: { accountId: string; accessToken: string },
  url: string,
  query: Query,
  retried = false,
): Promise<any> {
  try {
    const send = http?.[method];
    if (typeof send === 'function')
      return await send({ url, query, headers: { authorization: 'Bearer ' + auth.accessToken } });
    return await viaFetch(method, url, query, auth.accessToken);
  } catch (error) {
    if (statusOf(error) !== 401 || retried || !actions?.getAccessToken) throw error;
    await actions.getAccessToken(auth.accountId);
    const renewed = session();
    if (!active || !renewed) throw error;
    return direct(method, renewed, url, query, true);
  }
}
async function request(method: Method, route: string, query: Query = {}) {
  if (!active) throw new Error('Spotify Controls is stopped');
  const auth = session();
  if (!auth) throw new Error('Connect Spotify under Discord’s Connections, then tap Reconnect.');
  const target =
    device ??
    (state.playback?.deviceId
      ? { id: state.playback.deviceId, is_active: state.playback.deviceActive }
      : null);
  if (target?.is_active) query = { ...query, device_id: target.id };
  const url = API_BASE + route,
    helper = method === 'post' ? null : actions?.SpotifyAPI?.[method];
  try {
    const response =
      typeof helper === 'function'
        ? await helper(auth.accountId, auth.accessToken, { url, query })
        : await direct(method, auth, url, query);
    return response?.body ?? null;
  } catch (error) {
    const status = statusOf(error);
    if (typeof status === 'number' && status >= 200 && status < 300) return null;
    if (error instanceof Error && status === undefined)
      throw new Error(
        error.name === 'AbortError' ? 'Spotify did not answer in time.' : 'Could not reach Spotify.',
      );
    throw new Error(safeError(status));
  }
}
function cancelSettle() {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}
function settle() {
  cancelSettle();
  const epoch = generation;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (active && epoch === generation) void refresh();
  }, SETTLE_MS);
}
export function refresh(): Promise<void> {
  if (!active || AppState.currentState !== 'active') return Promise.resolve();
  if (refreshPromise) return refreshPromise;
  const epoch = generation;
  const revision = ++readRevision;
  refreshPromise = (async () => {
    try {
      const raw = await request('get', '');
      if (!active || epoch !== generation || revision !== readRevision) return;
      if (raw?.device?.id) device = { id: String(raw.device.id), is_active: !!raw.device.is_active };
      const playback =
        normalizePlayback(raw) ??
        (state.playback
          ? { ...state.playback, playing: false, position: positionAt(state.playback), updatedAt: Date.now() }
          : null);
      seeking = false;
      update({
        playback,
        connected: true,
        status: playback ? 'Connected to Spotify' : 'Start a song in Spotify to show the player.',
      });
    } catch (error) {
      if (active && epoch === generation && revision === readRevision)
        update({ status: error instanceof Error ? error.message : 'Could not connect to Spotify.' });
    } finally {
      if (epoch === generation && revision === readRevision) refreshPromise = null;
    }
  })();
  return refreshPromise;
}
export async function reconnect(renew = true) {
  if (!active || bootstrapPromise) return bootstrapPromise;
  const epoch = generation;
  bootstrapPromise = (async () => {
    await Promise.resolve();
    try {
      const list = accounts?.getAccounts?.() ?? [];
      const account = (Array.isArray(list) ? list : Object.values(list)).find(
        (a: any) => a.type === 'spotify',
      );
      const accountId = account?.id ?? session()?.accountId;
      if (accountId && actions?.getAccessToken && (renew || !session())) {
        update({ status: 'Connecting to the Spotify account linked to Discord…' });
        await actions.getAccessToken(accountId);
        if (active && epoch === generation) await refresh();
      } else if (session()) await refresh();
      else
        update({
          status:
            !actions || !accounts
              ? 'Waiting for Discord’s Spotify modules…'
              : 'Connect Spotify in Discord → Connections first.',
        });
    } catch {
      if (active && epoch === generation)
        update({ status: 'Could not refresh the Discord Spotify connection.' });
    } finally {
      if (epoch === generation) bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
}
export async function command(action: Command, value?: number) {
  if (!active || state.busy || !state.playback) return;
  if (action === 'seek' && seeking) return;
  const epoch = generation,
    track = state.playback;
  readRevision++;
  refreshPromise = null;
  if (action === 'seek') seeking = true;
  update({ busy: true });
  try {
    const req = commandRequest(action, track, value);
    await request(req.method, req.route, req.query);
    if (!active || epoch !== generation) return;
    readRevision++;
    refreshPromise = null;
    const current = state.playback;
    if (current?.id === track.id) {
      const now = Date.now();
      if (action === 'pause')
        update({
          playback: { ...current, playing: false, position: positionAt(current, now), updatedAt: now },
        });
      else if (action === 'play')
        update({
          playback: { ...current, playing: true, position: positionAt(current, now), updatedAt: now },
        });
      else if (action === 'seek')
        update({
          playback: {
            ...current,
            position: Math.max(0, Math.min(track.duration, value ?? 0)),
            updatedAt: now,
          },
        });
      else if (action === 'shuffle') update({ playback: { ...current, shuffle: !track.shuffle } });
      else if (action === 'repeat') update({ playback: { ...current, repeat: nextRepeat(track.repeat) } });
    }
    settle();
  } catch (error) {
    if (active && epoch === generation)
      update({ status: error instanceof Error ? error.message : 'Spotify control failed.' });
  } finally {
    if (action === 'seek') seeking = false;
    if (active && epoch === generation) update({ busy: false });
  }
}
function linkedAccountIds(): string[] {
  try {
    const list = accounts?.getAccounts?.() ?? [];
    return (Array.isArray(list) ? list : Object.values(list))
      .filter((a: any) => a?.type === 'spotify' && a.id)
      .map((a: any) => String(a.id));
  } catch {
    return [];
  }
}
let askedForToken = 0;
function onPlayerState(event: any) {
  const current = session()?.accountId;
  if (
    event.accountId !== undefined &&
    event.accountId !== current &&
    !linkedAccountIds().includes(String(event.accountId))
  )
    return;
  if (!current && Date.now() - askedForToken > 5000) {
    askedForToken = Date.now();
    void reconnect(true);
  }
  cancelSettle();
  seeking = false;
  if (event.device?.id) device = { id: String(event.device.id), is_active: !!event.device.is_active };
  const next = normalizePlayback(event),
    previous = state.playback;
  if (!next) {
    if (previous?.playing)
      update({
        playback: { ...previous, playing: false, position: positionAt(previous), updatedAt: Date.now() },
      });
    return;
  }
  const detailed = typeof event.actual_repeat === 'string' || typeof event.repeat_state === 'string';
  const repeating = typeof event.repeat === 'boolean' ? event.repeat : null;
  let stale = !previous;
  if (!detailed && previous) {
    next.shuffle = 'shuffle' in event || 'shuffle_state' in event ? next.shuffle : previous.shuffle;
    if (repeating === null) next.repeat = previous.repeat;
    else if (!repeating) next.repeat = 'off';
    else {
      next.repeat = previous.repeat === 'off' ? 'context' : previous.repeat;
      stale = previous.repeat === 'off';
    }
  }
  next.deviceId = next.deviceId ?? previous?.deviceId ?? null;
  if (!event.device) next.deviceActive = previous?.deviceActive ?? false;
  readRevision++;
  refreshPromise = null;
  update({ playback: next, connected: true, status: 'Connected to Spotify' });
  if (stale && !detailed) void refresh();
}
export function startSpotify() {
  active = true;
  generation++;
  const undo: (() => void)[] = [];
  let renewed = false,
    queued = false;
  const ensure = () => {
    if (!active) return;
    if (bootstrapPromise) {
      if (!queued) {
        queued = true;
        void bootstrapPromise.finally(() => {
          queued = false;
          ensure();
        });
      }
      return;
    }
    if (!spotify || !accounts || !actions) {
      void reconnect(false);
      return;
    }
    if (!renewed && linkedAccountIds().length) {
      const epoch = generation;
      void reconnect(true).then(() => {
        if (active && epoch === generation && session()) renewed = true;
      });
      return;
    }
    if (!state.connected) void reconnect(false);
  };
  const watch = (store: any) => {
    try {
      store?.addChangeListener?.(ensure);
      undo.push(() => {
        try {
          store?.removeChangeListener?.(ensure);
        } catch {}
      });
    } catch {}
  };
  undo.push(
    getStore('SpotifyStore', (value) => {
      spotify = value;
      watch(value);
      ensure();
    }),
  );
  undo.push(
    getStore('ConnectedAccountsStore', (value) => {
      accounts = value;
      watch(value);
      ensure();
    }),
  );
  undo.push(
    getModules(withProps('SpotifyAPI', 'getAccessToken', 'getDevices'), (value) => {
      actions = value;
      ensure();
    }),
  );
  const retry: any = setInterval(() => {
    if (AppState.currentState === 'active' && (!state.connected || !renewed)) ensure();
  }, 15000);
  retry?.unref?.();
  undo.push(() => clearInterval(retry));
  undo.push(
    getModules(withProps('HTTP', 'getAPIBaseURL'), (value: any) => {
      if (typeof value?.HTTP?.post === 'function') http = value.HTTP;
    }),
  );
  undo.push(
    onFluxEventDispatched('SPOTIFY_ACCOUNT_ACCESS_TOKEN', (event: any) => {
      if (event.accountId && event.accessToken)
        credential = { accountId: event.accountId, accessToken: event.accessToken };
      Promise.resolve().then(() => {
        if (active && !state.playback) void refresh();
      });
      return event;
    }),
  );
  undo.push(
    onFluxEventDispatched('SPOTIFY_PLAYER_STATE', (event: any) => {
      try {
        onPlayerState(event);
      } catch {}
      return event;
    }),
  );
  undo.push(
    onFluxEventDispatched('SPOTIFY_SET_DEVICES', (event: any) => {
      const devices = Array.isArray(event?.devices) ? event.devices : [];
      const chosen = devices.find((d: any) => d?.is_active) ?? devices[0];
      device = chosen?.id ? { id: String(chosen.id), is_active: !!chosen.is_active } : null;
      return event;
    }),
  );
  for (const type of ['LOGOUT', 'SPOTIFY_ACCOUNT_ACCESS_TOKEN_REVOKED'])
    undo.push(
      onFluxEventDispatched(type, (event) => {
        generation++;
        readRevision++;
        refreshPromise = bootstrapPromise = null;
        cancelSettle();
        seeking = false;
        device = null;
        for (const controller of pending) controller.abort();
        pending.clear();
        credential = null;
        update({
          playback: null,
          connected: false,
          busy: false,
          status: 'Spotify disconnected. Tap Reconnect in settings.',
        });
        return event;
      }),
    );
  const app = AppState.addEventListener('change', (value) => {
    if (value === 'active') ensure();
  });
  undo.push(() => app.remove());
  return () => {
    active = false;
    generation++;
    cancelSettle();
    for (const fn of undo.reverse()) fn();
    for (const controller of pending) controller.abort();
    pending.clear();
    credential = null;
    device = null;
    seeking = false;
    spotify = accounts = actions = http = null;
    refreshPromise = bootstrapPromise = null;
    update({ playback: null, connected: false, busy: false, status: 'Spotify Controls is stopped.' });
  };
}
