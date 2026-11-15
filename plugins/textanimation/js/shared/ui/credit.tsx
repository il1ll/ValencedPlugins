import { Design } from '@valenced/discord/design'
import * as ReactNative from 'react-native'

export function Credit() {
	const { Text } = Design as any
	const { View } = ReactNative
	return (
		<View style={{ alignItems: 'center', opacity: 0.8 }}>
			<Text
				color="text-muted"
				variant="text-sm/semibold"
				style={{ textAlign: 'center' }}
			>
				Made by bleelblep & coder
			</Text>
		</View>
	)
}
