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
const AVOID_GAP = 32;
const AVOID_ITERATIONS = 20;
const OPEN_AVOID_MASS = 5;
const CLOSED_AVOID_MASS = 1;
const SCROLL_STEP_VH = 1;
const GRAPHIC_DESIGN_KEY = "work-graphic-design";
const GRAPHIC_DESIGN_OPEN_Y_RATIO = 0.78;
const GRAPHIC_DESIGN_FOCUS_Y_RATIO = 0.62;

type SectionAnchor = {
  el: HTMLDetailsElement;
  cx: number;
  cy: number;
  rot: number;
};

function syncOpenStyles(el: HTMLDetailsElement) {
  el.style.zIndex = el.open ? "10" : "1";
}

function applySectionTransform(el: HTMLDetailsElement, slot: ScatterSlot) {
  el.style.transform = `translate(${slot.x}px, ${slot.y}px) rotate(${slot.rot}rad)`;
}

function rotatedExtents(slot: ScatterSlot) {
  const { x, y, w, h, rot } = slot;
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
    ...container.querySelectorAll<HTMLDetailsElement>(".work-section"),
  ];
  if (sectionEls.length === 0) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const world = document.createElement("div");
  world.className = "works__world";
  while (container.firstChild) {
    world.appendChild(container.firstChild);
  }
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
  let focusEl: HTMLDetailsElement | null = null;
  let pan: { startX: number; startY: number; viewX0: number; viewY0: number } | null =
    null;
  let raf = 0;
  let scrollDriving = true;
  let scrollProgress = 0;
  let anchors: SectionAnchor[] = [];
  let syncingOpen = false;
  const mapRoot = document.getElementById("works-map");
  const mapFrame = mapRoot?.querySelector<HTMLElement>(".works-map__frame");
  const mapViewport = mapRoot?.querySelector<HTMLElement>(".works-map__viewport");
  const mapMarkers = new Map<HTMLDetailsElement, HTMLSpanElement>();
  const scrollTrack = document.createElement("div");
  scrollTrack.className = "works-scroll-track";
  scrollTrack.setAttribute("aria-hidden", "true");
  container.insertAdjacentElement("afterend", scrollTrack);

  function slotKey(el: HTMLDetailsElement) {
    return el.id || el.querySelector(".work-section__title")?.textContent || "";
  }

  for (const el of sectionEls) {
    const key = slotKey(el);
    const rx =
      Math.random() < 0.5
        ? Math.random() * 0.42
        : 0.58 + Math.random() * 0.42;
    slots.set(key, {
      rx,
      ry:
        key === GRAPHIC_DESIGN_KEY
          ? 0.55 + Math.random() * 0.38
          : 0.12 + Math.random() * 0.88,
      rot: (Math.random() - 0.5) * 0.35,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });

    el.addEventListener("toggle", () => {
      if (syncingOpen) return;

      if (el.open) {
        syncingOpen = true;
        for (const other of sectionEls) {
          if (other !== el && other.open) other.open = false;
        }
        syncingOpen = false;
      }

      requestAnimationFrame(() => {
        layout();
        syncOpenStyles(el);
        if (el.open) {
          scrollDriving = false;
          focusCamera(el);
        } else if (focusEl === el) {
          clearFocus();
          scrollDriving = true;
          syncCameraFromScroll();
        }
      });
    });

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

  function activateSectionFromMap(el: HTMLDetailsElement) {
    if (syncingOpen) return;

    syncingOpen = true;
    for (const other of sectionEls) {
      if (other !== el && other.open) other.open = false;
    }
    if (!el.open) el.open = true;
    syncingOpen = false;

    scrollDriving = false;
    requestAnimationFrame(() => {
      layout();
      syncOpenStyles(el);
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
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const worldX = x * worldWidth;
    const worldY = y * worldHeight;

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

  function updateMap() {
    if (!mapFrame || !mapViewport || worldWidth <= 0 || worldHeight <= 0) return;

    mapViewport.style.left = `${(viewX / worldWidth) * 100}%`;
    mapViewport.style.top = `${(viewY / worldHeight) * 100}%`;
    mapViewport.style.width = `${(viewportWidth / worldWidth) * 100}%`;
    mapViewport.style.height = `${(viewportHeight / worldHeight) * 100}%`;

    for (const el of sectionEls) {
      const marker = mapMarkers.get(el);
      const slot = slots.get(slotKey(el));
      if (!marker || !slot || slot.w <= 0 || slot.h <= 0) continue;

      const cx = slot.x + slot.w / 2;
      const cy = slot.y + slot.h / 2;
      marker.style.left = `${(cx / worldWidth) * 100}%`;
      marker.style.top = `${(cy / worldHeight) * 100}%`;
      marker.textContent = el.open ? "−" : "+";
      marker.classList.toggle("works-map__marker--open", el.open);
    }
  }

  function rebuildAnchors() {
    anchors = sectionEls
      .map((el) => {
        const slot = slots.get(slotKey(el));
        if (!slot || slot.w <= 0 || slot.h <= 0) return null;
        return {
          el,
          cx: slot.x + slot.w / 2,
          cy: slot.y + slot.h / 2,
          rot: slot.rot,
        };
      })
      .filter((a): a is SectionAnchor => a !== null)
      .sort((a, b) => a.cy - b.cy);
  }

  function updateScrollTrack() {
    const steps = Math.max(1, anchors.length);
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

  function cameraAtScrollProgress(p: number) {
    if (anchors.length === 0) {
      return { viewX: 0, viewY: 0, angle: 0 };
    }
    if (anchors.length === 1) {
      const a = anchors[0];
      return {
        viewX: a.cx - viewportWidth / 2,
        viewY: a.cy - viewportHeight / 2,
        angle: -a.rot,
      };
    }

    const pos = p * (anchors.length - 1);
    const i = Math.min(anchors.length - 2, Math.floor(pos));
    const t = pos - i;
    const a = anchors[i];
    const b = anchors[i + 1];

    return {
      viewX: a.cx + (b.cx - a.cx) * t - viewportWidth / 2,
      viewY: a.cy + (b.cy - a.cy) * t - viewportHeight / 2,
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
    if (focusEl?.open || pan) return;
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
    if (!focusEl?.open) return;

    const cRect = container.getBoundingClientRect();
    const eRect = focusEl.getBoundingClientRect();
    const elCx = eRect.left - cRect.left + eRect.width / 2;
    const elCy = eRect.top - cRect.top + eRect.height / 2;
    const focusY =
      slotKey(focusEl) === GRAPHIC_DESIGN_KEY
        ? cRect.height * GRAPHIC_DESIGN_FOCUS_Y_RATIO
        : cRect.height / 2;
    const dx = elCx - cRect.width / 2;
    const dy = elCy - focusY;

    targetViewX = viewX + dx;
    targetViewY = viewY + dy;
    clampView();
  }

  function focusCamera(el: HTMLDetailsElement) {
    const slot = slots.get(slotKey(el));
    if (!slot) return;

    focusEl = el;
    targetViewAngle = -slot.rot;
    updateFocusFromDOM();
  }

  function clearFocus() {
    focusEl = null;
    targetViewAngle = 0;
  }

  function clampSlotPosition(slot: ScatterSlot) {
    for (let pass = 0; pass < 10; pass++) {
      const ext = rotatedExtents(slot);
      let dx = 0;
      let dy = 0;

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
      applySectionTransform(el, slot);
    }

    return true;
  }

  function separateSections() {
    type Body = {
      el: HTMLDetailsElement;
      slot: ScatterSlot;
      cx: number;
      cy: number;
      r: number;
      mass: number;
    };

    const bodies: Body[] = [];

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot || slot.w <= 0 || slot.h <= 0) continue;

      const extraGap = el.open ? AVOID_GAP * 0.35 : 0;
      bodies.push({
        el,
        slot,
        cx: slot.x + slot.w / 2,
        cy: slot.y + slot.h / 2,
        r: Math.hypot(slot.w, slot.h) * 0.5 + AVOID_GAP * 0.5 + extraGap,
        mass: el.open ? OPEN_AVOID_MASS : CLOSED_AVOID_MASS,
      });
    }

    for (let pass = 0; pass < AVOID_ITERATIONS; pass++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          let dx = b.cx - a.cx;
          let dy = b.cy - a.cy;
          const dist = Math.hypot(dx, dy) || 0.001;
          const overlap = a.r + b.r - dist;

          if (overlap <= 0) continue;

          dx /= dist;
          dy /= dist;
          const totalMass = a.mass + b.mass;
          const moveA = (overlap * b.mass) / totalMass;
          const moveB = (overlap * a.mass) / totalMass;

          a.cx -= dx * moveA;
          a.cy -= dy * moveA;
          b.cx += dx * moveB;
          b.cy += dy * moveB;
        }
      }
    }

    for (const { el, slot, cx, cy } of bodies) {
      slot.x = cx - slot.w / 2;
      slot.y = cy - slot.h / 2;
      clampSlotPosition(slot);
      applySectionTransform(el, slot);
    }
  }

  function layout() {
    viewportWidth = Math.max(280, container.clientWidth);
    viewportHeight = Math.max(420, container.clientHeight);
    worldWidth = Math.max(viewportWidth * 2, Math.round(viewportWidth * 1.8));
    worldHeight = Math.max(viewportHeight * 1.5, viewportHeight);

    container.style.height = `${viewportHeight}px`;
    world.style.width = `${worldWidth}px`;
    world.style.height = `${worldHeight}px`;

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot) continue;

      const cardWidth = el.open
        ? Math.min(worldWidth - PAD * 2, CARD_MAX_OPEN)
        : Math.min(
            CARD_MAX_CLOSED,
            Math.max(220, Math.round(viewportWidth * CARD_WIDTH_RATIO)),
          );

      el.style.width = `${cardWidth}px`;
      el.style.left = "0";
      el.style.top = "0";

      const ew = el.offsetWidth;
      const eh = el.offsetHeight;
      const maxX = Math.max(0, worldWidth - ew - PAD * 2);
      const maxY = Math.max(0, worldHeight - eh - TOP_PAD - PAD);

      if (!el.open) {
        slot.x = PAD + slot.rx * maxX;
        slot.y = TOP_PAD + slot.ry * maxY;
      } else {
        slot.x = Math.min(maxX + PAD, Math.max(PAD, slot.x));
        if (slotKey(el) === GRAPHIC_DESIGN_KEY) {
          slot.y = TOP_PAD + maxY * GRAPHIC_DESIGN_OPEN_Y_RATIO;
        } else {
          slot.y = Math.min(maxY + TOP_PAD, Math.max(TOP_PAD, slot.y));
        }
      }

      slot.w = ew;
      slot.h = eh;

      applySectionTransform(el, slot);
      syncOpenStyles(el);
    }

    separateSections();
    if (sectionEls.some((el) => el.open)) {
      separateSections();
    }

    for (const el of sectionEls) {
      const slot = slots.get(slotKey(el));
      if (!slot) continue;
      clampSlotPosition(slot);
      applySectionTransform(el, slot);
    }

    applyCamera();
    if (fitSectionsInContainer()) {
      separateSections();
      for (const el of sectionEls) {
        const slot = slots.get(slotKey(el));
        if (!slot) continue;
        clampSlotPosition(slot);
        applySectionTransform(el, slot);
      }
    }

    rebuildAnchors();
    updateScrollTrack();

    if (focusEl?.open) {
      const slot = slots.get(slotKey(focusEl));
      if (slot) targetViewAngle = -slot.rot;
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
    return target.closest<HTMLDetailsElement>(".work-section");
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
    if (focusEl?.open) {
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
    if (focusEl?.open) {
      const slot = slots.get(slotKey(focusEl));
      if (slot) targetViewAngle = -slot.rot;
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

  const defaultOpenEl = sectionEls.find((el) => el.open) ?? null;
  if (defaultOpenEl) {
    scrollDriving = false;
    focusCamera(defaultOpenEl);
    applyCamera();
    if (fitSectionsInContainer()) {
      rebuildAnchors();
      focusCamera(defaultOpenEl);
      applyCamera();
    }
  } else {
    syncCameraFromScroll();
  }

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
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerUp);
    container.removeEventListener("wheel", onWheel);
    container.classList.remove("works--scatter");
    container.style.height = "";
    world.style.transform = "";
    if (world.parentElement === container) {
      while (world.firstChild) container.appendChild(world.firstChild);
      world.remove();
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
