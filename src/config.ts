import { chmod, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const BASE_URL = process.env.CIDER_URL ?? "http://127.0.0.1:10767"
export const TOKEN_PATH = join(homedir(), ".config", "cider-lyrics", "token")

export const USAGE = `cider-lyrics — synchronized Cider lyrics in your terminal

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

Without CIDER_API_TOKEN, the app reads the token saved by --auth.`

export type Command =
	| { kind: "help" }
	| { kind: "auth" }
	| { kind: "ttml"; target?: string }
	| { kind: "play"; offset: number }

/** Value following `--name`, or given inline as `--name=value`. */
function optionValue(args: string[], name: string) {
	const inline = args.find(arg => arg.startsWith(`${name}=`))
	if (inline) return inline.slice(name.length + 1)
	const index = args.indexOf(name)
	return index >= 0 ? args[index + 1] : undefined
}

export function parseCommand(args: string[]): Command {
	const offset = Number(optionValue(args, "--offset") ?? process.env.CIDER_LYRICS_OFFSET ?? 0)
	if (!Number.isFinite(offset)) throw new UsageError("Offset must be a number of seconds, e.g. --offset 0.25 or --offset=-0.15")

	if (args.includes("--help") || args.includes("-h")) return { kind: "help" }
	if (args.includes("--auth")) return { kind: "auth" }
	if (args.includes("--ttml")) {
		const target = args[args.indexOf("--ttml") + 1]
		return { kind: "ttml", target: target && !target.startsWith("--") ? target : undefined }
	}
	return { kind: "play", offset }
}

export class UsageError extends Error {}

export async function saveToken(token: string) {
	await mkdir(dirname(TOKEN_PATH), { recursive: true, mode: 0o700 })
	await Bun.write(TOKEN_PATH, token)
	await chmod(TOKEN_PATH, 0o600)
}

/** The token from `CIDER_API_TOKEN`, else the one saved by `--auth`. */
export async function loadToken(): Promise<string | undefined> {
	if (process.env.CIDER_API_TOKEN) return process.env.CIDER_API_TOKEN
	const file = Bun.file(TOKEN_PATH)
	return (await file.exists()) ? (await file.text()).trim() : undefined
}
