import type { Cider, Lyrics } from "cider-sdk"
import {
	attachBackgroundLines,
	parseTtml,
	renderTtmlLine,
	restoreSpacesFromReference,
	stripBackgroundParens,
	type TtmlLine,
} from "./lyrics.ts"
import { CiderPlaybackSocket, placeVoiceLine, TerminalUI, terminalWidth } from "./terminal.ts"

const UI_TICK_MS = 10
const PLAYBACK_SYNC_MS = 100

export async function runPlayer(cider: Cider, baseUrl: string, lyricsOffset: number) {
	const ui = new TerminalUI()
	ui.start()
	const socket = new CiderPlaybackSocket(baseUrl)
	const io = (() => socket) as unknown as Parameters<typeof cider.events.connect>[0]
	cider.events.connect(io)
	let track: Awaited<ReturnType<typeof cider.playback.nowPlaying>>["data"] = null
	let lyrics: Lyrics | undefined
	let displayLines: TtmlLine[] = []
	let clockAnchor = 0
	let clockAnchorAt = Date.now()
	let clockRate = 1
	let clockNeedsSync = true
	let playing = false
	let trackGeneration = 0
	let timeFetchPending = false
	let stateFetchPending = false
	let lastTimeFetchAt = 0
	let lastStateFetchAt = 0
	let previous = ""
	let status = "Ctrl+C để thoát"
	let stopped = false
	let loadedTrackKey = ""
	let refreshRequested = false
	let refreshTask: Promise<void> | undefined
	let lyricsAbort: AbortController | undefined
	let refreshTimer: ReturnType<typeof setTimeout> | undefined
	const playbackPosition = (at = Date.now()) => clockAnchor + ((at - clockAnchorAt) / 1000) * clockRate

	const render = () => {
		const position = playbackPosition() + lyricsOffset
		const title = track ? `\x1b[1m${track.name}\x1b[0m — ${track.artistName}` : "Đang chờ bài hát trên Cider…"
		const syncLabel = lyrics ? `${lyrics.source.provider} · ${lyrics.source.timingType} timing` : "Cider lyrics"
		const screen = [
			title,
			`\x1b[90m${syncLabel}\x1b[0m`,
			"─".repeat(Math.max(12, Math.min(48, (process.stdout.columns || 80) - 1))),
			"",
		]
		let waitingGap = false
		if (!track) screen.push("Đang chờ bài hát…")
		else if (!displayLines.length) screen.push(status === "Ctrl+C để thoát" ? "Đang tải lyrics…" : status)
		else {
			const isBackgroundActive = (line: TtmlLine) => {
				if (line.background) return position >= (line.visibleFrom ?? line.start) && position <= line.end
				const hasTimedSpans = line.segments.some(segment => segment.start !== line.start || segment.end !== line.end)
				return hasTimedSpans
					? line.segments.some(segment => segment.text.trim() && position >= segment.start && position <= segment.end)
					: position >= line.start && position <= line.end
			}
			const visibleLines = displayLines.filter(line => !line.background || isBackgroundActive(line))
			const foregroundLines = displayLines.filter(line => !line.background)
			const previousMain = foregroundLines.findLast(line => line.end <= position)
			const nextMain = foregroundLines.find(line => line.start > position)
			const lineIsActive = foregroundLines.some(line => position >= line.start && position <= line.end)
			const backgroundVocalActive = displayLines.some(
				line =>
					line.background &&
					line.segments.some(segment => segment.text.trim() && position >= segment.start && position <= segment.end),
			)
			waitingGap =
				!lineIsActive &&
				!backgroundVocalActive &&
				Boolean(previousMain && nextMain) &&
				nextMain!.start - previousMain!.end > 1 &&
				position >= previousMain!.end &&
				position < nextMain!.start
			const index = visibleLines.findIndex(line => position >= line.start && position <= line.end)
			const next = visibleLines.findIndex(line => line.start > position)
			const current = index < 0 ? (next < 0 ? visibleLines.length - 1 : next) : index
			const capacity = Math.max(1, (process.stdout.rows || 24) - 6)
			const lineCapacity = Math.max(1, capacity - (waitingGap ? 1 : 0))
			const start = Math.max(0, Math.min(visibleLines.length - lineCapacity, current - Math.floor(lineCapacity / 2)))
			const slice = visibleLines.slice(start, start + lineCapacity)
			const rows = slice.map(line => {
				const rendered = renderTtmlLine(line, position).replaceAll("\n", " ")
				return placeVoiceLine(line, rendered, Math.max(1, (process.stdout.columns || 80) - 1))
			})
			if (waitingGap) {
				const nextIndex = visibleLines.indexOf(nextMain!)
				const previousIndex = visibleLines.indexOf(previousMain!)
				let insertAt =
					nextIndex >= start && nextIndex < start + slice.length
						? nextIndex - start
						: previousIndex >= start && previousIndex < start + slice.length
							? previousIndex - start + 1
							: rows.length
				const pulse = Math.floor(Date.now() / 220) % 3
				const dots = [0, 1, 2].map(i => (i === pulse ? "\x1b[97;1m.\x1b[0m" : "\x1b[90m.\x1b[0m")).join(" ")
				const wait = dots
				const width = process.stdout.columns || 80
				const centered = `${" ".repeat(Math.max(0, Math.floor((width - terminalWidth(wait)) / 2)))}${wait}`
				rows.splice(insertAt, 0, centered)
			}
			screen.push(...rows)
		}
		screen.push("", `\x1b[90m${status}\x1b[0m`)
		return screen
	}
	const draw = () => {
		const output = render()
		if (output.join("\n") !== previous) {
			ui.render(output)
			previous = output.join("\n")
		}
	}
	const refreshOnce = async () => {
		const response = await cider.playback.nowPlaying()
		const nextTrack = response.data
		const key = nextTrack ? `${nextTrack.name}\0${nextTrack.artistName}\0${nextTrack.albumName}` : ""
		const changed = key !== loadedTrackKey
		track = nextTrack
		if (!nextTrack) {
			loadedTrackKey = ""
			trackGeneration++
			clockAnchor = 0
			clockAnchorAt = Date.now()
			clockRate = 1
			clockNeedsSync = true
			lyrics = undefined
			displayLines = []
			status = "Đang chờ bài hát…"
			draw()
			return
		}
		if (!changed && displayLines.length) {
			status = "Ctrl+C để thoát"
			draw()
			return
		}

		loadedTrackKey = key
		if (changed) {
			trackGeneration++
			clockAnchor = 0
			clockAnchorAt = Date.now()
			clockRate = 1
			clockNeedsSync = true
			lastTimeFetchAt = 0
		}
		lyrics = undefined
		displayLines = []
		status = "Đang tải lyrics…"
		draw()

		const controller = new AbortController()
		lyricsAbort = controller
		let lastError: unknown
		for (let attempt = 0; attempt < 5 && !controller.signal.aborted; attempt++) {
			try {
				const { data } = await cider.lyrics.current({ ttml: true }, controller.signal)
				if (controller.signal.aborted) return
				const trackId =
					(nextTrack as typeof nextTrack & { id?: string; songId?: string }).id ??
					(nextTrack as typeof nextTrack & { songId?: string }).songId
				if (trackId && data.id && trackId !== data.id) {
					lastError = new Error("Cider chưa cập nhật lyrics cho bài mới.")
					if (attempt < 4) {
						await Bun.sleep(350)
						continue
					}
					break
				}
				// A track-change event can arrive before the current-lyrics cache switches.
				const latest = (await cider.playback.nowPlaying()).data
				const latestKey = latest ? `${latest.name}\0${latest.artistName}\0${latest.albumName}` : ""
				if (latestKey !== key) {
					refreshRequested = true
					return
				}
				lyrics = data
				const parsedTtml = data.ttml ? parseTtml(data.ttml) : []
				const referenceLines = data.lines.filter(line => !line.empty && !line.isBackground)
				const backgroundReferences = data.lines.filter(line => !line.empty && line.isBackground)
				parsedTtml
					.filter(line => !line.background)
					.forEach((line, index) => {
						const reference = referenceLines[index]?.text
						if (reference) restoreSpacesFromReference(line, reference)
					})
				parsedTtml
					.filter(line => line.background)
					.forEach((line, index) => {
						const reference = backgroundReferences[index]?.text
						if (reference) restoreSpacesFromReference(line, stripBackgroundParens(reference))
					})
				displayLines = parsedTtml.length
					? parsedTtml
					: attachBackgroundLines(data.lines.map(({ start, end, text, isBackground }) => {
							const lineText = isBackground ? stripBackgroundParens(text) : text
							return {
								start,
								end,
								text: lineText,
								segments: [{ text: lineText, start, end, background: isBackground }],
								voice: 1,
								background: Boolean(isBackground),
							}
						}))
				if (!displayLines.length) throw new Error("Lyrics trống hoặc TTML không có thẻ <p>.")
				status = "Ctrl+C để thoát"
				return
			} catch (error) {
				if (controller.signal.aborted) return
				lastError = error
				const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""
				if (!["LYRICS_NOT_FOUND", "NO_CURRENT_TRACK", "LYRICS_TIMEOUT"].includes(code) || attempt === 4) break
				await Bun.sleep(350)
			}
		}
		if (!controller.signal.aborted)
			status = `Không lấy được lyrics: ${lastError instanceof Error ? lastError.message : String(lastError ?? "bài này không có lyrics")}`
	}
	const refreshTrack = () => {
		if (stopped) return Promise.resolve()
		refreshRequested = true
		lyricsAbort?.abort()
		if (refreshTask) return refreshTask
		refreshTask = (async () => {
			while (refreshRequested && !stopped) {
				refreshRequested = false
				try {
					await refreshOnce()
				} catch (error) {
					status = `Lỗi playback: ${error instanceof Error ? error.message : error}`
				}
				draw()
			}
		})().finally(() => {
			refreshTask = undefined
			if (refreshRequested && !stopped) void refreshTrack()
		})
		return refreshTask
	}
	const scheduleTrackRefresh = () => {
		if (refreshTimer) clearTimeout(refreshTimer)
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined
			void refreshTrack()
		}, 180)
	}
	// Keep track changes reliable even when a Cider build drops its Socket.IO event.
	const trackMonitor = setInterval(() => {
		if (stopped) return
		void cider.playback
			.nowPlaying()
			.then(({ data: current }) => {
				const key = current ? `${current.name}\0${current.artistName}\0${current.albumName}` : ""
				if (key !== loadedTrackKey) scheduleTrackRefresh()
			})
			.catch(() => {})
	}, 1000)
	const unsubscribe = cider.events.onPlayback(({ type }) => {
		if (!type) return
		if (/nowPlayingItemDidChange|trackDidChange|itemDidChange/i.test(type)) scheduleTrackRefresh()
		if (/playbackTimeDidChange|timeDidChange/i.test(type)) {
			draw()
		}
		if (/playbackStateDidChange|playPause/i.test(type)) {
			void refreshTrack()
		}
	})
	const clock = setInterval(() => {
		if (!stopped && !timeFetchPending && Date.now() - lastTimeFetchAt >= PLAYBACK_SYNC_MS) {
			timeFetchPending = true
			lastTimeFetchAt = Date.now()
			const generation = trackGeneration
			void cider.playback
				.time()
				.then(({ data: time }) => {
					if (generation !== trackGeneration || !Number.isFinite(time.currentTime)) return
					const now = Date.now()
					const sample = time.currentTime
					const predicted = playbackPosition(now)
					const error = sample - predicted
					if (!playing) {
						clockAnchor = sample
						clockRate = 0
					} else if (clockNeedsSync || Math.abs(error) > 0.9) {
						clockAnchor = sample
						clockRate = 1
					} else {
						clockAnchor = predicted
						clockRate = Math.max(0.9, Math.min(1.1, 1 + error * 0.3))
					}
					clockAnchorAt = now
					clockNeedsSync = false
				})
				.catch(() => {})
				.finally(() => {
					timeFetchPending = false
				})
		}
		if (!stopped && !stateFetchPending && Date.now() - lastStateFetchAt >= 500) {
			stateFetchPending = true
			lastStateFetchAt = Date.now()
			const generation = trackGeneration
			void cider.playback
				.state()
				.then(({ data }) => {
					if (generation !== trackGeneration) return
					const nextPlaying = data.state === "playing"
					if (nextPlaying !== playing) {
						const now = Date.now()
						clockAnchor = playbackPosition(now)
						clockAnchorAt = now
						clockRate = nextPlaying ? 1 : 0
						playing = nextPlaying
					}
				})
				.catch(() => {})
				.finally(() => {
					stateFetchPending = false
				})
		}
		// Draw from a monotonic local clock between slower REST synchronization samples.
		draw()
	}, UI_TICK_MS)
	const cleanup = () => {
		stopped = true
		if (refreshTimer) clearTimeout(refreshTimer)
		lyricsAbort?.abort()
		clearInterval(clock)
		clearInterval(trackMonitor)
		unsubscribe()
		cider.events.disconnect()
		ui.stop()
	}
	process.once("SIGINT", cleanup)
	process.once("SIGTERM", cleanup)
	await refreshTrack()
	draw()
	await new Promise<void>(resolve => {
		process.once("SIGINT", resolve)
		process.once("SIGTERM", resolve)
	})
	process.off("SIGINT", cleanup)
	process.off("SIGTERM", cleanup)
}

