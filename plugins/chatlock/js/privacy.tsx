import { Design } from '@valenced/discord/design'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { instead } from '@valenced/patcher'
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { LockedChatGate } from './gate'
import { authenticate } from './prompts'
import { getSnapshot, isOpen, isProtected, subscribe } from './state'

const PREVIEW_PATH =
	'modules/main_tabs_v2/native/shared_components/ChannelRowPreview.tsx'
const DETAILS_PATH =
	'modules/main_tabs_v2/native/sidebar/details/ChannelDetails.tsx'
const FALLBACK_LENGTH = 3
const MAX_LENGTH = 120
const CALL_PATH = 'actions/CallActionCreators.tsx'

type Hook = (props: any, render: () => unknown) => unknown

function previewChannel(props: any): string | undefined {
	const id =
		props?.channel?.id ?? props?.message?.channel_id ?? props?.channelId
	return typeof id === 'string' ? id : undefined
}

function useProtected(id: string | undefined, open: boolean) {
	return useSyncExternalStore(subscribe, () => {
		getSnapshot()
		if (!id || !isProtected(id)) return false
		return open ? !isOpen(id) : true
	})
}

function patchExport(
	module: any,
	key: string,
	hook: Hook,
	cleanup: (fn: () => void) => void,
) {
	const target = module?.[key]
	const host =
		typeof target === 'function'
			? { object: module, key }
			: typeof target?.type === 'function'
				? { object: target, key: 'type' }
				: undefined
	if (!host) return
	cleanup(
		instead(host.object, host.key, function (this: unknown, args, original) {
			return hook(args[0], () => Reflect.apply(original, this, args))
		}),
	)
}

function maskFor(message: any) {
	const content = typeof message?.content === 'string' ? message.content : ''
	const length = Array.from(content.replace(/\s+/g, ' ').trim()).length
	return '*'.repeat(Math.min(length || FALLBACK_LENGTH, MAX_LENGTH))
}

function MaskedPreview({
	color,
	message,
}: {
	color?: string
	message?: unknown
}) {
	const { Text } = Design
	return (
		<Text
			variant="text-sm/medium"
			color={typeof color === 'string' ? color : 'text-muted'}
			lineClamp={1}
		>
			{maskFor(message)}
		</Text>
	)
}

function PreviewGuard({
	id,
	color,
	message,
	output,
}: {
	id: string
	color?: string
	message?: unknown
	output: ReactNode
}) {
	const masked = useProtected(id, false)
	if (!masked) return <>{output}</>
	return <MaskedPreview color={color} message={message} />
}

function DetailsGuard({
	id,
	onBack,
	output,
}: {
	id: string
	onBack?: () => void
	output: ReactNode
}) {
	const locked = useProtected(id, true)
	if (!locked) return <>{output}</>
	return <LockedChatGate channelId={id} onBack={onBack} />
}

export function patchPrivacy(cleanup: (fn: () => void) => void) {
	cleanup(
		getModuleWithImportedPath<any>(PREVIEW_PATH, module => {
			patchExport(
				module,
				'ChannelRowPreview',
				(props, render) => {
					const output = render() as ReactNode
					const id = previewChannel(props)
					if (!id) return output
					return (
						<PreviewGuard
							id={id}
							color={props?.color}
							message={props?.message}
							output={output}
						/>
					)
				},
				cleanup,
			)
		}),
	)

	cleanup(
		getModuleWithImportedPath<any>(DETAILS_PATH, module =>
			patchExport(
				module,
				'default',
				(props, render) => {
					const output = render() as ReactNode
					const id =
						typeof props?.channelId === 'string' ? props.channelId : undefined
					if (!id) return output
					const onBack =
						typeof props?.onBackPress === 'function'
							? () => props.onBackPress()
							: undefined
					return <DetailsGuard id={id} onBack={onBack} output={output} />
				},
				cleanup,
			),
		),
	)

	cleanup(
		getModuleWithImportedPath<any>(CALL_PATH, module => {
			const actions = module?.default
			if (typeof actions?.call !== 'function') return
			cleanup(
				instead(actions, 'call', function (this: unknown, args, original) {
					const id =
						typeof args[0] === 'string' ? (args[0] as string) : undefined
					if (!id || !isProtected(id) || isOpen(id))
						return Reflect.apply(original, this, args)
					void authenticate(
						'Call Locked Chat',
						'Enter your password to call this chat.',
					).then(ok => {
						if (ok) Reflect.apply(original, this, args)
					})
				}),
			)
		}),
	)
}
