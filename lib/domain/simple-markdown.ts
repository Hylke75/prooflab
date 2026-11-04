// Eenvoudige markdown voor eigen notities: koppen (#, ##, ###), lijsten (- of * en 1.), vet (**tekst**) en links
// ([tekst](https://…)). De uitkomst is een boom van tekst-knopen; de weergave zet die om in React-elementen, zodat
// er nooit HTML uit de notitie in de pagina komt. Alles wat geen herkende opmaak is, blijft gewoon tekst.

export type Inline = { kind: "text"; text: string } | { kind: "bold"; children: Inline[] } | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

// Alleen webadressen en e-mail; javascript:, data: en relatieve adressen worden gewone tekst.
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "bold", children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (src[i] === "[") {
      const m = /^\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/.exec(src.slice(i));
      const href = m ? safeHref(m[2]) : null;
      if (m && href) {
        flush();
        out.push({ kind: "link", href, children: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = (src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: Inline[][] | null = null;
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const close = () => {
    if (para) blocks.push({ kind: "paragraph", lines: para });
    if (list) blocks.push({ kind: "list", ...list });
    para = null;
    list = null;
  };
  for (const line of lines) {
    if (!line.trim()) {
      close();
      continue;
    }
    const h = /^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      close();
      blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, children: parseInline(h[2]) });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    const item = ul ?? ol;
    if (item) {
      const ordered = !ul;
      if (para) close();
      if (list && list.ordered !== ordered) close();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseInline(item[1]));
      continue;
    }
    if (list) close();
    if (!para) para = [];
    para.push(parseInline(line));
  }
  close();
  return blocks;
}
