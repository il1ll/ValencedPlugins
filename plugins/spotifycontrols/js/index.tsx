import React, { useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { Design } from '@valenced/discord/design';
import { startSpotify, getState, subscribe, reconnect } from './spotify';
import { startIntegration } from './integration';
import { Player } from './player';
import { watchSvg } from './icons';
import { getAssetIdByName } from '@valenced/assets';
import {
  bindUi,
  DEFAULT_PREFERENCES,
  getLyricsKey,
  getLyricsPrefs,
  getProgressStyle,
  resetLyricsPrefs,
  setLyricsKey,
  setLyricsPref,
  setProgressStyle,
  subscribeUi,
  type LyricsPrefs,
  type Preferences,
  type ProgressStyle,
} from './ui';

let keyStore: { set: (patch: Partial<Preferences>) => unknown } | null = null;

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
function LyricsOptions() {
  const prefs = useSyncExternalStore(subscribeUi, getLyricsPrefs);
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
      onValueChange={(value: boolean) => setLyricsPref(key, value)}
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
          onChange={(v) => setLyricsPref('textScale', v)}
          leading={icon('LettersIcon', 'TextIcon')}
        />
        <SliderRow
          label="Background darkness"
          value={prefs.backgroundDim}
          min={0}
          max={0.7}
          step={0.02}
          format={(v) => Math.round(v * 100) + '%'}
          onChange={(v) => setLyricsPref('backgroundDim', v)}
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
          onPress={resetLyricsPrefs}
          arrow
        />
      </Design.TableRowGroup>
    </>
  );
}
function PlayerOptions() {
  const style = useSyncExternalStore(subscribeUi, getProgressStyle);
  return (
    <Design.TableRadioGroup
      title="Player progress bar"
      value={style}
      onChange={(value: ProgressStyle) => setProgressStyle(value)}
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
function Settings() {
  const state = useSyncExternalStore(subscribe, getState);
  const lyricsKey = useSyncExternalStore(subscribeUi, getLyricsKey);
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
      <PlayerOptions />
      <Design.TableRowGroup title="Lyrics">
        <Design.TableRow
          icon={icon('KeyIcon', 'LockIcon')}
          label="Spicy Lyrics key"
          subLabel={lyricsKey ? 'Saved' : 'Needed for fullscreen lyrics'}
        />
        <View style={{ padding: 12, gap: 8 }}>
          <Design.TextInput
            label="Spicy Lyrics key"
            value={lyricsKey}
            onChange={(value: string) => {
              const next = value.trim();
              setLyricsKey(next);
              try {
                void keyStore?.set({ lyricsKey: next } as Partial<Preferences>);
              } catch {}
            }}
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
      <LyricsOptions />
    </ScrollView>
  );
}
export default plugin<{ jsonStorage: Preferences }>({
  jsonStorage: { load: true, default: DEFAULT_PREFERENCES },
  start({ cleanup, plugin: instance, jsonStorage }) {
    keyStore = jsonStorage as unknown as { set: (patch: Partial<Preferences>) => unknown };
    cleanup(
      bindUi(jsonStorage.cache as (Partial<Preferences> & { collapsed?: boolean }) | undefined, (change) => {
        void jsonStorage.set(change);
      }),
    );
    cleanup(watchSvg());
    cleanup(startSpotify());
    cleanup(startIntegration((error) => instance.reportError(error)));
    cleanup(() => {
      keyStore = null;
    });
    if (instance.startedLate) instance.requireReload();
  },
  SettingsComponent: Settings,
});
