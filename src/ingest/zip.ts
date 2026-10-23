/**
 * Minimal ZIP reader for docx/xlsx packages.
 *
 * Copied in spirit from dsh-nsfc-form-check/src/parse.ts (`readZipEntries`), kept
 * zero-dependency: stored + deflate only, via node:zlib. A document is not an
 * archive, so anything else fails loudly instead of yielding half a document.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

export class ZipError extends Error {}

export interface ZipEntry {
  name: string
  bytes: Buffer
  /** True when the entry name ends with '/'. */
  directory: boolean
}

function findEocd(buf: Buffer): number {
  const earliest = Math.max(0, buf.length - 66_000)
  for (let off = buf.length - 22; off >= earliest; off--) {
    if (buf.readUInt32LE(off) === EOCD) return off
  }
  return -1
}

export function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new ZipError('不是有效的 ZIP 包（未找到中央目录）')
  const total = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  if (off === 0xffffffff || total === 0xffff) throw new ZipError('ZIP64 不受支持')
  const out: ZipEntry[] = []
  for (let i = 0; i < total; i++) {
    if (off + 46 > buf.length) throw new ZipError('ZIP 中央目录被截断')
    if (buf.readUInt32LE(off) !== CENTRAL) throw new ZipError('ZIP 中央目录项签名不符')
    const flags = buf.readUInt16LE(off + 8)
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    off += 46 + nameLen + extraLen + commentLen
    if (flags & 0x1) throw new ZipError(`ZIP 条目已加密：${name}`)
    if (name.endsWith('/')) {
      out.push({ name, bytes: Buffer.alloc(0), directory: true })
      continue
    }
    if (buf.readUInt32LE(localOff) !== LOCAL) throw new ZipError(`ZIP 本地头签名不符：${name}`)
    const lName = buf.readUInt16LE(localOff + 26)
    const lExtra = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lName + lExtra
    const raw = buf.subarray(start, start + compSize)
    if (method === 0) out.push({ name, bytes: Buffer.from(raw), directory: false })
    else if (method === 8) out.push({ name, bytes: inflateRawSync(raw), directory: false })
    else throw new ZipError(`ZIP 压缩方法 ${method} 不受支持：${name}`)
  }
  return out
}

export function zipMap(buf: Buffer): Map<string, Buffer> {
  const map = new Map<string, Buffer>()
  for (const entry of readZipEntries(buf)) if (!entry.directory) map.set(entry.name, entry.bytes)
  return map
}
