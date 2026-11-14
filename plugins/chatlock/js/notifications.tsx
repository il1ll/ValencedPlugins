import { Dispatcher } from '@valenced/discord/common/flux'
import { Design } from '@valenced/discord/design'
import { getStore } from '@valenced/discord/flux'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { after, instead } from '@valenced/patcher'
import { isHidden, isLocked, read, subscribe, syncNotifications } from './state'

const PREVIEW_PATH =
	'modules/in_app_notifications/native/MessagePreviewText.tsx'
const MEDIA_PATH =
	'modules/in_app_notifications/native/MediaPreviewRightAccessory.tsx'
const SOUND_PATH = 'modules/notifications/native/playInAppMessageSound.tsx'
const LOCKED_TEXT = 'New message'

const protecting = () => read().protectNotifications

const hiddenNow = (id: string | undefined) =>
	!!id && protecting() && isHidden(id)

const lockedNow = (id: string | undefined) =>
	!!id && protecting() && isLocked(id) && !isHidden(id)

function channelOf(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') return
	const record = value as Record<string, any>
	if (typeof record.channelId === 'string') return record.channelId
	if (typeof record.channel_id === 'string') return record.channel_id
	const message = record.message
	if (message && typeof message === 'object') {
		if (typeof message.channel_id === 'string') return message.channel_id
		if (typeof message.channelId === 'string') return message.channelId
	}
	const notification = record.notification
	if (notification && typeof notification === 'object')
		return channelOf(notification)
}

let signature = ''

function sync() {
	const settings = read()
	const next = [
		settings.protectNotifications,
		settings.locked.join(','),
		settings.hidden.join(','),
	].join('|')
	if (next === signature) return
	signature = next
	void syncNotifications(
		settings.protectNotifications,
		settings.locked,
		settings.hidden,
	)
}

function LockedPreview() {
	const { Text } = Design
	return (
		<Text variant="text-sm/medium" color="text-muted" lineClamp={1}>
			{LOCKED_TEXT}
		</Text>
	)
}

function patchComponent(
	path: string,
	replace: (props: unknown, output: unknown) => unknown,
	cleanup: (fn: () => void) => void,
) {
	cleanup(
		getModuleWithImportedPath<any>(path, module => {
			if (typeof module?.default !== 'function') return
			cleanup(
				instead(module, 'default', function (this: unknown, args, original) {
					const output = Reflect.apply(original, this, args)
					return replace(args[0], output)
				}),
			)
		}),
	)
}

export function patchNotifications(cleanup: (fn: () => void) => void) {
	signature = ''
	sync()
	cleanup(subscribe(sync))

	const skipped = new WeakSet<object>()

	cleanup(
		getStore<any>('InAppNotificationStore', store => {
			const target = store as any
			if (typeof target.getCurrentNotification !== 'function') return
			cleanup(
				after(target, 'getCurrentNotification', (result: unknown) => {
					if (!result || typeof result !== 'object') return result
					if (!hiddenNow(channelOf(result))) return result
					if (!skipped.has(result)) {
						skipped.add(result)
						setTimeout(() => {
							void Dispatcher.dispatch({ type: 'CLEAR_IN_APP_NOTIFICATION' })
						}, 0)
					}
					return null
				}),
			)
		}),
	)

	cleanup(
		getModuleWithImportedPath<any>(SOUND_PATH, module => {
			if (typeof module?.playInAppMessageSound !== 'function') return
			cleanup(
				instead(
					module,
					'playInAppMessageSound',
					function (this: unknown, args, original) {
						if (args.some(arg => hiddenNow(channelOf(arg)))) return
						return Reflect.apply(original, this, args)
					},
				),
			)
		}),
	)

	patchComponent(
		PREVIEW_PATH,
		(props, output) =>
			lockedNow(channelOf(props)) ? <LockedPreview /> : output,
		cleanup,
	)

	patchComponent(
		MEDIA_PATH,
		(props, output) => (lockedNow(channelOf(props)) ? null : output),
		cleanup,
	)
}
