import { latentMapPositions, mulberry32 } from "../lib/latent";

type ScatterSlot = {
  rx: number;
  ry: number;
  rot: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const PAD = 24;
const TOP_PAD = 48;
const CARD_WIDTH_RATIO = 0.46;
const CARD_MAX_CLOSED = 440;
const CARD_MAX_OPEN = 680;
const CAMERA_LERP = 0.036;
const ANGLE_LERP = 0.03;
const CAMERA_LERP_GLIDE = 0.022;
const ANGLE_LERP_GLIDE = 0.018;
const SWIPE_SECTION_THRESHOLD = 48;
const AVOID_GAP = 112;
const OVERLAP_MAX_ITERATIONS = 320;
const PLACE_NUDGE_LIMIT = 96;
const WORLD_WIDTH_RATIO = 2.6;
const SCROLL_STEP_VH = 1;
const MAX_ZOOM = 3;
const MIN_ZOOM_FLOOR = 0.15;
const ZOOM_LERP = 0.12;
const WHEEL_ZOOM_SENSITIVITY = 0.002;
const MAP_LABEL_FONT_SCALE = 20;
const MAP_CATEGORY_CIRCLE_PX = 8;
// Keep t-SNE points off the exact edges of the world.
const LATENT_MARGIN = 0.06;

type SectionAnchor = {
  el: HTMLElement;
  cx: number;
  cy: number;
  rot: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

// Works in the same section share a base orientation (from the section
// name), with a small per-work jitter so the cluster reads as a texture.
const SECTION_ANGLE_JITTER = 0.6;

function sectionAngle(section: string, key: string) {
  const base = mulberry32(hashString(section))() * Math.PI * 2;
  const jitter = (mulberry32(hashString(key))() - 0.5) * SECTION_ANGLE_JITTER;
  return base + jitter;
}

// Re-express `target` so the lerp from `reference` takes the shortest
// rotation (≤ 180°) instead of unwinding the long way around.
function nearestAngle(target: number, reference: number) {
  let d = (target - reference) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return reference + d;
}

function hashString(str: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function syncOpenStyles(el: HTMLElement, focusEl: HTMLElement | null) {
  el.style.zIndex = el === focusEl ? "10" : "1";
}

function displayRot(slot: ScatterSlot) {
  return slot.rot;
}

function applySectionTransform(
  el: HTMLElement,
  slot: ScatterSlot,
  openCount: number,
  totalSections: number,
) {
  const rot = displayRot(slot);
  el.style.transform = `translate(${slot.x}px, ${slot.y}px) rotate(${rot}rad)`;
}

function rotatedExtents(
  slot: ScatterSlot,
  openCount: number,
  totalSections: number,
) {
  const { x, y, w, h } = slot;
  const rot = displayRot(slot);
  const cx = w / 2;
  const cy = h / 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const corners = [
    [-cx, -cy],
    [cx, -cy],
    [cx, cy],
    [-cx, cy],
  ].map(([dx, dy]) => ({
    x: x + cx + dx * cos - dy * sin,
    y: y + cy + dx * sin + dy * cos,
  }));

  return {
    minX: Math.min(...corners.map((c) => c.x)),
    maxX: Math.max(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

export function initScatterWorks(container: HTMLElement) {
  const sectionEls = [
    ...container.querySelectorAll<HTMLElement>(".work-section"),
  ];
  if (sectionEls.length === 0) return;
  const totalSections = sectionEls.length;
  // Node mode: many small year+title items instead of a few big cards.
  const nodeMode = sectionEls.some((el) =>
    el.classList.contains("work-section--node"),
  );
  const avoidGap = nodeMode ? 28 : AVOID_GAP;
  const mapLabelsEnabled = totalSections <= 12;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const world = document.createElement("div");
  world.className = "works__world";
  const worldRoute = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  worldRoute.classList.add("works__route");
  worldRoute.setAttribute("aria-hidden", "true");
  const worldRoutePath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  worldRoutePath.classList.add("works__route-path");
  const worldRoutePoints = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  worldRoutePoints.classList.add("works__route-points");
  worldRoute.appendChild(worldRoutePath);
  worldRoute.appendChild(worldRoutePoints);
  while (container.firstChild) {
    world.appendChild(container.firstChild);
  }
  world.appendChild(worldRoute);
  container.appendChild(world);

  container.classList.add("works--scatter");

  const slots = new Map<string, ScatterSlot>();
  let viewportWidth = 0;
  let viewportHeight = 0;
  let worldWidth = 0;
  let worldHeight = 0;
  let viewX = 0;
  let viewY = 0;
  let viewAngle = 0;
  let zoom = 1;
  let targetViewX = 0;
  let targetViewY = 0;
  let targetViewAngle = 0;
  let targetZoom = 1;
  let focusEl: HTMLElement | null = null;
  let pan: { startX: number; startY: number; viewX0: number; viewY0: number } | null =
    null;
  let touchScroll: {
    startX: number;
    startY: number;
    progress0: number;
    sectionIndex0: number;
    scrolling: boolean;
  } | null = null;
  // Two-finger pinch zoom (mobile). Tracks live touch points and the
  // world anchor that stays pinned under the pinch midpoint.
  const activeTouches = new Map<number, { x: number; y: number }>();
  let pinch: {
    startDist: number;
    startZoom: number;
    pivotX: number;
    pivotY: number;
  } | null = null;
  // While a wheel zoom animates, keep this world point pinned under the
  // cursor every frame (zoom and pan lerp at different rates otherwise).
  let wheelPivot: { wx: number; wy: number; sx: number; sy: number } | null =
    null;
  const TOUCH_SCROLL_THRESHOLD = 6;
  const TOUCH_SCROLL_THRESHOLD_NARROW = 12;
  let suppressScrollCamera = false;
  let cameraGlide = false;
  let syncedSectionIndex = -1;
  let userHasNavigated = false;
  let raf = 0;
  let scrollDriving = true;
  let scrollProgress = 0;
  let scrollAnchors: SectionAnchor[] = [];
  let headerAlign = PAD;
  const mapRoot = document.getElementById("works-map");
  const mapFrame = mapRoot?.querySelector<HTMLElement>(".works-map__frame");
  const mapRoute = mapRoot?.querySelector<SVGSVGElement>(".works-map__route");
  const mapRoutePath = mapRoot?.querySelector<SVGPathElement>(".works-map__route-path");
  const mapContent = document.createElementNS("http://www.w3.org/2000/svg", "g");
  mapContent.classList.add("works-map__route-content");
  const mapRoutePoints = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  mapRoutePoints.classList.add("works-map__route-points");
  if (mapRoute && mapRoutePath) {
    mapRoute.appendChild(mapContent);
    mapContent.appendChild(mapRoutePath);
    mapContent.appendChild(mapRoutePoints);
  }
  const mapMarkers = new Map<HTMLElement, HTMLButtonElement>();
  const scrollTrack = document.createElement("div");
  scrollTrack.className = "works-scroll-track";
  scrollTrack.setAttribute("aria-hidden", "true");
  container.insertAdjacentElement("afterend", scrollTrack);

  const scaleIndicator = document.createElement("div");
  scaleIndicator.className = "works-scale font-inter";
  scaleIndicator.setAttribute("aria-hidden", "true");
  document.body.appendChild(scaleIndicator);
  let scaleIndicatorText = "";

  // Search box: type to glide the camera to the first matching work,
  // Enter cycles through the rest.
  const searchWrap = document.createElement("div");
  searchWrap.className = "works-search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search";
  searchInput.className = "works-search__input font-inter";
  searchInput.setAttribute("aria-label", "作品を検索");
  const searchCount = document.createElement("span");
  searchCount.className = "works-search__count font-inter";
  searchWrap.append(searchInput, searchCount);
  document.body.appendChild(searchWrap);

  let searchMatches: HTMLElement[] = [];
  let searchCursor = -1;
  let searchTimer = 0;

  function runSearch(query: string) {
    const q = query.trim().toLowerCase();
    searchMatches = [];
    searchCursor = -1;
    if (!q) {
      searchCount.textContent = "";
      return;
    }
    searchMatches = sectionEls.filter((el) =>
      (el.textContent ?? "").toLowerCase().includes(q),
    );
    searchCount.textContent = searchMatches.length
      ? `${searchMatches.length}`
      : "0";
    if (searchMatches.length) {
      searchCursor = 0;
      focusSection(searchMatches[0], true);
    }
  }

  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => runSearch(searchInput.value), 250);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && searchMatches.length) {
      event.preventDefault();
      searchCursor = (searchCursor + 1) % searchMatches.length;
      searchCount.textContent = `${searchCursor + 1}/${searchMatches.length}`;
      focusSection(searchMatches[searchCursor], true);
    } else if (event.key === "Escape") {
      searchInput.value = "";
      runSearch("");
      searchInput.blur();
    }
  });

  function updateScaleIndicator() {
    const text = `${Math.round(zoom * 100)}%`;
    if (text === scaleIndicatorText) return;
    scaleIndicatorText = text;
    scaleIndicator.textContent = text;
  }

  // Tap a node image to zoom the camera in on that work (image fills
  // ~80% of the viewport width); tap again to zoom back out.
  const onImageActivate = (event: Event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLImageElement) ||
      !target.classList.contains("work-section__image")
    ) {
      return;
    }
    const node = target.closest<HTMLElement>(".work-section--node");
    if (!node) return;
    // Beat the node's focus handler; the camera move is ours.
    event.preventDefault();
    event.stopPropagation();

    const alreadyZoomed = focusEl === node && targetZoom > 1.05;
    if (alreadyZoomed) {
      targetZoom = 1;
      return;
    }
    targetZoom = Math.min(
      MAX_ZOOM,
      Math.max(1.2, (viewportWidth * 0.8) / Math.max(1, target.offsetWidth)),
    );
    focusSection(node, true);
  };
  container.addEventListener("click", onImageActivate, true);

  const summaryUnsubs: Array<() => void> = [];

  function slotKey(el: HTMLElement) {
    return el.id || el.querySelector(".work-section__title")?.textContent || "";
  }

  // Position works on a latent-space map: textual similarity alone
  // (TF-IDF -> t-SNE) becomes spatial proximity in the world.
  const latentPoints = latentMapPositions(
    sectionEls.map((el) => el.textContent ?? ""),
  );

  sectionEls.forEach((el, index) => {
    const key = slotKey(el);
    const point = latentPoints[index] ?? { x: 0.5, y: 0.5 };
    slots.set(key, {
      rx: LATENT_MARGIN + point.x * (1 - LATENT_MARGIN * 2),
      ry: LATENT_MARGIN + point.y * (1 - LATENT_MARGIN * 2),
      rot: sectionAngle(el.dataset.section ?? "", key),
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  });

  for (const el of sectionEls) {
    const summaryEl = el.querySelector<HTMLButtonElement>(".work-section__summary");
    if (summaryEl) {
      const onSummaryClick = (event: Event) => {
        event.stopPropagation();
        focusSection(el, true);
      };

      summaryEl.addEventListener("click", onSummaryClick);
      summaryUnsubs.push(() => {
        summaryEl.removeEventListener("click", onSummaryClick);
      });
    }

    if (mapFrame) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "works-map__marker";
      marker.setAttribute(
        "aria-label",
        el.querySelector(".work-section__title")?.textContent ?? "Work section",
      );
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        activateSectionFromMap(el);
      });
      mapFrame.appendChild(marker);
      mapMarkers.set(el, marker);
    }
  }

  function shouldHandleTouchScroll(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    return !target.closest(
      "button, a, input, textarea, select, label, .works-map, .works-map *",
    );
  }

  function touchScrollThreshold() {
    return isNarrowViewport() ? TOUCH_SCROLL_THRESHOLD_NARROW : TOUCH_SCROLL_THRESHOLD;
  }

  function markUserNavigated() {
    userHasNavigated = true;
  }

  function focusSection(el: HTMLElement, animateCamera = false) {
    markUserNavigated();
    scrollDriving = false;
    wheelPivot = null;
    for (const section of sectionEls) {
      syncOpenStyles(section, el);
    }
    focusCamera(el, animateCamera);
    if (!animateCamera) {
      applyCamera();
    }
    updateMap();
  }

  function progressFromSectionIndex(index: number) {
    const count = scrollAnchors.length;
    if (count <= 1) return 0;
    const clamped = Math.min(count - 1, Math.max(0, index));
    return clamped / (count - 1);
  }

  function sectionIndexFromProgress(progress: number) {
    const count = scrollAnchors.length;
    if (count <= 1) return 0;
    return Math.round(progress * (count - 1));
  }

  function navigateToSectionIndex(index: number, animate = false) {
    const count = scrollAnchors.length;
    if (count === 0) return;

    markUserNavigated();
    const clamped = Math.min(count - 1, Math.max(0, index));
    const progress = progressFromSectionIndex(clamped);
    const sectionEl = scrollAnchors[clamped]?.el ?? null;

    clearFocus();
    targetZoom = 1;
    scrollDriving = true;
    scrollProgress = progress;

    suppressScrollCamera = true;
    window.scrollTo(0, scrollTrack.offsetTop + progress * scrollRange());
    requestAnimationFrame(() => {
      suppressScrollCamera = false;
    });

    setCameraTargetForSection(sectionEl);
    syncedSectionIndex = clamped;
    if (animate) {
      cameraGlide = true;
    } else {
      cameraGlide = false;
      viewX = targetViewX;
      viewY = targetViewY;
      viewAngle = targetViewAngle;
    }

    clampView();
    applyCamera();
    updateMap();
  }

  function scrollToSection(el: HTMLElement) {
    const index = scrollAnchors.findIndex((anchor) => anchor.el === el);
    if (index < 0) return;

    const progress = progressFromSectionIndex(index);
    scrollProgress = progress;
    suppressScrollCamera = true;
    window.scrollTo(0, scrollTrack.offsetTop + progress * scrollRange());
    requestAnimationFrame(() => {
      suppressScrollCamera = false;
    });
  }

  function activateSectionFromMap(el: HTMLElement) {
    focusSection(el, true);
    scrollToSection(el);
  }

  function onMapRouteClick(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;

    const node = event.target.closest<HTMLElement>("[data-work-id]");
    if (!node) return;

    const el = document.getElementById(node.getAttribute("data-work-id") ?? "");
    if (!(el instanceof HTMLElement) || !sectionEls.includes(el)) return;

    event.stopPropagation();
    event.preventDefault();
    activateSectionFromMap(el);
  }

  function onMapFrameClick(event: MouseEvent) {
    if (!mapFrame || worldWidth <= 0 || worldHeight <= 0) return;
    if (event.target instanceof Element && event.target.closest(".works-map__marker")) {
      return;
    }
    if (event.target instanceof Element && event.target.closest("[data-work-id]")) {
      return;
    }

    const rect = mapFrame.getBoundingClientRect();
    const { x: worldX, y: worldY } = mapFrameToWorld(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );

    markUserNavigated();
    clearFocus();
    scrollDriving = false;
    const view = viewForWorldAtScreen(
      worldX,
      worldY,
      viewportWidth / 2,
      viewportHeight / 2,
    );
    targetViewX = view.viewX;
    targetViewY = view.viewY;
    targetViewAngle = nearestAngle(0, viewAngle);
    cameraGlide = true;
    clampView();
    updateMap();
  }

  function summaryAnchorLocal(el: HTMLElement) {
    const summary = el.querySelector<HTMLElement>(".work-section__summary");
    if (!summary) return { x: 12, y: 26 };

    // Nodes anchor at the line start (year), not the title.
    const title = nodeMode
      ? null
      : summary.querySelector<HTMLElement>(".work-section__title");
    if (title) {
      return {
        x: summary.offsetLeft + title.offsetLeft,
        y:
          summary.offsetTop +
          title.offsetTop +
          title.offsetHeight * 0.72,
      };
    }

    return {
      x: summary.offsetLeft,
      y: summary.offsetTop + summary.offsetHeight * 0.38,
    };
  }

  function categoryAnchorPoint(slot: ScatterSlot, el?: HTMLElement) {
    const rot = displayRot(slot);
    const pivotX = slot.w / 2;
    const pivotY = slot.h / 2;
    const local = el ? summaryAnchorLocal(el) : { x: 12, y: 26 };
    const dx = local.x - pivotX;
    const dy = local.y - pivotY;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    return {
      cx: slot.x + pivotX + dx * cos - dy * sin,
      cy: slot.y + pivotY + dx * sin + dy * cos,
    };
  }

  function routePathD(points: SectionAnchor[]) {
    if (points.length === 0) return "";
    return points
      .map((point, index) =>
        index === 0 ? `M ${point.cx} ${point.cy}` : `L ${point.cx} ${point.cy}`,
      )
      .join(" ");
  }

  const MAP_VIEW_PAD = 1.05;

  function screenToWorld(sx: number, sy: number) {
    const { x: ax, y: ay } = cameraViewportAnchor();
    const dx = (sx - ax) / zoom;
    const dy = (sy - ay) / zoom;
    const cos = Math.cos(-viewAngle);
    const sin = Math.sin(-viewAngle);

    return {
      x: dx * cos - dy * sin + ax + viewX,
      y: dx * sin + dy * cos + ay + viewY,
    };
  }

  function viewForWorldAtScreen(
    wx: number,
    wy: number,
    sx: number,
    sy: number,
    z = zoom,
  ) {
    const { x: ax, y: ay } = cameraViewportAnchor();
    const cos = Math.cos(viewAngle);
    const sin = Math.sin(viewAngle);
    const dx = (sx - ax) / z;
    const dy = (sy - ay) / z;
    const px = dx * cos + dy * sin;
    const py = -dx * sin + dy * cos;

    return {
      viewX: wx - ax - px,
      viewY: wy - ay - py,
    };
  }

  function mapCameraCenter() {
    return screenToWorld(viewportWidth / 2, viewportHeight / 2);
  }

  function mapRotateWorldPoint(wx: number, wy: number) {
    const cam = mapCameraCenter();
    const cos = Math.cos(viewAngle);
    const sin = Math.sin(viewAngle);
    const dx = wx - cam.x;
    const dy = wy - cam.y;

    return {
      x: dx * cos - dy * sin + cam.x,
      y: dx * sin + dy * cos + cam.y,
    };
  }

  function mapUnrotateWorldPoint(wx: number, wy: number) {
    const cam = mapCameraCenter();
    const cos = Math.cos(-viewAngle);
    const sin = Math.sin(-viewAngle);
    const dx = wx - cam.x;
    const dy = wy - cam.y;

    return {
      x: dx * cos - dy * sin + cam.x,
      y: dx * sin + dy * cos + cam.y,
    };
  }

  function mapViewBoxRect() {
    const frameW = mapFrame?.clientWidth ?? 0;
    const frameH = mapFrame?.clientHeight ?? 0;

    if (frameW <= 0 || frameH <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
      return { x: 0, y: 0, w: worldWidth, h: worldHeight, frameW, frameH };
    }

    const cam = mapCameraCenter();
    const aspect = frameW / frameH;
    let vbW = (viewportWidth / zoom) * MAP_VIEW_PAD;
    let vbH = (viewportHeight / zoom) * MAP_VIEW_PAD;

    if (vbW / vbH > aspect) {
      vbH = vbW / aspect;
    } else {
      vbW = vbH * aspect;
    }

    return {
      x: cam.x - vbW / 2,
      y: cam.y - vbH / 2,
      w: vbW,
      h: vbH,
      frameW,
      frameH,
    };
  }

  function worldToMapPercent(wx: number, wy: number) {
    const vb = mapViewBoxRect();
    if (vb.frameW <= 0 || vb.frameH <= 0 || vb.w <= 0 || vb.h <= 0) {
      return { left: 0, top: 0 };
    }

    const rotated = mapRotateWorldPoint(wx, wy);

    return {
      left: ((rotated.x - vb.x) / vb.w) * 100,
      top: ((rotated.y - vb.y) / vb.h) * 100,
    };
  }

  function mapFrameToWorld(frameX: number, frameY: number) {
    const vb = mapViewBoxRect();
    if (vb.frameW <= 0 || vb.frameH <= 0) return { x: 0, y: 0 };

    const mapX = vb.x + (frameX / vb.frameW) * vb.w;
    const mapY = vb.y + (frameY / vb.frameH) * vb.h;

    return mapUnrotateWorldPoint(mapX, mapY);
  }

  function applyMapRotation() {
    if (!mapContent.isConnected) return;
    const cam = mapCameraCenter();
    const deg = (viewAngle * 180) / Math.PI;
    mapContent.setAttribute("transform", `rotate(${deg} ${cam.x} ${cam.y})`);
  }

  function showFullRoute(pathEl: SVGPathElement | null) {
    if (!pathEl) return;
    pathEl.style.strokeDasharray = "none";
    pathEl.style.strokeDashoffset = "0";
  }

  function applyRouteProgress(pathEl: SVGPathElement | null, progress: number) {
    if (!pathEl) return;
    const d = pathEl.getAttribute("d");
    if (!d) {
      pathEl.style.strokeDasharray = "none";
      return;
    }

    const clamped = Math.min(1, Math.max(0, progress));
    if (clamped >= 1) {
      showFullRoute(pathEl);
      return;
    }

    const length = pathEl.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) {
      showFullRoute(pathEl);
      return;
    }

    const drawn = length * clamped;
    pathEl.style.strokeDasharray = `${drawn} ${length}`;
    pathEl.style.strokeDashoffset = "0";
  }

  function sectionTitle(el: HTMLElement) {
    return el.querySelector(".work-section__title")?.textContent?.trim() ?? "";
  }

  function mapTitleLines(title: string, number?: number) {
    const parts = title.trim().split(/\s+/).filter(Boolean);
    const prefix = number ? `${number} ` : "";

    if (parts.length <= 1) return [`${prefix}${parts[0] ?? ""}`];
    return [`${prefix}${parts[0]}`, parts.slice(1).join(" ")];
  }

  function mapCategoryCircleRadius() {
    const vb = mapViewBoxRect();
    const scale = vb.frameW > 0 ? vb.w / vb.frameW : 1;
    const px = nodeMode ? 4 : MAP_CATEGORY_CIRCLE_PX;
    return (px / 2) * scale;
  }

  function mapLabelSize(title: string) {
    const lines = mapTitleLines(title);
    const longest = Math.max(...lines.map((line) => line.length), 1);
    const vb = mapViewBoxRect();
    const labelBase = Math.min(vb.w, vb.h) * 0.045;

    return (
      Math.min(16, Math.max(6, labelBase / longest)) * MAP_LABEL_FONT_SCALE
    );
  }

  function appendMapLabelBesideCircle(
    group: SVGGElement,
    title: string,
    circleR: number,
    number: number,
  ) {
    const lines = mapTitleLines(title, number);
    const labelSize = mapLabelSize(lines.join(" "));
    const gap = circleR * 0.55;
    const labelX = circleR + gap;
    const lineHeight = labelSize * 1.2;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("font-size", String(labelSize));
    label.setAttribute("text-anchor", "start");
    label.classList.add("works-map__route-label");

    if (lines.length === 1) {
      label.setAttribute("x", String(labelX));
      label.setAttribute("y", "0");
      label.setAttribute("dominant-baseline", "middle");
      label.textContent = lines[0];
      group.appendChild(label);
      return;
    }

    const ascender = labelSize * 0.72;
    const descender = labelSize * 0.22;
    const startY =
      ascender -
      (lineHeight * (lines.length - 1) + ascender + descender) / 2;

    lines.forEach((line, index) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", String(labelX));
      if (index === 0) {
        tspan.setAttribute("y", String(startY));
      } else {
        tspan.setAttribute("dy", String(lineHeight));
      }
      tspan.textContent = line;
      label.appendChild(tspan);
    });

    group.appendChild(label);
  }

  function readViewportSize() {
    return {
      w: Math.max(280, container.clientWidth),
      h: Math.max(420, container.clientHeight),
    };
  }

  function syncRoutePoints(
    group: SVGGElement,
    points: SectionAnchor[],
    activeEl: HTMLElement | null,
    forMap = false,
  ) {
    group.replaceChildren();

    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex];
      const pointGroup = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g",
      );
      pointGroup.classList.add("works-map__route-node");
      if (forMap && point.el.id) {
        pointGroup.setAttribute("data-work-id", point.el.id);
      }
      const isFocus = point.el === focusEl;
      const isActive = point.el === activeEl;

      if (isFocus) {
        pointGroup.classList.add("works-map__route-node--focus");
      } else if (isActive) {
        pointGroup.classList.add("works-map__route-node--active");
      }

      if (forMap) {
        const deg = (point.rot * 180) / Math.PI;
        const circleR = mapCategoryCircleRadius();
        pointGroup.setAttribute(
          "transform",
          `translate(${point.cx} ${point.cy}) rotate(${deg})`,
        );

        // Each work is a short line segment; the parent group's rotate()
        // orients it to the work's scatter angle.
        const line = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line",
        );
        line.setAttribute("x1", String(-circleR * 2));
        line.setAttribute("y1", "0");
        line.setAttribute("x2", String(circleR * 2));
        line.setAttribute("y2", "0");
        line.classList.add("works-map__route-point");

        if (isFocus) {
          line.classList.add("works-map__route-point--focus");
        } else if (isActive) {
          line.classList.add("works-map__route-point--active");
        }

        pointGroup.appendChild(line);
        if (mapLabelsEnabled) {
          appendMapLabelBesideCircle(
            pointGroup,
            sectionTitle(point.el),
            circleR,
            pointIndex + 1,
          );
        }
      } else {
        const circle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        const radius = isFocus ? 7 : 5;

        circle.setAttribute("cx", String(point.cx));
        circle.setAttribute("cy", String(point.cy));
        circle.setAttribute("r", String(radius));
        circle.classList.add("works__route-point");

        if (isFocus) {
          circle.classList.add("works__route-point--focus");
        } else if (isActive) {
          circle.classList.add("works__route-point--active");
        }

        pointGroup.appendChild(circle);
      }

      group.appendChild(pointGroup);
    }
  }

  function scrollOrderProgress() {
    if (scrollDriving) {
      return isNarrowViewport() ? scrollProgress : getScrollProgress();
    }
    if (focusEl && scrollAnchors.length > 0) {
      const index = scrollAnchors.findIndex((anchor) => anchor.el === focusEl);
      if (index >= 0) {
        return index / Math.max(1, scrollAnchors.length - 1);
      }
    }
    return scrollProgress;
  }

  function updateScrollRoute() {
    const progress = scrollOrderProgress();
    const activeIndex = Math.round(progress * Math.max(0, scrollAnchors.length - 1));
    const activeEl = scrollAnchors[activeIndex]?.el ?? null;

    const d = scrollAnchors.length < 2 ? "" : routePathD(scrollAnchors);

    worldRoute.setAttribute("viewBox", `0 0 ${worldWidth} ${worldHeight}`);
    worldRoutePath.setAttribute("d", d);
    applyRouteProgress(worldRoutePath, progress);
    syncRoutePoints(worldRoutePoints, scrollAnchors, activeEl);
    if (world.lastElementChild !== worldRoute) {
      world.appendChild(worldRoute);
    }

    if (mapRoute && mapRoutePath) {
      const vb = mapViewBoxRect();
      mapRoute.setAttribute(
        "viewBox",
        `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
      );
      mapRoute.setAttribute("preserveAspectRatio", "xMidYMid meet");
      // With many nodes the full route reads as scribble on the tiny
      // map; show dots only.
      mapRoutePath.setAttribute("d", nodeMode ? "" : d);
      showFullRoute(mapRoutePath);
      applyMapRotation();
      syncRoutePoints(mapRoutePoints, scrollAnchors, activeEl, true);
    }

    for (const el of sectionEls) {
      const marker = mapMarkers.get(el);
      if (!marker) continue;
      const index = scrollAnchors.findIndex((anchor) => anchor.el === el);
      marker.classList.toggle("works-map__marker--active", index === activeIndex);
      marker.classList.toggle("works-map__marker--open", el === focusEl);
    }

  }

  function updateMapFrameSize() {
    if (!mapFrame || viewportWidth <= 0 || viewportHeight <= 0) return;

    const narrow = isNarrowViewport();
    let frameW: number;
    let frameH: number;

    if (narrow) {
      const portraitAspect = 88 / 120;
      const maxH = Math.min(60, Math.max(36, viewportHeight * 0.1));
      const maxW = Math.min(70, viewportWidth - 48);

      frameH = maxH;
      frameW = frameH * portraitAspect;
      if (frameW > maxW) {
        frameW = maxW;
        frameH = frameW / portraitAspect;
      }

      frameW = Math.max(32, frameW);
      frameH = Math.max(24, frameH);
    } else {
      const aspect = viewportWidth / viewportHeight;
      const maxW = 84;
      const maxH = 56;

      if (aspect >= maxW / maxH) {
        frameW = maxW;
        frameH = maxW / aspect;
      } else {
        frameH = maxH;
        frameW = maxH * aspect;
      }

      frameW = Math.max(32, frameW);
      frameH = Math.max(24, frameH);
    }

    mapFrame.style.width = `${Math.round(frameW)}px`;
    mapFrame.style.height = `${Math.round(frameH)}px`;
  }

  function updateMap() {
    if (!mapFrame || worldWidth <= 0 || worldHeight <= 0) return;

    updateMapFrameSize();
    updateScrollRoute();

    for (const el of sectionEls) {
      const marker = mapMarkers.get(el);
      const anchor = scrollAnchors.find((point) => point.el === el);
      if (!marker || !anchor) continue;

      const pos = worldToMapPercent(
        anchor.x + anchor.w / 2,
        anchor.y + anchor.h / 2,
      );
      marker.style.left = `${pos.left}%`;
      marker.style.top = `${pos.top}%`;
    }
  }

  function rebuildAnchors() {
    const points = sectionEls
      .map((el) => {
        const slot = slots.get(slotKey(el));
        if (!slot) return null;

        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w <= 0 || h <= 0) return null;

        slot.w = w;
        slot.h = h;

        const { cx, cy } = categoryAnchorPoint(slot, el);
        return {
          el,
          cx,
          cy,
          rot: displayRot(slot),
          x: slot.x,
          y: slot.y,
          w,
          h,
        };
      })
      .filter((a): a is SectionAnchor => a !== null);

    scrollAnchors = [...points].sort((a, b) => a.cy - b.cy);
  }

  function updateScrollTrack() {
    const steps = Math.max(1, scrollAnchors.length);
    const stepVh = nodeMode ? 0.4 : SCROLL_STEP_VH;
    scrollTrack.style.height = `${steps * stepVh * 100}vh`;
  }

  function scrollRange() {
    return Math.max(1, scrollTrack.offsetHeight - viewportHeight);
  }

  function getScrollProgress(): number {
    const y = window.scrollY - scrollTrack.offsetTop;
    return Math.min(1, Math.max(0, y / scrollRange()));
  }

  function applyScrollProgress(progress: number, syncWindow = true) {
    scrollProgress = Math.min(1, Math.max(0, progress));
    setCameraTargetForSection(activeScrollElement());
    viewX = targetViewX;
    viewY = targetViewY;
    viewAngle = targetViewAngle;
    clampView();

    if (!syncWindow) return;

    suppressScrollCamera = true;
    window.scrollTo(0, scrollTrack.offsetTop + scrollProgress * scrollRange());
    requestAnimationFrame(() => {
      suppressScrollCamera = false;
    });
  }

  function isNarrowViewport() {
    return viewportWidth <= 768;
  }

  function isCameraInteracting() {
    return touchScroll !== null || pan !== null;
  }

  function cameraViewportAnchor() {
    const root = getComputedStyle(document.documentElement);
    const gutter = parseFloat(root.getPropertyValue("--page-gutter")) || PAD;
    const narrow = isNarrowViewport();
    return {
      x: narrow ? gutter : headerAlign,
      y: narrow ? 36 : TOP_PAD,
    };
  }

  function cameraAtSlot(slot: ScatterSlot, el?: HTMLElement) {
    const anchor = cameraViewportAnchor();
    const { cx, cy } = categoryAnchorPoint(slot, el);

    return {
      viewX: cx - anchor.x,
      viewY: cy - anchor.y,
      angle: -displayRot(slot),
    };
  }

  function activeScrollElement() {
    if (scrollAnchors.length === 0) return null;
    const progress = scrollOrderProgress();
    const activeIndex = Math.round(progress * Math.max(0, scrollAnchors.length - 1));
    return scrollAnchors[activeIndex]?.el ?? null;
  }

  function titleAnchorScreenPoint(el: HTMLElement) {
    const cRect = container.getBoundingClientRect();
    const summary =
      el.querySelector<HTMLElement>(".work-section__summary") ?? el;
    const title = nodeMode
      ? null
      : summary.querySelector<HTMLElement>(".work-section__title");
    const anchor = cameraViewportAnchor();

    if (title) {
      const tRect = title.getBoundingClientRect();
      return {
        x: tRect.left - cRect.left,
        y: tRect.top - cRect.top + tRect.height * 0.72,
        anchor,
      };
    }

    const sRect = summary.getBoundingClientRect();
    return {
      x: sRect.left - cRect.left,
      y: sRect.top - cRect.top + sRect.height * 0.38,
      anchor,
    };
  }

  function refineCameraToTitle(el: HTMLElement | null) {
    if (!el) return;

    const { x, y, anchor } = titleAnchorScreenPoint(el);
    targetViewX = viewX + (x - anchor.x);
    targetViewY = viewY + (y - anchor.y);
  }

  // Camera view that puts the section's center at the viewport center,
  // compensating the target rotation.
  function cameraCenteredOnSlot(slot: ScatterSlot, z = targetZoom) {
    const anchor = cameraViewportAnchor();
    const angle = -displayRot(slot);
    const wx = slot.x + slot.w / 2;
    const wy = slot.y + slot.h / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = (viewportWidth / 2 - anchor.x) / z;
    const dy = (viewportHeight / 2 - anchor.y) / z;
    const px = dx * cos + dy * sin;
    const py = -dx * sin + dy * cos;

    return {
      viewX: wx - anchor.x - px,
      viewY: wy - anchor.y - py,
      angle,
    };
  }

  function setCameraTargetCentered(el: HTMLElement | null) {
    if (!el) return;

    const slot = slots.get(slotKey(el));
    if (!slot) return;

    const cam = cameraCenteredOnSlot(slot);
    targetViewAngle = nearestAngle(cam.angle, viewAngle);
    targetViewX = cam.viewX;
    targetViewY = cam.viewY;
    clampView();
  }

  function setCameraTargetForSection(el: HTMLElement | null) {
    if (!el) return;

    const slot = slots.get(slotKey(el));
    if (!slot) return;

    const angle = -displayRot(slot);
    const cam = cameraAtSlot(slot, el);
    const savedViewX = viewX;
    const savedViewY = viewY;
    const savedViewAngle = viewAngle;

    targetViewAngle = nearestAngle(angle, viewAngle);
    targetViewX = cam.viewX;
    targetViewY = cam.viewY;
    viewX = targetViewX;
    viewY = targetViewY;
    viewAngle = targetViewAngle;
    applyCamera();
    refineCameraToTitle(el);

    viewX = savedViewX;
    viewY = savedViewY;
    viewAngle = savedViewAngle;
    applyCamera();
    clampView();
  }

  function snapCameraToTitle(el: HTMLElement | null) {
    if (!el) return;
    setCameraTargetForSection(el);
    viewX = targetViewX;
    viewY = targetViewY;
    viewAngle = targetViewAngle;
    applyCamera();
    clampView();
  }

  function pinInitialView() {
    if (scrollAnchors.length === 0) return;

    scrollDriving = true;
    scrollProgress = 0;
    cameraGlide = false;
    clearFocus();

    suppressScrollCamera = true;
    window.scrollTo(0, scrollTrack.offsetTop);
    requestAnimationFrame(() => {
      suppressScrollCamera = false;
    });

    snapCameraToTitle(scrollAnchors[0]?.el ?? null);
    syncedSectionIndex = 0;
    updateMap();
  }

  function syncCameraFromScroll() {
    if (isNarrowViewport() && !userHasNavigated) {
      pinInitialView();
      return;
    }

    // Route navigation reads at natural size.
    targetZoom = 1;
    scrollProgress = getScrollProgress();
    if (isNarrowViewport()) {
      scrollProgress = progressFromSectionIndex(
        sectionIndexFromProgress(scrollProgress),
      );
    }
    const activeEl = activeScrollElement();
    const activeIndex = activeEl
      ? scrollAnchors.findIndex((anchor) => anchor.el === activeEl)
      : -1;
    const sectionChanged =
      activeIndex >= 0 && activeIndex !== syncedSectionIndex;

    if (cameraGlide && sectionChanged) {
      setCameraTargetForSection(activeEl);
      syncedSectionIndex = activeIndex;
    } else if (!cameraGlide) {
      setCameraTargetForSection(activeEl);
      if (isNarrowViewport()) {
        if (!isCameraInteracting()) {
          viewX = targetViewX;
          viewY = targetViewY;
          viewAngle = targetViewAngle;
        }
      } else if (sectionChanged) {
        cameraGlide = true;
      }
      if (activeIndex >= 0) syncedSectionIndex = activeIndex;
    }
    clampView();
  }

  function cameraLerpRate() {
    if (touchScroll?.scrolling) return 1;
    if (cameraGlide) return CAMERA_LERP_GLIDE;
    if (isNarrowViewport() && !isCameraInteracting()) return 1;
    if (!isNarrowViewport()) return CAMERA_LERP;
    if (isCameraInteracting()) return CAMERA_LERP;
    return 1;
  }

  function angleLerpRate() {
    if (touchScroll?.scrolling) return 1;
    if (cameraGlide) return ANGLE_LERP_GLIDE;
    if (isNarrowViewport() && !isCameraInteracting()) return 1;
    if (!isNarrowViewport()) return ANGLE_LERP;
    if (isCameraInteracting()) return ANGLE_LERP;
    return 1;
  }

  function settleCameraGlide() {
    if (!cameraGlide) return;
    const settled =
      Math.hypot(targetViewX - viewX, targetViewY - viewY) < 0.75 &&
      Math.abs(targetViewAngle - viewAngle) < 0.003;
    if (!settled) return;
    viewX = targetViewX;
    viewY = targetViewY;
    viewAngle = targetViewAngle;
    cameraGlide = false;
  }

  function onScroll() {
    if (focusEl || pan || suppressScrollCamera) return;
    if (isNarrowViewport() && !userHasNavigated) return;
    wheelPivot = null;
    scrollDriving = true;
    syncCameraFromScroll();
  }

  function applyCamera() {
    const { x: ax, y: ay } = cameraViewportAnchor();
    world.style.transform = `translate(${ax}px, ${ay}px) scale(${zoom}) rotate(${viewAngle}rad) translate(${-ax - viewX}px, ${-ay - viewY}px)`;
    updateScaleIndicator();
  }

  function minZoomLevel() {
    if (worldWidth <= 0 || worldHeight <= 0) return MIN_ZOOM_FLOOR;
    return Math.max(
      MIN_ZOOM_FLOOR,
      Math.min(1, Math.max(viewportWidth / worldWidth, viewportHeight / worldHeight)),
    );
  }

  function ensureWorldFitsViewTarget() {
    const minWidth = Math.ceil(targetViewX + viewportWidth / targetZoom + PAD);
    const minHeight = Math.ceil(targetViewY + viewportHeight / targetZoom + PAD);

    if (minWidth > worldWidth) {
      worldWidth = minWidth;
      world.style.width = `${worldWidth}px`;
    }
    if (minHeight > worldHeight) {
      worldHeight = minHeight;
      world.style.height = `${worldHeight}px`;
    }
  }

  function clampView() {
    ensureWorldFitsViewTarget();
    const maxX = Math.max(0, worldWidth - viewportWidth / zoom);
    const maxY = Math.max(0, worldHeight - viewportHeight / zoom);
    viewX = Math.min(maxX, Math.max(0, viewX));
    viewY = Math.min(maxY, Math.max(0, viewY));
    const tMaxX = Math.max(0, worldWidth - viewportWidth / targetZoom);
    const tMaxY = Math.max(0, worldHeight - viewportHeight / targetZoom);
    targetViewX = Math.min(tMaxX, Math.max(0, targetViewX));
    targetViewY = Math.min(tMaxY, Math.max(0, targetViewY));
  }

  function focusCamera(el: HTMLElement, animate = false) {
    const slot = slots.get(slotKey(el));
    if (!slot) return;

    focusEl = el;
    // Zoom back in far enough to read the node.
    targetZoom = Math.max(1, targetZoom);
    setCameraTargetCentered(el);
    const focusIndex = scrollAnchors.findIndex((anchor) => anchor.el === el);
    if (focusIndex >= 0) syncedSectionIndex = focusIndex;
    if (animate) {
      cameraGlide = true;
    } else {
      cameraGlide = false;
      viewX = targetViewX;
      viewY = targetViewY;
      viewAngle = targetViewAngle;
      zoom = targetZoom;
    }
    clampView();
  }

  function clearFocus() {
    focusEl = null;
    wheelPivot = null;
    targetViewAngle = nearestAngle(0, viewAngle);
  }

  function openSectionCount() {
    return sectionEls.length;
  }

  function readHeaderAlign() {
    const root = getComputedStyle(document.documentElement);
    const fromCss = parseFloat(root.getPropertyValue("--header-align"));
    if (!Number.isNaN(fromCss) && fromCss > 0) return fromCss;

    const contentMax = parseFloat(root.getPropertyValue("--content-max")) || 900;
    const gutter = parseFloat(root.getPropertyValue("--page-gutter")) || 96;
    return Math.max(0, (viewportWidth - contentMax) / 2) + gutter;
  }

  function clampSlotPosition(slot: ScatterSlot) {
    const openCount = openSectionCount();
    for (let pass = 0; pass < 10; pass++) {
      const ext = rotatedExtents(slot, openCount, totalSections);
      let dx = 0;
      let dy = 0;

      // Rotate-aware clamp: keep cards within the world bounds,
      // but don't "re-align" based on rotated extents vs. headerAlign
      // (that can push some headers too far right).
      if (ext.minX < PAD) dx = PAD - ext.minX;
      if (ext.maxX > worldWidth - PAD) dx = worldWidth - PAD - ext.maxX;
      if (ext.minY < TOP_PAD) dy = TOP_PAD - ext.minY;
      if (ext.maxY > worldHeight - PAD) dy = worldHeight - PAD - ext.maxY;

      if (dx === 0 && dy === 0) break;
      slot.x += dx;
      slot.y += dy;
    }
  }

  function fitSectionsInContainer() {
    const containerTop = container.getBoundingClientRect().top;
    let pushDown = 0;

    for (const el of sectionEls) {
      const top = el.getBoundingClientRect().top;
      if (top < containerTop) {
        pushDown = Math.max(pushDown, containerTop - top);
      }
    }

    if (pushDown <= 0) return false;

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot) continue;
      slot.y += pushDown;
      clampSlotPosition(slot);
      applySectionTransform(el, slot, openSectionCount(), totalSections);
    }

    resolveAllOverlaps();
    return true;
  }

  function slotExtents(slot: ScatterSlot, openCount: number) {
    return rotatedExtents(slot, openCount, totalSections);
  }

  function aabbOverlap(a: ScatterSlot, b: ScatterSlot, gap = avoidGap) {
    const openCount = openSectionCount();
    const ea = slotExtents(a, openCount);
    const eb = slotExtents(b, openCount);
    return !(
      ea.maxX + gap <= eb.minX ||
      eb.maxX + gap <= ea.minX ||
      ea.maxY + gap <= eb.minY ||
      eb.maxY + gap <= ea.minY
    );
  }

  function pairOverlapDepth(
    a: ScatterSlot,
    b: ScatterSlot,
    openCount: number,
    gap = avoidGap,
  ) {
    const ea = slotExtents(a, openCount);
    const eb = slotExtents(b, openCount);
    const overlapX = Math.min(ea.maxX, eb.maxX) - Math.max(ea.minX, eb.minX) + gap;
    const overlapY = Math.min(ea.maxY, eb.maxY) - Math.max(ea.minY, eb.minY) + gap;
    if (overlapX <= 0 || overlapY <= 0) return null;

    return {
      ea,
      eb,
      overlapX,
      overlapY,
    };
  }

  function nudgeSlotAway(
    slot: ScatterSlot,
    other: ScatterSlot,
    openCount: number,
  ) {
    const depth = pairOverlapDepth(slot, other, openCount);
    if (!depth) return false;

    const { ea, eb, overlapX, overlapY } = depth;
    const centerA = {
      x: (ea.minX + ea.maxX) / 2,
      y: (ea.minY + ea.maxY) / 2,
    };
    const centerB = {
      x: (eb.minX + eb.maxX) / 2,
      y: (eb.minY + eb.maxY) / 2,
    };

    if (overlapX <= overlapY) {
      const dir = centerA.x >= centerB.x ? 1 : -1;
      slot.x += dir * overlapX;
    } else {
      const dir = centerA.y >= centerB.y ? 1 : -1;
      slot.y += dir * overlapY;
    }

    return true;
  }

  // Symmetric variant: push both slots apart by half the overlap so
  // dense clusters relax instead of ping-ponging a single slot.
  function nudgeSlotsApart(
    a: ScatterSlot,
    b: ScatterSlot,
    openCount: number,
  ) {
    const depth = pairOverlapDepth(a, b, openCount);
    if (!depth) return false;

    const { ea, eb, overlapX, overlapY } = depth;
    const centerA = {
      x: (ea.minX + ea.maxX) / 2,
      y: (ea.minY + ea.maxY) / 2,
    };
    const centerB = {
      x: (eb.minX + eb.maxX) / 2,
      y: (eb.minY + eb.maxY) / 2,
    };

    if (overlapX <= overlapY) {
      const dir = centerA.x >= centerB.x ? 1 : -1;
      a.x += (dir * overlapX) / 2;
      b.x -= (dir * overlapX) / 2;
    } else {
      const dir = centerA.y >= centerB.y ? 1 : -1;
      a.y += (dir * overlapY) / 2;
      b.y -= (dir * overlapY) / 2;
    }

    return true;
  }

  function ensureWorldFitsSlots(openCount: number) {
    let maxX = PAD;
    let maxY = TOP_PAD;

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot || slot.w <= 0 || slot.h <= 0) continue;
      const ext = slotExtents(slot, openCount);
      maxX = Math.max(maxX, ext.maxX + PAD);
      maxY = Math.max(maxY, ext.maxY + PAD);
    }

    if (maxX > worldWidth) {
      worldWidth = maxX;
      world.style.width = `${worldWidth}px`;
    }
    if (maxY > worldHeight) {
      worldHeight = maxY;
      world.style.height = `${worldHeight}px`;
    }
  }

  function enforceMinBounds(openCount: number) {
    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot) continue;
      const ext = slotExtents(slot, openCount);
      if (ext.minX < PAD) slot.x += PAD - ext.minX;
      if (ext.minY < TOP_PAD) slot.y += TOP_PAD - ext.minY;
    }
  }

  function countOverlaps(openCount: number) {
    let count = 0;

    for (let i = 0; i < sectionEls.length; i++) {
      const slotA = slots.get(slotKey(sectionEls[i]));
      if (!slotA || slotA.w <= 0 || slotA.h <= 0) continue;

      for (let j = i + 1; j < sectionEls.length; j++) {
        const slotB = slots.get(slotKey(sectionEls[j]));
        if (!slotB || slotB.w <= 0 || slotB.h <= 0) continue;
        if (aabbOverlap(slotA, slotB)) count++;
      }
    }

    return count;
  }

  function resolveSlotAgainstPlaced(
    slot: ScatterSlot,
    placed: ScatterSlot[],
    openCount: number,
  ) {
    for (const other of placed) {
      let guard = 0;
      while (aabbOverlap(slot, other) && guard < PLACE_NUDGE_LIMIT) {
        nudgeSlotAway(slot, other, openCount);
        enforceMinBounds(openCount);
        ensureWorldFitsSlots(openCount);
        guard++;
      }
    }
  }

  function resolveAllOverlaps() {
    const openCount = openSectionCount();

    for (let iter = 0; iter < OVERLAP_MAX_ITERATIONS; iter++) {
      let moved = false;

      for (let i = 0; i < sectionEls.length; i++) {
        const slotA = slots.get(slotKey(sectionEls[i]));
        if (!slotA || slotA.w <= 0 || slotA.h <= 0) continue;

        for (let j = 0; j < i; j++) {
          const slotB = slots.get(slotKey(sectionEls[j]));
          if (!slotB || slotB.w <= 0 || slotB.h <= 0) continue;
          if (nudgeSlotsApart(slotA, slotB, openCount)) moved = true;
        }
      }

      enforceMinBounds(openCount);
      ensureWorldFitsSlots(openCount);

      if (!moved || countOverlaps(openCount) === 0) break;
    }

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot) continue;
      applySectionTransform(el, slot, openCount, totalSections);
    }
  }

  function scatterSlot(slot: ScatterSlot) {
    const minX = PAD;
    const maxX = Math.max(minX, worldWidth - slot.w - PAD);
    const spreadX = Math.max(0, maxX - minX);
    slot.x = minX + Math.round(slot.rx * spreadX);

    const minY = TOP_PAD;
    const maxY = Math.max(minY, worldHeight - slot.h - PAD);
    const spreadY = Math.max(0, maxY - minY);
    slot.y = minY + Math.round(slot.ry * spreadY);
  }

  function packSections() {
    const openCount = openSectionCount();
    const placed: ScatterSlot[] = [];
    let maxBottom = TOP_PAD;

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot || slot.w <= 0 || slot.h <= 0) continue;

      scatterSlot(slot);
      resolveSlotAgainstPlaced(slot, placed, openCount);
      enforceMinBounds(openCount);
      ensureWorldFitsSlots(openCount);
      applySectionTransform(el, slot, openCount, totalSections);

      placed.push(slot);
      maxBottom = Math.max(maxBottom, slotExtents(slot, openCount).maxY);
    }

    resolveAllOverlaps();

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot) continue;
      maxBottom = Math.max(maxBottom, slotExtents(slot, openCount).maxY);
    }

    return maxBottom + PAD;
  }

  function layout() {
    const measured = readViewportSize();
    viewportWidth = measured.w;
    viewportHeight = measured.h;
    headerAlign = readHeaderAlign();
    worldWidth = Math.max(
      viewportWidth * WORLD_WIDTH_RATIO,
      Math.round(viewportWidth * (WORLD_WIDTH_RATIO - 0.4)),
    );

    container.style.height = `${viewportHeight}px`;
    world.style.width = `${worldWidth}px`;

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot) continue;

      if (nodeMode) {
        // Nodes size to their own text (capped in CSS).
        el.style.width = "";
      } else {
        const cardWidth = Math.min(worldWidth - PAD * 2, CARD_MAX_OPEN);
        el.style.width = `${cardWidth}px`;
      }
      el.style.left = "0";
      el.style.top = "0";

      const ew = el.offsetWidth;
      const eh = el.offsetHeight;
      slot.w = ew;
      slot.h = eh;
      syncOpenStyles(el, focusEl);
    }

    const stackedHeight = sectionEls.reduce((sum, el) => {
      const slot = slots.get(slotKey(el));
      return sum + (slot?.h ?? 0) + avoidGap;
    }, TOP_PAD);
    worldHeight = Math.max(viewportHeight * 1.6, stackedHeight * 0.72);
    world.style.height = `${worldHeight}px`;

    const packedHeight = packSections();
    worldHeight = Math.max(worldHeight, packedHeight);
    world.style.height = `${worldHeight}px`;

    packSections();

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot) continue;
      applySectionTransform(el, slot, openSectionCount(), totalSections);
    }

    applyCamera();
    if (fitSectionsInContainer()) {
      resolveAllOverlaps();
    }

    rebuildAnchors();
    updateScrollTrack();

    if (focusEl) {
      setCameraTargetCentered(focusEl);
      if (!cameraGlide) {
        viewX = targetViewX;
        viewY = targetViewY;
        viewAngle = targetViewAngle;
        applyCamera();
      }
    } else if (scrollDriving) {
      if (isNarrowViewport() && !userHasNavigated) {
        pinInitialView();
      } else {
        syncCameraFromScroll();
      }
    }

    clampView();
    applyCamera();
    updateMap();
  }

  function hitSection(clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!(target instanceof Element) || !world.contains(target)) return null;
    return target.closest<HTMLElement>(".work-section");
  }

  // Midpoint + finger spread of the two active touches, in coords
  // relative to the container (same space as screenToWorld).
  function pinchGeometry() {
    const rect = container.getBoundingClientRect();
    const [a, b] = [...activeTouches.values()];
    const mx = (a.x + b.x) / 2 - rect.left;
    const my = (a.y + b.y) / 2 - rect.top;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx, my };
  }

  function startPinch() {
    touchScroll = null;
    wheelPivot = null;
    clearFocus();
    scrollDriving = false;
    cameraGlide = false;
    const { dist, mx, my } = pinchGeometry();
    const wpt = screenToWorld(mx, my);
    pinch = { startDist: dist, startZoom: zoom, pivotX: wpt.x, pivotY: wpt.y };
  }

  function updatePinch() {
    if (!pinch) return;
    const { dist, mx, my } = pinchGeometry();
    if (pinch.startDist <= 0) return;
    const next = Math.min(
      MAX_ZOOM,
      Math.max(minZoomLevel(), (pinch.startZoom * dist) / pinch.startDist),
    );
    zoom = targetZoom = next;
    // Keep the pinched world point under the current finger midpoint.
    const view = viewForWorldAtScreen(pinch.pivotX, pinch.pivotY, mx, my, next);
    viewX = targetViewX = view.viewX;
    viewY = targetViewY = view.viewY;
    clampView();
    applyCamera();
    updateMap();
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === "touch") {
      activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouches.size >= 2) {
        startPinch();
        event.preventDefault();
        return;
      }

      if (!shouldHandleTouchScroll(event)) return;

      touchScroll = {
        startX: event.clientX,
        startY: event.clientY,
        progress0: getScrollProgress(),
        sectionIndex0: sectionIndexFromProgress(getScrollProgress()),
        scrolling: false,
      };
      event.preventDefault();
      return;
    }

    if (hitSection(event.clientX, event.clientY)) return;

    pan = {
      startX: event.clientX,
      startY: event.clientY,
      viewX0: viewX,
      viewY0: viewY,
    };
    wheelPivot = null;
    container.classList.add("works--panning");
    clearFocus();
    scrollDriving = false;
    container.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerType === "touch" && activeTouches.has(event.pointerId)) {
      activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch) {
      updatePinch();
      event.preventDefault();
      return;
    }

    if (touchScroll && event.pointerType === "touch") {
      const dy = touchScroll.startY - event.clientY;
      const dx = touchScroll.startX - event.clientX;

      if (!touchScroll.scrolling) {
        const dist = Math.hypot(dx, dy);
        if (dist > touchScrollThreshold()) {
          touchScroll.scrolling = Math.abs(dy) >= Math.abs(dx);
        }
      }

      if (touchScroll.scrolling) {
        event.preventDefault();
        if (!isNarrowViewport()) {
          clearFocus();
          cameraGlide = false;
          scrollDriving = true;
          applyScrollProgress(touchScroll.progress0 + dy / scrollRange());
          applyCamera();
          updateMap();
        }
      }
      return;
    }

    if (!pan) return;

    viewX = pan.viewX0 - (event.clientX - pan.startX);
    viewY = pan.viewY0 - (event.clientY - pan.startY);
    targetViewX = viewX;
    targetViewY = viewY;
    clampView();
    applyCamera();
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent) {
    if (event.pointerType === "touch") {
      activeTouches.delete(event.pointerId);
      if (pinch) {
        if (activeTouches.size < 2) pinch = null;
        event.preventDefault();
        return;
      }
    }

    if (touchScroll && event.pointerType === "touch") {
      if (touchScroll.scrolling) {
        event.preventDefault();
        const dy = touchScroll.startY - event.clientY;

        if (isNarrowViewport()) {
          let targetIndex = touchScroll.sectionIndex0;
          if (dy < -SWIPE_SECTION_THRESHOLD) {
            targetIndex += 1;
          } else if (dy > SWIPE_SECTION_THRESHOLD) {
            targetIndex -= 1;
          }
          navigateToSectionIndex(
            targetIndex,
            targetIndex !== touchScroll.sectionIndex0,
          );
        } else {
          const progress = touchScroll.progress0 + dy / scrollRange();
          navigateToSectionIndex(sectionIndexFromProgress(progress), false);
        }
      }
      touchScroll = null;
      return;
    }

    if (pan) {
      pan = null;
      container.classList.remove("works--panning");
      try {
        container.releasePointerCapture(event.pointerId);
      } catch {
        /* noop */
      }
      event.preventDefault();
    }
  }

  // Wheel = zoom in/out, pivoting on the world point under the cursor.
  function onWheel(event: WheelEvent) {
    event.preventDefault();

    markUserNavigated();
    scrollDriving = false;

    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
    const next = Math.min(
      MAX_ZOOM,
      Math.max(minZoomLevel(), targetZoom * factor),
    );
    if (Math.abs(next - targetZoom) < 1e-6) return;

    // A focused work stays pinned at the viewport center while zooming;
    // the loop re-centers it each frame (see below).
    if (focusEl) {
      targetZoom = next;
      return;
    }

    const rect = container.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    // Reuse the pivot while a zoom is still animating so successive
    // wheel ticks compound around the same world point.
    const pivot =
      wheelPivot && Math.abs(wheelPivot.sx - sx) < 2 && Math.abs(wheelPivot.sy - sy) < 2
        ? { x: wheelPivot.wx, y: wheelPivot.wy }
        : screenToWorld(sx, sy);
    wheelPivot = { wx: pivot.x, wy: pivot.y, sx, sy };

    targetZoom = next;
    const view = viewForWorldAtScreen(pivot.x, pivot.y, sx, sy, targetZoom);
    targetViewX = view.viewX;
    targetViewY = view.viewY;
    targetViewAngle = viewAngle;
    clampView();
  }

  function loop() {
    const interacting = isCameraInteracting();

    if (focusEl && !cameraGlide) {
      const slot = slots.get(slotKey(focusEl));
      if (slot) targetViewAngle = nearestAngle(-displayRot(slot), viewAngle);
    } else if (scrollDriving && interacting && !touchScroll?.scrolling) {
      scrollProgress = getScrollProgress();
      setCameraTargetForSection(activeScrollElement());
      clampView();
    }

    const cameraLerp = cameraLerpRate();
    const angleLerp = angleLerpRate();

    viewX += (targetViewX - viewX) * cameraLerp;
    viewY += (targetViewY - viewY) * cameraLerp;
    viewAngle += (targetViewAngle - viewAngle) * angleLerp;
    zoom += (targetZoom - zoom) * ZOOM_LERP;
    // Lock a focused work to the viewport center at the *current* zoom so
    // zooming pivots exactly on it (zoom and pan lerp at different rates).
    if (focusEl && !cameraGlide) {
      const slot = slots.get(slotKey(focusEl));
      if (slot) {
        const cam = cameraCenteredOnSlot(slot, zoom);
        viewX = targetViewX = cam.viewX;
        viewY = targetViewY = cam.viewY;
      }
    } else if (wheelPivot) {
      // Same trick for wheel zoom: keep the zoomed world point pinned
      // under the cursor through the whole animation.
      const v = viewForWorldAtScreen(
        wheelPivot.wx,
        wheelPivot.wy,
        wheelPivot.sx,
        wheelPivot.sy,
        zoom,
      );
      viewX = targetViewX = v.viewX;
      viewY = targetViewY = v.viewY;
      if (Math.abs(targetZoom - zoom) < 0.001) wheelPivot = null;
    }
    clampView();
    settleCameraGlide();
    applyCamera();
    updateMap();

    raf = requestAnimationFrame(loop);
  }

  layout();
  pinInitialView();
  loop();

  let timer = 0;
  const scheduleLayout = () => {
    if (touchScroll?.scrolling) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(layout, 120);
  };

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (userHasNavigated) return;
      layout();
      pinInitialView();
    });
  }

  // Focusing a node's button makes the browser scroll the
  // overflow:hidden container; the camera owns positioning, so pin it.
  const onContainerScroll = () => {
    if (container.scrollLeft !== 0) container.scrollLeft = 0;
    if (container.scrollTop !== 0) container.scrollTop = 0;
  };
  container.addEventListener("scroll", onContainerScroll);

  mapFrame?.addEventListener("click", onMapFrameClick);
  mapRoute?.addEventListener("click", onMapRouteClick);

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(container);
  window.addEventListener("resize", scheduleLayout);
  window.addEventListener("scroll", onScroll, { passive: true });

  return () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    resizeObserver.disconnect();
    window.removeEventListener("resize", scheduleLayout);
    window.removeEventListener("scroll", onScroll);
    scrollTrack.remove();
    scaleIndicator.remove();
    window.clearTimeout(searchTimer);
    searchWrap.remove();
    container.removeEventListener("click", onImageActivate, true);
    for (const marker of mapMarkers.values()) {
      marker.remove();
    }
    mapMarkers.clear();
    container.removeEventListener("scroll", onContainerScroll);
    mapFrame?.removeEventListener("click", onMapFrameClick);
    mapRoute?.removeEventListener("click", onMapRouteClick);
    for (const unsub of summaryUnsubs) unsub();
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerUp);
    container.removeEventListener("wheel", onWheel);
    container.classList.remove("works--scatter", "works--panning");
    container.style.height = "";
    world.style.transform = "";
    worldRoutePath.setAttribute("d", "");
    worldRoutePoints.replaceChildren();
    if (world.parentElement === container) {
      while (world.firstChild) container.appendChild(world.firstChild);
      world.remove();
    }
    mapRoutePoints.replaceChildren();
    mapContent.remove();
    if (mapRoute && mapRoutePath.parentElement !== mapRoute) {
      mapRoute.appendChild(mapRoutePath);
    }
    mapRoutePath.removeAttribute("d");
    mapRoute?.removeAttribute("viewBox");
    if (mapRoute) {
      mapRoute.style.transform = "";
    }
    for (const el of sectionEls) {
      el.style.position = "";
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.transform = "";
      el.style.zIndex = "";
    }
  };
}
