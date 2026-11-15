import { ReactNativeSafeAreaContext } from '@valenced/externals/react-native-safe-area-context'

export function useBottomPadding(base = 16): number {
	try {
		const { useSafeAreaInsets, initialWindowMetrics } =
			ReactNativeSafeAreaContext
		const hook = useSafeAreaInsets()?.bottom ?? 0
		const window = initialWindowMetrics?.insets?.bottom ?? 0
		return Math.max(hook, window) + base
	} catch {}
	return base
}
