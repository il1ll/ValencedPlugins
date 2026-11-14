import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import {
	cloneElement,
	createContext,
	useContext,
	useSyncExternalStore,
} from 'react'
import { authenticate, chooseKeyword, ensurePassword } from './prompts'
import {
	getChannel,
	getSnapshot,
	read,
	relock,
	setMembership,
	subscribe,
} from './state'
import type { ComponentType, FC, ReactElement, ReactNode } from 'react'

const SHEET_PATHS = [
	'modules/threads/native/components/ThreadLongPressActionSheet.tsx',
	'modules/action_sheet/native/components/LongPressForumPostActionSheet.tsx',
]

interface SheetProps {
	channel?: { id?: string }
	thread?: { id?: string }
	channelId?: string
	onClose?: () => void
}

interface SheetTarget {
	id: string
	onClose?: () => void
}

type Element = ReactElement<{ children?: ReactNode }>

const SheetContext = createContext<SheetTarget | undefined>(undefined)

export const toast = (text: string, ok = true) =>
	ToastActionCreators.open('CHAT_LOCK', {
		text,
		variant: ok ? 'success' : 'critical',
	})

async function lockChat(id: string) {
	if (!(await ensurePassword())) return
	await setMembership('locked', [id], true)
	relock(id)
	toast('Chat locked')
}

async function unlockChat(id: string) {
	if (!(await authenticate('Unlock Chat'))) return
	await setMembership('locked', [id], false)
	toast('Chat unlocked')
}

async function hideChat(id: string) {
	if (!(await ensurePassword())) return
	if (!read().keyword && !(await chooseKeyword(false))) return
	await setMembership('hidden', [id], true)
	relock(id)
	toast(`Chat hidden. Type "${read().keyword}" in the DM search to find it.`)
}

async function unhideChat(id: string) {
	if (!(await authenticate('Unhide Chat'))) return
	await setMembership('hidden', [id], false)
	toast('Chat is visible again')
}

function useRun(onClose?: () => void) {
	return (action: () => Promise<void>) => {
		if (onClose) onClose()
		else ActionSheetActionCreators.hideActionSheet()
		void action()
	}
}

interface RowProps extends SheetTarget {
	[key: string]: unknown
}

function LockRow({ id, onClose, ...rest }: RowProps) {
	const { ActionSheetRow } = Design
	const locked = useSyncExternalStore(subscribe, () =>
		getSnapshot().locked.includes(id),
	)
	const run = useRun(onClose)
	return (
		<ActionSheetRow
			{...rest}
			label={locked ? 'Unlock Chat' : 'Lock Chat'}
			icon={
				<TableRowAssetIcon name={locked ? 'LockUnlockedIcon' : 'LockIcon'} />
			}
			onPress={() => run(() => (locked ? unlockChat(id) : lockChat(id)))}
		/>
	)
}

function HideRow({ id, onClose, ...rest }: RowProps) {
	const { ActionSheetRow } = Design
	const hidden = useSyncExternalStore(subscribe, () =>
		getSnapshot().hidden.includes(id),
	)
	const run = useRun(onClose)
	return (
		<ActionSheetRow
			{...rest}
			label={hidden ? 'Unhide Chat' : 'Hide Chat'}
			icon={<TableRowAssetIcon name={hidden ? 'EyeIcon' : 'EyeSlashIcon'} />}
			onPress={() => run(() => (hidden ? unhideChat(id) : hideChat(id)))}
		/>
	)
}

const isRowGroup = (element: any) => {
	const type = element?.type
	if (!type) return false
	return (
		type === Design.ActionSheetRow.Group ||
		type === Design.TableRowGroup ||
		/RowGroup/.test(type.displayName ?? type.name ?? '')
	)
}

function withRows(sheet: Element, target: SheetTarget): Element {
	const { ActionSheetRow } = Design
	const children = [sheet.props.children].flat(Infinity).filter(Boolean)
	const group = (
		<ActionSheetRow.Group key="chat-lock" hasIcons>
			<LockRow key="chat-lock-lock" id={target.id} onClose={target.onClose} />
			<HideRow key="chat-lock-hide" id={target.id} onClose={target.onClose} />
		</ActionSheetRow.Group>
	)
	const index = children.findIndex(isRowGroup)
	children.splice(index === -1 ? 0 : index, 0, group)
	return cloneElement(sheet, undefined, ...children)
}

function readTarget(): SheetTarget | undefined {
	try {
		return useContext(SheetContext)
	} catch {
		return undefined
	}
}

const targetOf = (props: SheetProps | undefined): SheetTarget | undefined => {
	const id = props?.thread?.id ?? props?.channel?.id ?? props?.channelId
	if (!id || !getChannel(id)) return
	return { id, onClose: props?.onClose }
}

let rendering: SheetTarget | undefined

function render(
	args: unknown[],
	Sheet: (...args: any[]) => unknown,
): ReactNode {
	const target = targetOf(args[0] as SheetProps | undefined)
	const previous = rendering
	rendering = target
	try {
		const tree = Reflect.apply(Sheet, undefined, args) as ReactNode
		if (!target) return tree
		return <SheetContext.Provider value={target}>{tree}</SheetContext.Provider>
	} finally {
		rendering = previous
	}
}

export function patchSheets(cleanup: (fn: () => void) => void) {
	cleanup(
		afterJSX(Design.ActionSheet as ComponentType<any>, element => {
			const target = rendering ?? readTarget()
			if (!target) return element
			return withRows(element as Element, target)
		}),
	)

	cleanup(
		getModules(
			withName<FC<SheetProps>>('ChannelLongPressActionSheet'),
			mod => {
				const module = mod as { default: FC<SheetProps> }
				cleanup(
					instead(module, 'default', (args, Sheet) => render(args, Sheet)),
				)
			},
			{ returnNamespace: true },
		),
	)

	for (const path of SHEET_PATHS)
		cleanup(
			getModuleWithImportedPath<any>(path, module => {
				if (typeof module?.default !== 'function') return
				cleanup(
					instead(module, 'default', (args, Sheet) => render(args, Sheet)),
				)
			}),
		)
}
