// Minimal MP4 (ISO BMFF) metadata reader - pure Node, no dependencies.
// Reads duration (mvhd) and display dimensions (tkhd) without loading the file.
import { openSync, readSync, statSync, closeSync, fstatSync } from 'node:fs';

function readBoxes(fd, start, end) {
  const out = [];
  let pos = start;
  const buf = Buffer.alloc(16);
  while (pos < end) {
    if (pos + 8 > end) break;
    readSync(fd, buf, 0, 8, pos);
    let size = buf.readUInt32BE(0);
    const type = buf.toString('latin1', 4, 8);
    let hdr = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      readSync(fd, buf, 0, 16, pos);
      size = Number(buf.readBigUInt64BE(8));
      hdr = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < hdr || pos + size > end) break;
    out.push({ type, offset: pos + hdr, size: size - hdr });
    pos += size;
  }
  return out;
}

function findBox(fd, start, end, path) {
  let s = start, e = end;
  for (const want of path) {
    const hit = readBoxes(fd, s, e).find(b => b.type === want);
    if (!hit) return null;
    s = hit.offset;
    e = hit.offset + hit.size;
  }
  return { offset: s, size: e - s };
}

export function probeMp4(path) {
  const fd = openSync(path, 'r');
  try {
    const total = statSync(path).size;
    const moov = findBox(fd, 0, total, ['moov']);
    if (!moov) return { duration: null, width: null, height: null };

    let duration = null;
    const mvhd = findBox(fd, moov.offset, moov.offset + moov.size, ['mvhd']);
    if (mvhd) {
      const b = Buffer.alloc(mvhd.size);
      readSync(fd, b, 0, mvhd.size, mvhd.offset);
      const ver = b[0];
      const ts = ver === 1 ? b.readUInt32BE(20) : b.readUInt32BE(12);
      const dur = ver === 1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
      if (ts) duration = dur / ts;
    }

    let width = null, height = null;
    for (const trak of readBoxes(fd, moov.offset, moov.offset + moov.size).filter(b => b.type === 'trak')) {
      const tkhd = findBox(fd, trak.offset, trak.offset + trak.size, ['tkhd']);
      if (!tkhd) continue;
      const b = Buffer.alloc(tkhd.size);
      readSync(fd, b, 0, tkhd.size, tkhd.offset);
      const ver = b[0];
      const w = ver === 1 ? b.readUInt32BE(88) : b.readUInt32BE(76);
      const h = ver === 1 ? b.readUInt32BE(92) : b.readUInt32BE(80);
      if (w >> 16) { width = w >> 16; height = h >> 16; break; }
    }
    return { duration, width, height };
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  for (const p of process.argv.slice(2)) {
    console.log(p, JSON.stringify(probeMp4(p)));
  }
}
