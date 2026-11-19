const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H"
const LEAVE_ALT_SCREEN = "\x1b[0m\x1b[?25h\x1b[?1049l"

/**
 * Full-screen renderer on the alternate screen that only rewrites rows that
 * changed. When stdout is not a TTY it prints each distinct frame instead.
 */
export class TerminalUI {
	private previous: string[] = []
	private active = false

	start() {
		if (!process.stdout.isTTY) return
		this.active = true
		process.stdout.write(ENTER_ALT_SCREEN)
	}

	render(lines: string[]) {
		if (!this.active) {
			const output = lines.join("\n")
			if (output !== this.previous.join("\n")) process.stdout.write(`${output}\n`)
			this.previous = lines
			return
		}
		const visible = lines.slice(0, process.stdout.rows || 24)
		let updates = ""
		for (let i = 0; i < Math.max(visible.length, this.previous.length); i++) {
			const line = visible[i] ?? ""
			if (line !== this.previous[i]) updates += `\x1b[${i + 1};1H\x1b[2K${line}`
		}
		if (updates) process.stdout.write(updates)
		this.previous = visible
	}

	stop() {
		if (!this.active) return
		process.stdout.write(LEAVE_ALT_SCREEN)
		this.active = false
	}
}
