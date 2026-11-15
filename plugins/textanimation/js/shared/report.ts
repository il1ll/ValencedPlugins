interface Reporter {
	reportError(e: unknown): void
}

const MAX_QUEUED = 20

let reporter: Reporter | undefined
const queued: unknown[] = []
const seen = new Set<string>()

export function setReporter(plugin: Reporter | undefined) {
	reporter = plugin
	if (!plugin) return
	for (const error of queued.splice(0)) send(error)
}

export function reportError(context: string, error?: unknown) {
	const wrapped = withContext(context, error)
	const key = wrapped instanceof Error ? wrapped.message : String(wrapped)
	if (seen.has(key)) return
	seen.add(key)
	if (reporter) send(wrapped)
	else if (queued.length < MAX_QUEUED) queued.push(wrapped)
}

function send(error: unknown) {
	try {
		reporter?.reportError(error)
	} catch {}
}

function withContext(context: string, error: unknown): unknown {
	if (error === undefined) return new Error(context)
	if (!context) return error
	const message = error instanceof Error ? error.message : String(error)
	const wrapped = new Error(`${context} ${message}`)
	if (error instanceof Error && typeof error.stack === 'string') {
		const frames = error.stack.split('\n').slice(1).join('\n')
		if (frames) wrapped.stack = `${wrapped.name}: ${wrapped.message}\n${frames}`
	}
	return wrapped
}
