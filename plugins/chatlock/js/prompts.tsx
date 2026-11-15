import { AlertActionCreators } from '@valenced/discord/actions'
import { Design, FormSwitch } from '@valenced/discord/design'
import { useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import {
	clearRecovery,
	confirmDevice,
	deviceAvailable,
	fingerprintAllowed,
	getSnapshot,
	hasPassword,
	hasRecovery,
	read,
	resetPassword,
	save,
	savePassword,
	saveRecovery,
	subscribe,
	verifyPassword,
	verifyRecovery,
} from './state'
import type { ReactElement } from 'react'

const MIN_PASSWORD = 4
const MIN_KEYWORD = 2

type Done<T> = (value: T) => void

let counter = 0

function prompt<T>(
	render: (done: Done<T>) => ReactElement,
	cancelled: T,
): Promise<T> {
	const key = `CHAT_LOCK_PROMPT_${++counter}`
	return new Promise(resolve => {
		let settled = false
		const done: Done<T> = value => {
			if (settled) return
			settled = true
			resolve(value)
			AlertActionCreators.dismissAlert(key)
		}
		AlertActionCreators.openAlert(key, render(done), () => {
			if (settled) return
			settled = true
			resolve(cancelled)
		})
	})
}

function Field({
	label,
	value,
	onChange,
	error,
	secure = true,
	autoFocus,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	error?: string
	secure?: boolean
	autoFocus?: boolean
}) {
	const { TextInput } = Design
	return (
		<TextInput
			label={label}
			placeholder={label}
			value={value}
			onChange={onChange}
			secureTextEntry={secure}
			autoFocus={autoFocus}
			errorMessage={error}
			status={error ? 'error' : 'default'}
		/>
	)
}

function Actions({ children }: { children: ReactElement | ReactElement[] }) {
	const { Stack } = Design
	return <Stack spacing={8}>{children}</Stack>
}

const MAX_ATTEMPTS = 5

let failures = 0

type UnlockMode = 'password' | 'recovery' | 'reset'

function UnlockAlert({
	title,
	description,
	allowDevice,
	recoveryReady,
	done,
}: {
	title: string
	description: string
	allowDevice: boolean
	recoveryReady: boolean
	done: Done<boolean>
}) {
	const { AlertModal, Button, Stack } = Design
	const settings = useSyncExternalStore(subscribe, getSnapshot)
	const [mode, setMode] = useState<UnlockMode>('password')
	const [value, setValue] = useState('')
	const [answer, setAnswer] = useState('')
	const [first, setFirst] = useState('')
	const [second, setSecond] = useState('')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const [attempts, setAttempts] = useState(failures)
	const device = allowDevice && fingerprintAllowed(settings)
	const recovery =
		recoveryReady && settings.recovery && !!settings.recoveryQuestion

	const finish = () => {
		failures = 0
		done(true)
	}

	const switchMode = (next: UnlockMode) => {
		setMode(next)
		setError(undefined)
		setBusy(false)
		setValue('')
		setFirst('')
		setSecond('')
		if (next !== 'reset') setAnswer('')
	}

	const useDevice = () =>
		void confirmDevice(title).then(ok => {
			if (ok) finish()
		})

	const submitPassword = () => {
		if (busy || !value) return
		setBusy(true)
		void verifyPassword(value).then(ok => {
			setBusy(false)
			if (ok) {
				finish()
				return
			}
			failures += 1
			setAttempts(failures)
			setValue('')
			if (recovery && failures % MAX_ATTEMPTS === 0) {
				switchMode('recovery')
				return
			}
			setError('Wrong password')
		})
	}

	const submitAnswer = () => {
		if (busy || !answer.trim()) return
		setBusy(true)
		void verifyRecovery(answer).then(ok => {
			setBusy(false)
			if (ok) {
				switchMode('reset')
				return
			}
			setError('Wrong answer')
		})
	}

	const submitReset = () => {
		if (busy) return
		if (first.length < MIN_PASSWORD) {
			setError(`Use at least ${MIN_PASSWORD} characters`)
			return
		}
		if (first !== second) {
			setSecond('')
			setError('Passwords do not match')
			return
		}
		setBusy(true)
		void resetPassword(first, answer).then(ok => {
			setBusy(false)
			if (ok) finish()
			else setError('Could not save the password')
		})
	}

	if (mode === 'recovery')
		return (
			<AlertModal
				title="Recovery"
				content={`Question: ${settings.recoveryQuestion}`}
				extraContent={
					<Stack spacing={8}>
						<Field
							key="answer"
							label="Answer"
							value={answer}
							onChange={next => {
								setAnswer(next)
								setError(undefined)
							}}
							error={error}
							secure={false}
							autoFocus
						/>
					</Stack>
				}
				actions={
					<Actions>
						<Button
							text="Continue"
							variant="primary"
							loading={busy}
							disabled={!answer.trim()}
							onPress={submitAnswer}
						/>
						<Button
							text="Close Recovery"
							variant="secondary"
							onPress={() => switchMode('password')}
						/>
					</Actions>
				}
			/>
		)

	if (mode === 'reset')
		return (
			<AlertModal
				title="New Password"
				content="Choose a new password for your locked and hidden chats."
				extraContent={
					<Stack spacing={8}>
						<Field
							key="first"
							label="New Password"
							value={first}
							onChange={next => {
								setFirst(next)
								setError(undefined)
							}}
							autoFocus
						/>
						<Field
							key="second"
							label="Confirm Password"
							value={second}
							onChange={next => {
								setSecond(next)
								setError(undefined)
							}}
							error={error}
						/>
					</Stack>
				}
				actions={
					<Actions>
						<Button
							text="Save"
							variant="primary"
							loading={busy}
							onPress={submitReset}
						/>
						<Button
							text="Cancel"
							variant="tertiary"
							onPress={() => done(false)}
						/>
					</Actions>
				}
			/>
		)

	const hint = settings.hints && settings.hint ? settings.hint : ''

	return (
		<AlertModal
			title={title}
			content={hint ? `${description}\n\nHint: ${hint}` : description}
			extraContent={
				<Stack spacing={8}>
					<Field
						key="password"
						label="Password"
						value={value}
						onChange={next => {
							setValue(next)
							setError(undefined)
						}}
						error={error}
						autoFocus
					/>
				</Stack>
			}
			actions={
				<Actions>
					<Button
						text="Unlock"
						variant="primary"
						loading={busy}
						disabled={!value}
						onPress={submitPassword}
					/>
					{device ? (
						<Button
							text="Unlock with Fingerprint"
							variant="secondary"
							onPress={useDevice}
						/>
					) : (
						<></>
					)}
					{recovery && attempts >= MAX_ATTEMPTS ? (
						<Button
							text="Forgot Password?"
							variant="secondary"
							onPress={() => switchMode('recovery')}
						/>
					) : (
						<></>
					)}
					<Button
						text="Cancel"
						variant="tertiary"
						onPress={() => done(false)}
					/>
				</Actions>
			}
		/>
	)
}

export async function authenticate(
	title = 'Unlock Chat',
	description = 'Enter your password to continue.',
) {
	const settings = read()
	const allowDevice = fingerprintAllowed(settings) && (await deviceAvailable())
	if (!(await hasPassword())) return allowDevice ? confirmDevice(title) : false
	if (allowDevice && settings.firstMethod === 'fingerprint') {
		if (await confirmDevice(title)) {
			failures = 0
			return true
		}
	}
	const recoveryReady = settings.recovery && (await hasRecovery())
	return prompt<boolean>(
		done => (
			<UnlockAlert
				title={title}
				description={description}
				allowDevice={allowDevice}
				recoveryReady={recoveryReady}
				done={done}
			/>
		),
		false,
	)
}

function SwitchRow({
	label,
	value,
	onChange,
}: {
	label: string
	value: boolean
	onChange: (value: boolean) => void
}) {
	const { Text } = Design
	return (
		<View
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: 12,
				paddingVertical: 4,
			}}
		>
			<Text variant="text-md/medium" color="text-default" style={{ flex: 1 }}>
				{label}
			</Text>
			<FormSwitch value={value} onValueChange={onChange} />
		</View>
	)
}

function PasswordAlert({
	change,
	done,
}: {
	change: boolean
	done: Done<boolean>
}) {
	const { AlertModal, Button, Stack } = Design
	const [current, setCurrent] = useState('')
	const [first, setFirst] = useState('')
	const [second, setSecond] = useState('')
	const [fingerprint, setFingerprint] = useState(true)
	const [errors, setErrors] = useState<{
		current?: string
		first?: string
		second?: string
	}>({})
	const [busy, setBusy] = useState(false)

	const submit = async () => {
		if (busy) return
		if (first.length < MIN_PASSWORD) {
			setErrors({ first: `Use at least ${MIN_PASSWORD} characters` })
			return
		}
		if (first !== second) {
			setSecond('')
			setErrors({ second: 'Passwords do not match' })
			return
		}
		setBusy(true)
		if (change && !(await verifyPassword(current))) {
			setBusy(false)
			setCurrent('')
			setErrors({ current: 'Wrong password' })
			return
		}
		const saved = await savePassword(first, change ? current : undefined)
		setBusy(false)
		if (!saved) {
			setErrors({ first: 'Could not save the password' })
			return
		}
		if (!change) await save({ biometric: fingerprint })
		done(true)
	}

	return (
		<AlertModal
			title={change ? 'Change Password' : 'Set Up Lock'}
			content={
				change
					? 'Enter your current password, then choose a new one.'
					: 'This password unlocks every locked and hidden chat. It is stored only on this device.'
			}
			extraContent={
				<Stack spacing={8}>
					{change ? (
						<Field
							label="Current Password"
							value={current}
							onChange={value => {
								setCurrent(value)
								setErrors({})
							}}
							error={errors.current}
							autoFocus
						/>
					) : (
						<></>
					)}
					<Field
						label="New Password"
						value={first}
						onChange={value => {
							setFirst(value)
							setErrors({})
						}}
						error={errors.first}
						autoFocus={!change}
					/>
					<Field
						label="Confirm Password"
						value={second}
						onChange={value => {
							setSecond(value)
							setErrors({})
						}}
						error={errors.second}
					/>
					{change ? (
						<></>
					) : (
						<SwitchRow
							label="Unlock with Fingerprint"
							value={fingerprint}
							onChange={setFingerprint}
						/>
					)}
				</Stack>
			}
			actions={
				<Actions>
					<Button
						text="Save"
						variant="primary"
						loading={busy}
						onPress={() => void submit()}
					/>
					<Button
						text="Cancel"
						variant="tertiary"
						onPress={() => done(false)}
					/>
				</Actions>
			}
		/>
	)
}

export const setupPassword = () =>
	prompt<boolean>(done => <PasswordAlert change={false} done={done} />, false)

export const changePassword = () =>
	prompt<boolean>(done => <PasswordAlert change done={done} />, false)

export async function ensurePassword() {
	if (await hasPassword()) return true
	return setupPassword()
}

function KeywordAlert({
	change,
	done,
}: {
	change: boolean
	done: Done<boolean>
}) {
	const { AlertModal, Button, Stack } = Design
	const [value, setValue] = useState('')
	const [error, setError] = useState<string>()

	const submit = async () => {
		const keyword = value.trim()
		if (keyword.length < MIN_KEYWORD) {
			setError(`Use at least ${MIN_KEYWORD} characters`)
			return
		}
		await save({ keyword })
		done(true)
	}

	return (
		<AlertModal
			title={change ? 'Change Keyword' : 'Choose a Keyword'}
			content="Hidden chats only show up when you type this keyword in the DM search."
			extraContent={
				<Stack spacing={8}>
					<Field
						label="Keyword"
						value={value}
						onChange={next => {
							setValue(next)
							setError(undefined)
						}}
						error={error}
						secure={false}
						autoFocus
					/>
				</Stack>
			}
			actions={
				<Actions>
					<Button text="Save" variant="primary" onPress={() => void submit()} />
					<Button
						text="Cancel"
						variant="tertiary"
						onPress={() => done(false)}
					/>
				</Actions>
			}
		/>
	)
}

export const chooseKeyword = (change: boolean) =>
	prompt<boolean>(done => <KeywordAlert change={change} done={done} />, false)

const MIN_QUESTION = 3

function HintAlert({ change, done }: { change: boolean; done: Done<boolean> }) {
	const { AlertModal, Button, Stack } = Design
	const [value, setValue] = useState(change ? read().hint : '')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)

	const submit = async () => {
		const hint = value.trim()
		if (!hint) {
			setError('Write a hint')
			return
		}
		setBusy(true)
		if (await verifyPassword(hint)) {
			setBusy(false)
			setError('Your hint cannot be your password')
			return
		}
		await save({ hints: true, hint })
		setBusy(false)
		done(true)
	}

	return (
		<AlertModal
			title={change ? 'Change Hint' : 'Set a Hint'}
			content="Your hint shows under the description when you type your password. Anyone who sees the popup can read it."
			extraContent={
				<Stack spacing={8}>
					<Field
						label="Hint"
						value={value}
						onChange={next => {
							setValue(next)
							setError(undefined)
						}}
						error={error}
						secure={false}
						autoFocus
					/>
				</Stack>
			}
			actions={
				<Actions>
					<Button
						text="Save"
						variant="primary"
						loading={busy}
						onPress={() => void submit()}
					/>
					<Button
						text="Cancel"
						variant="tertiary"
						onPress={() => done(false)}
					/>
				</Actions>
			}
		/>
	)
}

export const chooseHint = (change: boolean) =>
	prompt<boolean>(done => <HintAlert change={change} done={done} />, false)

export const removeHint = () => save({ hints: false, hint: '' })

function RecoveryAlert({
	change,
	done,
}: {
	change: boolean
	done: Done<boolean>
}) {
	const { AlertModal, Button, Stack } = Design
	const [question, setQuestion] = useState(
		change ? read().recoveryQuestion : '',
	)
	const [answer, setAnswer] = useState('')
	const [errors, setErrors] = useState<{ question?: string; answer?: string }>(
		{},
	)
	const [busy, setBusy] = useState(false)

	const submit = async () => {
		const text = question.trim()
		if (text.length < MIN_QUESTION) {
			setErrors({ question: `Use at least ${MIN_QUESTION} characters` })
			return
		}
		if (!answer.trim()) {
			setErrors({ answer: 'Write the answer' })
			return
		}
		setBusy(true)
		const saved = await saveRecovery(answer)
		if (!saved) {
			setBusy(false)
			setErrors({ answer: 'Could not save the answer' })
			return
		}
		await save({ recovery: true, recoveryQuestion: text })
		setBusy(false)
		done(true)
	}

	return (
		<AlertModal
			title={change ? 'Change Recovery Question' : 'Recovery Question'}
			content="After 5 wrong password attempts, you can answer this question to set a new password. The answer is stored only on this device as a hash and is not case sensitive."
			extraContent={
				<Stack spacing={8}>
					<Field
						label="Question"
						value={question}
						onChange={next => {
							setQuestion(next)
							setErrors({})
						}}
						error={errors.question}
						secure={false}
						autoFocus
					/>
					<Field
						label="Answer"
						value={answer}
						onChange={next => {
							setAnswer(next)
							setErrors({})
						}}
						error={errors.answer}
						secure={false}
					/>
				</Stack>
			}
			actions={
				<Actions>
					<Button
						text="Save"
						variant="primary"
						loading={busy}
						onPress={() => void submit()}
					/>
					<Button
						text="Cancel"
						variant="tertiary"
						onPress={() => done(false)}
					/>
				</Actions>
			}
		/>
	)
}

export const chooseRecovery = (change: boolean) =>
	prompt<boolean>(done => <RecoveryAlert change={change} done={done} />, false)

export async function removeRecovery() {
	await clearRecovery()
	await save({ recovery: false, recoveryQuestion: '' })
}
