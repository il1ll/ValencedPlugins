import { getAssetIdByName } from '@valenced/assets'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getStore } from '@valenced/discord/flux'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { createElement, Fragment, useRef } from 'react'
import { Animated, Image, Pressable, Vibration } from 'react-native'
import type { JsonStorage } from '@valenced/json-storage'
import type { ComponentType, ReactElement, ReactNode } from 'react'

interface FakeSettings {
	fakeMute: boolean
	fakeDeafen: boolean
}

interface VoiceStatePayload {
	channel_id?: string | null
	self_mute?: boolean
	self_deaf?: boolean
	[key: string]: unknown
}

const VOICE_STATE_UPDATE = 4

const ACTIVE_BACKGROUND = '#361f22'
const ACTIVE_ICON = '#f23f43'
const IDLE_ICON = '#ffffff'

const defaults: FakeSettings = { fakeMute: false, fakeDeafen: false }

let storage: JsonStorage<FakeSettings> | undefined
let socket: any
let lastVoiceState: VoiceStatePayload | undefined
let sounds: { playSound?: (name: string) => unknown } | undefined

const settings = (): FakeSettings => ({ ...defaults, ...storage?.cache })

function applyFake(payload: VoiceStatePayload): VoiceStatePayload {
	const { fakeMute, fakeDeafen } = settings()
	if (!fakeMute && !fakeDeafen) return payload

	const faked = { ...payload }
	if (fakeDeafen) {
		faked.self_deaf = true
		faked.self_mute = true
	} else if (fakeMute) faked.self_mute = true
	return faked
}

function resendVoiceState() {
	if (!socket || !lastVoiceState?.channel_id) return
	try {
		socket.send(VOICE_STATE_UPDATE, { ...lastVoiceState })
	} catch {}
}

function playSound(name: string) {
	try {
		sounds?.playSound?.(name)
	} catch {}
}

async function setFake(key: keyof FakeSettings, value: boolean) {
	if (!storage) return

	const clearsBoth = key === 'fakeMute' && !value && settings().fakeDeafen
	const update: Partial<FakeSettings> = clearsBoth
		? { fakeMute: false, fakeDeafen: false }
		: { [key]: value }

	if (clearsBoth || key === 'fakeDeafen')
		playSound(value ? 'deafen' : 'undeafen')
	else playSound(value ? 'mute' : 'unmute')

	await storage.set(update)
	resendVoiceState()

	const label = clearsBoth
		? 'Fake mute & deafen'
		: key === 'fakeMute'
			? 'Fake mute'
			: 'Fake deafen'
	ToastActionCreators.open('FAKE_MUTE_DEAFEN', {
		text: `${label} ${value ? 'on' : 'off'}`,
		variant: value ? 'success' : 'critical',
	})
}

function ownerOf(target: any, key: string) {
	let current = target
	while (current && current !== Object.prototype) {
		if (Object.hasOwn(current, key)) return current
		current = Object.getPrototypeOf(current)
	}
}

function useFakeSettings(store: JsonStorage<FakeSettings>) {
	return { ...defaults, ...store.use() }
}

function PanelButton({
	active,
	icon,
	label,
	onPress,
}: {
	active: boolean
	icon: string
	label: string
	onPress: () => void
}) {
	const scale = useRef(new Animated.Value(1)).current

	const animate = (to: number) =>
		Animated.spring(scale, {
			toValue: to,
			useNativeDriver: true,
			speed: 40,
			bounciness: 6,
		}).start()

	return (
		<Pressable
			onPress={() => {
				Vibration.vibrate(10)
				onPress()
			}}
			onPressIn={() => animate(0.9)}
			onPressOut={() => animate(1)}
			accessibilityRole="switch"
			accessibilityLabel={label}
			accessibilityState={{ checked: active }}
		>
			<Animated.View
				style={{
					width: 48,
					height: 48,
					borderRadius: 12,
					alignItems: 'center',
					justifyContent: 'center',
					backgroundColor: active ? ACTIVE_BACKGROUND : 'transparent',
					transform: [{ scale }],
				}}
			>
				<Image
					source={getAssetIdByName(icon)}
					style={{
						width: 24,
						height: 24,
						tintColor: active ? ACTIVE_ICON : IDLE_ICON,
					}}
				/>
			</Animated.View>
		</Pressable>
	)
}

function PanelButtons({ store }: { store: JsonStorage<FakeSettings> }) {
	const s = useFakeSettings(store)
	const muted = s.fakeMute || s.fakeDeafen

	return (
		<>
			<PanelButton
				active={muted}
				icon={muted ? 'MicrophoneSlashIcon' : 'MicrophoneIcon'}
				label="Fake Mute"
				onPress={() => void setFake('fakeMute', !muted)}
			/>
			<PanelButton
				active={s.fakeDeafen}
				icon={s.fakeDeafen ? 'HeadphonesSlashIcon' : 'HeadphonesIcon'}
				label="Fake Deafen"
				onPress={() => void setFake('fakeDeafen', !s.fakeDeafen)}
			/>
		</>
	)
}

function SheetRows({
	store,
	Row,
}: {
	store: JsonStorage<FakeSettings>
	Row: ComponentType<any>
}) {
	const s = useFakeSettings(store)

	return (
		<>
			<Row
				label="Fake Mute"
				subLabel="Others see you muted, but you can still talk"
				icon={<TableRowAssetIcon name="MicrophoneSlashIcon" />}
				value={s.fakeMute || s.fakeDeafen}
				onValueChange={(value: boolean) => void setFake('fakeMute', value)}
			/>
			<Row
				label="Fake Deafen"
				subLabel="Others see you deafened, but you can still hear"
				icon={<TableRowAssetIcon name="HeadphonesSlashIcon" />}
				value={s.fakeDeafen}
				onValueChange={(value: boolean) => void setFake('fakeDeafen', value)}
			/>
		</>
	)
}

const isDeafenRow = (element: ReactElement<any>) =>
	typeof element?.props?.label === 'string' &&
	element.props.label.trim().toLowerCase() === 'deafen'

export default plugin<{ jsonStorage: FakeSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	start({ cleanup, jsonStorage, logger }) {
		storage = jsonStorage

		cleanup(() => {
			storage = undefined
			resendVoiceState()
			socket = undefined
			lastVoiceState = undefined
			sounds = undefined
		})

		cleanup(
			getModules(
				withProps<any>('createSound', 'createSoundForPack', 'playSound'),
				module => {
					sounds = module
				},
			),
		)

		cleanup(
			getStore<{ getSocket(): any }>('GatewayConnectionStore', store => {
				try {
					socket = store.getSocket()
					const owner = ownerOf(socket, 'send')
					if (!owner) {
						logger.error('Gateway socket has no send method')
						return
					}

					cleanup(
						before(owner, 'send', (args: any[]) => {
							const [op, payload] = args
							if (
								op !== VOICE_STATE_UPDATE ||
								!payload ||
								typeof payload !== 'object'
							)
								return args

							lastVoiceState = { ...payload }
							return [op, applyFake(payload), ...args.slice(2)]
						}),
					)
				} catch (e) {
					logger.error('Failed to patch the gateway socket', e)
				}
			}),
		)

		cleanup(
			getModuleWithImportedPath<Record<string, (...args: any[]) => ReactNode>>(
				'modules/voice_panel/native/controls/buttons/VoicePanelVideoButton.tsx',
				module => {
					cleanup(
						after(module, 'default', rendered => (
							<>
								{rendered}
								<PanelButtons store={jsonStorage} />
							</>
						)),
					)
				},
			),
		)

		const rowTypes = new Set(
			[Design.TableSwitchRow, Design.ActionSheetSwitchRow].filter(Boolean),
		)
		for (const Row of rowTypes)
			cleanup(
				afterJSX(Row as ComponentType<any>, element => {
					if (!isDeafenRow(element as ReactElement<any>)) return element
					return createElement(
						Fragment,
						{ key: (element as ReactElement).key ?? 'fake-mute-deafen' },
						element,
						createElement(SheetRows, {
							store: jsonStorage,
							Row: Row as ComponentType<any>,
						}),
					)
				}),
			)
	},
})
