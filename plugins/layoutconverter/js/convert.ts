import ar from './maps/ar.json'
import data from './maps/data.json'
import ru from './maps/ru.json'

type LangMap = {
	map: Record<string, string>
	range: number[][]
}

const maps: Record<string, LangMap> = {
	ar: ar as LangMap,
	ru: ru as LangMap,
}

export const languages = data.langs as Record<string, string>
export const defaultLanguage = data.deflang

const EN_RANGE: number[][] = [
	[65, 90],
	[97, 122],
]

const revCache: Record<string, Record<string, string>> = {}

function getRange(lang: string): number[][] {
	return maps[lang]?.range ?? EN_RANGE
}

function inRange(char: string, ranges: number[][]): boolean {
	const code = char.charCodeAt(0)
	for (const [s, e] of ranges) {
		if (code >= s && code <= e) return true
	}
	return false
}

function buildReverse(m: Record<string, string>): Record<string, string> {
	const rev: Record<string, string> = {}
	for (const [k, v] of Object.entries(m)) {
		if (rev[v] === undefined) {
			rev[v] = k
		} else {
			const existing = rev[v]
			const kIsLower = k === k.toLowerCase() && k !== k.toUpperCase()
			const exIsLower =
				existing === existing.toLowerCase() &&
				existing !== existing.toUpperCase()
			if (kIsLower && !exIsLower) rev[v] = k
		}
	}
	return rev
}

function getReverse(lang: string): Record<string, string> {
	if (!revCache[lang]) {
		revCache[lang] = buildReverse(maps[lang].map)
	}
	return revCache[lang]
}

export function convertText(text: string, language: string): string {
	const target = maps[language] ? language : defaultLanguage
	if (!maps[target]) return text

	const fwd = maps[target].map
	const rev = getReverse(target)
	const tRange = getRange(target)

	let out = ''
	let i = 0
	while (i < text.length) {
		if (i + 1 < text.length) {
			const pair = text.substring(i, i + 2)
			if (
				rev[pair] !== undefined &&
				inRange(text[i], tRange) &&
				inRange(text[i + 1], tRange)
			) {
				out += rev[pair]
				i += 2
				continue
			}
		}

		const char = text[i]

		if (inRange(char, tRange)) {
			out += rev[char] ?? char
			i++
			continue
		}

		if (inRange(char, EN_RANGE)) {
			out += fwd[char] ?? char
			i++
			continue
		}

		const inFwd = fwd[char] !== undefined
		const inRev = rev[char] !== undefined
		if (inFwd && !inRev) {
			out += fwd[char]
		} else if (inRev && !inFwd) {
			out += rev[char]
		} else {
			out += char
		}
		i++
	}
	return out
}
