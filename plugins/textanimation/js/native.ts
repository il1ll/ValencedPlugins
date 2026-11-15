import * as native from '@valenced/modules/native'

export interface TextAnimationStorage {
	typing: boolean
	duration: number
	slide: boolean
	slideDp: number
	blur: boolean
	pop: boolean
	tilt: boolean
	popAmount: number
	tiltAmount: number
	deleteFx: 'off' | 'drop' | 'dust'
	cursor: boolean
	cursorTrail: boolean
	cursorSpeed: number
	everywhere: boolean
}

export interface NativeState extends TextAnimationStorage {
	cursorSupported: boolean
}

export const DEFAULTS: TextAnimationStorage = {
	typing: true,
	duration: 320,
	slide: true,
	slideDp: 10,
	blur: true,
	pop: false,
	tilt: false,
	popAmount: 100,
	tiltAmount: 100,
	deleteFx: 'drop',
	cursor: true,
	cursorTrail: true,
	cursorSpeed: 18,
	everywhere: false,
}

const METHOD = 'com.coder.textanimation'

export function callNative(name: string, args: any[] = []): Promise<any> {
	return (native as any).callNativeMethod(`${METHOD}.${name}`, args)
}
