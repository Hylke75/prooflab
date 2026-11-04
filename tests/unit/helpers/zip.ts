import { deflateRawSync } from "node:zlib";

// Minimaal ZIP-archief (deflate of opgeslagen), voor tests van de DOCX-lezer. `declaredSize` laat een test liegen
// over de uitgepakte grootte (zip-bom); `encrypted` zet de versleutelvlag.
export type ZipFile = { name: string; data: string | Buffer; store?: boolean; declaredSize?: number; encrypted?: boolean };

export function makeZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : f.data;
    const body = f.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(f.name, "utf8");
    const method = f.store ? 0 : 8;
    const flags = f.encrypted ? 1 : 0;
    const size = f.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc (niet gecontroleerd)
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}

// Een eenvoudig Word-document: alinea's, een tabel, een tab, entiteiten en een verwijderde wijziging.
export function makeDocx(paragraphs: string[], extra = ""): Buffer {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${extra}</w:body></w:document>`;
  return makeZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: xml },
  ]);
}
