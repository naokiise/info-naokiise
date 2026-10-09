// Dev-only: drag an image file from Finder onto a work node to attach
// it. The file is saved to public/images/works/ and an `image:` line is
// written into src/data/works.md (the page then hot-reloads).

let hovered: HTMLElement | null = null;

function nodeAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y);
  return el instanceof Element
    ? el.closest<HTMLElement>(".work-section--node")
    : null;
}

function setHovered(el: HTMLElement | null) {
  if (hovered === el) return;
  if (hovered) hovered.style.outline = "";
  hovered = el;
  if (hovered) hovered.style.outline = "2px dashed currentColor";
}

async function upload(node: HTMLElement, file: File) {
  const index = Number(node.id.replace("work-node-", ""));
  node.style.outline = "2px solid currentColor";
  const res = await fetch("/__image-drop", {
    method: "POST",
    headers: {
      "x-work-index": String(index),
      "x-file-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) {
    node.style.outline = "";
    alert(`画像の保存に失敗しました:\n${await res.text()}`);
  }
  // On success works.md changes and Vite reloads the page for us.
}

export function initImageDropDev() {
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setHovered(nodeAt(e.clientX, e.clientY));
  };

  const onDrop = (e: DragEvent) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    setHovered(null);
    const node = nodeAt(e.clientX, e.clientY);
    if (!node) return;
    if (!file.type.startsWith("image/") && !file.name.endsWith(".svg")) {
      alert("画像ファイルをドロップしてください");
      return;
    }
    void upload(node, file);
  };

  const onDragLeave = (e: DragEvent) => {
    if (e.relatedTarget === null) setHovered(null);
  };

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);
  document.addEventListener("dragleave", onDragLeave);

  return () => {
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("drop", onDrop);
    document.removeEventListener("dragleave", onDragLeave);
    setHovered(null);
  };
}
