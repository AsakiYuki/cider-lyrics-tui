import type { Cider, Lyrics, NowPlayingTrack } from "cider-sdk"
import { PlaybackClock } from "./cider/clock.ts"
import { loadLyrics, trackKey } from "./cider/lyrics-loader.ts"
import { CiderPlaybackSocket } from "./cider/socket.ts"
import type { LyricLine } from "./lyrics/model.ts"
import { renderScreen, STATUS_LOADING, STATUS_READY, STATUS_WAITING } from "./ui/screen.ts"
import { TerminalUI } from "./ui/terminal.ts"
import { errorMessage } from "./util.ts"

const UI_TICK_MS = 10
const TIME_SYNC_MS = 100
const STATE_SYNC_MS = 500
const TRACK_POLL_MS = 1000
const TRACK_REFRESH_DEBOUNCE_MS = 180

const TRACK_CHANGE_EVENT = /nowPlayingItemDidChange|trackDidChange|itemDidChange/i
const TIME_CHANGE_EVENT = /playbackTimeDidChange|timeDidChange/i
const STATE_CHANGE_EVENT = /playbackStateDidChange|playPause/i

/** Runs `request` at most once per `intervalMs`, never overlapping. */
function throttledPoll(intervalMs: number, request: () => Promise<unknown>) {
	let pending = false
	let lastAt = 0
	return {
		tick() {
			if (pending || Date.now() - lastAt < intervalMs) return
			pending = true
			lastAt = Date.now()
			void request()
				.catch(() => {})
				.finally(() => {
					pending = false
				})
		},
		/** Makes the next tick fire immediately. */
		expedite() {
			lastAt = 0
		},
	}
}

class LyricsPlayer {
	private readonly ui = new TerminalUI()
	private readonly clock = new PlaybackClock()
	private track: NowPlayingTrack | null = null
	private lyrics?: Lyrics
	private lines: LyricLine[] = []
	private status = STATUS_READY
	private lastFrame = ""
	private loadedTrackKey = ""
	private stopped = false

	private refreshRequested = false
	private refreshTask?: Promise<void>
	private refreshTimer?: ReturnType<typeof setTimeout>
	private lyricsAbort?: AbortController
	private readonly timers: Array<ReturnType<typeof setInterval>> = []
	private unsubscribe?: () => void

	private readonly timePoll = throttledPoll(TIME_SYNC_MS, async () => {
		const epoch = this.clock.epoch
		const { data } = await this.cider.playback.time()
		if (epoch === this.clock.epoch && Number.isFinite(data.currentTime)) this.clock.sync(data.currentTime)
	})

	private readonly statePoll = throttledPoll(STATE_SYNC_MS, async () => {
		const epoch = this.clock.epoch
		const { data } = await this.cider.playback.state()
		if (epoch === this.clock.epoch) this.clock.setPlaying(data.state === "playing")
	})

	constructor(
		private readonly cider: Cider,
		private readonly baseUrl: string,
		private readonly lyricsOffset: number,
	) {}

	async start() {
		this.ui.start()
		this.connectEvents()
		// Polling backs up Socket.IO, which some Cider builds drop track-change events from.
		this.timers.push(
			setInterval(() => this.pollTrackChange(), TRACK_POLL_MS),
			setInterval(() => this.tick(), UI_TICK_MS),
		)
		await this.refreshTrack()
		this.draw()
	}

	stop() {
		this.stopped = true
		clearTimeout(this.refreshTimer)
		this.lyricsAbort?.abort()
		this.timers.forEach(clearInterval)
		this.unsubscribe?.()
		this.cider.events.disconnect()
		this.ui.stop()
	}

	private connectEvents() {
		const socket = new CiderPlaybackSocket(this.baseUrl)
		// The SDK takes a Socket.IO factory; hand it our lightweight socket instead.
		this.cider.events.connect((() => socket) as unknown as Parameters<Cider["events"]["connect"]>[0])
		this.unsubscribe = this.cider.events.onPlayback(({ type }) => {
			if (!type) return
			if (TRACK_CHANGE_EVENT.test(type)) this.scheduleTrackRefresh()
			if (TIME_CHANGE_EVENT.test(type)) this.draw()
			if (STATE_CHANGE_EVENT.test(type)) void this.refreshTrack()
		})
	}

	/** Advances the local clock's sync and redraws from it between REST samples. */
	private tick() {
		if (!this.stopped) {
			this.timePoll.tick()
			this.statePoll.tick()
		}
		this.draw()
	}

	private draw() {
		const frame = renderScreen(
			{ track: this.track, lyrics: this.lyrics, lines: this.lines, status: this.status },
			this.clock.position() + this.lyricsOffset,
			Math.max(1, (process.stdout.columns || 80) - 1),
			process.stdout.rows || 24,
		)
		const joined = frame.join("\n")
		if (joined === this.lastFrame) return
		this.ui.render(frame)
		this.lastFrame = joined
	}

	private pollTrackChange() {
		if (this.stopped) return
		void this.cider.playback
			.nowPlaying()
			.then(({ data }) => {
				if (trackKey(data) !== this.loadedTrackKey) this.scheduleTrackRefresh()
			})
			.catch(() => {})
	}

	private scheduleTrackRefresh() {
		clearTimeout(this.refreshTimer)
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined
			void this.refreshTrack()
		}, TRACK_REFRESH_DEBOUNCE_MS)
	}

	/** Coalesces refresh requests: aborts any in-flight lyrics load and reruns until none are pending. */
	private refreshTrack(): Promise<void> {
		if (this.stopped) return Promise.resolve()
		this.refreshRequested = true
		this.lyricsAbort?.abort()
		this.refreshTask ??= (async () => {
			while (this.refreshRequested && !this.stopped) {
				this.refreshRequested = false
				try {
					await this.refreshOnce()
				} catch (error) {
					this.status = `Playback error: ${errorMessage(error)}`
				}
				this.draw()
			}
		})().finally(() => {
			this.refreshTask = undefined
			if (this.refreshRequested && !this.stopped) void this.refreshTrack()
		})
		return this.refreshTask
	}

	private async refreshOnce() {
		const track = (await this.cider.playback.nowPlaying()).data
		const key = trackKey(track)
		const changed = key !== this.loadedTrackKey
		this.track = track

		if (!track) {
			this.loadedTrackKey = ""
			this.clock.reset()
			this.showLyrics(undefined, [], STATUS_WAITING)
			return
		}
		if (!changed && this.lines.length) {
			this.status = STATUS_READY
			this.draw()
			return
		}

		this.loadedTrackKey = key
		if (changed) {
			this.clock.reset()
			this.timePoll.expedite()
		}
		this.showLyrics(undefined, [], STATUS_LOADING)

		const controller = new AbortController()
		this.lyricsAbort = controller
		const result = await loadLyrics(this.cider, track, controller.signal)
		switch (result.kind) {
			case "loaded":
				this.lyrics = result.lyrics
				this.lines = result.lines
				this.status = STATUS_READY
				break
			case "empty":
				this.lyrics = result.lyrics
				this.status = `Could not load lyrics: ${result.error.message}`
				break
			case "failed":
				this.status = `Could not load lyrics: ${errorMessage(result.error ?? "no lyrics are available for this track")}`
				break
			case "stale":
				this.refreshRequested = true
				break
			case "aborted":
				break
		}
	}

	private showLyrics(lyrics: Lyrics | undefined, lines: LyricLine[], status: string) {
		this.lyrics = lyrics
		this.lines = lines
		this.status = status
		this.draw()
	}
}

/** Shows live lyrics for Cider's current track until SIGINT/SIGTERM. */
export async function runPlayer(cider: Cider, baseUrl: string, lyricsOffset: number) {
	const player = new LyricsPlayer(cider, baseUrl, lyricsOffset)
	const stopped = new Promise<void>(resolve => {
		const onSignal = () => {
			process.off("SIGINT", onSignal)
			process.off("SIGTERM", onSignal)
			player.stop()
			resolve()
		}
		process.on("SIGINT", onSignal)
		process.on("SIGTERM", onSignal)
	})
	await player.start()
	await stopped
}
