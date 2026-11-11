const DISCORD_EPOCH = 1420070400000n

export const snowflakeTime = (id: string) => {
	try {
		return Number((BigInt(id) >> 22n) + DISCORD_EPOCH)
	} catch {
		return Date.now()
	}
}

export const pad = (value: number) => String(value).padStart(2, '0')

export const daysInMonth = (year: number, month: number) =>
	new Date(year, month + 1, 0).getDate()

export function formatDate(ms: number) {
	const d = new Date(ms)
	return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

export function formatHour(hours: number, use24Hour: boolean) {
	if (use24Hour) return pad(hours)
	return String(hours % 12 === 0 ? 12 : hours % 12)
}

export const meridiemOf = (hours: number) => (hours < 12 ? 'AM' : 'PM')

export function formatTime(ms: number, use24Hour: boolean) {
	const d = new Date(ms)
	const time = `${formatHour(d.getHours(), use24Hour)}:${pad(d.getMinutes())}`
	return use24Hour ? time : `${time} ${meridiemOf(d.getHours())}`
}

export const formatDateTime = (ms: number, use24Hour: boolean) =>
	`${formatDate(ms)} ${formatTime(ms, use24Hour)}`

function toIsoLike(ms: number, original?: string) {
	const iso = new Date(ms).toISOString()
	if (typeof original !== 'string') return iso

	const offset = original.match(/([+-]\d{2}:\d{2})$/)
	const fraction = original.match(/\.(\d+)/)?.[1]
	const [base, millis] = iso.replace(/Z$/, '').split('.')

	const digits = fraction
		? `.${(millis ?? '000').padEnd(fraction.length, '0').slice(0, fraction.length)}`
		: ''

	return `${base}${digits}${offset ? '+00:00' : 'Z'}`
}

export function convertTimestamp(original: unknown, ms: number): unknown {
	if (
		original &&
		typeof original === 'object' &&
		typeof (original as any).clone === 'function' &&
		typeof (original as any).valueOf === 'function'
	) {
		const current = Number((original as any).valueOf())
		if (Number.isFinite(current))
			return (original as any).clone().add(ms - current, 'milliseconds')
	}

	if (original instanceof Date) return new Date(ms)
	if (typeof original === 'number') return ms
	return toIsoLike(ms, typeof original === 'string' ? original : undefined)
}
