import React from 'react';
import { Animated, BackHandler, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { getModules, lookupModule } from '@valenced/modules/finders';
import { createFilterGenerator, FilterScopes, withProps } from '@valenced/modules/finders/filters';
import { Design } from '@valenced/discord/design';
import { Tokens } from '@valenced/discord/common/tokens';
import { Player } from './player';
import { LyricsHost } from './lyricsView';
import { getState, subscribe } from './spotify';
import { getMode, setMode, stepMode, subscribeUi } from './ui';

const BAR_HEIGHT = 56,
  BAR_MARGIN = 16;
const CLOSED_HEIGHT = 22,
  COLLAPSED_HEIGHT = 58,
  RADIUS = 24,
  BAR_RADIUS = 28,
  CONTENT_TOP = 12,
  EXPANDED_PADDING_BOTTOM = 16;
const GESTURE_DELTA = 15,
  GESTURE_VELOCITY = 0.2;
const SPRING = { mass: 0.5, damping: 80, stiffness: 320, useNativeDriver: false } as const;
const MotionView = Animated.View;

const nameOf = (type: any): string => type?.displayName || type?.name || '';
const filter = createFilterGenerator<[string]>(
  ([name], _id, value: any) =>
    [value, value?.default, value?.type, value?.default?.type, value?.render, value?.default?.render].some(
      (v) => nameOf(v) === name,
    ),
  ([name]) => 'dariuss.spotify.component(' + name + ')',
  FilterScopes.Initialized,
);
let reportError: (error: unknown) => void = () => {};
let generation = 0;
const bumpListeners = new Set<() => void>();
const bump = () => {
  generation++;
  for (const fn of [...bumpListeners]) fn();
};
class Guard extends React.Component<
  { original: React.ReactNode; children?: React.ReactNode },
  { failed: boolean; at: number }
> {
  state = { failed: false, at: generation };
  private off?: () => void;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    try {
      reportError(error);
    } catch {}
    this.setState({ at: generation });
  }
  componentDidMount() {
    const listener = () => {
      if (this.state.failed && generation !== this.state.at) this.setState({ failed: false, at: generation });
    };
    bumpListeners.add(listener);
    this.off = () => bumpListeners.delete(listener);
  }
  componentWillUnmount() {
    this.off?.();
  }
  render() {
    return this.state.failed ? this.props.original : this.props.children;
  }
}

type BarLayout = { x: number; y: number; width: number; height: number };
const barWrappers = new WeakMap<object, any>();
function measureTree(tree: any, measure: (layout: BarLayout) => void, depth = 0): any {
  if (depth > 16 || !tree) return tree;
  if (Array.isArray(tree)) return tree.map((node) => measureTree(node, measure, depth + 1));
  if (!React.isValidElement<any>(tree)) return tree;
  const type: any = tree.type,
    original = type?.type ?? type;
  if (typeof original === 'function' && nameOf(original) === 'YouBar') {
    let Wrapped = barWrappers.get(type);
    if (!Wrapped) {
      Wrapped = function SpotifyMeasuredBar({ spcMeasure, ...props }: any) {
        const result = original(props);
        if (!React.isValidElement<any>(result)) return result;
        return React.cloneElement(result, {
          onLayout: (event: any) => {
            try {
              spcMeasure(event.nativeEvent.layout);
            } catch {}
            result.props.onLayout?.(event);
          },
        });
      };
      barWrappers.set(type, Wrapped);
    }
    return React.createElement(Wrapped, { ...tree.props, key: tree.key, spcMeasure: measure });
  }
  return tree.props.children
    ? React.cloneElement(tree, {}, measureTree(tree.props.children, measure, depth + 1))
    : tree;
}

let hooks: { margin: () => number; bottom: () => number; background: () => unknown; height: number } | null =
  null;
function useDockLook() {
  if (!hooks) {
    const find = (prop: string) => {
      try {
        return (lookupModule(withProps(prop))[0] as any) ?? null;
      } catch {
        return null;
      }
    };
    const margins = find('useYouBarHorizontalMargin'),
      constants = find('YOU_BAR_HEIGHT'),
      dock = find('useQuestDockAppThemedBackgroundColor');
    const pick = (hook: unknown, fallback: () => unknown) =>
      typeof hook === 'function' ? (hook as () => any) : fallback;
    hooks = {
      margin: pick(margins?.useYouBarHorizontalMargin, () => BAR_MARGIN),
      bottom: pick(margins?.useYouBarBottomMargin, () => BAR_MARGIN),
      background: pick(dock?.useQuestDockAppThemedBackgroundColor, () => null),
      height: typeof constants?.YOU_BAR_HEIGHT === 'number' ? constants.YOU_BAR_HEIGHT : BAR_HEIGHT,
    };
  }
  const margin = hooks.margin(),
    bottom = hooks.bottom(),
    dockColor = hooks.background();
  const context = (Design as any).useThemeContext();
  const tokens = React.useMemo(() => {
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
    return {
      background: resolve(
        ['BACKGROUND_SURFACE_HIGH', 'MOBILE_FLOATINGBAR_BACKGROUND'],
        context.theme === 'light' ? '#FFFFFF' : '#242429',
      ),
      border: resolve(['BORDER_MUTED', 'BORDER_SUBTLE'], 'transparent'),
      handle: resolve(['INTERACTIVE_MUTED', 'TEXT_MUTED'], '#64748B'),
    };
  }, [context.theme]);
  const number = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  return {
    margin: number(margin, BAR_MARGIN),
    bottom: number(bottom, BAR_MARGIN),
    barHeight: hooks.height,
    background: typeof dockColor === 'string' && dockColor !== 'transparent' ? dockColor : tokens.background,
    border: tokens.border,
    handle: tokens.handle,
  };
}

function DockCard({ bar }: { bar: React.ReactNode }) {
  const [layout, setLayout] = React.useState<BarLayout | null>(null),
    [containerHeight, setContainerHeight] = React.useState(0);
  const measure = React.useCallback(
    (next: BarLayout) =>
      setLayout((previous) =>
        previous &&
        Math.abs(previous.x - next.x) < 0.5 &&
        Math.abs(previous.y - next.y) < 0.5 &&
        Math.abs(previous.width - next.width) < 0.5 &&
        Math.abs(previous.height - next.height) < 0.5
          ? previous
          : { x: next.x, y: next.y, width: next.width, height: next.height },
      ),
    [],
  );
  const measuredBar = React.useMemo(() => measureTree(bar, measure), [bar, measure]);
  const present = React.useSyncExternalStore(subscribe, () => !!getState().playback);
  const mode = React.useSyncExternalStore(subscribeUi, getMode);
  const look = useDockLook();
  const frame =
    layout && layout.width > 0 && containerHeight > 0
      ? {
          left: layout.x,
          width: layout.width,
          bottom: Math.max(0, containerHeight - layout.y - layout.height),
          barHeight: layout.height,
        }
      : { left: look.margin, right: look.margin, bottom: look.bottom, barHeight: look.barHeight };
  const [mounted, setMounted] = React.useState(present);
  const [fullHeight, setFullHeight] = React.useState(0);
  const height = React.useRef(new Animated.Value(frame.barHeight)).current;
  const dragging = React.useRef(false),
    dragStart = React.useRef(0),
    current = React.useRef(frame.barHeight);

  const closed = frame.barHeight + CLOSED_HEIGHT,
    collapsed = frame.barHeight + COLLAPSED_HEIGHT;
  const expanded = Math.max(
    collapsed + 1,
    fullHeight > 0 ? CONTENT_TOP + fullHeight + EXPANDED_PADDING_BOTTOM : collapsed + 160,
  );
  const target = !present
    ? frame.barHeight
    : mode === 'closed'
      ? closed
      : mode === 'collapsed'
        ? collapsed
        : expanded;
  const targets = React.useRef({ closed, collapsed, expanded });
  targets.current = { closed, collapsed, expanded };

  React.useEffect(() => {
    const id = height.addListener(({ value }) => {
      current.current = value;
    });
    return () => height.removeListener(id);
  }, [height]);
  React.useEffect(() => {
    if (present) setMounted(true);
  }, [present]);
  React.useEffect(() => {
    if (!mounted || dragging.current) return;
    const animation = Animated.spring(height, { ...SPRING, toValue: target });
    animation.start(({ finished }) => {
      if (finished && !present) setMounted(false);
    });
    return () => animation.stop();
  }, [target, mounted, present, height]);
  React.useEffect(() => {
    if (mode !== 'expanded' || !present) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setMode('collapsed');
      return true;
    });
    return () => subscription.remove();
  }, [mode, present]);

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderGrant: () => {
          dragging.current = true;
          height.stopAnimation();
          dragStart.current = current.current;
        },
        onPanResponderMove: (_e, g) => {
          const { closed: low, expanded: high } = targets.current;
          const next = dragStart.current - g.dy;
          height.setValue(
            next < low ? low - (low - next) * 0.25 : next > high ? high + (next - high) * 0.25 : next,
          );
        },
        onPanResponderRelease: (_e, g) => {
          dragging.current = false;
          const fling = Math.abs(g.vy) > GESTURE_VELOCITY;
          if (g.dy < -GESTURE_DELTA || (fling && g.vy < 0)) stepMode(1);
          else if (g.dy > GESTURE_DELTA || (fling && g.vy > 0)) stepMode(-1);
          const { closed: c, collapsed: m, expanded: e } = targets.current,
            now = getMode();
          Animated.spring(height, {
            ...SPRING,
            toValue: now === 'closed' ? c : now === 'collapsed' ? m : e,
          }).start();
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          const { closed: c, collapsed: m, expanded: e } = targets.current,
            now = getMode();
          Animated.spring(height, {
            ...SPRING,
            toValue: now === 'closed' ? c : now === 'collapsed' ? m : e,
          }).start();
        },
      }),
    [height],
  );

  const ease = (input: number[], output: number[]) =>
    height.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' });
  const rowOpacity = ease([closed, collapsed, collapsed + 40], [0, 1, 0]);
  const fullOpacity = ease([collapsed + 20, Math.max(expanded, collapsed + 21)], [0, 1]);
  const barOpacity = ease([collapsed, collapsed + (expanded - collapsed) * 0.6], [1, 0]);
  const cardOpacity = ease([frame.barHeight, frame.barHeight + 8], [0, 1]);
  const expandedMode = mode === 'expanded' && present;

  return (
    <>
      {mounted && (
        <MotionView
          {...pan.panHandlers}
          style={{
            position: 'absolute',
            left: frame.left,
            right: frame.right,
            width: frame.width,
            bottom: frame.bottom,
            height,
            borderTopLeftRadius: RADIUS,
            borderTopRightRadius: RADIUS,
            borderBottomLeftRadius: BAR_RADIUS,
            borderBottomRightRadius: RADIUS,
            overflow: 'hidden',
            backgroundColor: look.background,
            borderColor: look.border,
            borderWidth: 1,
            opacity: cardOpacity,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mode === 'expanded' ? 'Collapse Spotify player' : 'Expand Spotify player'}
            hitSlop={8}
            onPress={() => stepMode(mode === 'expanded' ? -1 : 1)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: CONTENT_TOP + 4,
              alignItems: 'center',
              zIndex: 2,
            }}
          >
            <View
              style={{
                marginTop: 7,
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: look.handle,
                opacity: 0.6,
              }}
            />
          </Pressable>
          <MotionView
            pointerEvents={mode === 'collapsed' ? 'auto' : 'none'}
            style={{ position: 'absolute', top: CONTENT_TOP - 4, left: 0, right: 0, opacity: rowOpacity }}
          >
            <Player bare mode="mini" onExpand={() => setMode('expanded')} />
          </MotionView>
          <MotionView
            pointerEvents={expandedMode ? 'auto' : 'none'}
            style={{ position: 'absolute', top: CONTENT_TOP, left: 0, right: 0, opacity: fullOpacity }}
            onLayout={(event) => {
              const value = Math.round(event.nativeEvent.layout.height);
              setFullHeight((previous) => (Math.abs(previous - value) > 0.5 ? value : previous));
            }}
          >
            <Player bare mode="full" />
          </MotionView>
        </MotionView>
      )}
      <MotionView
        pointerEvents={expandedMode ? 'none' : 'box-none'}
        style={[StyleSheet.absoluteFill, { opacity: mounted ? barOpacity : 1 }]}
        onLayout={(event) => {
          const value = event.nativeEvent.layout.height;
          setContainerHeight((previous) => (Math.abs(previous - value) < 0.5 ? previous : value));
        }}
      >
        {measuredBar}
      </MotionView>
    </>
  );
}
function Dock({ original }: { original: React.ReactNode }) {
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <DockCard bar={original} />
      <LyricsHost />
    </View>
  );
}
export function startIntegration(report: (error: unknown) => void) {
  reportError = report;
  let lastTrack: string | undefined;
  const offUi = subscribeUi(bump);
  const offTrack = subscribe(() => {
    const id = getState().playback?.id;
    if (id !== lastTrack) {
      lastTrack = id;
      bump();
    }
  });
  let active = true;
  const seen = new WeakSet<object>(),
    undo: (() => void)[] = [];
  const attach = (mod: any) => {
    const component = mod?.default ?? mod;
    const owner =
      typeof component?.type === 'function' || typeof component?.render === 'function' ? component : mod;
    const key =
      typeof component?.type === 'function'
        ? 'type'
        : typeof component?.render === 'function'
          ? 'render'
          : 'default';
    if (!owner || typeof owner[key] !== 'function' || seen.has(owner)) return;
    seen.add(owner);
    const original = owner[key];
    const wrapped = function (this: unknown, ...args: any[]) {
      const tree = Reflect.apply(original, this, args) as React.ReactNode;
      if (!active) return tree;
      return (
        <Guard original={tree}>
          <Dock original={tree} />
        </Guard>
      );
    };
    try {
      owner[key] = wrapped;
      undo.push(() => {
        if (owner[key] === wrapped) owner[key] = original;
      });
    } catch (error) {
      report(error);
    }
  };
  undo.push(getModules(filter('YouBarThemed'), attach, { returnNamespace: true }));
  return () => {
    active = false;
    offUi();
    offTrack();
    reportError = () => {};
    for (const fn of undo.reverse()) fn();
  };
}
