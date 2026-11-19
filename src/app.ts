import { Cider, CiderScope, requestAuthToken } from "cider-sdk"
import { BASE_URL, loadToken, parseCommand, saveToken, TOKEN_PATH, USAGE, UsageError, type Command } from "./config.ts"
import { runPlayer } from "./player.ts"
import { toAppleTtml } from "./ttml/export.ts"
import { errorMessage } from "./util.ts"

/** Long enough for Cider's long-polling lyrics requests. */
const REQUEST_TIMEOUT_MS = 65_000

async function authorize() {
	try {
		const { token, scopes } = await requestAuthToken(
			{ app_name: "Cider Terminal Lyrics", scopes: [CiderScope.Lyrics, CiderScope.Playback] },
			{ baseUrl: BASE_URL },
		)
		await saveToken(token)
		console.log(`Token saved to ${TOKEN_PATH}. Granted scopes: ${scopes.join(", ") || "none"}`)
	} catch (error) {
		console.error(`Could not request a token: ${errorMessage(error)}`)
		process.exit(1)
	}
}

async function connect() {
	const token = await loadToken()
	if (!token) {
		console.error("No token found. Run `bun run start --auth` to request the Lyrics scope from Cider.")
		process.exit(1)
	}
	return new Cider({ token, baseUrl: BASE_URL, timeout: REQUEST_TIMEOUT_MS })
}

async function exportTtml(cider: Cider, target?: string) {
	const { data } = await cider.lyrics.current({ ttml: true })
	const document = data.ttml || toAppleTtml(data)
	if (!target) return void process.stdout.write(document)
	await Bun.write(target, document)
	console.log(`Apple TTML written to ${target}`)
}

async function run(command: Command) {
	if (command.kind === "help") return console.log(USAGE)
	if (command.kind === "auth") return authorize()
	try {
		const cider = await connect()
		if (command.kind === "ttml") await exportTtml(cider, command.target)
		else await runPlayer(cider, BASE_URL, command.offset)
	} catch (error) {
		console.error(`Error: ${errorMessage(error)}`)
		process.exit(1)
	}
}

let command: Command
try {
	command = parseCommand(process.argv.slice(2))
} catch (error) {
	if (!(error instanceof UsageError)) throw error
	console.error(error.message)
	process.exit(2)
}
await run(command)
