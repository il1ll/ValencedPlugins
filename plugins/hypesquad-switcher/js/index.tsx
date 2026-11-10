import Page from '@valenced/components/Page'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { useState } from 'react'
import { ScrollView } from 'react-native'

const HOUSES = [
	{ id: 1, name: 'Bravery', flag: 1 << 6 },
	{ id: 2, name: 'Brilliance', flag: 1 << 7 },
	{ id: 3, name: 'Balance', flag: 1 << 8 },
	{ id: 0, name: 'No Badge', flag: 0 },
] as const

function toast(text: string, ok: boolean) {
	ToastActionCreators.open('HYPESQUAD_SWITCHER', {
		text,
		variant: ok ? 'success' : 'critical',
	})
}

function getAPIUtils(): any {
	const [APIUtils] = lookupModule(
		withProps<any>('getAPIBaseURL', 'post', 'del'),
	)
	if (!APIUtils) throw new Error('Discord API module not found')
	return APIUtils
}

function getCurrentHouse(): number {
	const flags: number =
		(Stores.UserStore as any)?.getCurrentUser?.()?.flags ?? 0
	return HOUSES.find(h => h.flag && flags & h.flag)?.id ?? 0
}

const isOk = (res: any) => !!res && (res.status === 204 || res.ok)

async function applyHouse(value: number): Promise<boolean> {
	const house = HOUSES.find(h => h.id === value)
	if (!house) {
		toast('Only 0-3 allowed', false)
		return false
	}

	try {
		const APIUtils = getAPIUtils()
		const res =
			value === 0
				? await APIUtils.del({ url: '/hypesquad/online' })
				: await APIUtils.post({
						url: '/hypesquad/online',
						body: { house_id: value },
					})

		const ok = isOk(res)
		toast(
			ok
				? value === 0
					? 'HypeSquad badge removed'
					: `Joined House ${house.name}!`
				: `Failed: ${res?.status ?? 'unknown'}`,
			ok,
		)
		return ok
	} catch (e: any) {
		toast(`Error: ${e?.body?.message ?? e?.message ?? String(e)}`, false)
		return false
	}
}

function Settings() {
	const { TableRadioGroup, TableRadioRow, TableRowGroup, TableRow } = Design
	const [house, setHouse] = useState(getCurrentHouse)
	const [busy, setBusy] = useState(false)

	const onChange = async (value: number) => {
		if (busy || value === house) return
		setBusy(true)
		if (await applyHouse(value)) setHouse(value)
		setBusy(false)
	}

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 38 }}
		>
			<Page>
				<TableRadioGroup
					title="HypeSquad House"
					value={house}
					onChange={onChange}
				>
					{HOUSES.map(h => (
						<TableRadioRow
							key={h.id}
							label={h.name}
							subLabel={h.id === 0 ? 'Remove your HypeSquad badge' : undefined}
							value={h.id}
							disabled={busy}
						/>
					))}
				</TableRadioGroup>
				<TableRowGroup title="Information">
					<TableRow
						label="How to Change"
						subLabel="Tap a house above to join it, or pick No Badge to remove your badge."
					/>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}

export default plugin({
	SettingsComponent: Settings,
})
