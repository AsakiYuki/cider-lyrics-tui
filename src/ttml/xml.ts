/**
 * A deliberately small, forgiving XML reader for TTML lyrics. Element and
 * attribute names are reduced to their local name (namespace prefixes dropped).
 */
export interface XmlNode {
	name: string
	attrs: Record<string, string>
	children: Array<XmlNode | string>
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

export function escapeXml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;")
}

export function decodeXml(value: string) {
	return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
		if (entity[0] !== "#") return NAMED_ENTITIES[entity.toLowerCase()] ?? match
		const hex = entity[1]?.toLowerCase() === "x"
		const code = hex ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
		return Number.isFinite(code) ? String.fromCodePoint(code) : match
	})
}

const localName = (qualified: string) => qualified.split(":").pop()!

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<[^>]+>|[^<]+/g

export function parseXml(source: string): XmlNode {
	const root: XmlNode = { name: "root", attrs: {}, children: [] }
	const stack = [root]

	for (const token of source.match(TOKEN) ?? []) {
		// Comments, processing instructions and doctypes.
		if (token.startsWith("<!") || token.startsWith("<?")) continue

		if (token.startsWith("</")) {
			const qualified = token.slice(2).match(/^[\w:.-]+/)?.[0]
			if (!qualified) continue
			const name = localName(qualified)
			// Close the nearest matching element; tolerate unbalanced markup.
			for (let i = stack.length - 1; i > 0; i--) {
				if (stack[i]!.name === name) {
					stack.length = i
					break
				}
			}
			continue
		}

		if (token.startsWith("<")) {
			const qualified = token.slice(1).match(/^[\w:.-]+/)?.[0]
			if (!qualified) continue
			const node: XmlNode = {
				name: localName(qualified),
				attrs: parseAttributes(token.slice(1 + qualified.length)),
				children: [],
			}
			stack.at(-1)!.children.push(node)
			if (!/\/\s*>$/.test(token)) stack.push(node)
			continue
		}

		stack.at(-1)!.children.push(decodeXml(token))
	}
	return root
}

function parseAttributes(source: string) {
	const attrs: Record<string, string> = {}
	for (const [, name, , value] of source.replace(/\/?\s*>$/, "").matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g))
		attrs[localName(name!)] = decodeXml(value!)
	return attrs
}

/** Concatenated text content, with `<br>` rendered as a newline. */
export function textOf(node: XmlNode): string {
	return node.children
		.map(child => (typeof child === "string" ? child : child.name === "br" ? "\n" : textOf(child)))
		.join("")
}

export const elementChildren = (node: XmlNode) =>
	node.children.filter((child): child is XmlNode => typeof child !== "string")
