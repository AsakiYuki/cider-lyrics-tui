type PlaybackEvent = { type?: string; data?: unknown }
type PlaybackListener = (event: PlaybackEvent) => void

const RECONNECT_DELAY_MS = 1500
const DEFAULT_PING_INTERVAL_MS = 25_000

// Engine.IO v4 packet types, and the Socket.IO packets layered on top.
const PACKET = { open: "0", ping: "2", pong: "3", connect: "40", event: "42" } as const

/**
 * Minimal Socket.IO (Engine.IO v4) WebSocket client for Cider's playback
 * events, compatible with what `cider.events.connect` expects from a socket.
 * The event channel is unauthenticated; REST still provides the snapshot.
 */
export class CiderPlaybackSocket {
	private ws?: WebSocket
	private listeners = new Set<PlaybackListener>()
	private reconnectTimer?: ReturnType<typeof setTimeout>
	private pingTimer?: ReturnType<typeof setTimeout>
	private closed = false

	constructor(private readonly baseUrl: string) {
		this.connect()
	}

	on(_name: "API:Playback", listener: PlaybackListener) {
		this.listeners.add(listener)
		return this
	}

	off(_name: "API:Playback", listener: PlaybackListener) {
		this.listeners.delete(listener)
		return this
	}

	disconnect() {
		this.closed = true
		this.clearTimers()
		this.ws?.close()
	}

	private socketUrl() {
		const url = new URL(this.baseUrl)
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
		url.pathname = `${url.pathname.replace(/\/$/, "")}/socket.io/`
		url.search = "?EIO=4&transport=websocket"
		return url
	}

	private connect() {
		if (this.closed) return
		const ws = new WebSocket(this.socketUrl())
		this.ws = ws
		ws.onmessage = ({ data }) => {
			if (typeof data === "string") this.handlePacket(ws, data)
		}
		ws.onclose = () => this.scheduleReconnect()
		ws.onerror = () => ws.close()
	}

	private handlePacket(ws: WebSocket, packet: string) {
		if (packet.startsWith(PACKET.open)) {
			const handshake = parseJson<{ pingInterval?: number }>(packet.slice(1))
			if (handshake) this.schedulePing(handshake.pingInterval ?? DEFAULT_PING_INTERVAL_MS)
			ws.send(PACKET.connect)
		} else if (packet === PACKET.ping) {
			ws.send(PACKET.pong)
		} else if (packet.startsWith(PACKET.event)) {
			const message = parseJson<[string, PlaybackEvent]>(packet.slice(2))
			if (!Array.isArray(message) || message[0] !== "API:Playback") return
			for (const listener of this.listeners) listener(message[1])
		}
	}

	private schedulePing(interval: number) {
		clearTimeout(this.pingTimer)
		this.pingTimer = setTimeout(() => {
			if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(PACKET.ping)
			this.schedulePing(interval)
		}, interval)
	}

	private scheduleReconnect() {
		clearTimeout(this.pingTimer)
		if (this.closed || this.reconnectTimer) return
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			this.connect()
		}, RECONNECT_DELAY_MS)
	}

	private clearTimers() {
		clearTimeout(this.reconnectTimer)
		clearTimeout(this.pingTimer)
	}
}

function parseJson<T>(text: string): T | undefined {
	try {
		return JSON.parse(text) as T
	} catch {
		return undefined
	}
}
