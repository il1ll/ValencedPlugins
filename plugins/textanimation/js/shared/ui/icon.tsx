import * as assets from '@valenced/assets'
import { Design } from '@valenced/discord/design'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'

const ALIASES: Record<string, string[]> = {
	SparklesIcon: ['MagicWandIcon'],
	SparkleIcon: ['MagicWandIcon'],
}

export function rowIcon(...requested: string[]) {
	return findIcon(requested, false)
}

export function dangerIcon(...requested: string[]) {
	return findIcon(requested, true)
}

function safe<T>(read: () => T): T | undefined {
	try {
		return read()
	} catch {
		return undefined
	}
}

function findIcon(requested: string[], danger: boolean) {
	const names = [
		...new Set(requested.flatMap(name => [name, ...(ALIASES[name] ?? [])])),
	]
	const { getAssetIdByName } = assets
	const { TableRow, TableRowIcon } = Design as any
	const Icon = TableRow?.Icon ?? TableRowIcon
	const lookupComponent = safe(() => lookupGeneratedIconComponent)

	for (const name of names) {
		const source = safe(() => getAssetIdByName(name) || undefined)
		const Component = safe(() => lookupComponent?.(name))
		if (danger) {
			if (Icon && (Component || source))
				return (
					<Icon source={source} IconComponent={Component} variant="danger" />
				)
			continue
		}
		if (source && Icon) return <Icon source={source} />
		if (Component) return <Component />
	}

	return undefined
}
