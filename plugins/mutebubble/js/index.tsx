import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { getStore } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { callNativeMethod } from '@valenced/modules/native'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { createElement, Fragment, useEffect, useState } from 'react'
import { AppState, ScrollView } from 'react-native'
import type { JsonStorage } from '@valenced/json-storage'
import type { ComponentType, ReactElement } from 'react'

interface ChangeStore {
	addChangeListener(listener: () => void): void
	removeChangeListener(listener: () => void): void
}

interface VoiceChannelStore extends ChangeStore {
	getVoiceChannelId(): string | null | undefined
}

interface MediaEngineStore extends ChangeStore {
	isSelfMute(): boolean
	isSelfDeaf(): boolean
}

interface BubbleSettings {
	enabled: boolean
}

const defaults: BubbleSettings = { enabled: true }

let running = false
let storage: JsonStorage<BubbleSettings> | undefined

const bubbleEnabled = () => storage?.cache?.enabled ?? defaults.enabled
let voiceStore: VoiceChannelStore | undefined
let mediaStore: MediaEngineStore | undefined
let lastState = ''

function toggleMute() {
	const [AudioActions] = lookupModule(withProps<any>('toggleSelfMute'))
	if (!AudioActions) return
	try {
		AudioActions.toggleSelfMute()
	} catch {
		AudioActions.toggleSelfMute({ context: 'default' })
	}
}

function sendState() {
	if (!running) return
	const inCall = !!voiceStore?.getVoiceChannelId()
	const muted = !!(mediaStore?.isSelfMute() || mediaStore?.isSelfDeaf())
	const enabled = bubbleEnabled()
	const key = `${inCall}:${muted}:${enabled}`
	if (key === lastState) return
	lastState = key
	callNativeMethod('com.coder.mutebubble.setState', [
		inCall,
		muted,
		enabled,
	]).catch(() => {
		lastState = ''
	})
}

async function listenForTaps() {
	while (running) {
		let action: string | null = 'none'
		try {
			action = await callNativeMethod('com.coder.mutebubble.nextAction', [])
		} catch {
			await new Promise(resolve => setTimeout(resolve, 2000))
			continue
		}
		if (!running || action === 'stop') return
		if (action === 'toggleMute') {
			toggleMute()
			lastState = ''
			setTimeout(sendState, 300)
		}
	}
}

function EnableBubbleRow({
	store,
	Row,
}: {
	store: JsonStorage<BubbleSettings>
	Row: ComponentType<any>
}) {
	const enabled = store.use()?.enabled ?? defaults.enabled

	return (
		<Row
			label="Enable Bubble"
			subLabel="Show a floating mute button when you leave Discord during a call"
			icon={<TableRowAssetIcon name="MicrophoneIcon" />}
			value={enabled}
			onValueChange={(value: boolean) => {
				void store.set({ enabled: value }).then(sendState)
			}}
		/>
	)
}

const isAudioOutputRow = (element: ReactElement<any>) =>
	typeof element?.props?.label === 'string' &&
	element.props.label.trim().toLowerCase() === 'change audio output'

function SettingsPage() {
	const { TableRowGroup, TableRow } = Design
	const [allowed, setAllowed] = useState<boolean | null>(null)

	const check = () =>
		callNativeMethod('com.coder.mutebubble.canDrawOverlays', [])
			.then(value => setAllowed(value === true))
			.catch(() => setAllowed(false))

	useEffect(() => {
		check()
		const subscription = AppState.addEventListener('change', state => {
			if (state === 'active') check()
		})
		return () => subscription.remove()
	}, [])

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				{storage && (
					<TableRowGroup title="Bubble">
						<EnableBubbleRow store={storage} Row={Design.TableSwitchRow} />
					</TableRowGroup>
				)}
				<TableRowGroup
					title="Display Over Other Apps"
					description="The mute bubble needs this permission to float over other apps."
				>
					<TableRow
						label={
							allowed === null
								? 'Checking...'
								: allowed
									? 'Permission allowed'
									: 'Permission not allowed'
						}
						subLabel={
							allowed
								? 'The bubble will show when you leave Discord during a call.'
								: 'Tap below to allow Discord to display over other apps.'
						}
						icon={
							<TableRowAssetIcon
								name={allowed ? 'CircleCheckIcon' : 'CircleErrorIcon'}
							/>
						}
					/>
					<TableRow
						label="Open Permission Settings"
						arrow
						onPress={() =>
							void callNativeMethod(
								'com.coder.mutebubble.openOverlaySettings',
								[],
							).catch(() => {})
						}
					/>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}

declare module '@valenced/modules/native' {
	export interface NativeMethods {
		'com.coder.mutebubble.setState': [
			args: [inCall: boolean, muted: boolean, enabled: boolean],
			returnValue: boolean,
		]
		'com.coder.mutebubble.nextAction': [args: [], returnValue: string]
		'com.coder.mutebubble.canDrawOverlays': [args: [], returnValue: boolean]
		'com.coder.mutebubble.openOverlaySettings': [args: [], returnValue: boolean]
	}
}

export default plugin<{ jsonStorage: BubbleSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	start({ cleanup, jsonStorage }) {
		running = true
		lastState = ''
		storage = jsonStorage
		cleanup(jsonStorage.subscribe(() => sendState()))

		const SwitchRow = Design.TableSwitchRow as ComponentType<any>
		const rowTypes = new Set(
			[Design.TableRow, Design.ActionSheetRow].filter(Boolean),
		)
		for (const Row of rowTypes)
			cleanup(
				afterJSX(Row as ComponentType<any>, element => {
					if (!isAudioOutputRow(element as ReactElement<any>)) return element
					return createElement(
						Fragment,
						{ key: (element as ReactElement).key ?? 'mute-bubble' },
						createElement(EnableBubbleRow, {
							store: jsonStorage,
							Row: SwitchRow,
						}),
						element,
					)
				}),
			)

		cleanup(
			getStore<VoiceChannelStore>('SelectedVoiceChannelStore', store => {
				voiceStore = store
				store.addChangeListener(sendState)
				cleanup(() => store.removeChangeListener(sendState))
				sendState()
			}),
			getStore<MediaEngineStore>('MediaEngineStore', store => {
				mediaStore = store
				store.addChangeListener(sendState)
				cleanup(() => store.removeChangeListener(sendState))
				sendState()
			}),
		)

		void listenForTaps()

		cleanup(() => {
			running = false
			voiceStore = undefined
			mediaStore = undefined
			storage = undefined
			callNativeMethod('com.coder.mutebubble.setState', [
				false,
				false,
				false,
			]).catch(() => {})
		})
	},
	SettingsComponent: SettingsPage,
})
