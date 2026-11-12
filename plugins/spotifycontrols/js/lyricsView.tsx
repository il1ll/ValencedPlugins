import React, { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  Easing,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { command, getState, subscribe } from './spotify';
import { getLyricsKey, getLyricsPrefs, subscribeUi, type LyricsPrefs } from './ui';
import { formatTime, positionAt, type Playback } from './playback';
import { ControlButton, Icon } from './icons';
import {
  buildLines,
  clamp,
  easeSinOut,
  fetchLyrics,
  isRtl,
  LyricsError,
  LyricsSpring,
  lyricsProgress,
  lyricsState,
  splines,
  WORD_SPRINGS,
  LYRICS_BLUR_MULTIPLIER,
  LYRICS_DOT_PRE_HIDDEN_MS,
  LYRICS_SCROLL_OFFSET_PX,
  LYRICS_TIME_OFFSET_MS,
  LYRICS_USER_SCROLL_COOLDOWN_MS,
  type Credit,
  type Line,
  type LineState,
  type LyricsData,
  type LyricsResult,
  type Unit,
  type Word,
} from './lyrics';

const MotionView = Animated.View;
const FONT = 'ggsans-Bold';
const WHITE = (alpha: number) => 'rgba(255,255,255,' + alpha + ')';

const listeners = new Set<() => void>();
let open = false;
const setOpen = (value: boolean) => {
  if (open === value) return;
  open = value;
  for (const fn of [...listeners]) fn();
};
export const openLyrics = () => setOpen(true);
export const closeLyrics = () => setOpen(false);
const useOpen = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => open,
  );

type Phase = 'NotSung' | 'Active' | 'Sung';
type UnitAnim = {
  scale: Animated.Value;
  y: Animated.Value;
  fill: Animated.Value;
  opacity: Animated.Value;
  glow: Animated.Value;
  phase?: Phase;
  running: Animated.CompositeAnimation[];
  lit?: number;
  motion?: {
    scale: LyricsSpring;
    y: LyricsSpring;
    glow: LyricsSpring;
    lastScale: number;
    lastY: number;
    lastGlow: number;
  };
  watchers: Set<() => void>;
};
function setPhase(u: UnitAnim, phase: Phase) {
  if (u.phase === phase) return;
  u.phase = phase;
  for (const fn of [...u.watchers]) fn();
}
const NATIVE = { useNativeDriver: true, isInteraction: false } as const;
const easeOut = Easing.out(Easing.cubic);
class Controller {
  units = new Map<number, UnitAnim>();
  layout = new Map<number, { y: number; height: number }>();
  unit(id: number, kind: 'word' | 'letter' | 'dot') {
    let unit = this.units.get(id);
    if (!unit) {
      unit = {
        scale: new Animated.Value(kind === 'dot' ? 0.75 : 1),
        y: new Animated.Value(0),
        fill: new Animated.Value(0),
        opacity: new Animated.Value(kind === 'dot' ? 0.35 : 1),
        glow: new Animated.Value(0),
        running: [],
        watchers: new Set(),
      };
      this.units.set(id, unit);
    }
    return unit;
  }
  stop(u: UnitAnim) {
    for (const a of u.running) a.stop();
    u.running = [];
  }
  stopAll() {
    for (const u of this.units.values()) this.stop(u);
  }
}
const run = (u: UnitAnim, animation: Animated.CompositeAnimation) => {
  u.running.push(animation);
  animation.start();
};

function syncUnit(u: UnitAnim, unit: Unit, position: number, force: boolean) {
  const phase = lyricsState(position, unit.start, unit.end);
  if (phase === u.phase && !force) return;
  setPhase(u, phase);
  const fill =
    phase === 'NotSung' ? 0 : phase === 'Sung' ? 1 : lyricsProgress(position, unit.start, unit.end);
  u.lit = fill;
  u.fill.setValue(fill);
  if (force && u.motion) {
    u.motion.scale.setGoal(u.motion.scale.g, true);
    u.motion.y.setGoal(u.motion.y.g, true);
  }
}
function lightLine(
  c: Controller,
  line: Line,
  position: number,
  dt: number,
  size: number,
  high: boolean,
  snap: boolean,
  glowOn: boolean,
) {
  if (line.kind !== 'syllable') return;
  const move = (u: UnitAnim, t: number, lift: number, glowT = t, fixedScale = false) => {
    const goalScale = high && !fixedScale ? splines.wordScale(t) : 1,
      goalY = high ? splines.wordY(t) * size * lift : 0;
    const goalGlow = glowOn ? splines.glow(glowT) : 0;
    const m = (u.motion ??= {
      scale: new LyricsSpring(goalScale, WORD_SPRINGS.scale.frequency, WORD_SPRINGS.scale.damping),
      y: new LyricsSpring(goalY, WORD_SPRINGS.y.frequency, WORD_SPRINGS.y.damping),
      glow: new LyricsSpring(goalGlow, WORD_SPRINGS.glow.frequency, WORD_SPRINGS.glow.damping),
      lastScale: NaN,
      lastY: NaN,
      lastGlow: NaN,
    });
    m.scale.setGoal(goalScale, snap);
    m.y.setGoal(goalY, snap);
    m.glow.setGoal(goalGlow, snap);
    const scale = m.scale.step(dt),
      y = m.y.step(dt),
      glow = clamp(m.glow.step(dt), 0, 1);
    if (Math.abs(glow - m.lastGlow) > 0.01 || !(m.lastGlow === m.lastGlow)) {
      m.lastGlow = glow;
      u.glow.setValue(glow);
    }
    if (Math.abs(scale - m.lastScale) > 0.0004 || !(m.lastScale === m.lastScale)) {
      m.lastScale = scale;
      u.scale.setValue(scale);
    }
    if (Math.abs(y - m.lastY) > 0.05 || !(m.lastY === m.lastY)) {
      m.lastY = y;
      u.y.setValue(y);
    }
  };
  const bg = line.lead !== undefined ? 0.75 : 1;
  const parted = new Set<number>();
  for (const group of groupsOf(line)) {
    if (group.length < 2) continue;
    for (const word of group) parted.add(word.id);
    move(
      c.unit(-group[0].id, 'word'),
      clamp(lyricsProgress(position, group[0].start, group[group.length - 1].end), 0, 1),
      0,
    );
  }
  for (const word of line.words) {
    const u = c.units.get(word.id);
    if (!u) continue;
    const t = clamp(lyricsProgress(position, word.start, word.end), 0, 1);
    if (t !== u.lit) {
      u.lit = t;
      u.fill.setValue(t);
    }
    move(u, t, bg, t, parted.has(word.id));
    if (high && word.letters) {
      const eased = easeSinOut(t),
        n = word.letters.length;
      word.letters.forEach((letter, i) => {
        const lu = c.units.get(letter.id);
        if (lu)
          move(lu, clamp((eased - i / n) * n, 0, 1), bg * 2, clamp((eased - i / n) / (1 - i / n), 0, 1));
      });
    }
  }
}
function syncDot(
  u: UnitAnim,
  unit: Unit,
  position: number,
  playing: boolean,
  size: number,
  force: boolean,
  high: boolean,
) {
  const phase = lyricsState(position, unit.start, unit.end);
  if (phase === u.phase && !force) return;
  setPhase(u, phase);
  for (const a of u.running) a.stop();
  u.running = [];
  const progress = lyricsProgress(position, unit.start, unit.end);
  const at = phase === 'NotSung' ? 0 : phase === 'Sung' ? 1 : progress;
  u.opacity.setValue(splines.dotOpacity(at));
  u.scale.setValue(splines.dotScale(at));
  u.y.setValue(0);
  if (phase !== 'Active' || !playing) return;
  const remaining = Math.max(60, unit.end - position);
  run(u, Animated.timing(u.opacity, { ...NATIVE, toValue: 1, duration: remaining * 0.6, easing: easeOut }));
  if (!high) {
    run(u, Animated.timing(u.scale, { ...NATIVE, toValue: 1, duration: remaining, easing: easeOut }));
    return;
  }
  run(
    u,
    Animated.sequence([
      Animated.timing(u.scale, { ...NATIVE, toValue: 1.05, duration: remaining * 0.7, easing: easeOut }),
      Animated.timing(u.scale, {
        ...NATIVE,
        toValue: 1,
        duration: remaining * 0.3,
        easing: Easing.inOut(Easing.quad),
      }),
    ]),
  );
  run(
    u,
    Animated.sequence([
      Animated.timing(u.y, { ...NATIVE, toValue: -0.12 * size, duration: remaining * 0.9, easing: easeOut }),
      Animated.timing(u.y, {
        ...NATIVE,
        toValue: 0,
        duration: remaining * 0.1,
        easing: Easing.in(Easing.quad),
      }),
    ]),
  );
}
function syncLine(
  c: Controller,
  line: Line,
  position: number,
  playing: boolean,
  size: number,
  force: boolean,
  high: boolean,
) {
  if (line.kind === 'line') {
    const u = c.unit(line.id, 'word');
    const phase = lyricsState(position, line.start, line.end);
    if (phase === u.phase && !force) return;
    setPhase(u, phase);
    c.stop(u);
    run(
      u,
      Animated.timing(u.fill, {
        ...NATIVE,
        toValue: phase === 'Active' ? 1 : 0,
        duration: 260,
        easing: easeOut,
      }),
    );
    return;
  }
  for (const word of line.words) {
    if (word.dot) {
      syncDot(c.unit(word.id, 'dot'), word, position, playing, size, force, high);
      continue;
    }
    syncUnit(c.unit(word.id, 'word'), word, position, force);
    if (high && word.letters)
      for (const letter of word.letters) syncUnit(c.unit(letter.id, 'letter'), letter, position, force);
  }
}
type TextLook = { size: number; weight: '600' | '700'; sung: number; unsung: number };
function UnitText({
  unit,
  text,
  letters,
  look,
  active,
  state,
  blur,
  rtl,
  whole,
  glow,
}: {
  unit: UnitAnim;
  text: string;
  letters?: { text: string; unit: UnitAnim }[];
  look: TextLook;
  active: boolean;
  state: LineState;
  blur: number;
  rtl?: boolean;
  whole?: boolean;
  soft?: boolean;
  glow?: boolean;
}) {
  const [w, setW] = useState(0);
  const phase = useSyncExternalStore(
    React.useCallback(
      (fn: () => void) => {
        unit.watchers.add(fn);
        return () => {
          unit.watchers.delete(fn);
        };
      },
      [unit],
    ),
    () => unit.phase,
  );
  const base = {
    fontFamily: FONT,
    fontWeight: look.weight,
    fontSize: look.size,
    lineHeight: look.size * 1.1818,
    includeFontPadding: false,
    textShadowRadius: 0,
    writingDirection: rtl ? 'rtl' : 'ltr',
  } as const;
  const recede = 1 - Math.min(0.45, blur / 16);
  const color = WHITE((state === 'Sung' ? look.sung : look.unsung) * recede);
  const sweeping = active && !whole && phase === 'Active';
  const content = (
    textColor: string,
    shade?: (u: UnitAnim) => number | Animated.AnimatedInterpolation<number>,
  ) =>
    letters ? (
      <View style={{ flexDirection: 'row' }}>
        {letters.map((letter, i) => (
          <MotionView
            key={i}
            style={{
              transform: [{ translateY: letter.unit.y }, { scale: letter.unit.scale }],
              opacity: shade ? shade(letter.unit) : 1,
            }}
          >
            <Text style={[base, { color: textColor }]}>{letter.text}</Text>
          </MotionView>
        ))}
      </View>
    ) : shade ? (
      <MotionView style={{ opacity: shade(unit) }}>
        <Text style={[base, { color: textColor }]}>{text}</Text>
      </MotionView>
    ) : (
      <Text style={[base, { color: textColor }]}>{text}</Text>
    );
  const glowing = !!glow && sweeping;
  const shade = (u: UnitAnim) =>
    glowing
      ? u.glow.interpolate({ inputRange: [0, 1], outputRange: [look.sung, 1], extrapolate: 'clamp' })
      : look.sung;
  const reveal = useMemo(
    () =>
      !sweeping || w <= 0
        ? null
        : unit.fill.interpolate({ inputRange: [0, 1], outputRange: [0, w], extrapolate: 'clamp' }),
    [sweeping, w, unit],
  );
  return (
    <View
      onLayout={
        active && !whole
          ? (e) => {
              const width = e.nativeEvent.layout.width;
              setW((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
            }
          : undefined
      }
    >
      {content(active ? WHITE(look.unsung) : color)}
      {active && whole && (
        <MotionView
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: unit.fill }}
        >
          <Text style={[base, { color: WHITE(1) }]}>{text}</Text>
        </MotionView>
      )}
      {active && !whole && phase === 'Sung' && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
          {content(WHITE(look.sung))}
        </View>
      )}
      {reveal && (
        <MotionView
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -8,
            bottom: -8,
            width: reveal,
            overflow: 'hidden',
            ...(rtl ? { right: 0 } : { left: 0 }),
          }}
        >
          <View style={{ position: 'absolute', top: 8, width: w, ...(rtl ? { right: 0 } : { left: 0 }) }}>
            {content(WHITE(1), shade)}
          </View>
        </MotionView>
      )}
    </View>
  );
}
function StillWord({
  text,
  look,
  color,
  resting,
  scaled,
}: {
  text: string;
  look: TextLook;
  color: string;
  resting: boolean;
  scaled: boolean;
}) {
  const transform = resting
    ? scaled
      ? [{ translateY: splines.wordY(0) * look.size }, { scale: splines.wordScale(0) }]
      : [{ translateY: splines.wordY(0) * look.size }]
    : null;
  return (
    <View style={transform ? { transform } : null}>
      <Text
        style={{
          fontFamily: FONT,
          fontWeight: look.weight,
          fontSize: look.size,
          lineHeight: look.size * 1.1818,
          includeFontPadding: false,
          color,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
const groupCache = new WeakMap<Line, Word[][]>();
function groupsOf(line: Line) {
  let groups = groupCache.get(line);
  if (!groups) {
    groups = wordGroups(line.words);
    groupCache.set(line, groups);
  }
  return groups;
}
function wordGroups(words: Word[]) {
  const groups: Word[][] = [];
  let open: Word[] | null = null;
  for (const word of words) {
    if (!open) {
      open = [];
      groups.push(open);
    }
    open.push(word);
    if (!word.partOfWord) open = null;
  }
  return groups;
}
const SyllableLine = memo(function SyllableLine({
  line,
  c,
  state,
  blur,
  look,
  high,
  glow,
}: {
  line: Line;
  c: Controller;
  state: LineState;
  blur: number;
  look: TextLook;
  high: boolean;
  glow: boolean;
}) {
  const active = state === 'Active';
  const space = look.size * 0.26;
  const groups = useMemo(() => wordGroups(line.words), [line]);
  const row = {
    flexDirection: line.rtl ? 'row-reverse' : 'row',
    flexWrap: 'wrap',
    justifyContent: line.opposite !== line.rtl ? 'flex-end' : 'flex-start',
    paddingRight: line.rtl ? 0 : '5%',
  } as const;
  const groupStyle = (group: Word[]) => {
    const gap = group[group.length - 1].last ? 0 : space;
    return {
      flexDirection: line.rtl ? 'row-reverse' : 'row',
      flexWrap: 'nowrap',
      marginRight: line.rtl ? 0 : gap,
      marginLeft: line.rtl ? gap : 0,
    } as const;
  };
  if (!active) {
    const recede = 1 - Math.min(0.45, blur / 16),
      color = WHITE((state === 'Sung' ? look.sung : look.unsung) * recede);
    const resting = high && state === 'NotSung';
    return (
      <View style={row}>
        {groups.map((group) => {
          const parted = group.length > 1;
          return (
            <View
              key={group[0].id}
              style={[
                groupStyle(group),
                resting && parted ? { transform: [{ scale: splines.wordScale(0) }] } : null,
              ]}
            >
              {group.map((word) => (
                <StillWord
                  key={word.id}
                  text={word.text}
                  look={look}
                  color={color}
                  resting={resting}
                  scaled={!parted}
                />
              ))}
            </View>
          );
        })}
      </View>
    );
  }
  return (
    <View style={row}>
      {groups.map((group) => {
        const parted = group.length > 1,
          gu = parted ? c.unit(-group[0].id, 'word') : null;
        return (
          <MotionView
            key={group[0].id}
            style={[groupStyle(group), gu ? { transform: [{ scale: gu.scale }] } : null]}
          >
            {group.map((word, i) => {
              const u = c.unit(word.id, 'word');
              const letters =
                high && word.letters
                  ? word.letters.map((letter) => ({
                      text: letter.space ? '\u00A0' : letter.text,
                      unit: c.unit(letter.id, 'letter'),
                    }))
                  : undefined;
              return (
                <MotionView
                  key={word.id}
                  style={{
                    transform: parted ? [{ translateY: u.y }] : [{ translateY: u.y }, { scale: u.scale }],
                  }}
                >
                  <UnitText
                    unit={u}
                    text={word.text}
                    letters={letters}
                    look={look}
                    active
                    state={state}
                    blur={blur}
                    rtl={line.rtl}
                    soft={high}
                    glow={glow}
                  />
                </MotionView>
              );
            })}
          </MotionView>
        );
      })}
    </View>
  );
});
const WholeLine = memo(function WholeLine({
  line,
  c,
  state,
  blur,
  look,
}: {
  line: Line;
  c: Controller;
  state: LineState;
  blur: number;
  look: TextLook;
}) {
  const right = line.opposite !== line.rtl,
    active = state === 'Active';
  const scale = useRef(new Animated.Value(active ? 1.05 : 1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const animation = Animated.timing(scale, {
      toValue: active ? 1.05 : 1,
      duration: 100,
      easing: Easing.bezier(0.37, 0, 0.63, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, scale]);
  const frame = {
    alignSelf: right ? 'flex-end' : 'flex-start',
    paddingRight: line.rtl ? 0 : '5%',
    transform: [{ scale }],
    transformOrigin: right ? 'right center' : 'left center',
  } as any;
  if (!active) {
    const recede = 1 - Math.min(0.45, blur / 16),
      color = WHITE((state === 'Sung' ? look.sung : look.unsung) * recede);
    return (
      <MotionView style={frame}>
        <Text
          style={{
            fontFamily: FONT,
            fontWeight: look.weight,
            fontSize: look.size,
            lineHeight: look.size * 1.1818,
            includeFontPadding: false,
            color,
            writingDirection: line.rtl ? 'rtl' : 'ltr',
          }}
        >
          {line.text}
        </Text>
      </MotionView>
    );
  }
  return (
    <MotionView style={frame}>
      <UnitText
        unit={c.unit(line.id, 'word')}
        text={line.text ?? ''}
        look={look}
        active
        state={state}
        blur={blur}
        rtl={line.rtl}
        whole
      />
    </MotionView>
  );
});

const DotsLine = memo(function DotsLine({
  line,
  c,
  active,
  hidden,
  size,
}: {
  line: Line;
  c: Controller;
  active: boolean;
  hidden: boolean;
  size: number;
}) {
  const height = useRef(new Animated.Value(0)).current,
    group = useRef(new Animated.Value(0)).current;
  const full = size * 1.1818;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!active) return;
    }
    const animations = [
      Animated.timing(height, { toValue: active ? full : 0, duration: 140, useNativeDriver: false }),
      Animated.timing(
        group,
        active && !hidden
          ? { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }
          : { toValue: 0, duration: 400, easing: Easing.in(Easing.back(1.6)), useNativeDriver: false },
      ),
    ];
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [active, hidden, full, height, group]);
  return (
    <MotionView
      style={{
        height,
        opacity: height.interpolate({ inputRange: [0, full], outputRange: [0, 1] }),
        justifyContent: 'center',
        alignItems: line.opposite ? 'flex-end' : 'flex-start',
      }}
    >
      <MotionView style={{ flexDirection: 'row', gap: size * 0.12, transform: [{ scale: group }] }}>
        {line.words.map((word) => {
          const u = c.unit(word.id, 'dot');
          return (
            <MotionView
              key={word.id}
              style={{ opacity: u.opacity, transform: [{ translateY: u.y }, { scale: u.scale }] }}
            >
              <Text
                style={{
                  fontFamily: FONT,
                  fontWeight: '700',
                  fontSize: size * 1.3,
                  lineHeight: size * 1.3 * 0.9,
                  color: WHITE(0.85),
                  includeFontPadding: false,
                }}
              >
                {'•'}
              </Text>
            </MotionView>
          );
        })}
      </MotionView>
    </MotionView>
  );
});
function BackgroundLine({
  shown,
  size,
  children,
}: {
  shown: boolean;
  size: number;
  children: React.ReactNode;
}) {
  const [natural, setNatural] = useState(0);
  const progress = useRef(new Animated.Value(shown ? 1 : 0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: shown ? 1 : 0,
      duration: shown ? 500 : 300,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [shown, progress]);
  return (
    <MotionView
      style={{
        height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, natural] }),
        opacity: progress,
        overflow: 'visible',
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-0.6 * size, 0] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
        ],
      }}
    >
      <View
        style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        onLayout={(e) => setNatural(e.nativeEvent.layout.height)}
      >
        {children}
      </View>
    </MotionView>
  );
}
const LINE_OPACITY: Record<LineState, number> = { NotSung: 0.51, Active: 1, Sung: 0.497 };
const BACKGROUND_OPACITY: Record<LineState, number> = {
  NotSung: 0.51 * 0.53921568627,
  Active: 0.8,
  Sung: 0.497 * 0.6690140845,
};
function LineFade({
  state,
  children,
  background,
}: {
  state: LineState;
  children: React.ReactNode;
  background?: boolean;
}) {
  const levels = background ? BACKGROUND_OPACITY : LINE_OPACITY;
  const opacity = useRef(new Animated.Value(levels[state])).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const animation = Animated.timing(opacity, {
      toValue: levels[state],
      duration: 250,
      easing: Easing.bezier(0.61, 1, 0.88, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [state, opacity, levels]);
  return <MotionView style={{ opacity }}>{children}</MotionView>;
}

function CreditLine({ credit, writers, width }: { credit: Credit; writers?: string[]; width: number }) {
  const size = clamp(width * 0.037, 13, 16);
  const style = {
    fontFamily: FONT,
    fontWeight: '600' as const,
    fontSize: size,
    lineHeight: size * 1.4,
    color: WHITE(0.6),
  };
  const link = (person: { username: string; url?: string }) =>
    person.url ? (
      <Text
        style={{ textDecorationLine: 'underline' }}
        onPress={() => {
          void Linking.openURL(person.url!).catch(() => {});
        }}
      >
        {person.username}
      </Text>
    ) : (
      <Text>{person.username}</Text>
    );
  const provider =
    credit.source === 'apple_music'
      ? 'Apple Music via Spicy Lyrics'
      : credit.source === 'spotify'
        ? 'Spotify via Spicy Lyrics'
        : 'Spicy Lyrics';
  return (
    <View style={{ marginTop: Math.max(width * 0.01, 8), gap: 4 }}>
      {!!writers?.length && <Text style={style}>Written by: {writers.join(', ')}</Text>}
      <Text style={style}>
        Lyrics from {provider}
        {credit.uploader && (
          <>
            {' \u00B7 uploaded by '}
            {link(credit.uploader)}
          </>
        )}
        {credit.maker && (
          <>
            {credit.uploader ? ', made by ' : ' \u00B7 made by '}
            {link(credit.maker)}
          </>
        )}
      </Text>
    </View>
  );
}
type Frame = { states: Record<number, LineState>; hidden: Record<number, boolean>; blurIndex: number };
function SyncedLyrics({
  data,
  credit,
  track,
  width,
  prefs,
}: {
  data: LyricsData;
  credit: Credit;
  track: Playback;
  width: number;
  prefs: LyricsPrefs;
}) {
  const c = useMemo(() => new Controller(), [data]);
  const lines = useMemo(() => buildLines(data), [data]);
  const scroll = useRef<ScrollView>(null);
  const [viewHeight, setViewHeight] = useState(0);
  const [hideBlur, setHideBlur] = useState(false);
  const [frame, setFrame] = useState<Frame>(() => ({
    states: Object.fromEntries(lines.map((l) => [l.id, 'NotSung' as LineState])),
    hidden: {},
    blurIndex: -1,
  }));
  const size = clamp(width * 0.07, 20, 56) * prefs.textScale;
  const high = prefs.highAnimations;
  const glowRef = useRef(prefs.glow);
  glowRef.current = prefs.glow;
  const trackRef = useRef(track);
  trackRef.current = track;
  const user = useRef({ scrolling: false, dragging: false, at: 0, index: -3 });

  useEffect(() => {
    setFrame({
      states: Object.fromEntries(lines.map((l) => [l.id, 'NotSung' as LineState])),
      hidden: {},
      blurIndex: -1,
    });
    user.current = { scrolling: false, dragging: false, at: 0, index: -3 };
    let raf = 0,
      live = true,
      lastPosition = -1,
      lastAt = 0,
      lastPlaying: boolean | null = null;
    const states: Record<number, LineState> = {},
      hidden: Record<number, boolean> = {};
    let blurIndex = -1;
    const byId = new Map(lines.map((l) => [l.id, l]));
    let lastFrame = Date.now();
    const loop = () => {
      if (!live) return;
      const now = Date.now(),
        track = trackRef.current;
      const dt = clamp((now - lastFrame) / 1000, 0, 0.1);
      lastFrame = now;
      const position = positionAt(track) + LYRICS_TIME_OFFSET_MS;
      const expected = lastPosition + (lastPlaying ? now - lastAt : 0);
      const force = lastPlaying !== track.playing || Math.abs(position - expected) > 300;
      lastPosition = position;
      lastAt = now;
      lastPlaying = track.playing;
      let changed = false,
        firstActive = -1,
        scrollIndex = -1;
      lines.forEach((line, index) => {
        const state = lyricsState(position, line.start, line.end);
        const before = states[line.id],
          moved = state !== before;
        if (moved) {
          states[line.id] = state;
          changed = true;
        }
        if (state === 'Active') {
          if (firstActive === -1) firstActive = index;
          if (scrollIndex === -1)
            scrollIndex = line.lead !== undefined ? lines.indexOf(byId.get(line.lead)!) : index;
        }
        if (line.kind === 'dots') {
          const pre = state === 'Active' && position > line.end - LYRICS_DOT_PRE_HIDDEN_MS;
          if (pre !== !!hidden[line.id]) {
            hidden[line.id] = pre;
            changed = true;
          }
        }
        const previous = moved ? before : state;
        if (state === 'Active' || (moved && previous === 'Active'))
          syncLine(c, line, position, track.playing, size, force, high);
        if (state === 'Active') lightLine(c, line, position, dt, size, high, force || moved, glowRef.current);
      });
      if (firstActive !== -1 && firstActive !== blurIndex) {
        blurIndex = firstActive;
        changed = true;
      }
      if (changed) setFrame({ states: { ...states }, hidden: { ...hidden }, blurIndex });
      const u = user.current;
      if (u.scrolling && !u.dragging && now - u.at > LYRICS_USER_SCROLL_COOLDOWN_MS) {
        u.scrolling = false;
        u.index = -2;
        setHideBlur(false);
      }
      if (!u.scrolling && scrollIndex !== -1 && scrollIndex !== u.index) {
        const target = c.layout.get(lines[scrollIndex].id);
        if (target && viewHeightRef.current > 0) {
          const instant = u.index === -3;
          u.index = scrollIndex;
          scroll.current?.scrollTo({
            y: Math.max(
              0,
              target.y - (viewHeightRef.current / 2 - target.height / 2) + LYRICS_SCROLL_OFFSET_PX,
            ),
            animated: !instant,
          });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      c.stopAll();
      for (const u of c.units.values()) u.phase = undefined;
    };
  }, [lines, c, size, high]);
  const viewHeightRef = useRef(0);
  viewHeightRef.current = viewHeight;

  const maxBlur = LYRICS_BLUR_MULTIPLIER * 5 + LYRICS_BLUR_MULTIPLIER * 0.465;
  const blurFor = (index: number, state: LineState) =>
    !prefs.fadeDistant || hideBlur || frame.blurIndex < 0 || state === 'Active'
      ? 0
      : Math.min(LYRICS_BLUR_MULTIPLIER * Math.abs(index - frame.blurIndex), maxBlur);
  const seekTo = (line: Line) => {
    user.current.scrolling = false;
    user.current.dragging = false;
    user.current.index = -2;
    setHideBlur(false);
    void command('seek', Math.max(0, line.start));
  };
  const pause = () => {
    user.current.scrolling = true;
    user.current.dragging = true;
    user.current.at = Date.now();
    setHideBlur(true);
  };
  const release = () => {
    user.current.dragging = false;
    user.current.at = Date.now();
  };
  const lead = useMemo<TextLook>(
    () => ({ size, weight: '700', sung: 0.85, unsung: data.Type === 'Line' ? 0.4 : 0.5 }),
    [size, data.Type],
  );
  const background = useMemo<TextLook>(
    () => ({ size: size * 0.75, weight: '600', sung: 0.6, unsung: 0.3 }),
    [size],
  );
  const leadState = (line: Line) => (line.lead !== undefined ? frame.states[line.lead] : undefined);

  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={32}
      onLayout={(e) => setViewHeight(e.nativeEvent.layout.height)}
      onScrollBeginDrag={pause}
      onScrollEndDrag={release}
      onMomentumScrollBegin={() => {
        user.current.dragging = true;
      }}
      onMomentumScrollEnd={release}
      contentContainerStyle={{
        paddingTop: viewHeight * 0.25,
        paddingBottom: viewHeight * 0.5,
        paddingLeft: width * 0.03,
      }}
    >
      {lines.map((line, index) => {
        const state = frame.states[line.id] ?? 'NotSung';
        const blur = blurFor(index, state);
        let body: React.ReactNode;
        if (line.kind === 'dots')
          body = (
            <DotsLine
              line={line}
              c={c}
              active={state === 'Active'}
              hidden={!!frame.hidden[line.id]}
              size={size}
            />
          );
        else if (line.kind === 'line')
          body = (
            <View style={{ marginVertical: width * 0.02 }}>
              <LineFade state={state}>
                <WholeLine line={line} c={c} state={state} blur={blur} look={lead} />
              </LineFade>
            </View>
          );
        else if (line.lead !== undefined && !prefs.backgroundVocals) return null;
        else if (line.lead !== undefined)
          body = (
            <BackgroundLine shown={state === 'Active' || leadState(line) === 'Active'} size={size}>
              <View style={{ marginTop: -width * 0.01, marginBottom: width * 0.01 }}>
                <LineFade state={state} background>
                  <SyllableLine
                    line={line}
                    c={c}
                    state={state}
                    blur={blur}
                    look={background}
                    high={high}
                    glow={prefs.glow}
                  />
                </LineFade>
              </View>
            </BackgroundLine>
          );
        else
          body = (
            <View style={{ marginVertical: width * 0.01 }}>
              <LineFade state={state}>
                <SyllableLine
                  line={line}
                  c={c}
                  state={state}
                  blur={blur}
                  look={lead}
                  high={high}
                  glow={prefs.glow}
                />
              </LineFade>
            </View>
          );
        const measure = (e: any) =>
          c.layout.set(line.id, { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height });
        if (!prefs.tapToSeek || line.kind === 'dots')
          return (
            <View key={line.id} onLayout={measure}>
              {body}
            </View>
          );
        return (
          <Pressable
            key={line.id}
            onLayout={measure}
            accessibilityRole="button"
            accessibilityHint="Plays the song from this line"
            onPress={() => seekTo(line)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            {body}
          </Pressable>
        );
      })}
      <CreditLine credit={credit} writers={data.SongWriters} width={width} />
    </ScrollView>
  );
}
function StaticLyrics({
  data,
  credit,
  width,
  scale,
}: {
  data: Extract<LyricsData, { Type: 'Static' }>;
  credit: Credit;
  width: number;
  scale: number;
}) {
  const size = clamp(width * 0.05, 13, 40) * scale;
  return (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingVertical: 80, paddingLeft: width * 0.03, paddingRight: width * 0.05 }}
    >
      {data.Lines.map((text, index) => (
        <Text
          key={index}
          style={{
            marginVertical: width * 0.01,
            fontFamily: FONT,
            fontWeight: '500',
            fontSize: size,
            lineHeight: size * 1.1818,
            color: WHITE(1),
            textAlign: isRtl(text) ? 'right' : 'left',
            writingDirection: isRtl(text) ? 'rtl' : 'ltr',
          }}
        >
          {text}
        </Text>
      ))}
      <CreditLine credit={credit} writers={data.SongWriters} width={width} />
    </ScrollView>
  );
}

function Backdrop({
  art,
  width,
  height,
  animated,
  dim,
}: {
  art: string | null;
  width: number;
  height: number;
  animated: boolean;
  dim: number;
}) {
  const clock = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const loop = Animated.loop(
      Animated.timing(clock, {
        toValue: 1,
        duration: 120000,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [clock, animated]);
  if (!art) return null;
  const side = Math.hypot(width, height) * 1.25,
    tile = 48;
  const turn = (turns: number) =>
    clock.interpolate({ inputRange: [0, 1], outputRange: ['0deg', 360 * turns + 'deg'] });
  const drift = (amount: number, phase: number) =>
    clock.interpolate({
      inputRange: [0, 0.25, 0.5, 0.75, 1],
      outputRange: [0, 1, 0, -1, 0].map((v) => v * amount * Math.cos(phase) + 0),
    });
  const layer = (
    key: string,
    opacity: number,
    scale: number,
    turns: number,
    dx: number,
    dy: number,
    phase: number,
  ) => (
    <MotionView
      key={key}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: width / 2 - side / 2,
        top: height / 2 - side / 2,
        width: side,
        height: side,
        opacity,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [
          { translateX: drift(dx, phase) },
          { translateY: drift(dy, phase + Math.PI / 2) },
          { rotate: turn(turns) },
          { scale },
        ],
      }}
    >
      <Image
        source={{ uri: art }}
        blurRadius={6}
        resizeMode="cover"
        style={{ width: tile, height: tile, transform: [{ scale: side / tile }] }}
      />
    </MotionView>
  );
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        backgroundColor: '#000',
      }}
    >
      {layer('base', 1, 1.1, 1, width * 0.05, height * 0.04, 0)}
      {layer('mid', 0.7, 1.4, -1, width * 0.18, height * 0.1, 1.3)}
      {layer('top', 0.5, 0.9, 2, width * 0.12, height * 0.16, 2.6)}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,' + clamp(dim, 0, 0.7) + ')',
        }}
      />
    </View>
  );
}
function ProgressBar({
  track,
  height,
  seekable,
  onScrub,
}: {
  track: Playback;
  height: number;
  seekable: boolean;
  onScrub: (ratio: number | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const [sync, setSync] = useState(0);
  const value = useRef(new Animated.Value(0)).current;
  const origin = useRef(0),
    dragging = useRef(false);
  useEffect(() => {
    if (!track.duration || dragging.current) return;
    const now = positionAt(track);
    value.setValue(now / track.duration);
    if (!track.playing) return;
    const animation = Animated.timing(value, {
      toValue: 1,
      duration: Math.max(0, track.duration - now),
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [track.id, track.position, track.updatedAt, track.playing, track.duration, width, sync, value]);
  const shift = useMemo(
    () => value.interpolate({ inputRange: [0, 1], outputRange: [-width, 0], extrapolate: 'clamp' }),
    [value, width],
  );
  const knob = useMemo(
    () =>
      value.interpolate({
        inputRange: [0, 1],
        outputRange: [-6, Math.max(-6, width - 6)],
        extrapolate: 'clamp',
      }),
    [value, width],
  );
  const ratioAt = (pageX: number) => clamp((pageX - origin.current) / Math.max(1, width), 0, 1);
  const scrub = (pageX: number) => {
    const ratio = ratioAt(pageX);
    value.stopAnimation();
    value.setValue(ratio);
    onScrub(ratio);
  };
  const finish = (ratio: number | null) => {
    dragging.current = false;
    onScrub(null);
    if (ratio === null || !track.duration) {
      setSync((n) => n + 1);
      return;
    }
    void command('seek', ratio * track.duration).finally(() => setSync((n) => n + 1));
  };
  const touch = seekable
    ? {
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderTerminationRequest: () => false,
        onResponderGrant: (e: any) => {
          dragging.current = true;
          origin.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
          scrub(e.nativeEvent.pageX);
        },
        onResponderMove: (e: any) => scrub(e.nativeEvent.pageX),
        onResponderRelease: (e: any) => finish(ratioAt(e.nativeEvent.pageX)),
        onResponderTerminate: () => finish(null),
      }
    : {};
  return (
    <View
      {...touch}
      hitSlop={{ top: 14, bottom: 14 }}
      style={{ marginTop: seekable ? 4 : 8, paddingVertical: seekable ? 6 : 0 }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <View style={{ height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: WHITE(0.28) }}>
        {width > 0 && (
          <MotionView
            style={{ width, height, backgroundColor: WHITE(1), transform: [{ translateX: shift }] }}
          />
        )}
      </View>
      {seekable && width > 0 && (
        <MotionView
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 6 + height / 2 - 6,
            left: 0,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: WHITE(1),
            transform: [{ translateX: knob }],
          }}
        />
      )}
    </View>
  );
}
function Controls({ track }: { track: Playback }) {
  const busy = useSyncExternalStore(subscribe, () => getState().busy);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ControlButton
        glyph="previous"
        label="Previous"
        disabled={busy}
        onPress={() => {
          void command('previous');
        }}
      />
      <ControlButton
        primary
        glyph={track.playing ? 'pause' : 'play'}
        label={track.playing ? 'Pause' : 'Play'}
        disabled={busy}
        onPress={() => {
          void command(track.playing ? 'pause' : 'play');
        }}
      />
      <ControlButton
        glyph="next"
        label="Next"
        disabled={busy}
        onPress={() => {
          void command('next');
        }}
      />
    </View>
  );
}
function Info({ track, narrow, controls }: { track: Playback; narrow: boolean; controls: boolean }) {
  const [, tick] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const position = scrub !== null ? scrub * track.duration : positionAt(track);
  const art = narrow ? 72 : 260;
  const time = (value: number, align: 'left' | 'right') => (
    <Text
      style={{
        minWidth: 44,
        textAlign: align,
        fontFamily: FONT,
        fontWeight: '500',
        fontSize: 12.8,
        color: WHITE(0.6),
      }}
    >
      {formatTime(value)}
    </Text>
  );
  const details = (
    <>
      <ProgressBar track={track} height={narrow ? 4 : 6} seekable={controls} onScrub={setScrub} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: controls ? 0 : 8,
        }}
      >
        {time(position, 'left')}
        {controls ? <Controls track={track} /> : null}
        {time(track.duration, 'right')}
      </View>
    </>
  );
  return (
    <View
      style={narrow ? { paddingLeft: 16, paddingRight: 16 } : { alignItems: 'center', gap: 20, width: 300 }}
    >
      <View
        style={
          narrow
            ? { flexDirection: 'row', gap: 12, alignItems: 'center', paddingRight: 48 }
            : { alignItems: 'center', gap: 20, alignSelf: 'stretch' }
        }
      >
        {track.artwork ? (
          <Image
            source={{ uri: track.artwork }}
            style={{ width: art, height: art, borderRadius: narrow ? 8 : 16 }}
          />
        ) : null}
        <View style={{ flex: narrow ? 1 : undefined, alignSelf: 'stretch', minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: FONT,
              fontWeight: '700',
              fontSize: narrow ? 18 : 26,
              color: WHITE(1),
              textAlign: narrow ? 'left' : 'center',
            }}
          >
            {track.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              marginTop: 2,
              fontFamily: FONT,
              fontWeight: '500',
              fontSize: narrow ? 14 : 18,
              color: WHITE(0.6),
              textAlign: narrow ? 'left' : 'center',
            }}
          >
            {track.artist}
          </Text>
          {!narrow && details}
        </View>
      </View>
      {narrow && details}
    </View>
  );
}
function LyricsScreen({
  track,
  closing,
  onClosed,
}: {
  track: Playback;
  closing: boolean;
  onClosed: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const narrow = width <= 900;
  const key = useSyncExternalStore(subscribeUi, getLyricsKey);
  const prefs = useSyncExternalStore(subscribeUi, getLyricsPrefs);
  const [result, setResult] = useState<LyricsResult | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    setResult(undefined);
    setProblem(null);
    fetchLyrics(track.id, key).then(
      (value) => {
        if (live) setResult(value);
      },
      (error) => {
        if (live) {
          setResult(null);
          setProblem(error instanceof LyricsError ? error.message : 'Could not load lyrics.');
        }
      },
    );
    return () => {
      live = false;
    };
  }, [track.id, key]);
  useEffect(() => {
    const animation = closing
      ? Animated.timing(enter, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        })
      : Animated.timing(enter, {
          toValue: 1,
          duration: 450,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        });
    animation.start(({ finished }) => {
      if (!finished) return;
      if (closing) onClosed();
      else setReady(true);
    });
    return () => animation.stop();
  }, [closing, enter, onClosed]);
  const lyricsWidth = narrow ? width - 20 : width * 0.55 - width * 0.04;
  const top = StatusBar.currentHeight ?? 24;
  const message = (text: string) => (
    <Text
      style={{
        marginTop: height * 0.3,
        marginLeft: lyricsWidth * 0.03,
        marginRight: lyricsWidth * 0.05,
        fontFamily: FONT,
        fontWeight: '700',
        fontSize: clamp(width * 0.04, 19, 32),
        color: WHITE(0.6),
      }}
    >
      {text}
    </Text>
  );
  const body =
    result === undefined || (!ready && result) ? (
      message('Loading lyrics\u2026')
    ) : !result ? (
      message(problem ?? 'No lyrics for this song')
    ) : result.data.Type === 'Static' ? (
      <StaticLyrics data={result.data} credit={result.credit} width={lyricsWidth} scale={prefs.textScale} />
    ) : (
      <SyncedLyrics
        data={result.data}
        credit={result.credit}
        track={track}
        width={lyricsWidth}
        prefs={prefs}
      />
    );
  return (
    <MotionView
      style={{
        flex: 1,
        backgroundColor: '#0b0b0b',
        opacity: enter,
        transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }) }],
      }}
    >
      <Backdrop
        art={track.artwork}
        width={width}
        height={height}
        animated={prefs.animatedBackground}
        dim={prefs.backgroundDim}
      />
      <View
        style={{
          flex: 1,
          paddingTop: top,
          flexDirection: narrow ? 'column' : 'row',
          alignItems: narrow ? 'stretch' : 'center',
        }}
      >
        {narrow ? (
          <>
            {prefs.showInfo ? (
              <View style={{ paddingTop: 16, paddingBottom: 12 }}>
                <Info track={track} narrow controls={prefs.showControls} />
              </View>
            ) : (
              <View style={{ height: 56 }} />
            )}
            <View style={{ flex: 1, paddingLeft: 12, paddingRight: 8 }}>{body}</View>
          </>
        ) : (
          <>
            {prefs.showInfo && (
              <View style={{ flex: 45, alignItems: 'center' }}>
                <Info track={track} narrow={false} controls={prefs.showControls} />
              </View>
            )}
            <View style={{ flex: 55, alignSelf: 'stretch', paddingRight: width * 0.04 }}>{body}</View>
          </>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close fullscreen lyrics"
        onPress={closeLyrics}
        hitSlop={8}
        style={({ pressed }) => ({
          position: 'absolute',
          top: top + 12,
          right: 12,
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: WHITE(pressed ? 0.18 : 0.1),
          opacity: pressed ? 1 : 0.55,
        })}
      >
        <Icon glyph="close" size={22} color="#FFFFFF" />
      </Pressable>
    </MotionView>
  );
}
export function LyricsHost() {
  const wanted = useOpen();
  const track = useSyncExternalStore(subscribe, () => getState().playback);
  const [shown, setShown] = useState(wanted);
  useEffect(() => {
    if (wanted) setShown(true);
  }, [wanted]);
  useEffect(() => {
    if (!track && open) closeLyrics();
  }, [track]);
  const onClosed = React.useCallback(() => setShown(false), []);
  if (!shown || !track) return null;
  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      {...({ navigationBarTranslucent: true } as any)}
      onRequestClose={closeLyrics}
    >
      <LyricsScreen track={track} closing={!wanted} onClosed={onClosed} />
    </Modal>
  );
}
