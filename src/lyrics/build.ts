import type { Lyrics, LyricsLine } from "cider-sdk"
import { parseTtml } from "../ttml/parse.ts"
import { attachBackgroundLines, restoreSpacesFromReference, stripBackgroundParens, type LyricLine } from "./model.ts"

/**
 * Turns Cider lyrics into display lines. TTML timing is preferred; Cider's
 * plain lines (in the same order) are used to restore word spacing. Without
 * usable TTML, falls back to line-level timing from Cider's own lines.
 */
export function buildDisplayLines(lyrics: Lyrics): LyricLine[] {
	const parsed = lyrics.ttml ? parseTtml(lyrics.ttml) : []
	if (!parsed.length) return fromPlainLines(lyrics.lines)

	const present = lyrics.lines.filter(line => !line.empty)
	restoreSpaces(
		parsed.filter(line => !line.background),
		present.filter(line => !line.isBackground).map(line => line.text),
	)
	restoreSpaces(
		parsed.filter(line => line.background),
		present.filter(line => line.isBackground).map(line => stripBackgroundParens(line.text)),
	)
	return parsed
}

function restoreSpaces(lines: LyricLine[], references: string[]) {
	lines.forEach((line, index) => {
		const reference = references[index]
		if (reference) restoreSpacesFromReference(line, reference)
	})
}

function fromPlainLines(lines: LyricsLine[]): LyricLine[] {
	return attachBackgroundLines(
		lines.map(({ start, end, text, isBackground }) => {
			const lineText = isBackground ? stripBackgroundParens(text) : text
			return {
				start,
				end,
				text: lineText,
				segments: [{ text: lineText, start, end, background: isBackground }],
				voice: 1,
				background: Boolean(isBackground),
			}
		}),
	)
}
