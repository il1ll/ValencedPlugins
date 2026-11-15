import { Platform } from 'react-native'
import { showToast } from './toast'

export function isAndroid(): boolean {
	try {
		return Platform.OS !== 'ios'
	} catch {
		return true
	}
}

export function stopUnlessAndroid(
	plugin: { disable(): Promise<void> },
	name: string,
): boolean {
	if (isAndroid()) return false
	showToast(
		`${name} needs Android, so it's been turned off.`,
		`AndroidOnly:${name}`,
	)
	setTimeout(() => {
		plugin.disable().catch(() => {})
	}, 0)
	return true
}
