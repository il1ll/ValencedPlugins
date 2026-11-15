import { ToastActionCreators } from '@valenced/discord/actions'

export function showToast(content: string, key = 'SharedToast') {
	try {
		const creators = ToastActionCreators as any
		const mana = { text: content }
		if (typeof creators.openMana === 'function') {
			creators.openMana(key, mana)
			return
		}
		creators.open(key, mana)
	} catch {}
}
