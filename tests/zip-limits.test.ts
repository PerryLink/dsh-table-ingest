import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readZipEntries, ZipError } from '../src/ingest/zip.ts'

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50

interface ZipInput {
  name: string
  data: Buffer
  method?: 0 | 8
  /** Deliberately lie in the central directory to prove the reader does not trust it. */
  declaredUncompressed?: number
}

function makeZip(inputs: ZipInput[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const input of inputs) {
    const name = Buffer.from(input.name)
    const method = input.method ?? 8
    const raw = method === 8 ? deflateRawSync(input.data) : input.data
    const uncompressed = input.declaredUncompressed ?? input.data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(raw.length, 18)
    local.writeUInt32LE(uncompressed, 22)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, raw)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(CENTRAL, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt32LE(raw.length, 20)
    entry.writeUInt32LE(uncompressed, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)

    offset += 30 + name.length + raw.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD, 0)
  end.writeUInt16LE(inputs.length, 8)
  end.writeUInt16LE(inputs.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, directory, end])
}

describe('zip budgets', () => {
  it('reads a normal entry when every budget is respected', () => {
    const zip = makeZip([{ name: 'word/document.xml', data: Buffer.from('hello') }])
    const entries = readZipEntries(zip, { maxEntries: 8, maxEntryUncompressedBytes: 1_024 })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('word/document.xml')
    expect(entries[0]?.bytes.toString()).toBe('hello')
  })

  it('rejects a package with too many entries', () => {
    const zip = makeZip([
      { name: 'a.xml', data: Buffer.from('a') },
      { name: 'b.xml', data: Buffer.from('b') },
      { name: 'c.xml', data: Buffer.from('c') },
    ])
    expect(() => readZipEntries(zip, { maxEntries: 2 })).toThrow(ZipError)
    expect(() => readZipEntries(zip, { maxEntries: 2 })).toThrow(/条目数/)
  })

  it('rejects a single entry whose output exceeds the per-entry budget', () => {
    const zip = makeZip([{ name: 'word/document.xml', data: Buffer.alloc(32, 0x61) }])
    expect(() =>
      readZipEntries(zip, {
        maxEntryUncompressedBytes: 16,
        maxTotalUncompressedBytes: 1_024,
      }),
    ).toThrow(/预算|单条/)
  })

  it('rejects cumulative output that exceeds the total budget', () => {
    const zip = makeZip([
      { name: 'a.xml', data: Buffer.alloc(20, 0x61) },
      { name: 'b.xml', data: Buffer.alloc(20, 0x62) },
    ])
    expect(() =>
      readZipEntries(zip, {
        maxEntryUncompressedBytes: 100,
        maxTotalUncompressedBytes: 30,
      }),
    ).toThrow(/预算|累计/)
  })

  it('rejects a compressed entry larger than the compressed-size budget', () => {
    const zip = makeZip([
      { name: 'a.bin', data: Buffer.from(Array.from({ length: 256 }, (_, i) => i % 251)) },
    ])
    expect(() => readZipEntries(zip, { maxCompressedEntryBytes: 8 })).toThrow(/压缩大小/)
  })

  it('does not trust the central directory reported uncompressed size', () => {
    const zip = makeZip([
      { name: 'word/document.xml', data: Buffer.alloc(32, 0x61), declaredUncompressed: 1 },
    ])
    expect(() =>
      readZipEntries(zip, {
        maxEntryUncompressedBytes: 16,
        maxTotalUncompressedBytes: 1_024,
      }),
    ).toThrow(/预算|单条/)
  })

  it('applies the default 8 MiB per-entry ceiling', () => {
    const zip = makeZip([{ name: 'word/document.xml', data: Buffer.alloc(9 * 1024 * 1024, 0x61) }])
    expect(() => readZipEntries(zip)).toThrow(/预算|单条/)
  })
})
