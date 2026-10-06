import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RegionMap from "@/components/RegionMap.vue";
import type { RegionMapNodeView } from "@/components/RegionMapNodeView.js";
import type { RegionMapLayout } from "@/render/themes/index.js";
import { makeMockRegionMapLayout, mockRegionMapImage } from "../../helpers/regionMap";

const layout: RegionMapLayout = makeMockRegionMapLayout();

const progressiveLabels: Record<number, string> = { 1: "P1", 5: "P2", 9: "P3", 12: "P4" };

const nodeViews: RegionMapNodeView[] = layout.nodes.map((node) => {
  const progressive = node.kind === "progressive";
  return {
    kind: node.kind,
    level: node.level,
    x: node.x,
    y: node.y,
    label: progressive ? (progressiveLabels[node.level] ?? "P") : `${node.level}`,
    tooltip: `Map ${node.level}`,
    locked: !progressive && node.level === 2,
    mapIndex: progressive ? 36 + node.level : node.level - 1,
    bestWave: 0,
    cleared: false,
  };
});

function mountRegionMap(selectedIndex: number | null = null) {
  return mount(RegionMap, {
    props: {
      mapImage: mockRegionMapImage,
      viewBox: layout.viewBox,
      connections: layout.connections,
      nodeViews,
      selectedIndex,
    },
  });
}

function mountRegionMapWithNodes(views: RegionMapNodeView[]) {
  return mount(RegionMap, {
    props: {
      mapImage: mockRegionMapImage,
      viewBox: layout.viewBox,
      connections: layout.connections,
      nodeViews: views,
      selectedIndex: null,
    },
  });
}

function nodeWithBestWave(label: string, bestWave: number) {
  const views = nodeViews.map((view) =>
    view.label === label ? { ...view, bestWave, cleared: bestWave >= 100 } : view,
  );
  return mountRegionMapWithNodes(views)
    .findAll(".map-node")
    .find((marker) => marker.find(".map-node-label").text().trim() === label)!;
}

function markerByLabel(wrapper: ReturnType<typeof mountRegionMap>, label: string) {
  return wrapper.findAll(".map-node").find((marker) => marker.find(".map-node-label").text() === label);
}

describe("RegionMap", () => {
  it("renders the region map art and one line per connection", () => {
    const wrapper = mountRegionMap();
    expect(wrapper.find("svg.region-map").attributes("viewBox")).toBe("0 0 400 300");
    expect(wrapper.find(".region-map-art").html()).toContain("rect");
    expect(wrapper.findAll(".region-map-connection").length).toBe(15);
    expect(wrapper.findAll(".region-map-connection.branch").length).toBe(4);
  });

  it("renders one marker per node view with label and tooltip", () => {
    const wrapper = mountRegionMap();
    expect(wrapper.findAll(".map-node").length).toBe(16);
    expect(markerByLabel(wrapper, "12")).toBeTruthy();
    expect(markerByLabel(wrapper, "P4")).toBeTruthy();
    expect(markerByLabel(wrapper, "3")!.find("title").text()).toBe("Map 3");
  });

  it("marks locked, selected, and progressive node states", () => {
    const wrapper = mountRegionMap(0);
    expect(markerByLabel(wrapper, "2")!.classes()).toContain("locked");
    expect(markerByLabel(wrapper, "1")!.classes()).toContain("selected");
    expect(markerByLabel(wrapper, "1")!.classes()).not.toContain("progressive");
    expect(markerByLabel(wrapper, "P1")!.classes()).toContain("progressive");
    expect(markerByLabel(wrapper, "P1")!.classes()).not.toContain("selected");
  });

  it("emits select on click and Enter, and start on double click", async () => {
    const wrapper = mountRegionMap();
    const marker = markerByLabel(wrapper, "1")!;
    await marker.trigger("click");
    expect(wrapper.emitted("select")).toEqual([[0]]);
    await marker.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")).toEqual([[0], [0]]);
    await marker.trigger("dblclick");
    expect(wrapper.emitted("start")).toEqual([[0]]);
  });

  it("never emits start for a locked marker", async () => {
    const wrapper = mountRegionMap();
    const locked = markerByLabel(wrapper, "2")!;
    await locked.trigger("click");
    await locked.trigger("dblclick");
    expect(wrapper.emitted("select")).toEqual([[1]]);
    expect(wrapper.emitted("start")).toBeUndefined();
  });

  it("shows a half-height play button under the selected unlocked marker and starts from it", async () => {
    const wrapper = mountRegionMap();
    expect(wrapper.find(".map-play-button").exists()).toBe(false);
    await wrapper.setProps({ selectedIndex: 0 });
    const playButton = wrapper.find(".map-play-button");
    expect(playButton.exists()).toBe(true);
    const rect = playButton.find(".map-play-rect");
    expect(rect.attributes("width")).toBe("68");
    expect(rect.attributes("height")).toBe("34");
    expect(Number(rect.attributes("y"))).toBe(44);
    expect(playButton.find(".map-play-icon").exists()).toBe(true);
    await playButton.trigger("click");
    expect(wrapper.emitted("start")).toEqual([[0]]);
  });

  it("hides the on-map play button for a locked selection", async () => {
    const wrapper = mountRegionMap();
    await wrapper.setProps({ selectedIndex: 1 });
    expect(wrapper.find(".map-play-button").exists()).toBe(false);
  });

  it("shows a placeholder wave readout above no medals for an unplayed map", () => {
    const wrapper = mountRegionMap();
    const marker = markerByLabel(wrapper, "3")!;
    expect(marker.find(".map-node-wave").text()).toBe("☠ —");
    expect(marker.find(".map-node-medals").exists()).toBe(false);
  });

  it("reads the best wave inside the level circle", () => {
    const marker = nodeWithBestWave("3", 42);
    expect(marker.find(".map-node-wave").text()).toBe("☠ 42");
  });

  it("shows only the medals the best wave earned", () => {
    expect(nodeWithBestWave("3", 14).find(".map-node-medals").exists()).toBe(false);
    expect(nodeWithBestWave("3", 15).find(".map-node-medals").text()).toBe("🥉");
    expect(nodeWithBestWave("3", 30).find(".map-node-medals").text()).toBe("🥉 🥈");
    expect(nodeWithBestWave("3", 50).find(".map-node-medals").text()).toBe("🥉 🥈 🥇");
  });

  it("rings the level circle and crowns the medal row on a cleared map", () => {
    const marker = nodeWithBestWave("3", 100);
    expect(marker.classes()).toContain("cleared");
    expect(marker.find(".map-node-medals").text()).toBe("🥉 🥈 🥇 👑");
    const rings = marker.findAll(".map-node-clear-ring");
    expect(rings.length).toBe(2);
    expect(rings.map((ring) => ring.attributes("r"))).toEqual(["41", "46.5"]);
  });

  it("renders the clear rings outside the level circle so they do not clip it", () => {
    const marker = nodeWithBestWave("3", 100);
    const circleRadius = Number(marker.find(".map-node-circle").attributes("r"));
    for (const ring of marker.findAll(".map-node-clear-ring")) {
      expect(Number(ring.attributes("r"))).toBeGreaterThan(circleRadius);
    }
  });
});
