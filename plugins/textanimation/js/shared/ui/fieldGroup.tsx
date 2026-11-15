import * as discordDesign from '@valenced/discord/design'
import * as ReactNative from 'react-native'

interface FieldRowProps {
	label: string
	description?: any
	children: any
}

function design(): any {
	try {
		const Design = discordDesign.Design as any
		return Design?.TableRow ? Design : undefined
	} catch {
		return undefined
	}
}

function PlainFieldRow({ label, description, children }: FieldRowProps) {
	const { View, Text } = ReactNative
	return (
		<View style={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
			<Text style={{ fontSize: 16, fontWeight: '600', color: '#9a9aa2' }}>
				{label}
			</Text>
			{children}
			{description ? (
				<Text style={{ fontSize: 12, color: '#9a9aa2', opacity: 0.8 }}>
					{description}
				</Text>
			) : null}
		</View>
	)
}

export function FieldRow({ label, description, children }: FieldRowProps) {
	const { View } = ReactNative
	const Design = design()
	if (!Design)
		return (
			<PlainFieldRow label={label} description={description}>
				{children}
			</PlainFieldRow>
		)
	const { TableRow, Text } = Design
	return (
		<TableRow
			label={label}
			subLabel={
				<View style={{ gap: 8, marginTop: 8 }}>
					{children}
					{description ? (
						<Text variant="text-sm/normal" color="text-muted">
							{description}
						</Text>
					) : null}
				</View>
			}
		/>
	)
}

export function FieldGroup({
	title,
	...row
}: FieldRowProps & { title?: string }) {
	const TableRowGroup = design()?.TableRowGroup
	if (!TableRowGroup) {
		const { View } = ReactNative
		return (
			<View>
				<FieldRow {...row} />
			</View>
		)
	}
	return (
		<TableRowGroup title={title}>
			<FieldRow {...row} />
		</TableRowGroup>
	)
}
