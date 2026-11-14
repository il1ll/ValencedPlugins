import { getAssetIdByName } from '@valenced/assets'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { lookupModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { instead } from '@valenced/patcher'
import { useEffect, useSyncExternalStore } from 'react'
import { authenticate } from './prompts'
import {
	getSnapshot,
	isOpen,
	isProtected,
	markUnlocked,
	read,
	relock,
	subscribe,
} from './state'
import { Image, View } from 'react-native'
import type { ReactNode } from 'react'

const GATE_PATH = 'modules/chat/native/useChannelContentGate.tsx'
const ROUTER_PATH = 'modules/routing/router_utils.tsx'
const LOCK_KIND = 'CHAT_LOCK'

let useStyles:
	| (() => {
			container: object
			title: object
			description: object
			buttonGroup: object
			iconCircle: object
			icon: object
	  })
	| undefined

function styles() {
	useStyles ??= Design.createStyles({
		container: {
			flex: 1,
			padding: 20,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: Tokens.default.colors.BACKGROUND_BASE_LOW,
		},
		title: { textAlign: 'center' },
		description: { textAlign: 'center' },
		buttonGroup: { width: '100%', maxWidth: 400 },
		iconCircle: {
			width: 88,
			height: 88,
			borderRadius: 44,
			marginBottom: 8,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: Tokens.default.colors.BACKGROUND_MOD_SUBTLE,
		},
		icon: {
			width: 44,
			height: 44,
			tintColor: Tokens.default.colors.INTERACTIVE_ICON_DEFAULT,
		},
	}) as any
	return useStyles!()
}

function useSafeNavigation(): any {
	try {
		return ReactNavigationNative.useNavigation()
	} catch {
		return undefined
	}
}

function goBack(navigation: any) {
	if (navigation?.canGoBack?.()) {
		navigation.goBack()
		return
	}
	const [router] = lookupModuleWithImportedPath<any>(ROUTER_PATH)
	router?.transitionTo?.('/channels/@me')
}

export function LockedChatGate({
	channelId,
	onBack,
}: {
	channelId: string
	onBack?: () => void
}) {
	const { Stack, Text, Button } = Design
	const Heading: any = (Design as any).Heading ?? Text
	const ButtonGroup: any =
		(Design as any).ButtonGroup ??
		(({ children, style }: { children: ReactNode; style?: object }) => (
			<Stack spacing={8} style={style}>
				{children}
			</Stack>
		))
	const style = styles()
	const navigation = useSafeNavigation()
	const lockIcon = getAssetIdByName('LockIcon')

	return (
		<Stack spacing={16} style={style.container}>
			<Stack align="center">
				{lockIcon !== undefined ? (
					<View style={style.iconCircle}>
						<Image source={lockIcon} style={style.icon} />
					</View>
				) : null}
				<Heading
					variant="heading-xxl/bold"
					maxFontSizeMultiplier={2}
					style={style.title}
				>
					Locked Chat
				</Heading>
				<Text
					color="text-muted"
					variant="text-md/medium"
					maxFontSizeMultiplier={2}
					style={style.description}
				>
					This chat is locked. Unlock it with your fingerprint or password to
					see the messages.
				</Text>
			</Stack>
			<ButtonGroup style={style.buttonGroup}>
				<Button
					variant="primary"
					text="Unlock"
					onPress={() =>
						void authenticate('Unlock Chat').then(ok => {
							if (ok) markUnlocked(channelId)
						})
					}
				/>
				<Button
					variant="secondary"
					text="Go Back"
					onPress={() => (onBack ? onBack() : goBack(navigation))}
				/>
			</ButtonGroup>
		</Stack>
	)
}

const CHANNEL_PATH = /^\/channels\/(?:@me|\d+)\/(\d+)/

function channelFromPath(path: unknown) {
	const value =
		typeof path === 'string'
			? path
			: typeof (path as any)?.pathname === 'string'
				? (path as any).pathname
				: undefined
	return value ? CHANNEL_PATH.exec(value)?.[1] : undefined
}

const pending = new Set<string>()

function beforeOpen(channelId: string | undefined, proceed: () => unknown) {
	if (
		read().gateScreen ||
		!channelId ||
		!isProtected(channelId) ||
		isOpen(channelId)
	)
		return proceed()
	if (pending.has(channelId)) return
	pending.add(channelId)
	void authenticate('Unlock Chat')
		.then(ok => {
			if (!ok) return
			markUnlocked(channelId)
			proceed()
		})
		.finally(() => pending.delete(channelId))
}

function patchRouter(router: any, cleanup: (fn: () => void) => void) {
	for (const key of ['transitionTo', 'replaceWith'])
		if (typeof router?.[key] === 'function')
			cleanup(
				instead(router, key, function (this: unknown, args, original) {
					return beforeOpen(channelFromPath(args[0]), () =>
						Reflect.apply(original, this, args),
					)
				}),
			)
	if (typeof router?.transitionToGuild === 'function')
		cleanup(
			instead(
				router,
				'transitionToGuild',
				function (this: unknown, args, original) {
					const channelId =
						typeof args[1] === 'string' ? (args[1] as string) : undefined
					return beforeOpen(channelId, () =>
						Reflect.apply(original, this, args),
					)
				},
			),
		)
}

export function patchGate(cleanup: (fn: () => void) => void) {
	cleanup(
		getModuleWithImportedPath<any>(ROUTER_PATH, router =>
			patchRouter(router, cleanup),
		),
	)

	cleanup(
		getModuleWithImportedPath<any>(GATE_PATH, gate => {
			if (typeof gate?.useChannelContentGate === 'function')
				cleanup(
					instead(
						gate,
						'useChannelContentGate',
						function (this: unknown, args, original) {
							const result = Reflect.apply(original, this, args)
							const channel = args[1] as { id?: string } | undefined
							const id = channel?.id
							const locked = useSyncExternalStore(subscribe, () => {
								getSnapshot()
								return !!id && isProtected(id) && !isOpen(id)
							})
							useEffect(
								() => () => {
									if (id) relock(id)
								},
								[id],
							)
							if (locked)
								return { kind: LOCK_KIND, guildId: args[0], channelId: id }
							return result
						},
					),
				)
			if (typeof gate?.renderChannelContentGate === 'function')
				cleanup(
					instead(
						gate,
						'renderChannelContentGate',
						function (this: unknown, args, original) {
							const target = args[0] as
								| { kind?: string; channelId?: string }
								| undefined
							if (target?.kind === LOCK_KIND && target.channelId)
								return <LockedChatGate channelId={target.channelId} />
							return Reflect.apply(original, this, args)
						},
					),
				)
		}),
	)
}
