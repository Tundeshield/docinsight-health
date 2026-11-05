import mammoth from "mammoth";

/** DOCX → markdown-ish text (headings, lists, tables), preserving structure for chunking. */
export async function docxToMarkdown(buf: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  let md = html
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_m, l, t) => `\n\n${"#".repeat(Number(l))} ${strip(t)}\n\n`)
    .replace(/<table[^>]*>(.*?)<\/table>/gis, (_m, t: string) => {
      const rows = [...t.matchAll(/<tr[^>]*>(.*?)<\/tr>/gis)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gis)].map((c) => strip(c[1]).replace(/\|/g, "/")));
      if (!rows.length) return "";
      const head = `| ${rows[0].join(" | ")} |\n|${rows[0].map(() => "---").join("|")}|`;
      return `\n\n${head}\n${rows.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n")}\n\n`;
    })
    .replace(/<ol[^>]*>(.*?)<\/ol>/gis, (_m, l: string) => "\n" + [...l.matchAll(/<li[^>]*>(.*?)<\/li>/gis)].map((x, i) => `${i + 1}. ${strip(x[1])}`).join("\n") + "\n")
    .replace(/<ul[^>]*>(.*?)<\/ul>/gis, (_m, l: string) => "\n" + [...l.matchAll(/<li[^>]*>(.*?)<\/li>/gis)].map((x) => `- ${strip(x[1])}`).join("\n") + "\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gis, (_m, t) => `\n${strip(t)}\n`)
    .replace(/<br\s*\/?>/gi, "\n");
  md = strip(md.replace(/\n/g, "\u0000")).replace(/\u0000/g, "\n");
  return md.replace(/\n{3,}/g, "\n\n").trim();
}
