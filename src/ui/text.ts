import type { LyricLine } from "../lyrics/model.ts"
import { stripAnsi } from "./ansi.ts"

function isWideCodePoint(code: number) {
	return (
		code >= 0x1100 &&
		(code <= 0x115f ||
			code === 0x2329 ||
			code === 0x232a ||
			(code >= 0x2e80 && code <= 0xa4cf) ||
			(code >= 0xac00 && code <= 0xd7a3) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xfe10 && code <= 0xfe6f) ||
			(code >= 0xff00 && code <= 0xff60) ||
			(code >= 0x1f300 && code <= 0x1faff))
	)
}

/** Display width in terminal cells, ignoring ANSI escapes and combining marks. */
export function terminalWidth(value: string) {
	let width = 0
	for (const char of stripAnsi(value)) {
		if (/\p{Mark}/u.test(char)) continue
		width += isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1
	}
	return width
}

interface Glyph {
	/** The visible character, prefixed by any ANSI escapes preceding it. */
	text: string
	width: number
	whitespace: boolean
}

function toGlyphs(value: string) {
	const glyphs: Glyph[] = []
	let pendingAnsi = ""
	for (const token of value.match(/\x1b\[[0-?]*[ -/]*[@-~]|[\s\S]/gu) ?? []) {
		if (token.startsWith("\x1b[")) {
			pendingAnsi += token
			continue
		}
		glyphs.push({ text: pendingAnsi + token, width: terminalWidth(token), whitespace: /\s/u.test(token) })
		pendingAnsi = ""
	}
	if (pendingAnsi && glyphs.length) glyphs.at(-1)!.text += pendingAnsi
	return glyphs
}

/** Splits glyphs into alternating runs of whitespace and non-whitespace. */
function toRuns(glyphs: Glyph[]) {
	const runs: Array<{ glyphs: Glyph[]; width: number; whitespace: boolean }> = []
	for (const glyph of glyphs) {
		const last = runs.at(-1)
		if (last && last.whitespace === glyph.whitespace) {
			last.glyphs.push(glyph)
			last.width += glyph.width
		} else runs.push({ glyphs: [glyph], width: glyph.width, whitespace: glyph.whitespace })
	}
	return runs
}

/**
 * Word-wraps ANSI-styled text to `maxWidth` cells. Whitespace that would end a
 * row is dropped; words longer than a row are broken by character.
 */
export function wrapTerminalText(value: string, maxWidth: number) {
	const width = Math.max(1, maxWidth)
	const runs = toRuns(toGlyphs(value))
	const rows: string[] = []
	let row = ""
	let rowWidth = 0
	const breakRow = () => {
		rows.push(row)
		row = ""
		rowWidth = 0
	}

	runs.forEach((run, index) => {
		if (run.whitespace) {
			const nextWordWidth = runs[index + 1]?.width ?? 0
			if (rowWidth + run.width + nextWordWidth > width) return
		} else if (rowWidth > 0 && rowWidth + run.width > width) breakRow()

		for (const glyph of run.glyphs) {
			if (rowWidth > 0 && rowWidth + glyph.width > width) breakRow()
			row += glyph.text
			rowWidth += glyph.width
		}
	})
	if (row || rows.length === 0) rows.push(row)
	return rows
}

/** Right-aligns even-numbered voices (duet partners); odd voices stay left. */
export function placeVoiceLine(line: LyricLine, content: string, width: number) {
	if (line.voice % 2 !== 0) return content
	return " ".repeat(Math.max(0, width - terminalWidth(content))) + content
}
