import { Design } from '@valenced/discord/design'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { cloneElement } from 'react'
import { openFakeNicknameModal } from './modal'
import { nicknameOf, store } from './state'
import type { ComponentType, ReactElement } from 'react'

type Cleanup = (fn: () => void) => void

const OVERFLOW_MENU_PATH =
	'modules/user_profile/native/UserProfileOverflowMenu.tsx'
const ITEM_KEY = 'fake-nickname'
const FRIEND = 1

let rendering: string | undefined

function item(id: string) {
	return {
		key: ITEM_KEY,
		label: nicknameOf(id) ? 'Edit Fake Nickname' : 'Add Fake Nickname',
		action: () => {
			openFakeNicknameModal(id)
			try {
				ActionSheetActionCreators.hideActionSheet()
			} catch {}
		},
	}
}

function isFriend(id: string) {
	const relationships = store('RelationshipStore')
	try {
		if (typeof relationships?.isFriend === 'function')
			return !!relationships.isFriend(id)
		return relationships?.getRelationshipType?.(id) === FRIEND
	} catch {
		return false
	}
}

const contains = (items: any[]): boolean =>
	items.some(entry =>
		Array.isArray(entry) ? contains(entry) : entry?.key === ITEM_KEY,
	)

function first(items: any[], entry: object) {
	if (!items.some(Array.isArray)) return [entry, ...items]
	const index = items.findIndex(Array.isArray)
	const next = [...items]
	next[index] = [entry, ...items[index]]
	return next
}

export function patchMenu(cleanup: Cleanup) {
	cleanup(
		afterJSX(Design.ContextMenu as ComponentType<any>, element => {
			const id = rendering
			if (!id || isFriend(id) || !element || typeof element !== 'object')
				return element
			const props = (element as ReactElement<{ items?: unknown }>).props
			if (!Array.isArray(props?.items)) return element
			if (contains(props.items)) return element
			return cloneElement(element as ReactElement<any>, {
				items: first(props.items, item(id)),
			})
		}),
	)

	cleanup(
		getModuleWithImportedPath<any>(OVERFLOW_MENU_PATH, module => {
			if (typeof module?.default !== 'function') return
			cleanup(
				instead(
					module,
					'default',
					function (
						this: unknown,
						args: any[],
						original: (...a: any[]) => any,
					) {
						const previous = rendering
						const id = args[0]?.user?.id
						rendering = typeof id === 'string' ? id : undefined
						try {
							return Reflect.apply(original, this, args)
						} finally {
							rendering = previous
						}
					},
				),
			)
		}),
	)
}
