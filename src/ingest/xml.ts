/**
 * A small non-validating XML parser, just enough for OOXML parts.
 *
 * Why not regex: `w:tbl` nests inside `w:tc`, and a regex split cannot say which
 * `</w:tbl>` closes which `<w:tbl>`. Nested tables are real in 评分表/台账, so the
 * probe needs a tree.
 *
 * Namespace prefixes are stripped (`w:tbl` -> `tbl`) and kept on the side, because
 * every element this code cares about lives in the `w` namespace.
 */

export interface XmlElement {
  kind: 'element'
  name: string
  prefix: string
  attrs: Record<string, string>
  children: XmlNode[]
}

export interface XmlText {
  kind: 'text'
  text: string
}

export type XmlNode = XmlElement | XmlText

export class XmlError extends Error {}

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export function decodeEntities(text: string): string {
  if (text.indexOf('&') < 0) return text
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => safeCodePoint(Number.parseInt(h, 16), _m))
    .replace(/&#(\d+);/g, (_m, d: string) => safeCodePoint(Number.parseInt(d, 10), _m))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function safeCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback
  try {
    return String.fromCodePoint(code)
  } catch {
    return fallback
  }
}

function splitName(qualified: string): { prefix: string; name: string } {
  const colon = qualified.indexOf(':')
  return colon < 0
    ? { prefix: '', name: qualified }
    : { prefix: qualified.slice(0, colon), name: qualified.slice(colon + 1) }
}

/** Parse a whole XML document and return the root element. */
/**
 * The element currently receiving children.
 *
 * The stack is seeded with the synthetic root, so this never returns undefined
 * in practice; the accessor makes that invariant explicit instead of sprinkling
 * non-null assertions through the hot loop.
 *
 * @param stack - the open-element stack, never empty.
 * @returns the top element.
 */
function topOf(stack: XmlElement[]): XmlElement {
  const top = stack[stack.length - 1]
  if (top === undefined) throw new XmlError('内部错误：元素栈为空')
  return top
}

export function parseXml(xml: string): XmlElement {
  const text = stripNonElements(xml)
  const root: XmlElement = { kind: 'element', name: '#root', prefix: '', attrs: {}, children: [] }
  const stack: XmlElement[] = [root]
  let cursor = 0
  TAG.lastIndex = 0
  for (let match = TAG.exec(text); match !== null; match = TAG.exec(text)) {
    const [raw, closing, qualified = '', attrText = '', selfClosing] = match
    if (match.index > cursor) {
      const chunk = text.slice(cursor, match.index)
      if (chunk !== '') topOf(stack).children.push({ kind: 'text', text: decodeEntities(chunk) })
    }
    cursor = match.index + raw.length
    const { prefix, name } = splitName(qualified)
    if (closing === '/') {
      // Tolerate mismatched closes rather than aborting a whole document.
      const at = stack.map((node) => node.name).lastIndexOf(name)
      if (at > 0) stack.length = at
      continue
    }
    const attrs: Record<string, string> = {}
    ATTR.lastIndex = 0
    for (let a = ATTR.exec(attrText); a !== null; a = ATTR.exec(attrText)) {
      attrs[splitName(a[1] ?? '').name] = decodeEntities(a[2] ?? a[3] ?? '')
    }
    const element: XmlElement = { kind: 'element', name, prefix, attrs, children: [] }
    topOf(stack).children.push(element)
    if (selfClosing !== '/') stack.push(element)
  }
  const body = root.children.find((node): node is XmlElement => node.kind === 'element')
  if (body === undefined) throw new XmlError('XML 没有根元素')
  return body
}

/**
 * Remove comments, processing instructions, CDATA markers and the doctype, and
 * turn CDATA payloads into ordinary text.
 */
function stripNonElements(xml: string): string {
  return xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?])?\s*>/gi, '')
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, (_m, inner: string) =>
      inner.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    )
}

/** Direct element children with the given local name. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((node): node is XmlElement => node.kind === 'element' && node.name === name)
}

/** The first direct element child with the given local name. */
export function childNamed(element: XmlElement, name: string): XmlElement | undefined {
  return childrenNamed(element, name)[0]
}

/** Concatenated text of all descendant text nodes, in document order. */
export function textContent(element: XmlElement): string {
  let out = ''
  const walk = (node: XmlNode): void => {
    if (node.kind === 'text') out += node.text
    else for (const child of node.children) walk(child)
  }
  walk(element)
  return out
}

/** Depth-first search for elements with the given local name. */
export function findAll(element: XmlElement, name: string, into: XmlElement[] = []): XmlElement[] {
  for (const node of element.children) {
    if (node.kind !== 'element') continue
    if (node.name === name) into.push(node)
    findAll(node, name, into)
  }
  return into
}
