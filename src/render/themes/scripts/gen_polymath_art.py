#!/usr/bin/env python3
"""Regenerate the Polymath theme's tile, base, spawn, and map site art.

Tile art is a flat field fill per tile plus a soft tonal drift: three large,
low-opacity ellipses and the symmetric inner ring, nothing else. Large soft
blobs are the construction that survives the renderer's seeded 90 degree tile
rotation and a kind's repetition across a height blob — fine line work does
not, because rotated neighbours show unrelated arc fragments. Terrain ramps
darken with height, matching the other shipped themes, and every height shares
the same construction so the ramp reads as one continuous surface.

Map site art (buildings, caches, boss package) is authored in the same
0 0 36 36 space as tile art and drawn at 26 world px. Buildings are silhouettes
that read without color; caches separate their three states by geometry.

Only the art lines are rewritten; every other byte of the JSON file is
preserved. Generated art is checked against the flat-paint rule (no paint
servers, no filters), the first-fill invariant (the first fill of a tile is the
full-bleed 36x36 field rect), the 3px edge band (blobs never reach a cell edge,
so rotated neighbours meet on flat fill), a byte budget per tile, and in-bounds
coordinates. Previews of every tile variant at 4 rotations and 3 sizes, a
stitched 12x8 mosaic per region for judging repetition, the three region bases,
the three spawn states, and the site art are written to
tmp/polymath-art-preview/.
"""

from __future__ import annotations

import json
import math
import os
import random
import re
import sys

SCRIPT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIRECTORY)
import region_map_art  # noqa: E402
import theme_field_patch  # noqa: E402

THEME_PATH = os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "default-map-theme.json"))
PREVIEW_DIRECTORY = os.path.normpath(
    os.path.join(SCRIPT_DIRECTORY, "..", "..", "..", "..", "tmp", "polymath-art-preview")
)

TILE_KINDS = ["path", "terrain1", "terrain2", "terrain3", "terrain4"]
TILE_VARIANT_COUNT = 3
SPAWN_STATES = ["closed", "open", "transition"]
BUILDING_KINDS = ["armory", "magazine", "beacon", "foundry", "clocktower", "aviary"]
CACHE_STATES = ["sealed", "unlocked", "broken"]

TILE_SIZE = 36
TILE_HALF = TILE_SIZE / 2
BASE_BOX_SIZE = 108
# Rotated neighbours meet on the cell edge, so no blob may reach into this band.
EDGE_BAND = 3
TILE_BYTE_MIN = 350
TILE_BYTE_MAX = 900

SPAWN_RED = "#e85a6a"
SPAWN_OPEN_GREEN = "#6abf6a"

BUILDING_COLORS = {
    "armory": "#e07040",
    "magazine": "#d0a040",
    "beacon": "#70a0e0",
    "foundry": "#d05050",
    "clocktower": "#b070e0",
    "aviary": "#40c0a0",
}
BUILDING_OUTLINE = "#1a1a1a"
FOOTPRINT_SHADOW_FILL = "rgba(0,0,0,0.25)"
PLINTH_FILL = "#2a2a2c"
PLINTH_TOP_FILL = "#3d3d40"

CACHE_BODY = "#8a6230"
CACHE_BODY_DARK = "#5a4a30"
CACHE_OUTLINE = "#4a3018"
CACHE_INK = "#f4e6cc"
CACHE_INK_BROKEN = "#c8b898"

REGIONS = [
    {
        "id": 0,
        "name": "Verdant Marches",
        "accent": "#6abf6a",
        "path_fill": "#4a3d28",
        "ramp": ["#4e824e", "#427542", "#366836", "#2a5a2a"],
    },
    {
        "id": 1,
        "name": "Sunscorch Coast",
        "accent": "#d9a441",
        "path_fill": "#b8a56a",
        "ramp": ["#a08a5c", "#8a734a", "#6f5a3a", "#52422c"],
    },
    {
        "id": 2,
        "name": "Thornpeak Wilds",
        "accent": "#b8b0a0",
        "path_fill": "#3a322a",
        "ramp": ["#8a7d6a", "#746a59", "#5f5748", "#4e443a"],
    },
]


def n(value: float) -> str:
    rounded = round(float(value), 1)
    text = f"{rounded:.1f}".rstrip("0").rstrip(".")
    return text if text else "0"


def parse_hex(color: str) -> tuple[int, int, int]:
    stripped = color.lstrip("#")
    if len(stripped) == 3:
        stripped = "".join(char * 2 for char in stripped)
    return (int(stripped[0:2], 16), int(stripped[2:4], 16), int(stripped[4:6], 16))


def mix_toward_black(color: str, amount: float) -> str:
    return "#%02x%02x%02x" % tuple(int(channel * (1 - amount)) for channel in parse_hex(color))


def mix_toward_white(color: str, amount: float) -> str:
    return "#%02x%02x%02x" % tuple(int(channel + (255 - channel) * amount) for channel in parse_hex(color))


def field_rect(field: str) -> str:
    return region_map_art.rect(0, 0, TILE_SIZE, TILE_SIZE, fill=field)


def inner_ring(field: str) -> str:
    return region_map_art.rect(EDGE_BAND - 2, EDGE_BAND - 2, TILE_SIZE - 2 * (EDGE_BAND - 2),
                               TILE_SIZE - 2 * (EDGE_BAND - 2), fill="none",
                               stroke=mix_toward_black(field, 0.3), stroke_width=2, opacity=0.1)


def fit_blob(center_offset_x: float, center_offset_y: float, radius_x: float, radius_y: float) -> tuple[float, float]:
    """Clamps a blob's radii so its box stays clear of the edge band."""
    limit_x = TILE_HALF - EDGE_BAND - abs(center_offset_x)
    limit_y = TILE_HALF - EDGE_BAND - abs(center_offset_y)
    if limit_x <= 0 or limit_y <= 0:
        raise SystemExit(f"blob offset ({center_offset_x}, {center_offset_y}) leaves no room inside the tile")
    return min(radius_x, limit_x), min(radius_y, limit_y)


def blob(center_offset_x: float, center_offset_y: float, radius_x: float, radius_y: float,
         fill: str, opacity: float) -> tuple[str, tuple[float, float, float, float]]:
    fitted_x, fitted_y = fit_blob(center_offset_x, center_offset_y, radius_x, radius_y)
    center_x = TILE_HALF + center_offset_x
    center_y = TILE_HALF + center_offset_y
    markup = region_map_art.ellipse(center_x, center_y, fitted_x, fitted_y, fill=fill, opacity=opacity)
    box = (center_x - fitted_x, center_y - fitted_y, center_x + fitted_x, center_y + fitted_y)
    return markup, box


def blob_boxes_in(tile_content: str) -> list[tuple[float, float, float, float]]:
    boxes = []
    for match in re.finditer(r'<(?:ellipse|circle)\b([^>]*)>', tile_content):
        attributes = match.group(1)

        def number_of(name: str) -> float:
            found = re.search(rf'\b{name}="([\d.]+)"', attributes)
            return float(found.group(1)) if found else 0.0

        center_x = number_of("cx")
        center_y = number_of("cy")
        radius_x = number_of("rx") or number_of("r")
        radius_y = number_of("ry") or number_of("r")
        boxes.append((center_x - radius_x, center_y - radius_y, center_x + radius_x, center_y + radius_y))
    return boxes


def soft_blob_terrain(rng: random.Random, field: str, height_index: int) -> tuple[str, list[tuple[float, float, float, float]]]:
    """Field fill + inner ring + three soft tonal ellipses. Amplitude, not
    construction, is what separates the four heights."""
    amplitude = height_index / (len(REGIONS[0]["ramp"]) - 1)
    parts = [field_rect(field), inner_ring(field)]
    boxes: list[tuple[float, float, float, float]] = []

    light_offset_x = rng.uniform(-5, 5)
    light_offset_y = rng.uniform(-5, 5)
    light_markup, light_box = blob(
        light_offset_x, light_offset_y, rng.uniform(8, 10), rng.uniform(8, 10),
        mix_toward_white(field, rng.uniform(0.05, 0.07)), 0.30 + 0.12 * amplitude,
    )
    parts.append(light_markup)
    boxes.append(light_box)

    shadow_offset_x = rng.uniform(-4.5, 4.5)
    shadow_offset_y = rng.uniform(-4.5, 4.5)
    shadow_markup, shadow_box = blob(
        shadow_offset_x, shadow_offset_y, rng.uniform(7.5, 9.5), rng.uniform(7.5, 9.5),
        mix_toward_black(field, rng.uniform(0.06, 0.08)), 0.28 + 0.12 * amplitude,
    )
    parts.append(shadow_markup)
    boxes.append(shadow_box)

    accent_offset_x = rng.uniform(-8, 8)
    accent_offset_y = rng.uniform(-8, 8)
    accent_markup, accent_box = blob(
        accent_offset_x, accent_offset_y, rng.uniform(4.5, 6), rng.uniform(4.5, 6),
        mix_toward_black(field, 0.10), 0.22 + 0.10 * amplitude,
    )
    parts.append(accent_markup)
    boxes.append(accent_box)
    return "".join(parts), boxes


# Path marks stay a small scatter of ticks, dashes, and dots around a worn
# center; they are placed well inside the edge band so a rotated neighbour never
# sees a mark crossing into its own cell.
PATH_MARKS = ["dot", "dash", "tick"]
PATH_MARK_MARGIN = 5.0

MARK_STROKE_OPACITY = 0.2
MARK_FILL_OPACITY = 0.18
MARK_STROKE_WIDTH = 0.5


def path_tile(rng: random.Random, field: str) -> tuple[str, list[tuple[float, float, float, float]]]:
    parts = [field_rect(field), inner_ring(field)]
    parts.append(region_map_art.ellipse(18, 18, 12.6, 12.6, fill=mix_toward_white(field, 0.10), opacity=0.12))
    boxes = [(5.4, 5.4, 30.6, 30.6)]
    stroke_color = mix_toward_black(field, 0.35)
    fill_color = mix_toward_black(field, 0.4)

    fragments: list[str] = []
    elements: list[str] = []
    shapes = rng.sample(PATH_MARKS, rng.randint(2, 3))
    for shape in shapes:
        mark_x = rng.uniform(PATH_MARK_MARGIN, TILE_SIZE - PATH_MARK_MARGIN)
        mark_y = rng.uniform(PATH_MARK_MARGIN, TILE_SIZE - PATH_MARK_MARGIN)
        d, element = path_mark(rng, shape, mark_x, mark_y, fill_color)
        if d:
            fragments.append(d)
        if element:
            elements.append(element)
    if fragments:
        parts.append(region_map_art.path_shape(" ".join(fragments), stroke=stroke_color,
                                               stroke_width=MARK_STROKE_WIDTH, opacity=MARK_STROKE_OPACITY))
    parts.extend(elements)
    for element in elements:
        for match in re.finditer(r'<circle\b([^>]*)>', element):
            attributes = match.group(1)
            center_x = float(re.search(r'cx="([\d.]+)"', attributes).group(1))
            center_y = float(re.search(r'cy="([\d.]+)"', attributes).group(1))
            radius = float(re.search(r'r="([\d.]+)"', attributes).group(1))
            boxes.append((center_x - radius, center_y - radius, center_x + radius, center_y + radius))
    return "".join(parts), boxes


def path_mark(rng: random.Random, shape: str, mark_x: float, mark_y: float,
              fill_color: str) -> tuple[str | None, str | None]:
    if shape == "dot":
        return None, region_map_art.circle(mark_x, mark_y, rng.uniform(0.5, 0.75),
                                           fill=fill_color, opacity=MARK_FILL_OPACITY)
    if shape == "dash":
        angle = rng.uniform(0, 2 * math.pi)
        half = rng.uniform(1.1, 1.6)
        return (f"M{n(mark_x - math.cos(angle) * half)},{n(mark_y - math.sin(angle) * half)} "
                f"L{n(mark_x + math.cos(angle) * half)},{n(mark_y + math.sin(angle) * half)}", None)
    lean = rng.uniform(-0.7, 0.7)
    mark_height = rng.uniform(2.0, 2.8)
    return f"M{n(mark_x)},{n(mark_y)} L{n(mark_x + lean)},{n(mark_y - mark_height)}", None


def build_tile_variant(region: dict, kind: str, variant_index: int) -> tuple[str, list[tuple[float, float, float, float]]]:
    """One tile variant plus the blob boxes the edge-band rule constrains."""
    kind_index = TILE_KINDS.index(kind)
    rng = random.Random(9000 + region["id"] * 100 + kind_index * 10 + variant_index)
    if kind == "path":
        content, boxes = path_tile(rng, region["path_fill"])
    else:
        content, boxes = soft_blob_terrain(rng, region["ramp"][kind_index - 1], kind_index - 1)
    return f'<svg viewBox="0 0 {TILE_SIZE} {TILE_SIZE}">{content}</svg>', boxes


def base_svg(region: dict) -> str:
    accent = region["accent"]
    dark = mix_toward_black(region["ramp"][2], 0.2)
    parts = []
    parts.append(region_map_art.svg_element("path", {
        "d": "M20,8 L88,8 L100,20 L100,88 L88,100 L20,100 L8,88 L8,20 Z",
        "fill": dark, "stroke": accent, "stroke-opacity": 0.6, "stroke-width": 1.5,
    }))
    parts.append(region_map_art.svg_element("path", {
        "d": "M22,14 L86,14 L94,22 L94,86 L86,94 L22,94 L14,86 L14,22 Z",
        "fill": "none", "stroke": accent, "stroke-opacity": 0.25, "stroke-width": 1,
    }))
    for index in range(8):
        angle = math.radians(index * 45)
        parts.append(region_map_art.line(54 + math.cos(angle) * 20, 54 + math.sin(angle) * 20,
                                         54 + math.cos(angle) * 40, 54 + math.sin(angle) * 40,
                                         stroke=accent, stroke_width=1, opacity=0.25))
    parts.append(region_map_art.circle(54, 54, 2.5, fill=accent, opacity=0.5))
    parts.append(region_map_art.svg_element("polygon", {
        "points": region_map_art.regular_polygon_points(54, 54, 26, 6),
        "fill": accent, "fill-opacity": 0.18, "stroke": accent, "stroke-opacity": 0.5, "stroke-width": 1,
    }))
    parts.append(region_map_art.polygon(region_map_art.regular_polygon_points(54, 54, 14, 6), fill=accent))
    parts.append(region_map_art.circle(50, 50, 4, fill="#ffffff", opacity=0.45))
    for gem_x, gem_y in ((24, 24), (84, 24), (24, 84), (84, 84)):
        parts.append(region_map_art.circle(gem_x, gem_y, 4, fill="var(--color-gem)"))
        parts.append(region_map_art.circle(gem_x - 1.5, gem_y - 1.5, 1.6, fill="#ffffff", opacity=0.5))
    return f'<svg viewBox="0 0 108 108">{"".join(parts)}</svg>'


def spawn_svg(state: str) -> str:
    color = SPAWN_OPEN_GREEN if state == "open" else SPAWN_RED
    parts = [region_map_art.circle(18, 18, 11, stroke=color, stroke_width=2,
                                   dash="5 4" if state == "transition" else None),
             region_map_art.circle(18, 18, 2.5, fill=color)]
    if state == "closed":
        parts.extend(region_map_art.line(x1, y1, x2, y2, stroke=color, stroke_width=2)
                     for x1, y1, x2, y2 in ((18, 9, 18, 1), (18, 27, 18, 35), (9, 18, 1, 18), (27, 18, 35, 18)))
    elif state == "transition":
        parts.extend(region_map_art.line(x1, y1, x2, y2, stroke=color, stroke_width=2)
                     for x1, y1, x2, y2 in ((18, 13.5, 18, 16.5), (18, 22.5, 18, 19.5),
                                            (13.5, 18, 16.5, 18), (22.5, 18, 19.5, 18)))
    else:
        parts.append(region_map_art.path_shape("M15,5.5 L18,1.5 L21,5.5 M15,30.5 L18,34.5 L21,30.5 "
                                               "M5.5,15 L1.5,18 L5.5,21 M30.5,15 L34.5,18 L30.5,21",
                                               stroke=color, stroke_width=2))
    return f'<svg viewBox="0 0 {TILE_SIZE} {TILE_SIZE}">{"".join(parts)}</svg>'


# ===== Map site art (drawn at 26 world px from a 36x36 authoring box) =====


def site_plinth() -> list[str]:
    return [
        region_map_art.ellipse(18, 29.5, 10.5, 3.4, fill=FOOTPRINT_SHADOW_FILL),
        region_map_art.rect(8.5, 24.5, 19, 5, rx=1, fill=PLINTH_FILL, stroke=BUILDING_OUTLINE, stroke_width=0.8),
        region_map_art.rect(8.5, 24.5, 19, 1.8, fill=PLINTH_TOP_FILL),
    ]


def building_svg(kind: str) -> str:
    color = BUILDING_COLORS[kind]
    light = mix_toward_white(color, 0.35)
    dark = mix_toward_black(color, 0.35)
    parts = site_plinth()
    if kind == "armory":
        # Blade rack: two crossed blades on a post.
        parts.append(region_map_art.path_shape("M13,9 L16.4,11.6 L16.4,24.4 L13,26.8 Z",
                                               fill=color, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.path_shape("M23,9 L19.6,11.6 L19.6,24.4 L23,26.8 Z",
                                               fill=dark, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.rect(16.6, 12, 2.8, 12, fill=light, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.line(9.5, 24.4, 26.5, 24.4, stroke=BUILDING_OUTLINE, stroke_width=1.4))
    elif kind == "magazine":
        # Shell stack: three rounds narrowing upward on a crate base.
        parts.append(region_map_art.rect(10, 20.5, 16, 4.5, fill=dark, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        for tier, (tier_width, tier_height, tier_y) in enumerate(((14, 4.5, 16), (11, 4.5, 11.5), (8, 4.5, 7))):
            parts.append(region_map_art.rect(18 - tier_width / 2, tier_y, tier_width, tier_height,
                                             fill=color if tier % 2 == 0 else light,
                                             stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.line(11.5, 22.8, 24.5, 22.8, stroke=light, stroke_width=0.7, opacity=0.6))
    elif kind == "beacon":
        # Lamp tower: a tapered mast with a lit diamond.
        parts.append(region_map_art.path_shape("M14.5,24.5 L16.6,12 L19.4,12 L21.5,24.5 Z",
                                               fill=dark, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.rect(15.2, 20, 5.6, 1.6, fill=light, opacity=0.7))
        parts.append(region_map_art.polygon(region_map_art.regular_polygon_points(18, 8.5, 4.6, 4),
                                            fill=light, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.circle(18, 8.5, 1.5, fill="#ffffff", opacity=0.75))
        parts.append(region_map_art.line(18, 2.6, 18, 4.4, stroke=light, stroke_width=0.9))
        parts.append(region_map_art.line(12.4, 8.5, 14.2, 8.5, stroke=light, stroke_width=0.9))
        parts.append(region_map_art.line(23.6, 8.5, 21.8, 8.5, stroke=light, stroke_width=0.9))
    elif kind == "foundry":
        # Forge: a squat furnace body with a wide arched firebox and a capped
        # chimney climbing the left side. The chimney is the one mark that rises
        # clear of the body, so the silhouette is notched where the magazine is
        # stepped.
        parts.append(region_map_art.path_shape("M9.5,24.5 L9.5,15.5 L26.5,15.5 L26.5,24.5 Z",
                                               fill=color, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.rect(9.5, 15.5, 17, 1.8, fill=light, opacity=0.7))
        parts.append(region_map_art.path_shape(
            "M16,24.5 L16,20 Q16,17 19,17 L21,17 Q24,17 24,20 L24,24.5 Z",
            fill=dark, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.path_shape(
            "M17.8,24.5 L17.8,20.6 Q17.8,18.6 19.6,18.6 L20.4,18.6 Q22.2,18.6 22.2,20.6 L22.2,24.5 Z",
            fill=light))
        parts.append(region_map_art.line(17.8, 22.6, 22.2, 22.6, stroke=dark, stroke_width=0.6))
        parts.append(region_map_art.rect(9.8, 4.6, 4.6, 11.4, fill=dark,
                                         stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.rect(8.8, 3.4, 6.6, 2.2, rx=0.4, fill=color,
                                         stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.ellipse(12.1, 2.2, 2.6, 1.2, fill=light, opacity=0.35))
    elif kind == "clocktower":
        # Clock tower: a tapered case under a spire, a dial with hands, and the
        # counterweight still hanging off the right face on its cord.
        parts.append(region_map_art.path_shape("M12.8,24.5 L13.8,9.8 L22.2,9.8 L23.2,24.5 Z",
                                               fill=dark, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.polygon("18,3 24.2,9.8 11.8,9.8",
                                            fill=color, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.circle(18, 14.6, 4.6, fill=color,
                                          stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.circle(18, 14.6, 3.2, fill=light))
        parts.append(region_map_art.line(18, 14.6, 18, 12, stroke=BUILDING_OUTLINE, stroke_width=0.9))
        parts.append(region_map_art.line(18, 14.6, 20.6, 15.4, stroke=BUILDING_OUTLINE, stroke_width=0.9))
        parts.append(region_map_art.line(22.4, 10.8, 26.6, 10.8, stroke=dark, stroke_width=0.8))
        parts.append(region_map_art.line(26.6, 10.8, 26.6, 20, stroke=dark, stroke_width=0.8))
        parts.append(region_map_art.circle(26.6, 22.2, 2.2, fill=light,
                                          stroke=BUILDING_OUTLINE, stroke_width=0.8))
    elif kind == "aviary":
        # Bird roost: a flight chevron over a ridge roof and a netted cage holding
        # a perched bird. The lattice is the tell at 26px: the armory crosses two
        # blades and the magazine stacks three solid rounds.
        parts.append(region_map_art.path_shape("M13.6,4.2 L18,7.2 L22.4,4.2", "none",
                                               stroke=color, stroke_width=1.5))
        parts.append(region_map_art.polygon("18,8 26.4,12.8 9.6,12.8",
                                            fill=color, stroke=BUILDING_OUTLINE, stroke_width=0.8))
        parts.append(region_map_art.rect(11.4, 12.8, 13.2, 11.7, fill=light,
                                         stroke=BUILDING_OUTLINE, stroke_width=0.9))
        for net_x in (14.4, 18, 21.6):
            parts.append(region_map_art.line(net_x, 13.8, net_x, 21.4, stroke=color,
                                             stroke_width=0.6, opacity=0.75))
        parts.append(region_map_art.line(12.4, 15.4, 23.6, 15.4, stroke=color,
                                         stroke_width=0.6, opacity=0.75))
        parts.append(region_map_art.rect(12.4, 19.4, 11.2, 1.8, fill=color,
                                         stroke=BUILDING_OUTLINE, stroke_width=0.6))
        parts.append(region_map_art.ellipse(16.2, 17.8, 2.4, 1.8, fill=dark))
        parts.append(region_map_art.circle(18.4, 16.6, 1.2, fill=dark))
    return f'<svg viewBox="0 0 {TILE_SIZE} {TILE_SIZE}">{"".join(parts)}</svg>'


def cache_body_svg(fill: str) -> list[str]:
    return [
        region_map_art.ellipse(18, 29.5, 10.5, 3.4, fill=FOOTPRINT_SHADOW_FILL),
        region_map_art.rect(8, 12, 20, 15, rx=1, fill=fill, stroke=CACHE_OUTLINE, stroke_width=1),
        region_map_art.rect(8, 12, 20, 1.6, fill=mix_toward_white(fill, 0.25)),
    ]


def cache_svg(state: str) -> str:
    if state == "sealed":
        parts = cache_body_svg(CACHE_BODY)
        parts.append(region_map_art.rect(7, 8.5, 22, 4.5, rx=0.8, fill=mix_toward_white(CACHE_BODY, 0.12),
                                         stroke=CACHE_OUTLINE, stroke_width=1))
        parts.append(region_map_art.rect(15.5, 12, 5, 5.5, rx=0.6, fill=CACHE_OUTLINE))
        parts.append(region_map_art.circle(18, 14.6, 1.1, fill=CACHE_INK, opacity=0.85))
        parts.append(region_map_art.rect(17.4, 15.4, 1.2, 1.6, fill=CACHE_INK, opacity=0.85))
    elif state == "unlocked":
        # Open: lid tipped back off the mouth, dark interior, light shaft, and the
        # card that came out of it still standing in the opening.
        parts = [
            region_map_art.ellipse(18, 29.5, 10.5, 3.4, fill=FOOTPRINT_SHADOW_FILL),
            region_map_art.path_shape("M9,13 L27,13 L29,4 L7,4 Z", fill=CACHE_INK, opacity=0.16),
            region_map_art.rect(8, 12, 20, 15, rx=1, fill=CACHE_BODY, stroke=CACHE_OUTLINE, stroke_width=1),
            region_map_art.rect(9.5, 13.5, 17, 2.6, fill="#3a2810"),
            region_map_art.rect(8, 12, 20, 1.6, fill=mix_toward_white(CACHE_BODY, 0.25)),
            region_map_art.svg_element("rect", {
                "x": 7, "y": 5.5, "width": 22, "height": 5, "rx": 0.8,
                "fill": mix_toward_white(CACHE_BODY, 0.2), "stroke": CACHE_OUTLINE,
                "stroke-width": 1, "transform": "rotate(-14 18 8)",
            }),
            region_map_art.svg_element("rect", {
                "x": 15, "y": 8.5, "width": 6, "height": 6.5, "rx": 0.6,
                "fill": CACHE_INK, "stroke": CACHE_OUTLINE, "stroke-width": 0.7,
                "transform": "rotate(-6 18 11)",
            }),
        ]
    else:
        parts = cache_body_svg(CACHE_BODY_DARK)
        parts.append(region_map_art.path_shape("M7.5,7 L28.5,4.5 L28.5,9 L7.5,11.5 Z",
                                               fill=mix_toward_white(CACHE_BODY_DARK, 0.12),
                                               stroke=CACHE_OUTLINE, stroke_width=1))
        parts.append(region_map_art.path_shape("M13,12 L16.5,17 L14,20 L18,27 M22,12 L20.5,18.5 L24,23",
                                               stroke=CACHE_OUTLINE, stroke_width=1.1, opacity=0.75))
        parts.append(region_map_art.circle(13.5, 27.5, 1.8, fill=CACHE_INK_BROKEN, opacity=0.8))
        parts.append(region_map_art.circle(18.5, 28.5, 1.4, fill=CACHE_INK_BROKEN, opacity=0.6))
        parts.append(region_map_art.circle(23, 27, 1.6, fill=CACHE_INK_BROKEN, opacity=0.7))
    return f'<svg viewBox="0 0 {TILE_SIZE} {TILE_SIZE}">{"".join(parts)}</svg>'


def supply_drop_svg() -> str:
    color = "#e0c040"
    parts = [
        region_map_art.ellipse(18, 29.5, 10.5, 3.4, fill=FOOTPRINT_SHADOW_FILL),
        region_map_art.rect(8, 12.5, 20, 15, rx=1.2, fill=color, stroke="#8a7020", stroke_width=1),
        region_map_art.rect(8, 12.5, 20, 2, fill=mix_toward_white(color, 0.3)),
        region_map_art.path_shape("M11,13 L25,27 M25,13 L11,27", stroke="#8a7020", stroke_width=1.4),
        region_map_art.rect(14.5, 10, 7, 3, rx=0.6, fill="#f0dc80", stroke="#8a7020", stroke_width=0.9),
    ]
    return f'<svg viewBox="0 0 {TILE_SIZE} {TILE_SIZE}">{"".join(parts)}</svg>'


# ===== Validation =====


def non_color_numbers(svg: str) -> list[float]:
    stripped = re.sub(r'(?:fill|stroke)="[^"]*"', "", svg)
    return [float(value) for value in re.findall(r"\d+\.?\d*", stripped)]


def assert_flat_paint(svg: str, label: str, box_size: float) -> None:
    if not svg.startswith("<svg "):
        raise SystemExit(f"{label}: art must open with an svg wrapper")
    if "url(#" in svg or "<filter" in svg:
        raise SystemExit(f"{label}: art uses a document-scoped paint server or filter")
    for value in non_color_numbers(svg):
        if value > box_size + 0.5:
            raise SystemExit(f"{label}: coordinate {value} runs past the {box_size}px bounds")


def assert_tile_paint(svg: str, label: str) -> None:
    assert_flat_paint(svg, label, TILE_SIZE)
    if f'<svg viewBox="0 0 {TILE_SIZE} {TILE_SIZE}">' not in svg:
        raise SystemExit(f"{label}: tile must open with the 36x36 viewBox wrapper")
    first_fill = re.search(r'fill="(#[0-9a-fA-F]{3,8})"', svg)
    if not first_fill:
        raise SystemExit(f"{label}: tile has no hex field fill")
    tag = svg[svg.rfind("<", 0, first_fill.start()):svg.find(">", first_fill.start())]
    if not tag.startswith("<rect") or 'width="36"' not in tag or 'height="36"' not in tag:
        raise SystemExit(f"{label}: first fill is not the full-bleed 36x36 field rect")
    byte_length = len(svg.encode("utf-8"))
    if not TILE_BYTE_MIN <= byte_length <= TILE_BYTE_MAX:
        raise SystemExit(f"{label}: tile is {byte_length} bytes, outside the {TILE_BYTE_MAX}-{TILE_BYTE_MIN} budget")


def assert_tile_edge_band(boxes: list[tuple[float, float, float, float]], label: str) -> None:
    for min_x, min_y, max_x, max_y in boxes:
        if min_x < EDGE_BAND - 0.05 or min_y < EDGE_BAND - 0.05:
            raise SystemExit(f"{label}: blob reaches {min_x},{min_y} inside the {EDGE_BAND}px edge band")
        if max_x > TILE_SIZE - EDGE_BAND + 0.05 or max_y > TILE_SIZE - EDGE_BAND + 0.05:
            raise SystemExit(f"{label}: blob reaches {max_x},{max_y} inside the {EDGE_BAND}px edge band")


def assert_boxed_art(svg: str, label: str, box_size: float) -> None:
    assert_flat_paint(svg, label, box_size)
    expected_view_box = f'<svg viewBox="0 0 {n(box_size)} {n(box_size)}">'
    if expected_view_box not in svg:
        raise SystemExit(f"{label}: art must open with {expected_view_box}")


# ===== JSON patching =====


def json_array_lines(variants: list[str], field_indent: str) -> str:
    """One variant per line, which is the shape biome formats JSON into, so the
    generator's output and `npm run lint:fix` agree."""
    inner = field_indent + "  "
    entries = ",\n".join(f"{inner}{json.dumps(variant)}" for variant in variants)
    return f"[\n{entries}\n{field_indent}]"


def patch_field_values(raw_text: str, field_name: str, images: list[list[str]]) -> str:
    """Replaces every occurrence of a top-level field with its variant list.

    The value is located by scanning rather than by a line regex, because a JSON
    formatter may spread one array over several lines.
    """
    patched_text = raw_text
    field_pattern = re.compile(rf'^([ \t]*)"{field_name}": ', re.MULTILINE)
    search_from = 0
    replaced = 0
    while True:
        match = field_pattern.search(patched_text, search_from)
        if not match:
            break
        if replaced >= len(images):
            raise SystemExit(f"more {field_name} fields in file than generated images")
        value_start = match.end()
        value_end = theme_field_patch.find_value_span(patched_text, value_start)
        variants = json_array_lines(images[replaced], match.group(1))
        patched_text = patched_text[:value_start] + variants + patched_text[value_end:]
        replaced += 1
        search_from = value_start + len(variants)
    if replaced != len(images):
        raise SystemExit(f"expected {len(images)} {field_name} fields, replaced {replaced}")
    return patched_text


def strip_svg_wrapper(svg_text: str) -> str:
    open_tag = re.match(r"^<svg[^>]*>", svg_text)
    return svg_text[len(open_tag[0]):-len("</svg>")] if open_tag else svg_text


# ===== Preview page =====


def tile_instance(tile_content: str, rotation: int, size: int, cell_x: int = 0, cell_y: int = 0) -> str:
    """One tile at one rotation. The art is inlined rather than referenced through
    a <symbol>, so the preview renders in headless browsers whose <use> support is
    incomplete; the game itself instantiates tiles via <use>."""
    rotation_group = f'<g transform="rotate({rotation} 18 18)">' if rotation else ""
    # Nested <svg> needs an explicit position; without x/y every cell stacks at 0,0.
    return (f'<svg x="{cell_x}" y="{cell_y}" width="{size}" height="{size}" viewBox="0 0 36 36" overflow="hidden">'
            f"{rotation_group}{strip_svg_wrapper(tile_content)}"
            f"{'</g>' if rotation else ''}</svg>")


def mosaic_kind(column: int, row: int, columns: int, rows: int) -> str:
    """A contiguous peak layout rather than a per-cell alternation: real maps
    group a height into a blob, and that is the case where a repeated tile stamp
    would show."""
    center_x = (columns - 1) / 2
    center_y = (rows - 1) / 2
    distance = math.hypot(column - center_x, row - center_y) / math.hypot(center_x, center_y)
    height = 1 + min(3, int(round((1 - distance) * 3.2)))
    on_path_row = row in (rows // 2, rows // 2 + 1)
    on_path_column = abs(column - columns // 2) <= 1 and (row + column) % 3 != 0
    if on_path_row or on_path_column:
        return "path"
    return f"terrain{height}"


def mosaic_markup(region_id: int, tiles: dict[str, list[str]], columns: int, rows: int, cell_size: int) -> str:
    """Stitches a synthetic map so repetition and cell seams are visible at the
    gameplay zoom."""
    cells = []
    for row in range(rows):
        for column in range(columns):
            kind = mosaic_kind(column, row, columns, rows)
            variants = tiles[kind]
            variant_index = tile_variant_index(9137, column, row, len(variants))
            rotation = tile_rotation(9137, column, row) * 90
            cells.append(
                tile_instance(variants[variant_index], rotation, cell_size, column * TILE_SIZE, row * TILE_SIZE)
            )
    return "".join(cells)


def imul(left: int, right: int) -> int:
    """32-bit integer multiply, matching Math.imul."""
    return (left * right) & 0xFFFFFFFF


def tile_variant_index(seed: int, tile_x: int, tile_y: int, variant_count: int) -> int:
    """Mirrors tileVariantIndex in src/render/themes/tileArt.ts."""
    if variant_count <= 1:
        return 0
    mixed = imul(seed ^ (tile_x + 0x85EB), 0x2545F491) ^ imul(tile_y + 0x1B873, 0x27D4EB2F)
    return mixed % variant_count


def tile_rotation(seed: int, tile_x: int, tile_y: int) -> int:
    """Mirrors progressiveTileRotation in src/sim/grid/ProgressiveMap.ts."""
    mixed = imul(seed ^ (tile_x + 0x9E37), 0x45D9F3B) ^ imul(tile_y + 0x27D4, 0x27D4EB2D)
    return mixed % 4


def write_preview(tiles: dict[int, dict[str, list[str]]], bases: list[str], spawns: dict[str, str],
                  sites: dict[str, str]) -> None:
    sections = []
    for region in REGIONS:
        kind_rows = []
        for kind in TILE_KINDS:
            rotation_rows = []
            for variant_index in range(TILE_VARIANT_COUNT):
                suffix = f"-v{variant_index}" if variant_index else ""
                cells = "".join(
                    tile_instance(tiles[region["id"]][kind][variant_index], rotation, size)
                    for size in (36, 108)
                    for rotation in (0, 90, 180, 270)
                )
                rotation_rows.append(f'<div class="size-row"><span class="label">v{variant_index}</span>{cells}</div>')
            hero = tile_instance(tiles[region["id"]][kind][0], 0, 324)
            kind_rows.append(f'<div class="kind"><div class="label">{kind}</div>{"".join(rotation_rows)}{hero}</div>')
        mosaic = "".join(
            f'<div class="size-row"><span class="label">{cell_size}px</span>'
            f'<svg width="{cell_size * 12}" height="{cell_size * 8}" viewBox="0 0 {12 * TILE_SIZE} {8 * TILE_SIZE}" '
            f'overflow="hidden">{mosaic_markup(region["id"], tiles[region["id"]], 12, 8, cell_size)}</svg></div>'
            for cell_size in (36, 72)
        )
        sections.append(
            f'<section class="region"><h2>{region["name"]}</h2><div class="kinds">{"".join(kind_rows)}</div>'
            f'<h3>Stitched map</h3><div class="mosaic">{mosaic}</div></section>'
        )

    def scaled(content: str, size: float, box_size: float) -> str:
        return f'<svg width="{size}" height="{size}" viewBox="0 0 {n(box_size)} {n(box_size)}">{strip_svg_wrapper(content)}</svg>'

    base_rows = "".join(
        f'<div class="size-row"><span class="label">region {region["id"]}</span>'
        + scaled(bases[region["id"]], 108, BASE_BOX_SIZE)
        + scaled(bases[region["id"]], 216, BASE_BOX_SIZE)
        + "</div>"
        for region in REGIONS
    )
    spawn_rows = "".join(
        f'<div class="size-row"><span class="label">{state}</span>'
        + "".join(scaled(spawns[state], size, TILE_SIZE) for size in (36, 72, 144))
        + "</div>"
        for state in SPAWN_STATES
    )
    site_rows = "".join(
        f'<div class="size-row"><span class="label">{site_id}</span>'
        + "".join(scaled(content, size, TILE_SIZE) for size in (26, 52, 104))
        + "</div>"
        for site_id, content in sites.items()
    )

    page = (
        '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Polymath art preview</title>'
        "<style>html,body{margin:0;padding:16px;background:#101010;color:#ece4d6;font-family:sans-serif;}"
        "h2{margin:18px 0 8px}h3{margin:12px 0 6px;color:#b0a18c}"
        ".region{display:flex;flex-direction:column;gap:8px}"
        ".kinds{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}"
        ".mosaic{display:flex;flex-direction:column;gap:6px}"
        ".kind{display:flex;flex-direction:column;gap:4px;border:1px solid #333;padding:8px}"
        ".size-row{display:flex;gap:6px;align-items:center;}"
        ".label{width:72px;color:#b0a18c;font-size:12px;flex:0 0 auto;}"
        "svg{background:#222;}"
        "</style></head><body>"
        + "".join(sections)
        + f'<h2>Region bases</h2><section>{base_rows}</section>'
        + f'<h2>Spawn states</h2><section>{spawn_rows}</section>'
        + f'<h2>Map site art</h2><section>{site_rows}</section>'
        + "</body></html>"
    )
    os.makedirs(PREVIEW_DIRECTORY, exist_ok=True)
    with open(os.path.join(PREVIEW_DIRECTORY, "index.html"), "w", encoding="utf-8") as page_file:
        page_file.write(page)


def main() -> None:
    with open(THEME_PATH, encoding="utf-8") as theme_file:
        raw_text = theme_file.read()
    theme = json.loads(raw_text)
    if len(theme["regions"]) != len(REGIONS):
        raise SystemExit("region count drifted from gen_polymath_art")

    tiles: dict[int, dict[str, list[str]]] = {}
    for region in REGIONS:
        tiles[region["id"]] = {}
        for kind in TILE_KINDS:
            variants = []
            for variant_index in range(TILE_VARIANT_COUNT):
                svg, boxes = build_tile_variant(region, kind, variant_index)
                label = f"region {region['id']} {kind} variant {variant_index}"
                assert_tile_paint(svg, label)
                assert_tile_edge_band(boxes, label)
                # Also check the shipped string, so the rule cannot be satisfied by
                # geometry the emitted SVG does not actually contain.
                assert_tile_edge_band(blob_boxes_in(strip_svg_wrapper(svg)), f"{label} shipped string")
                variants.append(svg)
            tiles[region["id"]][kind] = variants

    bases = [base_svg(region) for region in REGIONS]
    for region_index, base in enumerate(bases):
        assert_boxed_art(base, f"region {region_index} base", BASE_BOX_SIZE)

    spawns = {state: spawn_svg(state) for state in SPAWN_STATES}
    for state in SPAWN_STATES:
        assert_boxed_art(spawns[state], f"spawn {state}", TILE_SIZE)

    sites: dict[str, str] = {}
    for kind in BUILDING_KINDS:
        sites[f"building-{kind}"] = building_svg(kind)
    for state in CACHE_STATES:
        sites[f"cache-{state}"] = cache_svg(state)
    sites["supply-drop"] = supply_drop_svg()
    for site_id, content in sites.items():
        assert_boxed_art(content, f"site {site_id}", TILE_SIZE)

    patched_text = raw_text
    for kind in TILE_KINDS:
        patched_text = patch_field_values(
            patched_text, kind, [tiles[region["id"]][kind] for region in REGIONS]
        )

    patched_text = theme_field_patch.replace_field_value_spans(
        patched_text, "base", [json.dumps(base, ensure_ascii=False) for base in bases]
    )
    sites_value = {
        "buildings": {kind: sites[f"building-{kind}"] for kind in BUILDING_KINDS},
        "caches": {state: sites[f"cache-{state}"] for state in CACHE_STATES},
        "supplyDrop": sites["supply-drop"],
    }
    patched_text = theme_field_patch.replace_top_level_value(
        patched_text, "sites", theme_field_patch.render_value(sites_value)
    )
    patched_text = theme_field_patch.replace_top_level_value(
        patched_text, "spawns", theme_field_patch.render_value(spawns)
    )

    json.loads(patched_text)
    with open(THEME_PATH, "w", encoding="utf-8") as theme_file:
        theme_file.write(patched_text)
    write_preview(tiles, bases, spawns, sites)
    tile_count = len(REGIONS) * len(TILE_KINDS) * TILE_VARIANT_COUNT
    print(f"polymath: patched {tile_count} tile variants + 3 bases + 3 spawn states + {len(sites)} site images")
    print(f"previews: {PREVIEW_DIRECTORY}")


if __name__ == "__main__":
    main()