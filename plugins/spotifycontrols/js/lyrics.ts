export const SPICY_LYRICS_URL = 'https://api.spicylyrics.org/v1/lyrics/';
export const LYRICS_TIME_OFFSET_MS = 120;
const LYRICS_BETWEEN_SHOW_S = 3;
export const LYRICS_DOT_PRE_HIDDEN_MS = 500;
const LYRICS_DOT_PADDING_MS = -550;
const LYRICS_LETTER_MIN_MS = 1000;
const LYRICS_LETTER_END_TRIM_MS = 250;
export const LYRICS_BLUR_MULTIPLIER = 1.25;
export const LYRICS_USER_SCROLL_COOLDOWN_MS = 750;
export const LYRICS_SCROLL_OFFSET_PX = 30;
export const LYRICS_LETTER_GLOW_OPACITY = 185;
const RTL_PATTERN = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-ﭏﭐ-﷿ﹰ-﻿]/;
const NEUTRAL_PATTERN = /[\d\s,.;:?!()[\]{}"'\\/<>@#$%^&*_=+-]/;
const ZERO_WIDTH_PATTERN = /[​-‍⁠﻿]/g;

export class LyricsSpring {
  d: number;
  f: number;
  g: number;
  p: number;
  v: number;
  constructor(position: number, frequency: number, damping: number) {
    this.d = damping;
    this.f = frequency;
    this.g = position;
    this.p = position;
    this.v = 0;
  }
  step(dt: number) {
    const d = this.d,
      f = this.f * 2 * Math.PI,
      g = this.g;
    let p = this.p,
      v = this.v;
    const o = p - g;
    if (d === 1) {
      const q = Math.exp(-f * dt),
        w = dt * q;
      p = o * (q + w * f) + v * w + g;
      v = v * (q - w * f) - o * (w * f * f);
    } else if (d < 1) {
      const q = Math.exp(-d * f * dt),
        c = Math.sqrt(1 - d * d);
      const i = Math.cos(dt * f * c),
        j = Math.sin(dt * f * c);
      const z = j / c,
        y = j / (f * c);
      p = (o * (i + z * d) + v * y) * q + g;
      v = (v * (i - z * d) - o * (z * f)) * q;
    } else {
      const c = Math.sqrt(d * d - 1),
        r1 = -f * (d + c),
        r2 = -f * (d - c);
      const co2 = (v - o * r1) / (2 * f * c),
        co1 = Math.exp(r1 * dt) * (o - co2),
        e2 = Math.exp(r2 * dt);
      p = co1 + co2 * e2 + g;
      v = co1 * r1 + co2 * e2 * r2;
    }
    this.p = p;
    this.v = v;
    return p;
  }
  canSleep() {
    if (this.v * this.v > 1e-4) return false;
    const offset = this.p - this.g;
    return offset * offset <= (1 / 3840) ** 2;
  }
  setGoal(goal: number, snap?: boolean) {
    this.g = goal;
    if (snap) {
      this.p = goal;
      this.v = 0;
    }
  }
}

export function createSpline(points: [number, number][]) {
  const n = points.length,
    x = points.map((p) => p[0]),
    a = points.map((p) => p[1]),
    h: number[] = [];
  for (let i = 0; i < n - 1; i++) h.push(x[i + 1] - x[i]);
  const l = new Array(n).fill(1),
    mu = new Array(n).fill(0),
    z = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const alpha = (3 / h[i]) * (a[i + 1] - a[i]) - (3 / h[i - 1]) * (a[i] - a[i - 1]);
    l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha - h[i - 1] * z[i - 1]) / l[i];
  }
  const b = new Array(n).fill(0),
    c = new Array(n).fill(0),
    d = new Array(n).fill(0);
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (a[j + 1] - a[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }
  return (value: number) => {
    let i = n - 2;
    for (let k = 0; k < n - 1; k++)
      if (value <= x[k + 1]) {
        i = k;
        break;
      }
    const dx = value - x[i];
    return a[i] + b[i] * dx + c[i] * dx * dx + d[i] * dx * dx * dx;
  };
}
export const splines = {
  scale: createSpline([
    [0, 0.95],
    [0.7, 1.0505],
    [1, 1],
  ]),
  y: createSpline([
    [0, 1 / 100],
    [0.9, -(1 / 60)],
    [1, 0],
  ]),
  glow: createSpline([
    [0, 0],
    [0.15, 1],
    [0.6, 1],
    [1, 0],
  ]),
  letterScale: createSpline([
    [0, 0.95],
    [0.7, 1.175],
    [1, 1],
  ]),
  letterY: createSpline([
    [0, 1 / 100],
    [0.9, -(1 / 56)],
    [1, 0],
  ]),
  dotScale: createSpline([
    [0, 0.75],
    [0.7, 1.05],
    [1, 1],
  ]),
  dotY: createSpline([
    [0, 0],
    [0.9, -0.12],
    [1, 0],
  ]),
  dotGlow: createSpline([
    [0, 0],
    [0.6, 1],
    [1, 1],
  ]),
  dotOpacity: createSpline([
    [0, 0.35],
    [0.6, 1],
    [1, 1],
  ]),
  wordScale: createSpline([
    [0, 0.95],
    [0.7, 1.025],
    [1, 1],
  ]),
  wordY: createSpline([
    [0, 1 / 100],
    [0.9, -(1 / 60)],
    [1, 0],
  ]),
};
export const WORD_SPRINGS = {
  scale: { frequency: 0.7, damping: 0.6 },
  y: { frequency: 1.25, damping: 0.4 },
  glow: { frequency: 1, damping: 0.5 },
} as const;
export const easeSinOut = (t: number) => Math.sin((clamp(t, 0, 1) * Math.PI) / 2);

export type LineState = 'NotSung' | 'Active' | 'Sung';
export const lyricsState = (position: number, start: number, end: number): LineState =>
  position < start ? 'NotSung' : position >= end ? 'Sung' : 'Active';
export const lyricsProgress = (position: number, start: number, end: number) =>
  position <= start ? 0 : position >= end ? 1 : (position - start) / (end - start);
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function isRtl(text: string) {
  for (let i = 0; i < (text || '').length; i++) {
    if (NEUTRAL_PATTERN.test(text[i])) continue;
    return RTL_PATTERN.test(text[i]);
  }
  return false;
}
const clean = (text: unknown) => (text == null ? '' : String(text).replace(ZERO_WIDTH_PATTERN, ''));
const hasSyllables = (group: any) =>
  !!group && Array.isArray(group.Syllables) && group.Syllables.some((s: any) => clean(s && s.Text).trim());

export type LyricsData =
  | { Type: 'Syllable' | 'Line'; Content: any[]; SongWriters?: string[] }
  | { Type: 'Static'; Lines: string[]; SongWriters?: string[] };
export function normalizeLyrics(data: any): LyricsData | null {
  if (!data) return null;
  const content = Array.isArray(data.Content) ? data.Content : [];
  if (content.length && (data.Type === 'Syllable' || content[0].Lead)) {
    const lines = content.filter((line: any) => line && hasSyllables(line.Lead));
    return lines.length ? { Type: 'Syllable', Content: lines, SongWriters: data.SongWriters } : null;
  }
  if (content.length) {
    const lines = content.filter((line: any) => line && clean(line.Text).trim());
    return lines.length ? { Type: 'Line', Content: lines, SongWriters: data.SongWriters } : null;
  }
  if (Array.isArray(data.Lines)) {
    const lines = data.Lines.map((line: any) => clean(line && (line.Text || line.text)).trim()).filter(
      Boolean,
    );
    return lines.length ? { Type: 'Static', Lines: lines, SongWriters: data.SongWriters } : null;
  }
  return null;
}

export type Unit = { id: number; text: string; start: number; end: number };
export type Word = Unit & {
  partOfWord: boolean;
  last: boolean;
  letters?: (Unit & { space: boolean })[];
  dot?: boolean;
};
export type Line = {
  id: number;
  kind: 'syllable' | 'line' | 'dots';
  start: number;
  end: number;
  words: Word[];
  text?: string;
  opposite: boolean;
  rtl: boolean;
  lead?: number;
};

let nextId = 1;
function prepareSyllables(syllables: any[], rtl: boolean) {
  const parts = syllables
    .map((s) => ({
      text: clean(s && s.Text),
      start: Number(s.StartTime) * 1000,
      end: Number(s.EndTime) * 1000,
      partOfWord: !!s.IsPartOfWord,
    }))
    .filter((part) => part.text.trim());
  if (!rtl) return parts;
  const joined: typeof parts = [];
  let open: (typeof parts)[number] | null = null;
  for (const part of parts) {
    if (open) {
      open.text += part.text;
      open.end = part.end;
    } else {
      open = { text: part.text, start: part.start, end: part.end, partOfWord: false };
      joined.push(open);
    }
    if (!part.partOfWord) open = null;
  }
  return joined;
}
export function repairTimings<T extends { start: number; end: number }>(
  parts: T[],
  lineStart: number,
  lineEnd: number,
): T[] {
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  const first = parts.find((p) => ok(p.start))?.start;
  const from = ok(lineStart) ? lineStart : (first ?? 0);
  const lastEnd = [...parts].reverse().find((p) => ok(p.end))?.end;
  const to = ok(lineEnd) && lineEnd > from ? lineEnd : Math.max(from, lastEnd ?? from);
  let previous = from;
  parts.forEach((part, i) => {
    let start = ok(part.start) ? part.start : previous;
    start = Math.min(Math.max(start, previous, from), to);
    const next = parts.slice(i + 1).find((p) => ok(p.start) && p.start >= start)?.start;
    let end = ok(part.end) && part.end > start ? part.end : (next ?? to);
    if (next !== undefined) end = Math.min(end, Math.max(start, next));
    end = Math.max(start, Math.min(end, to));
    part.start = start;
    part.end = end;
    previous = start;
  });
  return parts;
}
function syllableLine(group: any, opposite: boolean, lead?: number): Line {
  const rtl = group.Syllables.some((s: any) => isRtl(clean(s && s.Text)));
  const lineStart = (group.StartTime || 0) * 1000,
    lineEnd = (group.EndTime || 0) * 1000;
  const parts = repairTimings(prepareSyllables(group.Syllables, rtl), lineStart, lineEnd);
  const words: Word[] = parts.map((part, index) => {
    const word: Word = {
      id: nextId++,
      text: part.text,
      start: part.start,
      end: part.end,
      partOfWord: part.partOfWord && index < parts.length - 1,
      last: index === parts.length - 1,
    };
    if (
      part.end - part.start >= LYRICS_LETTER_MIN_MS &&
      Array.from(part.text).length <= 12 &&
      !isRtl(part.text)
    ) {
      const letters = Array.from(part.text),
        end = part.end - LYRICS_LETTER_END_TRIM_MS,
        duration = (end - part.start) / letters.length;
      word.end = end;
      word.letters = letters.map((letter, i) => ({
        id: nextId++,
        text: letter,
        start: part.start + i * duration,
        end: part.start + (i + 1) * duration,
        space: !letter.trim(),
      }));
    }
    return word;
  });
  const start = words.length ? Math.min(lineStart || words[0].start, words[0].start) : lineStart;
  const end = Math.max(lineEnd, words.length ? words[words.length - 1].end : 0);
  return { id: nextId++, kind: 'syllable', start, end, words, opposite, rtl, lead };
}
function musicalLine(start: number, end: number, opposite: boolean): Line {
  const total = end - start;
  const firstEnd = start + Math.max(0, total / 3 + LYRICS_DOT_PADDING_MS / 3);
  const secondEnd = Math.max(firstEnd, start + (total * 2) / 3 + (LYRICS_DOT_PADDING_MS * 2) / 3);
  const thirdEnd = Math.max(secondEnd, end + LYRICS_DOT_PADDING_MS);
  const bounds = [start, firstEnd, secondEnd, thirdEnd];
  const words: Word[] = [0, 1, 2].map((i) => ({
    id: nextId++,
    text: '•',
    start: bounds[i],
    end: bounds[i + 1],
    partOfWord: false,
    last: i === 2,
    dot: true,
  }));
  return { id: nextId++, kind: 'dots', start, end, words, opposite, rtl: false };
}
export function buildLines(data: LyricsData): Line[] {
  if (data.Type === 'Static') return [];
  const lines: Line[] = [];
  const content = data.Content;
  const startOf = (item: any) => (item.Lead ? item.Lead.StartTime : item.StartTime) || 0;
  const endOf = (item: any) => (item.Lead ? item.Lead.EndTime : item.EndTime) || 0;
  if (startOf(content[0]) >= LYRICS_BETWEEN_SHOW_S)
    lines.push(musicalLine(0, startOf(content[0]) * 1000, !!content[0].OppositeAligned));
  content.forEach((item: any, index: number) => {
    const opposite = !!item.OppositeAligned;
    if (data.Type === 'Syllable') {
      const lead = syllableLine(item.Lead, opposite);
      lines.push(lead);
      if (Array.isArray(item.Background))
        item.Background.filter(hasSyllables).forEach((background: any) =>
          lines.push(syllableLine(background, opposite, lead.id)),
        );
    } else {
      const text = clean(item.Text).trim();
      const next = content[index + 1];
      const end = endOf(item) || (next ? startOf(next) : startOf(item) + 5);
      lines.push({
        id: nextId++,
        kind: 'line',
        start: startOf(item) * 1000,
        end: end * 1000,
        words: [],
        text,
        opposite,
        rtl: isRtl(text),
      });
    }
    const next = content[index + 1];
    const last = lines.filter((line) => line.lead === undefined && line.kind !== 'dots').pop();
    const end = (last ? last.end : 0) / 1000;
    if (next && startOf(next) - end >= LYRICS_BETWEEN_SHOW_S)
      lines.push(musicalLine(end * 1000, startOf(next) * 1000, !!next.OppositeAligned));
  });
  return lines;
}

export type Contributor = { username: string; url?: string };
export type Credit = {
  source: 'spicy_lyrics' | 'apple_music' | 'spotify' | 'unknown';
  uploader?: Contributor;
  maker?: Contributor;
};
export type LyricsResult = { data: LyricsData; credit: Credit };
export class LyricsError extends Error {
  constructor(
    readonly code: 'no_key' | 'bad_key' | 'rate_limited' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'LyricsError';
  }
}
const contributor = (value: any): Contributor | undefined =>
  value && typeof value.username === 'string'
    ? { username: value.username, url: typeof value.url === 'string' ? value.url : undefined }
    : undefined;
export function creditOf(body: any): Credit {
  const source = ['spicy_lyrics', 'apple_music', 'spotify'].includes(body?.source) ? body.source : 'unknown';
  if (source !== 'spicy_lyrics') return { source };
  return {
    source,
    uploader: contributor(body?.UploadAttribution?.Uploader),
    maker: contributor(body?.UploadAttribution?.Maker),
  };
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function load(trackId: string, key: string): Promise<LyricsResult | null> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response, body: any;
    try {
      response = await fetch(SPICY_LYRICS_URL + encodeURIComponent(trackId), {
        headers: { Authorization: 'Bearer ' + key },
        signal: controller.signal,
      });
      body = await response.json().catch(() => null);
    } finally {
      clearTimeout(timeout);
    }
    const status = response.status;
    if (status === 200) {
      const data = normalizeLyrics(body?.Body);
      return data ? { data, credit: creditOf(body.Body) } : null;
    }
    if (status === 404) return null;
    if (status === 401 || status === 403)
      throw new LyricsError('bad_key', body?.Body?.message || 'Spicy Lyrics refused the key.');
    if (status === 429)
      throw new LyricsError('rate_limited', 'Spicy Lyrics rate limit reached. Try again in a moment.');
    if ((status === 502 || status === 503) && attempt < 2) {
      const after = Number(response.headers.get('Retry-After'));
      await wait(Math.min(10, Number.isFinite(after) && after > 0 ? after : 2 * (attempt + 1)) * 1000);
      continue;
    }
    throw new LyricsError(
      'unavailable',
      body?.Body?.message || 'Spicy Lyrics is unavailable right now (' + status + ').',
    );
  }
}

const cache = new Map<string, Promise<LyricsResult | null>>();
export function fetchLyrics(trackId: string, key: string): Promise<LyricsResult | null> {
  const trimmed = key.trim();
  if (!trimmed)
    return Promise.reject(new LyricsError('no_key', 'Add your Spicy Lyrics key in the plugin settings.'));
  const id = trackId + '\n' + trimmed;
  const known = cache.get(id);
  if (known) return known;
  const promise = load(trackId, trimmed);
  cache.set(id, promise);
  promise.catch(() => {
    if (cache.get(id) === promise) cache.delete(id);
  });
  return promise;
}
