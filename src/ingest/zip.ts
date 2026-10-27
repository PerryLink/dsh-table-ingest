/**
 * Minimal ZIP reader for docx/xlsx packages.
 *
 * Copied in spirit from dsh-nsfc-form-check/src/parse.ts (`readZipEntries`), kept
 * zero-dependency: stored + deflate only, via node:zlib. A document is not an
 * archive, so anything else fails loudly instead of yielding half a document.
 *
 * A package is untrusted input. Even a perfectly valid deflate stream can expand
 * to gigabytes, and a crafted central directory can point anywhere; every read is
 * therefore bounded by an entry-count, per-entry and cumulative output budget.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const MAX_NAME_BYTES = 4_096

export class ZipError extends Error {}

export interface ZipEntry {
  name: string
  bytes: Buffer
  /** True when the entry name ends with '/'. */
  directory: boolean
}

/** Optional lower budgets for tests or callers that know their document shape. */
export interface ZipLimits {
  maxEntries?: number
  maxEntryUncompressedBytes?: number
  maxTotalUncompressedBytes?: number
  maxCompressedEntryBytes?: number
}

interface ResolvedLimits {
  maxEntries: number
  maxEntryUncompressedBytes: number
  maxTotalUncompressedBytes: number
  maxCompressedEntryBytes: number
}

const DEFAULT_LIMITS: ResolvedLimits = {
  maxEntries: 256,
  maxEntryUncompressedBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 32 * 1024 * 1024,
  maxCompressedEntryBytes: 8 * 1024 * 1024,
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ZipError(`ZIP 预算 ${label} 必须为正整数`)
  }
  return value
}

function resolveLimits(limits: ZipLimits): ResolvedLimits {
  return {
    maxEntries: positiveLimit(limits.maxEntries, DEFAULT_LIMITS.maxEntries, 'maxEntries'),
    maxEntryUncompressedBytes: positiveLimit(
      limits.maxEntryUncompressedBytes,
      DEFAULT_LIMITS.maxEntryUncompressedBytes,
      'maxEntryUncompressedBytes',
    ),
    maxTotalUncompressedBytes: positiveLimit(
      limits.maxTotalUncompressedBytes,
      DEFAULT_LIMITS.maxTotalUncompressedBytes,
      'maxTotalUncompressedBytes',
    ),
    maxCompressedEntryBytes: positiveLimit(
      limits.maxCompressedEntryBytes,
      DEFAULT_LIMITS.maxCompressedEntryBytes,
      'maxCompressedEntryBytes',
    ),
  }
}

function findEocd(buf: Buffer): number {
  const earliest = Math.max(0, buf.length - 66_000)
  for (let off = buf.length - 22; off >= earliest; off--) {
    if (buf.readUInt32LE(off) === EOCD) return off
  }
  return -1
}

export function readZipEntries(buf: Buffer, limits: ZipLimits = {}): ZipEntry[] {
  const budget = resolveLimits(limits)
  const eocd = findEocd(buf)
  if (eocd < 0) throw new ZipError('不是有效的 ZIP 包（未找到中央目录）')
  const total = buf.readUInt16LE(eocd + 10)
  if (total > budget.maxEntries) {
    throw new ZipError(`ZIP 条目数 ${total} 超过上限 ${budget.maxEntries}`)
  }
  let off = buf.readUInt32LE(eocd + 16)
  if (off === 0xffffffff || total === 0xffff) throw new ZipError('ZIP64 不受支持')
  const out: ZipEntry[] = []
  let totalBytes = 0
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
    if (nameLen > MAX_NAME_BYTES) {
      throw new ZipError(`ZIP 条目名超过 ${MAX_NAME_BYTES} 字节：${nameLen}`)
    }
    if (off + 46 + nameLen + extraLen + commentLen > buf.length) {
      throw new ZipError('ZIP 中央目录项被截断')
    }
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    off += 46 + nameLen + extraLen + commentLen
    if (flags & 0x1) throw new ZipError(`ZIP 条目已加密：${name}`)
    if (name.endsWith('/')) {
      out.push({ name, bytes: Buffer.alloc(0), directory: true })
      continue
    }
    if (compSize > budget.maxCompressedEntryBytes) {
      throw new ZipError(`ZIP 条目压缩大小 ${compSize} 超过上限 ${budget.maxCompressedEntryBytes}：${name}`)
    }
    if (localOff + 30 > buf.length) throw new ZipError(`ZIP 本地头越界：${name}`)
    if (buf.readUInt32LE(localOff) !== LOCAL) throw new ZipError(`ZIP 本地头签名不符：${name}`)
    const lName = buf.readUInt16LE(localOff + 26)
    const lExtra = buf.readUInt16LE(localOff + 28)
    if (localOff + 30 + lName + lExtra + compSize > buf.length) {
      throw new ZipError(`ZIP 条目数据被截断：${name}`)
    }
    const start = localOff + 30 + lName + lExtra
    const raw = buf.subarray(start, start + compSize)
    let bytes: Buffer
    if (method === 0) {
      bytes = Buffer.from(raw)
    } else if (method === 8) {
      const remaining = budget.maxTotalUncompressedBytes - totalBytes
      if (remaining <= 0) {
        throw new ZipError(`ZIP 累计解压超过上限 ${budget.maxTotalUncompressedBytes} 字节：${name}`)
      }
      const maxOutput = Math.min(budget.maxEntryUncompressedBytes, remaining) + 1
      try {
        bytes = inflateRawSync(raw, { maxOutputLength: maxOutput })
      } catch {
        throw new ZipError(`ZIP 条目解压超过预算或数据损坏：${name}`)
      }
    } else {
      throw new ZipError(`ZIP 压缩方法 ${method} 不受支持：${name}`)
    }
    if (bytes.length > budget.maxEntryUncompressedBytes) {
      throw new ZipError(
        `ZIP 单条解压大小 ${bytes.length} 超过上限 ${budget.maxEntryUncompressedBytes}：${name}`,
      )
    }
    totalBytes += bytes.length
    if (totalBytes > budget.maxTotalUncompressedBytes) {
      throw new ZipError(
        `ZIP 累计解压大小 ${totalBytes} 超过上限 ${budget.maxTotalUncompressedBytes}：${name}`,
      )
    }
    out.push({ name, bytes, directory: false })
  }
  return out
}

export function zipMap(buf: Buffer, limits: ZipLimits = {}): Map<string, Buffer> {
  const map = new Map<string, Buffer>()
  for (const entry of readZipEntries(buf, limits)) {
    if (!entry.directory) map.set(entry.name, entry.bytes)
  }
  return map
}
