import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { type PanelDragOptions, type PanelPosition, usePanelDrag } from "@/composables/usePanelDrag.js";

// jsdom reports zero for every offsetWidth/offsetHeight, so the clamp tests
// stub them to stand in for a sized panel.
function stubPanelSize(width: number, height: number): () => void {
  const descriptorWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  const descriptorHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => height });
  return () => {
    if (descriptorWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", descriptorWidth);
    if (descriptorHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptorHeight);
  };
}

interface Harness {
  position: ReturnType<typeof ref<PanelPosition>>;
  panelRef: ReturnType<typeof ref<HTMLElement | null>>;
  startDrag: (event: MouseEvent) => void;
  startTouchDrag: (event: TouchEvent) => void;
}

function createHarness(options: { clampToViewport?: boolean } = {}): Harness {
  const position = ref<PanelPosition>({ x: 10, y: 20 });
  const panelRef = ref<HTMLElement | null>(null);
  const harness: Harness = { position, panelRef, startDrag: () => {}, startTouchDrag: () => {} };
  const Host = defineComponent({
    setup() {
      // exactOptionalPropertyTypes rejects an explicit undefined, so only pass
      // the key when the caller asked for clamping.
      const dragOptions: PanelDragOptions = {
        read: () => position.value,
        write: (next) => {
          position.value = next;
        },
        panelRef,
      };
      if (options.clampToViewport) dragOptions.clampToViewport = true;
      const drag = usePanelDrag(dragOptions);
      harness.startDrag = drag.onHeaderMouseDown;
      harness.startTouchDrag = drag.onHeaderTouchStart;
      return () => h("div", { ref: panelRef });
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  harness.panelRef.value = wrapper.element as HTMLElement;
  return harness;
}

function pressMouse(clientX: number, clientY: number, button = 0): MouseEvent {
  return new MouseEvent("mousedown", { button, clientX, clientY, bubbles: true });
}

afterEach(() => {
  document.dispatchEvent(new MouseEvent("mouseup"));
  document.dispatchEvent(new Event("touchend"));
  document.dispatchEvent(new Event("touchcancel"));
});

describe("usePanelDrag", () => {
  it("tracks the pointer from the position the drag started at", () => {
    const harness = createHarness();
    harness.startDrag(pressMouse(100, 100));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 130, clientY: 115 }));
    expect(harness.position.value).toEqual({ x: 40, y: 35 });
  });

  it("reads the position at mousedown, not the last written one", () => {
    const harness = createHarness();
    harness.position.value = { x: 300, y: 300 };
    harness.startDrag(pressMouse(0, 0));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    expect(harness.position.value).toEqual({ x: 310, y: 310 });
  });

  it("ignores a non-primary button", () => {
    const harness = createHarness();
    harness.startDrag(pressMouse(100, 100, 2));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 400 }));
    expect(harness.position.value).toEqual({ x: 10, y: 20 });
  });

  it("consumes the header press so it cannot bubble to game-surface handlers", () => {
    const harness = createHarness();

    const mouseEvent = pressMouse(100, 100);
    harness.startDrag(mouseEvent);
    expect(mouseEvent.cancelBubble).toBe(true);
    document.dispatchEvent(new MouseEvent("mouseup"));

    const touchEvent = new Event("touchstart", { bubbles: true }) as TouchEvent & { touches: unknown[] };
    Object.defineProperty(touchEvent, "touches", { value: [{ clientX: 0, clientY: 0 }] });
    harness.startTouchDrag(touchEvent);
    expect(touchEvent.cancelBubble).toBe(true);
    document.dispatchEvent(new Event("touchend"));
  });

  it("stops moving the panel once the mouse is released", () => {
    const harness = createHarness();
    harness.startDrag(pressMouse(0, 0));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 500 }));
    expect(harness.position.value).toEqual({ x: 20, y: 30 });
  });

  it("stops moving the panel after a window blur mid-drag", () => {
    const harness = createHarness();
    harness.startDrag(pressMouse(0, 0));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 500 }));
    expect(harness.position.value).toEqual({ x: 20, y: 30 });
  });

  it("stops moving the panel after a touchcancel mid-drag", () => {
    const harness = createHarness();
    const event = new Event("touchstart", { bubbles: true }) as TouchEvent & { touches: unknown[] };
    Object.defineProperty(event, "touches", { value: [{ clientX: 0, clientY: 0 }] });
    harness.startTouchDrag(event);
    document.dispatchEvent(new Event("touchcancel"));
    const moveEvent = new Event("touchmove") as TouchEvent & { touches: unknown[] };
    Object.defineProperty(moveEvent, "touches", { value: [{ clientX: 400, clientY: 400 }] });
    document.dispatchEvent(moveEvent);
    expect(harness.position.value).toEqual({ x: 10, y: 20 });
  });

  it("removes its listeners when the host unmounts mid-drag", () => {
    const position = ref<PanelPosition>({ x: 0, y: 0 });
    let startDrag: (event: MouseEvent) => void = () => {};
    const Host = defineComponent({
      setup() {
        const drag = usePanelDrag({
          read: () => position.value,
          write: (next) => {
            position.value = next;
          },
          panelRef: ref<HTMLElement | null>(null),
        });
        startDrag = drag.onHeaderMouseDown;
        return () => h("div");
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    startDrag(pressMouse(0, 0));
    wrapper.unmount();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 999, clientY: 999 }));
    expect(position.value).toEqual({ x: 0, y: 0 });
  });

  it("moves without clamping when clampToViewport is off", () => {
    const harness = createHarness({ clampToViewport: false });
    harness.startDrag(pressMouse(0, 0));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100000, clientY: 100000 }));
    expect(harness.position.value).toEqual({ x: 100010, y: 100020 });
  });

  it("keeps a clamped panel inside the viewport", () => {
    const restore = stubPanelSize(200, 100);
    try {
      const harness = createHarness({ clampToViewport: true });
      harness.startDrag(pressMouse(0, 0));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100000, clientY: 100000 }));
      expect(harness.position.value).toEqual({ x: window.innerWidth - 200, y: window.innerHeight - 100 });
    } finally {
      restore();
    }
  });

  it("keeps a clamped panel at the origin when dragged past the top-left", () => {
    const restore = stubPanelSize(200, 100);
    try {
      const harness = createHarness({ clampToViewport: true });
      harness.startDrag(pressMouse(500, 500));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: -5000, clientY: -5000 }));
      expect(harness.position.value).toEqual({ x: 0, y: 0 });
    } finally {
      restore();
    }
  });

  it("clamps to zero when the panel is larger than the viewport", () => {
    const restore = stubPanelSize(window.innerWidth + 500, 10);
    try {
      const harness = createHarness({ clampToViewport: true });
      harness.startDrag(pressMouse(0, 0));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 0 }));
      expect(harness.position.value?.x).toBe(0);
    } finally {
      restore();
    }
  });

  it("re-clamps the position when the viewport shrinks", () => {
    const restoreSize = stubPanelSize(200, 100);
    const widthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const heightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
    try {
      const harness = createHarness({ clampToViewport: true });
      harness.position.value = { x: 900, y: 700 };
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
      window.dispatchEvent(new Event("resize"));
      expect(harness.position.value).toEqual({ x: 200, y: 200 });
    } finally {
      restoreSize();
      if (widthDescriptor) Object.defineProperty(window, "innerWidth", widthDescriptor);
      if (heightDescriptor) Object.defineProperty(window, "innerHeight", heightDescriptor);
    }
  });

  it("drags from a single touch", () => {
    const harness = createHarness();
    const touch = { clientX: 100, clientY: 100 };
    const event = new Event("touchstart", { bubbles: true }) as TouchEvent & { touches: unknown[] };
    Object.defineProperty(event, "touches", { value: [touch] });
    harness.startTouchDrag(event);
    const moveEvent = new Event("touchmove") as TouchEvent & { touches: unknown[] };
    Object.defineProperty(moveEvent, "touches", { value: [{ clientX: 125, clientY: 110 }] });
    document.dispatchEvent(moveEvent);
    expect(harness.position.value).toEqual({ x: 35, y: 30 });
  });

  it("ignores a multi-touch gesture", () => {
    const harness = createHarness();
    const event = new Event("touchstart", { bubbles: true }) as TouchEvent & { touches: unknown[] };
    Object.defineProperty(event, "touches", {
      value: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 200 },
      ],
    });
    harness.startTouchDrag(event);
    const moveEvent = new Event("touchmove") as TouchEvent & { touches: unknown[] };
    Object.defineProperty(moveEvent, "touches", { value: [{ clientX: 500, clientY: 500 }] });
    document.dispatchEvent(moveEvent);
    expect(harness.position.value).toEqual({ x: 10, y: 20 });
  });

  it("stops moving after touchend", () => {
    const harness = createHarness();
    const event = new Event("touchstart", { bubbles: true }) as TouchEvent & { touches: unknown[] };
    Object.defineProperty(event, "touches", { value: [{ clientX: 0, clientY: 0 }] });
    harness.startTouchDrag(event);
    document.dispatchEvent(new Event("touchend"));
    const moveEvent = new Event("touchmove") as TouchEvent & { touches: unknown[] };
    Object.defineProperty(moveEvent, "touches", { value: [{ clientX: 400, clientY: 400 }] });
    document.dispatchEvent(moveEvent);
    expect(harness.position.value).toEqual({ x: 10, y: 20 });
  });
});
