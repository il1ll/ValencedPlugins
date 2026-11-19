import { getStore } from '@valenced/discord/flux'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'

const HANDLERS_PATH = 'modules/messages/native/MessagesHandlers.tsx'
const DOUBLE_TAP = 'handleDoubleTapMessage'
const INITIATE_EDIT = 'handleInitiateEdit'
const EDITABLE_TYPES = new Set([0, 19])

type Handler = (event: any) => unknown

let messageStore: any
let userStore: any

const wrappers = new WeakMap<object, Handler>()
const instances = new Map<any, PropertyDescriptor | undefined>()

function ownMessage(event: any): any {
	const native = event?.nativeEvent
	const channelId = native?.channelId
	const messageId = native?.messageId
	if (!channelId || !messageId) return
	const message = messageStore?.getMessage?.(channelId, messageId)
	const self = userStore?.getCurrentUser?.()?.id
	if (!message || !self || message.author?.id !== self) return
	return message
}

function editable(message: any) {
	if (!EDITABLE_TYPES.has(message.type)) return false
	return message.state === undefined || message.state === 'SENT'
}

function wrap(instance: any, original: Handler): Handler {
	const cached = wrappers.get(original)
	if (cached) return cached
	const wrapper: Handler = function (event: any) {
		let message: any
		try {
			message = ownMessage(event)
		} catch {}
		if (!message) return original.call(instance, event)
		try {
			const edit = instance[INITIATE_EDIT]
			if (typeof edit === 'function' && editable(message))
				edit.call(instance, event)
		} catch {}
	}
	wrappers.set(original, wrapper)
	wrappers.set(wrapper, wrapper)
	return wrapper
}

function patchInstance(instance: any, value?: unknown) {
	if (!instance || typeof instance !== 'object') return
	const own = Object.getOwnPropertyDescriptor(instance, DOUBLE_TAP)
	const current: unknown =
		value !== undefined ? value : own ? own.value : instance[DOUBLE_TAP]
	if (typeof current !== 'function' || wrappers.get(current) === current) return
	if (!instances.has(instance))
		instances.set(
			instance,
			own ?? Object.getOwnPropertyDescriptor(instance, DOUBLE_TAP),
		)
	Object.defineProperty(instance, DOUBLE_TAP, {
		configurable: true,
		writable: true,
		value: wrap(instance, current as Handler),
	})
}

function restoreInstances() {
	for (const [instance, descriptor] of instances) {
		try {
			if (descriptor) Object.defineProperty(instance, DOUBLE_TAP, descriptor)
			else delete instance[DOUBLE_TAP]
		} catch {}
	}
	instances.clear()
}

function patchAccessor(
	prototype: any,
	key: string,
	cleanup: (fn: () => void) => void,
	after: (instance: any, value: any) => any,
) {
	const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
	const getter = descriptor?.get
	if (!descriptor || !getter) return false
	Object.defineProperty(prototype, key, {
		...descriptor,
		get(this: any) {
			const value = getter.call(this)
			if (this === prototype) return value
			try {
				return after(this, value)
			} catch {
				return value
			}
		},
	})
	cleanup(() => Object.defineProperty(prototype, key, descriptor))
	return true
}

function patchHandlers(module: any, cleanup: (fn: () => void) => void) {
	const prototype = module?.MessagesHandlers?.prototype
	if (!prototype) return
	patchAccessor(prototype, DOUBLE_TAP, cleanup, (instance, value) => {
		if (typeof value !== 'function') return value
		patchInstance(instance, value)
		return Object.getOwnPropertyDescriptor(instance, DOUBLE_TAP)?.value ?? value
	})
	patchAccessor(prototype, 'params', cleanup, (instance, value) => {
		patchInstance(instance)
		return value
	})
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			getStore<any>('MessageStore', store => {
				messageStore = store
			}),
		)
		cleanup(
			getStore<any>('UserStore', store => {
				userStore = store
			}),
		)
		cleanup(
			getModuleWithImportedPath<any>(HANDLERS_PATH, module =>
				patchHandlers(module, cleanup),
			),
		)
		cleanup(() => {
			restoreInstances()
			messageStore = undefined
			userStore = undefined
		})
	},
})
