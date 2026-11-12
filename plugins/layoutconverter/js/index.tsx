import { getAssetIdByName } from '@valenced/assets'
import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Dispatcher } from '@valenced/discord/common/flux'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { ScrollView } from 'react-native'
import { convertText, defaultLanguage, languages } from './convert'
import type { JsonStorage } from '@valenced/json-storage'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps, FC, ReactElement, ReactNode } from 'react'

interface ConverterSettings {
	language: string
}

interface MessageRecord {
	id: string
	channel_id: string
	content?: string
}

type Element = ReactElement<{ children?: ReactNode }>

type LongPressMessageActionSheet = FC<{ message: MessageRecord }>

const defaults: ConverterSettings = { language: defaultLanguage }

const MESSAGE_ROW = 1
const UPDATE_CHANGE = 2

const ICON_CANDIDATES = [
	'ArrowsLeftRightIcon',
	'LanguageIcon',
	'RefreshIcon',
	'PencilIcon',
]

let storage: JsonStorage<ConverterSettings> | undefined

const converted = new Map<string, { channelId: string; text: string }>()
const changed = new Set<string>()

const language = () => storage?.cache?.language ?? defaults.language

const iconName = () =>
	ICON_CANDIDATES.find(name => getAssetIdByName(name) !== undefined) ??
	ICON_CANDIDATES[0]

function refreshMessage(channelId: string, id: string) {
	changed.add(id)
	Dispatcher.dispatch({
		type: 'MESSAGE_UPDATE',
		guildId: (Stores.ChannelStore as any)?.getChannel?.(channelId)?.guild_id,
		message: { id, channel_id: channelId },
	})
}

function toggleConversion(message: MessageRecord) {
	if (converted.has(message.id)) converted.delete(message.id)
	else {
		const text = convertText(message.content ?? '', language())
		if (!text || text === message.content) return
		converted.set(message.id, { channelId: message.channel_id, text })
	}
	refreshMessage(message.channel_id, message.id)
}

function withConversion<T extends MessageRecord>(message: T, text: string): T {
	const note = text
		.split('\n')
		.map(line => line || ' ')
		.join('\n')
	return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
		content: `${message.content ?? ''}\n\n${note}\n-# ⇄ Converted`,
	})
}

function messageRows(message: MessageRecord): ReactNode[] {
	const { ActionSheetRow } = Design
	const isConverted = converted.has(message.id)

	return [
		<ActionSheetRow
			key="layout-converter"
			label={isConverted ? 'Show Original' : 'Convert'}
			icon={<TableRowAssetIcon name={iconName()} />}
			onPress={() => {
				ActionSheetActionCreators.hideActionSheet()
				toggleConversion(message)
			}}
		/>,
	]
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
	(label: string) => label.includes('copy text'),
	(label: string) => label.startsWith('reply'),
	(label: string) => label.startsWith('edit'),
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
		<ActionSheetRow.Group key="layout-converter">{rows}</ActionSheetRow.Group>,
	)
	sheet.props.children = groups
}

function SettingsPage({
	api: { jsonStorage },
}: ComponentProps<
	PluginSettingsComponent<{ jsonStorage: ConverterSettings }>
>) {
	const { TableRadioGroup, TableRadioRow } = Design
	const settings = { ...defaults, ...jsonStorage.use() }

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				<TableRadioGroup
					title="Secondary Keyboard Language"
					value={settings.language}
					onChange={(value: string) =>
						void jsonStorage.set({ language: value })
					}
				>
					{Object.entries(languages).map(([value, label]) => (
						<TableRadioRow key={value} label={label} value={value} />
					))}
				</TableRadioGroup>
			</Page>
		</ScrollView>
	)
}

export default plugin<{ jsonStorage: ConverterSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	start({ cleanup, jsonStorage, logger }) {
		storage = jsonStorage

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
								const conversion = message?.id
									? converted.get(message.id)
									: undefined
								let row: any

								if (conversion) {
									input.message = withConversion(message, conversion.text)
									try {
										row = original.apply(this, args)
									} finally {
										input.message = message
									}
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
								if (message?.id && message.content?.trim())
									addToActionSheet(tree, messageRows(message))
							} catch (e) {
								logger.error('Failed to add the Convert button', e)
							}

							return tree
						}),
					)
				},
				{ returnNamespace: true },
			),
		)

		cleanup(() => {
			const current = [...converted.entries()]
			converted.clear()
			storage = undefined
			for (const [id, { channelId }] of current)
				try {
					refreshMessage(channelId, id)
				} catch {}
		})
	},
	SettingsComponent: SettingsPage,
})
