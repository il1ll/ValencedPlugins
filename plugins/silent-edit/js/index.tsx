import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { getModules, lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, before, instead } from '@valenced/patcher'
import { findInReactFiber } from '@valenced/utils/react'
import { useEffect } from 'react'
import { ScrollView } from 'react-native'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'

interface SilentEditSettings {
	overrideNative: boolean
}

const defaults: SilentEditSettings = { overrideNative: true }

let settings: () => SilentEditSettings = () => defaults
let pendingSilentEditMessageId: string | null = null

const getRestAPI = (): any =>
	lookupModule(withProps<any>('getAPIBaseURL', 'get', 'post', 'del'))[0]

async function silentEdit(channelId: string, messageId: string, reqData: any) {
	const RestAPI = getRestAPI()
	if (!RestAPI) throw new Error('Discord API module not found')

	const res = await RestAPI.get({
		url: `/channels/${channelId}/messages`,
		query: { limit: 1, around: messageId },
	})

	const msg = (res?.body as any[] | undefined)?.find(m => m.id === messageId)
	if (!msg) return false

	let content: string = reqData?.content ?? ''
	const regex = /\.filename\s+(\S+)/g
	const matches = [...content.matchAll(regex)].slice(0, 10)
	let attachments: any[] | undefined

	if (matches.length > 0) {
		attachments = matches.map((match, index) => {
			const uploadedFilename = match[1]
			return {
				id: String(index),
				filename: uploadedFilename.split('/').pop() || 'image.png',
				uploaded_filename: uploadedFilename,
			}
		})
		content = content.replace(regex, '').trim()
	}

	const body: any = {
		content,
		nonce: messageId,
		tts: false,
		flags: msg.flags ?? 0,
		mobile_network_type: 'wifi',
	}

	if (attachments) body.attachments = attachments

	if (msg.message_reference) {
		body.message_reference = {
			message_id: msg.message_reference.message_id,
			channel_id: msg.message_reference.channel_id,
			guild_id: msg.message_reference.guild_id,
		}

		const repliedUser = msg.referenced_message?.author?.id
		const hasPing = repliedUser
			? (msg.mentions ?? []).some((m: any) => m.id === repliedUser)
			: false

		body.allowed_mentions = {
			replied_user: hasPing,
			parse: ['users', 'roles', 'everyone'],
		}
	}

	const response = await RestAPI.post({
		url: `/channels/${channelId}/messages`,
		body,
	})

	await RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` })

	return response
}

const isRowGroupArray = (node: any) =>
	Array.isArray(node) && node[0]?.type?.name === 'ActionSheetRowGroup'

const isRowArray = (node: any) =>
	Array.isArray(node) &&
	node.some((child: any) => child?.type?.name === 'ActionSheetRow')

function SettingsPage({
	api: { jsonStorage },
}: ComponentProps<
	PluginSettingsComponent<{ jsonStorage: SilentEditSettings }>
>) {
	const { TableRowGroup, TableSwitchRow } = Design
	const s = { ...defaults, ...jsonStorage.use() }

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				<TableRowGroup title="Settings">
					<TableSwitchRow
						label="Inject Original Edit"
						subLabel="Replace original edit with silent edit."
						icon={<TableRowAssetIcon name="PencilIcon" />}
						value={s.overrideNative}
						onValueChange={v => void jsonStorage.set({ overrideNative: v })}
					/>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}

export default plugin<{ jsonStorage: SilentEditSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	start({ cleanup, jsonStorage }) {
		settings = () => ({ ...defaults, ...jsonStorage.cache })
		cleanup(() => {
			settings = () => defaults
			pendingSilentEditMessageId = null
		})

		cleanup(
			getModules(withProps<any>('editMessage'), MessageActions => {
				cleanup(
					instead(MessageActions, 'editMessage', (args: any[], orig: any) => {
						const [channelId, messageId, reqData] = args

						if (
							!settings().overrideNative &&
							pendingSilentEditMessageId !== messageId
						)
							return orig.apply(MessageActions, args)

						pendingSilentEditMessageId = null

						return silentEdit(channelId, messageId, reqData)
							.then(res => res || orig.apply(MessageActions, args))
							.catch((err: any) => {
								ToastActionCreators.open('SILENT_EDIT', {
									text: `Error: ${err?.body?.message || err?.message || String(err)}`,
									variant: 'critical',
								})
								return orig.apply(MessageActions, args)
							})
					}),
				)
			}),
		)

		const active = new Set<() => void>()
		cleanup(() => {
			for (const unpatch of active) unpatch()
			active.clear()
		})

		cleanup(
			getModules(
				withProps<any>('openLazy', 'hideActionSheet'),
				LazyActionSheet => {
					cleanup(
						before(LazyActionSheet, 'openLazy', (args: any) => {
							if (settings().overrideNative) return args

							const [component, key, props] = args
							const message = props?.message
							if (key !== 'MessageLongPressActionSheet' || !message) return args
							if (typeof component?.then !== 'function') return args

							pendingSilentEditMessageId = null

							const currentUser = (Stores.UserStore as any)?.getCurrentUser?.()
							if (!currentUser || message.author?.id !== currentUser.id)
								return args

							component.then((instance: any) => {
								const unpatch = after(instance, 'default', (tree: any) => {
									useEffect(
										() => () => {
											unpatch()
											active.delete(unpatch)
										},
										[],
									)

									const groups = findInReactFiber(tree, isRowGroupArray) as
										| any[]
										| undefined
									if (!groups?.length) return tree

									for (const group of groups) {
										const rows = findInReactFiber(group, isRowArray) as
											| any[]
											| undefined
										if (!rows) continue

										const editIndex = rows.findIndex((c: any) =>
											String(c?.props?.label ?? c?.props?.message ?? '')
												.toLowerCase()
												.includes('edit'),
										)
										if (editIndex < 0) continue

										const editOnPress = rows[editIndex].props.onPress
										if (typeof editOnPress !== 'function') break

										const RowComponent =
											rows[editIndex].type ?? Design.ActionSheetRow

										rows.splice(
											editIndex + 1,
											0,
											<RowComponent
												key="silent-edit"
												label="Silent Edit"
												icon={<TableRowAssetIcon name="PencilIcon" />}
												onPress={() => {
													pendingSilentEditMessageId = message.id
													editOnPress()
												}}
											/>,
										)
										break
									}

									return tree
								})
								active.add(unpatch)
							})

							return args
						}),
					)
				},
			),
		)
	},
	SettingsComponent: SettingsPage,
})
