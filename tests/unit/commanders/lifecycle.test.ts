import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/sim/commandBus.js", () => ({ dispatchCommand: vi.fn() }));

vi.mock("@/sim/SnapshotStore.js", () => ({ getLatestSnapshot: vi.fn() }));

vi.mock("@/commanders/relay.js", () => ({ startRelay: vi.fn(), stopRelay: vi.fn() }));

import { setEnemyCommander } from "@/commanders/index.js";
import { startRelay, stopRelay } from "@/commanders/relay.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { useUiStore } from "@/stores/ui.js";

describe("commander switch releases previous orders", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(dispatchCommand).mockClear();
    vi.mocked(startRelay).mockClear();
    vi.mocked(stopRelay).mockClear();
    vi.mocked(getLatestSnapshot).mockReturnValue({ enemies: [{ id: 4 }, { id: 9 }] } as unknown as ReturnType<
      typeof getLatestSnapshot
    >);
  });

  it("clears route and targeting before starting the next commander", () => {
    useUiStore().enemyCommander = "stubby";
    setEnemyCommander("stubbs");
    expect(dispatchCommand).toHaveBeenNthCalledWith(1, {
      commandId: 0,
      type: "llm:routeGroup",
      enemyIds: [4, 9],
      hold: false,
      waypoints: [],
    });
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, {
      commandId: 0,
      type: "llm:setTargeting",
      enemyIds: [4, 9],
      mode: "default",
    });
    expect(stopRelay).toHaveBeenCalledTimes(1);
    expect(startRelay).toHaveBeenCalledWith("stubbs");
  });

  it("clears route and targeting for none and does not start a relay", () => {
    useUiStore().enemyCommander = "stubby";
    setEnemyCommander("none");
    expect(dispatchCommand).toHaveBeenNthCalledWith(1, {
      commandId: 0,
      type: "llm:routeGroup",
      enemyIds: [4, 9],
      hold: false,
      waypoints: [],
    });
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, {
      commandId: 0,
      type: "llm:setTargeting",
      enemyIds: [4, 9],
      mode: "default",
    });
    expect(stopRelay).toHaveBeenCalledTimes(1);
    expect(startRelay).not.toHaveBeenCalled();
  });

  it("skips release dispatches when no commander was active (none -> stubby)", () => {
    useUiStore().enemyCommander = "none";
    setEnemyCommander("stubby");
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(stopRelay).toHaveBeenCalledTimes(1);
    expect(startRelay).toHaveBeenCalledWith("stubby");
  });
});
