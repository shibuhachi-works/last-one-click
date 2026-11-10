// テスト用の小さな ZIP を作る(Node の zlib で deflate)。本番のコードからは使わない(拡張の tsconfig から外すため、名前を .test.ts にしている)
import { crc32 as zcrc, deflateRawSync } from "node:zlib";

export type FixtureEntry = { name: string; data: Uint8Array | string; store?: boolean; utf8Flag?: boolean; nameBytes?: Uint8Array; sizeOverride?: number; crcOverride?: number };

export function makeZip(entries: FixtureEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = typeof e.data === "string" ? Buffer.from(e.data) : Buffer.from(e.data);
    const comp = e.store ? data : deflateRawSync(data);
    const name = e.nameBytes ? Buffer.from(e.nameBytes) : Buffer.from(e.name);
    const flags = e.utf8Flag === false ? 0 : 0x0800;
    const size = e.sizeOverride ?? data.length;
    const crc = e.crcOverride ?? zcrc(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(e.store ? 0 : 8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(e.store ? 0 : 8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
