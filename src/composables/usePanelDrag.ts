import { onUnmounted, type Ref } from "vue";

export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelDragOptions {
  // Current position, read when a drag starts so the panel tracks the pointer
  // from wherever it already sits rather than jumping to the last move delta.
  read: () => PanelPosition;
  // Where to publish each move. Usually a Pinia store setter.
  write: (position: PanelPosition) => void;
  // The dragged element. Required: the viewport clamp needs the panel's own
  // size, for both drag moves and the resize re-clamp, and every caller passes it.
  panelRef: Ref<HTMLElement | null>;
  // Keep the panel inside the viewport. Without this a drag can push a panel
  // off screen, leaving no way to drag it back.
  clampToViewport?: boolean;
  // Also re-clamp on window resize; defaults to clampToViewport's behavior.
  // GameShop turns it off: its own resize handler repins the bar to an edge and
  // must be the only resize writer for that position.
  clampOnResize?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Header-drag behavior shared by every floating in-game panel. Cleanup runs on
 * mouseup, touchend, window blur, document touchcancel, and component unmount —
 * any of those ends the drag and drops the listeners. Note that the panels keep
 * their root element behind a `v-if` while the component itself stays mounted,
 * so hiding the panel mid-drag does NOT fire `onUnmounted`; that is a
 * pre-existing limitation, and the gesture-ending events above are what stop a
 * drag whose panel disappears under it.
 */
export function usePanelDrag(options: PanelDragOptions): {
  onHeaderMouseDown: (event: MouseEvent) => void;
  onHeaderTouchStart: (event: TouchEvent) => void;
} {
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startX = 0;
  let startY = 0;
  let currentOnMove: ((event: MouseEvent) => void) | null = null;
  let currentOnUp: (() => void) | null = null;
  let currentTouchMove: ((event: TouchEvent) => void) | null = null;
  let currentTouchEnd: (() => void) | null = null;
  let currentOnBlur: (() => void) | null = null;
  let currentTouchCancel: (() => void) | null = null;

  function releaseListeners(): void {
    if (currentOnMove) document.removeEventListener("mousemove", currentOnMove);
    if (currentOnUp) document.removeEventListener("mouseup", currentOnUp);
    if (currentTouchMove) document.removeEventListener("touchmove", currentTouchMove);
    if (currentTouchEnd) document.removeEventListener("touchend", currentTouchEnd);
    if (currentOnBlur) window.removeEventListener("blur", currentOnBlur);
    if (currentTouchCancel) document.removeEventListener("touchcancel", currentTouchCancel);
    currentOnMove = null;
    currentOnUp = null;
    currentTouchMove = null;
    currentTouchEnd = null;
    currentOnBlur = null;
    currentTouchCancel = null;
  }

  function clampPositionToViewport(position: PanelPosition): PanelPosition {
    const element = options.panelRef.value;
    const panelWidth = element?.offsetWidth ?? 0;
    const panelHeight = element?.offsetHeight ?? 0;
    return {
      x: clamp(position.x, 0, Math.max(0, window.innerWidth - panelWidth)),
      y: clamp(position.y, 0, Math.max(0, window.innerHeight - panelHeight)),
    };
  }

  function applyMove(clientX: number, clientY: number): void {
    if (!dragging) return;
    let nextPosition: PanelPosition = { x: startX + (clientX - dragStartX), y: startY + (clientY - dragStartY) };
    if (options.clampToViewport) nextPosition = clampPositionToViewport(nextPosition);
    options.write(nextPosition);
  }

  function onMove(event: MouseEvent): void {
    applyMove(event.clientX, event.clientY);
  }

  function onUp(): void {
    dragging = false;
    releaseListeners();
  }

  function beginDrag(clientX: number, clientY: number): void {
    dragging = true;
    dragStartX = clientX;
    dragStartY = clientY;
    const start = options.read();
    startX = start.x;
    startY = start.y;
  }

  function registerGestureEndListeners(): void {
    currentOnBlur = onUp;
    currentTouchCancel = onUp;
    window.addEventListener("blur", currentOnBlur);
    document.addEventListener("touchcancel", currentTouchCancel);
  }

  function onHeaderMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    beginDrag(event.clientX, event.clientY);
    currentOnMove = onMove;
    currentOnUp = onUp;
    document.addEventListener("mousemove", currentOnMove);
    document.addEventListener("mouseup", currentOnUp);
    registerGestureEndListeners();
    event.preventDefault();
    // Consumed like the touch path below: a header press is drag intent only
    // and must not reach game-surface handlers as a click or selection.
    event.stopPropagation();
  }

  function onHeaderTouchStart(event: TouchEvent): void {
    // Multi-touch is a pinch or a browser gesture, not a panel drag.
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    beginDrag(touch.clientX, touch.clientY);
    currentTouchMove = (moveEvent: TouchEvent) => {
      const moved = moveEvent.touches[0];
      if (!moved) return;
      applyMove(moved.clientX, moved.clientY);
    };
    currentTouchEnd = onUp;
    document.addEventListener("touchmove", currentTouchMove, { passive: true });
    document.addEventListener("touchend", currentTouchEnd);
    registerGestureEndListeners();
    event.preventDefault();
    event.stopPropagation();
  }

  // A resize can move a clamped panel out of bounds (the viewport shrank under
  // it), so the composable re-clamps its own position unless the caller opted
  // out with a resize handler of its own. This one lives for the component's
  // lifetime, unlike the gesture listeners above, so onUnmounted releases it.
  const reClampOnResize = (): void => {
    options.write(clampPositionToViewport(options.read()));
  };
  const listensForResize = options.clampToViewport && options.clampOnResize !== false;
  if (listensForResize) window.addEventListener("resize", reClampOnResize);

  onUnmounted(() => {
    dragging = false;
    releaseListeners();
    if (listensForResize) window.removeEventListener("resize", reClampOnResize);
  });

  return { onHeaderMouseDown, onHeaderTouchStart };
}
