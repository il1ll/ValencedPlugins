import { lookupModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { callNativeMethod } from '@valenced/modules/native'

interface VoiceEngine {
	stopBroadcast(): void
}

interface MediaEngineInject {
	getVoiceEngine(): VoiceEngine
	getOpenH264LibraryPath(): unknown
}

interface ScreenshareUtils {
	stopScreenshare(): void
}

interface StreamActionCreators {
	stopOwnStream(): void
	watchStreamAndTransitionToStream(): unknown
}

const SCREENSHARE_UTILS_PATH =
	'modules/video_calls/native/useScreenshareUtils.tsx'

let session = 0

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function voiceEngine() {
	const [inject] = lookupModule(
		withProps<MediaEngineInject>('getVoiceEngine', 'getOpenH264LibraryPath'),
	)
	return inject?.getVoiceEngine()
}

function stopSharing() {
	const [utils] = lookupModuleWithImportedPath<ScreenshareUtils>(
		SCREENSHARE_UTILS_PATH,
	)
	if (utils?.stopScreenshare) {
		utils.stopScreenshare()
		return
	}

	voiceEngine()?.stopBroadcast()
	const [streams] = lookupModule(
		withProps<StreamActionCreators>(
			'stopOwnStream',
			'watchStreamAndTransitionToStream',
		),
	)
	streams?.stopOwnStream()
}

function dispatch(token: number, action: string) {
	if (session !== token) return
	try {
		if (action === 'stop') stopSharing()
	} catch (error) {
		console.warn('[StreamButton] screen share action failed', error)
	}
}

async function listen(token: number) {
	while (session === token) {
		let action: string
		try {
			action = await callNativeMethod('com.coder.streambutton.nextAction', [])
		} catch {
			await sleep(2000)
			continue
		}
		if (session !== token || action === 'shutdown') return
		dispatch(token, action)
	}
}

declare module '@valenced/modules/native' {
	export interface NativeMethods {
		'com.coder.streambutton.nextAction': [args: [], returnValue: string]
	}
}

export default plugin({
	start({ cleanup }) {
		const token = ++session
		void listen(token)
		cleanup(() => {
			if (session === token) session++
		})
	},
})
