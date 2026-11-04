// Tekst uit een Word-bestand (DOCX) zonder extra afhankelijkheid: een DOCX is een ZIP-archief met XML. We lezen
// alleen de centrale map van het archief en pakken word/document.xml (plus voet- en eindnoten) uit met node:zlib,
// met een harde grens op de uitgepakte grootte tegen zip-bommen. Er wordt niets uitgevoerd: macro's, ingesloten
// objecten en externe verwijzingen worden niet gelezen.

import { inflateRawSync } from "node:zlib";
import { docxXmlToText, MAX_DOCX_XML_BYTES } from "@/lib/domain/report-import";

export class ZipError extends Error {}

type Entry = { name: string; method: number; compressedSize: number; size: number; localOffset: number; flags: number };

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEocd(buf: Buffer): number {
  // Het einde van de centrale map staat in de laatste 22 bytes plus hoogstens 64 kB commentaar.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  throw new ZipError("Geen geldig ZIP-archief.");
}

export function zipEntries(buf: Buffer): Entry[] {
  if (buf.length < 22) throw new ZipError("Geen geldig ZIP-archief.");
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (dirOffset === 0xffffffff || count === 0xffff) throw new ZipError("ZIP64-archieven worden niet ondersteund.");
  if (dirOffset + dirSize > buf.length || count > 5000) throw new ZipError("Ongeldige centrale map.");
  const out: Entry[] = [];
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new ZipError("Ongeldige centrale map.");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.push({ name, method, compressedSize, size, localOffset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function readZipEntry(buf: Buffer, entry: Entry, maxBytes: number): Buffer {
  if (entry.flags & 0x1) throw new ZipError("Versleuteld archief.");
  if (entry.size > maxBytes) throw new ZipError("Uitgepakte inhoud te groot.");
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOC_SIG) throw new ZipError("Ongeldige bestandskop.");
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new ZipError("Archief afgebroken.");
  const data = buf.subarray(start, end);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method !== 8) throw new ZipError("Onbekende compressie.");
  // maxOutputLength: ook als de opgegeven grootte liegt, pakt zlib nooit meer uit dan de grens.
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch {
    throw new ZipError("Uitpakken mislukt of inhoud te groot.");
  }
}

// De tekst van het document, dan voetnoten en eindnoten. Gooit ZipError bij een ongeldig of te groot archief.
export function docxToText(data: Uint8Array): string {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const entries = zipEntries(buf);
  const main = entries.find((e) => e.name === "word/document.xml");
  if (!main) throw new ZipError("Geen Word-document.");
  let budget = MAX_DOCX_XML_BYTES;
  const parts: string[] = [];
  for (const name of ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]) {
    const e = entries.find((x) => x.name === name);
    if (!e) continue;
    if (budget <= 0) break;
    const xml = readZipEntry(buf, e, budget);
    budget -= xml.length;
    const text = docxXmlToText(xml.toString("utf8"));
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}
