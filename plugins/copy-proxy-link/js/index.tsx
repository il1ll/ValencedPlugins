import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import { findInReactFiber } from '@valenced/utils/react'
import { useEffect } from 'react'

const getProxyUrl = (message: any): string | undefined =>
	message?.attachments?.[0]?.proxy_url ||
	message?.attachments?.[0]?.proxyURL ||
	message?.embeds?.[0]?.image?.proxyURL ||
	message?.embeds?.[0]?.image?.proxy_url

const isRowGroupArray = (node: any) =>
	Array.isArray(node) && node[0]?.type?.name === 'ActionSheetRowGroup'

export default plugin({
	start({ cleanup }) {
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
							const [component, key, props] = args
							if (key !== 'MessageLongPressActionSheet') return args

							const proxyUrl = getProxyUrl(props?.message)
							if (!proxyUrl || typeof component?.then !== 'function')
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
									const children = groups?.[1]?.props?.children
									if (!Array.isArray(children)) return tree

									const RowComponent =
										children[0]?.type ?? Design.ActionSheetRow

									const copy = () => {
										LazyActionSheet.hideActionSheet()
										Clipboard.setString(proxyUrl)
										ToastActionCreators.open('COPY_PROXY_LINK', {
											text: 'Link Copied!',
											variant: 'success',
										})
									}

									const button = (
										<RowComponent
											key="copy-proxy-link"
											label="Copy Proxy Link"
											icon={<TableRowAssetIcon name="LinkIcon" />}
											onPress={copy}
										/>
									)

									const linkIndex = children.findIndex((c: any) =>
										String(c?.props?.label ?? '')
											.toLowerCase()
											.includes('message link'),
									)

									if (linkIndex !== -1)
										children.splice(linkIndex + 1, 0, button)
									else children.push(button)

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
})
