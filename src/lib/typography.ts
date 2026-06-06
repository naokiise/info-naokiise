const CJK_RE =
  /[\u3000-\u303F\u3040-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF々〆ヶ]+/g;

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapCjkSegments(html: string) {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith("<")) return part;
      return part.replace(CJK_RE, "<span class=\"text-ja\">$&</span>");
    })
    .join("");
}

/** 合成フォント: 欧文=Inter 100% / 和文=90% + 括弧内下げ */
export function compositeFontHtml(text: string) {
  const escaped = escapeHtml(text);
  const withParens = escaped.replace(
    /（([^）]+)）/g,
    "（<span class=\"paren-drop\">$1</span>）",
  );
  return wrapCjkSegments(withParens);
}

/** @deprecated compositeFontHtml を使用 */
export function parenDropHtml(text: string) {
  return compositeFontHtml(text);
}
