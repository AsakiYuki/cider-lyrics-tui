const pad = (value: number, length = 2) => String(value).padStart(length, "0")

/** Formats seconds as an `HH:MM:SS.mmm` TTML clock value. */
export function formatTimecode(seconds: number) {
	const ms = Math.max(0, Math.round(seconds * 1000))
	const h = Math.floor(ms / 3_600_000)
	const m = Math.floor((ms % 3_600_000) / 60_000)
	const s = Math.floor((ms % 60_000) / 1000)
	return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`
}

const UNIT_SCALE = { ms: 1 / 1000, s: 1, m: 60, h: 3600 } as const

/**
 * Parses a TTML time expression into seconds. Supports bare seconds, offset
 * times with a unit (`ms`, `s`, `m`, `h`), and clock times (`MM:SS.mmm` or
 * `HH:MM:SS.mmm`, as used by Apple TTML).
 */
export function parseTtmlTime(value?: string): number | undefined {
	if (!value) return undefined
	const text = value.trim()
	if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text)

	const offset = text.match(/^(-?(?:\d+\.?\d*|\.\d+))(ms|s|m|h)$/)
	if (offset) return Number.parseFloat(offset[1]!) * UNIT_SCALE[offset[2] as keyof typeof UNIT_SCALE]

	const parts = text.split(":")
	if (parts.length !== 2 && parts.length !== 3) return undefined
	const last = parts.at(-1)!.match(/^(\d{1,2})(?:[.,](\d+))?$/)
	if (!last) return undefined
	const seconds = Number(last[1]) + (last[2] ? Number(`0.${last[2]}`) : 0)

	if (parts.length === 2) {
		const minutes = Number(parts[0])
		return Number.isFinite(minutes) ? minutes * 60 + seconds : undefined
	}
	const [hours, minutes] = parts as [string, string, string]
	if (!/^\d+$/.test(hours) || !/^\d{1,2}$/.test(minutes)) return undefined
	return Number(hours) * 3600 + Number(minutes) * 60 + seconds
}
