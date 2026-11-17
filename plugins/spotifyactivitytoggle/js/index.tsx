import { getAssetIdByName } from '@valenced/assets'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { getModules, lookupModule } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withProps,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { useReRender } from '@valenced/utils/react'
import { Children, Fragment, isValidElement, useEffect } from 'react'
import { View } from 'react-native'
import type { Filter, FilterGenerator } from '@valenced/modules/finders/filters'
import type {
	ComponentType,
	FC,
	MemoExoticComponent,
	ReactElement,
	ReactNode,
} from 'react'

const { IconButton } = Design

interface Connection {
	id: string
	type: string
	show_activity?: boolean
	showActivity?: boolean
}

let spotifyId: string | null = null
let showActivity = false
let loading: Promise<void> | null = null
let busy = false

const listeners = new Set<() => void>()

function notify() {
	for (const listener of listeners) listener()
}

function rest(): any {
	return lookupModule(withProps<any>('getAPIBaseURL', 'get', 'patch'))[0]
}

function activityOf(connection: Connection) {
	return !!(connection.show_activity ?? connection.showActivity)
}

function readStore() {
	const store = (Stores as any).ConnectedAccountsStore
	const accounts: Connection[] = store?.getAccounts?.() ?? []
	const spotify = accounts.find(account => account?.type === 'spotify')
	if (!spotify) return false
	spotifyId = spotify.id
	showActivity = activityOf(spotify)
	return true
}

function load() {
	loading ??= (async () => {
		try {
			const response = await rest()?.get({ url: '/users/@me/connections' })
			const list: Connection[] = response?.body ?? []
			const spotify = list.find(connection => connection?.type === 'spotify')
			spotifyId = spotify?.id ?? null
			showActivity = spotify ? activityOf(spotify) : false
		} catch {
			readStore()
		}
		notify()
	})()
	return loading
}

function connectionActions(): any {
	return lookupModule(withProps<any>('setShowActivity', 'setVisibility'))[0]
}

async function toggle() {
	if (!spotifyId || busy) return
	busy = true
	const id = spotifyId
	const next = !showActivity
	showActivity = next
	notify()
	try {
		const actions = connectionActions()
		if (actions?.setShowActivity)
			await actions.setShowActivity('spotify', id, next)
		else
			await rest()?.patch({
				url: `/users/@me/connections/spotify/${id}`,
				body: { show_activity: next },
			})
	} catch {
		showActivity = !next
	}
	busy = false
	notify()
}

interface ButtonLook {
	Container: ComponentType<{ children?: ReactNode }>
	size: 'sm' | 'md' | 'lg'
	variant: any
}

let look: ButtonLook | null = null
let lookTimer: ReturnType<typeof setTimeout> | undefined

export default plugin({
	start({ cleanup, plugin }) {
		if (plugin.startedLate) {
			plugin.requireReload()
			return
		}

		load()

		cleanup(
			() => {
				listeners.clear()
				clearTimeout(lookTimer)
				spotifyId = null
				showActivity = false
				loading = null
				look = null
			},
			getModules(
				withMemoizedComponentName('YouBarNotificationsButton'),
				YouBarNotificationsButton => {
					if (!YouBarNotificationsButton?.type) return
					cleanup(
						instead(YouBarNotificationsButton, 'type', (args, orig) => {
							const res = orig(...args)
							capture(res)
							return res
						}),
						afterJSX(YouBarNotificationsButton, element => (
							<Fragment key={element.key ?? 'spotify-activity-youbar'}>
								<SpotifyButton />
								{element}
							</Fragment>
						)),
					)
				},
			),
		)
	},
	stop({ plugin }) {
		plugin.requireReload()
	},
})

function isButtonContainer(node: unknown): node is ButtonContainer {
	if (!isValidElement(node)) return false
	const child = (node.props as { children?: unknown }).children
	return (
		isValidElement(child) && (child.props as { icon?: unknown }).icon != null
	)
}

function findContainer(node: unknown): ButtonContainer | undefined {
	if (isButtonContainer(node)) return node
	if (!isValidElement(node)) return undefined
	for (const child of Children.toArray(
		(node.props as { children?: ReactNode }).children,
	)) {
		const found = findContainer(child)
		if (found) return found
	}
	return undefined
}

function capture(res: unknown) {
	if (look) return
	const base = findContainer(res)
	if (!base) return
	const original = base.props.children.props
	look = {
		Container: base.type,
		size: original.size ?? 'sm',
		variant:
			original.variant && original.variant !== 'destructive'
				? original.variant
				: 'tertiary',
	}
	lookTimer = setTimeout(notify, 0)
}

const SLASH_GAP = '#d32d39'

function Slash() {
	return (
		<View
			pointerEvents="none"
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<View
				style={{
					width: 25,
					height: 6,
					borderRadius: 3,
					backgroundColor: '#ffffff',
					borderColor: SLASH_GAP,
					borderWidth: 2,
					transform: [{ rotate: '-45deg' }],
				}}
			/>
		</View>
	)
}

function SpotifyButton() {
	const rerender = useReRender()

	useEffect(() => {
		listeners.add(rerender)
		const store = (Stores as any).ConnectedAccountsStore
		const sync = () => {
			if (!busy && readStore()) rerender()
		}
		store?.addChangeListener?.(sync)
		return () => {
			listeners.delete(rerender)
			store?.removeChangeListener?.(sync)
		}
	}, [rerender])

	if (!spotifyId || !look) return null

	const { Container, size, variant } = look

	return (
		<Container>
			<View>
				<IconButton
					accessibilityLabel={
						showActivity ? 'Hide Spotify activity' : 'Show Spotify activity'
					}
					accessibilityRole="switch"
					accessibilityState={{ checked: showActivity }}
					variant={showActivity ? variant : 'destructive'}
					size={size}
					icon={getAssetIdByName('SpotifyNeutralIcon')!}
					onPress={() => void toggle()}
				/>
				{!showActivity && <Slash />}
			</View>
		</Container>
	)
}

type WithMemoizedComponentName = FilterGenerator<
	<P = object>(
		name: string,
	) => Filter<{
		Result: MemoExoticComponent<FC<P>>
		Scopes: [typeof FilterScopes.Initialized]
	}>
>

const withMemoizedComponentName = createFilterGenerator(
	([name], _, exports) => exports?.type?.name === name,
	([name]) => `memoizedComponentName(${name})`,
	FilterScopes.Initialized,
) as WithMemoizedComponentName

type ButtonContainer = ReactElement<
	{
		children: ReactElement<{
			icon: number
			size?: 'sm' | 'md' | 'lg'
			variant?: any
		}>
	},
	ComponentType<{ children?: ReactNode }>
>
