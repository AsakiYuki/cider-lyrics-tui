import { Cider, CiderScope, requestAuthToken } from "cider-sdk"
import { homedir } from "node:os"
import { join } from "node:path"
import { chmod, mkdir } from "node:fs/promises"
import { toAppleTtml } from "./lyrics.ts"
import { runPlayer } from "./player.ts"

const BASE_URL = process.env.CIDER_URL ?? "http://127.0.0.1:10767"
const TOKEN_PATH = join(homedir(), ".config", "cider-lyrics", "token")
const args = process.argv.slice(2)
const offsetArg =
	args.find(arg => arg.startsWith("--offset="))?.slice("--offset=".length) ??
	(args.includes("--offset") ? args[args.indexOf("--offset") + 1] : undefined)
const LYRICS_OFFSET = Number(offsetArg ?? process.env.CIDER_LYRICS_OFFSET ?? 0)
if (!Number.isFinite(LYRICS_OFFSET)) {
	console.error("Offset phải là số giây, ví dụ: --offset 0.25 hoặc --offset=-0.15")
	process.exit(2)
}

function usage() {
	console.log(`cider-lyrics — synchronized Cider lyrics in your terminal

Usage:
  bun run start                 Show lyrics for the currently playing track
  bun run start --auth          Request a lyrics token from Cider
  bun run start --ttml [file]   Export current lyrics as Apple TTML
  bun run start --offset 0.25   Add a display sync offset in seconds
  bun run start --help

Environment:
  CIDER_API_TOKEN   Use an existing Cider API token
  CIDER_URL         Cider API base URL (default http://127.0.0.1:10767)
  CIDER_LYRICS_OFFSET  Display sync offset in seconds (default 0)

Without CIDER_API_TOKEN, the app reads the token saved by --auth.`)
}

async function saveToken(token: string) {
	const dir = join(homedir(), ".config", "cider-lyrics")
	await mkdir(dir, { recursive: true, mode: 0o700 })
	await Bun.write(join(dir, "token"), token)
	await chmod(join(dir, "token"), 0o600)
}

async function getToken(): Promise<string> {
	if (process.env.CIDER_API_TOKEN) return process.env.CIDER_API_TOKEN
	const file = Bun.file(TOKEN_PATH)
	if (await file.exists()) return (await file.text()).trim()
	console.error("Chưa có token. Chạy `bun run start --auth` để xin quyền Lyrics từ Cider.")
	process.exit(1)
}

if (args.includes("--help") || args.includes("-h")) usage()
else if (args.includes("--auth")) {
	try {
		const { token, scopes } = await requestAuthToken(
			{ app_name: "Cider Terminal Lyrics", scopes: [CiderScope.Lyrics, CiderScope.Playback] },
			{ baseUrl: BASE_URL },
		)
		await saveToken(token)
		console.log(`Đã lưu token vào ${TOKEN_PATH}. Quyền được cấp: ${scopes.join(", ") || "không có"}`)
	} catch (error) {
		console.error(`Không xin được token: ${error instanceof Error ? error.message : error}`)
		process.exit(1)
	}
} else {
	try {
		const token = await getToken()
		const cider = new Cider({ token, baseUrl: BASE_URL, timeout: 65_000 })
		if (args.includes("--ttml")) {
			const { data } = await cider.lyrics.current({ ttml: true })
			const target = args[args.indexOf("--ttml") + 1]
			const document = data.ttml || toAppleTtml(data)
			if (target && !target.startsWith("--")) {
				await Bun.write(target, document)
				console.log(`Đã ghi Apple TTML vào ${target}`)
			} else process.stdout.write(document)
		} else await runPlayer(cider, BASE_URL, LYRICS_OFFSET)
	} catch (error) {
		console.error(`Lỗi: ${error instanceof Error ? error.message : error}`)
		process.exit(1)
	}
}
