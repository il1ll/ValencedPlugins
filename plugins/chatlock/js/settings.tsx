import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ScrollView, View } from 'react-native'
import { ChatIcon, describe } from './info'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import {
	authenticate,
	changePassword,
	chooseHint,
	chooseKeyword,
	chooseRecovery,
	ensurePassword,
	removeHint,
	removeRecovery,
	setupPassword,
} from './prompts'
import { toast } from './sheets'
import {
	fingerprintAllowed,
	getSnapshot,
	hasPassword,
	isLocked,
	read,
	save,
	setMembership,
	subscribe,
} from './state'
import type { FirstMethod } from './state'

async function unlockChats(ids: string[], title: string) {
	if (!ids.length) return
	if (!(await authenticate(title))) return
	await setMembership('locked', ids, false)
	toast(ids.length === 1 ? 'Chat unlocked' : `${ids.length} chats unlocked`)
}

function SecurityGroup() {
	const { TableRowGroup, TableRow, TableSwitchRow } = Design
	const settings = useSyncExternalStore(subscribe, getSnapshot)
	const [configured, setConfigured] = useState<boolean | null>(null)

	const refresh = () => {
		void hasPassword().then(setConfigured)
	}

	useEffect(refresh, [])

	return (
		<TableRowGroup title="Security">
			<TableRow
				label={configured ? 'Change Password' : 'Set Up Lock'}
				subLabel={
					configured
						? 'Your current password is required to change it.'
						: 'Create the password used for all locked and hidden chats.'
				}
				icon={<TableRowAssetIcon name="KeyIcon" />}
				arrow
				onPress={() => {
					const action = configured ? changePassword : setupPassword
					void action().then(saved => {
						if (saved) toast(configured ? 'Password changed' : 'Lock set up')
						refresh()
					})
				}}
			/>
			<TableSwitchRow
				label="Unlock with Fingerprint"
				subLabel="Use your fingerprint or screen lock. You can always use the password instead."
				icon={<TableRowAssetIcon name="ShieldLockIcon" />}
				value={settings.biometric}
				onValueChange={(value: boolean) => void save({ biometric: value })}
			/>
			<TableSwitchRow
				label="Locked Chat Screen"
				subLabel="Show a Locked Chat screen inside locked chats. When off, you are asked to unlock before the chat opens."
				icon={<TableRowAssetIcon name="LockIcon" />}
				value={settings.gateScreen}
				onValueChange={(value: boolean) => void save({ gateScreen: value })}
			/>
			<TableSwitchRow
				label="Protect Notifications"
				subLabel="Locked chats still notify you, but the message is hidden. Hidden chats send no notifications at all."
				icon={<TableRowAssetIcon name="BellSlashIcon" />}
				value={settings.protectNotifications}
				onValueChange={(value: boolean) =>
					void save({ protectNotifications: value })
				}
			/>
		</TableRowGroup>
	)
}

function FirstMethodGroup() {
	const { TableRadioGroup, TableRadioRow } = Design
	const settings = useSyncExternalStore(subscribe, getSnapshot)
	const disabled = !fingerprintAllowed(settings)

	return (
		<TableRadioGroup
			title="Show First"
			description={
				disabled
					? 'Turn on Unlock with Fingerprint to choose this.'
					: 'Choose what appears first when you unlock a chat.'
			}
			value={settings.firstMethod}
			onChange={(value: FirstMethod) => {
				if (!disabled) void save({ firstMethod: value })
			}}
		>
			<TableRadioRow
				label="Fingerprint"
				subLabel="Your fingerprint opens first. Cancel it to type the password."
				value="fingerprint"
				disabled={disabled}
			/>
			<TableRadioRow
				label="Password"
				subLabel="The password box opens first, with a fingerprint button."
				value="password"
				disabled={disabled}
			/>
		</TableRadioGroup>
	)
}

function HintsGroup() {
	const { TableRowGroup, TableRow, TableSwitchRow } = Design
	const settings = useSyncExternalStore(subscribe, getSnapshot)
	const enabled = settings.hints && !!settings.hint

	return (
		<TableRowGroup
			title="Hints"
			description="Shown under the password box when you unlock."
		>
			<TableSwitchRow
				label="Enable Hints"
				subLabel="Show a password hint in the unlock popup."
				icon={<TableRowAssetIcon name="CircleQuestionIcon" />}
				value={enabled}
				onValueChange={(value: boolean) => {
					if (value) {
						void ensurePassword().then(ok => {
							if (ok) void chooseHint(false)
						})
					} else void removeHint()
				}}
			/>
			{enabled ? (
				<>
					<TableRow
						label="Change Hint"
						subLabel={`Hint: ${settings.hint}`}
						icon={<TableRowAssetIcon name="PencilIcon" />}
						arrow
						onPress={() => void chooseHint(true)}
					/>
					<TableRow
						label="Remove Hint"
						variant="danger"
						icon={<TableRowAssetIcon name="TrashIcon" />}
						onPress={() => void removeHint().then(() => toast('Hint removed'))}
					/>
				</>
			) : (
				<></>
			)}
		</TableRowGroup>
	)
}

function RecoveryGroup() {
	const { TableRowGroup, TableRow, TableSwitchRow } = Design
	const settings = useSyncExternalStore(subscribe, getSnapshot)
	const enabled = settings.recovery && !!settings.recoveryQuestion

	return (
		<TableRowGroup
			title="Recovery"
			description="After 5 wrong password attempts, a recovery section appears. Answer your question to set a new password."
		>
			<TableSwitchRow
				label="Recovery Questions"
				subLabel="Reset your password by answering a question."
				icon={<TableRowAssetIcon name="ShieldUserIcon" />}
				value={enabled}
				onValueChange={(value: boolean) => {
					if (value) {
						void ensurePassword().then(ok => {
							if (ok)
								void chooseRecovery(false).then(saved => {
									if (saved) toast('Recovery question saved')
								})
						})
					} else void removeRecovery().then(() => toast('Recovery turned off'))
				}}
			/>
			{enabled ? (
				<TableRow
					label="Change Recovery Question"
					subLabel={settings.recoveryQuestion}
					icon={<TableRowAssetIcon name="PencilIcon" />}
					arrow
					onPress={() =>
						void chooseRecovery(true).then(saved => {
							if (saved) toast('Recovery question saved')
						})
					}
				/>
			) : (
				<></>
			)}
		</TableRowGroup>
	)
}

function HiddenGroup() {
	const { TableRowGroup, TableRow } = Design
	const settings = useSyncExternalStore(subscribe, getSnapshot)
	const hasKeyword = !!settings.keyword

	return (
		<TableRowGroup
			title="Hidden Chats"
			description="To open your hidden chats, type your keyword in the DM search and tap Locked Chats."
		>
			<TableRow
				label={hasKeyword ? 'Change Keyword' : 'Set Keyword'}
				subLabel={
					hasKeyword
						? 'Your password is required to change it.'
						: 'Choose the word that reveals your hidden chats.'
				}
				icon={<TableRowAssetIcon name="EyeSlashIcon" />}
				arrow
				onPress={() => {
					void (async () => {
						if (hasKeyword) {
							if (!(await authenticate('Change Keyword'))) return
						} else if (!(await ensurePassword())) return
						if (await chooseKeyword(hasKeyword)) toast('Keyword saved')
					})()
				}}
			/>
			<TableRow
				label={`${settings.hidden.length} hidden ${settings.hidden.length === 1 ? 'chat' : 'chats'}`}
				subLabel="Long press a chat and choose Hide Chat to hide it."
				icon={<TableRowAssetIcon name="LockUnlockedIcon" />}
			/>
		</TableRowGroup>
	)
}

function LockedChatsGroup() {
	const { TableRowGroup, TableRow, TableCheckboxRow, Button } = Design
	const settings = useSyncExternalStore(subscribe, getSnapshot)
	const [selecting, setSelecting] = useState(false)
	const [selected, setSelected] = useState<string[]>([])
	const chats = settings.locked.map(describe)

	const toggle = (id: string) =>
		setSelected(previous =>
			previous.includes(id)
				? previous.filter(value => value !== id)
				: [...previous, id],
		)

	const stopSelecting = () => {
		setSelecting(false)
		setSelected([])
	}

	return (
		<>
			<TableRowGroup
				title={`Locked Chats (${chats.length})`}
				description={
					chats.length
						? 'Unlocking a chat asks for your fingerprint or password.'
						: undefined
				}
			>
				{chats.length === 0 ? (
					<TableRow
						label="No locked chats"
						subLabel="Long press a chat and choose Lock Chat."
						icon={<TableRowAssetIcon name="LockUnlockedIcon" />}
					/>
				) : (
					chats.map(info =>
						selecting ? (
							<TableCheckboxRow
								key={info.id}
								label={info.label}
								subLabel={info.subLabel}
								icon={<ChatIcon info={info} />}
								value={info.id}
								checked={selected.includes(info.id)}
								onPress={() => toggle(info.id)}
							/>
						) : (
							<TableRow
								key={info.id}
								label={info.label}
								subLabel={info.subLabel}
								icon={<ChatIcon info={info} />}
								trailing={
									<Button
										text="Unlock"
										size="sm"
										variant="secondary"
										onPress={() =>
											void unlockChats([info.id], `Unlock ${info.label}`)
										}
									/>
								}
							/>
						),
					)
				)}
			</TableRowGroup>
			{chats.length > 0 && (
				<TableRowGroup title="Unlock">
					{selecting ? (
						<>
							<TableRow
								label={`Unlock Selected (${selected.length})`}
								icon={<TableRowAssetIcon name="LockUnlockedIcon" />}
								disabled={selected.length === 0}
								onPress={() => {
									const ids = selected.filter(id => isLocked(id))
									void unlockChats(ids, 'Unlock Selected Chats').then(
										stopSelecting,
									)
								}}
							/>
							<TableRow label="Cancel" onPress={stopSelecting} />
						</>
					) : (
						<>
							<TableRow
								label="Select Chats to Unlock"
								icon={<TableRowAssetIcon name="LockUnlockedIcon" />}
								arrow
								onPress={() => setSelecting(true)}
							/>
							<TableRow
								label="Unlock All"
								variant="danger"
								icon={<TableRowAssetIcon name="LockUnlockedIcon" />}
								onPress={() =>
									void unlockChats([...read().locked], 'Unlock All Chats')
								}
							/>
						</>
					)}
				</TableRowGroup>
			)}
		</>
	)
}

function useSafeNavigation(): any {
	try {
		return ReactNavigationNative.useNavigation()
	} catch {
		return undefined
	}
}

type Access = 'checking' | 'locked' | 'open'

function LockedSettings({ onUnlock }: { onUnlock: () => void }) {
	const { Stack, Text, Button } = Design
	return (
		<View
			style={{
				flex: 1,
				padding: 20,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<Stack spacing={16} style={{ width: '100%', maxWidth: 400 }}>
				<Stack align="center">
					<Text variant="heading-xl/bold" style={{ textAlign: 'center' }}>
						Chat Lock is locked
					</Text>
					<Text
						variant="text-md/medium"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						Enter your password to open these settings.
					</Text>
				</Stack>
				<Button text="Unlock" variant="primary" onPress={onUnlock} />
			</Stack>
		</View>
	)
}

export function SettingsPage() {
	const navigation = useSafeNavigation()
	const [access, setAccess] = useState<Access>('checking')

	const unlock = () => {
		void (async () => {
			if (!(await hasPassword())) {
				setAccess('open')
				return
			}
			setAccess('locked')
			const ok = await authenticate(
				'Chat Lock Settings',
				'Enter your password to open Chat Lock settings.',
			)
			if (ok) setAccess('open')
			else if (navigation?.canGoBack?.()) navigation.goBack()
		})()
	}

	useEffect(unlock, [])

	if (access === 'checking') return <View style={{ flex: 1 }} />
	if (access === 'locked') return <LockedSettings onUnlock={unlock} />

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				<SecurityGroup />
				<FirstMethodGroup />
				<HintsGroup />
				<RecoveryGroup />
				<HiddenGroup />
				<LockedChatsGroup />
			</Page>
		</ScrollView>
	)
}
