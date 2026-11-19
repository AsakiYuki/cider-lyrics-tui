export const ANSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]/g

export const RESET = "\x1b[0m"

export const stripAnsi = (value: string) => value.replace(ANSI_SEQUENCE, "")

export const bold = (text: string) => `\x1b[1m${text}${RESET}`

export const dim = (text: string) => `\x1b[90m${text}${RESET}`

export const brightWhite = (text: string) => `\x1b[97m${text}${RESET}`

/** Truecolor gray, `level` 0–255. */
export const gray = (level: number, text: string) => `\x1b[38;2;${level};${level};${level}m${text}${RESET}`
