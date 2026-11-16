import { ToastActionCreators } from '@valenced/discord/actions'
import { getStore } from '@valenced/discord/flux'
import {
	getModuleWithImportedPath,
	lookupModuleWithImportedPath,
} from '@valenced/discord/utils/modules/finders'
import { instead } from '@valenced/patcher'
import { errorMessage } from './native'
import { closePreview, openTextPreview, openZipPreview } from './viewer'

const ROW_GENERATOR_PATH = 'modules/messages/native/renderer/RowGenerator.tsx'
const HANDLERS_PATH = 'modules/messages/native/MessagesHandlers.tsx'
const THEME_COLORS_PATH =
	'modules/messages/native/renderer/row_data/embeds/getEmbedThemeColors.tsx'
const CODED_LINKS_PATH =
	'modules/messages/native/renderer/row_data/embeds/coded_links/CodedLinksConstants.tsx'
const TAP_HANDLERS = ['handleTapInviteEmbed', 'handleTapInviteEmbedAccept']
const ATTACHMENT_URL =
	/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/(?=\d)/
const FALLBACK_COLORS = {
	acceptLabelGreenBackgroundColor: -14385083,
	headerColor: -6973533,
	borderColor: 268435455,
	backgroundColor: -14276817,
}
const MAX_TRACKED = 500

interface Attachment {
	id?: string
	filename?: string
	title?: string
	url?: string
	proxy_url?: string
	size?: number
}

interface MessageLike {
	id?: string
	attachments?: Attachment[]
	codedLinks?: unknown[]
	messageReference?: { type?: number; channel_id?: string; message_id?: string }
	messageSnapshots?: { message?: MessageLike }[]
}

const TEXT_EXTENSIONS = new Set([
	'asm',
	'bash',
	'bat',
	'c',
	'cc',
	'cfg',
	'cjs',
	'clj',
	'cmake',
	'conf',
	'cpp',
	'cs',
	'css',
	'csv',
	'cxx',
	'dart',
	'diff',
	'env',
	'erl',
	'ex',
	'exs',
	'fish',
	'fs',
	'go',
	'gradle',
	'graphql',
	'groovy',
	'h',
	'hpp',
	'hs',
	'htm',
	'html',
	'ini',
	'java',
	'jl',
	'js',
	'json',
	'json5',
	'jsonc',
	'jsx',
	'kt',
	'kts',
	'less',
	'lisp',
	'log',
	'lua',
	'm',
	'md',
	'mjs',
	'ml',
	'nim',
	'nix',
	'patch',
	'php',
	'pl',
	'properties',
	'ps1',
	'py',
	'pyw',
	'r',
	'rb',
	'rs',
	'rst',
	'sass',
	'scala',
	'scss',
	'sh',
	'sql',
	'svelte',
	'svg',
	'swift',
	'tex',
	'toml',
	'ts',
	'tsv',
	'tsx',
	'txt',
	'vb',
	'vue',
	'xml',
	'yaml',
	'yml',
	'zig',
	'zsh',
])

type PreviewKind = 'zip' | 'text'

function extensionOf(name: string) {
	const dot = name.lastIndexOf('.')
	return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function kindOf(attachment: Attachment | undefined): PreviewKind | undefined {
	const name = attachment?.filename
	if (typeof name !== 'string') return
	const extension = extensionOf(name)
	if (extension === 'zip') return 'zip'
	if (TEXT_EXTENSIONS.has(extension)) return 'text'
}

const isPreviewable = (attachment: Attachment | undefined) =>
	kindOf(attachment) !== undefined

const offsets = new Map<string, number>()

function remember(messageId: string, offset: number) {
	offsets.delete(messageId)
	offsets.set(messageId, offset)
	if (offsets.size <= MAX_TRACKED) return
	const oldest = offsets.keys().next().value
	if (oldest !== undefined) offsets.delete(oldest)
}

function formatBytes(bytes: number | undefined) {
	if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '? bytes'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

let themeStore: any
let messageStore: any
let selectedChannelStore: any

function themeColors(): { colors: any; baseColors: any } {
	const [module] = lookupModuleWithImportedPath<any>(THEME_COLORS_PATH)
	try {
		const result = module?.default?.(themeStore?.theme)
		if (result?.colors && result?.baseColors) return result
	} catch {}
	return { colors: FALLBACK_COLORS, baseColors: FALLBACK_COLORS }
}

function activityInviteType() {
	const [module] = lookupModuleWithImportedPath<any>(CODED_LINKS_PATH)
	return module?.CodedLinkExtendedType?.EMBEDDED_ACTIVITY_INVITE ?? 3
}

function cardLabel(attachment: Attachment) {
	if (kindOf(attachment) === 'zip') return 'ZIP'
	return extensionOf(attachment.filename ?? '').toUpperCase() || 'FILE'
}

function previewCard(attachment: Attachment) {
	const { colors, baseColors } = themeColors()
	return {
		...baseColors,
		acceptLabelBackgroundColor: colors.acceptLabelGreenBackgroundColor,
		headerColor: baseColors.headerColor ?? colors.headerColor,
		borderColor: baseColors.borderColor ?? colors.borderColor,
		backgroundColor: baseColors.backgroundColor ?? colors.backgroundColor,
		thumbnailCornerRadius: 15,
		channelIcon: null,
		headerText: '',
		titleText: `${cardLabel(attachment)} — ${formatBytes(attachment.size)}`,
		structurableSubtitleText: null,
		type: null,
		extendedType: activityInviteType(),
		participantAvatarUris: [],
		acceptLabelText: 'Preview',
		splashUrl: null,
		noParticipantsText: `\n${attachment.filename}`,
		ctaEnabled: true,
	}
}

function sizeOf(row: Attachment, stored: Attachment | undefined) {
	if (typeof row.size === 'number') return row.size
	if (typeof stored?.size === 'number') return stored.size
	return undefined
}

function storedAttachments(
	row: MessageLike & { channelId?: string; channel_id?: string },
) {
	const channelId =
		row.channelId ?? row.channel_id ?? selectedChannelStore?.getChannelId?.()
	try {
		const message: MessageLike | undefined = messageStore?.getMessage?.(
			channelId,
			row.id,
		)
		return message
			? (contentOf(message).attachments ?? []).filter(isPreviewable)
			: []
	} catch {
		return []
	}
}

function patchRows(message: MessageLike | undefined) {
	if (!message?.id || !Array.isArray(message.attachments)) return
	const zips = message.attachments.filter(isPreviewable)
	if (!zips.length) return
	const codedLinks = Array.isArray(message.codedLinks) ? message.codedLinks : []
	remember(String(message.id), codedLinks.length)
	const stored = storedAttachments(message)
	message.codedLinks = [
		...codedLinks,
		...zips.map((zip, index) =>
			previewCard({ ...zip, size: sizeOf(zip, stored[index]) }),
		),
	]
}

function resolveMessage(messageId: string): MessageLike | undefined {
	const channelId = selectedChannelStore?.getChannelId?.()
	let message: MessageLike | undefined = messageStore?.getMessage?.(
		channelId,
		messageId,
	)
	const reference = message?.messageReference
	if (
		reference &&
		reference.type === 0 &&
		reference.channel_id &&
		reference.channel_id !== channelId &&
		reference.message_id
	) {
		message =
			messageStore?.getMessage?.(reference.channel_id, reference.message_id) ??
			message
	}
	const snapshot = message?.messageSnapshots?.[0]?.message
	return snapshot ?? message
}

function messageFromEvent(
	handlers: any,
	rawId: unknown,
): MessageLike | undefined {
	try {
		const data = handlers?.getMessageData?.(rawId)
		const message = data?.message ?? data
		if (message && typeof message === 'object' && 'id' in message)
			return message as MessageLike
	} catch {}
	return rawId == null ? undefined : resolveMessage(String(rawId))
}

function contentOf(message: MessageLike): MessageLike {
	return message.messageSnapshots?.[0]?.message ?? message
}

function previewFromEvent(handlers: any, event: unknown): boolean {
	const native = (event as { nativeEvent?: Record<string, any> } | undefined)
		?.nativeEvent
	const index = Number(native?.index)
	if (!Number.isInteger(index)) return false
	const outer = messageFromEvent(handlers, native?.messageId)
	if (!outer?.id) return false
	const offset =
		offsets.get(String(outer.id)) ??
		(Array.isArray(outer.codedLinks) ? outer.codedLinks.length : 0)
	if (index < offset) return false
	const message = contentOf(outer)
	const zips = (message.attachments ?? []).filter(isPreviewable)
	const attachment = zips[index - offset]
	const url = attachment?.url ?? attachment?.proxy_url
	if (
		!attachment?.filename ||
		typeof url !== 'string' ||
		!ATTACHMENT_URL.test(url)
	)
		return false
	try {
		if (kindOf(attachment) === 'zip') openZipPreview(url, attachment.filename)
		else openTextPreview(url, attachment.filename, attachment.size)
	} catch (error) {
		ToastActionCreators.open('FILE_PREVIEW_TOAST', {
			text: errorMessage(error, 'Could not open the preview.'),
			variant: 'critical',
		})
	}
	return true
}

const patchedHandlers = new WeakSet<object>()

function tapWrapper(this: unknown, args: any[], original: any) {
	if (previewFromEvent(this, args[0])) return
	return Reflect.apply(original, this, args)
}

function patchHandlers(handlers: any, cleanup: (fn: () => void) => void) {
	if (
		!handlers ||
		typeof handlers !== 'object' ||
		patchedHandlers.has(handlers)
	)
		return
	patchedHandlers.add(handlers)
	for (const key of TAP_HANDLERS)
		if (Object.hasOwn(handlers, key) && typeof handlers[key] === 'function')
			cleanup(instead(handlers, key, tapWrapper))
}

function hasTapHandler(value: any) {
	return TAP_HANDLERS.some(key => typeof value?.[key] === 'function')
}

function scanForHandlers(
	root: any,
	cleanup: (fn: () => void) => void,
	depth = 3,
) {
	const seen = new Set<object>()
	let budget = 300
	const visit = (value: any, level: number) => {
		if (!value || typeof value !== 'object' || seen.has(value) || budget <= 0)
			return
		seen.add(value)
		budget--
		if (hasTapHandler(value)) patchHandlers(value, cleanup)
		if (level >= depth) return
		let keys: string[] = []
		try {
			keys = Object.getOwnPropertyNames(value)
		} catch {}
		for (const key of keys) {
			let child: unknown
			try {
				child = value[key]
			} catch {
				continue
			}
			if (child && typeof child === 'object') visit(child, level + 1)
		}
	}
	visit(root, 0)
}

function patchEventEmitter(cleanup: (fn: () => void) => void) {
	const bridge = (globalThis as any).__fbBatchedBridge
	let emitter: any
	try {
		emitter = bridge?.getCallableModule?.('RCTEventEmitter')
	} catch {}
	if (typeof emitter?.receiveEvent !== 'function') return
	cleanup(
		instead(emitter, 'receiveEvent', function (this: unknown, args, original) {
			const [, type, nativeEvent] = args as [unknown, unknown, any]
			if (
				typeof type === 'string' &&
				/invite/i.test(type) &&
				nativeEvent &&
				typeof nativeEvent.messageId !== 'undefined' &&
				Number.isInteger(Number(nativeEvent.index))
			) {
				try {
					if (previewFromEvent(undefined, { nativeEvent })) return
				} catch {}
			}
			return Reflect.apply(original, this, args)
		}),
	)
}

function patchPrototypeMethods(
	prototype: any,
	cleanup: (fn: () => void) => void,
) {
	for (const key of Object.getOwnPropertyNames(prototype)) {
		if (key === 'constructor') continue
		const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
		if (typeof descriptor?.value !== 'function') continue
		if (TAP_HANDLERS.includes(key)) {
			cleanup(instead(prototype, key, tapWrapper))
			continue
		}
		cleanup(
			instead(prototype, key, function (this: unknown, args, original) {
				scanForHandlers(this, cleanup, 2)
				return Reflect.apply(original, this, args)
			}),
		)
	}
}

function patchHandlersClass(module: any, cleanup: (fn: () => void) => void) {
	const prototype = module?.MessagesHandlers?.prototype
	if (!prototype) return
	patchPrototypeMethods(prototype, cleanup)
	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'params')
	const getter = descriptor?.get
	if (!descriptor || !getter) return
	Object.defineProperty(prototype, 'params', {
		...descriptor,
		get(this: unknown) {
			patchHandlers(this, cleanup)
			const result = getter.call(this)
			patchHandlers(result, cleanup)
			return result
		},
	})
	cleanup(() => Object.defineProperty(prototype, 'params', descriptor))
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			getStore<any>('ThemeStore', store => {
				themeStore = store
			}),
		)
		cleanup(
			getStore<any>('MessageStore', store => {
				messageStore = store
			}),
		)
		cleanup(
			getStore<any>('SelectedChannelStore', store => {
				selectedChannelStore = store
			}),
		)

		cleanup(
			getModuleWithImportedPath<any>(ROW_GENERATOR_PATH, module => {
				const prototype = module?.default?.prototype
				if (typeof prototype?.generate !== 'function') return
				cleanup(
					instead(
						prototype,
						'generate',
						function (this: unknown, args, original) {
							try {
								scanForHandlers(this, cleanup)
							} catch {}
							const row: any = Reflect.apply(original, this, args)
							try {
								patchRows(row?.message)
							} catch {}
							return row
						},
					),
				)
			}),
		)

		cleanup(
			getModuleWithImportedPath<any>(HANDLERS_PATH, module =>
				patchHandlersClass(module, cleanup),
			),
		)

		patchEventEmitter(cleanup)

		cleanup(() => offsets.clear())
		cleanup(closePreview)
	},
})
