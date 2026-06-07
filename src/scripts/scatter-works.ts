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
const AVOID_GAP = 112;
const OVERLAP_MAX_ITERATIONS = 320;
const PLACE_NUDGE_LIMIT = 96;
const WORLD_WIDTH_RATIO = 2.6;
const SCROLL_STEP_VH = 1;
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
      const onSummaryClick = () => {
        scrollDriving = false;
        requestAnimationFrame(() => {
          layout();
          for (const section of sectionEls) {
            syncOpenStyles(section, el);
          }
          focusCamera(el);
          updateMap();
        });
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

  function activateSectionFromMap(el: HTMLElement) {
    scrollDriving = false;
    requestAnimationFrame(() => {
      layout();
      for (const section of sectionEls) {
        syncOpenStyles(section, el);
      }
      focusCamera(el);
      updateMap();
    });
  }

  function onMapFrameClick(event: MouseEvent) {
    if (!mapFrame || worldWidth <= 0 || worldHeight <= 0) return;
    if (event.target instanceof Element && event.target.closest(".works-map__marker")) {
      return;
    }

    const rect = mapFrame.getBoundingClientRect();
    const { x: worldX, y: worldY } = mapFrameToWorld(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );

    clearFocus();
    scrollDriving = false;
    targetViewX = worldX - viewportWidth / 2;
    targetViewY = worldY - viewportHeight / 2;
    viewX = targetViewX;
    viewY = targetViewY;
    targetViewAngle = 0;
    viewAngle = 0;
    clampView();
    applyCamera();
    updateMap();
  }

  function categoryAnchorPoint(slot: ScatterSlot) {
    const rot = displayRot(slot);
    const pivotX = slot.w / 2;
    const pivotY = slot.h / 2;
    const localX = 12;
    const localY = 26;
    const dx = localX - pivotX;
    const dy = localY - pivotY;
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

  const MAP_VIEW_PAD = 1.75;

  function mapCameraCenter() {
    return {
      x: viewX + viewportWidth / 2,
      y: viewY + viewportHeight / 2,
    };
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
    const cam = mapCameraCenter();
    const camCx = cam.x;
    const camCy = cam.y;

    if (frameW <= 0 || frameH <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
      return { x: 0, y: 0, w: worldWidth, h: worldHeight, frameW, frameH };
    }

    const aspect = frameW / frameH;
    let vbW = viewportWidth * MAP_VIEW_PAD;
    let vbH = viewportHeight * MAP_VIEW_PAD;
    const currentAspect = vbW / vbH;

    if (currentAspect > aspect) {
      vbH = vbW / aspect;
    } else {
      vbW = vbH * aspect;
    }

    return {
      x: camCx - vbW / 2,
      y: camCy - vbH / 2,
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

  function syncRoutePoints(
    group: SVGGElement,
    points: SectionAnchor[],
    activeEl: HTMLElement | null,
    forMap = false,
  ) {
    group.replaceChildren();

    for (const point of points) {
      const pointGroup = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g",
      );
      const isFocus = point.el === focusEl;
      const isActive = point.el === activeEl;

      if (isFocus) {
        pointGroup.classList.add("works-map__route-node--focus");
      } else if (isActive) {
        pointGroup.classList.add("works-map__route-node--active");
      }

      if (forMap) {
        const deg = (point.rot * 180) / Math.PI;
        pointGroup.setAttribute(
          "transform",
          `translate(${point.x + point.w / 2} ${point.y + point.h / 2}) rotate(${deg}) translate(${-point.w / 2} ${-point.h / 2})`,
        );

        const rect = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect",
        );
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(point.w));
        rect.setAttribute("height", String(point.h));
        rect.classList.add("works-map__route-point");

        if (isFocus) {
          rect.classList.add("works-map__route-point--focus");
        } else if (isActive) {
          rect.classList.add("works-map__route-point--active");
        }

        const title = sectionTitle(point.el);
        const label = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        const labelSize = Math.min(
          16,
          Math.max(6, (Math.min(point.w, point.h) * 0.72) / Math.max(title.length, 1)),
        );
        label.setAttribute("x", String(point.w / 2));
        label.setAttribute("y", String(point.h / 2));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "middle");
        label.setAttribute("font-size", String(labelSize));
        label.classList.add("works-map__route-label");
        label.textContent = title;

        pointGroup.appendChild(rect);
        pointGroup.appendChild(label);
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
    if (scrollDriving) return getScrollProgress();
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

  function updateMap() {
    if (!mapFrame || worldWidth <= 0 || worldHeight <= 0) return;

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

        const { cx, cy } = categoryAnchorPoint(slot);
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

  function getScrollProgress(): number {
    const range = Math.max(
      1,
      scrollTrack.offsetHeight - viewportHeight,
    );
    const y = window.scrollY - scrollTrack.offsetTop;
    return Math.min(1, Math.max(0, y / range));
  }

  function cameraViewportAnchor() {
    return { x: headerAlign, y: TOP_PAD };
  }

  function cameraAtScrollProgress(p: number) {
    const anchor = cameraViewportAnchor();

    if (scrollAnchors.length === 0) {
      return { viewX: 0, viewY: 0, angle: 0 };
    }
    if (scrollAnchors.length === 1) {
      const a = scrollAnchors[0];
      return {
        viewX: a.cx - anchor.x,
        viewY: a.cy - anchor.y,
        angle: -a.rot,
      };
    }

    const pos = p * (scrollAnchors.length - 1);
    const i = Math.min(scrollAnchors.length - 2, Math.floor(pos));
    const t = pos - i;
    const a = scrollAnchors[i];
    const b = scrollAnchors[i + 1];

    return {
      viewX: a.cx + (b.cx - a.cx) * t - anchor.x,
      viewY: a.cy + (b.cy - a.cy) * t - anchor.y,
      angle: -(a.rot + (b.rot - a.rot) * t),
    };
  }

  function syncCameraFromScroll() {
    scrollProgress = getScrollProgress();
    const cam = cameraAtScrollProgress(scrollProgress);
    targetViewX = cam.viewX;
    targetViewY = cam.viewY;
    targetViewAngle = cam.angle;
    clampView();
  }

  function onScroll() {
    if (focusEl || pan) return;
    scrollDriving = true;
    syncCameraFromScroll();
  }

  function applyCamera() {
    const cx = viewportWidth / 2;
    const cy = viewportHeight / 2;
    world.style.transform = `translate(${cx}px, ${cy}px) rotate(${viewAngle}rad) translate(${-cx - viewX}px, ${-cy - viewY}px)`;
  }

  function clampView() {
    const maxX = Math.max(0, worldWidth - viewportWidth);
    const maxY = Math.max(0, worldHeight - viewportHeight);
    viewX = Math.min(maxX, Math.max(0, viewX));
    viewY = Math.min(maxY, Math.max(0, viewY));
    targetViewX = Math.min(maxX, Math.max(0, targetViewX));
    targetViewY = Math.min(maxY, Math.max(0, targetViewY));
  }

  function updateFocusFromDOM() {
    if (!focusEl) return;

    const cRect = container.getBoundingClientRect();
    const summary =
      focusEl.querySelector<HTMLElement>(".work-section__summary") ?? focusEl;
    const eRect = summary.getBoundingClientRect();
    const anchor = cameraViewportAnchor();
    const elLeft = eRect.left - cRect.left;
    const elTop = eRect.top - cRect.top;
    const dx = elLeft - anchor.x;
    const dy = elTop - anchor.y;

    targetViewX = viewX + dx;
    targetViewY = viewY + dy;
    clampView();
  }

  function focusCamera(el: HTMLElement) {
    const slot = slots.get(slotKey(el));
    if (!slot) return;

    focusEl = el;
    targetViewAngle = -displayRot(slot);
    updateFocusFromDOM();
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
    viewportWidth = Math.max(280, container.clientWidth);
    viewportHeight = Math.max(420, container.clientHeight);
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
      const slot = slots.get(slotKey(focusEl));
      if (slot) targetViewAngle = -displayRot(slot);
      updateFocusFromDOM();
    } else if (scrollDriving) {
      syncCameraFromScroll();
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

    window.scrollBy({ top: event.deltaY, left: event.deltaX });
    scrollDriving = true;
    syncCameraFromScroll();
    event.preventDefault();
  }

  function loop() {
    if (focusEl) {
      const slot = slots.get(slotKey(focusEl));
      if (slot) targetViewAngle = -displayRot(slot);
      updateFocusFromDOM();
    } else if (scrollDriving) {
      scrollProgress = getScrollProgress();
      const cam = cameraAtScrollProgress(scrollProgress);
      targetViewX = cam.viewX;
      targetViewY = cam.viewY;
      targetViewAngle = cam.angle;
      clampView();
    }

    viewX += (targetViewX - viewX) * CAMERA_LERP;
    viewY += (targetViewY - viewY) * CAMERA_LERP;
    viewAngle += (targetViewAngle - viewAngle) * ANGLE_LERP;
    clampView();
    applyCamera();
    updateMap();

    raf = requestAnimationFrame(loop);
  }

  layout();

  scrollDriving = true;
  syncCameraFromScroll();

  loop();

  let timer = 0;
  const scheduleLayout = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(layout, 120);
  };

  mapFrame?.addEventListener("click", onMapFrameClick);

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
