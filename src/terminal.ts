import type { TtmlLine } from "./lyrics.ts"

export function terminalWidth(value: string) {
	const plain = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
	let width = 0
	for (const char of plain) {
		const code = char.codePointAt(0) ?? 0
		if (/\p{Mark}/u.test(char)) continue
		const isWide =
			code >= 0x1100 &&
			(code <= 0x115f || code === 0x2329 || code === 0x232a ||
				(code >= 0x2e80 && code <= 0xa4cf) ||
				(code >= 0xac00 && code <= 0xd7a3) ||
				(code >= 0xf900 && code <= 0xfaff) ||
				(code >= 0xfe10 && code <= 0xfe6f) ||
				(code >= 0xff00 && code <= 0xff60) ||
				(code >= 0x1f300 && code <= 0x1faff))
		width += isWide ? 2 : 1
	}
	return width
}

export function wrapTerminalText(value: string, maxWidth: number) {
	type Glyph = { text: string; width: number; whitespace: boolean }
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
	if (pendingAnsi && glyphs.length) glyphs[glyphs.length - 1]!.text += pendingAnsi

	const width = Math.max(1, maxWidth)
	const rows: string[] = []
	let row = ""
	let rowWidth = 0
	let index = 0
	while (index < glyphs.length) {
		const whitespace = glyphs[index]!.whitespace
		const group: Glyph[] = []
		while (index < glyphs.length && glyphs[index]!.whitespace === whitespace) group.push(glyphs[index++]!)
		const groupWidth = group.reduce((sum, glyph) => sum + glyph.width, 0)
		if (whitespace) {
			let nextWordWidth = 0
			for (let next = index; next < glyphs.length && !glyphs[next]!.whitespace; next++)
				nextWordWidth += glyphs[next]!.width
			if (rowWidth + groupWidth + nextWordWidth > width) continue
		}
		if (!whitespace && rowWidth > 0 && rowWidth + groupWidth > width) {
			rows.push(row)
			row = ""
			rowWidth = 0
		}
		for (const glyph of group) {
			if (rowWidth + glyph.width > width && rowWidth > 0) {
				rows.push(row)
				row = ""
				rowWidth = 0
			}
			row += glyph.text
			rowWidth += glyph.width
		}
	}
	if (row || rows.length === 0) rows.push(row)
	return rows
}

export function placeVoiceLine(line: TtmlLine, content: string, width: number) {
	if (line.voice % 2 !== 0) return content
	return `${" ".repeat(Math.max(0, width - terminalWidth(content)))}${content}`
}

export class TerminalUI {
	private previous: string[] = []
	private active = false

	start() {
		if (!process.stdout.isTTY) return
		this.active = true
		process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H")
	}

	render(lines: string[]) {
		if (!this.active) {
			const output = lines.join("\n")
			if (output !== this.previous.join("\n")) process.stdout.write(`${output}\n`)
			this.previous = lines
			return
		}
		const visible = lines.slice(0, process.stdout.rows || 24)
		const max = Math.max(visible.length, this.previous.length)
		let updates = ""
		for (let i = 0; i < max; i++) {
			const line = visible[i] ?? ""
			if (line !== this.previous[i]) updates += `\x1b[${i + 1};1H\x1b[2K${line}`
		}
		if (updates) process.stdout.write(updates)
		this.previous = visible
	}

	stop() {
		if (!this.active) return
		process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l")
		this.active = false
	}
}

type PlaybackEvent = { type?: string; data?: unknown }
type SocketListener = (event: PlaybackEvent) => void

// Minimal Socket.IO Engine.IO v4 WebSocket transport. Cider's event channel is
// unauthenticated; REST remains responsible for the initial playback snapshot.
export class CiderPlaybackSocket {
	private ws?: WebSocket
	private listeners = new Set<SocketListener>()
	private reconnectTimer?: ReturnType<typeof setTimeout>
	private pingTimer?: ReturnType<typeof setTimeout>
	private closed = false

	constructor(private readonly baseUrl: string) {
		this.connect()
	}

	private connect() {
		if (this.closed) return
		const base = new URL(this.baseUrl)
		base.protocol = base.protocol === "https:" ? "wss:" : "ws:"
		base.pathname = `${base.pathname.replace(/\/$/, "")}/socket.io/`
		base.search = "?EIO=4&transport=websocket"
		const ws = new WebSocket(base)
		this.ws = ws
		ws.onmessage = ({ data }) => {
			if (typeof data !== "string") return
			if (data.startsWith("0")) {
				try {
					const handshake = JSON.parse(data.slice(1)) as { pingInterval?: number }
					this.schedulePing(handshake.pingInterval ?? 25_000)
				} catch {
					/* ignore malformed handshake */
				}
				ws.send("40")
			} else if (data === "2") {
				ws.send("3")
			} else if (data.startsWith("42")) {
				try {
					const [name, payload] = JSON.parse(data.slice(2)) as [string, PlaybackEvent]
					if (name === "API:Playback") for (const listener of this.listeners) listener(payload)
				} catch {
					/* ignore malformed event */
				}
			}
		}
		ws.onclose = () => this.scheduleReconnect()
		ws.onerror = () => ws.close()
	}

	private schedulePing(interval: number) {
		if (this.pingTimer) clearTimeout(this.pingTimer)
		this.pingTimer = setTimeout(() => {
			if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("2")
			this.schedulePing(interval)
		}, interval)
	}

	private scheduleReconnect() {
		if (this.pingTimer) clearTimeout(this.pingTimer)
		if (!this.closed && !this.reconnectTimer) {
			this.reconnectTimer = setTimeout(() => {
				this.reconnectTimer = undefined
				this.connect()
			}, 1500)
		}
	}

	on(_name: "API:Playback", listener: SocketListener) {
		this.listeners.add(listener)
		return this
	}
	off(_name: "API:Playback", listener: SocketListener) {
		this.listeners.delete(listener)
		return this
	}
	disconnect() {
		this.closed = true
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		if (this.pingTimer) clearTimeout(this.pingTimer)
		this.ws?.close()
	}
}

