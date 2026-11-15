import { getAssetIdByName } from '@valenced/assets'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { getStore } from '@valenced/discord/flux'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { lookupModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { after, instead } from '@valenced/patcher'
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
const TRANSITION_PATH = 'modules/routing/transitionToChannel.tsx'
const ME = '@me'

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
const requested = new Set<string>()
let goToDMs: (() => void) | undefined
let redirecting = false

export function forgetRequest(channelId: string) {
	requested.delete(channelId)
}

function leaveToDMs() {
	if (redirecting || !goToDMs) return
	redirecting = true
	try {
		goToDMs()
	} finally {
		redirecting = false
	}
}

function beforeOpen(channelId: string | undefined, proceed: () => unknown) {
	if (!channelId || !isProtected(channelId) || isOpen(channelId))
		return proceed()
	if (!requested.has(channelId)) return leaveToDMs()
	if (read().gateScreen) return proceed()
	if (pending.has(channelId)) return
	pending.add(channelId)
	void authenticate('Unlock Chat')
		.then(ok => {
			if (!ok) {
				requested.delete(channelId)
				return
			}
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
	if (typeof router?.transitionToGuild === 'function') {
		goToDMs = () => router.transitionToGuild(ME)
		cleanup(() => {
			goToDMs = undefined
		})
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
}

function markRequests(cleanup: (fn: () => void) => void) {
	cleanup(
		getModuleWithImportedPath<any>(TRANSITION_PATH, module => {
			if (typeof module?.transitionToChannel !== 'function') return
			cleanup(
				instead(
					module,
					'transitionToChannel',
					function (this: unknown, args, original) {
						if (typeof args[0] === 'string') requested.add(args[0] as string)
						return Reflect.apply(original, this, args)
					},
				),
			)
		}),
	)
}

const REMEMBERED_GETTERS = [
	'getChannelId',
	'getLastSelectedChannelId',
	'getMostRecentSelectedTextChannelId',
]

function forgetProtected(cleanup: (fn: () => void) => void) {
	cleanup(
		getStore<any>('SelectedChannelStore', store => {
			const target = store as any
			const current = () => target.getCurrentlySelectedChannelId?.()
			for (const key of REMEMBERED_GETTERS)
				if (typeof target[key] === 'function')
					cleanup(
						after(target, key, (result: unknown) =>
							typeof result === 'string' &&
							isProtected(result) &&
							!isOpen(result) &&
							result !== current()
								? null
								: result,
						),
					)
		}),
	)
}

type GateHandler = (
	thisArg: unknown,
	args: unknown[],
	original: (...args: unknown[]) => unknown,
) => unknown

interface GateBridge {
	handler: GateHandler
	installed: boolean
}

const BRIDGE_KEY = '__comCoderChatLockGate'

const idleSubscribe = () => () => {}
const idleSnapshot = () => false

const passthroughGate: GateHandler = (thisArg, args, original) => {
	const result = Reflect.apply(original, thisArg, args)
	const id = (args[1] as { id?: string } | undefined)?.id
	useSyncExternalStore(idleSubscribe, idleSnapshot)
	useEffect(() => {}, [id])
	return result
}

const activeGate: GateHandler = (thisArg, args, original) => {
	const result = Reflect.apply(original, thisArg, args)
	const id = (args[1] as { id?: string } | undefined)?.id
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
	if (locked) return { kind: LOCK_KIND, guildId: args[0], channelId: id }
	return result
}

function gateBridge(): GateBridge {
	const scope = globalThis as unknown as Record<string, GateBridge | undefined>
	scope[BRIDGE_KEY] ??= { handler: passthroughGate, installed: false }
	return scope[BRIDGE_KEY]!
}

function installGateHook(gate: any, cleanup: (fn: () => void) => void) {
	const bridge = gateBridge()
	bridge.handler = activeGate
	cleanup(() => {
		bridge.handler = passthroughGate
	})
	if (bridge.installed) return
	bridge.installed = true
	instead(
		gate,
		'useChannelContentGate',
		function (this: unknown, args, original) {
			return gateBridge().handler(this, args, original)
		},
	)
}

export function patchGate(cleanup: (fn: () => void) => void) {
	forgetProtected(cleanup)
	markRequests(cleanup)
	cleanup(() => requested.clear())

	cleanup(
		getModuleWithImportedPath<any>(ROUTER_PATH, router =>
			patchRouter(router, cleanup),
		),
	)

	cleanup(
		getModuleWithImportedPath<any>(GATE_PATH, gate => {
			if (typeof gate?.useChannelContentGate === 'function')
				installGateHook(gate, cleanup)
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
