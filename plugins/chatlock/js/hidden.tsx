import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { getStore } from '@valenced/discord/flux'
import {
	getModuleWithImportedPath,
	lookupModuleWithImportedPath,
} from '@valenced/discord/utils/modules/finders'
import { after, instead } from '@valenced/patcher'
import { useState, useSyncExternalStore } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { ChatIcon, describe } from './info'
import { authenticate } from './prompts'
import {
	endHiddenSession,
	getSnapshot,
	isHidden,
	read,
	setMembership,
	startHiddenSession,
	subscribe,
} from './state'

const WRAPPER_PATH =
	'modules/main_tabs_v2/native/shared_components/guild_channels/ChannelWrapper.tsx'
const SEARCH_TABS_PATH =
	'modules/search/native/components/tabs/SearchTabsLayout.tsx'
const TRANSITION_PATH = 'modules/routing/transitionToChannel.tsx'
const SEARCH_ROWS = [
	'modules/search/native/components/list/rows/DMRow.tsx',
	'modules/search/native/components/list/rows/GroupDMRow.tsx',
	'modules/search/native/components/list/rows/GuildTextChannelRow.tsx',
	'modules/search/native/components/list/rows/GuildChannelRow.tsx',
]

interface QueryStore {
	getTextInputValue(context: unknown): string | null | undefined
	addChangeListener(listener: () => void): void
	removeChangeListener(listener: () => void): void
}

let queryStore: QueryStore | undefined

const hideNow = (id: string | undefined) => !!id && isHidden(id)

function channelIdOf(value: unknown, depth = 0): string | undefined {
	if (!value || typeof value !== 'object' || depth > 2) return
	const record = value as Record<string, any>
	if (typeof record.channelId === 'string') return record.channelId
	if (
		record.channel &&
		typeof record.channel === 'object' &&
		typeof record.channel.id === 'string'
	)
		return record.channel.id
	for (const key of ['item', 'result', 'row', 'data']) {
		const found = channelIdOf(record[key], depth + 1)
		if (found) return found
	}
}

const filtered = new WeakMap<object, { version: string; value: unknown[] }>()

function filterSection(section: unknown) {
	if (!Array.isArray(section)) return section
	const version = read().hidden.join(',')
	const cached = filtered.get(section)
	if (cached && cached.version === version) return cached.value
	const value = section.filter(item => {
		const record = item as Record<string, any>
		const id =
			typeof record?.channelId === 'string'
				? record.channelId
				: (record?.channel?.id ?? record?.id)
		return !hideNow(typeof id === 'string' ? id : undefined)
	})
	filtered.set(section, { version, value })
	return value
}

function patchComponentExport(
	module: any,
	key: string,
	hook: (props: any, render: () => unknown) => unknown,
	cleanup: (fn: () => void) => void,
) {
	const target = module?.[key]
	if (typeof target === 'function') {
		cleanup(
			instead(module, key, function (this: unknown, args, original) {
				return hook(args[0], () => Reflect.apply(original, this, args))
			}),
		)
		return
	}
	if (target && typeof target.type === 'function')
		cleanup(
			instead(target, 'type', function (this: unknown, args, original) {
				return hook(args[0], () => Reflect.apply(original, this, args))
			}),
		)
}

function openChat(id: string) {
	const [module] = lookupModuleWithImportedPath<any>(TRANSITION_PATH)
	module?.transitionToChannel?.(id)
}

let useScreenStyles:
	| (() => {
			screen: object
			header: object
			back: object
			title: object
			list: object
	  })
	| undefined

function screenStyles() {
	useScreenStyles ??= Design.createStyles({
		screen: {
			flex: 1,
			backgroundColor: Tokens.default.colors.BACKGROUND_BASE_LOW,
		},
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 12,
			paddingHorizontal: 16,
			paddingVertical: 12,
			borderBottomWidth: 1,
			borderBottomColor: Tokens.default.colors.BORDER_SUBTLE,
		},
		back: {
			width: 40,
			height: 40,
			alignItems: 'center',
			justifyContent: 'center',
		},
		title: { flex: 1 },
		list: { padding: 16, paddingBottom: 38, gap: 16 },
	}) as any
	return useScreenStyles!()
}

function HiddenChatsScreen({
	onClose,
}: {
	onClose: (opening: boolean) => void
}) {
	const { TableRowGroup, TableRow, Button, Text } = Design
	const settings = useSyncExternalStore(subscribe, getSnapshot)
	const style = screenStyles()
	const chats = settings.hidden.map(describe)

	return (
		<View style={style.screen}>
			<View style={style.header}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Back"
					style={style.back}
					onPress={() => onClose(false)}
				>
					<TableRowAssetIcon name="ArrowLargeLeftIcon" />
				</Pressable>
				<View style={style.title}>
					<Text variant="heading-lg/bold" color="text-strong">
						Locked Chats
					</Text>
					<Text variant="text-sm/medium" color="text-muted">
						{`${chats.length} hidden ${chats.length === 1 ? 'chat' : 'chats'}`}
					</Text>
				</View>
			</View>
			<ScrollView contentContainerStyle={style.list}>
				<TableRowGroup>
					{chats.length === 0 ? (
						<TableRow
							label="No hidden chats"
							subLabel="Long press a chat and choose Hide Chat."
							icon={<TableRowAssetIcon name="EyeIcon" />}
						/>
					) : (
						chats.map(info => (
							<TableRow
								key={info.id}
								label={info.label}
								subLabel={info.subLabel}
								icon={<ChatIcon info={info} />}
								onPress={() => {
									onClose(true)
									openChat(info.id)
								}}
								trailing={
									<Button
										text="Unhide"
										size="sm"
										variant="secondary"
										onPress={() =>
											void setMembership('hidden', [info.id], false)
										}
									/>
								}
							/>
						))
					)}
				</TableRowGroup>
			</ScrollView>
		</View>
	)
}

function HiddenChatsModal({
	visible,
	onClose,
}: {
	visible: boolean
	onClose: () => void
}) {
	const close = (opening: boolean) => {
		if (!opening) endHiddenSession()
		onClose()
	}
	return (
		<Modal
			visible={visible}
			animationType="slide"
			onRequestClose={() => close(false)}
		>
			{visible ? <HiddenChatsScreen onClose={close} /> : null}
		</Modal>
	)
}

async function unlockHiddenChats() {
	const ok = await authenticate(
		'Locked Chats',
		'Enter your password to see your hidden chats.',
	)
	if (ok) startHiddenSession()
	return ok
}

function useQuery(context: unknown) {
	return useSyncExternalStore(
		listener => {
			queryStore?.addChangeListener(listener)
			return () => queryStore?.removeChangeListener(listener)
		},
		() => {
			try {
				return queryStore?.getTextInputValue(context) ?? ''
			} catch {
				return ''
			}
		},
	)
}

function LockedChatsEntry({ searchContext }: { searchContext: unknown }) {
	const { TableRowGroup, TableRow } = Design
	const query = useQuery(searchContext)
	const keyword = useSyncExternalStore(subscribe, () => getSnapshot().keyword)
	const [open, setOpen] = useState(false)
	const matches =
		!!keyword && query.trim().toLowerCase() === keyword.toLowerCase()

	return (
		<>
			{matches ? (
				<View
					style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}
				>
					<TableRowGroup>
						<TableRow
							label="Locked Chats"
							subLabel="Your hidden chats"
							icon={<TableRowAssetIcon name="LockUnlockedIcon" />}
							arrow
							onPress={() =>
								void unlockHiddenChats().then(ok => {
									if (ok) setOpen(true)
								})
							}
						/>
					</TableRowGroup>
				</View>
			) : null}
			<HiddenChatsModal visible={open} onClose={() => setOpen(false)} />
		</>
	)
}

export function patchHidden(cleanup: (fn: () => void) => void) {
	cleanup(
		getStore<any>('NativeSearchQueryStore', store => {
			queryStore = store as unknown as QueryStore
		}),
	)

	cleanup(
		getStore<any>('PrivateChannelSortStore', store => {
			const target = store as any
			if (typeof target.getSortedChannels !== 'function') return
			cleanup(
				after(target, 'getSortedChannels', (result: unknown) =>
					Array.isArray(result) ? result.map(filterSection) : result,
				),
			)
			cleanup(subscribe(() => target.emitChange?.()))
		}),
	)

	cleanup(
		getModuleWithImportedPath<any>(WRAPPER_PATH, module => {
			if (typeof module?.renderChannelWrapper !== 'function') return
			cleanup(
				instead(
					module,
					'renderChannelWrapper',
					function (this: unknown, args, original) {
						const id = args
							.map(arg => channelIdOf(arg))
							.find((value): value is string => !!value)
						const output = Reflect.apply(original, this, args)
						return hideNow(id) ? null : output
					},
				),
			)
		}),
	)

	for (const path of SEARCH_ROWS)
		cleanup(
			getModuleWithImportedPath<any>(path, module =>
				patchComponentExport(
					module,
					'default',
					(props, render) => {
						const output = render()
						return hideNow(channelIdOf(props)) ? null : output
					},
					cleanup,
				),
			),
		)

	cleanup(
		getModuleWithImportedPath<any>(SEARCH_TABS_PATH, module =>
			patchComponentExport(
				module,
				'default',
				(props, render) => (
					<View style={{ flex: 1 }}>
						<LockedChatsEntry searchContext={props?.searchContext} />
						{render() as any}
					</View>
				),
				cleanup,
			),
		),
	)
}
