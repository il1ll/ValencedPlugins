import React, { useMemo, useRef, useSyncExternalStore } from 'react';
import { Animated, Image, Pressable, Text, View } from 'react-native';
import { Design } from '@valenced/discord/design';
import { Tokens } from '@valenced/discord/common/tokens';
import { getAssetIdByName } from '@valenced/assets';
import { getModules, lookupModule } from '@valenced/modules/finders';
import { createFilterGenerator, FilterScopes } from '@valenced/modules/finders/filters';

const MotionView = Animated.View;

export type Glyph =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'shuffle'
  | 'repeat'
  | 'repeatOne'
  | 'up'
  | 'down'
  | 'fullscreen'
  | 'close';

const ASSETS: Record<Glyph, string[]> = {
  play: ['PlayIcon', 'ic_play'],
  pause: ['PauseIcon', 'ic_pause'],
  next: ['SkipForwardIcon', 'MediaNextIcon', 'NextIcon', 'ForwardIcon'],
  previous: ['SkipBackIcon', 'SkipBackwardIcon', 'MediaPreviousIcon', 'PreviousIcon', 'BackwardIcon'],
  shuffle: ['ShuffleIcon'],
  repeat: ['RepeatIcon', 'LoopIcon'],
  repeatOne: ['RepeatOneIcon', 'LoopOneIcon'],
  up: ['ChevronSmallUpIcon', 'ChevronLargeUpIcon', 'ic_chevron_up_24px'],
  fullscreen: ['MaximizeIcon', 'FullscreenEnterIcon', 'ArrowsMaximizeIcon'],
  close: ['XSmallIcon', 'XLargeIcon', 'CloseIcon', 'XIcon'],
  down: ['ChevronSmallDownIcon', 'ChevronLargeDownIcon', 'ic_chevron_down_24px'],
};
const PATHS: Record<Glyph, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  previous: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  shuffle:
    'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  repeatOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
  up: 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z',
  down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  fullscreen: 'M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z',
  close:
    'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};
const TEXT: Record<Glyph, string> = {
  play: '\u25B6\uFE0E',
  pause: '\u2759\u2759',
  next: '\u25B6\uFE0E|',
  previous: '|\u25C0\uFE0E',
  shuffle: '\u21C4\uFE0E',
  repeat: '\u21BB\uFE0E',
  repeatOne: '\u21BB\uFE0E',
  up: '\u25B4\uFE0E',
  down: '\u25BE\uFE0E',
  fullscreen: '\u2922\uFE0E',
  close: '\u2715\uFE0E',
};

let svgModule: any = null;
const svgListeners = new Set<() => void>();
const subscribeSvg = (fn: () => void) => {
  svgListeners.add(fn);
  return () => {
    svgListeners.delete(fn);
  };
};
const isComponent = (value: any) =>
  typeof value === 'function' || (!!value && typeof value === 'object' && typeof value.$$typeof === 'symbol');
function normalize(mod: any) {
  for (const candidate of [mod, mod?.default]) {
    if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) continue;
    let own: (key: string) => boolean;
    try {
      const keys = new Set(Object.getOwnPropertyNames(candidate));
      own = (key) => keys.has(key);
    } catch {
      continue;
    }
    if (!['Path', 'G', 'Circle', 'Rect'].every(own)) continue;
    const Svg = own('Svg') ? candidate.Svg : own('default') ? candidate.default : null;
    const { Path, G, Circle, Rect } = candidate;
    if (isComponent(Svg) && isComponent(Path) && isComponent(G) && isComponent(Circle) && isComponent(Rect))
      return { Svg, Path };
  }
  return null;
}
const svgFilter = createFilterGenerator<[]>(
  (_args, _id, exports: any) => !!normalize(exports),
  () => 'dariuss.spotify.svg.v5',
  FilterScopes.Initialized,
)();
let lastAttempt = 0;
export function svg() {
  if (!svgModule && Date.now() - lastAttempt > 2000) {
    lastAttempt = Date.now();
    try {
      svgModule = normalize((lookupModule(svgFilter, { returnNamespace: true, cached: false }) as any)[0]);
    } catch {
      svgModule = null;
    }
  }
  return svgModule;
}
export function watchSvg() {
  lastAttempt = 0;
  return getModules(
    svgFilter,
    (mod: any) => {
      const next = normalize(mod);
      if (svgModule || !next) return;
      svgModule = next;
      for (const fn of [...svgListeners]) fn();
    },
    { returnNamespace: true },
  );
}
export class SafeVector extends React.Component<
  { fallback: React.ReactNode; children?: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    svgModule = null;
    lastAttempt = Date.now() + 60_000;
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export const useSvg = () => useSyncExternalStore(subscribeSvg, svg);
const SIMILAR: Record<Glyph, string[]> = {
  play: [],
  pause: [],
  up: [],
  down: [],
  fullscreen: [],
  close: [],
  next: ['ArrowSmallRightIcon', 'ArrowLargeRightIcon'],
  previous: ['ArrowSmallLeftIcon', 'ArrowLargeLeftIcon'],
  shuffle: ['ArrowsUpDownIcon'],
  repeat: ['RefreshIcon', 'RetryIcon'],
  repeatOne: ['RetryIcon', 'RefreshIcon'],
};
const assetCache = new Map<Glyph, number | null>();
function assetFor(glyph: Glyph, names = ASSETS[glyph]) {
  const known = names === ASSETS[glyph] ? assetCache.get(glyph) : null;
  if (known) return known;
  let found: number | null = null;
  for (const name of names) {
    try {
      const id = getAssetIdByName(name);
      if (id) {
        found = id as number;
        break;
      }
    } catch {}
  }
  if (found && names === ASSETS[glyph]) assetCache.set(glyph, found);
  return found;
}
const IMAGES: Partial<Record<Glyph, string>> = {
  shuffle:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAABmJLR0QA/wD/AP+gvaeTAAACGElEQVR4nO2bTU7DMBBGLSEo9BCox6nElWDHXVjxX/qnchTEMVg+FJpKBdrYiRNn3H5vX2fyMjNxbNc5IYQQQgghhBBZAYyBR+A80fUugQ8iSBHntpyv8rqzXCT1IYecJPUlJxtJKQK798TwBgw6D2Qdywj4tCboDHj2xDG3mkkuUVAD4NUTyzRFJhUPAliZEmQlk8oHNQmVk1RQDUmLLiQ1kZNcUE1JFy5tidsQVCPgVqYAZc8pSreK931vt9jrx2bSU5eZFPggfq6x7+3W7l0bklRHztZv/klyfUMHkprI2SfJWYAWJZVjNZKzS5KzAmFP/TagIRfNPXqutfkscZagWlIx+x2mkLM15shZg93ltvSURHRZZQW/Jfn6xXHJ+XPjN1UlEVhWydacTEF45kjOHiSnAsmxsDqZY8+ZH7OcF8nZgeRUIDn+77Jip6OKqWciOSw+cA+uL9FCzynlrEK+5Y5dDgcjiXVZFVvRjTcYSznFInz0BNLUcgctyCnHufaMschuwYwW5znACXDnGWuZzZIrYXJqLVnESDK1aE8HcmIkmdr2IWwLOmqxq44kUxuHhB0kaOVgFXAKPGSz9UyCzGmYSTtpKwazcmpmUn+C6FFOjKSuYmnScyaJjuCd1jlIdRSZY/oQJ/5jwEkyx/Ix4LEOkjeTNLNaVkkzaIP+zBIAcFX2JLM9p7cMEkIIIYQQQgjhmvINMunFw4BsfqEAAAAASUVORK5CYII=',
  repeat:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAABmJLR0QA/wD/AP+gvaeTAAABRUlEQVR4nO3awW7CMAyAYXsvzW7tbvDEHD1N06QNAXbo2jjx/19TlehTVZKACBERESXIzM6955A6+w4kBwikABBIASCQAkAgBYBACgCBFAB6CUllQ2ZmMl4XVX2PXvwm9Tq1PEkVgZqQqgJ9dZVAVYFWVf2IXFgRaI3ibM4edMiHN8znV0uKCUmnUuEMBrSkmpB0KhXOIED9cAYA6ouTHKg/TmKgHDhJgdb/vucuxx2quum+maq41WgKICIiommbZkG318KVdZATQEcD2Q4bxmkyszXBcUea04W7OAA5OAA5OAA5OAA5OADJc5zyQObgzAakLywCFxmsQ/ZiNijO1kJAVhSn5Qm6StFCQKp6EZHwf4tnKvwO0sJITZnZKevX/DBIQvIUCR8H6Wec5D4SMA7S7TjJXyRAHKRH4yT87ENERCRp+gThmnkBD5qlkAAAAABJRU5ErkJggg==',
  repeatOne:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAABmJLR0QA/wD/AP+gvaeTAAABfElEQVR4nO3aQU7DMBCF4RnEsZA4Vrtr2NEzseFWXT6EKiRATWdcO/HY8/5tItf6ZMV1WhHGGGOMBQjAe+85hA7XiGQAEckBRCQHEJEcQERyABHJAUQkB9BDSCoVAYCM11lVj96bnyRfh5KVlBGoCCkr0HcXcZQVaFHVN8+NGYEWL051WGmXDy+Yz69OISYknQqFMxjQKdSEpFOhcAYB6oczAFBfnNZAAF4AfNSMEwqnFdAtmEqgGDi1QABeAXyujfEg0CKN2+R1h6qa43oAPONsXcajRlEEGiUAS4vdsHVcQUYEMiKQEYGMCGT0LBOFii+ua3EFGRFobyBscGCcBghXnDivGyIBYUKczc5R0m8eTd4rTXvIRDQg3MAhkIFDILmPkx4IBs5sQJphK9c9zmIYFKc2FxCS4pSsoIskzQWkqmcRcf+3eKbczyBNjFQUgEPUbX4YJGFyF4k+BtLPdSa3kQhjIP2/zuQvEkEMpLXrTOb72YcxxhiTYfsCBlqmWCyz5LkAAAAASUVORK5CYII=',
};
type Drawn = 'fullscreen' | 'close' | 'next' | 'previous' | 'shuffle' | 'repeat' | 'repeatOne';
const DRAWN: Glyph[] = ['fullscreen', 'close', 'next', 'previous', 'shuffle', 'repeat', 'repeatOne'];
function DrawnGlyph({ glyph, size, color }: { glyph: Drawn; size: number; color: string }) {
  const u = size / 24,
    stroke = Math.max(1.5, 2 * u);
  const box = { width: size, height: size } as const;
  const at = (left: number, top: number, extra: object) => ({
    position: 'absolute' as const,
    left: left * u,
    top: top * u,
    ...extra,
  });
  const triangle = (left: number, top: number, w: number, h: number, right: boolean) => (
    <View
      style={at(left, top, {
        width: 0,
        height: 0,
        borderTopWidth: (h * u) / 2,
        borderBottomWidth: (h * u) / 2,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        ...(right
          ? { borderLeftWidth: w * u, borderLeftColor: color }
          : { borderRightWidth: w * u, borderRightColor: color }),
      })}
    />
  );
  const bar = (left: number, top: number, w: number, h: number, rotate = 0) => (
    <View
      style={at(left, top, {
        width: w * u,
        height: h * u,
        borderRadius: (Math.min(w, h) * u) / 2,
        backgroundColor: color,
        transform: rotate ? [{ rotate: rotate + 'deg' }] : [],
      })}
    />
  );
  switch (glyph) {
    case 'next':
      return (
        <View style={box}>
          {triangle(6, 6, 8.5, 12, true)}
          {bar(15.5, 6, 2.5, 12)}
        </View>
      );
    case 'previous':
      return (
        <View style={box}>
          {bar(6, 6, 2.5, 12)}
          {triangle(9.5, 6, 8.5, 12, false)}
        </View>
      );
    case 'shuffle':
      return (
        <View style={box}>
          {bar(3.5, 11, 15, 2, 33)}
          {bar(3.5, 11, 15, 2, -33)}
          {triangle(16.5, 4.9, 4.5, 6, true)}
          {triangle(16.5, 13.1, 4.5, 6, true)}
        </View>
      );
    case 'repeat':
    case 'repeatOne':
      return (
        <View style={box}>
          <View
            style={at(4, 6.5, {
              width: 16 * u,
              height: 11 * u,
              borderRadius: 3.5 * u,
              borderWidth: stroke,
              borderColor: color,
            })}
          />
          {triangle(13, 4, 4, 5, true)}
          {glyph === 'repeatOne' ? (
            <Text
              style={at(9, 7.5, {
                width: 6 * u,
                fontSize: 7.5 * u,
                lineHeight: 9 * u,
                fontWeight: '700',
                textAlign: 'center',
                color,
                includeFontPadding: false,
              })}
            >
              1
            </Text>
          ) : null}
        </View>
      );
    case 'close': {
      const line = {
        position: 'absolute' as const,
        left: size * 0.15,
        top: size / 2 - stroke / 2,
        width: size * 0.7,
        height: stroke,
        borderRadius: stroke / 2,
        backgroundColor: color,
      };
      return (
        <View style={box}>
          <View style={[line, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[line, { transform: [{ rotate: '-45deg' }] }]} />
        </View>
      );
    }
    default: {
      const arm = size * 0.34,
        edge = size * 0.12,
        width = Math.max(2, size / 11);
      const corner = (top: boolean) => ({
        position: 'absolute' as const,
        width: arm,
        height: arm,
        borderColor: color,
        ...(top
          ? { top: edge, right: edge, borderTopWidth: width, borderRightWidth: width }
          : { bottom: edge, left: edge, borderBottomWidth: width, borderLeftWidth: width }),
      });
      const diagonal = {
        position: 'absolute' as const,
        left: size * 0.22,
        top: size / 2 - width / 2,
        width: size * 0.56,
        height: width,
        borderRadius: width / 2,
        backgroundColor: color,
        transform: [{ rotate: '-45deg' }],
      };
      return (
        <View style={box}>
          <View style={corner(true)} />
          <View style={corner(false)} />
          <View style={diagonal} />
        </View>
      );
    }
  }
}
export function Icon({ glyph, size = 24, color }: { glyph: Glyph; size?: number; color: string }) {
  const vector = useSvg();
  const asset = assetFor(glyph);
  if (asset)
    return (
      <Image source={asset} resizeMode="contain" style={{ width: size, height: size, tintColor: color }} />
    );
  const image = IMAGES[glyph];
  const similar = image || DRAWN.includes(glyph) ? null : assetFor(glyph, SIMILAR[glyph]);
  const fallback = image ? (
    <Image
      source={{ uri: image }}
      resizeMode="contain"
      style={{ width: size, height: size, tintColor: color }}
    />
  ) : DRAWN.includes(glyph) ? (
    <DrawnGlyph glyph={glyph as Drawn} size={size} color={color} />
  ) : similar ? (
    <Image source={similar} resizeMode="contain" style={{ width: size, height: size, tintColor: color }} />
  ) : (
    <Design.Text variant="text-md/semibold" style={{ color, fontSize: size * 0.7, lineHeight: size }}>
      {TEXT[glyph]}
    </Design.Text>
  );
  if (vector?.Svg && vector?.Path)
    return (
      <SafeVector fallback={fallback}>
        {React.createElement(
          vector.Svg,
          { width: size, height: size, viewBox: '0 0 24 24' },
          React.createElement(vector.Path, { d: PATHS[glyph], fill: color }),
        )}
      </SafeVector>
    );
  return fallback;
}
type Look = { brand: string; onBrand: string; normal: string };
function useButtonLook(): Look {
  const context = (Design as any).useThemeContext();
  return useMemo(() => {
    const resolve = (names: string[], fallback: string) => {
      try {
        const { colors, internal } = Tokens.default;
        for (const name of names) {
          if (!colors[name]) continue;
          const value = internal.resolveSemanticColor(context.theme, colors[name]);
          if (typeof value === 'string' && value !== 'transparent') return value;
        }
      } catch {}
      return fallback;
    };
    const look = {
      brand: resolve(['BUTTON_FILLED_BRAND_BACKGROUND', 'CONTROL_BRAND_FOREGROUND', 'BRAND_500'], '#5865F2'),
      onBrand: resolve(['BUTTON_FILLED_BRAND_TEXT', 'WHITE'], '#FFFFFF'),
      normal: resolve(['INTERACTIVE_NORMAL', 'INTERACTIVE_TEXT_DEFAULT', 'TEXT_DEFAULT'], '#B5BAC1'),
    };
    return look;
  }, [context.theme]);
}
export function ControlButton({
  glyph,
  label,
  onPress,
  disabled,
  primary,
  size = 'md',
}: {
  glyph: Glyph;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  size?: 'sm' | 'md';
}) {
  const look = useButtonLook();
  const scale = useRef(new Animated.Value(1)).current;
  const asset = assetFor(glyph);
  if (asset) {
    const Button = Design.IconButton as any;
    return (
      <Button
        icon={asset}
        accessibilityLabel={label}
        accessibilityState={{ selected: !!primary }}
        size={size}
        variant={primary ? 'primary' : 'tertiary'}
        disabled={disabled}
        onPress={onPress}
      />
    );
  }
  const diameter = size === 'sm' ? 32 : 40;
  const spring = (toValue: number) =>
    Animated.spring(scale, { toValue, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!primary }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => spring(0.92)}
      onPressOut={() => spring(1)}
    >
      <MotionView
        style={{
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: primary ? look.brand : 'transparent',
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale }],
        }}
      >
        <Icon glyph={glyph} size={size === 'sm' ? 18 : 20} color={primary ? look.onBrand : look.normal} />
      </MotionView>
    </Pressable>
  );
}
