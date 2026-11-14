import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Stores } from '@valenced/discord/flux'
import { Image } from 'react-native'
import { getChannel } from './state'

export const DM = 1
export const GROUP_DM = 3
const THREAD_TYPES = new Set([10, 11, 12])
const CDN = 'https://cdn.discordapp.com'

interface User {
	id: string
	username?: string
	globalName?: string | null
	avatar?: string | null
}

interface Guild {
	id: string
	name?: string
	icon?: string | null
}

const getUser = (id: string): User | undefined =>
	(Stores as any).UserStore?.getUser?.(id) ?? undefined

const getGuild = (id: string): Guild | undefined =>
	(Stores as any).GuildStore?.getGuild?.(id) ?? undefined

function defaultAvatar(id: string) {
	let index = 0
	try {
		index = Number((BigInt(id) >> 22n) % 6n)
	} catch {}
	return `${CDN}/embed/avatars/${index}.png`
}

const avatarOf = (user: User) =>
	user.avatar
		? `${CDN}/avatars/${user.id}/${user.avatar}.png?size=64`
		: defaultAvatar(user.id)

const nameOf = (user: User | undefined) =>
	user?.globalName || user?.username || 'Unknown User'

export interface ChatInfo {
	id: string
	label: string
	subLabel: string
	image?: string
	asset: string
	round: number
}

export const isThread = (type: number | undefined) =>
	type !== undefined && THREAD_TYPES.has(type)

export function describe(id: string): ChatInfo {
	const channel = getChannel(id)
	if (!channel)
		return {
			id,
			label: 'Unknown Chat',
			subLabel: id,
			asset: 'LockIcon',
			round: 10,
		}

	if (channel.type === DM) {
		const user = getUser(channel.recipients?.[0] ?? '')
		return {
			id,
			label: nameOf(user),
			subLabel: user?.username
				? `Direct Message · @${user.username}`
				: 'Direct Message',
			image: user ? avatarOf(user) : undefined,
			asset: 'UserIcon',
			round: 16,
		}
	}

	if (channel.type === GROUP_DM) {
		const recipients = channel.recipients ?? []
		return {
			id,
			label:
				channel.name ||
				recipients.map(userId => nameOf(getUser(userId))).join(', ') ||
				'Group',
			subLabel: `Group · ${recipients.length + 1} Members`,
			image: channel.icon
				? `${CDN}/channel-icons/${channel.id}/${channel.icon}.png?size=64`
				: undefined,
			asset: 'GroupIcon',
			round: 16,
		}
	}

	const guild = channel.guild_id ? getGuild(channel.guild_id) : undefined
	const guildIcon = guild?.icon
		? `${CDN}/icons/${guild.id}/${guild.icon}.png?size=64`
		: undefined

	if (isThread(channel.type)) {
		const parent = channel.parent_id ? getChannel(channel.parent_id) : undefined
		const where = [parent?.name ? `#${parent.name}` : undefined, guild?.name]
			.filter(Boolean)
			.join(' · ')
		return {
			id,
			label: channel.name ?? 'Thread',
			subLabel: where ? `Thread in ${where}` : 'Thread',
			image: guildIcon,
			asset: 'ThreadIcon',
			round: 10,
		}
	}

	return {
		id,
		label: `#${channel.name ?? 'unknown'}`,
		subLabel: guild?.name ? `in ${guild.name}` : 'Server Channel',
		image: guildIcon,
		asset: 'TextIcon',
		round: 10,
	}
}

export function ChatIcon({ info }: { info: ChatInfo }) {
	if (!info.image) return <TableRowAssetIcon name={info.asset} />
	return (
		<Image
			source={{ uri: info.image }}
			style={{ width: 32, height: 32, borderRadius: info.round }}
		/>
	)
}
