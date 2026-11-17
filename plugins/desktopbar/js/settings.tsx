import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, PanResponder } from 'react-native'
import { ICONS, LABELS, normalize, save } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { ButtonKey, Settings } from './shared'

const { TableRowGroup, TableSwitchRow } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

const MOVE_MS = 140

function move<T>(list: T[], from: number, to: number) {
	const next = [...list]
	const [item] = next.splice(from, 1)
	next.splice(to, 0, item!)
	return next
}

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = normalize(storage.use())
	const order = settings.order

	const [dragging, setDragging] = useState<ButtonKey | null>(null)
	const armed = useRef<ButtonKey | null>(null)
	const active = useRef<ButtonKey | null>(null)
	const heights = useRef<Partial<Record<ButtonKey, number>>>({})
	const target = useRef(0)
	const orderRef = useRef(order)
	orderRef.current = order
	const settingsRef = useRef(settings)
	settingsRef.current = settings

	const positions = useRef(
		Object.fromEntries(
			order.map(key => [key, new Animated.Value(0)]),
		) as Record<ButtonKey, Animated.Value>,
	).current

	useLayoutEffect(() => {
		for (const key of order) positions[key].setValue(0)
	}, [order.join(','), positions])

	const shiftOthers = (
		key: ButtonKey,
		from: number,
		to: number,
		size: number,
	) => {
		orderRef.current.forEach((other, index) => {
			if (other === key) return
			let offset = 0
			if (from < to && index > from && index <= to) offset = -size
			else if (to < from && index >= to && index < from) offset = size
			Animated.timing(positions[other], {
				toValue: offset,
				duration: MOVE_MS,
				useNativeDriver: false,
			}).start()
		})
	}

	const finish = (key: ButtonKey) => {
		const list = orderRef.current
		const from = list.indexOf(key)
		const to = target.current
		armed.current = null
		active.current = null
		setDragging(null)
		if (from === to) {
			for (const item of list)
				Animated.timing(positions[item], {
					toValue: 0,
					duration: MOVE_MS,
					useNativeDriver: false,
				}).start()
			return
		}
		for (const item of list) positions[item].stopAnimation()
		save(storage, { ...settingsRef.current, order: move(list, from, to) })
	}

	const responders = useMemo(
		() =>
			Object.fromEntries(
				order.map(key => [
					key,
					PanResponder.create({
						onStartShouldSetPanResponder: () => false,
						onMoveShouldSetPanResponder: () => armed.current === key,
						onMoveShouldSetPanResponderCapture: () => armed.current === key,
						onPanResponderTerminationRequest: () => false,
						onShouldBlockNativeResponder: () => true,
						onPanResponderGrant: () => {
							target.current = orderRef.current.indexOf(key)
							active.current = key
							setDragging(key)
						},
						onPanResponderMove: (_, gesture) => {
							const list = orderRef.current
							const from = list.indexOf(key)
							const size = heights.current[key] ?? 56
							const to = Math.max(
								0,
								Math.min(list.length - 1, from + Math.round(gesture.dy / size)),
							)
							positions[key].setValue(gesture.dy)
							if (to !== target.current) {
								target.current = to
								shiftOthers(key, from, to, size)
							}
						},
						onPanResponderRelease: () => finish(key),
						onPanResponderTerminate: () => finish(key),
					}),
				]),
			) as Record<ButtonKey, ReturnType<typeof PanResponder.create>>,
		[order.join(',')],
	)

	return (
		<Page>
			<TableRowGroup
				title="Buttons"
				description="Hold the handle and drag to reorder. The top button sits on the right."
			>
				{order.map((key, index) => (
					<Animated.View
						key={key}
						{...responders[key].panHandlers}
						onLayout={event => {
							heights.current[key] = event.nativeEvent.layout.height
						}}
						style={{
							zIndex: dragging === key ? 10 : 0,
							elevation: dragging === key ? 10 : 0,
							opacity: dragging === key ? 0.9 : 1,
							transform: [{ translateY: positions[key] }],
						}}
					>
						<TableSwitchRow
							start={index === 0}
							end={index === order.length - 1}
							draggable
							dragHandlePressableProps={{
								onPressIn: () => {
									armed.current = key
								},
								onPressOut: () => {
									if (active.current !== key) armed.current = null
								},
							}}
							icon={<TableRowAssetIcon name={ICONS[key]} />}
							label={LABELS[key]}
							value={!settings.hidden.includes(key)}
							onValueChange={value => {
								const hidden = settings.hidden.filter(item => item !== key)
								if (!value) hidden.push(key)
								save(storage, { ...settings, hidden })
							}}
						/>
					</Animated.View>
				))}
			</TableRowGroup>
		</Page>
	)
}
