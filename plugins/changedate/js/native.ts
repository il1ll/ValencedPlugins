import { callNativeMethod } from '@valenced/modules/native'

export async function pickDateTime(value: number): Promise<number | undefined> {
	const result = await callNativeMethod('com.coder.changedate.pickDateTime', [
		value,
	])
	return typeof result === 'number' ? result : undefined
}

export async function isDevice24Hour(): Promise<boolean> {
	const result = await callNativeMethod('com.coder.changedate.is24Hour', [])
	return result === true
}

declare module '@valenced/modules/native' {
	export interface NativeMethods {
		'com.coder.changedate.pickDateTime': [
			args: [value: number],
			returnValue: number | null,
		]
		'com.coder.changedate.is24Hour': [args: [], returnValue: boolean]
	}
}
