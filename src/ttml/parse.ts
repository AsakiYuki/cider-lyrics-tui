import { attachBackgroundLines, stripBackgroundParens, type LyricLine, type LyricSegment } from "../lyrics/model.ts"
import { parseTtmlTime } from "./time.ts"
import { elementChildren, parseXml, textOf, type XmlNode } from "./xml.ts"

/** Minimum silence between two timed word spans before a space is inferred. */
const INFERRED_SPACE_GAP = 0.08

const BACKGROUND_ROLES = ["x-bg", "background", "bg"]

const isBackgroundRole = (node: XmlNode) => BACKGROUND_ROLES.includes((node.attrs.role ?? "").toLowerCase())

const isTimedSpan = (node: XmlNode) => node.name === "span" && Boolean(node.attrs.begin || node.attrs.end || node.attrs.dur)

const hasTimedDescendant = (node: XmlNode): boolean =>
	elementChildren(node).some(child => isTimedSpan(child) || hasTimedDescendant(child))

/** Resolves an element's end from `end`, else `start + dur`, else the fallback. */
function resolveEnd(node: XmlNode, start: number | undefined, fallback?: number) {
	const end = parseTtmlTime(node.attrs.end)
	if (end !== undefined) return end
	if (start !== undefined && node.attrs.dur) return start + (parseTtmlTime(node.attrs.dur) ?? 0)
	return fallback
}

/** The earliest start and latest end across every timed span inside the node. */
function timedSpanBounds(node: XmlNode) {
	let start: number | undefined
	let end: number | undefined
	const visit = (current: XmlNode) => {
		if (current.name === "span") {
			const spanStart = parseTtmlTime(current.attrs.begin)
			const spanEnd = resolveEnd(current, spanStart)
			if (spanStart !== undefined || spanEnd !== undefined) {
				start = Math.min(start ?? Infinity, spanStart ?? spanEnd!)
				end = Math.max(end ?? -Infinity, spanEnd ?? spanStart!)
			}
		}
		elementChildren(current).forEach(visit)
	}
	visit(node)
	return { start, end }
}

function* paragraphs(node: XmlNode): Generator<XmlNode> {
	if (node.name === "p") yield node
	else for (const child of elementChildren(node)) yield* paragraphs(child)
}

/** Parses TTML into display lines, splitting background vocals into their own lines. */
export function parseTtml(ttml: string): LyricLine[] {
	const lines: LyricLine[] = []
	let paragraphId = 0
	for (const paragraph of paragraphs(parseXml(ttml))) lines.push(...parseParagraph(paragraph, paragraphId++))
	return attachBackgroundLines(lines)
}

function parseParagraph(node: XmlNode, paragraphId: number): LyricLine[] {
	const text = textOf(node).trim()
	if (!text) return []

	const spans = timedSpanBounds(node)
	const start = parseTtmlTime(node.attrs.begin) ?? spans.start ?? 0
	const end = resolveEnd(node, start, spans.end ?? start)!
	const voice = Number(node.attrs.agent?.match(/(\d+)$/)?.[1] ?? 1)
	const background = isBackgroundRole(node)
	const segments = inferWordSpaces(trimBlankSegments(collectSegments(node, start, end, background)))
	const line = { start, end, voice, paragraphId }

	if (background || !segments.some(segment => segment.background)) {
		return [
			{
				...line,
				text: background ? stripBackgroundParens(text) : text,
				segments: background ? stripSegmentParens(segments) : segments,
				background,
			},
		]
	}

	// A lead paragraph with nested background spans becomes a lead line plus a background line.
	const leadSegments = segments.filter(segment => !segment.background)
	const backgroundSegments = stripSegmentParens(segments.filter(segment => segment.background && segment.text.trim()))
	const leadText = joinText(leadSegments)
	const backgroundText = joinText(backgroundSegments)
	const result: LyricLine[] = []
	if (leadText) result.push({ ...line, text: leadText, segments: leadSegments, background: false })
	if (backgroundText)
		result.push({
			...line,
			start: Math.min(...backgroundSegments.map(segment => segment.start)),
			end: Math.max(...backgroundSegments.map(segment => segment.end)),
			text: backgroundText,
			segments: backgroundSegments,
			background: true,
		})
	return result
}

const joinText = (segments: LyricSegment[]) =>
	segments
		.map(segment => segment.text)
		.join("")
		.trim()

const stripSegmentParens = (segments: LyricSegment[]) =>
	segments
		.map(segment => ({ ...segment, text: stripBackgroundParens(segment.text) }))
		.filter(segment => segment.text)

/** Flattens a paragraph into segments; innermost untimed-descendant spans become timed segments. */
function collectSegments(paragraph: XmlNode, lineStart: number, lineEnd: number, paragraphBackground: boolean) {
	const segments: LyricSegment[] = []
	const lineSegment = (text: string, background: boolean) => ({ text, start: lineStart, end: lineEnd, background })

	const collect = (child: XmlNode | string, inBackground: boolean) => {
		if (typeof child === "string") {
			// Indentation/newlines between spans collapse to a single space.
			if (!child.trim() && child.includes("\n")) segments.push(lineSegment(" ", inBackground))
			else if (child) segments.push(lineSegment(child, inBackground))
			return
		}
		const background = inBackground || isBackgroundRole(child)
		if (child.name === "br") {
			segments.push(lineSegment("\n", background))
		} else if (child.name === "span" && !hasTimedDescendant(child)) {
			const begin = parseTtmlTime(child.attrs.begin)
			const start = begin ?? lineStart
			const text = textOf(child)
			if (text)
				segments.push({
					text,
					start,
					end: resolveEnd(child, start, lineEnd)!,
					background,
					timedSpan: begin !== undefined || child.attrs.end !== undefined || child.attrs.dur !== undefined,
				})
		} else {
			for (const nested of child.children) collect(nested, background)
		}
	}

	for (const child of paragraph.children) collect(child, paragraphBackground)
	return segments
}

function trimBlankSegments(segments: LyricSegment[]) {
	let first = 0
	let last = segments.length
	while (first < last && segments[first]!.text.trim() === "") first++
	while (last > first && segments[last - 1]!.text.trim() === "") last--
	return segments.slice(first, last)
}

/** Inserts a space between two adjacent timed word spans separated by a pause. */
function inferWordSpaces(segments: LyricSegment[]) {
	const result: LyricSegment[] = []
	for (const segment of segments) {
		const previous = result.at(-1)
		if (
			previous?.timedSpan &&
			segment.timedSpan &&
			!/\s$/.test(previous.text) &&
			!/^\s/.test(segment.text) &&
			/[\p{L}\p{N}]$/u.test(previous.text) &&
			/^[\p{L}\p{N}]/u.test(segment.text) &&
			segment.start - previous.end >= INFERRED_SPACE_GAP
		)
			result.push({ text: " ", start: previous.end, end: segment.start, background: segment.background })
		result.push(segment)
	}
	return result
}
