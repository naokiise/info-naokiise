// Pull the CV/works list from Notion ("ise, naoki web site: list")
// and write src/data/works.md.
// Env: NOTION_TOKEN (read from .env if present).
// Usage: node scripts/notion-sync.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
loadEnv(join(root, ".env"));

// Notion data sources (= databases) on the "ise, naoki web site: list" page.
// The Notion page whose top 2-column rows (name / Contact / Biography) become the profile.
const PROFILE_PAGE = "23579420-52c3-80db-8168-d5b246d987d3";

const SOURCES = {
  works: "3473c780-bd63-4b15-8d5c-934856373735", // naoki ise, database
  teaching: "31279420-52c3-8052-9319-000b3f3d7425",
  publications: "31279420-52c3-808b-bcc5-000b65b0ab1b",
  education: "31379420-52c3-80d5-9a7a-000b844b14d1",
};

// Same filters as the linked views on the Notion page ("discipline" contains any; Selected = on).
const WORK_SECTIONS = [
  ["Interface Design", ["UI/UX", "Web visuals", "Web"]],
  ["Graphic Design", ["Printing visuals", "Visualization", "algorithmic design", "Graphic design"]],
  ["Editorial Design", ["printed matter", "Editorial"]],
  ["Group Exhibitions", ["Exhibition"]],
];

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.log("[notion-sync] NOTION_TOKEN not set — keeping existing works.md");
  process.exit(0);
}

const mdPath = join(root, "src/data/works.md");

const works = [];
const pages = {}; // work id -> body blocks for the individual page

// 1) Main database → design sections + exhibitions
for (const page of await query(SOURCES.works)) {
  const p = page.properties;
  if (!p.Selected?.checkbox) continue;
  const disciplines = (p.discipline?.multi_select ?? []).map((o) => o.name);
  const url = p.URL?.url || "";
  // One entry per project: first matching section; venue shown if it is an exhibition.
  const sections = WORK_SECTIONS.filter(([, tags]) => disciplines.some((d) => tags.includes(d))).map(([s]) => s);
  // Selected projects outside the four sections (e.g. Experimental / Sound) are still shown.
  if (!sections.length) sections.push("Experiments");
  const isExhibition = sections.includes("Group Exhibitions");
  const blocks = await pageBody(page.id);
  const work = {
    section: sections[0],
    year: p.year?.select?.name ?? "",
    month: p.Date?.date?.start ? String(Number(p.Date.date.start.slice(5, 7))) : "",
    title: text(p.title),
    venue: isExhibition ? p.venue?.select?.name ?? text(p["collaborators, venue"]) : "",
    ...linkOrYoutube(url),
    image: blocks.find((b) => b.type === "image")?.src || cover(page),
  };
  works.push(work);
  pages[workId(work)] = blocks;
}

// 2) Teaching
for (const page of await query(SOURCES.teaching)) {
  const p = page.properties;
  works.push({
    section: "Teaching",
    year: p.Year?.select?.name ?? "",
    title: text(p.Name),
    text: text(p.Title),
    ...linkOrYoutube(p.URL?.url || ""),
  });
}

// 3) Publications
for (const page of await query(SOURCES.publications)) {
  const p = page.properties;
  works.push({
    section: "Publications",
    year: p.Year?.select?.name ?? "",
    title: text(p.Name),
    publisher: p.Publisher?.select?.name ?? "",
    ...linkOrYoutube(p.URL?.url || ""),
    image: cover(page),
  });
}

// 4) Educational background
for (const page of await query(SOURCES.education)) {
  const p = page.properties;
  works.push({ section: "Educational background", year: p.year?.select?.name ?? "", title: text(p.Name) });
}

// Section order as above, newest first within each section.
const order = [...WORK_SECTIONS.map(([s]) => s), "Experiments", "Teaching", "Publications", "Educational background"];
works.sort(
  (a, b) => order.indexOf(a.section) - order.indexOf(b.section) || (parseInt(b.year) || 0) - (parseInt(a.year) || 0),
);

const keys = ["section", "year", "month", "title", "venue", "text", "publisher", "image", "link", "youtube"];
let out = "---\nworks:\n";
for (const w of works.filter((w) => w.title)) {
  let first = true;
  for (const k of keys) {
    if (!w[k]) continue;
    out += `${first ? "  - " : "    "}${k}: ${JSON.stringify(w[k])}\n`;
    first = false;
  }
}
out += "---\n";
writeFileSync(mdPath, out);
writeFileSync(join(root, "src/data/work-pages.json"), JSON.stringify(pages, null, 1));

// Profile rows: each column_list on the list page = [label column | value column]
try {
  const profile = [];
  for (const b of await children(PROFILE_PAGE)) {
    if (b.type !== "column_list") continue;
    const cols = await children(b.id);
    if (cols.length < 2) continue;
    const cell = async (col) =>
      (await children(col.id))
        .map((x) => x[x.type]?.rich_text)
        .filter((rt) => rt?.length)
        .map(richHtml)
        .join("<br>");
    const label = await cell(cols[0]);
    const html = await cell(cols[1]);
    if (label || html) profile.push({ label, html });
  }
  if (profile.length) {
    writeFileSync(join(root, "src/data/profile.json"), JSON.stringify(profile, null, 1));
    console.log(`[notion-sync] wrote ${profile.length} profile rows`);
  }
} catch (e) {
  console.warn(`[notion-sync] profile skipped: ${e.message}`);
}
console.log(`[notion-sync] wrote ${works.length} items to src/data/works.md`);

// ── helpers ──
async function query(id) {
  console.log(`[notion-sync] reading ${Object.keys(SOURCES).find((k) => SOURCES[k] === id)}…`);
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${id}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 404 && id !== SOURCES.works) {
      console.warn(`[notion-sync] skipped (not found / not shared): ${id}`);
      return [];
    }
    if (!res.ok) throw new Error(`Notion query ${id} failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}
function text(prop) {
  if (!prop) return "";
  const arr = prop.title ?? prop.rich_text ?? [];
  return arr.map((t) => t.plain_text).join("").replace(/\s*\n\s*/g, " ").trim();
}
function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}
function linkOrYoutube(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  return m ? { youtube: m[1] } : { link: url };
}
// Same id as src/lib/slug.ts getWorkId()
function workId(w) {
  const t = w.title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${w.year}-${t}`;
}
// Notion page body → simple blocks for the individual page. Images are saved under public/images/works/.
async function pageBody(pageId) {
  process.stdout.write(`[notion-sync] pages ${Object.keys(pages).length + 1}\r`);
  const out = [];
  try {
    await walk(pageId, 0, out);
  } catch (e) {
    console.warn(`[notion-sync] page body failed for ${pageId}: ${e.message}`);
  }
  return out;
}
async function walk(blockId, depth, out) {
  let cursor;
  do {
    const qs = `page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": "2025-09-03" },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    for (const b of data.results) {
      const rt = b[b.type]?.rich_text;
      switch (b.type) {
        case "paragraph":
          if (rt?.length) out.push({ type: "p", html: richHtml(rt) });
          break;
        case "heading_1":
        case "heading_2":
        case "heading_3":
          out.push({ type: "h", html: richHtml(rt) });
          break;
        case "bulleted_list_item":
        case "numbered_list_item":
          out.push({ type: "li", html: richHtml(rt) });
          break;
        case "quote":
        case "callout":
          out.push({ type: "quote", html: richHtml(rt) });
          break;
        case "image": {
          const src = await download(b);
          if (src) out.push({ type: "image", src, caption: richHtml(b.image.caption ?? []) });
          break;
        }
        case "video":
        case "embed":
        case "bookmark": {
          const url = b[b.type]?.external?.url || b[b.type]?.url || "";
          const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
          if (yt) out.push({ type: "youtube", id: yt[1] });
          else if (url) out.push({ type: "link", url });
          break;
        }
      }
      if (b.has_children && depth < 3 && b.type !== "child_page" && b.type !== "child_database") {
        await walk(b.id, depth + 1, out);
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
}
async function children(blockId) {
  const out = [];
  let cursor;
  do {
    const qs = `page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": "2025-09-03" },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    out.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}
function richHtml(rt) {
  return rt
    .map((t) => {
      let h = escapeHtml(t.plain_text).replace(/\n/g, "<br>");
      const a = t.annotations || {};
      if (a.bold) h = `<strong>${h}</strong>`;
      if (a.italic) h = `<em>${h}</em>`;
      if (a.code) h = `<code>${h}</code>`;
      if (t.href) h = `<a href="${escapeHtml(t.href)}" target="_blank" rel="noopener noreferrer">${h}</a>`;
      return h;
    })
    .join("");
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function download(block) {
  const url = block.image.type === "external" ? block.image.external.url : block.image.file.url;
  let ext = ".jpg";
  try { ext = (extname(new URL(url).pathname) || ".jpg").toLowerCase(); } catch {}
  if (!/^\.(png|jpe?g|gif|webp|avif|svg)$/.test(ext)) ext = ".jpg";
  // Name by the image file itself (URL path without the signed query), so replacing the
  // image inside the same Notion block downloads the new file instead of reusing the old one.
  let stable = url;
  try { stable = new URL(url).pathname; } catch {}
  const name = `notion-${createHash("sha1").update(stable).digest("hex").slice(0, 16)}${ext}`;
  const dir = join(root, "public/images/works");
  const dest = join(dir, name);
  if (!existsSync(dest)) {
    // Large images can take a while: allow 5 minutes, retry once, and skip the image (not the page) on failure.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(300000) });
        if (!r.ok) throw new Error(`${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        mkdirSync(dir, { recursive: true });
        writeFileSync(dest, buf);
        break;
      } catch (e) {
        if (attempt === 2) {
          console.warn(`[notion-sync] image skipped (${e.message}): ${block.id}`);
          return "";
        }
      }
    }
  }
  if (ext === ".gif") return (await gifToWebp(dest)) || `images/works/${name}`;
  return `images/works/${name}`;
}

// Large animated GIFs (e.g. 1920×1080, 100+ frames) fail to load in Safari.
// Convert only those to an animated WebP (keeps transparency, smaller, plays in Safari 14+).
// Small GIFs are kept as they are. Needs "ffmpeg-static" (npm install --save-dev ffmpeg-static).
let ffmpegPath;
async function gifToWebp(gifPath) {
  const webpPath = gifPath.replace(/\.gif$/i, ".webp");
  const rel = `images/works/${webpPath.split("/").pop()}`;
  if (existsSync(webpPath)) return rel;
  const buf = readFileSync(gifPath);
  const width = buf.readUInt16LE(6);
  if (width <= 1280 && buf.length <= 3 * 1024 * 1024) return ""; // small enough: keep GIF
  if (ffmpegPath === undefined) {
    try { ffmpegPath = (await import("ffmpeg-static")).default; } catch { ffmpegPath = null; }
    if (!ffmpegPath) console.warn("[notion-sync] ffmpeg-static not installed — large GIFs are kept as GIF");
  }
  if (!ffmpegPath) return "";
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync(ffmpegPath, [
      "-y", "-loglevel", "error", "-i", gifPath,
      "-vf", "scale='min(1280,iw)':-2:flags=lanczos",
      "-c:v", "libwebp_anim", "-lossless", "0", "-quality", "75", "-loop", "0", "-an", webpPath,
    ]);
    return rel;
  } catch (e) {
    console.warn(`[notion-sync] GIF → WebP failed, keeping GIF: ${e.message}`);
    return "";
  }
}
