import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Design } from '@valenced/discord/design';
import { startSpotify, getState, subscribe, reconnect } from './spotify';
import { startIntegration } from './integration';
import { Player } from './player';
import { watchSvg } from './icons';
import { getAssetIdByName } from '@valenced/assets';
import {
  bindUi,
  DEFAULT_LYRICS,
  DEFAULT_PREFERENCES,
  resetLyricsPrefs,
  setLyricsPref,
  setProgressStyle,
  type LyricsPrefs,
  type Preferences,
  type ProgressStyle,
} from './ui';

type Api = {
  jsonStorage: {
    cache: Partial<Preferences>;
    use: () => Partial<Preferences> | undefined;
    set: (patch: Partial<Preferences>) => unknown;
  };
};

function icon(...names: string[]) {
  for (const name of names) {
    try {
      const id = getAssetIdByName(name);
      if (id) return <Design.TableRow.Icon source={id} />;
    } catch {}
  }
  return undefined;
}

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  leading,
}: {
  label: string;
  hint?: string;
  leading?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? value;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {leading}
          <Design.Text variant="text-md/semibold" color="text-default">
            {label}
          </Design.Text>
        </View>
        <Design.Text variant="text-md/normal" color="text-muted">
          {format(shown)}
        </Design.Text>
      </View>
      <Design.Slider
        value={value}
        minimumValue={min}
        maximumValue={max}
        step={step}
        onValueChange={(next) => setDragging(next)}
        onSlidingComplete={(next) => {
          setDragging(null);
          onChange(Math.round(next / step) * step);
        }}
      />
      {hint ? (
        <Design.Text variant="text-xs/normal" color="text-muted">
          {hint}
        </Design.Text>
      ) : null}
    </View>
  );
}

function LyricsOptions({
  prefs,
  onChange,
  onReset,
}: {
  prefs: LyricsPrefs;
  onChange: <K extends keyof LyricsPrefs>(key: K, value: LyricsPrefs[K]) => void;
  onReset: () => void;
}) {
  const toggle = (
    key: { [K in keyof LyricsPrefs]: LyricsPrefs[K] extends boolean ? K : never }[keyof LyricsPrefs],
    label: string,
    subLabel: string,
    ...icons: string[]
  ) => (
    <Design.TableSwitchRow
      icon={icon(...icons)}
      label={label}
      subLabel={subLabel}
      value={prefs[key]}
      onValueChange={(value: boolean) => onChange(key, value)}
    />
  );
  return (
    <>
      <Design.TableRowGroup title="Fullscreen lyrics: motion">
        {toggle(
          'highAnimations',
          'Allow high animations',
          'Words float up as they are sung, and interlude dots bounce. Off keeps a lighter light sweep for slower phones.',
          'SparklesIcon',
          'MagicWandIcon',
        )}
        {toggle(
          'glow',
          'Glow',
          'The sung part of a word brightens to pure white at its peak, strongest on long notes.',
          'StarIcon',
          'SparklesIcon',
        )}
        {toggle(
          'animatedBackground',
          'Animated background',
          'The blurred album art slowly drifts and turns. Off keeps it still.',
          'ImageIcon',
          'ImagesIcon',
        )}
        {toggle(
          'fadeDistant',
          'Fade distant lines',
          'Lines further from the one being sung fade more.',
          'EyeIcon',
        )}
      </Design.TableRowGroup>
      <Design.TableRowGroup title="Fullscreen lyrics: controls">
        {toggle(
          'showControls',
          'Playback controls',
          'Previous, play/pause and next under the progress bar, and a progress bar you can tap or drag to seek.',
          'PlayIcon',
        )}
        {toggle(
          'tapToSeek',
          'Tap a line to jump to it',
          'Tapping a line of the lyrics moves the song to where it is sung.',
          'TextIcon',
          'ListBulletsIcon',
        )}
      </Design.TableRowGroup>
      <Design.TableRowGroup title="Fullscreen lyrics: appearance">
        <SliderRow
          label="Text size"
          value={prefs.textScale}
          min={0.7}
          max={1.5}
          step={0.05}
          format={(v) => Math.round(v * 100) + '%'}
          onChange={(v) => onChange('textScale', v)}
          leading={icon('LettersIcon', 'TextIcon')}
        />
        <SliderRow
          label="Background darkness"
          value={prefs.backgroundDim}
          min={0}
          max={0.7}
          step={0.02}
          format={(v) => Math.round(v * 100) + '%'}
          onChange={(v) => onChange('backgroundDim', v)}
          leading={icon('PaintbrushThinIcon', 'PaintPaletteIcon')}
          hint="Darker keeps white text readable on bright covers."
        />
        {toggle(
          'backgroundVocals',
          'Background vocals',
          'Show backing vocals under the line they are sung over.',
          'MicrophoneIcon',
        )}
        {toggle(
          'showInfo',
          'Song info',
          'Show the cover, title and progress above the lyrics.',
          'CircleInformationIcon',
        )}
        <Design.TableRow
          icon={icon('UndoIcon', 'RefreshIcon')}
          label="Reset lyrics options"
          subLabel="Back to the defaults. Your Spicy Lyrics key is kept."
          onPress={onReset}
          arrow
        />
      </Design.TableRowGroup>
    </>
  );
}

function PlayerOptions({
  style,
  onChange,
}: {
  style: ProgressStyle;
  onChange: (value: ProgressStyle) => void;
}) {
  return (
    <Design.TableRadioGroup
      title="Player progress bar"
      value={style}
      onChange={onChange}
    >
      <Design.TableRadioRow
        icon={icon('ListViewIcon', 'ListBulletsIcon')}
        label="Bar"
        subLabel="A plain bar with a round knob, like the fullscreen lyrics."
        value="bar"
      />
      <Design.TableRadioRow
        icon={icon('MusicIcon')}
        label="Wave"
        subLabel="The played part flows as a wave and settles flat on pause."
        value="wave"
      />
    </Design.TableRadioGroup>
  );
}

function mergeLyrics(partial: Partial<LyricsPrefs> | undefined): LyricsPrefs {
  const next: LyricsPrefs = { ...DEFAULT_LYRICS };
  if (!partial) return next;
  for (const key of Object.keys(DEFAULT_LYRICS) as (keyof LyricsPrefs)[]) {
    const value = partial[key];
    if (
      typeof value === typeof DEFAULT_LYRICS[key] &&
      (typeof value !== 'number' || Number.isFinite(value))
    ) {
      (next as any)[key] = value;
    }
  }
  return next;
}

function Settings({ api }: { api: Api }) {
  const state = useSyncExternalStore(subscribe, getState);
  const stored = api.jsonStorage.use() ?? {};

  const prefs: LyricsPrefs = mergeLyrics(stored.lyrics as Partial<LyricsPrefs> | undefined);
  const progressStyle: ProgressStyle = stored.progressStyle === 'wave' ? 'wave' : 'bar';

  const storedKey = typeof stored.lyricsKey === 'string' ? stored.lyricsKey : '';
  const [keyDraft, setKeyDraft] = useState<string>(storedKey);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setKeyDraft(storedKey);
  }, [storedKey]);

  const commitKey = () => {
    dirtyRef.current = false;
    const next = keyDraft.trim();
    if (next === storedKey) return;
    void api.jsonStorage.set({ lyricsKey: next });
  };

  const updateLyrics = <K extends keyof LyricsPrefs>(key: K, value: LyricsPrefs[K]) => {
    const next: LyricsPrefs = { ...prefs, [key]: value };
    setLyricsPref(key, value);
    void api.jsonStorage.set({ lyrics: next });
  };

  const resetLyrics = () => {
    resetLyricsPrefs();
    void api.jsonStorage.set({ lyrics: { ...DEFAULT_LYRICS } });
  };

  const updateProgressStyle = (value: ProgressStyle) => {
    setProgressStyle(value);
    void api.jsonStorage.set({ progressStyle: value });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 36, gap: 16 }}>
      <Design.TableRowGroup title="Spotify connection">
        <Design.TableRow
          icon={state.connected ? icon('CircleCheckIcon') : icon('CircleInformationIcon')}
          label={state.connected ? 'Connected' : 'Connection status'}
          subLabel={state.status}
        />
        <Design.TableRow
          icon={icon('RefreshIcon', 'RetryIcon')}
          label="Reconnect"
          subLabel="Use the Spotify account already linked to Discord."
          onPress={() => {
            void reconnect();
          }}
          arrow
        />
      </Design.TableRowGroup>
      <Design.TableRowGroup title="Preview">
        <Player preview />
      </Design.TableRowGroup>
      <PlayerOptions style={progressStyle} onChange={updateProgressStyle} />
      <Design.TableRowGroup title="Lyrics">
        <Design.TableRow
          icon={icon('KeyIcon', 'LockIcon')}
          label="Spicy Lyrics key"
          subLabel={storedKey ? 'Saved' : 'Needed for fullscreen lyrics'}
        />
        <View style={{ padding: 12, gap: 8 }}>
          <Design.TextInput
            label="Spicy Lyrics key"
            value={keyDraft}
            onChange={(value: string) => {
              dirtyRef.current = true;
              setKeyDraft(value);
            }}
            onBlur={commitKey}
            onSubmitEditing={commitKey}
            placeholder="sl_sk_***"
            maxLength={200}
          />
          <Design.Text variant="text-xs/normal" color="text-muted">
            Fullscreen lyrics come from the Spicy Lyrics developer API and need your own key. Create an
            application at developers.spicylyrics.org and paste its key here. The key is stored in this
            plugin's settings and sent only to api.spicylyrics.org.
          </Design.Text>
        </View>
      </Design.TableRowGroup>
      <LyricsOptions prefs={prefs} onChange={updateLyrics} onReset={resetLyrics} />
    </ScrollView>
  );
}

export default plugin<{ jsonStorage: Preferences }>({
  jsonStorage: { load: true, default: DEFAULT_PREFERENCES },
  start(api) {
    const { cleanup, plugin: instance, jsonStorage } = api as unknown as {
      cleanup: (fn: () => void) => void;
      plugin: {
        reportError: (e: unknown) => void;
        startedLate: boolean;
        requireReload: () => void;
      };
      jsonStorage: Api['jsonStorage'];
    };

    cleanup(
      bindUi(
        jsonStorage.cache as (Partial<Preferences> & { collapsed?: boolean }) | undefined,
        (change) => {
          void jsonStorage.set(change);
        },
      ),
    );
    cleanup(watchSvg());
    cleanup(startSpotify());
    cleanup(startIntegration((error) => instance.reportError(error)));
    if (instance.startedLate) instance.requireReload();
  },
  SettingsComponent: Settings,
});
