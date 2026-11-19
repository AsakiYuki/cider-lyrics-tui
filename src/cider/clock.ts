/** Drift larger than this (seconds) snaps the clock instead of slewing it. */
const MAX_SLEW_ERROR = 0.9
const SLEW_GAIN = 0.3
const MIN_RATE = 0.9
const MAX_RATE = 1.1

/**
 * A local playback clock that extrapolates between sparse position samples
 * from Cider and gently adjusts its rate to absorb small drift, so lyrics
 * animate smoothly without polling on every frame.
 */
export class PlaybackClock {
	private anchor = 0
	private anchorAt = Date.now()
	private rate = 1
	private needsSync = true
	private playing = false
	/** Bumped on every reset so samples requested before it can be discarded. */
	epoch = 0

	position(at = Date.now()) {
		return this.anchor + ((at - this.anchorAt) / 1000) * this.rate
	}

	/** Restarts at zero for a new track; the next sample is applied directly. */
	reset() {
		this.epoch++
		this.anchor = 0
		this.anchorAt = Date.now()
		this.rate = 1
		this.needsSync = true
	}

	/** Applies a position sample (seconds) reported by Cider. */
	sync(sample: number, now = Date.now()) {
		const predicted = this.position(now)
		const error = sample - predicted
		if (!this.playing) {
			this.anchor = sample
			this.rate = 0
		} else if (this.needsSync || Math.abs(error) > MAX_SLEW_ERROR) {
			this.anchor = sample
			this.rate = 1
		} else {
			this.anchor = predicted
			this.rate = Math.max(MIN_RATE, Math.min(MAX_RATE, 1 + error * SLEW_GAIN))
		}
		this.anchorAt = now
		this.needsSync = false
	}

	setPlaying(playing: boolean, now = Date.now()) {
		if (playing === this.playing) return
		this.anchor = this.position(now)
		this.anchorAt = now
		this.rate = playing ? 1 : 0
		this.playing = playing
	}
}
