import type { Cider, Lyrics, NowPlayingTrack } from "cider-sdk"
import { buildDisplayLines } from "../lyrics/build.ts"
import type { LyricLine } from "../lyrics/model.ts"

const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 350
const RETRYABLE_CODES = ["LYRICS_NOT_FOUND", "NO_CURRENT_TRACK", "LYRICS_TIMEOUT"]

export type LyricsLoadResult =
	| { kind: "loaded"; lyrics: Lyrics; lines: LyricLine[] }
	/** Cider returned lyrics, but there is nothing to display. */
	| { kind: "empty"; lyrics: Lyrics; error: Error }
	/** The track changed while loading; the caller should refresh again. */
	| { kind: "stale" }
	| { kind: "aborted" }
	| { kind: "failed"; error: unknown }

/** Identifies a track across now-playing responses. */
export const trackKey = (track: NowPlayingTrack | null) =>
	track ? `${track.name}\0${track.artistName}\0${track.albumName}` : ""

const errorCode = (error: unknown) =>
	typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""

/**
 * Fetches lyrics for `track`, retrying while Cider is still catching up with
 * a track change (lyrics not ready yet, or still cached for the previous one).
 */
export async function loadLyrics(cider: Cider, track: NowPlayingTrack, signal: AbortSignal): Promise<LyricsLoadResult> {
	const key = trackKey(track)
	const { id, songId } = track as NowPlayingTrack & { id?: string; songId?: string }
	const trackId = id ?? songId
	let lastError: unknown

	for (let attempt = 1; attempt <= MAX_ATTEMPTS && !signal.aborted; attempt++) {
		const isLastAttempt = attempt === MAX_ATTEMPTS
		try {
			const { data } = await cider.lyrics.current({ ttml: true }, signal)
			if (signal.aborted) break
			if (trackId && data.id && trackId !== data.id) {
				lastError = new Error("Cider has not updated the lyrics for the new track yet.")
				if (isLastAttempt) break
				await Bun.sleep(RETRY_DELAY_MS)
				continue
			}
			// A track-change event can arrive before the current-lyrics cache switches.
			if (trackKey((await cider.playback.nowPlaying()).data) !== key) return { kind: "stale" }

			const lines = buildDisplayLines(data)
			if (!lines.length)
				return { kind: "empty", lyrics: data, error: new Error("Lyrics are empty or the TTML contains no <p> elements.") }
			return { kind: "loaded", lyrics: data, lines }
		} catch (error) {
			if (signal.aborted) break
			lastError = error
			if (!RETRYABLE_CODES.includes(errorCode(error)) || isLastAttempt) break
			await Bun.sleep(RETRY_DELAY_MS)
		}
	}
	return signal.aborted ? { kind: "aborted" } : { kind: "failed", error: lastError }
}
