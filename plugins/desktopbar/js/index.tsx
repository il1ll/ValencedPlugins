import { getAssetIdByName } from '@valenced/assets'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { RootNavigationRef } from '@valenced/discord/modules/main_tabs_v2'
import { getModules, lookupModule } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withProps,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { useReRender } from '@valenced/utils/react'
import { Fragment, useEffect } from 'react'
import { View } from 'react-native'
import SettingsComponent from './settings'
import { DefaultSettings, listeners, normalize } from './shared'
import type { JsonStorage } from '@valenced/json-storage'
import type { Filter, FilterGenerator } from '@valenced/modules/finders/filters'
import type {
	ComponentProps,
	ComponentType,
	FC,
	MemoExoticComponent,
	ReactElement,
	ReactNode,
} from 'react'
import type { ButtonKey, Settings } from './shared'

const { IconButton } = Design

let storage: JsonStorage<Settings> | undefined

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage, plugin }) {
		if (plugin.startedLate) {
			plugin.requireReload()
			return
		}

		storage = jsonStorage

		cleanup(
			() => {
				listeners.clear()
				storage = undefined
			},
			getModules(
				withMemoizedComponentName('YouBarNotificationsButton'),
				YouBarNotificationsButton => {
					if (!YouBarNotificationsButton?.type) return
					cleanup(
						instead(YouBarNotificationsButton, 'type', renderYouBarButtons),
					)
				},
			),
		)
	},
	stop({ plugin }) {
		plugin.requireReload()
	},
	SettingsComponent,
})

function asset(name: string) {
	return getAssetIdByName(name)!
}

function mediaStore(): any {
	return (Stores as any).MediaEngineStore
}

function audioActions(): AudioActions | undefined {
	return lookupModule(
		withProps<AudioActions>('toggleSelfMute', 'toggleSelfDeaf'),
	)[0]
}

function voiceState() {
	const store = mediaStore()
	const deafened = !!store?.isSelfDeaf?.()
	const muted = deafened || !!store?.isSelfMute?.()
	return { muted, deafened }
}

function useVoiceState() {
	const rerender = useReRender()

	useEffect(() => {
		const store = mediaStore()
		store?.addChangeListener?.(rerender)
		return () => {
			store?.removeChangeListener?.(rerender)
		}
	}, [rerender])

	return voiceState()
}

function renderYouBarButtons(args: Parameters<FC>, orig: FC) {
	const rerender = useReRender()

	useEffect(() => {
		listeners.add(rerender)
		return () => {
			listeners.delete(rerender)
		}
	}, [rerender])

	const { muted, deafened } = useVoiceState()
	const settings = normalize(storage?.cache)

	const res = orig(...args) as YouBarButtonElement
	if (!res?.props?.children) return res

	const Container = res.type
	const original = res.props.children.props
	const size = original.size ?? 'sm'
	const idle = original.variant ?? 'tertiary'

	const button = (key: Exclude<ButtonKey, 'notifications'>) => {
		switch (key) {
			case 'mute':
				return (
					<Container key="desktopbar-mute">
						<IconButton
							accessibilityLabel={muted ? 'Unmute' : 'Mute'}
							variant={muted ? 'destructive' : idle}
							size={size}
							icon={asset(muted ? 'MicrophoneSlashIcon' : 'MicrophoneIcon')}
							onPress={() => audioActions()?.toggleSelfMute({})}
						/>
					</Container>
				)
			case 'deafen':
				return (
					<Container key="desktopbar-deafen">
						<View
							style={deafened ? { transform: [{ scaleX: -1 }] } : undefined}
						>
							<IconButton
								accessibilityLabel={deafened ? 'Undeafen' : 'Deafen'}
								variant={deafened ? 'destructive' : idle}
								size={size}
								icon={asset(
									deafened ? 'HeadphonesSlashIcon' : 'HeadphonesIcon',
								)}
								onPress={() => audioActions()?.toggleSelfDeaf({})}
							/>
						</View>
					</Container>
				)
			case 'settings':
				return (
					<Container key="desktopbar-settings">
						<IconButton
							accessibilityLabel="User Settings"
							variant={idle}
							size={size}
							icon={asset('SettingsIcon')}
							onPress={() =>
								RootNavigationRef.getRootNavigationRef()?.navigate('settings')
							}
						/>
					</Container>
				)
		}
	}

	return (
		<>
			{[...settings.order]
				.reverse()
				.filter(key => !settings.hidden.includes(key))
				.map(key =>
					key === 'notifications' ? (
						<Fragment key="desktopbar-notifications">{res}</Fragment>
					) : (
						button(key)
					),
				)}
		</>
	)
}

type WithMemoizedComponentName = FilterGenerator<
	<P = object>(
		name: string,
	) => Filter<{
		Result: MemoExoticComponent<FC<P>>
		Scopes: [typeof FilterScopes.Initialized]
	}>
>

const withMemoizedComponentName = createFilterGenerator(
	([name], _, exports) => exports?.type?.name === name,
	([name]) => `memoizedComponentName(${name})`,
	FilterScopes.Initialized,
) as WithMemoizedComponentName

type IconButtonProps = ComponentProps<typeof IconButton>

type YouBarButtonElement = ReactElement<
	{
		children?: ReactElement<IconButtonProps>
	},
	ComponentType<{ children?: ReactNode }>
>

interface AudioActions {
	toggleSelfMute(options?: object): void
	toggleSelfDeaf(options?: object): void
}
