export type Playback = {
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  duration: number;
  position: number;
  updatedAt: number;
  playing: boolean;
  shuffle: boolean;
  repeat: 'off' | 'track' | 'context';
  deviceId: string | null;
  deviceActive: boolean;
};
export type Command = 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'shuffle' | 'repeat';
export const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(n) ? n : 0));
export function positionAt(
  state: Pick<Playback, 'position' | 'updatedAt' | 'playing' | 'duration'>,
  now = Date.now(),
) {
  return clamp(state.position + (state.playing ? Math.max(0, now - state.updatedAt) : 0), state.duration);
}
export function normalizePlayback(raw: any, now = Date.now()): Playback | null {
  const track = raw?.item ?? raw?.track;
  if (!track?.id) return null;
  const repeat =
    raw.repeat_state ?? raw.actual_repeat ?? (typeof raw.repeat === 'string' ? raw.repeat : 'off');
  const duration = Math.max(0, Number(track.duration_ms ?? track.duration) || 0);
  return {
    id: String(track.id),
    title: String(track.name || 'Unknown track'),
    artist:
      (track.artists || [])
        .map((a: any) => a.name)
        .filter(Boolean)
        .join(', ') || 'Unknown artist',
    artwork: track.album?.images?.[0]?.url ?? track.album?.image?.url ?? null,
    duration,
    position: clamp(Number(raw.progress_ms ?? raw.position) || 0, duration),
    updatedAt: now,
    playing: !!(raw.is_playing ?? raw.isPlaying),
    shuffle: !!(raw.shuffle_state ?? raw.shuffle),
    repeat: ['off', 'track', 'context'].includes(repeat) ? repeat : 'off',
    deviceId: raw.device?.id ?? null,
    deviceActive: !!raw.device?.is_active,
  };
}
export type SpotifyRequest = {
  method: 'put' | 'post';
  route: string;
  query: Record<string, string | number | boolean>;
};
export function commandRequest(action: Command, state: Partial<Playback>, value?: number): SpotifyRequest {
  if (action === 'next' || action === 'previous') return { method: 'post', route: '/' + action, query: {} };
  if (action === 'play' || action === 'pause') return { method: 'put', route: '/' + action, query: {} };
  if (action === 'seek')
    return {
      method: 'put',
      route: '/seek',
      query: { position_ms: Math.round(clamp(value ?? 0, state.duration ?? 0)) },
    };
  if (action === 'shuffle') return { method: 'put', route: '/shuffle', query: { state: !state.shuffle } };
  if (action === 'repeat')
    return { method: 'put', route: '/repeat', query: { state: nextRepeat(state.repeat) } };
  throw new Error('Unknown playback action');
}
export const nextRepeat = (repeat: Playback['repeat'] = 'off') =>
  (({ off: 'context', context: 'track', track: 'off' }) as const)[repeat];
export function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
