import type { Lyrics, NowPlayingTrack } from "cider-sdk"
import { isLineActive, isSegmentSounding, type LyricLine } from "../lyrics/model.ts"
import { clamp, clamp01 } from "../util.ts"
import { bold, dim, gray } from "./ansi.ts"
import { renderLyricLine } from "./lyric-line.ts"
import { placeVoiceLine, wrapTerminalText } from "./text.ts"

export const STATUS_READY = "Press Ctrl+C to exit"
export const STATUS_LOADING = "Loading lyrics…"
export const STATUS_WAITING = "Waiting for a track…"

/** Silences between lead lines longer than this show the wait animation. */
const WAIT_GAP_MIN_SECONDS = 3

export interface ScreenState {
	track: NowPlayingTrack | null
	lyrics?: Lyrics
	lines: LyricLine[]
	status: string
}

/** Lays out the full screen: header, lyrics centered on the active line, and a footer pinned to the bottom. */
export function renderScreen(state: ScreenState, position: number, width: number, height: number) {
	const header = renderHeader(state, width).slice(0, Math.max(1, height - 3))
	const body = renderBody(state, position, width, Math.max(1, height - header.length - 1))
	const padding = Array.from({ length: Math.max(0, height - header.length - body.length - 1) }, () => "")
	return [...header, ...body, ...padding, dim(state.status)].slice(0, height)
}

function renderHeader({ track, lyrics }: ScreenState, width: number) {
	const contributor = lyrics?.source.contributorName?.trim()
	const writers = lyrics?.writers?.filter(name => name.trim()) ?? []
	return [
		track ? `${bold(track.name)} — ${track.artistName}` : "Waiting for a track in Cider…",
		dim(lyrics ? `${lyrics.source.provider} · ${lyrics.source.timingType} timing` : "Cider lyrics"),
		...(contributor ? [`Contributor: ${contributor}`] : []),
		...(writers.length ? [`Written by: ${writers.join(", ")}`] : []),
		"─".repeat(clamp(width, 1, 48)),
		"",
	].flatMap(line => wrapTerminalText(line, width))
}

function renderBody(state: ScreenState, position: number, width: number, capacity: number) {
	if (!state.track) return [STATUS_WAITING]
	if (!state.lines.length) return [state.status === STATUS_READY ? STATUS_LOADING : state.status]
	return renderLyrics(state.lines, position, width, capacity)
}

interface WaitGap {
	start: number
	next: LyricLine
}

/** An instrumental gap: nothing is being sung and the next lead line is more than a few seconds away. */
function findWaitGap(lines: LyricLine[], position: number): WaitGap | undefined {
	const leads = lines.filter(line => !line.background)
	const next = leads.find(line => line.start > position)
	if (!next) return undefined
	const start = leads.findLast(line => line.end <= position)?.end ?? 0
	const singing =
		leads.some(line => isLineActive(line, position)) ||
		lines.some(line => line.background && line.segments.some(segment => isSegmentSounding(segment, position)))
	if (singing || next.start - start <= WAIT_GAP_MIN_SECONDS || position < start) return undefined
	return { start, next }
}

function renderLyrics(lines: LyricLine[], position: number, width: number, bodyCapacity: number) {
	// Finished lines scroll away; background vocals stay until their own timing ends.
	const visible = lines.filter(line => line.end >= position)
	const wait = findWaitGap(lines, position)

	const rowsByLine = visible.map(line =>
		wrapTerminalText(renderLyricLine(line, position).replaceAll("\n", " "), width).map((row, index) =>
			placeVoiceLine(line, line.background && index > 0 ? `  ${row}` : row, width),
		),
	)
	const lineRowStart: number[] = []
	let totalRows = 0
	for (const rows of rowsByLine) {
		lineRowStart.push(totalRows)
		totalRows += rows.length
	}
	const allRows = rowsByLine.flat()

	// Keep the current (or next upcoming) line vertically centered.
	let current = visible.findIndex(line => isLineActive(line, position))
	if (current < 0) current = visible.findIndex(line => line.start > position)
	if (current < 0) current = visible.length - 1
	const capacity = Math.max(1, bodyCapacity - (wait ? 1 : 0))
	const activeRow = current >= 0 ? lineRowStart[current]! + Math.floor(rowsByLine[current]!.length / 2) : 0
	const firstRow = Math.max(0, Math.min(allRows.length - capacity, activeRow - Math.floor(capacity / 2)))
	const rows = allRows.slice(firstRow, firstRow + capacity)

	if (wait) {
		const nextIndex = visible.indexOf(wait.next)
		const nextRow = nextIndex >= 0 ? lineRowStart[nextIndex]! : firstRow + rows.length
		const progress = clamp01((position - wait.start) / (wait.next.start - wait.start))
		const indicator = renderWaitIndicator(progress, wait.next.start - position)
		rows.splice(clamp(nextRow - firstRow, 0, rows.length), 0, placeVoiceLine(wait.next, indicator, width))
	}
	return rows
}

/** Three dots that grow `. → o → 0` across the gap; the last one pops to `0` right as lyrics resume. */
function renderWaitIndicator(progress: number, secondsUntilLyrics: number) {
	return [0, 1, 2]
		.map(index => {
			const dotProgress = clamp01(progress * 3 - index)
			let symbol = dotProgress < 1 / 3 ? "." : dotProgress < 1 / 2 ? "o" : "0"
			if (index === 2) {
				if (secondsUntilLyrics <= 0.05) symbol = "0"
				else if (dotProgress >= 1 / 3) symbol = "o"
			}
			return gray(Math.round(90 + 165 * dotProgress), symbol)
		})
		.join(" ")
}
