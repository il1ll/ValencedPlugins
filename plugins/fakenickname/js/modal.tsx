import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { lookupModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { useRef } from 'react'
import { View } from 'react-native'
import { openEditor, toast } from './editor'
import { MAX_LENGTH, nicknameOf, realName, setNickname, store } from './state'
import type { ComponentType } from 'react'

const D: any = Design

const ALERT_PATH = 'components_native/common/Alert.tsx'
const KEYBOARD_VIEW_PATH = 'modules/keyboard/native/KeyboardAwareView.tsx'
const MODAL_ACTIONS_PATH = 'actions/ModalActionCreators.tsx'
const PROFILE_PATH =
	'modules/user_profile/native/showUserProfileActionSheet.tsx'

const fromPath = (path: string) => lookupModuleWithImportedPath<any>(path)[0]

const component = (path: string): ComponentType<any> | undefined => {
	const value = fromPath(path)?.default
	return typeof value === 'function' || (value && typeof value === 'object')
		? value
		: undefined
}

function modals() {
	const actions = fromPath(MODAL_ACTIONS_PATH)?.default
	return typeof actions?.push === 'function' &&
		typeof actions?.pop === 'function'
		? actions
		: undefined
}

function scrim(): string {
	try {
		const tokens: any = Tokens
		const definition = tokens?.default?.colors?.BACKGROUND_SCRIM
		if (typeof definition === 'string') return definition
		const resolve = tokens?.default?.internal?.resolveSemanticColor
		const theme = store('ThemeStore')?.theme ?? 'dark'
		const value =
			typeof resolve === 'function' ? resolve(theme, definition) : undefined
		if (typeof value === 'string') return value
	} catch {}
	return 'rgba(0, 0, 0, 0.7)'
}

function showProfile(userId: string) {
	const show = fromPath(PROFILE_PATH)?.default
	if (typeof show !== 'function') return
	try {
		show({ userId })
	} catch {}
}

function FakeNicknameModal({ userId }: { userId: string }) {
	const Alert = component(ALERT_PATH)
	const KeyboardAwareView = component(KEYBOARD_VIEW_PATH) ?? View
	const { Text, TextField } = D
	const current = nicknameOf(userId)
	const value = useRef(current ?? '')
	const name = realName(userId)

	const close = () => {
		modals()?.pop()
		setTimeout(() => showProfile(userId), 250)
	}

	const save = () => {
		const next = value.current.trim()
		close()
		if (next === (current ?? '')) return
		void setNickname(userId, next || undefined).then(() =>
			toast(next ? 'Nickname saved' : 'Nickname removed'),
		)
	}

	if (!Alert) return null

	return (
		<KeyboardAwareView
			style={{
				flex: 1,
				backgroundColor: scrim(),
				justifyContent: 'center',
				alignItems: 'center',
			}}
		>
			<Alert
				confirmText="Save"
				onConfirm={save}
				cancelText="Cancel"
				onCancel={close}
			>
				<Text
					style={{ textAlign: 'center' }}
					accessibilityRole="header"
					variant="heading-lg/extrabold"
					color="mobile-text-heading-primary"
				>
					{current ? 'Edit Fake Nickname' : 'Add Fake Nickname'}
				</Text>
				<Text
					style={{
						marginTop: 8,
						marginBottom: 16,
						textAlign: 'center',
						lineHeight: 18,
					}}
					variant="text-sm/medium"
					color="text-default"
				>
					{`Only you can see this. It replaces ${name}'s name everywhere, even their server nicknames. Leave it empty to remove it.`}
				</Text>
				<TextField
					onChange={(next: string) => {
						value.current = next
					}}
					autoFocus
					accessibilityLabel="Fake Nickname"
					placeholder={name}
					defaultValue={current ?? ''}
					maxLength={MAX_LENGTH}
					clearable
				/>
			</Alert>
		</KeyboardAwareView>
	)
}

export function openFakeNicknameModal(userId: string) {
	const actions = modals()
	if (!actions || !component(ALERT_PATH)) return openEditor(userId)
	try {
		actions.push(FakeNicknameModal, { userId })
	} catch {
		openEditor(userId)
	}
}
