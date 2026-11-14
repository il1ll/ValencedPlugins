import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { callNativeMethod } from '@valenced/modules/native'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ScrollView, View } from 'react-native'
import type { JsonStorage } from '@valenced/json-storage'

interface BlurSettings {
	enabled: boolean
	strength: number
}

const defaults: BlurSettings = { enabled: true, strength: 45 }

let storage: JsonStorage<BlurSettings> | undefined

const read = (): BlurSettings => ({
	enabled: storage?.cache?.enabled ?? defaults.enabled,
	strength: storage?.cache?.strength ?? defaults.strength,
})

let snapshot = read()
const listeners = new Set<() => void>()

function publish() {
	snapshot = read()
	for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

function sendConfig() {
	const { enabled, strength } = read()
	callNativeMethod('com.coder.motionblur.configure', [enabled, strength]).catch(
		() => {},
	)
}

function update(patch: Partial<BlurSettings>) {
	if (!storage) return
	void storage.set(patch).then(() => {
		publish()
		sendConfig()
	})
}

function StrengthRow({ value }: { value: number }) {
	const [dragging, setDragging] = useState<number | null>(null)
	const shown = Math.round(dragging ?? value)
	const { Text, Slider } = Design

	return (
		<View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }}>
			<View
				style={{
					flexDirection: 'row',
					justifyContent: 'space-between',
					alignItems: 'center',
				}}
			>
				<Text variant="text-md/semibold" color="text-default">
					Blur Strength
				</Text>
				<Text variant="text-md/normal" color="text-muted">
					{`${shown}%`}
				</Text>
			</View>
			<Slider
				value={value}
				minimumValue={0}
				maximumValue={100}
				step={1}
				onValueChange={(next: number) => setDragging(next)}
				onSlidingComplete={(next: number) => {
					setDragging(null)
					update({ strength: Math.round(next) })
				}}
			/>
		</View>
	)
}

function SettingsPage() {
	const { TableRowGroup, TableRow, TableSwitchRow } = Design
	const settings = useSyncExternalStore(subscribe, () => snapshot)
	const [supported, setSupported] = useState<boolean | null>(null)

	useEffect(() => {
		callNativeMethod('com.coder.motionblur.isSupported', [])
			.then(value => setSupported(value === true))
			.catch(() => setSupported(false))
	}, [])

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				{supported === false && (
					<TableRowGroup title="Not Supported">
						<TableRow
							label="Android 12 or newer is required"
							subLabel="Motion blur is turned off on this device."
							icon={<TableRowAssetIcon name="CircleErrorIcon" />}
						/>
					</TableRowGroup>
				)}
				<TableRowGroup
					title="Motion Blur"
					description="Blur follows your scroll speed and fades out smoothly after you stop. Scrolling and gestures work as usual."
				>
					<TableSwitchRow
						label="Enable Blur"
						icon={<TableRowAssetIcon name="SparklesIcon" />}
						value={settings.enabled}
						onValueChange={(value: boolean) => update({ enabled: value })}
					/>
				</TableRowGroup>
				<TableRowGroup title="Strength">
					<StrengthRow value={settings.strength} />
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}

declare module '@valenced/modules/native' {
	export interface NativeMethods {
		'com.coder.motionblur.configure': [
			args: [enabled: boolean, strength: number],
			returnValue: boolean,
		]
		'com.coder.motionblur.isSupported': [args: [], returnValue: boolean]
	}
}

export default plugin<{ jsonStorage: BlurSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	start({ cleanup, jsonStorage }) {
		storage = jsonStorage
		publish()
		sendConfig()
		cleanup(
			jsonStorage.subscribe(() => {
				publish()
				sendConfig()
			}),
		)
		cleanup(() => {
			storage = undefined
		})
	},
	SettingsComponent: SettingsPage,
})
