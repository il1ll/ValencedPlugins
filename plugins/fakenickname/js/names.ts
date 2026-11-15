import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { instead } from '@valenced/patcher'
import { nicknameOf, store } from './state'

type Cleanup = (fn: () => void) => void
type Fn = (...args: any[]) => any

const USER_UTILS_PATH = 'utils/UserUtils.tsx'
const USER_NAME_METHODS = ['getName', 'getGlobalName', 'getFormattedName']

const members = new WeakMap<object, { nick: string; copy: object }>()

function withNick(member: any, nick: string) {
	if (!member || typeof member !== 'object') return member
	const known = members.get(member)
	if (known?.nick === nick) return known.copy
	const copy = Object.assign(
		Object.create(Object.getPrototypeOf(member)),
		member,
		{ nick },
	)
	members.set(member, { nick, copy })
	return copy
}

function patch(
	target: any,
	method: string,
	cleanup: Cleanup,
	hook: (args: any[], call: () => any) => any,
) {
	if (typeof target?.[method] !== 'function') return
	try {
		cleanup(
			instead(
				target,
				method,
				function (this: unknown, args: any[], original: Fn) {
					return hook(args, () => Reflect.apply(original, this, args))
				},
			),
		)
	} catch {}
}

const userId = (user: any): unknown =>
	typeof user === 'string' ? user : user?.id

export function patchNames(cleanup: Cleanup) {
	const relationships = store('RelationshipStore')
	patch(
		relationships,
		'getNickname',
		cleanup,
		(args, call) => nicknameOf(args[0]) ?? call(),
	)

	const guildMembers = store('GuildMemberStore')
	patch(
		guildMembers,
		'getNick',
		cleanup,
		(args, call) => nicknameOf(args[1]) ?? call(),
	)
	patch(guildMembers, 'getMember', cleanup, (args, call) => {
		const member = call()
		const nick = nicknameOf(args[1])
		return nick ? withNick(member, nick) : member
	})

	cleanup(
		getModuleWithImportedPath<any>(USER_UTILS_PATH, module => {
			const targets = new Set<any>([module])
			if (module?.default && typeof module.default === 'object')
				targets.add(module.default)
			for (const target of targets)
				for (const method of USER_NAME_METHODS)
					patch(
						target,
						method,
						cleanup,
						(args, call) => nicknameOf(userId(args[0])) ?? call(),
					)
		}),
	)
}
