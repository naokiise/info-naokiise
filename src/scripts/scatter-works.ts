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
const MAP_LABEL_FONT_SCALE = 20;
const MAP_CATEGORY_CIRCLE_PX = 8;
const GRAPHIC_DESIGN_KEY = "work-graphic-design";
const GRAPHIC_DESIGN_OPEN_Y_RATIO = 0.78;

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
  let targetViewX = 0;
  let targetViewY = 0;
  let targetViewAngle = 0;
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

  const summaryUnsubs: Array<() => void> = [];

  function slotKey(el: HTMLElement) {
    return el.id || el.querySelector(".work-section__title")?.textContent || "";
  }

  sectionEls.forEach((el, index) => {
    const key = slotKey(el);
    const spread = totalSections <= 1 ? 0.5 : index / (totalSections - 1);
    const rx = Math.min(
      1,
      Math.max(0, spread + (Math.random() - 0.5) * 0.24),
    );
    slots.set(key, {
      rx,
      ry:
        key === GRAPHIC_DESIGN_KEY
          ? 0.45 + Math.random() * 0.4
          : Math.random(),
      rot: Math.random() * Math.PI * 2,
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
    targetViewAngle = 0;
    cameraGlide = true;
    clampView();
    updateMap();
  }

  function summaryAnchorLocal(el: HTMLElement) {
    const summary = el.querySelector<HTMLElement>(".work-section__summary");
    if (!summary) return { x: 12, y: 26 };

    const title = summary.querySelector<HTMLElement>(".work-section__title");
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
    const dx = sx - ax;
    const dy = sy - ay;
    const cos = Math.cos(-viewAngle);
    const sin = Math.sin(-viewAngle);

    return {
      x: dx * cos - dy * sin + ax + viewX,
      y: dx * sin + dy * cos + ay + viewY,
    };
  }

  function viewForWorldAtScreen(wx: number, wy: number, sx: number, sy: number) {
    const { x: ax, y: ay } = cameraViewportAnchor();
    const cos = Math.cos(viewAngle);
    const sin = Math.sin(viewAngle);
    const dx = sx - ax;
    const dy = sy - ay;
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
    let vbW = viewportWidth * MAP_VIEW_PAD;
    let vbH = viewportHeight * MAP_VIEW_PAD;

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
    return (MAP_CATEGORY_CIRCLE_PX / 2) * scale;
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

        const circle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        circle.setAttribute("cx", "0");
        circle.setAttribute("cy", "0");
        circle.setAttribute("r", String(circleR));
        circle.classList.add("works-map__route-point");

        if (isFocus) {
          circle.classList.add("works-map__route-point--focus");
        } else if (isActive) {
          circle.classList.add("works-map__route-point--active");
        }

        pointGroup.appendChild(circle);
        appendMapLabelBesideCircle(
          pointGroup,
          sectionTitle(point.el),
          circleR,
          pointIndex + 1,
        );
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
      mapRoutePath.setAttribute("d", d);
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
    scrollTrack.style.height = `${steps * SCROLL_STEP_VH * 100}vh`;
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
    const title = summary.querySelector<HTMLElement>(".work-section__title");
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

  function setCameraTargetForSection(el: HTMLElement | null) {
    if (!el) return;

    const slot = slots.get(slotKey(el));
    if (!slot) return;

    const angle = -displayRot(slot);
    const cam = cameraAtSlot(slot, el);
    const savedViewX = viewX;
    const savedViewY = viewY;
    const savedViewAngle = viewAngle;

    targetViewAngle = angle;
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
    scrollDriving = true;
    syncCameraFromScroll();
  }

  function applyCamera() {
    const { x: ax, y: ay } = cameraViewportAnchor();
    world.style.transform = `translate(${ax}px, ${ay}px) rotate(${viewAngle}rad) translate(${-ax - viewX}px, ${-ay - viewY}px)`;
  }

  function ensureWorldFitsViewTarget() {
    const minWidth = Math.ceil(targetViewX + viewportWidth + PAD);
    const minHeight = Math.ceil(targetViewY + viewportHeight + PAD);

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
    const maxX = Math.max(0, worldWidth - viewportWidth);
    const maxY = Math.max(0, worldHeight - viewportHeight);
    viewX = Math.min(maxX, Math.max(0, viewX));
    viewY = Math.min(maxY, Math.max(0, viewY));
    targetViewX = Math.min(maxX, Math.max(0, targetViewX));
    targetViewY = Math.min(maxY, Math.max(0, targetViewY));
  }

  function focusCamera(el: HTMLElement, animate = false) {
    const slot = slots.get(slotKey(el));
    if (!slot) return;

    focusEl = el;
    setCameraTargetForSection(el);
    const focusIndex = scrollAnchors.findIndex((anchor) => anchor.el === el);
    if (focusIndex >= 0) syncedSectionIndex = focusIndex;
    if (animate) {
      cameraGlide = true;
    } else {
      cameraGlide = false;
      viewX = targetViewX;
      viewY = targetViewY;
      viewAngle = targetViewAngle;
    }
    clampView();
  }

  function clearFocus() {
    focusEl = null;
    targetViewAngle = 0;
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

  function aabbOverlap(a: ScatterSlot, b: ScatterSlot, gap = AVOID_GAP) {
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
    gap = AVOID_GAP,
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
          if (nudgeSlotAway(slotA, slotB, openCount)) moved = true;
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

      const cardWidth = Math.min(worldWidth - PAD * 2, CARD_MAX_OPEN);

      el.style.width = `${cardWidth}px`;
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
      return sum + (slot?.h ?? 0) + AVOID_GAP;
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
      if (!cameraGlide) {
        snapCameraToTitle(focusEl);
      } else {
        setCameraTargetForSection(focusEl);
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

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === "touch") {
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
    clearFocus();
    scrollDriving = false;
    container.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
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
      try {
        container.releasePointerCapture(event.pointerId);
      } catch {
        /* noop */
      }
      event.preventDefault();
    }
  }

  function onWheel(event: WheelEvent) {
    if (focusEl) {
      viewX += event.deltaX;
      viewY += event.deltaY;
      targetViewX = viewX;
      targetViewY = viewY;
      clampView();
      applyCamera();
      event.preventDefault();
      return;
    }

    markUserNavigated();
    window.scrollBy({ top: event.deltaY, left: event.deltaX });
    scrollDriving = true;
    syncCameraFromScroll();
    event.preventDefault();
  }

  function loop() {
    const interacting = isCameraInteracting();

    if (focusEl && !cameraGlide) {
      const slot = slots.get(slotKey(focusEl));
      if (slot) targetViewAngle = -displayRot(slot);
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
    for (const marker of mapMarkers.values()) {
      marker.remove();
    }
    mapMarkers.clear();
    mapFrame?.removeEventListener("click", onMapFrameClick);
    mapRoute?.removeEventListener("click", onMapRouteClick);
    for (const unsub of summaryUnsubs) unsub();
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerUp);
    container.removeEventListener("wheel", onWheel);
    container.classList.remove("works--scatter");
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
