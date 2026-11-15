import FormSwitch from '@valenced/components/FormSwitch'
import { AlertActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { cloneElement, createContext, useContext } from 'react'
import type { ComponentType, ReactElement, ReactNode } from 'react'
import { authenticate } from './prompts'
import { hasPassword } from './state'

const PLUGIN_ID = 'com.coder.chatlock'

const GUARDED: Record<string, { title: string; description: string }> = {
	PluginUninstallConfirmationAlert: {
		title: 'Uninstall Chat Lock',
		description: 'Enter your password to uninstall Chat Lock.',
	},
	PluginClearDataConfirmationAlert: {
		title: 'Clear Chat Lock Data',
		description: 'Enter your password to clear Chat Lock data.',
	},
}

function nameOf(type: any): string {
	if (!type) return ''
	return (
		type.displayName ??
		type.name ??
		type.type?.displayName ??
		type.type?.name ??
		type.render?.displayName ??
		type.render?.name ??
		''
	)
}

function mentionsPlugin(value: unknown, depth = 0): boolean {
	if (value === PLUGIN_ID) return true
	if (!value || typeof value !== 'object' || depth > 3) return false
	for (const key of Object.keys(value))
		if (mentionsPlugin((value as Record<string, unknown>)[key], depth + 1))
			return true
	return false
}

const STOP_LABEL = 'Stop'

const OptionsContext = createContext(false)

type Element = ReactElement<Record<string, any>>

function inOptions() {
	try {
		return useContext(OptionsContext)
	} catch {
		return false
	}
}

function ownsPlugin(node: unknown, depth = 0): boolean {
	if (!node || typeof node !== 'object' || depth > 8) return false
	if (Array.isArray(node))
		return node.some(child => ownsPlugin(child, depth + 1))
	const props = (node as { props?: Record<string, any> }).props
	if (!props) return false
	if (props.plugin?.manifest?.id === PLUGIN_ID) return true
	return ownsPlugin(props.children, depth + 1)
}

function confirmed(title: string, description: string, action: () => unknown) {
	void (async () => {
		if ((await hasPassword()) && !(await authenticate(title, description)))
			return
		action()
	})()
}

export function patchGuard(cleanup: (fn: () => void) => void) {
	cleanup(
		afterJSX(Design.ActionSheet as ComponentType<any>, element => {
			if (!element || typeof element !== 'object') return element
			const sheet = element as Element
			if (!ownsPlugin(sheet.props.children)) return element
			return cloneElement(
				sheet,
				undefined,
				<OptionsContext.Provider value>
					{sheet.props.children as ReactNode}
				</OptionsContext.Provider>,
			)
		}),
	)

	cleanup(
		afterJSX(Design.IconButton as ComponentType<any>, element => {
			if (!element || typeof element !== 'object') return element
			const button = element as Element
			if (button.props.label !== STOP_LABEL || !inOptions()) return element
			const onPress = button.props.onPress as
				| ((...args: unknown[]) => unknown)
				| undefined
			if (typeof onPress !== 'function') return element
			return cloneElement(button, {
				onPress: (...args: unknown[]) =>
					confirmed(
						'Stop Chat Lock',
						'Enter your password to stop Chat Lock.',
						() => onPress(...args),
					),
			})
		}),
	)

	cleanup(
		afterJSX(FormSwitch as ComponentType<any>, element => {
			if (!element || typeof element !== 'object') return element
			const toggle = element as Element
			if (toggle.key !== PLUGIN_ID) return element
			const onValueChange = toggle.props.onValueChange as
				| ((value: boolean) => unknown)
				| undefined
			if (typeof onValueChange !== 'function') return element
			return cloneElement(toggle, {
				onValueChange: (value: boolean) => {
					if (value) {
						onValueChange(value)
						return
					}
					confirmed(
						'Disable Chat Lock',
						'Enter your password to disable Chat Lock.',
						() => onValueChange(value),
					)
				},
			})
		}),
	)

	cleanup(
		instead(
			AlertActionCreators,
			'openAlert',
			function (this: unknown, args, original) {
				const element = args[1] as
					| { type?: unknown; props?: unknown }
					| undefined
				const guard = GUARDED[nameOf(element?.type)]
				if (!guard || !mentionsPlugin(element?.props))
					return Reflect.apply(original, this, args)
				void (async () => {
					if (
						(await hasPassword()) &&
						!(await authenticate(guard.title, guard.description))
					)
						return
					Reflect.apply(original, this, args)
				})()
			},
		),
	)
}
