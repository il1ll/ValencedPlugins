import type { JsonStorage } from '@valenced/json-storage'

export type ButtonKey = 'notifications' | 'mute' | 'deafen' | 'settings'

export interface Settings {
	order: ButtonKey[]
	hidden: ButtonKey[]
}

export const ALL_KEYS: ButtonKey[] = [
	'notifications',
	'mute',
	'deafen',
	'settings',
]

const DEFAULT_ORDER: ButtonKey[] = [
	'notifications',
	'settings',
	'deafen',
	'mute',
]

const OLD_ORDER = ALL_KEYS.join(',')

export const DefaultSettings: Settings = {
	order: [...DEFAULT_ORDER],
	hidden: [],
}

export const LABELS: Record<ButtonKey, string> = {
	notifications: 'Notifications Button',
	mute: 'Mute Button',
	deafen: 'Deafen Button',
	settings: 'Settings Button',
}

export const ICONS: Record<ButtonKey, string> = {
	notifications: 'BellIcon',
	mute: 'MicrophoneIcon',
	deafen: 'HeadphonesIcon',
	settings: 'SettingsIcon',
}

export const listeners = new Set<() => void>()

export function notify() {
	for (const listener of listeners) listener()
}

export function normalize(value?: Partial<Settings>): Settings {
	const seen = new Set<ButtonKey>()
	const order: ButtonKey[] = []
	const stored =
		value?.order?.join(',') === OLD_ORDER ? DEFAULT_ORDER : value?.order
	for (const key of stored ?? DEFAULT_ORDER)
		if (ALL_KEYS.includes(key) && !seen.has(key)) {
			seen.add(key)
			order.push(key)
		}
	for (const key of DEFAULT_ORDER) if (!seen.has(key)) order.push(key)
	const hidden = ALL_KEYS.filter(key => value?.hidden?.includes(key))
	return { order, hidden }
}

export function save(storage: JsonStorage<Settings>, next: Settings) {
	storage.set(normalize(next), true)
	notify()
}
