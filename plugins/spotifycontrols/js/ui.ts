export type DockMode = 'closed' | 'collapsed' | 'expanded';
export type LyricsPrefs = {
  highAnimations: boolean;
  glow: boolean;
  animatedBackground: boolean;
  textScale: number;
  fadeDistant: boolean;
  backgroundVocals: boolean;
  backgroundDim: number;
  showInfo: boolean;
  showControls: boolean;
  tapToSeek: boolean;
};
export const DEFAULT_LYRICS: LyricsPrefs = {
  highAnimations: true,
  glow: true,
  animatedBackground: true,
  textScale: 1,
  fadeDistant: true,
  backgroundVocals: true,
  backgroundDim: 0.32,
  showInfo: true,
  showControls: true,
  tapToSeek: true,
};
export type ProgressStyle = 'bar' | 'wave';
const PROGRESS_STYLES: ProgressStyle[] = ['bar', 'wave'];
export type Preferences = {
  mode: DockMode;
  lyricsKey: string;
  lyrics: LyricsPrefs;
  progressStyle: ProgressStyle;
};
export const DEFAULT_PREFERENCES: Preferences = {
  mode: 'collapsed',
  lyricsKey: '',
  lyrics: DEFAULT_LYRICS,
  progressStyle: 'bar',
};
const MODES: DockMode[] = ['closed', 'collapsed', 'expanded'];
const listeners = new Set<() => void>();
let mode: DockMode = DEFAULT_PREFERENCES.mode;
let persist: ((change: Partial<Preferences>) => void) | null = null;
let lyricsKey = '';
let lyrics: LyricsPrefs = { ...DEFAULT_LYRICS };
let progressStyle: ProgressStyle = 'bar';

export const getMode = () => mode;
export const getLyricsKey = () => lyricsKey;
export const getLyricsPrefs = () => lyrics;
export const getProgressStyle = () => progressStyle;
export function setProgressStyle(value: ProgressStyle) {
  if (value === progressStyle || !PROGRESS_STYLES.includes(value)) return;
  progressStyle = value;
  for (const fn of listeners) fn();
  try {
    persist?.({ progressStyle: value });
  } catch {}
}
export function setLyricsPref<K extends keyof LyricsPrefs>(key: K, value: LyricsPrefs[K]) {
  if (lyrics[key] === value) return;
  lyrics = { ...lyrics, [key]: value };
  for (const fn of listeners) fn();
  try {
    persist?.({ lyrics });
  } catch {}
}
export function resetLyricsPrefs() {
  lyrics = { ...DEFAULT_LYRICS };
  for (const fn of listeners) fn();
  try {
    persist?.({ lyrics });
  } catch {}
}
export function setLyricsKey(value: string) {
  if (value === lyricsKey) return;
  lyricsKey = value;
  for (const fn of listeners) fn();
  try {
    persist?.({ lyricsKey: value });
  } catch {}
}
export const subscribeUi = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function apply(next: DockMode) {
  if (next === mode || !MODES.includes(next)) return;
  mode = next;
  for (const fn of listeners) fn();
}
export function setMode(next: DockMode) {
  apply(next);
  try {
    persist?.({ mode: next });
  } catch {}
}
export const stepMode = (direction: 1 | -1) =>
  setMode(MODES[Math.max(0, Math.min(MODES.length - 1, MODES.indexOf(mode) + direction))]);
type StoredPreferences = Partial<Preferences> & { collapsed?: boolean };
function readStored(initial: StoredPreferences | undefined) {
  if (typeof initial?.lyricsKey === 'string') lyricsKey = initial.lyricsKey;
  if (initial?.progressStyle && PROGRESS_STYLES.includes(initial.progressStyle))
    progressStyle = initial.progressStyle;
  if (initial?.lyrics && typeof initial.lyrics === 'object') {
    const next: any = { ...DEFAULT_LYRICS };
    for (const key of Object.keys(DEFAULT_LYRICS) as (keyof LyricsPrefs)[]) {
      const value = (initial.lyrics as any)[key];
      if (
        typeof value === typeof DEFAULT_LYRICS[key] &&
        (typeof value !== 'number' || Number.isFinite(value))
      )
        next[key] = value;
    }
    lyrics = next;
  }
  const stored =
    initial?.mode ??
    (typeof initial?.collapsed === 'boolean' ? (initial.collapsed ? 'collapsed' : 'expanded') : undefined);
  if (stored) apply(stored);
}
export function loadStoredPreferences(initial: StoredPreferences | undefined) {
  readStored(initial);
  for (const fn of listeners) fn();
}
export function bindUi(initial: StoredPreferences | undefined, save: (change: Partial<Preferences>) => void) {
  readStored(initial);
  persist = save;
  return () => {
    if (persist === save) persist = null;
  };
}
