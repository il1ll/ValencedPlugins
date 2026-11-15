import { Stores } from '@valenced/discord/flux'

export interface FakeNicknameSettings {
	nicknames: Record<string, string>
}

export const defaults: FakeNicknameSettings = { nicknames: {} }

export const MAX_LENGTH = 32

interface Storage {
	cache?: Partial<FakeNicknameSettings>
	set(value: FakeNicknameSettings, replace: true): Promise<void>
}

let storage: Storage | undefined

const EMPTY: Record<string, string> = {}

export const store = (name: string) => (Stores as any)[name] as any

export function bindStorage(next: Storage | undefined) {
	storage = next
}

export function nicknames(): Record<string, string> {
	const value = storage?.cache?.nicknames
	return value && typeof value === 'object' ? value : EMPTY
}

export function nicknameOf(id: unknown): string | undefined {
	if (typeof id !== 'string') return
	const value = nicknames()[id]
	return typeof value === 'string' && value.trim() ? value : undefined
}

export function refreshNames() {
	for (const name of ['RelationshipStore', 'GuildMemberStore', 'UserStore'])
		try {
			store(name)?.emitChange?.()
		} catch {}
}

async function save(next: Record<string, string>) {
	await storage?.set(
		{ ...defaults, ...(storage.cache ?? {}), nicknames: next },
		true,
	)
}

export async function setNickname(id: string, value: string | undefined) {
	const next = { ...nicknames() }
	const name = value?.trim().slice(0, MAX_LENGTH)
	if (name) next[id] = name
	else delete next[id]
	await save(next)
	refreshNames()
}

export async function clearNicknames() {
	await save({})
	refreshNames()
}

export function realName(id: string): string {
	const user = store('UserStore')?.getUser?.(id)
	return user?.globalName || user?.global_name || user?.username || id
}

export function username(id: string): string | undefined {
	return store('UserStore')?.getUser?.(id)?.username
}

export function avatarUrl(id: string): string {
	const user = store('UserStore')?.getUser?.(id)
	try {
		const url = user?.getAvatarURL?.(undefined, 64, false)
		if (typeof url === 'string' && url) return url
	} catch {}
	if (user?.avatar)
		return `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=64`
	let index = 0
	try {
		index = Number((BigInt(id) >> 22n) % 6n)
	} catch {}
	return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}
