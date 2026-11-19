/** A run of lyric text sharing one timing window. */
export interface LyricSegment {
	text: string
	start: number
	end: number
	background?: boolean
	/** True when the timing came from the span itself rather than its line. */
	timedSpan?: boolean
}

/** One displayable lyric line: a lead vocal line or a background vocal line. */
export interface LyricLine {
	start: number
	end: number
	text: string
	segments: LyricSegment[]
	voice: number
	background: boolean
	/** Index of the TTML `<p>` the line came from, used to pair background vocals. */
	paragraphId?: number
}

const isWordChar = (char: string) => /[\p{L}\p{N}]/u.test(char)

/** Whether any segment carries its own timing rather than the line's. */
export const hasTimedSegments = (line: LyricLine) =>
	line.segments.some(segment => segment.start !== line.start || segment.end !== line.end)

/** Whether the segment is audible (non-blank text inside its timing window). */
export const isSegmentSounding = (segment: LyricSegment, position: number) =>
	Boolean(segment.text.trim()) && position >= segment.start && position <= segment.end

export const isLineActive = (line: LyricLine, position: number) => position >= line.start && position <= line.end

export const stripBackgroundParens = (value: string) => value.replace(/^\s*\(/, "").replace(/\)\s*$/, "")

/**
 * Orders lines by lead vocal start time and places each background line right
 * after the lead line it belongs to: the one from the same paragraph, otherwise
 * the one it overlaps most (ties broken by the closest start time).
 */
export function attachBackgroundLines(lines: LyricLine[]) {
	const byStart = (a: LyricLine, b: LyricLine) => a.start - b.start
	const leads = lines.filter(line => !line.background).sort(byStart)
	const backing = lines.filter(line => line.background).sort(byStart)
	const attached = new Map<LyricLine, LyricLine[]>()
	const unattached: LyricLine[] = []

	for (const line of backing) {
		const parent = findParentLine(leads, line)
		if (parent) attached.set(parent, [...(attached.get(parent) ?? []), line])
		else unattached.push(line)
	}
	return [...leads.flatMap(line => [line, ...(attached.get(line) ?? [])]), ...unattached]
}

function findParentLine(leads: LyricLine[], background: LyricLine) {
	if (background.paragraphId !== undefined) {
		const sameParagraph = leads.find(line => line.paragraphId === background.paragraphId)
		if (sameParagraph) return sameParagraph
	}
	let best: LyricLine | undefined
	let bestOverlap = -1
	let bestDistance = Number.POSITIVE_INFINITY
	for (const line of leads) {
		const overlap = Math.max(0, Math.min(line.end, background.end) - Math.max(line.start, background.start))
		const distance = Math.abs(line.start - background.start)
		if (overlap > bestOverlap || (overlap === bestOverlap && distance < bestDistance)) {
			best = line
			bestOverlap = overlap
			bestDistance = distance
		}
	}
	return best
}

/**
 * TTML spans often omit the spaces between words. Using the plain-text lyric
 * as a reference, inserts a space segment before each timed span whose word
 * is separated from the previous one by whitespace in the reference.
 */
export function restoreSpacesFromReference(line: LyricLine, reference: string) {
	const letters = Array.from(reference)
		.map((char, index) => ({ char, index }))
		.filter(({ char }) => isWordChar(char))
		.map(({ char, index }) => ({ char: char.toLocaleLowerCase(), index }))
	let cursor = 0
	let previousTextEnd: number | undefined
	const output: LyricSegment[] = []

	for (const segment of line.segments) {
		const wanted = Array.from(segment.text).filter(isWordChar).map(char => char.toLocaleLowerCase())
		const found = segment.timedSpan && wanted.length ? findSequence(letters, wanted, cursor) : -1
		if (found < 0) {
			output.push(segment)
			continue
		}
		const referenceStart = letters[found]!.index
		const prior = output.at(-1)
		if (previousTextEnd !== undefined) {
			const gap = reference.slice(previousTextEnd, referenceStart)
			if (/\s/.test(gap) && !/\s$/.test(prior?.text ?? ""))
				output.push({ text: " ", start: prior?.end ?? segment.start, end: segment.start, background: segment.background })
		}
		previousTextEnd = letters[found + wanted.length - 1]!.index + 1
		cursor = found + wanted.length
		output.push(segment)
	}
	line.segments = output
}

function findSequence(letters: Array<{ char: string }>, wanted: string[], from: number) {
	for (let start = from; start + wanted.length <= letters.length; start++)
		if (wanted.every((char, index) => letters[start + index]!.char === char)) return start
	return -1
}
