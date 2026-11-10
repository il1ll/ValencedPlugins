import { getAssetIdByName } from '@valenced/assets'
import Page from '@valenced/components/Page'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useState } from 'react'
import { Image, ScrollView, TouchableOpacity } from 'react-native'
import { defaults } from './storage'
import type { JsonStorage } from '@valenced/json-storage'
import type { KeywordTrackerSettings } from './storage'

function StoredInput({
	value,
	placeholder,
	onChange,
}: {
	value: string
	placeholder: string
	onChange: (value: string) => void
}) {
	const { TextInput } = Design as any
	const [text, setText] = useState(value)
	return (
		<TextInput
			placeholder={placeholder}
			value={text}
			onChange={(v: string) => {
				setText(v)
				onChange(v)
			}}
		/>
	)
}

const toast = (text: string, variant: 'success' | 'critical' = 'success') =>
	ToastActionCreators.open('KEYWORD_TRACKER', { text, variant })

function DeleteButton({ onPress }: { onPress: () => void }) {
	return (
		<TouchableOpacity
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel="Remove"
			hitSlop={8}
			style={{
				width: 28,
				height: 28,
				borderRadius: 14,
				backgroundColor: '#da373c',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<Image
				source={getAssetIdByName('TrashIcon')}
				style={{ width: 16, height: 16, tintColor: '#ffffff' }}
			/>
		</TouchableOpacity>
	)
}

export default function Settings({
	api,
}: {
	api: { jsonStorage: JsonStorage<KeywordTrackerSettings> }
}) {
	const { Stack, TableRowGroup, TableRow, TableSwitchRow, TextInput, Text } =
		Design as any
	const storage = api.jsonStorage
	const s = { ...defaults, ...storage.use() }
	const set = (partial: Partial<KeywordTrackerSettings>) => {
		void storage.set(partial)
	}

	const [newKeyword, setNewKeyword] = useState('')

	const addKeyword = () => {
		const kw = newKeyword.trim()
		if (!kw) return toast('Please enter a keyword', 'critical')
		if (s.keywords.includes(kw))
			return toast('Keyword already exists', 'critical')

		set({ keywords: [...s.keywords, kw] })
		setNewKeyword('')
		toast('Keyword added')
	}

	const removeKeyword = (kw: string) => {
		set({ keywords: s.keywords.filter(k => k !== kw) })
		toast('Keyword removed')
	}

	const exportKeywords = () => {
		Clipboard.setString(JSON.stringify(s.keywords))
		toast('Exported to clipboard')
	}

	const importKeywords = async () => {
		try {
			const parsed = JSON.parse(await Clipboard.getString())
			if (!Array.isArray(parsed)) throw new Error('Not an array')
			set({ keywords: parsed.map(String) })
			toast('Imported successfully')
		} catch {
			toast('Invalid JSON format', 'critical')
		}
	}

	const idInput = (
		title: string,
		key: keyof KeywordTrackerSettings,
		placeholder: string,
	) => (
		<TableRowGroup title={title}>
			<Stack spacing={4} style={{ padding: 10 }}>
				<StoredInput
					placeholder={placeholder}
					value={s[key] as string}
					onChange={v => set({ [key]: v })}
				/>
			</Stack>
		</TableRowGroup>
	)

	const switchRow = (
		label: string,
		subLabel: string,
		value: boolean,
		onValueChange: (v: boolean) => void,
	) => (
		<TableSwitchRow
			label={label}
			subLabel={subLabel}
			value={value}
			onValueChange={onValueChange}
		/>
	)

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				<TableRowGroup title="Add Keyword">
					<Stack spacing={4} style={{ padding: 10 }}>
						<TextInput
							placeholder="Enter keyword or phrase..."
							value={newKeyword}
							onChange={setNewKeyword}
							isClearable
							onSubmitEditing={addKeyword}
							returnKeyType="done"
						/>
					</Stack>
					<TableRow
						label="Add Keyword"
						subLabel="Add the typed word or phrase to your tracking list"
						arrow
						onPress={addKeyword}
					/>
				</TableRowGroup>

				{s.keywords.length > 0 && (
					<TableRowGroup title="Tracked Keywords">
						{s.keywords.map(kw => (
							<TableRow
								key={kw}
								label={kw}
								trailing={<DeleteButton onPress={() => removeKeyword(kw)} />}
							/>
						))}
					</TableRowGroup>
				)}

				<TableRowGroup title="Data Management">
					<TableRow
						label="Export JSON"
						subLabel="Copy your keywords list to the clipboard"
						arrow
						onPress={exportKeywords}
					/>
					<TableRow
						label="Import JSON"
						subLabel="Load a keywords list from your clipboard"
						arrow
						onPress={importKeywords}
					/>
				</TableRowGroup>

				<TableRowGroup title="Plugin Settings">
					{switchRow(
						'Show in Settings',
						'Add a shortcut to this plugin in the Valenced settings section',
						s.showInSettings,
						v => set({ showInSettings: v }),
					)}
				</TableRowGroup>

				<TableRowGroup title="Tracking Target">
					{switchRow(
						'Track Everyone',
						'Listen to messages from all users',
						s.trackMode === 'everyone',
						() => set({ trackMode: 'everyone' }),
					)}
					{switchRow(
						'Track Friends Only',
						'Only listen to messages sent by your added friends',
						s.trackMode === 'friends',
						() => set({ trackMode: 'friends' }),
					)}
					{switchRow(
						'Track Custom Users',
						'Only listen to messages from specific user IDs',
						s.trackMode === 'custom',
						() => set({ trackMode: 'custom' }),
					)}
					{switchRow(
						'Ignore Bots',
						'Do not track messages sent by Discord bots',
						s.ignoreBots,
						v =>
							set(
								v ? { ignoreBots: v, trackEmbeds: false } : { ignoreBots: v },
							),
					)}
					{switchRow(
						'Track Embeds',
						'Track keywords inside embedded messages',
						s.trackEmbeds,
						v =>
							set(
								v ? { trackEmbeds: v, ignoreBots: false } : { trackEmbeds: v },
							),
					)}
				</TableRowGroup>

				{s.trackMode === 'custom' &&
					idInput(
						'Custom User IDs',
						'customIds',
						'1099039269391171765, 845374453939568720',
					)}

				<TableRowGroup title="Tracking Locations">
					{switchRow(
						'Track Servers',
						'Monitor messages sent in servers',
						s.trackServers,
						v =>
							set(
								v
									? { trackServers: v }
									: { trackServers: v, ignoreServersEnabled: false },
							),
					)}
					{switchRow(
						'Track Group DMs',
						'Monitor messages sent in group DMs',
						s.trackGroups,
						v => set({ trackGroups: v }),
					)}
					{switchRow(
						'Track DMs',
						'Monitor messages sent in direct messages',
						s.trackDMs,
						v => set({ trackDMs: v }),
					)}
					{switchRow(
						'Track Channels',
						'Track specific channels even if they are in an ignored server',
						s.trackChannelsEnabled,
						v => set({ trackChannelsEnabled: v }),
					)}
				</TableRowGroup>

				{s.trackChannelsEnabled &&
					idInput(
						'Tracked Channel IDs',
						'trackedChannelIds',
						'1205207690352005243, 1296197038006075543',
					)}

				<TableRowGroup title="Ignoring">
					{switchRow(
						'Ignore Servers',
						'Do not track messages from specific servers',
						s.ignoreServersEnabled,
						v =>
							set(
								v
									? { ignoreServersEnabled: v, trackServers: true }
									: { ignoreServersEnabled: v },
							),
					)}
					{switchRow(
						'Ignore Channels',
						'Do not track messages from specific channels, DMs, or groups',
						s.ignoreChannelsEnabled,
						v => set({ ignoreChannelsEnabled: v }),
					)}
					{switchRow(
						'Ignore Users',
						'Do not track messages from specific users',
						s.ignoreUsersEnabled,
						v => set({ ignoreUsersEnabled: v }),
					)}
				</TableRowGroup>

				{s.ignoreServersEnabled &&
					idInput(
						'Ignored Server IDs',
						'ignoredServerIds',
						'1205207689832038522, 1196075698301968455',
					)}
				{s.ignoreChannelsEnabled &&
					idInput(
						'Ignored Channel IDs',
						'ignoredChannelIds',
						'1306947192594108467, 1284131216156655646',
					)}
				{s.ignoreUsersEnabled &&
					idInput(
						'Ignored User IDs',
						'ignoredUserIds',
						'1099039269391171765, 845374453939568720',
					)}

				<TableRowGroup title="Matching Rules">
					{switchRow(
						'Match Whole Words',
						'Match keyword as a standalone word only, not inside another word',
						s.wholeWords,
						v => set({ wholeWords: v }),
					)}
					{switchRow(
						'Exact Match',
						'The message content must be exactly the keyword with no other words',
						s.exactMatch,
						v => set({ exactMatch: v }),
					)}
					{switchRow(
						'Case Sensitive',
						'Match the exact uppercase and lowercase letters of the keyword',
						s.caseSensitive,
						v => set({ caseSensitive: v }),
					)}
					{switchRow(
						'Match in a Sentence',
						'The keyword can be detected even if it is part of a longer word',
						s.inSentence,
						v => set({ inSentence: v }),
					)}
				</TableRowGroup>

				<TableRowGroup title="Advanced Notifications">
					{switchRow(
						'Send Notifications to Channel',
						'Send detected messages to a specific channel',
						s.sendNotificationToChannel,
						v => set({ sendNotificationToChannel: v }),
					)}
					{switchRow(
						'Send Notifications to Webhook',
						'Send detected messages to a webhook',
						s.sendNotificationToWebhook,
						v => set({ sendNotificationToWebhook: v }),
					)}
				</TableRowGroup>

				{s.sendNotificationToChannel && (
					<TableRowGroup title="Target Channel ID">
						<Stack spacing={4} style={{ padding: 10 }}>
							<StoredInput
								placeholder="Enter Target Channel ID..."
								value={s.targetChannelId}
								onChange={v => set({ targetChannelId: v })}
							/>
							<Text
								variant="text-xs/bold"
								style={{ color: '#f23f42', marginTop: 4 }}
							>
								WARNING: You must own the target channel to maintain privacy and
								prevent spamming others!!
							</Text>
						</Stack>
					</TableRowGroup>
				)}

				{s.sendNotificationToWebhook &&
					idInput('Webhook URL', 'webhookUrl', 'Enter Webhook URL...')}
			</Page>
		</ScrollView>
	)
}
