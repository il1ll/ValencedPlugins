import { callNativeMethod } from '@valenced/modules/native'

export type EntryKind = 'image' | 'text' | 'unsupported'

export interface ZipEntry {
	path: string
	name: string
	size: number
	extension: string
	kind: EntryKind
}

export interface ZipListing {
	key: string
	entries: ZipEntry[]
	truncated: boolean
}

export interface TextPreview {
	text: string
	truncated: boolean
}

export const openZip = (url: string) =>
	callNativeMethod('com.coder.filepreview.open', [url])

export const readText = (key: string, path: string) =>
	callNativeMethod('com.coder.filepreview.text', [key, path])

export const extractImage = (key: string, path: string) =>
	callNativeMethod('com.coder.filepreview.image', [key, path])

export const saveEntry = (key: string, path: string) =>
	callNativeMethod('com.coder.filepreview.save', [key, path])

export const fetchTextAttachment = (url: string) =>
	callNativeMethod('com.coder.filepreview.fetchText', [url])

export const saveAttachment = (url: string, name: string) =>
	callNativeMethod('com.coder.filepreview.saveUrl', [url, name])

export function errorMessage(error: unknown, fallback: string) {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: undefined
	if (!message) return fallback
	const clean = message.replace(/^.*PreviewError:\s*/, '').trim()
	return clean || fallback
}

declare module '@valenced/modules/native' {
	export interface NativeMethods {
		'com.coder.filepreview.open': [args: [url: string], returnValue: ZipListing]
		'com.coder.filepreview.text': [
			args: [key: string, path: string],
			returnValue: TextPreview,
		]
		'com.coder.filepreview.image': [
			args: [key: string, path: string],
			returnValue: string,
		]
		'com.coder.filepreview.fetchText': [
			args: [url: string],
			returnValue: TextPreview,
		]
		'com.coder.filepreview.saveUrl': [
			args: [url: string, name: string],
			returnValue: string,
		]
		'com.coder.filepreview.save': [
			args: [key: string, path: string],
			returnValue: string,
		]
	}
}
