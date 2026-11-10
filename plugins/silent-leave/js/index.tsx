import { getAssetIdByName } from '@valenced/assets'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import {
	ActionSheetActionCreators,
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { getModules, lookupModule } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { createElement } from 'react'
import { Image } from 'react-native'
import type { DiscordModules } from '@valenced/discord/types'
import type { FC, ReactElement, ReactNode } from 'react'

const GROUP_DM = 3

interface Channel {
	id: string
	type?: number
	name?: string
}

interface ChannelActionSheetProps {
	channel: Channel
	onClose?: () => void
}

type ChannelActionSheet = FC<ChannelActionSheetProps>
type Element = ReactElement<{ children?: ReactNode }>

const toast = (text: string, ok: boolean) =>
	ToastActionCreators.open('SILENT_LEAVE', {
		text,
		variant: ok ? 'success' : 'critical',
	})

async function leaveSilently(channelId: string) {
	try {
		const [APIUtils] = lookupModule(withProps<any>('getAPIBaseURL', 'del'))
		if (!APIUtils) throw new Error('Discord API module not found')

		await APIUtils.del({
			url: `/channels/${channelId}`,
			query: 'silent=true',
		})
		toast('Left Group DM successfully.', true)
	} catch {
		toast('Failed to leave Group DM.', false)
	}
}

function confirmLeave(channel: Channel) {
	const { AlertModal, AlertActionButton } = Design
	const name = channel.name || 'this group'

	AlertActionCreators.openAlert(
		'SILENT_LEAVE_CONFIRM',
		<AlertModal
			title="Leave Group Silently?"
			content={`You will leave ${name} without notifying the other members.`}
			actions={
				<>
					<AlertActionButton
						text="Leave Silently"
						variant="destructive"
						onPress={() => leaveSilently(channel.id)}
					/>
					<AlertActionButton text="Cancel" variant="secondary" />
				</>
			}
		/>,
	)
}

function resolveChannel(channel: Channel | undefined): Channel | undefined {
	if (!channel?.id) return
	return (Stores.ChannelStore as any)?.getChannel?.(channel.id) ?? channel
}

let useDangerStyles: (() => { icon: { tintColor: any } }) | undefined

const DangerDoorExitIcon: DiscordModules.Components.BaseIconImage = props => {
	useDangerStyles ??= Design.createStyles({
		icon: { tintColor: Tokens.default.colors.ICON_FEEDBACK_CRITICAL },
	})
	const tint = useDangerStyles().icon.tintColor
	const Icon = lookupGeneratedIconComponent('DoorExitIcon')

	if (Icon)
		return (
			<Icon
				{...props}
				color={tint}
				style={[props.style, { tintColor: tint }]}
			/>
		)

	return (
		<Image
			{...props}
			source={getAssetIdByName('DoorExitIcon')!}
			style={[{ width: 24, height: 24 }, props.style, { tintColor: tint }]}
		/>
	)
}

function SilentLeaveRow({ channel, onClose }: ChannelActionSheetProps) {
	const { ActionSheetRow } = Design
	return (
		<ActionSheetRow
			label="Leave Silently"
			variant="danger"
			icon={<TableRowAssetIcon IconComponent={DangerDoorExitIcon} />}
			onPress={() => {
				if (onClose) onClose()
				else ActionSheetActionCreators.hideActionSheet()
				confirmLeave(channel)
			}}
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

const isLeaveRow = (row: any) => /leave/i.test(String(row?.props?.label ?? ''))

function findActionSheet(element: unknown): Element | undefined {
	if (!element || typeof element !== 'object') return
	if (Array.isArray(element)) {
		for (const child of element) {
			const found = findActionSheet(child)
			if (found) return found
		}
		return
	}

	const { type, props } = element as Element
	if (type === Design.ActionSheet) return element as Element
	return findActionSheet(props?.children)
}

function addToActionSheet(tree: unknown, row: ReactNode) {
	const sheet = findActionSheet(tree)
	if (!sheet) return

	const groups = [sheet.props.children].flat().filter(Boolean) as Element[]

	let fallback: { group: Element; rows: ReactNode[] } | undefined
	for (let i = groups.length - 1; i >= 0; i--) {
		const group = groups[i]
		if (!isRowGroup(group)) continue

		const rows = [group.props.children].flat().filter(Boolean) as ReactNode[]
		const leaveIndex = rows.findIndex(isLeaveRow)
		if (leaveIndex !== -1) {
			rows.splice(leaveIndex + 1, 0, row)
			group.props.children = rows
			return
		}
		fallback ??= { group, rows }
	}

	if (fallback) {
		fallback.rows.push(row)
		fallback.group.props.children = fallback.rows
		return
	}

	const { ActionSheetRow } = Design
	groups.push(
		<ActionSheetRow.Group key="silent-leave">{row}</ActionSheetRow.Group>,
	)
	sheet.props.children = groups
}

export default plugin({
	start({ cleanup, logger }) {
		const wrappers = new WeakMap<ChannelActionSheet, ChannelActionSheet>()

		const wrap = (Inner: ChannelActionSheet) => {
			let Wrapper = wrappers.get(Inner)
			if (!Wrapper) {
				Wrapper = props => {
					const tree = Inner(props) as Element

					try {
						const channel = resolveChannel(props.channel)
						if (channel?.type === GROUP_DM)
							addToActionSheet(
								tree,
								<SilentLeaveRow
									key="silent-leave"
									channel={channel}
									onClose={props.onClose}
								/>,
							)
					} catch (e) {
						logger.error('Failed to add the Leave Silently button', e)
					}

					return tree
				}
				wrappers.set(Inner, Wrapper)
			}

			return Wrapper
		}

		cleanup(
			getModules(
				withName<ChannelActionSheet>('ChannelLongPressActionSheet'),
				mod => {
					const module = mod as { default: ChannelActionSheet }
					cleanup(
						instead(module, 'default', (args, Sheet) => {
							const tree = Reflect.apply(
								Sheet,
								undefined,
								args,
							) as ReactElement<ChannelActionSheetProps> | null

							const Inner = tree?.type
							if (
								typeof Inner !== 'function' ||
								Inner.name !== 'ChannelLongPressActionSheetConnected'
							)
								return tree

							return createElement(wrap(Inner as ChannelActionSheet), {
								...tree!.props,
								key: tree!.key,
							})
						}),
					)
				},
				{ returnNamespace: true },
			),
		)
	},
})
