import { getAssetIdByName } from '@valenced/assets'
import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Dispatcher } from '@valenced/discord/common/flux'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { onAnyFluxEventDispatched, Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { Image, ScrollView, TouchableOpacity } from 'react-native'
import {
	convertTimestamp,
	formatDateTime,
	formatTime,
	snowflakeTime,
} from './dates'
import { isDevice24Hour, pickDateTime } from './native'
import type { DiscordModules } from '@valenced/discord/types'
import type { JsonStorage } from '@valenced/json-storage'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps, FC, ReactElement, ReactNode } from 'react'

interface Override {
	time: number
	channelId: string
	preview?: string
}

interface ChangeDateSettings {
	overrides: Record<string, Override>
}

interface MessageRecord {
	id: string
	channel_id: string
	content?: string
	timestamp?: unknown
}

type Element = ReactElement<{ children?: ReactNode }>

type LongPressMessageActionSheet = FC<{
	message: MessageRecord
	channel?: { id: string; guild_id?: string | null }
}>

const defaults: ChangeDateSettings = { overrides: {} }

const MESSAGE_ROW = 1
const UPDATE_CHANGE = 2

let storage: JsonStorage<ChangeDateSettings> | undefined

const overrides = (): Record<string, Override> =>
	storage?.cache?.overrides ?? defaults.overrides

let hour24Cache = false

const use24Hour = () => hour24Cache

const changed = new Set<string>()

const store = (name: string) => Stores[name] as any

const toast = (text: string, ok = true) =>
	ToastActionCreators.open('CHANGE_DATE', {
		text,
		variant: ok ? 'success' : 'critical',
	})

function withOverride<T extends MessageRecord>(message: T): T {
	const override = overrides()[message.id]
	if (!override) return message
	return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
		timestamp: convertTimestamp(message.timestamp, override.time),
	})
}

function timeText(timestamp: any, ms: number) {
	try {
		if (typeof timestamp?.format === 'function') {
			const text = timestamp.format('LT')
			if (typeof text === 'string' && text) return text
		}
	} catch {}
	return formatTime(ms, use24Hour())
}

function addTimeToRow(rowMessage: Record<string, unknown>, time: string) {
	for (const key of Object.keys(rowMessage)) {
		const value = rowMessage[key]
		if (typeof value !== 'string' || !value) continue
		if (!/timestamp/i.test(key) || /color|label|accessib/i.test(key)) continue
		if (value.includes(time) || /\d{1,2}[:.]\d{2}/.test(value)) continue
		rowMessage[key] = `${value} ${time}`
	}
}

function fixRawMessage(message: any) {
	if (!message || typeof message !== 'object' || typeof message.id !== 'string')
		return
	if (message.timestamp == null) return
	const override = overrides()[message.id]
	if (override)
		message.timestamp = convertTimestamp(message.timestamp, override.time)
}

function fixPayload(payload: any) {
	if (!payload || typeof payload !== 'object') return payload
	if (!Object.keys(overrides()).length) return payload

	try {
		fixRawMessage(payload.message)
		if (Array.isArray(payload.messages))
			for (const message of payload.messages.flat()) fixRawMessage(message)
	} catch {}

	return payload
}

function refreshMessage(channelId: string, id: string) {
	const override = overrides()[id]
	const time = override?.time ?? snowflakeTime(id)

	try {
		const record = store('MessageStore')?.getMessage?.(channelId, id)
		if (record) record.timestamp = convertTimestamp(record.timestamp, time)
	} catch {}

	changed.add(id)
	Dispatcher.dispatch({
		type: 'MESSAGE_UPDATE',
		guildId: store('ChannelStore')?.getChannel?.(channelId)?.guild_id,
		message: { id, channel_id: channelId },
	})
}

async function setOverride(message: MessageRecord, time: number) {
	if (!storage) return
	await storage.set({
		overrides: {
			[message.id]: {
				time,
				channelId: message.channel_id,
				preview: (message.content ?? '').slice(0, 80),
			},
		},
	})
	refreshMessage(message.channel_id, message.id)
}

async function removeOverrides(ids: string[]) {
	if (!storage) return
	const current = { ...overrides() }
	const removed = ids
		.map(id => [id, current[id]] as const)
		.filter(([, override]) => override)

	for (const [id] of removed) delete current[id]
	await storage.set({ ...defaults, ...storage.cache, overrides: current }, true)

	for (const [id, override] of removed) refreshMessage(override!.channelId, id)
}

async function changeDate(message: MessageRecord) {
	const existing = overrides()[message.id]
	const current = existing?.time ?? snowflakeTime(message.id)

	let time: number | undefined
	try {
		time = await pickDateTime(current)
	} catch {
		toast(
			'Could not open the date picker. Restart Discord and try again.',
			false,
		)
		return
	}
	if (time === undefined) return

	try {
		hour24Cache = await isDevice24Hour()
	} catch {}

	await setOverride(message, time)
	toast(`Date changed to ${formatDateTime(time, use24Hour())}`)
}

let useDangerStyles: (() => { icon: { tintColor: any } }) | undefined

const DangerTrashIcon: DiscordModules.Components.BaseIconImage = props => {
	useDangerStyles ??= Design.createStyles({
		icon: { tintColor: Tokens.default.colors.ICON_FEEDBACK_CRITICAL },
	})
	const tint = useDangerStyles().icon.tintColor
	const Icon = lookupGeneratedIconComponent('TrashIcon')

	if (Icon)
		return (
			<Icon
				{...props}
				color={tint}
				style={[props.style, { tintColor: tint }]}
			/>
		)

	return (
		<Image
			{...props}
			source={getAssetIdByName('TrashIcon')!}
			style={[{ width: 24, height: 24 }, props.style, { tintColor: tint }]}
		/>
	)
}

function messageRows(message: MessageRecord): ReactNode[] {
	const { ActionSheetRow } = Design

	const run = (action: () => void) => () => {
		ActionSheetActionCreators.hideActionSheet()
		action()
	}

	const rows: ReactNode[] = [
		<ActionSheetRow
			key="change-date"
			label="Change Date"
			icon={<TableRowAssetIcon name="ClockIcon" />}
			onPress={run(() => void changeDate(message))}
		/>,
	]

	if (overrides()[message.id])
		rows.push(
			<ActionSheetRow
				key="reset-date"
				label="Reset Date"
				variant="danger"
				icon={<TableRowAssetIcon IconComponent={DangerTrashIcon} />}
				onPress={run(() =>
					removeOverrides([message.id]).then(() => toast('Date reset')),
				)}
			/>,
		)

	return rows
}

function findActionSheet(element: unknown): Element | undefined {
	if (!element || typeof element !== 'object') return
	if (Array.isArray(element)) {
		for (const child of element) {
			const found = findActionSheet(child)
			if (found) return found
		}
		return
	}

	const { type, props } = element as Element
	if (type === Design.ActionSheet) return element as Element
	return findActionSheet(props?.children)
}

const labelOf = (row: any) =>
	typeof row?.props?.label === 'string' ? row.props.label.toLowerCase() : ''

const ANCHORS = [
	(label: string) => label.startsWith('edit'),
	(label: string) => label.includes('copy text'),
	(label: string) => label.startsWith('reply'),
]

function addToActionSheet(tree: unknown, rows: ReactNode[]) {
	const sheet = findActionSheet(tree)
	if (!sheet) return

	const groups = [sheet.props.children].flat().filter(Boolean) as Element[]
	const groupRows = groups.map(group =>
		[group?.props?.children].flat().filter(Boolean),
	)

	for (const anchor of ANCHORS)
		for (let i = 0; i < groups.length; i++) {
			const index = groupRows[i].findIndex(row => anchor(labelOf(row)))
			if (index === -1) continue

			groupRows[i].splice(index + 1, 0, ...rows)
			groups[i].props.children = groupRows[i]
			return
		}

	const { ActionSheetRow } = Design
	groups.push(
		<ActionSheetRow.Group key="change-date">{rows}</ActionSheetRow.Group>,
	)
	sheet.props.children = groups
}

function DeleteButton({ onPress }: { onPress: () => void }) {
	return (
		<TouchableOpacity
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel="Reset"
			hitSlop={8}
			style={{
				width: 28,
				height: 28,
				borderRadius: 14,
				backgroundColor: '#da373c',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<Image
				source={getAssetIdByName('TrashIcon')}
				style={{ width: 16, height: 16, tintColor: '#ffffff' }}
			/>
		</TouchableOpacity>
	)
}

function SettingsPage({
	api: { jsonStorage },
}: ComponentProps<
	PluginSettingsComponent<{ jsonStorage: ChangeDateSettings }>
>) {
	const { TableRowGroup, TableRow } = Design
	const settings = { ...defaults, ...jsonStorage.use() }
	const hour24 = use24Hour()
	const entries = Object.entries(settings.overrides).sort(
		([a], [b]) => snowflakeTime(b) - snowflakeTime(a),
	)

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				{entries.length > 0 ? (
					<>
						<TableRowGroup title="Changed Messages">
							{entries.map(([id, override]) => (
								<TableRow
									key={id}
									label={formatDateTime(override.time, hour24)}
									subLabel={`Was ${formatDateTime(snowflakeTime(id), hour24)}${override.preview ? ` · ${override.preview}` : ''}`}
									trailing={
										<DeleteButton
											onPress={() =>
												removeOverrides([id]).then(() => toast('Date reset'))
											}
										/>
									}
								/>
							))}
						</TableRowGroup>
						<TableRowGroup>
							<TableRow
								label="Reset All Dates"
								subLabel="Show every message with its real date again"
								variant="danger"
								onPress={() =>
									removeOverrides(entries.map(([id]) => id)).then(() =>
										toast('All dates reset'),
									)
								}
							/>
						</TableRowGroup>
					</>
				) : (
					<TableRowGroup title="Changed Messages">
						<TableRow label="No changed messages yet" />
					</TableRowGroup>
				)}
			</Page>
		</ScrollView>
	)
}

export default plugin<{ jsonStorage: ChangeDateSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	async start({ cleanup, jsonStorage, logger }) {
		storage = jsonStorage
		cleanup(() => {
			storage = undefined
			changed.clear()
		})

		cleanup(onAnyFluxEventDispatched(fixPayload))

		cleanup(
			getModules(
				withName<{ prototype: any }>('RowManager'),
				({ prototype }) => {
					cleanup(
						instead(
							prototype,
							'generate',
							function (this: any, args, original) {
								const input = args[0]
								const message = input?.message
								let row: any

								const override = message?.id
									? overrides()[message.id]
									: undefined

								if (override) {
									const changedMessage = withOverride(message)
									input.message = changedMessage
									try {
										row = original.apply(this, args)
									} finally {
										input.message = message
									}

									try {
										if (row?.type === MESSAGE_ROW && row.message)
											addTimeToRow(
												row.message,
												timeText(changedMessage.timestamp, override.time),
											)
									} catch {}
								} else row = original.apply(this, args)

								try {
									const id = row?.message?.id
									if (row?.type === MESSAGE_ROW && id && changed.delete(id))
										row.changeType = UPDATE_CHANGE
								} catch {}

								return row
							},
						),
					)
				},
			),
		)

		cleanup(
			getModules(
				withName<LongPressMessageActionSheet>('LongPressMessageActionSheet'),
				mod => {
					const module = mod as { default: LongPressMessageActionSheet }
					cleanup(
						instead(module, 'default', (args, Sheet) => {
							const tree = Reflect.apply(Sheet, undefined, args) as Element

							try {
								const [{ message }] = args
								if (message?.id) addToActionSheet(tree, messageRows(message))
							} catch (e) {
								logger.error('Failed to add the Change Date button', e)
							}

							return tree
						}),
					)
				},
				{ returnNamespace: true },
			),
		)

		cleanup(() => {
			const current = overrides()
			storage = undefined
			for (const [id, override] of Object.entries(current))
				try {
					refreshMessage(override.channelId, id)
				} catch {}
		})

		await jsonStorage.get()

		try {
			hour24Cache = await isDevice24Hour()
		} catch {}
	},
	SettingsComponent: SettingsPage,
})
