import type { JsonStorage } from '@valenced/json-storage'
import {
	DEFAULTS,
	type NativeState,
	type TextAnimationStorage,
	callNative,
} from '../native'
import { reportError } from '../shared/report'

let storage: JsonStorage<TextAnimationStorage> | undefined

export function setStorage(handle: JsonStorage<TextAnimationStorage>) {
	storage = handle
}

export function useSettings(): TextAnimationStorage {
	return { ...DEFAULTS, ...(storage?.use() ?? {}) }
}

let cursorSupported = true

export function setCursorSupported(value: boolean) {
	cursorSupported = value
}

export function isCursorSupported() {
	return cursorSupported
}

export function update(patch: Partial<TextAnimationStorage>) {
	storage?.set(patch)
	callNative('setSettings', [patch])
		.then((state: NativeState) => {
			if (state && typeof state.cursorSupported === 'boolean')
				cursorSupported = state.cursorSupported
		})
		.catch(error => reportError('[TextAnimation] setSettings failed:', error))
}
