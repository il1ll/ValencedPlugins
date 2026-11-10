import { getAssetIdByName } from '@valenced/assets'
import Page from '@valenced/components/Page'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Dispatcher } from '@valenced/discord/common/flux'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { useState } from 'react'
import {
	Image,
	Text as RNText,
	ScrollView,
	TouchableOpacity,
} from 'react-native'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'

interface UserNotifySettings {
	trackFriends: boolean
	userIds: string[]
	privateDuration: number
	serverDuration: number
	statusDuration: number
	colors: ToastColors
}

interface ToastColors {
	user: string
	server: string
	channel: string
	place: string
}

type ColorKey = keyof ToastColors

type Segment = string | { text: string; color: ColorKey }

type DurationKey = 'privateDuration' | 'serverDuration' | 'statusDuration'

const defaults: UserNotifySettings = {
	trackFriends: true,
	userIds: [],
	privateDuration: 2,
	serverDuration: 3,
	statusDuration: 2,
	colors: {
		user: '#00A8FC',
		server: '#F0B232',
		channel: '#23A55A',
		place: '#EB459E',
	},
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

const PRESET_COLORS = [
	'#00A8FC',
	'#5865F2',
	'#9B84EE',
	'#EB459E',
	'#F23F43',
	'#F0B232',
	'#23A55A',
	'#FFFFFF',
]

const getColor = (key: ColorKey, colors?: Partial<ToastColors>) => {
	const color = (colors ?? settings().colors)?.[key]
	return typeof color === 'string' && HEX_COLOR.test(color)
		? color
		: defaults.colors[key]
}

function ColoredText({
	segments,
	colors,
	onPress,
}: {
	segments: Segment[]
	colors?: Partial<ToastColors>
	onPress?: () => void
}) {
	const { Text } = Design
	return (
		<Text variant="text-sm/medium" color="text-default" onPress={onPress}>
			{segments.map((segment, index) =>
				typeof segment === 'string' ? (
					segment
				) : (
					<RNText
						key={index}
						style={{
							color: getColor(segment.color, colors),
							fontWeight: '700',
						}}
					>
						{segment.text}
					</RNText>
				),
			)}
		</Text>
	)
}

const MIN_DURATION = 1
const MAX_DURATION = 10

const durationMs = (key: DurationKey) => {
	const seconds = Number(settings()[key])
	return (
		(Number.isFinite(seconds) && seconds > 0 ? seconds : defaults[key]) * 1000
	)
}

let settings: () => UserNotifySettings = () => defaults

const toast = (text: string, variant?: 'success' | 'critical') =>
	ToastActionCreators.open('USER_NOTIFY', { text, variant })

const store = (name: string) => Stores[name] as any

function getTrackedIds() {
	const s = settings()
	const ids = new Set<string>(s.userIds)
	if (s.trackFriends)
		for (const id of store('RelationshipStore').getFriendIDs() ?? [])
			ids.add(id)
	return ids
}

const getName = (id: string) => store('UserStore').getUser(id)?.username ?? id

function getAvatarUrl(id: string): string {
	const user = store('UserStore').getUser(id)
	try {
		const url = user?.getAvatarURL?.(undefined, 128, false)
		if (typeof url === 'string' && url) return url
	} catch {}

	if (user?.avatar)
		return `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128`

	let index = 0
	try {
		index = Number((BigInt(id) >> 22n) % 6n)
	} catch {}
	return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

function openChannel(channelId: string) {
	const channel = store('ChannelStore').getChannel(channelId)
	const guildId: string = channel?.guild_id ?? '@me'

	const [Router] = lookupModule(withProps<any>('transitionToGuild'))
	if (Router) return Router.transitionToGuild(guildId, channelId)

	const [Navigator] = lookupModule(withProps<any>('transitionTo'))
	Navigator?.transitionTo(`/channels/${guildId}/${channelId}`)
}

function openProfile(userId: string) {
	const [showUserProfileActionSheet] = lookupModule(
		withName<(props: { userId: string }, mode?: string) => void>(
			'showUserProfileActionSheet',
		),
	)
	showUserProfileActionSheet?.({ userId }, 'stack')
}

function notify(
	userId: string,
	segments: Segment[],
	duration: DurationKey,
	onPress: () => void,
) {
	const press = () => {
		ToastActionCreators.close()
		onPress()
	}

	ToastActionCreators.open('USER_NOTIFY', {
		text: <ColoredText segments={segments} onPress={press} />,
		icon: { type: 'avatar', src: getAvatarUrl(userId), alt: getName(userId) },
		duration: durationMs(duration),
		onPress: press,
	} as any)
}

const userSegment = (id: string): Segment => ({
	text: getName(id),
	color: 'user',
})

function describeChannel(
	channelId: string,
): { where: Segment[]; duration: DurationKey } | undefined {
	const c = store('ChannelStore').getChannel(channelId)
	if (!c) return
	if (c.guild_id) {
		const g = store('GuildStore').getGuild(c.guild_id)
		return {
			where: [
				' in ',
				{ text: g?.name ?? 'server', color: 'server' },
				' ',
				{ text: `#${c.name}`, color: 'channel' },
			],
			duration: 'serverDuration',
		}
	}
	return {
		where: [' in ', { text: c.type === 3 ? 'group' : 'DM', color: 'place' }],
		duration: 'privateDuration',
	}
}

const lastStatuses: Record<string, string | undefined> = {}

function onPresence(id: string | undefined, status: string | undefined) {
	if (!id || !status || !getTrackedIds().has(id)) return
	if (lastStatuses[id] !== status) {
		lastStatuses[id] = status
		notify(id, [userSegment(id), ` is now ${status}`], 'statusDuration', () =>
			openProfile(id),
		)
	}
}

function onPresenceUpdate(p: any) {
	onPresence(p?.user?.id, p?.status)
}

function onPresenceUpdates(p: any) {
	for (const update of p?.updates ?? [])
		onPresence(update?.user?.id, update?.status)
}

function onMessage(p: any) {
	const m = p?.message
	const id = m?.author?.id
	if (!id || !getTrackedIds().has(id)) return
	const info = describeChannel(m.channel_id)
	if (info)
		notify(
			id,
			[userSegment(id), ' messaged', ...info.where],
			info.duration,
			() => openChannel(m.channel_id),
		)
}

function onTyping(p: any) {
	const id = p?.userId
	if (!id || !getTrackedIds().has(id)) return
	const info = describeChannel(p.channelId)
	if (info)
		notify(id, [userSegment(id), ' typing', ...info.where], info.duration, () =>
			openChannel(p.channelId),
		)
}

const subscriptions: [string, (p: any) => void][] = [
	['PRESENCE_UPDATE', onPresenceUpdate],
	['PRESENCE_UPDATES', onPresenceUpdates],
	['MESSAGE_CREATE', onMessage],
	['TYPING_START', onTyping],
]

function DeleteButton({ onPress }: { onPress: () => void }) {
	return (
		<TouchableOpacity
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel="Remove"
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

function DurationSlider({
	title,
	subLabel,
	value,
	onChange,
}: {
	title: string
	subLabel: string
	value: number
	onChange: (seconds: number) => void
}) {
	const { Stack, TableRowGroup, TableRow, Slider } = Design as any
	const [seconds, setSeconds] = useState(value)
	const snap = (v: number) => Math.round(v * 2) / 2

	return (
		<TableRowGroup title={title}>
			<TableRow
				label={`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
				subLabel={subLabel}
			/>
			<Stack style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
				<Slider
					step={0.5}
					value={seconds}
					minimumValue={MIN_DURATION}
					maximumValue={MAX_DURATION}
					onValueChange={(v: number) => setSeconds(snap(v))}
					onSlidingComplete={(v: number) => onChange(snap(v))}
				/>
			</Stack>
		</TableRowGroup>
	)
}

function ColorPicker({
	title,
	value,
	onChange,
}: {
	title: string
	value: string
	onChange: (color: string) => void
}) {
	const { Stack, TableRowGroup, TextInput } = Design as any
	const [hex, setHex] = useState(value)
	const valid = HEX_COLOR.test(hex)

	const pick = (color: string) => {
		setHex(color)
		onChange(color)
	}

	return (
		<TableRowGroup title={title}>
			<Stack spacing={12} style={{ padding: 12 }}>
				<Stack direction="horizontal" spacing={8} style={{ flexWrap: 'wrap' }}>
					{PRESET_COLORS.map(color => {
						const selected = value.toLowerCase() === color.toLowerCase()
						return (
							<TouchableOpacity
								key={color}
								onPress={() => pick(color)}
								accessibilityRole="button"
								accessibilityLabel={color}
								accessibilityState={{ selected }}
								style={{
									width: 30,
									height: 30,
									borderRadius: 15,
									backgroundColor: color,
									borderWidth: selected ? 3 : 1,
									borderColor: selected ? '#ffffff' : 'rgba(128,128,128,0.5)',
								}}
							/>
						)
					})}
				</Stack>
				<TextInput
					placeholder="#RRGGBB"
					value={hex}
					maxLength={7}
					status={valid ? 'default' : 'error'}
					errorMessage={valid ? undefined : 'Use a hex color like #00A8FC'}
					onChange={(v: string) => {
						setHex(v)
						if (HEX_COLOR.test(v)) onChange(v)
					}}
				/>
			</Stack>
		</TableRowGroup>
	)
}

function SettingsPage({
	api: { jsonStorage },
}: ComponentProps<
	PluginSettingsComponent<{ jsonStorage: UserNotifySettings }>
>) {
	const { Stack, TableRowGroup, TableRow, TableSwitchRow, TextInput } =
		Design as any
	const s = { ...defaults, ...jsonStorage.use() }
	const [newUserId, setNewUserId] = useState('')
	const [colorsVersion, setColorsVersion] = useState(0)

	const addUserId = () => {
		const id = newUserId.trim()
		if (!id) return toast('Please enter a user ID', 'critical')
		if (s.userIds.includes(id))
			return toast('User ID already exists', 'critical')

		void jsonStorage.set({ userIds: [...s.userIds, id] })
		setNewUserId('')
		toast('User ID added', 'success')
	}

	const removeUserId = (id: string) => {
		void jsonStorage.set({ userIds: s.userIds.filter(x => x !== id) })
		toast('User ID removed', 'success')
	}

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				<TableRowGroup title="Tracking Settings">
					<TableSwitchRow
						label="Track Friends"
						subLabel="Enable tracking for your friends"
						value={s.trackFriends}
						onValueChange={(value: boolean) => {
							void jsonStorage.set({ trackFriends: value })
							toast(
								value ? 'Friend tracking enabled' : 'Friend tracking disabled',
								'success',
							)
						}}
					/>
				</TableRowGroup>

				<TableRowGroup title="Add User ID">
					<Stack spacing={4} style={{ padding: 10 }}>
						<TextInput
							placeholder="Enter user ID"
							value={newUserId}
							onChange={setNewUserId}
							isClearable
							onSubmitEditing={addUserId}
							returnKeyType="done"
						/>
					</Stack>
					<TableRow
						label="Add User ID"
						subLabel="Add a specific user ID to track"
						arrow
						onPress={addUserId}
					/>
				</TableRowGroup>

				{s.userIds.length > 0 && (
					<TableRowGroup title="Tracked User IDs">
						{s.userIds.map(id => (
							<TableRow
								key={id}
								label={id}
								trailing={<DeleteButton onPress={() => removeUserId(id)} />}
							/>
						))}
					</TableRowGroup>
				)}

				<TableRowGroup title="About User Tracking">
					<TableRow
						label="How it Works"
						subLabel="Track specific users by their Discord user IDs"
					/>
					<TableRow
						label="Finding User IDs"
						subLabel="Enable Developer Mode in Discord settings, then open user profile and select three dots in right top, and copy their ID"
					/>
					<TableRow
						label="Friends vs Specific Users"
						subLabel="Enable 'Track Friends' to track all friends, or add specific user IDs"
					/>
				</TableRowGroup>

				<DurationSlider
					title="DMs & Groups Duration"
					subLabel="Messages and typing in DMs and group DMs"
					value={s.privateDuration}
					onChange={v => void jsonStorage.set({ privateDuration: v })}
				/>
				<DurationSlider
					title="Servers Duration"
					subLabel="Messages and typing in servers"
					value={s.serverDuration}
					onChange={v => void jsonStorage.set({ serverDuration: v })}
				/>
				<DurationSlider
					title="Status Duration"
					subLabel="Online, idle, do not disturb, and offline changes"
					value={s.statusDuration}
					onChange={v => void jsonStorage.set({ statusDuration: v })}
				/>

				<TableRowGroup title="Colors Preview">
					<TableRow
						label={
							<ColoredText
								colors={s.colors}
								segments={[
									{ text: 'username', color: 'user' },
									' messaged in ',
									{ text: 'Server', color: 'server' },
									' ',
									{ text: '#general', color: 'channel' },
								]}
							/>
						}
						subLabel={
							<ColoredText
								colors={s.colors}
								segments={[
									{ text: 'username', color: 'user' },
									' typing in ',
									{ text: 'DM', color: 'place' },
									' / ',
									{ text: 'group', color: 'place' },
								]}
							/>
						}
					/>
					<TableRow
						label="Reset Colors"
						subLabel="Go back to the default colors"
						arrow
						onPress={() => {
							void jsonStorage.set({ colors: { ...defaults.colors } })
							setColorsVersion(v => v + 1)
							toast('Colors reset', 'success')
						}}
					/>
				</TableRowGroup>

				{(
					[
						['user', 'User Name Color'],
						['server', 'Server Name Color'],
						['channel', 'Channel Name Color'],
						['place', 'DM & Group Color'],
					] as [ColorKey, string][]
				).map(([key, title]) => (
					<ColorPicker
						key={`${key}-${colorsVersion}`}
						title={title}
						value={getColor(key, s.colors)}
						onChange={color =>
							void jsonStorage.set({ colors: { [key]: color } })
						}
					/>
				))}
			</Page>
		</ScrollView>
	)
}

export default plugin<{ jsonStorage: UserNotifySettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	async start({ cleanup, jsonStorage }) {
		await jsonStorage.get()
		settings = () => ({ ...defaults, ...jsonStorage.cache })

		const PresenceStore = store('PresenceStore')
		for (const id of getTrackedIds())
			lastStatuses[id] = PresenceStore.getStatus(id)

		for (const [type, handler] of subscriptions) {
			Dispatcher.subscribe(type, handler)
			cleanup(() => Dispatcher.unsubscribe(type, handler))
		}

		cleanup(() => {
			settings = () => defaults
			for (const id of Object.keys(lastStatuses)) delete lastStatuses[id]
		})
	},
	SettingsComponent: SettingsPage,
})
