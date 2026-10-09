export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getWorkId(work: { year: string; title: string }): string {
  // URL-safe: letters/numbers (incl. Japanese) joined by "-". Keep in sync with scripts/notion-sync.mjs workId().
  const t = work.title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${work.year}-${t}`;
}

