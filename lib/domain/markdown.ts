// Kleine, veilige markdown-parser voor de antwoorden van de coach (fase B4/B6). Levert een boom op die de
// component components/coach/Markdown.tsx als React-elementen rendert: er gaat nooit HTML de pagina in
// (geen dangerouslySetInnerHTML), dus ook <script> of onclick in het antwoord blijft gewone tekst.
//
// Ondersteund: koppen (#, ##, ###), lijsten (-, *, 1.), alinea's, **vet**, *cursief*, `code` en [tekst](url).
// Links alleen naar http(s), mailto of een pad binnen de app ("/app/…"); andere links worden gewone tekst.

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; external: boolean; c: Inline[] };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][]; start: number };

export function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (/^https?:\/\/[^\s]+$/i.test(href)) return { href, external: true };
  if (/^mailto:[^\s]+$/i.test(href)) return { href, external: true };
  if (/^\/(?!\/)[^\s]*$/.test(href)) return { href, external: false };
  return null;
}

// Inline-opmaak, van links naar rechts. Onafgesloten markeringen blijven letterlijke tekst.
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      out.push({ t: "code", v: m[1] });
      i += m[0].length;
    } else if ((m = rest.match(/^\*\*(.+?)\*\*/)) || (m = rest.match(/^__(.+?)__/))) {
      flush();
      out.push({ t: "strong", c: parseInline(m[1]) });
      i += m[0].length;
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      const link = safeHref(m[2]);
      if (link) out.push({ t: "link", ...link, c: parseInline(m[1]) });
      else out.push({ t: "text", v: m[1] });
      i += m[0].length;
    } else if ((m = rest.match(/^\*(?!\s)([^*]+?)\*/)) || (m = rest.match(/^_(?!\s)([^_]+?)_(?![\p{L}\p{N}])/u))) {
      flush();
      out.push({ t: "em", c: parseInline(m[1]) });
      i += m[0].length;
    } else {
      text += src[i];
      i++;
    }
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: string[]; start: number } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  const endList = () => {
    if (list) {
      const items = list.items.map(parseInline);
      blocks.push(list.t === "ul" ? { t: "ul", items } : { t: "ol", items, start: list.start });
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      endPara();
      endList();
    } else if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      endPara();
      endList();
      blocks.push({ t: "h", level: Math.min(3, m[1].length) as 1 | 2 | 3, c: parseInline(m[2]) });
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      endPara();
      if (list?.t !== "ul") {
        endList();
        list = { t: "ul", items: [], start: 1 };
      }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/))) {
      endPara();
      if (list?.t !== "ol") {
        endList();
        list = { t: "ol", items: [], start: Number(m[1]) };
      }
      list.items.push(m[2]);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // Vervolgregel van een lijstitem.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      endList();
      para.push(line.trim());
    }
  }
  endPara();
  endList();
  return blocks;
}
