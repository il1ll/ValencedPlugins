import { patchMenu } from './menu'
import { patchNames } from './names'
import { SettingsPage } from './settings'
import { bindStorage, defaults, refreshNames } from './state'
import type { FakeNicknameSettings } from './state'

export default plugin<{ jsonStorage: FakeNicknameSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	async start(api) {
		const { cleanup, jsonStorage } = api
		await jsonStorage.get()
		bindStorage(jsonStorage)
		patchNames(cleanup)
		patchMenu(cleanup)
		refreshNames()
		cleanup(() => {
			bindStorage(undefined)
			refreshNames()
		})
	},
	SettingsComponent: SettingsPage,
})
