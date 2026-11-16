import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { getAssetIdByName } from '@valenced/assets'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { lookupModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { ReactNativeSafeAreaContext } from '@valenced/externals/react-native-safe-area-context'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { useEffect, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Image,
	BackHandler,
	Linking,
	Pressable,
	ScrollView,
	TextInput,
	View,
} from 'react-native'
import {
	errorMessage,
	extractImage,
	fetchTextAttachment,
	openZip,
	readText,
	saveAttachment,
	saveEntry,
} from './native'
import type { TextPreview, ZipEntry, ZipListing } from './native'

const MODAL_KEY = 'file-preview'
const TOAST_KEY = 'FILE_PREVIEW_TOAST'
const URL_UTILS_PATH = 'modules/messages/AttachmentUrlUtils.tsx'
const MAX_ENTRIES = 1000

type Load<T> =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; value: T }

interface Styles {
	screen: object
	header: object
	headerButton: object
	headerText: object
	icon: object
	search: object
	searchInput: object
	breadcrumb: object
	crumb: object
	body: object
	state: object
	code: object
	codeText: object
	image: object
	actions: object
}

let useStyles: (() => Styles) | undefined

function styles(): Styles {
	useStyles ??= Design.createStyles({
		screen: {
			flex: 1,
			backgroundColor: Tokens.default.colors.BACKGROUND_BASE_LOW,
		},
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 8,
			paddingHorizontal: 8,
			paddingVertical: 8,
			borderBottomWidth: 1,
			borderBottomColor: Tokens.default.colors.BORDER_SUBTLE,
		},
		headerButton: {
			width: 40,
			height: 40,
			alignItems: 'center',
			justifyContent: 'center',
		},
		headerText: { flex: 1 },
		icon: {
			width: 24,
			height: 24,
			tintColor: Tokens.default.colors.INTERACTIVE_ICON_DEFAULT,
		},
		search: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 8,
			marginHorizontal: 16,
			marginTop: 10,
			paddingHorizontal: 12,
			borderRadius: 8,
			backgroundColor: Tokens.default.colors.BACKGROUND_BASE_LOWER,
		},
		searchInput: {
			flex: 1,
			height: 40,
			color: Tokens.default.colors.TEXT_DEFAULT,
		},
		breadcrumb: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 4,
			paddingHorizontal: 16,
			paddingVertical: 10,
		},
		crumb: { paddingVertical: 4, paddingHorizontal: 2 },
		body: { padding: 16, paddingTop: 4, paddingBottom: 38, gap: 12 },
		state: {
			flex: 1,
			alignItems: 'center',
			justifyContent: 'center',
			padding: 24,
			gap: 12,
		},
		code: {
			flex: 1,
			margin: 16,
			borderRadius: 8,
			backgroundColor: Tokens.default.colors.BACKGROUND_BASE_LOWER,
		},
		codeText: { fontFamily: 'monospace', padding: 12 },
		image: { flex: 1, margin: 16 },
		actions: {
			flexDirection: 'row',
			gap: 8,
			paddingHorizontal: 16,
			paddingBottom: 16,
		},
	}) as any
	return useStyles!()
}

const toast = (text: string, ok = true) =>
	ToastActionCreators.open(TOAST_KEY, {
		text,
		variant: ok ? 'success' : 'critical',
	})

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function freshUrl(url: string) {
	const [utils] = lookupModuleWithImportedPath<any>(URL_UTILS_PATH)
	if (typeof utils?.maybeRefreshAttachmentUrl !== 'function') return url
	try {
		const refreshed = await utils.maybeRefreshAttachmentUrl(url)
		return typeof refreshed === 'string' && refreshed ? refreshed : url
	} catch {
		return url
	}
}

function visibleEntries(entries: ZipEntry[], path: string) {
	const directories = new Set<string>()
	const files: ZipEntry[] = []
	const prefix = path ? `${path}/` : ''
	for (const entry of entries) {
		if (!entry.path.startsWith(prefix)) continue
		const rest = entry.path.slice(prefix.length)
		const slash = rest.indexOf('/')
		if (slash === -1) files.push(entry)
		else directories.add(rest.slice(0, slash))
	}
	return { directories: [...directories].sort(), files }
}

const MAX_RESULTS = 200

function searchEntries(entries: ZipEntry[], query: string) {
	const needle = query.trim().toLowerCase()
	const directories = new Set<string>()
	for (const entry of entries) {
		const parts = entry.path.split('/')
		for (let index = 1; index < parts.length; index++)
			directories.add(parts.slice(0, index).join('/'))
	}
	const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
	return {
		directories: [...directories]
			.filter(path => nameOf(path).toLowerCase().includes(needle))
			.sort()
			.slice(0, MAX_RESULTS),
		files: entries
			.filter(entry => entry.name.toLowerCase().includes(needle))
			.slice(0, MAX_RESULTS),
	}
}

function AssetButton({
	name,
	label,
	onPress,
}: {
	name: string
	label: string
	onPress: () => void
}) {
	const style = styles()
	const source = getAssetIdByName(name)
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			style={style.headerButton}
			onPress={onPress}
		>
			{source !== undefined ? (
				<Image source={source} style={style.icon} />
			) : null}
		</Pressable>
	)
}

function Header({
	title,
	subtitle,
	onBack,
	trailing,
}: {
	title: string
	subtitle?: string
	onBack: () => void
	trailing?: React.ReactNode
}) {
	const { Text } = Design
	const style = styles()
	return (
		<View style={style.header}>
			<AssetButton name="ArrowLargeLeftIcon" label="Back" onPress={onBack} />
			<View style={style.headerText}>
				<Text variant="heading-md/bold" color="text-strong" lineClamp={1}>
					{title}
				</Text>
				{subtitle ? (
					<Text variant="text-xs/medium" color="text-muted" lineClamp={1}>
						{subtitle}
					</Text>
				) : null}
			</View>
			{trailing}
		</View>
	)
}

function StateView({ text, loading }: { text: string; loading?: boolean }) {
	const { Text } = Design
	const style = styles()
	return (
		<View style={style.state}>
			{loading ? <ActivityIndicator /> : null}
			<Text
				variant="text-md/medium"
				color="text-muted"
				style={{ textAlign: 'center' }}
			>
				{text}
			</Text>
		</View>
	)
}

function Breadcrumb({
	path,
	onNavigate,
}: {
	path: string
	onNavigate: (path: string) => void
}) {
	const { Text } = Design
	const style = styles()
	const parts = path ? path.split('/') : []
	return (
		<ScrollView
			horizontal
			style={{ flexGrow: 0 }}
			showsHorizontalScrollIndicator={false}
		>
			<View style={style.breadcrumb}>
				<TableRowAssetIcon name="FolderIcon" />
				<Pressable style={style.crumb} onPress={() => onNavigate('')}>
					<Text
						variant="text-sm/semibold"
						color={parts.length ? 'text-link' : 'text-muted'}
					>
						/
					</Text>
				</Pressable>
				{parts.map((part, index) => {
					const target = parts.slice(0, index + 1).join('/')
					const last = index === parts.length - 1
					return (
						<Pressable
							key={target}
							style={style.crumb}
							disabled={last}
							onPress={() => onNavigate(target)}
						>
							<Text
								variant="text-sm/semibold"
								color={last ? 'text-muted' : 'text-link'}
							>
								{last ? `${part}/` : part}
							</Text>
						</Pressable>
					)
				})}
			</View>
		</ScrollView>
	)
}

function FileList({
	listing,
	path,
	onNavigate,
	onOpen,
}: {
	listing: ZipListing
	path: string
	onNavigate: (path: string) => void
	onOpen: (entry: ZipEntry) => void
}) {
	const { TableRowGroup, TableRow, Text } = Design
	const style = styles()
	const [query, setQuery] = useState('')
	const searching = query.trim().length > 0
	const { directories, files } = useMemo(
		() =>
			searching
				? searchEntries(listing.entries, query)
				: visibleEntries(listing.entries, path),
		[listing, path, query],
	)

	if (listing.entries.length === 0)
		return <StateView text="This ZIP is empty." />

	const openDirectory = (target: string) => {
		setQuery('')
		onNavigate(target)
	}

	return (
		<>
			<View style={style.search}>
				<TableRowAssetIcon name="MagnifyingGlassIcon" />
				<TextInput
					style={style.searchInput}
					value={query}
					onChangeText={setQuery}
					placeholder="Search files and folders"
					placeholderTextColor={Tokens.default.colors.TEXT_MUTED}
					autoCapitalize="none"
					autoCorrect={false}
					clearButtonMode="while-editing"
				/>
			</View>
			{searching ? null : <Breadcrumb path={path} onNavigate={onNavigate} />}
			<ScrollView
				contentContainerStyle={style.body}
				keyboardShouldPersistTaps="handled"
			>
				{listing.truncated ? (
					<Text variant="text-sm/medium" color="text-muted">
						{`Only showing first ${MAX_ENTRIES} entries.`}
					</Text>
				) : null}
				{directories.length === 0 && files.length === 0 ? (
					<StateView
						text={searching ? 'No results found.' : 'This folder is empty.'}
					/>
				) : (
					<TableRowGroup>
						{directories.map(directory => {
							const target = searching
								? directory
								: path
									? `${path}/${directory}`
									: directory
							return (
								<TableRow
									key={`dir:${target}`}
									label={`${searching ? directory.slice(directory.lastIndexOf('/') + 1) : directory}/`}
									subLabel={searching ? `/${target}` : undefined}
									icon={<TableRowAssetIcon name="FolderIcon" />}
									arrow
									onPress={() => openDirectory(target)}
								/>
							)
						})}
						{files.map(entry => (
							<TableRow
								key={`file:${entry.path}`}
								label={entry.name}
								subLabel={
									searching
										? `/${entry.path} · ${formatBytes(entry.size)}`
										: formatBytes(entry.size)
								}
								icon={
									<TableRowAssetIcon
										name={entry.kind === 'image' ? 'ImageIcon' : 'FileIcon'}
									/>
								}
								arrow={entry.kind !== 'unsupported'}
								onPress={
									entry.kind === 'unsupported' ? undefined : () => onOpen(entry)
								}
							/>
						))}
					</TableRowGroup>
				)}
			</ScrollView>
		</>
	)
}

function useSave(key: string, entry: ZipEntry) {
	const [saving, setSaving] = useState(false)
	const save = () => {
		if (saving) return
		setSaving(true)
		void saveEntry(key, entry.path)
			.then(location => toast(`Saved to ${location}`))
			.catch(error => toast(errorMessage(error, 'Could not save file.'), false))
			.finally(() => setSaving(false))
	}
	return { saving, save }
}

function TextView({
	loadKey,
	load,
	saving,
	onDownload,
}: {
	loadKey: string
	load: () => Promise<TextPreview>
	saving: boolean
	onDownload: () => void
}) {
	const { Text, Button } = Design
	const style = styles()
	const [state, setState] = useState<Load<TextPreview>>({ status: 'loading' })

	useEffect(() => {
		let alive = true
		setState({ status: 'loading' })
		void load()
			.then(value => alive && setState({ status: 'ready', value }))
			.catch(
				error =>
					alive &&
					setState({
						status: 'error',
						message: errorMessage(error, 'Could not read file.'),
					}),
			)
		return () => {
			alive = false
		}
	}, [loadKey])

	if (state.status === 'loading')
		return <StateView text="Loading file..." loading />
	if (state.status === 'error') return <StateView text={state.message} />

	const { text, truncated } = state.value
	return (
		<>
			<View style={style.code}>
				<ScrollView>
					<ScrollView horizontal>
						<Text
							variant="text-sm/medium"
							color="text-default"
							selectable
							style={style.codeText}
						>
							{truncated ? `${text}\n\n...` : text}
						</Text>
					</ScrollView>
				</ScrollView>
			</View>
			<View style={style.actions}>
				<View style={{ flex: 1 }}>
					<Button
						text="Copy"
						variant="secondary"
						onPress={() => {
							Clipboard.setString(text)
							toast('File contents copied to clipboard!')
						}}
					/>
				</View>
				<View style={{ flex: 1 }}>
					<Button
						text="Download"
						variant="primary"
						loading={saving}
						onPress={onDownload}
					/>
				</View>
			</View>
		</>
	)
}

function TextEntry({
	listingKey,
	entry,
}: {
	listingKey: string
	entry: ZipEntry
}) {
	const { saving, save } = useSave(listingKey, entry)
	return (
		<TextView
			loadKey={`${listingKey}/${entry.path}`}
			load={() => readText(listingKey, entry.path)}
			saving={saving}
			onDownload={save}
		/>
	)
}

function ImageEntry({
	listingKey,
	entry,
}: {
	listingKey: string
	entry: ZipEntry
}) {
	const { Button } = Design
	const style = styles()
	const [state, setState] = useState<Load<string>>({ status: 'loading' })
	const { saving, save } = useSave(listingKey, entry)

	useEffect(() => {
		let alive = true
		void extractImage(listingKey, entry.path)
			.then(value => alive && setState({ status: 'ready', value }))
			.catch(
				error =>
					alive &&
					setState({
						status: 'error',
						message: errorMessage(error, 'Could not open image.'),
					}),
			)
		return () => {
			alive = false
		}
	}, [listingKey, entry.path])

	if (state.status === 'loading')
		return <StateView text="Loading image..." loading />
	if (state.status === 'error') return <StateView text={state.message} />

	return (
		<>
			<Image
				source={{ uri: state.value }}
				style={style.image}
				resizeMode="contain"
			/>
			<View style={style.actions}>
				<View style={{ flex: 1 }}>
					<Button
						text="Download"
						variant="primary"
						loading={saving}
						onPress={save}
					/>
				</View>
			</View>
		</>
	)
}

function ZipScreen({
	url,
	fileName,
	openOriginal,
	close,
}: {
	url: string
	fileName: string
	openOriginal: () => void
	close: () => void
}) {
	const style = styles()
	const insets = ReactNativeSafeAreaContext.useSafeAreaInsets()
	const [state, setState] = useState<Load<ZipListing>>({ status: 'loading' })
	const [path, setPath] = useState('')
	const [entry, setEntry] = useState<ZipEntry>()

	useEffect(() => {
		let alive = true
		void freshUrl(url)
			.then(openZip)
			.then(value => alive && setState({ status: 'ready', value }))
			.catch(
				error =>
					alive &&
					setState({
						status: 'error',
						message: errorMessage(error, 'Failed to preview ZIP.'),
					}),
			)
		return () => {
			alive = false
		}
	}, [url])

	const back = () => {
		if (entry) setEntry(undefined)
		else if (path)
			setPath(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
		else close()
	}

	useEffect(() => {
		const subscription = BackHandler.addEventListener(
			'hardwareBackPress',
			() => {
				back()
				return true
			},
		)
		return () => subscription.remove()
	})

	const listing = state.status === 'ready' ? state.value : undefined

	return (
		<View
			style={[
				style.screen,
				{ paddingTop: insets.top, paddingBottom: insets.bottom },
			]}
		>
			{entry && listing ? (
				<>
					<Header
						title={entry.name}
						subtitle={`${entry.path} · ${formatBytes(entry.size)}`}
						onBack={back}
					/>
					{entry.kind === 'image' ? (
						<ImageEntry listingKey={listing.key} entry={entry} />
					) : (
						<TextEntry listingKey={listing.key} entry={entry} />
					)}
				</>
			) : (
				<>
					<Header
						title={fileName}
						subtitle={
							listing
								? `${listing.entries.length}${listing.truncated ? '+' : ''} files`
								: undefined
						}
						onBack={back}
						trailing={
							<AssetButton
								name="DownloadIcon"
								label="Open original"
								onPress={() => {
									close()
									openOriginal()
								}}
							/>
						}
					/>
					{state.status === 'loading' ? (
						<StateView text="Loading ZIP preview..." loading />
					) : state.status === 'error' ? (
						<StateView text={state.message} />
					) : (
						<FileList
							listing={state.value}
							path={path}
							onNavigate={setPath}
							onOpen={setEntry}
						/>
					)}
				</>
			)}
		</View>
	)
}

interface ModalActions {
	pushModal(options: unknown): void
	popModal(key: string): void
}

function modalActions(): ModalActions | undefined {
	const [module] = lookupModule(
		withProps<ModalActions>('pushModal', 'popModal'),
	)
	return module as ModalActions | undefined
}

function ZipModal({ url, fileName }: { url: string; fileName: string }) {
	return (
		<ZipScreen
			url={url}
			fileName={fileName}
			openOriginal={() => {
				void Linking.openURL(url)
			}}
			close={closePreview}
		/>
	)
}

function TextFileModal({
	url,
	fileName,
	size,
}: {
	url: string
	fileName: string
	size?: number
}) {
	const style = styles()
	const insets = ReactNativeSafeAreaContext.useSafeAreaInsets()
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		const subscription = BackHandler.addEventListener(
			'hardwareBackPress',
			() => {
				closePreview()
				return true
			},
		)
		return () => subscription.remove()
	}, [])

	const download = () => {
		if (saving) return
		setSaving(true)
		void freshUrl(url)
			.then(fresh => saveAttachment(fresh, fileName))
			.then(location => toast(`Saved to ${location}`))
			.catch(error => toast(errorMessage(error, 'Could not save file.'), false))
			.finally(() => setSaving(false))
	}

	return (
		<View
			style={[
				style.screen,
				{ paddingTop: insets.top, paddingBottom: insets.bottom },
			]}
		>
			<Header
				title={fileName}
				subtitle={typeof size === 'number' ? formatBytes(size) : undefined}
				onBack={closePreview}
			/>
			<TextView
				loadKey={url}
				load={() => freshUrl(url).then(fetchTextAttachment)}
				saving={saving}
				onDownload={download}
			/>
		</View>
	)
}

function pushPreview(modal: unknown, props: Record<string, unknown>) {
	const actions = modalActions()
	if (!actions) throw new Error('Could not open the preview.')
	actions.pushModal({
		key: MODAL_KEY,
		modal: {
			key: MODAL_KEY,
			modal,
			props,
			animation: 'slide-up',
			shouldPersistUnderModals: false,
			closable: true,
		},
	})
}

export function openTextPreview(url: string, fileName: string, size?: number) {
	pushPreview(TextFileModal, { url, fileName, size })
}

export function closePreview() {
	modalActions()?.popModal(MODAL_KEY)
}

export function openZipPreview(url: string, fileName: string) {
	pushPreview(ZipModal, { url, fileName })
}
