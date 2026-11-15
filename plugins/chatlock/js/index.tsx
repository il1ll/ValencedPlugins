import { getStore } from '@valenced/discord/flux'
import { AppState } from 'react-native'
import { forgetRequest, patchGate } from './gate'
import { patchGuard } from './guard'
import { patchHidden } from './hidden'
import { patchNotifications } from './notifications'
import { patchPrivacy } from './privacy'
import { SettingsPage } from './settings'
import { patchSheets } from './sheets'
import {
	attachStorage,
	defaults,
	endHiddenSession,
	isHidden,
	relock,
	resetSessions,
} from './state'
import type { LockSettings } from './state'

interface SelectedChannelStore {
	getChannelId(): string | null | undefined
	addChangeListener(listener: () => void): void
	removeChangeListener(listener: () => void): void
}

export default plugin<{ jsonStorage: LockSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	start({ cleanup, jsonStorage }) {
		attachStorage(jsonStorage)
		cleanup(jsonStorage.subscribe(() => attachStorage(jsonStorage)))

		patchGate(cleanup)
		patchHidden(cleanup)
		patchSheets(cleanup)
		patchGuard(cleanup)
		patchNotifications(cleanup)
		patchPrivacy(cleanup)

		cleanup(
			getStore<any>('SelectedChannelStore', store => {
				const selected = store as unknown as SelectedChannelStore
				let current = selected.getChannelId() ?? undefined
				const onChange = () => {
					const next = selected.getChannelId() ?? undefined
					if (next === current) return
					const previous = current
					current = next
					if (previous) {
						relock(previous)
						forgetRequest(previous)
					}
					if (!next || !isHidden(next)) endHiddenSession()
				}
				selected.addChangeListener(onChange)
				cleanup(() => selected.removeChangeListener(onChange))
			}),
		)

		const subscription = AppState.addEventListener('change', state => {
			if (state === 'background') resetSessions()
		})
		cleanup(() => subscription.remove())

		cleanup(() => {
			resetSessions()
			attachStorage(undefined)
		})
	},
	SettingsComponent: SettingsPage,
})
