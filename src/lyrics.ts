import type { Lyrics } from "cider-sdk"

export function xmlEscape(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;")
}

export function timecode(seconds: number) {
	const ms = Math.max(0, Math.round(seconds * 1000))
	const h = Math.floor(ms / 3_600_000)
	const m = Math.floor((ms % 3_600_000) / 60_000)
	const s = Math.floor((ms % 60_000) / 1000)
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`
}

export function toAppleTtml(lyrics: Lyrics) {
	const body = lyrics.lines
		.map(line => {
			const content = line.words?.length
				? line.words
						.map(
							word =>
								`<span begin="${timecode(word.start)}" end="${timecode(word.end)}">${xmlEscape(word.text)}</span>`,
						)
						.join("")
				: xmlEscape(line.text)
			const attrs = [
				`begin="${timecode(line.start)}"`,
				`end="${timecode(line.end)}"`,
				line.songPart ? `itunes:songPart="${xmlEscape(line.songPart)}"` : "",
				line.isDuet ? 'itunes:performer="duet"' : "",
				line.isBackground ? 'itunes:role="x-bg"' : "",
			]
				.filter(Boolean)
				.join(" ")
			return `      <p ${attrs}>${content}</p>`
		})
		.join("\n")
	return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="${xmlEscape(lyrics.source.language || "und")}">\n  <head><metadata><ttm:title>${xmlEscape(lyrics.id ?? "Lyrics")}</ttm:title><ttm:agent type="person" xml:id="v1"/></metadata></head>\n  <body><div>\n${body}\n  </div></body>\n</tt>\n`
}

export interface TtmlSegment {
	text: string
	start: number
	end: number
	background?: boolean
	timedSpan?: boolean
}
export interface TtmlLine {
	start: number
	end: number
	visibleFrom?: number
	text: string
	segments: TtmlSegment[]
	voice: number
	background: boolean
}
interface XmlNode {
	name: string
	attrs: Record<string, string>
	children: Array<XmlNode | string>
}

function decodeXml(value: string) {
	return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_all, entity: string) => {
		if (entity[0] === "#") {
			const code =
				entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
			return Number.isFinite(code) ? String.fromCodePoint(code) : _all
		}
		return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity.toLowerCase()] ?? _all
	})
}

export function stripBackgroundParens(value: string) {
	return value.replace(/^\s*\(/, "").replace(/\)\s*$/, "")
}

export function parseTtmlTime(value?: string): number | undefined {
	if (!value) return undefined
	const text = value.trim()
	if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text)
	if (/^-?(?:\d+\.?\d*|\.\d+)(?:ms|s|m|h)$/.test(text)) {
		const n = Number.parseFloat(text)
		if (text.endsWith("ms")) return n / 1000
		if (text.endsWith("m")) return n * 60
		if (text.endsWith("h")) return n * 3600
		return n
	}
	// Apple TTML commonly uses MM:SS.mmm, and long tracks may use HH:MM:SS.mmm.
	const parts = text.split(":")
	if (parts.length !== 2 && parts.length !== 3) return undefined
	const last = parts.at(-1)!.match(/^(\d{1,2})(?:[.,](\d+))?$/)
	if (!last) return undefined
	const seconds = Number(last[1])
	const fraction = last[2] ? Number(`0.${last[2]}`) : 0
	if (parts.length === 2) {
		const minutes = Number(parts[0])
		return Number.isFinite(minutes) ? minutes * 60 + seconds + fraction : undefined
	}
	const [hoursText, minutesText] = parts
	if (!/^\d+$/.test(hoursText!) || !/^\d{1,2}$/.test(minutesText!)) return undefined
	return Number(hoursText) * 3600 + Number(minutesText) * 60 + seconds + fraction
}

export function parseTtml(ttml: string): TtmlLine[] {
	const root: XmlNode = { name: "root", attrs: {}, children: [] }
	const stack = [root]
	for (const token of ttml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<[^>]+>|[^<]+/g) ?? []) {
		if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!")) continue
		if (token.startsWith("</")) {
			const name = token
				.slice(2)
				.match(/^([\w:.-]+)/)?.[1]
				?.split(":")
				.pop()
			if (name) {
				for (let i = stack.length - 1; i > 0; i--) {
					if (stack[i]!.name === name) {
						stack.length = i
						break
					}
				}
			}
			continue
		}
		if (token.startsWith("<")) {
			const name = token
				.slice(1)
				.match(/^([\w:.-]+)/)?.[1]
				?.split(":")
				.pop()
			if (!name) continue
			const inside = token.slice(1 + token.indexOf(name) + name.length).replace(/\/?\s*>$/, "")
			const attrs: Record<string, string> = {}
			for (const match of inside.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g))
				attrs[match[1]!.split(":").pop()!] = decodeXml(match[3]!)
			const node: XmlNode = { name, attrs, children: [] }
			stack.at(-1)!.children.push(node)
			if (!/\/\s*>$/.test(token)) stack.push(node)
		} else if (token) stack.at(-1)!.children.push(decodeXml(token))
	}
	const textOf = (node: XmlNode): string =>
		node.children
			.map(child => (typeof child === "string" ? child : child.name === "br" ? "\n" : textOf(child)))
			.join("")
	const hasTimedDescendant = (node: XmlNode): boolean =>
		node.children.some(
			child =>
				typeof child !== "string" &&
				((child.name === "span" && (child.attrs.begin || child.attrs.end || child.attrs.dur)) ||
					hasTimedDescendant(child)),
		)
	const getTimedBounds = (node: XmlNode, bounds: { start: number; end: number }[]) => {
		if (node.name === "span") {
			const start = parseTtmlTime(node.attrs.begin)
			const end =
				parseTtmlTime(node.attrs.end) ??
				(start !== undefined && node.attrs.dur ? start + (parseTtmlTime(node.attrs.dur) ?? 0) : undefined)
			if (start !== undefined || end !== undefined) bounds.push({ start: start ?? end!, end: end ?? start! })
		}
		for (const child of node.children) if (typeof child !== "string") getTimedBounds(child, bounds)
	}
	const result: TtmlLine[] = []
	const visit = (node: XmlNode) => {
		if (node.name === "p") {
			const bounds: Array<{ start: number; end: number }> = []
			getTimedBounds(node, bounds)
			const spanStart = bounds.length ? Math.min(...bounds.map(bound => bound.start)) : undefined
			const spanEnd = bounds.length ? Math.max(...bounds.map(bound => bound.end)) : undefined
			const lineStart = parseTtmlTime(node.attrs.begin) ?? spanStart ?? 0
			const lineEnd =
				parseTtmlTime(node.attrs.end) ??
				(node.attrs.dur ? lineStart + (parseTtmlTime(node.attrs.dur) ?? 0) : (spanEnd ?? lineStart))
			const voice = Number(node.attrs.agent?.match(/(\d+)$/)?.[1] ?? 1)
			const background = ["x-bg", "background", "bg"].includes((node.attrs.role ?? "").toLowerCase())
			const segments: TtmlSegment[] = []
			const collect = (child: XmlNode | string, inBackground = background) => {
				if (typeof child === "string") {
					if (!child.trim() && child.includes("\n")) {
						segments.push({ text: " ", start: lineStart, end: lineEnd, background: inBackground })
						return
					}
					if (child.length) segments.push({ text: child, start: lineStart, end: lineEnd, background: inBackground })
					return
				}
				const childBackground =
					inBackground || ["x-bg", "background", "bg"].includes((child.attrs.role ?? "").toLowerCase())
				if (child.name === "br") {
					segments.push({ text: "\n", start: lineStart, end: lineEnd, background: childBackground })
					return
				}
				if (child.name === "span" && !hasTimedDescendant(child)) {
					const begin = parseTtmlTime(child.attrs.begin)
					const start = begin ?? lineStart
					const end =
						parseTtmlTime(child.attrs.end) ??
						(child.attrs.dur ? start + (parseTtmlTime(child.attrs.dur) ?? 0) : lineEnd)
					const text = textOf(child)
					if (text)
						segments.push({
							text,
						start,
						end,
						background: childBackground,
						timedSpan: begin !== undefined || child.attrs.end !== undefined || child.attrs.dur !== undefined,
						})
					return
				}
				for (const nested of child.children) collect(nested, childBackground)
			}
			for (const child of node.children) collect(child)
			while (segments[0]?.text.trim() === "") segments.shift()
			while (segments.at(-1)?.text.trim() === "") segments.pop()
			const spacedSegments: TtmlSegment[] = []
			for (const segment of segments) {
				const previous = spacedSegments.at(-1)
				const hasNoBoundarySpace = previous && !/\s$/.test(previous.text) && !/^\s/.test(segment.text)
				const lexicalBoundary = previous && /[\p{L}\p{N}]$/u.test(previous.text) && /^[\p{L}\p{N}]/u.test(segment.text)
				if (
					previous?.timedSpan &&
					segment.timedSpan &&
					hasNoBoundarySpace &&
					lexicalBoundary &&
					segment.start - previous.end >= 0.08
				) {
					spacedSegments.push({ text: " ", start: previous.end, end: segment.start, background: segment.background })
				}
				spacedSegments.push(segment)
			}
			segments.splice(0, segments.length, ...spacedSegments)
			const lineText = textOf(node).replace(/^\s+|\s+$/g, "")
			if (lineText.trim()) {
				if (!background && segments.some(segment => segment.background)) {
					const foregroundSegments = segments.filter(segment => !segment.background)
					const backgroundSegments = segments
						.filter(segment => segment.background && segment.text.trim())
						.map(segment => ({
							...segment,
							text: stripBackgroundParens(segment.text),
						}))
						.filter(segment => segment.text)
					const foregroundText = foregroundSegments
						.map(segment => segment.text)
						.join("")
						.trim()
					const backgroundText = backgroundSegments
						.map(segment => segment.text)
						.join("")
						.trim()
					if (foregroundText)
						result.push({
							start: lineStart,
							end: lineEnd,
							text: foregroundText,
							segments: foregroundSegments,
							voice,
							background: false,
						})
					if (backgroundText)
						result.push({
							start: Math.min(...backgroundSegments.map(segment => segment.start)),
							end: Math.max(...backgroundSegments.map(segment => segment.end)),
							text: backgroundText,
							segments: backgroundSegments,
							voice,
							background: true,
						})
				} else {
					const cleanedSegments = background
						? segments
								.map(segment => ({ ...segment, text: stripBackgroundParens(segment.text) }))
								.filter(segment => segment.text)
						: segments
					result.push({
						start: lineStart,
						end: lineEnd,
						text: background ? stripBackgroundParens(lineText) : lineText,
						segments: cleanedSegments,
						voice,
						background,
					})
				}
			}
			return
		}
		for (const child of node.children) if (typeof child !== "string") visit(child)
	}
	visit(root)
	return attachBackgroundLines(result)
}

export function attachBackgroundLines(result: TtmlLine[]) {
	const foreground = result.filter(line => !line.background).sort((a, b) => a.start - b.start)
	const backing = result.filter(line => line.background).sort((a, b) => a.start - b.start)
	const attached = new Map<TtmlLine, TtmlLine[]>()
	const unattached: TtmlLine[] = []
	for (const backgroundLine of backing) {
		let closest: TtmlLine | undefined
		let bestOverlap = -1
		let bestDistance = Number.POSITIVE_INFINITY
		for (const line of foreground) {
			const overlap = Math.max(0, Math.min(line.end, backgroundLine.end) - Math.max(line.start, backgroundLine.start))
			const distance = Math.abs(line.start - backgroundLine.start)
			if (overlap > bestOverlap || (overlap === bestOverlap && distance < bestDistance)) {
				closest = line
				bestOverlap = overlap
				bestDistance = distance
			}
		}
		if (!closest) unattached.push(backgroundLine)
		else {
			backgroundLine.visibleFrom = closest.start
			attached.set(closest, [...(attached.get(closest) ?? []), backgroundLine])
		}
	}
	return [...foreground.flatMap(line => [line, ...(attached.get(line) ?? [])]), ...unattached]
}

export function renderTtmlLine(line: TtmlLine, position: number) {
	const fade = (text: string, progress: number) => {
		const level = Math.round(78 + 177 * Math.max(0, Math.min(1, progress)))
		return `\x1b[38;2;${level};${level};${level}m${text}\x1b[0m`
	}
	if (!line.segments.some(segment => segment.start !== line.start || segment.end !== line.end)) {
		const prefix = line.background ? "  " : ""
		if (line.end <= line.start) return `${prefix}\x1b[97m${line.text}\x1b[0m`
		const chars = Array.from(line.text)
		const lineProgress = ((position - line.start) / Math.max(0.01, line.end - line.start)) * chars.length
		return prefix + chars.map((char, index) => fade(char, lineProgress - index)).join("")
	}
	const prefix = line.background ? "  " : ""
	return (
		prefix +
		line.segments
			.map(({ text, start, end }) => {
				const progress = end > start ? (position - start) / (end - start) : Number(position >= end)
				const chars = Array.from(text)
				const characterProgress = progress * chars.length
				return chars.map((char, index) => fade(char, characterProgress - index)).join("")
			})
			.join("")
	)
}

export function restoreSpacesFromReference(line: TtmlLine, reference: string) {
	const referenceChars = Array.from(reference)
	const letterPositions = referenceChars
		.map((char, index) => ({ char, index }))
		.filter(({ char }) => /[\p{L}\p{N}]/u.test(char))
	let cursor = 0
	let previousTextEnd: number | undefined
	const output: TtmlSegment[] = []
	for (const segment of line.segments) {
		if (!segment.timedSpan) {
			output.push(segment)
			continue
		}
		const wanted = Array.from(segment.text).filter(char => /[\p{L}\p{N}]/u.test(char)).map(char => char.toLocaleLowerCase())
		let found = -1
		for (let start = cursor; start + wanted.length <= letterPositions.length; start++) {
			if (wanted.every((char, index) => letterPositions[start + index]!.char.toLocaleLowerCase() === char)) {
				found = start
				break
			}
		}
		if (found < 0 || wanted.length === 0) {
			output.push(segment)
			continue
		}
		const referenceStart = letterPositions[found]!.index
		const priorText = output.at(-1)?.text ?? ""
		const referenceGap = previousTextEnd === undefined ? "" : reference.slice(previousTextEnd, referenceStart)
		if (previousTextEnd !== undefined && /\s/.test(referenceGap) && !/\s$/.test(priorText)) {
			const prior = output.at(-1)
			output.push({ text: " ", start: prior?.end ?? segment.start, end: segment.start, background: segment.background })
		}
		const referenceEnd = letterPositions[found + wanted.length - 1]!.index + 1
		previousTextEnd = referenceEnd
		cursor = found + wanted.length
		output.push(segment)
	}
	line.segments = output
}


