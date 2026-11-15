import {
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { useState } from 'react'
import { MAX_LENGTH, nicknameOf, realName, setNickname } from './state'

const D: any = Design

let counter = 0

export const toast = (text: string, ok = true) =>
	ToastActionCreators.open('FAKE_NICKNAME', {
		text,
		variant: ok ? 'success' : 'critical',
	})

function EditorAlert({ id, close }: { id: string; close: () => void }) {
	const { AlertModal, TextInput, Button, Stack } = D
	const current = nicknameOf(id)
	const [value, setValue] = useState(current ?? '')
	const name = value.trim()

	const save = () => {
		if (!name) return
		close()
		void setNickname(id, name).then(() => toast('Nickname saved'))
	}

	const remove = () => {
		close()
		void setNickname(id, undefined).then(() => toast('Nickname removed'))
	}

	return (
		<AlertModal
			title="Fake Nickname"
			content={`Only you will see this name for ${realName(id)}. It replaces their name everywhere, server nicknames included.`}
			extraContent={
				<TextInput
					label="Nickname"
					placeholder={realName(id)}
					value={value}
					onChange={setValue}
					maxLength={MAX_LENGTH}
					autoFocus
					isClearable
					returnKeyType="done"
					onSubmitEditing={save}
				/>
			}
			actions={
				<Stack spacing={8}>
					<Button
						text="Save"
						variant="primary"
						disabled={!name || name === current}
						onPress={save}
					/>
					{current ? (
						<Button
							text="Remove Nickname"
							variant="destructive"
							onPress={remove}
						/>
					) : null}
					<Button text="Cancel" variant="secondary" onPress={close} />
				</Stack>
			}
		/>
	)
}

export function openEditor(id: string) {
	const key = `FAKE_NICKNAME_${++counter}`
	const close = () => AlertActionCreators.dismissAlert(key)
	AlertActionCreators.openAlert(key, <EditorAlert id={id} close={close} />)
}
