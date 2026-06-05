export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
