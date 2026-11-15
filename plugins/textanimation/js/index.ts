import {
	DEFAULTS,
	type NativeState,
	type TextAnimationStorage,
	callNative,
} from './native'
import Settings from './ui/Settings'
import { setCursorSupported, setStorage } from './ui/state'
import { reportError, setReporter } from './shared/report'
import { isAndroid, stopUnlessAndroid } from './shared/androidOnly'

export default plugin<{ jsonStorage: TextAnimationStorage }>({
	jsonStorage: {
		load: true,
		default: DEFAULTS,
	},
	start({ jsonStorage, cleanup, plugin }) {
		if (stopUnlessAndroid(plugin, 'Text Animation')) return
		setReporter(plugin)
		cleanup(() => setReporter(undefined))

		setStorage(jsonStorage)
		callNative('getSettings')
			.then((state: NativeState) => {
				if (!state || typeof state.duration !== 'number') return
				const { cursorSupported, ...stored } = state
				setCursorSupported(cursorSupported)
				jsonStorage.set({ ...stored })
			})
			.catch(error => reportError('[TextAnimation] getSettings failed:', error))
	},
	stop() {
		if (!isAndroid()) return
		callNative('setPreview', [false]).catch(() => {})
	},
	SettingsComponent: Settings,
})
