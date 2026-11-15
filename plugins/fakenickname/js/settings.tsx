import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { useState } from 'react'
import { Image, ScrollView } from 'react-native'
import { openEditor, toast } from './editor'
import {
	avatarUrl,
	clearNicknames,
	realName,
	setNickname,
	username,
} from './state'
import type { FakeNicknameSettings } from './state'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'

const D: any = Design

const USER_ID = /^\d{15,22}$/

function Avatar({ id }: { id: string }) {
	return (
		<Image
			source={{ uri: avatarUrl(id) }}
			style={{ width: 32, height: 32, borderRadius: 16 }}
		/>
	)
}

function AddGroup({ known }: { known: Record<string, string> }) {
	const { TableRowGroup, TableRow, Stack, TextInput } = D
	const [id, setId] = useState('')
	const [name, setName] = useState('')
	const valid = USER_ID.test(id.trim()) && !!name.trim()

	const add = () => {
		const user = id.trim()
		if (!USER_ID.test(user)) return toast('Invalid ID', false)
		if (!name.trim()) return toast('Enter nickname', false)
		const replacing = !!known[user]
		void setNickname(user, name).then(() => {
			setId('')
			setName('')
			toast(replacing ? 'Nickname updated' : 'Nickname added')
		})
	}

	return (
		<TableRowGroup
			title="Add by User ID"
			description="Or open their profile, tap the three dots and choose Fake Nickname."
		>
			<Stack spacing={8} style={{ padding: 12 }}>
				<TextInput
					placeholder="User ID"
					value={id}
					onChange={setId}
					isClearable
					keyboardType="number-pad"
				/>
				<TextInput
					placeholder="Nickname"
					value={name}
					onChange={setName}
					isClearable
					maxLength={32}
					returnKeyType="done"
					onSubmitEditing={add}
				/>
			</Stack>
			<TableRow
				label="Add Fake Nickname"
				icon={<TableRowAssetIcon name="UserPlusIcon" />}
				arrow
				disabled={!valid}
				onPress={add}
			/>
		</TableRowGroup>
	)
}

export function SettingsPage({
	api: { jsonStorage },
}: ComponentProps<
	PluginSettingsComponent<{ jsonStorage: FakeNicknameSettings }>
>) {
	const { TableRowGroup, TableRow } = D
	const stored: Partial<FakeNicknameSettings> = jsonStorage.use() ?? {}
	const known = stored.nicknames ?? {}
	const entries = Object.entries(known).sort(([, a], [, b]) =>
		a.localeCompare(b),
	)

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
			keyboardShouldPersistTaps="handled"
		>
			<Page>
				<TableRowGroup
					title={`Fake Nicknames (${entries.length})`}
					description={
						entries.length
							? 'Tap someone to rename them or remove their nickname.'
							: undefined
					}
				>
					{entries.length ? (
						entries.map(([id, nickname]) => {
							const tag = username(id)
							return (
								<TableRow
									key={id}
									label={nickname}
									subLabel={tag ? `${realName(id)} · @${tag}` : id}
									icon={<Avatar id={id} />}
									arrow
									onPress={() => openEditor(id)}
								/>
							)
						})
					) : (
						<TableRow
							label="No fake nicknames yet"
							subLabel="Add one below or from someone's profile"
						/>
					)}
				</TableRowGroup>

				<AddGroup known={known} />

				{entries.length ? (
					<TableRowGroup>
						<TableRow
							label="Remove All Nicknames"
							variant="danger"
							icon={<TableRowAssetIcon name="TrashIcon" variant="danger" />}
							onPress={() =>
								void clearNicknames().then(() => toast('All removed'))
							}
						/>
					</TableRowGroup>
				) : null}
			</Page>
		</ScrollView>
	)
}
