import type { Lyrics, LyricsLine } from "cider-sdk"
import { formatTimecode } from "./time.ts"
import { escapeXml } from "./xml.ts"

const timing = (start: number, end: number) => `begin="${formatTimecode(start)}" end="${formatTimecode(end)}"`

function paragraph(line: LyricsLine) {
	const content = line.words?.length
		? line.words.map(word => `<span ${timing(word.start, word.end)}>${escapeXml(word.text)}</span>`).join("")
		: escapeXml(line.text)
	const attrs = [
		timing(line.start, line.end),
		line.songPart && `itunes:songPart="${escapeXml(line.songPart)}"`,
		line.isDuet && 'itunes:performer="duet"',
		line.isBackground && 'itunes:role="x-bg"',
	]
		.filter(Boolean)
		.join(" ")
	return `      <p ${attrs}>${content}</p>`
}

/** Builds an Apple-style TTML document from Cider's structured lyrics. */
export function toAppleTtml(lyrics: Lyrics) {
	const language = escapeXml(lyrics.source.language || "und")
	const title = escapeXml(lyrics.id ?? "Lyrics")
	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="${language}">`,
		`  <head><metadata><ttm:title>${title}</ttm:title><ttm:agent type="person" xml:id="v1"/></metadata></head>`,
		`  <body><div>`,
		lyrics.lines.map(paragraph).join("\n"),
		`  </div></body>`,
		`</tt>`,
		``,
	].join("\n")
}
