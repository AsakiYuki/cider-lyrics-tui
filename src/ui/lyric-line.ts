import { hasTimedSegments, type LyricLine } from "../lyrics/model.ts"
import { clamp01 } from "../util.ts"
import { brightWhite, gray } from "./ansi.ts"

const UNSUNG_LEVEL = 78
const SUNG_LEVEL = 255

/** Fades characters from dim to white, left to right, as `progress` goes 0 → 1. */
function fadeText(text: string, progress: number) {
	const chars = Array.from(text)
	const sung = progress * chars.length
	return chars
		.map((char, index) => gray(Math.round(UNSUNG_LEVEL + (SUNG_LEVEL - UNSUNG_LEVEL) * clamp01(sung - index)), char))
		.join("")
}

const segmentProgress = (start: number, end: number, position: number) =>
	end > start ? (position - start) / (end - start) : Number(position >= end)

/** Renders a lyric line with per-character karaoke highlighting at `position`. */
export function renderLyricLine(line: LyricLine, position: number) {
	const indent = line.background ? "  " : ""
	if (hasTimedSegments(line))
		return indent + line.segments.map(({ text, start, end }) => fadeText(text, segmentProgress(start, end, position))).join("")

	// Line-level timing only: sweep across the whole line.
	if (line.end <= line.start) return indent + brightWhite(line.text)
	return indent + fadeText(line.text, (position - line.start) / Math.max(0.01, line.end - line.start))
}
