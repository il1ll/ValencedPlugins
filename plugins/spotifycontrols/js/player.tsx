import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Image, Linking, Pressable, View } from 'react-native';
import { Design } from '@valenced/discord/design';
import { Tokens } from '@valenced/discord/common/tokens';
import { lookupModule } from '@valenced/modules/finders';
import { withProps } from '@valenced/modules/finders/filters';
import { command, getState, subscribe } from './spotify';
import { formatTime, positionAt, type Command, type Playback } from './playback';
import { ControlButton, SafeVector, useSvg } from './icons';
import { openLyrics } from './lyricsView';
import { getProgressStyle, subscribeUi, type ProgressStyle } from './ui';
const MotionView = Animated.View;

function useForeground() {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (value) => setForeground(value === 'active'));
    return () => listener.remove();
  }, []);
  return foreground;
}
function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduceMotion(value);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      live = false;
      listener.remove();
    };
  }, []);
  return reduceMotion;
}
function useProgress(track: Playback | null, live: boolean, sync: number, width: number) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!track || !track.duration) {
      value.setValue(0);
      return;
    }
    let animation: Animated.CompositeAnimation | null = null;
    const run = () => {
      animation?.stop();
      const now = positionAt(track),
        from = now / track.duration;
      value.setValue(from);
      if (!track.playing || !live) return;
      const next = Math.min(track.duration, now + 1000);
      animation = Animated.timing(value, {
        toValue: next / track.duration,
        duration: next - now,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      });
      animation.start();
    };
    run();
    if (!track.playing || !live) return () => animation?.stop();
    const timer = setInterval(run, 1000);
    return () => {
      clearInterval(timer);
      animation?.stop();
    };
  }, [
    track?.id,
    track?.position,
    track?.updatedAt,
    track?.playing,
    track?.duration,
    live,
    sync,
    width,
    value,
  ]);
  return value;
}
const WAVE_LENGTH = 28,
  WAVE_HEIGHT = 16,
  WAVE_AMPLITUDE = 3.5,
  LINE = 3;
export function wavePath(width: number) {
  const mid = WAVE_HEIGHT / 2;
  const points = Array.from({ length: Math.ceil(width / 1.5) + 1 }, (_, i) => {
    const x = i * 1.5,
      y = mid + Math.sin((x / WAVE_LENGTH) * Math.PI * 2) * WAVE_AMPLITUDE;
    return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(2);
  });
  return points.join(' ');
}
let gestureModule: any;
function gestureHandler() {
  if (gestureModule === undefined) {
    try {
      const mod: any = lookupModule(withProps('GestureDetector', 'Gesture'))[0];
      gestureModule =
        mod &&
        typeof mod.Gesture?.Pan === 'function' &&
        typeof mod.Gesture?.Tap === 'function' &&
        typeof mod.Gesture?.Race === 'function' &&
        mod.GestureDetector
          ? mod
          : null;
    } catch {
      gestureModule = null;
    }
  }
  return gestureModule;
}
class GestureGuard extends React.Component<
  { fallback: React.ReactNode; children?: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    gestureModule = null;
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function waveSegments(width: number) {
  const step = 1.5,
    mid = WAVE_HEIGHT / 2,
    y = (x: number) => mid + Math.sin((x / WAVE_LENGTH) * Math.PI * 2) * WAVE_AMPLITUDE;
  return Array.from({ length: Math.ceil(width / step) }, (_, i) => {
    const x0 = i * step,
      x1 = x0 + step,
      y0 = y(x0),
      y1 = y(x1);
    const length = Math.hypot(x1 - x0, y1 - y0) + LINE;
    return {
      left: (x0 + x1) / 2 - length / 2,
      top: (y0 + y1) / 2 - LINE / 2,
      length,
      angle: Math.atan2(y1 - y0, x1 - x0),
    };
  });
}
function Wave({
  track,
  live,
  sync,
  ratio,
  playing,
  animate,
  onSeek,
  accent,
  muted,
  kind,
}: {
  track: Playback;
  live: boolean;
  sync: number;
  ratio: number;
  playing: boolean;
  animate: boolean;
  onSeek: (ratio: number) => void;
  accent: string;
  muted: string;
  kind: ProgressStyle;
}) {
  const [width, setWidth] = useState(0);
  const value = useProgress(track, live, sync, width);
  const phase = useRef(new Animated.Value(0)).current;
  const amplitude = useRef(new Animated.Value(playing ? 1 : 0)).current;
  const origin = useRef(0);
  const svg = useSvg();
  const strip = width + WAVE_LENGTH;
  const path = useMemo(() => wavePath(strip), [strip]);
  const segments = useMemo(() => (svg || kind !== 'wave' ? null : waveSegments(strip)), [svg, strip, kind]);
  useEffect(() => {
    if (kind !== 'wave') return;
    if (!playing) {
      const settle = Animated.timing(amplitude, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
        isInteraction: false,
      });
      settle.start();
      return () => settle.stop();
    }
    const rise = Animated.timing(amplitude, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    rise.start();
    if (!animate) return () => rise.stop();
    phase.setValue(0);
    const flow = Animated.loop(
      Animated.timing(phase, {
        toValue: WAVE_LENGTH,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    flow.start();
    return () => {
      rise.stop();
      flow.stop();
    };
  }, [kind, playing, animate, amplitude, phase]);
  const transforms = useMemo(() => {
    const range = (from: number, to: number) =>
      value.interpolate({ inputRange: [0, 1], outputRange: [from, to], extrapolate: 'clamp' });
    return {
      played: range(-width, 0),
      counter: range(width, 0),
      rest: range(0, width),
      knob: range(0, Math.max(0, width - 4)),
      ball: range(0, Math.max(0, width - 12)),
    };
  }, [value, width]);
  const flat = useMemo(() => amplitude.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), [amplitude]);
  const swell = useMemo(
    () => amplitude.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] }),
    [amplitude],
  );
  const top = (28 - WAVE_HEIGHT) / 2,
    lineTop = (28 - LINE) / 2;
  const ratioAt = (pageX: number) => Math.max(0, Math.min(1, (pageX - origin.current) / Math.max(1, width)));
  const scrub = (pageX: number) => {
    value.stopAnimation();
    value.setValue(ratioAt(pageX));
  };
  const gh = useMemo(gestureHandler, []);
  const latest = useRef({ width, value, onSeek });
  latest.current = { width, value, onSeek };
  const gesture = useMemo(() => {
    if (!gh) return null;
    const { Gesture } = gh;
    const at = (x: number) => Math.max(0, Math.min(1, x / Math.max(1, latest.current.width)));
    const move = (x: number) => {
      latest.current.value.stopAnimation();
      latest.current.value.setValue(at(x));
    };
    let dragging = false;
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-3, 3])
      .failOffsetY([-14, 14])
      .shouldCancelWhenOutside(false)
      .onStart((e: any) => {
        dragging = true;
        move(e.x);
      })
      .onUpdate((e: any) => move(e.x))
      .onEnd((e: any) => {
        if (dragging) latest.current.onSeek(at(e.x));
      })
      .onFinalize((_e: any, success: boolean) => {
        if (dragging && !success) latest.current.onSeek(-1);
        dragging = false;
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e: any, success: boolean) => {
        if (success) {
          move(e.x);
          latest.current.onSeek(at(e.x));
        }
      });
    return Gesture.Race(pan, tap);
  }, [gh]);
  const a11y = {
    accessible: true,
    accessibilityRole: 'adjustable' as const,
    accessibilityLabel: 'Song progress',
    accessibilityValue: { min: 0, max: 100, now: Math.round(ratio * 100) },
    accessibilityActions: [
      { name: 'increment', label: 'Forward ten percent' },
      { name: 'decrement', label: 'Back ten percent' },
    ],
    onAccessibilityAction: (e: any) =>
      onSeek(Math.max(0, Math.min(1, ratio + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)))),
    onLayout: (e: any) => setWidth(Math.max(0, Math.round(e.nativeEvent.layout.width))),
  };
  const responder = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: any) => {
      origin.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
      scrub(e.nativeEvent.pageX);
    },
    onResponderMove: (e: any) => scrub(e.nativeEvent.pageX),
    onResponderRelease: (e: any) => onSeek(ratioAt(e.nativeEvent.pageX)),
    onResponderTerminate: () => onSeek(-1),
  };
  const played = (fill: React.ReactNode) => (
    <MotionView
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height: 28,
        overflow: 'hidden',
        transform: [{ translateX: transforms.played }],
      }}
    >
      <MotionView style={{ width, height: 28, transform: [{ translateX: transforms.counter }] }}>
        {fill}
      </MotionView>
    </MotionView>
  );
  const rest = (height: number, top: number, opacity: number) => (
    <MotionView
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top,
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: muted,
        opacity,
        transform: [{ translateX: transforms.rest }],
      }}
    />
  );
  let content: React.ReactNode = null;
  if (width > 0 && kind === 'bar')
    content = (
      <>
        {rest(4, 12, 0.4)}
        {played(
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 12,
              width,
              height: 4,
              borderRadius: 2,
              backgroundColor: accent,
            }}
          />,
        )}
        <MotionView
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 8,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: accent,
            transform: [{ translateX: transforms.ball }],
          }}
        />
      </>
    );
  else if (width > 0)
    content = (
      <>
        {rest(LINE, lineTop, 0.4)}
        {played(
          <>
            <MotionView
              style={{
                position: 'absolute',
                left: 0,
                top: lineTop,
                width,
                height: LINE,
                borderRadius: LINE / 2,
                backgroundColor: accent,
                opacity: flat,
              }}
            />
            <MotionView
              style={{
                position: 'absolute',
                left: -WAVE_LENGTH,
                top,
                width: strip,
                height: WAVE_HEIGHT,
                opacity: amplitude,
                transform: [{ translateX: phase }, { scaleY: swell }],
              }}
            >
              {svg?.Svg && svg?.Path ? (
                <SafeVector
                  fallback={waveSegments(strip).map((segment, i) => (
                    <View
                      key={i}
                      style={{
                        position: 'absolute',
                        left: segment.left,
                        top: segment.top,
                        width: segment.length,
                        height: LINE,
                        borderRadius: LINE / 2,
                        backgroundColor: accent,
                        transform: [{ rotate: segment.angle + 'rad' }],
                      }}
                    />
                  ))}
                >
                  {React.createElement(
                    svg.Svg,
                    { width: strip, height: WAVE_HEIGHT },
                    React.createElement(svg.Path, {
                      d: path,
                      stroke: accent,
                      strokeWidth: LINE,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                      fill: 'none',
                    }),
                  )}
                </SafeVector>
              ) : (
                (segments ?? []).map((segment, i) => (
                  <View
                    key={i}
                    style={{
                      position: 'absolute',
                      left: segment.left,
                      top: segment.top,
                      width: segment.length,
                      height: LINE,
                      borderRadius: LINE / 2,
                      backgroundColor: accent,
                      transform: [{ rotate: segment.angle + 'rad' }],
                    }}
                  />
                ))
              )}
            </MotionView>
          </>,
        )}
        <MotionView
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 7,
            width: 4,
            height: 14,
            borderRadius: 2,
            backgroundColor: accent,
            transform: [{ translateX: transforms.knob }],
          }}
        />
      </>
    );
  const plain = (
    <View {...a11y} {...responder} style={{ height: 28, overflow: 'hidden' }}>
      {content}
    </View>
  );
  if (!gh || !gesture) return plain;
  const Detector = gh.GestureDetector;
  return (
    <GestureGuard fallback={plain}>
      <Detector gesture={gesture}>
        <View {...a11y} collapsable={false} style={{ height: 28, overflow: 'hidden' }}>
          {content}
        </View>
      </Detector>
    </GestureGuard>
  );
}
function ProgressLine({
  track,
  live,
  accent,
  muted,
}: {
  track: Playback;
  live: boolean;
  accent: string;
  muted: string;
}) {
  const [width, setWidth] = useState(0);
  const value = useProgress(track, live, 0, width);
  const shift = useMemo(
    () => value.interpolate({ inputRange: [0, 1], outputRange: [-width, 0], extrapolate: 'clamp' }),
    [value, width],
  );
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={{ height: 3, borderRadius: 1.5, overflow: 'hidden' }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: muted,
          opacity: 0.45,
        }}
      />
      {width > 0 && (
        <MotionView
          style={{
            width,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: accent,
            transform: [{ translateX: shift }],
          }}
        />
      )}
    </View>
  );
}
type Palette = { surface: string; accent: string; muted: string; text: string; fill: string; onFill: string };
function usePalette(): Palette {
  const context = (Design as any).useThemeContext();
  return useMemo(() => {
    const { colors, internal } = Tokens.default;
    const resolve = (names: string[], fallback: string) => {
      for (const name of names) {
        try {
          if (!colors[name]) continue;
          const value = internal.resolveSemanticColor(context.theme, colors[name]);
          if (typeof value === 'string' && value !== 'transparent') return value;
        } catch {}
      }
      return fallback;
    };
    const light = context.theme === 'light';
    let surface = resolve(
      ['BACKGROUND_SURFACE_HIGH', 'BACKGROUND_SECONDARY', 'BACKGROUND_BASE_LOW'],
      light ? '#F2F3F5' : '#111827',
    );
    surface = surface.replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/, 'rgb($1,$2,$3)');
    if (/^#[\da-f]{8}$/i.test(surface)) surface = surface.slice(0, 7);
    const text = resolve(
      ['TEXT_DEFAULT', 'TEXT_NORMAL', 'INTERACTIVE_ACTIVE', 'HEADER_PRIMARY'],
      light ? '#1F2328' : '#F2F3F5',
    );
    return {
      surface,
      text,
      accent: resolve(['TEXT_LINK'], '#859BFF'),
      muted: resolve(['TEXT_MUTED'], '#64748B'),
      fill: text,
      onFill: light ? '#FFFFFF' : '#111214',
    };
  }, [context.theme]);
}
export function Player({
  preview = false,
  mode = 'full',
  bare = false,
  onExpand,
}: {
  preview?: boolean;
  mode?: 'mini' | 'full';
  bare?: boolean;
  onExpand?: () => void;
}) {
  const state = useSyncExternalStore(subscribe, getState);
  const progressStyle = useSyncExternalStore(subscribeUi, getProgressStyle);
  const collapsed = mode === 'mini';
  const palette = usePalette();
  const foreground = useForeground(),
    reduceMotion = useReduceMotion();
  const [, tick] = useState(0),
    [sync, setSync] = useState(0);
  const track = state.playback;
  useEffect(() => {
    if (!foreground || !track || collapsed) return;
    const progressTimer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(progressTimer);
  }, [foreground, !!track, collapsed]);
  if (!track) return preview ? <Design.TableRow label="Spotify Controls" subLabel={state.status} /> : null;
  const position = positionAt(track),
    ratio = track.duration ? position / track.duration : 0;
  const openTrack = () => {
    void Linking.openURL('https://open.spotify.com/track/' + encodeURIComponent(track.id)).catch(() => {});
  };
  const run = (action: Command) => () => {
    void command(action);
  };
  const seek = (value: number) => {
    if (value < 0 || state.busy || !track.duration) {
      setSync((n) => n + 1);
      return;
    }
    void command('seek', value * track.duration).finally(() => setSync((n) => n + 1));
  };
  const frame = bare
    ? null
    : {
        marginHorizontal: preview ? 0 : 12,
        marginBottom: preview ? 0 : 8,
        borderRadius: 16,
        backgroundColor: palette.surface,
      };
  const common = { disabled: state.busy };
  const artwork = (size: number) =>
    track.artwork ? (
      <Image
        source={{ uri: track.artwork }}
        style={{ width: size, height: size, borderRadius: size > 36 ? 8 : 6 }}
      />
    ) : null;
  const titles = (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Design.Text variant="text-sm/semibold" color="text-default" numberOfLines={1}>
        {track.title}
      </Design.Text>
      <Design.Text variant="text-xs/normal" color="text-muted" numberOfLines={1}>
        {track.artist}
      </Design.Text>
    </View>
  );
  if (collapsed)
    return (
      <View style={[{ flexShrink: 0, overflow: 'hidden' }, frame]}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            paddingLeft: 12,
            paddingRight: 8,
            height: 44,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={'Expand Spotify player. ' + track.title + ', ' + track.artist}
            onPress={onExpand}
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginRight: 4,
            }}
          >
            {artwork(36)}
            {titles}
          </Pressable>
          <ControlButton
            {...common}
            size="sm"
            primary
            glyph={track.playing ? 'pause' : 'play'}
            label={track.playing ? 'Pause' : 'Play'}
            onPress={run(track.playing ? 'pause' : 'play')}
          />
          <ControlButton {...common} size="sm" glyph="next" label="Next" onPress={run('next')} />
        </View>
        <View style={{ paddingHorizontal: 12, marginTop: 1 }}>
          <ProgressLine track={track} live={foreground} accent={palette.accent} muted={palette.muted} />
        </View>
      </View>
    );
  return (
    <View style={[{ flexShrink: 0, overflow: 'hidden' }, frame]}>
      <View style={{ paddingHorizontal: 12, paddingTop: bare ? 4 : 10, paddingBottom: 8 }}>
        <View>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={'Open ' + track.title + ' in Spotify'}
            onPress={openTrack}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: preview ? 0 : 30 }}
          >
            {artwork(44)}
            {titles}
          </Pressable>
          {!preview && (
            <View style={{ position: 'absolute', top: -9, right: -5 }}>
              <ControlButton
                size="sm"
                glyph="fullscreen"
                label="Open lyrics in fullscreen"
                onPress={openLyrics}
              />
            </View>
          )}
        </View>
        <View style={{ marginTop: 6 }}>
          <Wave
            track={track}
            live={foreground}
            sync={sync}
            ratio={ratio}
            playing={track.playing && foreground}
            animate={!reduceMotion}
            accent={palette.accent}
            muted={palette.muted}
            onSeek={seek}
            kind={progressStyle}
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 }}>
          <Design.Text variant="text-xs/normal" color="text-muted">
            {formatTime(position)}
          </Design.Text>
          <Design.Text variant="text-xs/normal" color="text-muted">
            {formatTime(track.duration)}
          </Design.Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 4,
            minHeight: 44,
            marginTop: 4,
          }}
        >
          <ControlButton
            {...common}
            glyph="shuffle"
            label={track.shuffle ? 'Shuffle on' : 'Shuffle off'}
            primary={track.shuffle}
            onPress={run('shuffle')}
          />
          <ControlButton {...common} glyph="previous" label="Previous" onPress={run('previous')} />
          <ControlButton
            {...common}
            primary
            glyph={track.playing ? 'pause' : 'play'}
            label={track.playing ? 'Pause' : 'Play'}
            onPress={run(track.playing ? 'pause' : 'play')}
          />
          <ControlButton {...common} glyph="next" label="Next" onPress={run('next')} />
          <ControlButton
            {...common}
            glyph={track.repeat === 'track' ? 'repeatOne' : 'repeat'}
            label={
              track.repeat === 'track'
                ? 'Repeat one'
                : track.repeat === 'context'
                  ? 'Repeat all'
                  : 'Repeat off'
            }
            primary={track.repeat !== 'off'}
            onPress={run('repeat')}
          />
        </View>
        {!bare && state.status !== 'Connected to Spotify' && (
          <Design.Text variant="text-xs/normal" color="text-muted" style={{ marginTop: 4 }}>
            {state.status}
          </Design.Text>
        )}
      </View>
    </View>
  );
}
