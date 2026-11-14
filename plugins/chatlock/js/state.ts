import { Stores } from '@valenced/discord/flux'
import { callNativeMethod } from '@valenced/modules/native'
import type { JsonStorage } from '@valenced/json-storage'

export type FirstMethod = 'fingerprint' | 'password'

export interface LockSettings {
	locked: string[]
	hidden: string[]
	biometric: boolean
	keyword: string
	gateScreen: boolean
	firstMethod: FirstMethod
	hints: boolean
	hint: string
	recovery: boolean
	recoveryQuestion: string
	protectNotifications: boolean
}

export const defaults: LockSettings = {
	locked: [],
	hidden: [],
	biometric: true,
	keyword: '',
	gateScreen: true,
	firstMethod: 'fingerprint',
	hints: false,
	hint: '',
	recovery: false,
	recoveryQuestion: '',
	protectNotifications: true,
}

let storage: JsonStorage<LockSettings> | undefined

export const read = (): LockSettings => ({
	locked: storage?.cache?.locked ?? defaults.locked,
	hidden: storage?.cache?.hidden ?? defaults.hidden,
	biometric: storage?.cache?.biometric ?? defaults.biometric,
	keyword: storage?.cache?.keyword ?? defaults.keyword,
	gateScreen: storage?.cache?.gateScreen ?? defaults.gateScreen,
	firstMethod: storage?.cache?.firstMethod ?? defaults.firstMethod,
	hints: storage?.cache?.hints ?? defaults.hints,
	hint: storage?.cache?.hint ?? defaults.hint,
	recovery: storage?.cache?.recovery ?? defaults.recovery,
	recoveryQuestion:
		storage?.cache?.recoveryQuestion ?? defaults.recoveryQuestion,
	protectNotifications:
		storage?.cache?.protectNotifications ?? defaults.protectNotifications,
})

let snapshot = read()
const listeners = new Set<() => void>()

export const getSnapshot = () => snapshot

export function publish() {
	snapshot = read()
	for (const listener of listeners) listener()
}

export function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function attachStorage(next: JsonStorage<LockSettings> | undefined) {
	storage = next
	publish()
}

export async function save(patch: Partial<LockSettings>) {
	if (!storage) return
	await storage.set({ ...read(), ...patch }, true)
	publish()
}

export async function setMembership(
	key: 'locked' | 'hidden',
	ids: string[],
	member: boolean,
) {
	const current = new Set(read()[key])
	for (const id of ids) {
		if (member) current.add(id)
		else current.delete(id)
	}
	await save({ [key]: [...current] })
}

export const fingerprintAllowed = (settings: LockSettings = read()) =>
	settings.biometric

export const isLocked = (id: string) => read().locked.includes(id)
export const isHidden = (id: string) => read().hidden.includes(id)
export const isProtected = (id: string) => isLocked(id) || isHidden(id)

const unlocked = new Set<string>()
let hiddenSession = false

export function isOpen(id: string) {
	if (unlocked.has(id)) return true
	return hiddenSession && isHidden(id)
}

export function markUnlocked(id: string) {
	unlocked.add(id)
	publish()
}

export function relock(id?: string) {
	if (id) unlocked.delete(id)
	else unlocked.clear()
	publish()
}

export function startHiddenSession() {
	hiddenSession = true
	publish()
}

export function endHiddenSession() {
	if (!hiddenSession) return
	hiddenSession = false
	publish()
}

export const inHiddenSession = () => hiddenSession

export function resetSessions() {
	unlocked.clear()
	hiddenSession = false
	publish()
}

export const hasPassword = () =>
	callNativeMethod('com.coder.chatlock.hasPassword', [])
		.then(value => value === true)
		.catch(() => false)

export const verifyPassword = (password: string) =>
	callNativeMethod('com.coder.chatlock.verifyPassword', [password])
		.then(value => value === true)
		.catch(() => false)

export const savePassword = (password: string, current?: string) =>
	callNativeMethod('com.coder.chatlock.savePassword', [
		password,
		current ?? null,
	])
		.then(value => value === true)
		.catch(() => false)

const call = (promise: Promise<unknown>) =>
	promise.then(value => value === true).catch(() => false)

export const hasRecovery = () =>
	call(callNativeMethod('com.coder.chatlock.hasRecovery', []))

export const saveRecovery = (answer: string) =>
	call(callNativeMethod('com.coder.chatlock.saveRecovery', [answer]))

export const clearRecovery = () =>
	call(callNativeMethod('com.coder.chatlock.clearRecovery', []))

export const verifyRecovery = (answer: string) =>
	call(callNativeMethod('com.coder.chatlock.verifyRecovery', [answer]))

export const resetPassword = (password: string, answer: string) =>
	call(callNativeMethod('com.coder.chatlock.resetPassword', [password, answer]))

export const syncNotifications = (
	enabled: boolean,
	locked: string[],
	hidden: string[],
) =>
	call(
		callNativeMethod('com.coder.chatlock.syncNotifications', [
			enabled,
			locked.join(','),
			hidden.join(','),
		]),
	)

export const deviceAvailable = () =>
	callNativeMethod('com.coder.chatlock.deviceAvailable', [])
		.then(value => value === true)
		.catch(() => false)

export const confirmDevice = (title: string) =>
	callNativeMethod('com.coder.chatlock.confirmDevice', [title])
		.then(value => value === true)
		.catch(() => false)

export interface Channel {
	id: string
	type?: number
	name?: string
	icon?: string | null
	guild_id?: string | null
	parent_id?: string | null
	recipients?: string[]
}

export function getChannel(id: string): Channel | undefined {
	return (Stores.ChannelStore as any)?.getChannel?.(id) ?? undefined
}

declare module '@valenced/modules/native' {
	export interface NativeMethods {
		'com.coder.chatlock.hasPassword': [args: [], returnValue: boolean]
		'com.coder.chatlock.verifyPassword': [
			args: [password: string],
			returnValue: boolean,
		]
		'com.coder.chatlock.savePassword': [
			args: [password: string, current: string | null],
			returnValue: boolean,
		]
		'com.coder.chatlock.hasRecovery': [args: [], returnValue: boolean]
		'com.coder.chatlock.saveRecovery': [
			args: [answer: string],
			returnValue: boolean,
		]
		'com.coder.chatlock.clearRecovery': [args: [], returnValue: boolean]
		'com.coder.chatlock.verifyRecovery': [
			args: [answer: string],
			returnValue: boolean,
		]
		'com.coder.chatlock.resetPassword': [
			args: [password: string, answer: string],
			returnValue: boolean,
		]
		'com.coder.chatlock.syncNotifications': [
			args: [enabled: boolean, locked: string, hidden: string],
			returnValue: boolean,
		]
		'com.coder.chatlock.deviceAvailable': [args: [], returnValue: boolean]
		'com.coder.chatlock.confirmDevice': [
			args: [title: string],
			returnValue: boolean,
		]
	}
}
