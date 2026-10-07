#!/usr/bin/env python3
"""Draw the Aftermath map theme and update its generated fields in data/the-aftermath.json.

Flat three-tone paint, no gradients and no url() references. Tower symbols are
clipped to viewBox -16 -16 32 32, enemies to -1 -1 2 2, tiles and spawns to
0 0 36 36. Base art is inserted with the outer svg stripped, so its coordinates
are game pixels across the 108px (3x36) camp footprint.
"""

from __future__ import annotations

import json
import math
import os
import random
import re
import sys
from typing import Callable, NamedTuple

SCRIPT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIRECTORY)
import menu_background_art  # noqa: E402
import region_map_art  # noqa: E402
import theme_field_patch  # noqa: E402

THEME_PATH = os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "the-aftermath.json"))
SHEET_PATH = os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "..", "..", "..", "tmp", "aftermath-contact.html"))

INK = "#1a120e"
STEEL = "#5c656e"
STEEL_DARK = "#2e353c"
STEEL_LIGHT = "#a8b0b8"
BONE = "#e4d3b0"
BONE_DARK = "#b7a27a"
HAZARD = "#e2c044"
SCRAP_WOOD = "#6a4e38"
SCRAP_WOOD_DARK = "#3a2a1c"
SCRAP_WOOD_LIGHT = "#a68462"


def num(value: float) -> str:
    rounded = round(float(value), 2)
    if abs(rounded) < 0.005:
        return "0"
    text = f"{rounded:.2f}".rstrip("0").rstrip(".")
    return text


def svg_element(name: str, attributes: dict[str, object]) -> str:
    parts = [f"<{name}"]
    for key, value in attributes.items():
        if value is None:
            continue
        parts.append(f' {key}="{value}"')
    parts.append("/>")
    return "".join(parts)


def svg_group(content: str, transform: str | None = None) -> str:
    if not content:
        return ""
    if transform:
        return f'<g transform="{transform}">{content}</g>'
    return f"<g>{content}</g>"


def svg_root(view_box: str, content: str) -> str:
    wrapped = f'<g stroke-linejoin="round" stroke-linecap="round">{content}</g>'
    return f'<svg viewBox="{view_box}">{wrapped}</svg>'


def ellipse(
    center_x: float,
    center_y: float,
    radius_x: float,
    radius_y: float,
    fill: str,
    stroke: str | None = None,
    stroke_width: float | None = None,
    opacity: float | None = None,
) -> str:
    return svg_element(
        "ellipse",
        {
            "cx": num(center_x),
            "cy": num(center_y),
            "rx": num(radius_x),
            "ry": num(radius_y),
            "fill": fill,
            "stroke": stroke,
            "stroke-width": None if stroke_width is None else num(stroke_width),
            "opacity": None if opacity is None else num(opacity),
        },
    )


def circle(
    center_x: float,
    center_y: float,
    radius: float,
    fill: str,
    stroke: str | None = None,
    stroke_width: float | None = None,
    opacity: float | None = None,
) -> str:
    return svg_element(
        "circle",
        {
            "cx": num(center_x),
            "cy": num(center_y),
            "r": num(radius),
            "fill": fill,
            "stroke": stroke,
            "stroke-width": None if stroke_width is None else num(stroke_width),
            "opacity": None if opacity is None else num(opacity),
        },
    )


def rect(
    origin_x: float,
    origin_y: float,
    width: float,
    height: float,
    radius: float,
    fill: str,
    stroke: str | None = None,
    stroke_width: float | None = None,
    opacity: float | None = None,
) -> str:
    return svg_element(
        "rect",
        {
            "x": num(origin_x),
            "y": num(origin_y),
            "width": num(width),
            "height": num(height),
            "rx": num(radius) if radius else None,
            "fill": fill,
            "stroke": stroke,
            "stroke-width": None if stroke_width is None else num(stroke_width),
            "opacity": None if opacity is None else num(opacity),
        },
    )


def path_shape(
    path_data: str,
    fill: str,
    stroke: str | None = None,
    stroke_width: float | None = None,
    opacity: float | None = None,
) -> str:
    return svg_element(
        "path",
        {
            "d": path_data,
            "fill": fill,
            "stroke": stroke,
            "stroke-width": None if stroke_width is None else num(stroke_width),
            "opacity": None if opacity is None else num(opacity),
        },
    )


def line(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    stroke: str,
    stroke_width: float,
    opacity: float | None = None,
) -> str:
    return svg_element(
        "line",
        {
            "x1": num(x1),
            "y1": num(y1),
            "x2": num(x2),
            "y2": num(y2),
            "stroke": stroke,
            "stroke-width": num(stroke_width),
            "opacity": None if opacity is None else num(opacity),
        },
    )


def polygon(
    points: list[tuple[float, float]],
    fill: str,
    stroke: str | None = None,
    stroke_width: float | None = None,
    opacity: float | None = None,
) -> str:
    rendered = " ".join(f"{num(point_x)},{num(point_y)}" for point_x, point_y in points)
    return svg_element(
        "polygon",
        {
            "points": rendered,
            "fill": fill,
            "stroke": stroke,
            "stroke-width": None if stroke_width is None else num(stroke_width),
            "opacity": None if opacity is None else num(opacity),
        },
    )


def volume_offset(space: str) -> float:
    if space == "tower":
        return 1.15
    return 0.05


def volume_ellipse(
    center_x: float,
    center_y: float,
    radius_x: float,
    radius_y: float,
    body: str,
    shadow: str,
    highlight: str,
    stroke: str,
    stroke_width: float,
    space: str,
) -> str:
    offset = volume_offset(space)
    shadow_shape = ellipse(center_x + offset, center_y + offset, radius_x, radius_y, shadow)
    body_shape = ellipse(center_x, center_y, radius_x, radius_y, body, stroke, stroke_width)
    chip = ellipse(
        center_x - radius_x * 0.28,
        center_y - radius_y * 0.32,
        max(radius_x * 0.34, offset * 0.8),
        max(radius_y * 0.28, offset * 0.55),
        highlight,
        opacity=0.9,
    )
    return shadow_shape + body_shape + chip


def volume_rect(
    origin_x: float,
    origin_y: float,
    width: float,
    height: float,
    radius: float,
    body: str,
    shadow: str,
    highlight: str,
    stroke: str,
    stroke_width: float,
    space: str,
) -> str:
    offset = volume_offset(space)
    shadow_shape = rect(origin_x + offset, origin_y + offset, width, height, radius, shadow)
    body_shape = rect(origin_x, origin_y, width, height, radius, body, stroke, stroke_width)
    chip_width = max(width * 0.42, offset * 2)
    chip_height = max(height * 0.22, offset * 0.7)
    chip = rect(
        origin_x + width * 0.1,
        origin_y + height * 0.12,
        chip_width,
        chip_height,
        min(radius, 0.8),
        highlight,
        opacity=0.55,
    )
    return shadow_shape + body_shape + chip


def muzzle_flash(origin_x: float, origin_y: float) -> str:
    outer = polygon(
        [
            (origin_x, origin_y - 2.4),
            (origin_x + 3.3, origin_y - 3.3),
            (origin_x + 1.9, origin_y - 0.7),
            (origin_x + 3.9, origin_y),
            (origin_x + 1.9, origin_y + 0.7),
            (origin_x + 3.3, origin_y + 3.3),
            (origin_x, origin_y + 2.4),
            (origin_x + 1.1, origin_y),
        ],
        "#ff9a1f",
    )
    inner = polygon(
        [
            (origin_x + 0.4, origin_y - 1.2),
            (origin_x + 2.2, origin_y - 1.5),
            (origin_x + 2.6, origin_y),
            (origin_x + 2.2, origin_y + 1.5),
            (origin_x + 0.4, origin_y + 1.2),
        ],
        "#fff1c2",
    )
    return outer + inner


def smoke_puff(origin_x: float, origin_y: float) -> str:
    return (
        circle(origin_x, origin_y - 1.1, 1.7, "#8d8882", opacity=0.45)
        + circle(origin_x + 1.6, origin_y + 1.0, 1.15, "#c2bbb2", opacity=0.38)
    )


def wheel(center_x: float, center_y: float, radius: float) -> str:
    return circle(center_x, center_y, radius, "#241c16", INK, 0.7) + circle(
        center_x, center_y, radius * 0.38, "#8a8074", "#3a342c", 0.45
    )


def bolt(center_x: float, center_y: float) -> str:
    return circle(center_x, center_y, 0.55, "#d9d0c4", "#4a4338", 0.35)


def tower_svg(content: str) -> str:
    return svg_root("-16 -16 32 32", content)


def enemy_svg(content: str) -> str:
    return svg_root("-1 -1 2 2", content)


def tile_svg(content: str) -> str:
    return svg_root("0 0 36 36", content)


def base_svg(content: str) -> str:
    return svg_root("0 0 108 108", content)


# --- towers -----------------------------------------------------------------


def ten_miss_body() -> str:
    barrel_dark = path_shape("M-1 0 L5.2 -2.4 L13.2 0.3", "none", "#6a3d18", 4.5)
    barrel = path_shape("M-1 0 L5.2 -2.4 L13.2 0.3", "none", "#b87333", 3.15)
    barrel_light = path_shape("M-0.6 -0.7 L5 -3 L12.4 -0.5", "none", "#e2a86a", 1.05)
    muzzle = circle(13.2, 0.3, 1.55, "#3a3028", INK, 0.55)
    ticks = []
    for tick_index in range(4):
        tick_x = 1.2 + tick_index * 2.15
        ticks.append(line(tick_x, -4.6, tick_x, -2.7, INK, 0.7))
    cross = line(10.2, -4.7, 12.2, -2.8, INK, 0.75) + line(12.2, -4.7, 10.2, -2.8, INK, 0.75)
    cart = volume_rect(-8.2, -5.2, 9.4, 10.4, 1.2, SCRAP_WOOD, SCRAP_WOOD_DARK, SCRAP_WOOD_LIGHT, INK, 0.8, "tower")
    return (
        wheel(-9.2, -5.6, 3.15)
        + wheel(-9.2, 5.6, 3.15)
        + cart
        + bolt(-5.4, -3.2)
        + bolt(-2.2, 3.1)
        + barrel_dark
        + barrel
        + barrel_light
        + muzzle
        + "".join(ticks)
        + cross
    )


def ten_miss(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -1.7, "smoke": -0.45}[pose]
    body = svg_group(ten_miss_body(), f"translate({num(shift)} 0)")
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(11.6, 0.3)
    elif pose == "smoke":
        effect = smoke_puff(12.4, -0.4)
    return tower_svg(body + effect)


def cryo_body(coil_color: str, coil_width: float) -> str:
    handles = (
        line(-13.2, -3.6, -6.4, -3.6, STEEL_DARK, 1.5)
        + line(-13.2, 3.6, -6.4, 3.6, STEEL_DARK, 1.5)
        + line(-13.2, -3.6, -13.2, 3.6, STEEL, 1.7)
    )
    compressor = volume_rect(-6.6, -6.4, 11.2, 12.8, 1.6, "#4e5964", "#2a3138", "#8ea0ac", INK, 0.85, "tower")
    coil = circle(1.2, 0, 3.7, "none", "#1d4e62", coil_width + 1.1) + circle(1.2, 0, 3.7, "none", coil_color, coil_width)
    coil_core = circle(1.2, 0, 1.55, "#d8f4ff", "#7ec8e4", 0.45)
    nozzle = volume_rect(4.6, -1.7, 7.4, 3.4, 0.7, STEEL, STEEL_DARK, STEEL_LIGHT, INK, 0.6, "tower")
    icicle = polygon([(9.4, 1.7), (11.3, 1.7), (10.2, 4.6)], "#e7fbff", "#7eb8d0", 0.45)
    return handles + compressor + bolt(-3.8, -4.2) + bolt(2.4, 4.2) + coil + coil_core + nozzle + icicle


def cryo(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -0.8, "smoke": -0.2}[pose]
    if pose == "discharge":
        body_art = cryo_body("#f4fdff", 2.5)
        vapor = ellipse(13.2, 0, 2.4, 1.5, "#e9fbff", opacity=0.55) + ellipse(14.2, -0.2, 1.2, 0.7, "#ffffff", opacity=0.8)
    elif pose == "smoke":
        body_art = cryo_body("#bfefff", 2.0)
        vapor = ellipse(13.4, -0.4, 1.8, 1.1, "#e7f7ff", opacity=0.28)
    else:
        body_art = cryo_body("#55ccff", 1.85)
        vapor = ""
    body = svg_group(body_art, f"translate({num(shift)} 0)")
    return tower_svg(body + vapor)


def longshot_body(barrel_origin: float) -> str:
    tripod = (
        line(-1, 2.2, -8.4, 9.4, "#3a3a3a", 1.35)
        + line(1.5, 2.4, 5.2, 10.2, "#3a3a3a", 1.35)
        + line(-1, -1.6, -7.6, -8.8, "#3a3a3a", 1.35)
    )
    stock = volume_rect(-7.4, -3.1, 7.2, 6.2, 1.0, "#4a4a4a", "#2a2a2a", "#8a8a8a", INK, 0.75, "tower")
    barrel_length = 14.2 - barrel_origin
    barrel = rect(barrel_origin, -1.15, barrel_length, 2.3, 0.5, "#7a7a7a", "#2c2c2c", 0.7)
    barrel_light = rect(barrel_origin + 0.4, -0.95, barrel_length - 1.2, 0.55, 0.2, "#c8c8c8", opacity=0.8)
    scope = volume_rect(-1.2, -5.7, 5.4, 3.1, 0.8, "#6a6a6a", "#333", "#b0b0b0", INK, 0.6, "tower")
    brim = ellipse(1.1, -6.4, 4.8, 1.35, "#c2c2c2", "#3a3a3a", 0.55)
    crown = ellipse(0.6, -8.0, 1.9, 1.7, "#8a8a8a", "#3a3a3a", 0.5)
    lens = circle(3.6, -4.15, 0.95, "#e23a3a", "#6a1010", 0.4)
    return tripod + stock + barrel + barrel_light + scope + brim + crown + lens


def longshot(pose: str) -> str:
    if pose == "discharge":
        body = longshot_body(-1.6)
        effect = rect(11.9, -0.55, 2.2, 1.1, 0.3, "#fff6e4") + muzzle_flash(12.0, 0)
    elif pose == "smoke":
        body = longshot_body(-0.4)
        effect = circle(13.4, 0, 1.15, "none", "#c8c8c8", 0.55, 0.7)
    else:
        body = longshot_body(0.4)
        effect = ""
    return tower_svg(body + effect)


def junk_cannon_body() -> str:
    chassis = volume_rect(-11.4, -7.2, 12.4, 14.4, 1.8, "#5a4a3a", "#2e241c", "#8a7560", INK, 0.9, "tower")
    drum_shadow = circle(1.8, 1.15, 6.3, "#3a2e24")
    drum = circle(0.6, 0, 6.3, "#6a5848", INK, 0.9)
    drum_light = ellipse(-1.6, -2.4, 2.4, 1.4, "#b09880", opacity=0.8)
    stripe_upper = line(-4.8, -3.4, -1.6, 0.2, HAZARD, 1.2)
    stripe_lower = line(-4.4, -0.4, -1.2, 3.0, HAZARD, 1.2)
    bore = circle(3.6, 0.2, 2.55, "#1a1410", INK, 0.55)
    spring = (
        circle(5.5, -1.7, 0.9, "none", BONE, 0.75)
        + circle(7.0, -1.7, 0.9, "none", BONE, 0.75)
        + circle(8.5, -1.7, 0.9, "none", BONE, 0.75)
    )
    can = rect(5.2, 0.85, 4.8, 2.6, 0.45, "#d4a24c", "#6a5018", 0.5)
    can_rim = ellipse(10.0, 2.15, 0.75, 1.3, "#e8c36a", "#6a5018", 0.45)
    return chassis + drum_shadow + drum + drum_light + stripe_upper + stripe_lower + bore + spring + can + can_rim


def junk_cannon(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -1.8, "smoke": -0.6}[pose]
    body = svg_group(junk_cannon_body(), f"translate({num(shift)} 0)")
    if pose == "discharge":
        scrap = (
            polygon([(8.5, -2.2), (12.4, -3.4), (11.2, -1.2)], "#d4a24c", INK, 0.4)
            + polygon([(9.2, 1.4), (13.2, 2.6), (11.4, 0.2)], BONE, INK, 0.4)
            + circle(12.6, -0.2, 0.7, STEEL_LIGHT, STEEL_DARK, 0.3)
            + muzzle_flash(8.2, 0)
        )
    elif pose == "smoke":
        scrap = (
            polygon([(10.4, 1.6), (13.6, 2.4), (12.2, 3.6)], "#d4a24c", opacity=0.7)
            + smoke_puff(11.5, -1.2)
        )
    else:
        scrap = ""
    return tower_svg(body + scrap)


def foil_hat(spark: str) -> str:
    coil = volume_ellipse(-8.4, 0.6, 3.3, 4.8, "#3a3a48", "#222028", "#8a8a98", INK, 0.7, "tower")
    coil_ring = ellipse(-8.4, 0.6, 1.6, 2.5, "none", "#ff0", 0.75)
    hat_shadow = ellipse(1.5, 0.7, 6.8, 6.2, "#6a6456")
    hat = ellipse(0.4, -0.3, 6.8, 6.2, "#d9d3c2", INK, 0.95)
    hat_light = ellipse(-1.8, -2.4, 2.6, 1.7, "#f7f3e6", opacity=0.9)
    creases = []
    for crease_index in range(6):
        angle = math.radians(-80 + crease_index * 32)
        outer_x = 0.4 + math.cos(angle) * 5.8
        outer_y = -0.3 + math.sin(angle) * 5.2
        crease_color = "#f7f3e6" if crease_index % 2 == 0 else "#8a8476"
        creases.append(line(0.4, -0.3, outer_x, outer_y, crease_color, 0.75))
    prong_upper = line(6.0, -1.5, 13.4, -3.3, "#5a5a62", 1.5) + circle(13.4, -3.3, 0.75, "#8a8a92", INK, 0.4)
    prong_lower = line(6.0, 1.5, 13.4, 3.3, "#5a5a62", 1.5) + circle(13.4, 3.3, 0.75, "#8a8a92", INK, 0.4)
    return coil + coil_ring + hat_shadow + hat + hat_light + "".join(creases) + prong_upper + prong_lower + spark


def lightning_arcs(strength: str) -> str:
    if strength == "burst":
        return (
            path_shape("M13.2 -3.2 L12.2 -1.2 L14.2 0 L12.4 1.2 L13.2 3", "none", "#fff6b0", 1.35)
            + path_shape("M12.4 -2.4 L14.6 -0.6 L12.8 1.6 L14.4 2.8", "none", "#ff0", 0.9)
            + path_shape("M11.2 -1.6 L13.8 0.4 L11.6 2.2", "none", "#fff", 0.55)
        )
    if strength == "fade":
        return path_shape("M13.2 -3.2 L12.6 -0.4 L13.2 3", "none", "#ff0", 0.7, 0.55)
    return path_shape("M12.6 -2.2 L13.4 -0.2 L12.5 1.8", "none", "#ff0", 0.85)


def lightning(pose: str) -> str:
    strength = {"rest": "idle", "discharge": "burst", "smoke": "fade"}[pose]
    return tower_svg(foil_hat(lightning_arcs(strength)))


def rail_body(gap_color: str, lance: str) -> str:
    sleepers = []
    for sleeper_x in (-6.5, -1.5, 3.5, 8.5):
        sleepers.append(rect(sleeper_x, -5.4, 2.3, 10.8, 0.4, "#6a4a32", "#3a2818", 0.45))
    wheel_art = wheel(-12.2, 0, 3.05)
    upper_rail = rect(-8.4, -3.5, 22.2, 2.05, 0.3, "#8e969e", "#343a40", 0.6)
    lower_rail = rect(-8.4, 1.45, 22.2, 2.05, 0.3, "#8e969e", "#343a40", 0.6)
    upper_light = rect(-7.6, -3.35, 18, 0.45, 0.2, "#d5dbe0", opacity=0.8)
    gap = rect(-7.2, -1.15, 18.5, 2.3, 0.3, gap_color)
    return "".join(sleepers) + wheel_art + gap + upper_rail + lower_rail + upper_light + lance


def railroad(pose: str) -> str:
    if pose == "discharge":
        lance = polygon([(10.2, -1.5), (14.7, 0), (10.2, 1.5)], "#eafff8") + polygon(
            [(10.2, -0.55), (13.6, 0), (10.2, 0.55)], "#ffffff"
        )
        art = rail_body("#f3fffb", lance)
    elif pose == "smoke":
        art = rail_body("#44ddaa", "") + rect(-7.2, -1.15, 18.5, 2.3, 0.3, "#ffffff", opacity=0.18)
    else:
        art = rail_body("#14584a", "") + rect(-2, -0.45, 8.5, 0.9, 0.3, "#44ddaa", opacity=0.95)
    return tower_svg(art)


def sandbag(center_x: float, center_y: float, angle_degrees: float, nudge_x: float, nudge_y: float) -> str:
    transform = f"translate({num(center_x + nudge_x)} {num(center_y + nudge_y)}) rotate({num(angle_degrees)})"
    bag = rect(-3.7, -1.85, 7.4, 3.7, 1.4, "#c4a078", "#5a4030", 0.6)
    stitch = line(-2.2, 0, 2.2, 0, "#8a6848", 0.35)
    chip = rect(-2.2, -1.2, 2.4, 0.9, 0.4, "#ead2b4", opacity=0.85)
    return svg_group(bag + stitch + chip, transform)


def bastion(pose: str) -> str:
    nudge = 0.85 if pose == "discharge" else (0.35 if pose == "smoke" else 0.0)
    bags = []
    for bag_index in range(7):
        angle = bag_index * (360 / 7) - 90
        radians = math.radians(angle)
        center_x = math.cos(radians) * 8.6
        center_y = math.sin(radians) * 8.6
        tangent = angle + 90
        slide = nudge if bag_index % 2 == 0 else -nudge * 0.6
        bags.append(sandbag(center_x, center_y, tangent, math.cos(radians) * slide, math.sin(radians) * slide))
    sign = polygon(regular_points(0, -0.4, 4.7, 8, 22.5), "#d24a3a", "#6a2018", 0.7)
    sign_face = polygon(regular_points(0, -0.4, 3.15, 8, 22.5), "#f3e6d2")
    tire = circle(0.2, 7.2, 3.15, "#241c18", INK, 0.7) + circle(0.2, 7.2, 1.35, "#6a5a48", "#2a241c", 0.45)
    dust = ""
    if pose == "discharge":
        dust = ellipse(6.5, 6.2, 2.2, 1.0, "#c4b09a", opacity=0.45) + ellipse(-7.2, 4.4, 1.8, 0.8, "#c4b09a", opacity=0.35)
    elif pose == "smoke":
        dust = ellipse(5.2, 7.4, 1.6, 0.7, "#c4b09a", opacity=0.25)
    return tower_svg("".join(bags) + sign + sign_face + tire + dust)


def regular_points(
    center_x: float, center_y: float, radius: float, sides: int, rotation_degrees: float
) -> list[tuple[float, float]]:
    points = []
    for index in range(sides):
        angle = math.radians(rotation_degrees + index * (360 / sides))
        points.append((center_x + math.cos(angle) * radius, center_y + math.sin(angle) * radius))
    return points


def shotgun_body() -> str:
    left_tread = rect(-11.4, -10.4, 20.5, 4.3, 1.4, "#2a241e", INK, 0.7)
    right_tread = rect(-11.4, 6.1, 20.5, 4.3, 1.4, "#2a241e", INK, 0.7)
    tread_marks = []
    for mark_index in range(5):
        mark_x = -9.2 + mark_index * 3.5
        tread_marks.append(line(mark_x, -9.6, mark_x, -6.8, "#4a4036", 0.55))
        tread_marks.append(line(mark_x, 6.8, mark_x, 9.6, "#4a4036", 0.55))
    hull = volume_rect(-8.6, -6.2, 14.2, 12.4, 1.8, "#c08552", "#6a4528", "#e2b488", INK, 0.9, "tower")
    cabin = rect(-6.4, -4.2, 6.8, 8.4, 1.0, "#a06840", "#5a3418", 0.6)
    chevron = path_shape("M2.2 -2.6 L5.2 0 L2.2 2.6", "none", HAZARD, 1.15)
    upper_barrel = rect(5.2, -2.35, 7.6, 1.7, 0.45, "#5a5e64", "#2a2e32", 0.55)
    lower_barrel = rect(5.2, 0.65, 7.6, 1.7, 0.45, "#5a5e64", "#2a2e32", 0.55)
    return left_tread + right_tread + "".join(tread_marks) + hull + cabin + chevron + upper_barrel + lower_barrel


def shotgun(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -1.8, "smoke": -0.55}[pose]
    body = svg_group(shotgun_body(), f"translate({num(shift)} 0)")
    if pose == "discharge":
        effect = muzzle_flash(11.2, -1.5) + muzzle_flash(11.2, 1.5)
    elif pose == "smoke":
        effect = smoke_puff(12.2, -1.4) + circle(12.6, 1.6, 1.3, "#b7b1a8", opacity=0.35)
    else:
        effect = ""
    return tower_svg(body + effect)


TOWER_DRAW: dict[str, Callable[[str], str]] = {
    "basic": ten_miss,
    "ice": cryo,
    "sniper": longshot,
    "cannon": junk_cannon,
    "lightning": lightning,
    "railgun": railroad,
    "sturdyWall": bastion,
    "shotgunTank": shotgun,
}

TOWER_META = [
    ("basic", "Ten-Miss Blaster", "#b87333", "▪", 0.3, 0.6),
    ("ice", "Cryo-ME A-River", "#55ccff", "◆", 0.4, 0.7),
    ("sniper", "Longshot Silver", "#888", "◎", 0.35, 0.65),
    ("cannon", "Junk Cannon", "#5a4a3a", "◉", 0.5, 0.8),
    ("lightning", "Tesla-Foil Hat", "#ff0", "⚡", 0.25, 0.55),
    ("railgun", "Railroad Line-Driver", "#44ddaa", "▲", 0.45, 0.75),
    ("sturdyWall", "Bastion Wall", "#b08968", "◧", 0.3, 0.6),
    ("shotgunTank", "Shotgun Tank", "#c08552", "◳", 0.3, 0.6),
]


# --- enemies ----------------------------------------------------------------

WALK_BOB = (0.0, 0.02, 0.04, 0.02, 0.0, -0.02, -0.04, -0.02)


class Pose:
    def __init__(self, phase: int, bob: float, action: str, action_phase: int) -> None:
        self.phase = phase
        self.bob = bob
        self.action = action
        self.action_phase = action_phase

    @property
    def reach(self) -> float:
        if self.action == "attack":
            return (-0.45, 1.0, 0.25)[self.action_phase]
        if self.action == "hit":
            return -0.2
        return 0.0

    @property
    def shift_x(self) -> float:
        if self.action == "hit":
            return (-0.03, -0.08, -0.03)[self.action_phase]
        if self.action == "attack":
            return (-0.045, 0.07, 0.02)[self.action_phase]
        return 0.0

    @property
    def squash(self) -> float:
        if self.action == "hit":
            return (0.35, 1.0, 0.4)[self.action_phase]
        return 0.0

    def gait(self, parity: int) -> float:
        if self.action != "walk":
            return 0.0
        table = (0.0, 0.16, 0.0, -0.16, 0.0, 0.16, 0.0, -0.16)
        amount = table[self.phase % 8]
        if parity % 2 == 1:
            amount = -amount
        return amount


def enemy_frame(pose: Pose, body: str, enemy_id: str) -> str:
    airborne = enemy_id in AIRBORNE_ENEMY_IDS
    lift = -0.12 if airborne else 0.0
    transform = f"translate({num(pose.shift_x)} {num(pose.bob + lift)})"
    if airborne:
        transform += f" scale({num(AIRBORNE_SPRITE_SCALE[enemy_id])})"
    moved = svg_group(body, transform)
    flash = ""
    if pose.action == "hit" and pose.action_phase == 0:
        flash = circle(pose.shift_x + 0.08, pose.bob + lift, 0.09, "#fff", opacity=0.7)
    return enemy_svg(moved + flash)


def squashed(radius_x: float, radius_y: float, squash: float) -> tuple[float, float]:
    return radius_x * (1 + squash * 0.14), radius_y * (1 - squash * 0.28)


def bad_bug(pose: Pose) -> str:
    radius_x, radius_y = squashed(0.4, 0.2, pose.squash)
    legs = []
    tuck = 0.45 if pose.action == "hit" else 1.0
    for leg_index, hip_x in enumerate((0.16, -0.04, -0.24)):
        for side in (-1, 1):
            swing = pose.gait(leg_index + (0 if side < 0 else 1))
            knee_x = hip_x - 0.05 + swing
            foot_x = hip_x - 0.02 + swing * 1.3
            knee_y = side * 0.24 * tuck
            foot_y = side * 0.5 * tuck
            legs.append(
                path_shape(
                    f"M{num(hip_x)} {num(side * 0.12)} L{num(knee_x)} {num(knee_y)} L{num(foot_x)} {num(foot_y)}",
                    "none",
                    "#3a2a18",
                    0.075,
                )
            )
    body = volume_ellipse(0, 0, radius_x, radius_y, "#5a3c24", "#2a180e", "#a06c44", INK, 0.045, "enemy")
    head = volume_ellipse(0.4, 0, 0.16, 0.13, "#4a3018", "#24140c", "#8a5a36", INK, 0.04, "enemy")
    pustules = []
    for pustule_x, pustule_y, pustule_r in (
        (-0.16, 0.05, 0.055),
        (-0.28, -0.04, 0.042),
        (-0.08, -0.08, 0.038),
        (0.08, 0.07, 0.046),
        (-0.22, 0.1, 0.032),
    ):
        pustules.append(circle(pustule_x, pustule_y, pustule_r, "#8adf44", "#3a6a18", 0.02))
    wiggle = 0.0 if pose.action != "walk" else (0.06 if pose.phase % 4 < 2 else -0.05)
    reach = pose.reach
    antenna_upper = path_shape(
        f"M0.5 -0.04 Q{num(0.72 + reach * 0.08)} {num(-0.2 + wiggle)} {num(0.78 + reach * 0.1)} {num(-0.34 + wiggle)}",
        "none",
        "#3a2a18",
        0.03,
    )
    antenna_lower = path_shape(
        f"M0.5 0.04 Q{num(0.72 + reach * 0.08)} {num(0.18 - wiggle)} {num(0.76 + reach * 0.1)} {num(0.32 - wiggle)}",
        "none",
        "#3a2a18",
        0.03,
    )
    mandible_open = 0.05 + max(pose.reach, 0) * 0.08
    mandible_upper = line(0.52, -0.04, 0.66 + max(pose.reach, 0) * 0.12, -mandible_open, "#2a1c10", 0.035)
    mandible_lower = line(0.52, 0.04, 0.66 + max(pose.reach, 0) * 0.12, mandible_open, "#2a1c10", 0.035)
    return "".join(legs) + body + "".join(pustules) + head + antenna_upper + antenna_lower + mandible_upper + mandible_lower


def mantis(pose: Pose) -> str:
    radius_x, radius_y = squashed(0.3, 0.075, pose.squash)
    reach = pose.reach
    scythes = []
    for side_index, side in enumerate((-1, 1)):
        side_reach = reach + (0.35 if pose.action == "walk" and (pose.phase + side_index) % 4 < 2 else 0.0)
        if pose.action == "hit":
            side_reach = -0.35
        base_x = 0.02
        tip_x = 0.48 + side_reach * 0.22
        outer_y = side * (0.26 + max(side_reach, 0) * 0.08)
        hook_y = side * 0.1
        scythes.append(
            path_shape(
                f"M{num(base_x)} {num(side * 0.05)} Q{num(tip_x - 0.12)} {num(outer_y)} {num(tip_x)} {num(hook_y)} "
                f"Q{num(tip_x - 0.08)} {num(side * 0.02)} {num(base_x + 0.08)} {num(side * 0.02)} Z",
                "#1d4a22",
                "#0e2812",
                0.03,
            )
        )
    legs = []
    tuck = 0.55 if pose.action == "hit" else 1.0
    for leg_index, hip_x in enumerate((-0.16, 0.0)):
        for side in (-1, 1):
            swing = pose.gait(leg_index)
            foot_y = side * (0.22 + 0.08 * tuck)
            legs.append(line(hip_x, side * 0.05, hip_x - 0.02 + swing, foot_y, "#1a3a1c", 0.035))
    body = volume_ellipse(-0.02, 0, radius_x, radius_y, "#2f7a38", "#16421c", "#7cbc6c", INK, 0.04, "enemy")
    head = polygon(
        [(0.22, -0.07), (0.4 + max(reach, 0) * 0.06, 0), (0.22, 0.07)],
        "#3d9448",
        "#14381c",
        0.03,
    )
    eye = circle(0.3, -0.025, 0.028, "#102010")
    return "".join(legs) + "".join(scythes) + body + head + eye


def yow_guy(pose: Pose) -> str:
    radius_x, radius_y = squashed(0.34, 0.3, pose.squash)
    legs = []
    tuck = 0.62 if pose.action == "hit" else 1.0
    for leg_index, (hip_x, side) in enumerate(((-0.12, -1), (0.1, -1), (-0.14, 1), (0.12, 1))):
        swing = pose.gait(leg_index)
        foot_y = side * (0.48 * tuck)
        legs.append(ellipse(hip_x + swing, foot_y, 0.1, 0.13 * tuck, "#6a4630", "#3a2418", 0.035))
    body = volume_ellipse(-0.02, 0.02, radius_x, radius_y, "#8a6244", "#4a301c", "#d0a078", INK, 0.05, "enemy")
    ear_shift = -0.06 if pose.action == "hit" else 0.0
    ear_upper = circle(0.22 + ear_shift, -0.3, 0.1, "#8a6244", INK, 0.04)
    ear_lower = circle(0.24 + ear_shift, 0.3, 0.09, "#8a6244", INK, 0.04)
    ear_inner_upper = circle(0.24 + ear_shift, -0.3, 0.045, "#c48a78")
    ear_inner_lower = circle(0.26 + ear_shift, 0.3, 0.04, "#c48a78")
    head = volume_ellipse(0.26, 0, 0.24, 0.22, "#a07050", "#5a3824", "#e2b898", INK, 0.045, "enemy")
    mouth_x = 0.42 + max(pose.reach, 0) * 0.1
    mouth = ellipse(mouth_x, 0.03, 0.16 + max(pose.reach, 0) * 0.04, 0.13, "#2a140e", INK, 0.03)
    tongue = ellipse(mouth_x + 0.02, 0.04, 0.05, 0.04, "#c45a5a")
    tooth = polygon(
        [(mouth_x - 0.02, -0.04), (mouth_x + 0.02, -0.05), (mouth_x, 0.0)],
        "#f4efe4",
    )
    swipe = ""
    if pose.action == "attack":
        claw_x = 0.42 + pose.reach * 0.22
        swipe = (
            path_shape(f"M0.3 -0.16 L{num(claw_x)} {num(-0.28)}", "none", "#3a2418", 0.05)
            + path_shape(f"M0.32 -0.02 L{num(claw_x + 0.04)} {num(-0.08)}", "none", "#3a2418", 0.05)
            + path_shape(f"M0.3 0.12 L{num(claw_x)} {num(0.22)}", "none", "#3a2418", 0.05)
        )
    eye = circle(0.34, -0.08, 0.035, "#1a100c") + circle(0.35, -0.09, 0.012, "#fff")
    return (
        "".join(legs)
        + ear_upper
        + ear_lower
        + body
        + head
        + ear_inner_upper
        + ear_inner_lower
        + mouth
        + tongue
        + tooth
        + eye
        + swipe
    )


def shell_shocked(pose: Pose) -> str:
    tuck = 0.6 if pose.action == "hit" else 1.0
    legs = []
    for leg_index in range(3):
        for side in (-1, 1):
            hip_x = -0.22 + leg_index * 0.16
            swing = pose.gait(leg_index)
            foot_x = hip_x + swing
            foot_y = side * 0.46 * tuck
            legs.append(line(hip_x, side * 0.12, foot_x, foot_y, "#4a3028", 0.04))
    crab = volume_ellipse(-0.02, 0.02, 0.26, 0.2, "#6a4038", "#3a2018", "#a06858", INK, 0.04, "enemy")
    shell = volume_ellipse(0, -0.02, 0.4, 0.32, "#c5d0d8", "#6e7c86", "#f4f7f8", "#3e4a52", 0.045, "enemy")
    ring = ellipse(0, -0.02, 0.22, 0.17, "none", "#7a8c98", 0.03)
    nub = circle(-0.02, -0.02, 0.05, "#8a9aa4", "#4a5a64", 0.02)
    reach = pose.reach
    pinch = 0.05 if pose.action == "attack" and pose.action_phase == 1 else 0.1
    if pose.action == "hit":
        pinch = 0.04
    upper = pincer(0.28, -0.08, reach, -1, pinch)
    lower = pincer(0.28, 0.1, reach, 1, pinch)
    return "".join(legs) + crab + upper + lower + shell + ring + nub


def pincer(root_x: float, root_y: float, reach: float, side: int, opening: float) -> str:
    # The claw reaches root_x + 0.48 at full reach, and the frame carries a 0.07 attack
    # lunge on top, which put the tip 0.01 past the 1 unit edge the symbol clips at.
    tip_x = root_x + 0.35 + reach * 0.16
    tip_y = root_y + side * (0.1 + opening)
    arm = path_shape(
        f"M{num(root_x)} {num(root_y)} L{num(tip_x - 0.12)} {num(root_y + side * 0.02)}",
        "none",
        "#6a3830",
        0.08,
    )
    claw = polygon(
        [
            (tip_x - 0.14, root_y - side * 0.02),
            (tip_x + 0.02, tip_y),
            (tip_x + 0.12, root_y + side * 0.01),
            (tip_x - 0.02, root_y - side * (opening + 0.04)),
        ],
        "#c46858",
        "#4a241c",
        0.035,
    )
    return arm + claw


def mole_mender(pose: Pose) -> str:
    radius_x, radius_y = squashed(0.42, 0.2, pose.squash)
    tuck = 0.65 if pose.action == "hit" else 1.0
    legs = []
    for leg_index, hip_x in enumerate((-0.2, -0.02, 0.16)):
        swing = pose.gait(leg_index)
        for side in (-1, 1):
            legs.append(
                ellipse(hip_x + swing * 0.6, side * 0.24 * tuck, 0.07, 0.05, "#7a4870", "#4a2848", 0.025)
            )
    body = volume_ellipse(-0.02, 0.02, radius_x, radius_y, "#c484b0", "#7a4870", "#f0c4e0", INK, 0.045, "enemy")
    satchel = rect(-0.36, -0.1, 0.2, 0.18, 0.03, "#6a5340", "#3a2c20", 0.03)
    cross_vertical = rect(-0.29, -0.07, 0.05, 0.12, 0.01, BONE)
    cross_horizontal = rect(-0.33, -0.035, 0.13, 0.045, 0.01, BONE)
    nose_x = 0.4 + max(pose.reach, 0) * 0.08
    halo = circle(nose_x, 0, 0.12, "#e8a0ff", opacity=0.35)
    nose = circle(nose_x, 0, 0.07, "#f4d0ff", "#a060b0", 0.025)
    nose_hot = circle(nose_x - 0.015, -0.015, 0.03, "#fff")
    teeth = ""
    if pose.action == "attack":
        bite = 0.04 + max(pose.reach, 0) * 0.05
        teeth = line(nose_x + 0.04, -bite, nose_x + 0.1, 0, "#f4efe4", 0.03) + line(
            nose_x + 0.04, bite, nose_x + 0.1, 0, "#f4efe4", 0.03
        )
    eye = circle(0.22, -0.06, 0.03, "#2a1424")
    return "".join(legs) + body + satchel + cross_vertical + cross_horizontal + halo + nose + nose_hot + eye + teeth


def death_draw(pose: Pose) -> str:
    reach = pose.reach
    radius_x, radius_y = squashed(0.3, 0.22, pose.squash)
    tail = path_shape(
        "M-0.08 0.04 C-0.4 0.2 -0.62 -0.08 -0.84 0.06",
        "none",
        "#a85a20",
        0.16,
    )
    tail_light = path_shape("M-0.1 0.0 C-0.38 0.12 -0.58 -0.1 -0.78 0.02", "none", "#e09048", 0.05)
    duster = polygon(
        [(-0.02, -0.08), (-0.46, 0.0), (-0.62, 0.2), (-0.3, 0.34), (-0.02, 0.16), (0.08, 0.18), (0.06, 0.02)],
        "#5c4034",
        "#2e1c14",
        0.04,
    )
    thigh_upper = ellipse(0.02, -0.28, 0.12, 0.16, "#b86428", "#6a3010", 0.04)
    thigh_lower = ellipse(-0.04, 0.32, 0.14, 0.18, "#b86428", "#6a3010", 0.04)
    foot_upper = ellipse(0.08, -0.46, 0.1, 0.07, "#8a4a18", INK, 0.03)
    foot_lower = ellipse(0.02, 0.52, 0.12, 0.08, "#8a4a18", INK, 0.03)
    body = volume_ellipse(0.02, 0.02, radius_x, radius_y, "#cc6600", "#8a3e10", "#f0a050", INK, 0.05, "enemy")
    arm = path_shape("M0.16 0.1 L0.24 0.02 L0.3 -0.1", "none", "#a85a28", 0.055)
    gun = polygon(
        [(0.26, -0.08), (0.36, -0.08), (0.36, -0.2), (0.31, -0.28), (0.27, -0.2)],
        "#2c2c2c",
        "#111",
        0.025,
    )
    # The jaw already carries its own reach, so this extra push was what walked the snout
    # 0.01 past the edge the symbol clips at.
    head_shift = max(reach, 0) * 0.06
    head = svg_group(rex_head(reach), f"translate({num(head_shift)} 0)")
    return tail + tail_light + duster + thigh_upper + thigh_lower + foot_upper + foot_lower + body + arm + gun + head


def rex_head(reach: float) -> str:
    jaw = max(reach, 0) * 0.06
    skull = volume_ellipse(0.34, -0.02, 0.28, 0.2, "#d07020", "#8a3c0c", "#f2b070", INK, 0.045, "enemy")
    upper = polygon(
        [(0.46, -0.1), (0.70 + jaw, -0.22), (0.78 + jaw, -0.06), (0.5, 0.0)],
        "#e07828",
        "#6a3010",
        0.035,
    )
    lower = polygon(
        [(0.46, 0.06), (0.66 + jaw, 0.2), (0.62 + jaw, 0.28), (0.44, 0.12)],
        "#c86420",
        "#6a3010",
        0.035,
    )
    mouth = polygon(
        [(0.5, -0.02), (0.74 + jaw, -0.1), (0.7 + jaw, 0.16), (0.48, 0.06)],
        "#3a1408",
    )
    teeth = path_shape(
        "M0.54 -0.04 L0.58 -0.12 L0.62 -0.02 L0.66 -0.12 L0.7 -0.02 L0.74 -0.1",
        "none",
        "#f4efe4",
        0.035,
    )
    eye = circle(0.42, -0.1, 0.045, "#1a0c08") + circle(0.432, -0.112, 0.016, "#fff")
    return skull + mouth + upper + lower + teeth + eye


def wing_span(pose: Pose, raised: float, tucked: float) -> float:
    if pose.action == "hit":
        return tucked
    if pose.action != "walk":
        return (raised + tucked) * 0.5
    table = (
        raised,
        (raised + tucked) * 0.55,
        tucked,
        (raised + tucked) * 0.7,
        raised,
        (raised + tucked) * 0.4,
        tucked,
        (raised + tucked) * 0.85,
    )
    return table[pose.phase % 8]


def ash_moth(pose: Pose) -> str:
    span = wing_span(pose, 0.48, 0.16)
    reach = max(pose.reach, 0)
    wings = []
    for side in (-1, 1):
        tip_y = side * span
        wings.append(
            polygon(
                [(-0.04, side * 0.05), (0.16, side * 0.02), (0.02, tip_y), (-0.24, side * span * 0.7)],
                "#c4b45a",
                "#6a5828",
                0.03,
            )
        )
        wings.append(circle(-0.04, side * span * 0.45, 0.035, "#8a7840"))
    body = volume_ellipse(0.02, 0, 0.22, 0.09, "#b8a45a", "#6a5428", "#efe0a4", INK, 0.035, "enemy")
    head = volume_ellipse(0.22 + reach * 0.05, 0, 0.08, 0.055, "#d0bc72", "#7a6834", "#f6ecc0", INK, 0.03, "enemy")
    antenna = path_shape(
        f"M0.28 {num(-0.02)} Q{num(0.4 + reach * 0.04)} -0.12 {num(0.46 + reach * 0.06)} -0.16",
        "none",
        "#3a3018",
        0.025,
    )
    eye = circle(0.26, -0.015, 0.016, "#2a2010")
    return "".join(wings) + body + head + antenna + eye


def bottle_rocket(pose: Pose) -> str:
    reach = max(pose.reach, 0)
    flicker = 0.0 if pose.action != "walk" else (0.08 if pose.phase % 2 == 0 else 0.02)
    nose = polygon(
        [(0.16, -0.07), (0.5 + reach * 0.08, 0), (0.16, 0.07)],
        "#e07040",
        "#8a3018",
        0.03,
    )
    bottle = volume_ellipse(-0.02, 0, 0.26, 0.08, "#c45830", "#6a2814", "#f0a078", INK, 0.035, "enemy")
    fin_upper = polygon([(-0.06, -0.05), (-0.26, -0.2), (-0.12, -0.04)], "#a84828", "#5a2010", 0.025)
    fin_lower = polygon([(-0.06, 0.05), (-0.26, 0.2), (-0.12, 0.04)], "#a84828", "#5a2010", 0.025)
    notch = polygon([(-0.26, -0.045), (-0.36, 0), (-0.26, 0.045), (-0.2, 0)], "#3a140c")
    exhaust = polygon(
        [(-0.32, -0.028), (-0.46 - flicker, 0), (-0.32, 0.028)],
        "#e2c044",
    )
    return fin_upper + fin_lower + exhaust + bottle + notch + nose


def tin_canopy(pose: Pose) -> str:
    span = wing_span(pose, 0.28, 0.12)
    reach = max(pose.reach, 0)
    ring_dark = path_shape("M0.3 -0.2 A0.42 0.42 0 1 0 0.3 0.2", "none", "#3a545c", 0.09)
    ring = path_shape("M0.3 -0.2 A0.42 0.42 0 1 0 0.3 0.2", "none", "#8ec8d8", 0.05)
    rivets = (
        circle(-0.32, -0.18, 0.028, "#d8eef2", "#3a545c", 0.015)
        + circle(-0.38, 0.02, 0.028, "#d8eef2", "#3a545c", 0.015)
        + circle(-0.22, 0.28, 0.028, "#d8eef2", "#3a545c", 0.015)
    )
    wings = []
    for side in (-1, 1):
        wings.append(
            polygon(
                [(0.02, side * 0.04), (0.14, side * 0.02), (-0.02, side * span)],
                "#7eb4c4",
                "#3a545c",
                0.025,
            )
        )
    body = volume_ellipse(0.0, 0.02, 0.16, 0.1, "#9ed0dc", "#4a6870", "#e4f6f8", INK, 0.03, "enemy")
    nose = polygon(
        [(0.12, -0.05), (0.28 + reach * 0.06, 0), (0.12, 0.05)],
        "#b8e0e8",
        "#3a545c",
        0.025,
    )
    return ring_dark + ring + rivets + "".join(wings) + body + nose


def cairn_mender(pose: Pose) -> str:
    """The mole mender grown into a healer-tank: the same mole at a larger scale with
    ember lamps studding its tail. The lamps carry the declared color, which the mole
    palette otherwise never paints, and they sit symmetric about the facing axis so the
    plan view keeps no top to lose."""
    grown = svg_group(mole_mender(pose), "scale(1.18)")
    lamps = circle(-0.52, -0.14, 0.045, "#e08a5a", INK, 0.025)
    lamps += circle(-0.52, 0.14, 0.045, "#e08a5a", INK, 0.025)
    lamps += circle(-0.6, 0.0, 0.05, "#e08a5a", INK, 0.025)
    return svg_group(grown + lamps, None)


def sky_hold(pose: Pose) -> str:
    """A flying tank out of the tin canopy ring and the bottle rocket nose: the canopy
    ring shrunk around a smaller body, rocket fins on the flanks, and a notch with an
    exhaust flicker at the rear. The airborne scale in enemy_frame draws it small, so
    the ring is drawn tighter than the aegis one to stay inside the clip box."""
    span = wing_span(pose, 0.24, 0.1)
    reach = max(pose.reach, 0)
    ring_dark = path_shape("M0.26 -0.18 A0.38 0.38 0 1 0 0.26 0.18", "none", "#3a545c", 0.08)
    ring = path_shape("M0.26 -0.18 A0.38 0.38 0 1 0 0.26 0.18", "none", "#9ec8d8", 0.045)
    rivets = (
        circle(-0.28, -0.16, 0.025, "#d8eef2", "#3a545c", 0.015)
        + circle(-0.34, 0.02, 0.025, "#d8eef2", "#3a545c", 0.015)
        + circle(-0.2, 0.24, 0.025, "#d8eef2", "#3a545c", 0.015)
    )
    fins = []
    for side in (-1, 1):
        fins.append(
            polygon(
                [(0.0, side * 0.035), (0.12, side * 0.02), (-0.02, side * span)],
                "#7eb4c4",
                "#3a545c",
                0.025,
            )
        )
    body = volume_ellipse(0.0, 0.02, 0.15, 0.095, "#9ec8d8", "#4a6870", "#e4f6f8",
                            INK, 0.03, "enemy")
    nose = polygon(
        [(0.11, -0.045), (0.26 + reach * 0.06, 0), (0.11, 0.045)],
        "#b8e0e8",
        "#3a545c",
        0.025,
    )
    flicker = 0.0 if pose.action != "walk" else (0.07 if pose.phase % 2 == 0 else 0.02)
    exhaust = polygon(
        [(-0.24, -0.025), (-0.36 - flicker, 0), (-0.24, 0.025)],
        "#e2c044",
    )
    notch = polygon([(-0.2, -0.04), (-0.28, 0), (-0.2, 0.04)], "#3a140c")
    return ring_dark + ring + rivets + "".join(fins) + exhaust + body + notch + nose


def brood_wing(pose: Pose) -> str:
    """The ash moth grown near full size, trailing brood dots off its rear. The dots double
    as the spawn read: the attack frames pulse them outward with the wing flare, so no extra
    art is needed for the spawn pulse. They carry the declared color, which the moth
    palette otherwise never paints."""
    grown = svg_group(ash_moth(pose), "scale(1.3)")
    pulse = 1.0 + max(pose.reach, 0) * 0.25
    dots = circle(-0.42 * pulse, 0, 0.05, "#d8b45a", "#6a5828", 0.02)
    dots += circle(-0.5 * pulse, -0.09 * pulse, 0.04, "#d8b45a", "#6a5828", 0.02)
    dots += circle(-0.5 * pulse, 0.09 * pulse, 0.04, "#d8b45a", "#6a5828", 0.02)
    return svg_group(grown + dots, None)


ENEMY_DRAW: dict[str, Callable[[Pose], str]] = {
    "minion": bad_bug,
    "runner": mantis,
    "tank": yow_guy,
    "shielded": shell_shocked,
    "healer": mole_mender,
    "boss": death_draw,
    "flyer": ash_moth,
    "jet": bottle_rocket,
    "aegis": tin_canopy,
    "mender": cairn_mender,
    "skyhold": sky_hold,
    "broodwing": brood_wing,
}

ENEMY_META = [
    ("minion", "Bad Bug", "#88aa44", "●", 0.8, 0.3, 0.2),
    ("runner", "Manic Mantis", "#44aa44", "◆", 0.6, 0.3, 0.2),
    ("tank", "Yow Guy", "#886644", "■", 1.0, 0.3, 0.2),
    ("shielded", "Shell Shocked", "#99aabb", "◇", 0.7, 0.3, 0.2),
    ("healer", "Mole Mender", "#bb77aa", "▲", 0.9, 0.3, 0.2),
    ("boss", "Death Draw", "#cc6600", "★", 1.2, 0.4, 0.2),
    ("flyer", "Ash Moth", "#c4b45a", "◆", 0.7, 0.3, 0.2),
    ("jet", "Bottle Rocket", "#e07040", "▸", 0.45, 0.3, 0.2),
    ("aegis", "Tin Canopy", "#8ec8d8", "◈", 0.9, 0.3, 0.2),
    ("mender", "Cairn Mender", "#e08a5a", "⬢", 1.0, 0.3, 0.2),
    ("skyhold", "Sky Hold", "#9ec8d8", "▾", 0.8, 0.3, 0.2),
    ("broodwing", "Cinder Brood", "#d8b45a", "⬣", 0.9, 0.3, 0.2),
]

AIRBORNE_ENEMY_IDS = {"flyer", "jet", "aegis", "skyhold", "broodwing"}

AIRBORNE_FLYING_HEIGHT = {"flyer": 2, "aegis": 3, "jet": 5, "skyhold": 4, "broodwing": 1}

AIRBORNE_SPRITE_SCALE = {
    # The renderer rotates the whole <use> and never offsets a unit by its sim-side
    # flyingHeight, so the sprite is the only channel that can carry altitude, and the baked
    # ground shadow these frames drew is gone. Scale took over that job: in a plan view a
    # smaller sprite reads as further from the camera, so 1 - flyingHeight / 12 turns the
    # heights in src/content/data/enemies.json into 0.83 / 0.75 / 0.58 of a ground unit.
    enemy_id: 1 - flying_height / 12 for enemy_id, flying_height in AIRBORNE_FLYING_HEIGHT.items()
}


def build_enemy_animations(draw: Callable[[Pose], str], enemy_id: str) -> dict[str, dict]:
    walking = []
    for phase in range(8):
        pose = Pose(phase, WALK_BOB[phase], "walk", 0)
        walking.append(enemy_frame(pose, draw(pose), enemy_id))
    hit = []
    for action_phase in range(3):
        pose = Pose(0, 0.0, "hit", action_phase)
        hit.append(enemy_frame(pose, draw(pose), enemy_id))
    attack = []
    for action_phase in range(3):
        pose = Pose(0, 0.0, "attack", action_phase)
        attack.append(enemy_frame(pose, draw(pose), enemy_id))
    return {"walking": walking, "hit": hit, "attack": attack}


# --- ground -----------------------------------------------------------------


def ground_tile(fill: str, motifs: str) -> str:
    return tile_svg(rect(0, 0, 36, 36, 0, fill) + motifs)


def pebble(center_x: float, center_y: float, radius: float, fill: str, opacity: float = 0.85) -> str:
    return circle(center_x, center_y, radius, fill, opacity=opacity)


def smear(
    center_x: float,
    center_y: float,
    radius_x: float,
    radius_y: float,
    fill: str,
    opacity: float,
) -> str:
    return ellipse(center_x, center_y, radius_x, radius_y, fill, opacity=opacity)


def stain(path_data: str, fill: str, opacity: float) -> str:
    return path_shape(path_data, fill, opacity=opacity)


# ===== Tile variants =====

TILE_KINDS = ["path", "terrain1", "terrain2", "terrain3", "terrain4"]
TILE_VARIANT_COUNT = 3
TILE_SIZE = 36
# A shipped tile crosses its own cell edge with a low-opacity smear, so rotated
# neighbours read as one continuous ground tone rather than a seam. Variants keep
# that treatment, and keep the marks big enough that rotation never turns them
# into readable scratches.
EDGE_MOTIF_OPACITY_RANGE = (0.24, 0.28)
EDGE_MOTIF_RADIUS_Y_RANGE = (3.0, 6.0)
EDGE_MOTIF_REACH_RANGE = (4.5, 8.0)
INTERIOR_MOTIF_OPACITY_RANGE = (0.4, 0.6)
STAIN_OPACITY_RANGE = (0.4, 0.5)
STAIN_RADIUS_X_RANGE = (5.5, 9.0)
STAIN_RADIUS_Y_RANGE = (4.0, 7.0)
STAIN_CENTER_MARGIN = 10.0
PEBBLE_RADIUS_RANGE = (0.8, 1.1)
PEBBLE_OPACITY_RANGE = (0.4, 0.45)
# Interior drifts stay clear of the stain margin so a drift never collides with
# an edge smear in the same tile.
DRIFT_CENTER_MARGIN = 9.0
# Three variants per kind is what both shipped themes ship; the byte budget keeps
# 45 tile images inside a theme file the renderer still loads eagerly.
TILE_BYTE_MAX = 1200


def tile_seed(region_index: int, kind_index: int, variant_index: int) -> int:
    """One deterministic seed per region, kind, and variant, so a rerun with the
    same table reproduces the same art byte for byte."""
    return 7000 + region_index * 100 + kind_index * 10 + variant_index


def stain_blob_path(rng: random.Random, center_x: float, center_y: float,
                    radius_x: float, radius_y: float) -> str:
    """A closed four-cubic loop through four jittered cardinal points, smoothed
    with the standard Catmull-Rom control points, so the blob matches the shape
    family the shipped stains are drawn from."""
    points = []
    for corner_index in range(4):
        angle = -math.pi / 2 + corner_index * math.pi / 2
        jitter = rng.uniform(0.86, 1.14)
        points.append((
            center_x + math.cos(angle) * radius_x * jitter,
            center_y + math.sin(angle) * radius_y * jitter,
        ))
    commands = [f"M{num(points[0][0])},{num(points[0][1])}"]
    for corner_index in range(4):
        previous = points[(corner_index - 1) % 4]
        current = points[corner_index]
        following = points[(corner_index + 1) % 4]
        after_following = points[(corner_index + 2) % 4]
        first_control = (
            current[0] + (following[0] - previous[0]) / 6,
            current[1] + (following[1] - previous[1]) / 6,
        )
        second_control = (
            following[0] - (after_following[0] - current[0]) / 6,
            following[1] - (after_following[1] - current[1]) / 6,
        )
        commands.append(f"C{num(first_control[0])},{num(first_control[1])} "
                        f"{num(second_control[0])},{num(second_control[1])} "
                        f"{num(following[0])},{num(following[1])}")
    return " ".join(commands) + " Z"


def tile_variant(region_palette: dict, kind: str, variant_index: int) -> str:
    """One seeded variant in the same construction as the shipped tile: field
    fill, three interior drifts, a stain, a pebble, and three edge smears."""
    kind_index = TILE_KINDS.index(kind)
    rng = random.Random(tile_seed(region_palette["index"], kind_index, variant_index))
    field, motif_colors, (drift_radius_x_low, drift_radius_x_high,
                          drift_radius_y_low, drift_radius_y_high) = region_palette["tiles"][kind]

    center_range = DRIFT_CENTER_MARGIN, TILE_SIZE - DRIFT_CENTER_MARGIN
    motifs = ""
    for drift_index in range(3):
        motifs += smear(
            rng.uniform(*center_range), rng.uniform(*center_range),
            rng.uniform(drift_radius_x_low, drift_radius_x_high),
            rng.uniform(drift_radius_y_low, drift_radius_y_high),
            rng.choice(motif_colors), rng.uniform(*INTERIOR_MOTIF_OPACITY_RANGE),
        )

    stain_x = rng.uniform(STAIN_CENTER_MARGIN, TILE_SIZE - STAIN_CENTER_MARGIN)
    stain_y = rng.uniform(STAIN_CENTER_MARGIN, TILE_SIZE - STAIN_CENTER_MARGIN)
    motifs += stain(
        stain_blob_path(rng, stain_x, stain_y,
                        rng.uniform(*STAIN_RADIUS_X_RANGE), rng.uniform(*STAIN_RADIUS_Y_RANGE)),
        rng.choice(motif_colors), rng.uniform(*STAIN_OPACITY_RANGE),
    )
    motifs += pebble(rng.uniform(*center_range), rng.uniform(*center_range),
                     rng.uniform(*PEBBLE_RADIUS_RANGE), rng.choice(motif_colors),
                     rng.uniform(*PEBBLE_OPACITY_RANGE))

    # Three of the four edges, so a rotated tile never stacks all three smears on
    # one side and leaves a bare edge opposite them.
    edge_sides = rng.sample(("top", "right", "bottom", "left"), 3)
    for side in edge_sides:
        edge_offset = rng.uniform(-3.5, 0.5)
        if side == "top":
            center_x, center_y = rng.uniform(*center_range), edge_offset
        elif side == "right":
            center_x, center_y = TILE_SIZE - edge_offset, rng.uniform(*center_range)
        elif side == "bottom":
            center_x, center_y = rng.uniform(*center_range), TILE_SIZE - edge_offset
        else:
            center_x, center_y = edge_offset, rng.uniform(*center_range)
        motifs += smear(center_x, center_y, rng.uniform(*EDGE_MOTIF_REACH_RANGE),
                        rng.uniform(*EDGE_MOTIF_RADIUS_Y_RANGE), rng.choice(motif_colors),
                        rng.uniform(*EDGE_MOTIF_OPACITY_RANGE))
    return ground_tile(field, motifs)


def tile_variants(region_palette: dict, primary_tiles: dict[str, str]) -> dict[str, list[str]]:
    """The shipped tile art first, then the seeded variants of the same kind."""
    return {
        kind: [primary_tiles[kind]] + [
            tile_variant(region_palette, kind, variant_index)
            for variant_index in range(1, TILE_VARIANT_COUNT)
        ]
        for kind in TILE_KINDS
    }


# One tile kind's variant inputs: field fill, the motif hexes its shipped art
# draws from, and its interior drift radius band (radius x low, radius x high,
# radius y low, radius y high).
TileMotifPalette = dict[str, tuple[str, list[str], tuple[float, float, float, float]]]


def region_tile_palette(index: int, tiles: TileMotifPalette) -> dict:
    """Palette for one region's variants. Each tile kind carries its field fill,
    the motif hexes its shipped art draws from, and its interior drift radius
    band — the sand region's dunes are flat and narrow, the ash region's are
    round, and a variant has to stay inside its kind's own proportions."""
    return {"index": index, "tiles": tiles}


def rustbloom_tiles() -> dict[str, str]:
    # Edge shapes run a few pixels past the viewBox so the symbol clips a small arc.
    path_motifs = (
        smear(13, 20, 7, 6, "#302620", 0.55)
        + smear(23, 15, 6, 5, "#1a1410", 0.5)
        + stain(
            "M16 22 C19 19, 25 20, 26 24 C27 28, 20 30, 15 27 C12 25, 13 23, 16 22 Z",
            "#302620",
            0.42,
        )
        + pebble(18, 11, 1.1, "#302620", 0.4)
        + smear(2.5, 8, 5.5, 4, "#1a1410", 0.28)
        + smear(33, 24, 6, 4.5, "#302620", 0.26)
        + smear(12, 33.5, 6, 4, "#302620", 0.24)
    )
    terrain1 = (
        smear(18, 18, 11, 8, "#e0c4a4", 0.42)
        + smear(12, 14, 6, 5, "#c4a888", 0.5)
        + smear(25, 24, 5, 4, "#b89878", 0.48)
        + stain(
            "M20 11 C24 10, 28 14, 26 18 C24 21, 19 20, 18 16 C17 13, 17 11, 20 11 Z",
            "#c4a888",
            0.4,
        )
        + pebble(10, 26, 0.9, "#b89878", 0.4)
        + smear(4, 1.5, 6, 4.5, "#e0c4a4", 0.26)
        + smear(33.5, 12, 4.5, 6, "#b89878", 0.28)
        + smear(1.5, 28, 5, 4, "#c4a888", 0.24)
    )
    terrain2 = (
        smear(14, 13, 7, 6, "#c4a080", 0.5)
        + smear(22, 20, 8, 6, "#a07858", 0.55)
        + smear(12, 26, 6, 4, "#8f6c50", 0.48)
        + stain(
            "M15 15 C18 11, 24 12, 25 17 C26 22, 20 24, 16 21 C12 18, 12 16, 15 15 Z",
            "#8f6c50",
            0.45,
        )
        + smear(27, 11, 3.5, 4, "#c4a080", 0.4)
        + pebble(20, 29, 1.0, "#8f6c50", 0.45)
        + smear(30, 2, 5, 5, "#c4a080", 0.26)
        + smear(2, 16, 5.5, 4, "#8f6c50", 0.28)
        + smear(22, 33.5, 7, 3.5, "#a07858", 0.24)
    )
    terrain3 = (
        smear(17, 17, 8, 7, "#9a6848", 0.58)
        + smear(21, 19, 5.5, 4.5, "#7a5438", 0.62)
        + smear(14, 20, 4.5, 3.5, "#a07858", 0.55)
        + stain(
            "M11 17 C11 12, 16 10, 21 13 C25 16, 24 23, 18 25 C13 27, 11 22, 11 17 Z",
            "#7a5438",
            0.5,
        )
        + smear(27, 12, 3.5, 4.5, "#7a5438", 0.42)
        + smear(9, 12, 3.5, 4, "#a07858", 0.4)
        + pebble(26, 27, 1.1, "#7a5438", 0.45)
        + smear(8, 2, 5, 5, "#9a6848", 0.24)
        + smear(33.5, 8, 5, 4.5, "#a07858", 0.26)
        + smear(1.5, 24, 4.5, 6, "#7a5438", 0.28)
    )
    terrain4 = (
        smear(20, 18, 8, 7, "#7a5438", 0.58)
        + smear(16, 16, 5, 4.5, "#5a3c28", 0.65)
        + smear(23, 22, 5, 4, "#806048", 0.55)
        + stain(
            "M14 12 C17 8, 24 9, 26 14 C28 19, 23 23, 17 21 C12 19, 11 15, 14 12 Z",
            "#5a3c28",
            0.5,
        )
        + smear(10, 20, 4, 5, "#5a3c28", 0.45)
        + smear(28, 14, 3, 4, "#806048", 0.42)
        + smear(12, 28, 5, 2.8, "#7a5438", 0.4)
        + pebble(26, 29, 0.9, "#5a3c28", 0.48)
        + smear(16, 1, 7, 4, "#806048", 0.26)
        + smear(33, 28, 4.5, 5, "#5a3c28", 0.28)
        + smear(6, 33.5, 6, 4, "#7a5438", 0.24)
    )
    return {
        "path": ground_tile("#241c18", path_motifs),
        "terrain1": ground_tile("#d4b494", terrain1),
        "terrain2": ground_tile("#b08a68", terrain2),
        "terrain3": ground_tile("#8c6244", terrain3),
        "terrain4": ground_tile("#6a4630", terrain4),
    }


def sand_tiles() -> dict[str, str]:
    path_motifs = (
        smear(18, 16, 11, 3.2, "#3a3428", 0.48)
        + smear(14, 24, 7, 3, "#201c16", 0.55)
        + stain(
            "M22 10 C26 9, 30 12, 29 16 C28 19, 23 20, 21 17 C19 14, 19 11, 22 10 Z",
            "#3a3428",
            0.4,
        )
        + pebble(11, 12, 0.9, "#3a3428", 0.4)
        + smear(2, 6, 5, 3.5, "#201c16", 0.28)
        + smear(33, 10, 5, 4, "#3a3428", 0.26)
        + smear(26, 33.8, 6, 3.2, "#3a3428", 0.24)
    )
    terrain1 = (
        smear(18, 14, 11, 3.2, "#efe0c4", 0.5)
        + smear(16, 22, 10, 2.8, "#dcc8a4", 0.55)
        + smear(26, 18, 3, 6.5, "#c8b48a", 0.4)
        + stain(
            "M9 26 C13 23, 22 23, 28 26 C30 28, 22 31, 12 30 C8 29, 6 28, 9 26 Z",
            "#dcc8a4",
            0.42,
        )
        + pebble(12, 10, 0.8, "#dcc8a4", 0.4)
        + smear(10, 1, 7, 3.5, "#efe0c4", 0.28)
        + smear(33.5, 20, 4, 6, "#c8b48a", 0.26)
        + smear(2, 32, 5, 3, "#dcc8a4", 0.24)
    )
    terrain2 = (
        smear(17, 12, 10, 2.8, "#d4c49a", 0.52)
        + smear(19, 20, 11, 3, "#b8a47a", 0.58)
        + smear(12, 26, 8, 2.6, "#b09a72", 0.48)
        + smear(27, 16, 2.8, 6, "#d4c49a", 0.4)
        + stain(
            "M10 16 C14 13, 22 14, 24 17 C26 20, 18 22, 12 20 C8 18, 7 17, 10 16 Z",
            "#b09a72",
            0.45,
        )
        + pebble(22, 28, 1.0, "#b09a72", 0.42)
        + smear(32, 2, 5, 3.2, "#d4c49a", 0.26)
        + smear(1.5, 18, 4.5, 3, "#b09a72", 0.28)
        + smear(14, 34, 8, 3, "#b8a47a", 0.24)
    )
    terrain3 = (
        smear(16, 15, 9, 4.5, "#9aa080", 0.55)
        + smear(22, 18, 7, 4, "#a8b090", 0.5)
        + smear(14, 22, 6, 3.5, "#7e8662", 0.6)
        + stain(
            "M12 12 C16 9, 24 10, 27 14 C29 17, 24 20, 16 19 C11 18, 9 15, 12 12 Z",
            "#7e8662",
            0.48,
        )
        + smear(26, 26, 4.5, 3, "#7e8662", 0.45)
        + smear(9, 14, 3.5, 4, "#a8b090", 0.4)
        + pebble(20, 28, 1.0, "#7e8662", 0.42)
        + smear(3, 2, 6, 4, "#a8b090", 0.26)
        + smear(33, 16, 4.5, 5, "#7e8662", 0.28)
        + smear(20, 33.5, 6, 3.5, "#9aa080", 0.24)
    )
    terrain4 = (
        smear(15, 14, 8, 5, "#6a7854", 0.55)
        + smear(22, 17, 7, 4.5, "#7a8868", 0.5)
        + smear(18, 23, 8, 4, "#4e5a3e", 0.62)
        + stain(
            "M11 11 C15 8, 23 9, 27 13 C30 16, 25 20, 16 19 C11 18, 8 15, 11 11 Z",
            "#4e5a3e",
            0.5,
        )
        + smear(10, 24, 4, 3.5, "#6a7854", 0.45)
        + smear(27, 24, 3.5, 4, "#4e5a3e", 0.42)
        + smear(20, 29, 6, 2.2, "#7a8868", 0.4)
        + pebble(12, 12, 0.9, "#4e5a3e", 0.45)
        + smear(2, 10, 5, 4, "#6a7854", 0.26)
        + smear(28, 1.5, 6, 4, "#7a8868", 0.24)
        + smear(33, 30, 4.5, 5, "#4e5a3e", 0.28)
    )
    return {
        "path": ground_tile("#2a241c", path_motifs),
        "terrain1": ground_tile("#e6d4b0", terrain1),
        "terrain2": ground_tile("#c8b48a", terrain2),
        "terrain3": ground_tile("#8e9470", terrain3),
        "terrain4": ground_tile("#5c6848", terrain4),
    }


def ash_tiles() -> dict[str, str]:
    path_motifs = (
        smear(20, 18, 8, 6, "#2a2a2a", 0.55)
        + smear(12, 22, 5, 4, "#1c1c1c", 0.58)
        + stain(
            "M14 11 C18 9, 24 11, 23 15 C22 18, 16 19, 14 16 C12 13, 11 12, 14 11 Z",
            "#2a2a2a",
            0.42,
        )
        + pebble(26, 27, 1.0, "#2a2a2a", 0.4)
        + smear(3, 2.5, 5, 4.5, "#1c1c1c", 0.28)
        + smear(33, 16, 4.5, 5, "#2a2a2a", 0.26)
        + smear(12, 33.5, 6, 3.5, "#2a2a2a", 0.24)
    )
    terrain1 = (
        smear(18, 18, 11, 7, "#ddd8d2", 0.42)
        + smear(12, 13, 5, 6, "#c4bfb8", 0.5)
        + smear(25, 24, 6, 4, "#b8b3ac", 0.48)
        + stain(
            "M20 10 C24 9, 28 13, 26 17 C24 20, 18 19, 17 15 C16 12, 17 10, 20 10 Z",
            "#c4bfb8",
            0.4,
        )
        + pebble(10, 26, 0.9, "#b8b3ac", 0.4)
        + smear(1.5, 14, 5, 6, "#c4bfb8", 0.26)
        + smear(26, 1.5, 6, 4, "#ddd8d2", 0.28)
        + smear(33, 31, 5, 4.5, "#b8b3ac", 0.24)
    )
    terrain2 = (
        smear(14, 16, 7, 8, "#b4afa8", 0.48)
        + smear(24, 18, 6, 7, "#98948c", 0.55)
        + smear(18, 27, 8, 3, "#8e8a82", 0.45)
        + stain(
            "M11 12 C14 8, 20 9, 21 14 C22 18, 16 20, 12 17 C9 15, 8 13, 11 12 Z",
            "#8e8a82",
            0.48,
        )
        + smear(28, 12, 3, 4, "#b4afa8", 0.4)
        + pebble(22, 10, 0.9, "#8e8a82", 0.42)
        + smear(8, 1.5, 5, 4.5, "#b4afa8", 0.26)
        + smear(33, 22, 4.5, 6, "#98948c", 0.28)
        + smear(16, 34, 7, 3.2, "#8e8a82", 0.24)
    )
    terrain3 = (
        smear(14, 18, 6, 8, "#5a5650", 0.55)
        + smear(22, 16, 8, 5, "#625e58", 0.5)
        + smear(18, 22, 5.5, 5, "#7c7872", 0.48)
        + stain(
            "M9 18 C12 13, 20 12, 26 16 C30 19, 24 25, 15 25 C10 25, 6 22, 9 18 Z",
            "#7c7872",
            0.42,
        )
        + smear(26, 24, 4, 3.5, "#5a5650", 0.45)
        + smear(11, 12, 4, 3.5, "#625e58", 0.4)
        + pebble(24, 11, 1.0, "#625e58", 0.42)
        + smear(3, 3, 5, 4, "#7c7872", 0.26)
        + smear(33, 10, 4.5, 5, "#625e58", 0.24)
        + smear(10, 33.5, 6, 4, "#5a5650", 0.28)
    )
    terrain4 = (
        smear(15, 17, 6, 7, "#343434", 0.62)
        + smear(23, 15, 7, 4.5, "#4a4a4a", 0.52)
        + smear(18, 23, 5, 4.5, "#52524e", 0.55)
        + stain(
            "M8 14 C12 10, 22 10, 28 14 C31 17, 24 21, 14 20 C9 19, 6 17, 8 14 Z",
            "#52524e",
            0.48,
        )
        + smear(11, 26, 5, 3, "#4a4a4a", 0.45)
        + smear(27, 25, 3.5, 4, "#343434", 0.5)
        + smear(26, 11, 3.5, 3, "#52524e", 0.4)
        + pebble(12, 12, 0.9, "#343434", 0.45)
        + smear(2, 8, 5, 4, "#4a4a4a", 0.26)
        + smear(30, 33.5, 6, 4, "#52524e", 0.24)
        + smear(33, 18, 4.5, 6, "#343434", 0.28)
    )
    return {
        "path": ground_tile("#222222", path_motifs),
        "terrain1": ground_tile("#d2cdc6", terrain1),
        "terrain2": ground_tile("#a8a39c", terrain2),
        "terrain3": ground_tile("#6e6a64", terrain3),
        "terrain4": ground_tile("#3e3e3e", terrain4),
    }


# Each region's variant palette, read off the shipped art above: the same field
# fills, the same motif hexes per kind, and a drift radius band taken from the
# range that kind's shipped drifts actually use.
RUSTBLOOM_TILE_PALETTE = region_tile_palette(
    0,
    {
        "path": ("#241c18", ["#302620", "#1a1410"], (6.0, 7.0, 5.0, 6.0)),
        "terrain1": ("#d4b494", ["#e0c4a4", "#c4a888", "#b89878"], (5.0, 11.0, 4.0, 8.0)),
        "terrain2": ("#b08a68", ["#c4a080", "#a07858", "#8f6c50"], (6.0, 8.0, 4.0, 6.0)),
        "terrain3": ("#8c6244", ["#9a6848", "#7a5438", "#a07858"], (4.5, 8.0, 3.5, 7.0)),
        "terrain4": ("#6a4630", ["#7a5438", "#5a3c28", "#806048"], (5.0, 8.0, 4.0, 7.0)),
    },
)

SAND_TILE_PALETTE = region_tile_palette(
    1,
    {
        "path": ("#2a241c", ["#3a3428", "#201c16"], (7.0, 11.0, 3.0, 3.4)),
        "terrain1": ("#e6d4b0", ["#efe0c4", "#dcc8a4", "#c8b48a"], (3.0, 11.0, 2.8, 6.5)),
        "terrain2": ("#c8b48a", ["#d4c49a", "#b8a47a", "#b09a72"], (2.8, 11.0, 2.6, 6.0)),
        "terrain3": ("#8e9470", ["#9aa080", "#a8b090", "#7e8662"], (6.0, 9.0, 3.5, 4.5)),
        "terrain4": ("#5c6848", ["#6a7854", "#7a8868", "#4e5a3e"], (4.0, 8.0, 4.0, 5.0)),
    },
)

ASH_TILE_PALETTE = region_tile_palette(
    2,
    {
        "path": ("#222222", ["#2a2a2a", "#1c1c1c"], (5.0, 8.0, 4.0, 6.0)),
        "terrain1": ("#d2cdc6", ["#ddd8d2", "#c4bfb8", "#b8b3ac"], (5.0, 11.0, 4.0, 7.0)),
        "terrain2": ("#a8a39c", ["#b4afa8", "#98948c", "#8e8a82"], (6.0, 8.0, 3.0, 8.0)),
        "terrain3": ("#6e6a64", ["#5a5650", "#625e58", "#7c7872"], (5.0, 8.0, 5.0, 8.0)),
        "terrain4": ("#3e3e3e", ["#343434", "#4a4a4a", "#52524e"], (5.0, 7.0, 4.5, 7.0)),
    },
)


def aftermath_region_tiles() -> list[dict[str, list[str]]]:
    return [
        tile_variants(RUSTBLOOM_TILE_PALETTE, rustbloom_tiles()),
        tile_variants(SAND_TILE_PALETTE, sand_tiles()),
        tile_variants(ASH_TILE_PALETTE, ash_tiles()),
    ]


def rustbloom_base() -> str:
    pad = ellipse(54, 60, 42, 30, "#6a4a34", opacity=0.94)
    crate = rect(22, 62, 16, 12, 1.2, SCRAP_WOOD, INK, 1.0) + line(22, 68, 38, 68, SCRAP_WOOD_DARK, 0.8)
    silo_shadow = circle(58, 56, 21, "#4a2e1c")
    silo = circle(54, 50, 20, "#8a5a3a", INK, 1.6)
    silo_light = ellipse(46, 42, 8, 4.5, "#c48a62", opacity=0.8)
    ring_outer = circle(54, 50, 13, "none", "#6a4030", 1.4)
    ring_inner = circle(54, 50, 6, "none", "#5a3424", 1.1)
    hatch = rect(50, 46, 8, 6, 1, "#5a4030", INK, 0.6)
    lamp_pole = line(70, 46, 80, 32, "#4a4038", 1.6)
    lamp_halo = circle(82, 30, 11, "#ffb020", opacity=0.28)
    lamp = circle(82, 30, 4.2, "#ffcc66", "#a85a10", 0.8)
    return base_svg(
        pad + crate + silo_shadow + silo + silo_light + ring_outer + ring_inner + hatch + lamp_pole + lamp_halo + lamp
    )


def sand_base() -> str:
    pad = ellipse(54, 62, 44, 28, "#d2c09a", opacity=0.92)
    umbrella = polygon(regular_points(54, 28, 14, 8, 22.5), "#d85a4a", "#6a241c", 1.0)
    umbrella_light = polygon(regular_points(51, 25, 6, 8, 22.5), "#f0a090", opacity=0.85)
    pole = line(54, 40, 54, 52, BONE_DARK, 1.6)
    bus = rect(28, 48, 54, 26, 4, "#6a7a58", "#2e3828", 1.4)
    stripe = rect(30, 59, 50, 3.2, 0.4, "#c45a48")
    windows = []
    for window_index in range(4):
        window_x = 34 + window_index * 11
        windows.append(rect(window_x, 52, 7, 5, 0.6, "#d5ece8", "#2e3828", 0.5))
    drift = ellipse(70, 70, 22, 10, "#e6d4b0", opacity=0.9)
    return base_svg(pad + umbrella + umbrella_light + pole + bus + "".join(windows) + stripe + drift)


def ash_base() -> str:
    pad = ellipse(54, 58, 40, 32, "#3a3a3a", opacity=0.92)
    stones = []
    for stone_index in range(8):
        angle = math.radians(stone_index * 45)
        stone_x = 54 + math.cos(angle) * 34
        stone_y = 56 + math.sin(angle) * 26
        stones.append(circle(stone_x, stone_y, 4.2, "#9a9690", "#4a4844", 0.8))
    cabin = rect(38, 42, 32, 30, 1.5, "#5a4638", INK, 1.3)
    roof = rect(36, 38, 30, 26, 1.2, "#4a4038", "#241c16", 1.2)
    roof_light = rect(40, 42, 12, 4, 0.6, "#6a6058", opacity=0.7)
    chimney = circle(58, 44, 4.5, "#2a2a2a", "#111", 0.9) + circle(58, 44, 2.1, "#1a1a1a")
    wisp = circle(60, 36, 2.2, "#b8b4ae", opacity=0.28) + circle(63, 32, 1.6, "#d0ccc6", opacity=0.2)
    return base_svg(pad + "".join(stones) + cabin + roof + roof_light + chimney + wisp)


def hatch_lid() -> str:
    ring = circle(18, 18, 12.4, "#4a4e54", "#1c1e22", 1.15)
    lid = circle(18, 18, 9.6, "#3a3e44", "#1c1e22", 0.7)
    lid_light = ellipse(15, 14.5, 4.2, 2.2, "#6a7078", opacity=0.75)
    bolts = []
    for bolt_index in range(8):
        angle = math.radians(bolt_index * 45)
        bolts.append(circle(18 + math.cos(angle) * 11.1, 18 + math.sin(angle) * 11.1, 0.7, "#d2cdc4", "#3a3e44", 0.3))
    wheel = circle(18, 18, 3.6, "none", BONE, 0.9)
    spokes = (
        line(18, 14.6, 18, 21.4, BONE, 0.7)
        + line(14.6, 18, 21.4, 18, BONE, 0.7)
        + circle(18, 18, 1.05, "#8a8680", INK, 0.35)
    )
    return ring + lid + lid_light + "".join(bolts) + wheel + spokes


def spawn_art() -> dict[str, str]:
    hole = circle(18, 18, 11.2, "#12140e", INK, 0.8)
    ladder = (
        line(15.2, 10, 15.2, 26, "#5a564c", 0.7)
        + line(20.8, 10, 20.8, 26, "#5a564c", 0.7)
        + line(15.2, 14, 20.8, 14, "#5a564c", 0.55)
        + line(15.2, 18, 20.8, 18, "#5a564c", 0.55)
        + line(15.2, 22, 20.8, 22, "#5a564c", 0.55)
    )
    leak = path_shape("M18 18 L18 8 A10 10 0 0 1 27 16 Z", "#d8ffb0", opacity=0.8)
    closed = tile_svg(hatch_lid())
    transition = tile_svg(hole + leak + svg_group(hatch_lid(), "rotate(-50 18 18) translate(6 -4)"))
    opened = tile_svg(
        hole
        + ladder
        + circle(18, 18, 12.4, "none", "#8adf6a", 1.35)
        + svg_group(hatch_lid(), "translate(8 -10)")
    )
    return {"closed": closed, "open": opened, "transition": transition}


# ===== Map site art (drawn at 26 world px from a 36x36 authoring box) =====

SITE_PAD_SHADOW = "rgba(0,0,0,0.28)"
# Site silhouettes need three steel values to separate a blade edge, a blade
# face, and a shaded side at 26px, so the site palette carries two more steps
# than the tower and base art use.
STEEL_BRIGHT = "#c6ced6"
STEEL_MID = "#8f979f"
STEEL_DEEP = "#4f5760"
LAMP_LENS = "#f6e6b4"
CACHE_BODY_FILL = "#4a4038"
CACHE_BODY_FILL_BROKEN = "#33291f"
CACHE_LID_FILL = "#5c5248"
CACHE_LID_FILL_OPEN = "#6a5e52"
CACHE_LID_FILL_BROKEN = "#3f362c"
CACHE_MOUTH_FILL = "#1c1e22"

BUILDING_KINDS = ["armory", "magazine", "beacon", "foundry", "clocktower", "aviary"]
CACHE_STATES = ["sealed", "unlocked", "broken"]


def site_pad() -> str:
    """Contact shadow plus a dark steel plate, the ground mark every Aftermath
    site shares. The plate is dark enough to carry a silhouette on the lightest
    sand tile and to stay off the darkest ash tile."""
    return (
        ellipse(18, 29.4, 10.5, 3.4, SITE_PAD_SHADOW)
        + rect(7.5, 24.6, 21, 4.6, 1, STEEL_DARK, INK, 0.9)
        + rect(7.5, 24.6, 21, 1.4, None, STEEL, opacity=0.5)
    )


def armory_building() -> str:
    """Welded blade rack: two salvaged blades over a hazard-wrapped post. The
    blades carry the brightest steel in the block, because at 26px the rack has
    to read off a light sand tile as well as a dark ash one."""
    return site_pad() + (
        path_shape("M11.8,6.2 L15.8,8.6 L15.8,21.4 L11.8,23.8 Z", STEEL_BRIGHT, INK, 0.9)
        + path_shape("M24.2,6.2 L20.2,8.6 L20.2,21.4 L24.2,23.8 Z", STEEL_MID, INK, 0.9)
        + rect(16, 9.6, 4, 14.4, 0.8, STEEL_DARK, INK, 0.9)
        + rect(16, 12.6, 4, 5.6, 0.6, HAZARD, INK, 0.8)
        + rect(11, 22.4, 14, 2.6, 0.9, STEEL_DARK, INK, 0.9)
        + line(12.8, 8.2, 12.8, 21.4, "#ffffff", 0.5, opacity=0.6)
        + line(22.4, 9.2, 22.4, 21.4, BONE, 0.5, opacity=0.45)
    )


def magazine_building() -> str:
    """Three stacked steel ammo cans, each with a bone inventory label."""
    can_tiers = ((14.8, 4.6, 15.4), (12.0, 4.4, 10.8), (9.0, 4.2, 6.4))
    parts = [site_pad(), rect(9.4, 20.2, 17.2, 4.8, 0.9, STEEL_DARK, INK, 0.9)]
    for tier, (can_width, can_height, can_y) in enumerate(can_tiers):
        can_left = 18 - can_width / 2
        parts.append(rect(can_left, can_y, can_width, can_height, 0.8,
                          STEEL if tier % 2 == 0 else STEEL_DEEP, INK, 0.9))
        parts.append(rect(can_left + 1, can_y + 0.8, can_width - 2, 1.2, None, STEEL_LIGHT, opacity=0.5))
        parts.append(rect(can_left + can_width / 2 - 2, can_y + 1.9, 4, 1.5, 0.4, BONE, opacity=0.8))
    parts.append(line(11.4, 22.6, 24.6, 22.6, HAZARD, 1.1, opacity=0.85))
    parts.append(rect(16.6, 6.4, 2.8, 1.8, 0.6, HAZARD, INK, 0.7))
    return "".join(parts)


def foundry_building() -> str:
    """Riveted salvage furnace: a drum on the pad with a hazard-lit firebox arch
    and a stovepipe under a rain cap. The filled hot mouth is the tell at 26px,
    where the magazine only marks its base with a hazard line."""
    return site_pad() + (
        rect(9.8, 3.6, 4.6, 11.2, 0.5, STEEL_DARK, INK, 0.9)
        + rect(8.6, 2.4, 7, 2.2, 0.4, STEEL, INK, 0.9)
        + rect(9.2, 12.6, 6.2, 2.2, 0.4, STEEL_DEEP, INK, 0.8)
        + rect(9.4, 14.4, 17.2, 9.6, 1, STEEL, INK, 1)
        + rect(9.4, 14.4, 17.2, 1.6, None, STEEL_LIGHT, opacity=0.5)
        + path_shape("M14.4,24 L14.4,19.8 Q14.4,16.8 17.6,16.8 L21.4,16.8 Q24.6,16.8 24.6,19.8 L24.6,24 Z",
                     HAZARD, INK, 0.9)
        + line(17.2, 18.6, 17.2, 22.2, INK, 0.7, opacity=0.5)
        + line(20.2, 18.6, 20.2, 22.2, INK, 0.7, opacity=0.5)
        + line(14.4, 21.4, 24.6, 21.4, INK, 0.7, opacity=0.5)
        + circle(11.8, 16.6, 0.9, BONE, INK, 0.4)
        + circle(11.8, 22.2, 0.9, BONE, INK, 0.4)
    )


def clocktower_building() -> str:
    """Salvaged clocktower: a braced leg under a flared cap, a bone dial with ink
    hands, and the counterweight still hanging off the right face on its cord."""
    return site_pad() + (
        path_shape("M12.4,24.6 L13.4,10.4 L22.6,10.4 L23.6,24.6 Z", STEEL_DARK, INK, 1)
        + path_shape("M10.8,10.4 L25.2,10.4 L22,5.6 L14,5.6 Z", STEEL, INK, 1)
        + rect(13.2, 12.2, 9.6, 9.6, 1, STEEL, INK, 1)
        + circle(18, 17, 3.8, BONE, INK, 0.9)
        + line(18, 17, 18, 14.2, INK, 0.9)
        + line(18, 17, 20.6, 17.8, INK, 0.9)
        + circle(18, 17, 0.7, INK)
        + line(13.8, 23.4, 22.2, 23.4, STEEL_LIGHT, 0.7, opacity=0.55)
        + line(25.4, 11.4, 28.4, 11.4, INK, 0.8)
        + line(28.4, 11.4, 28.4, 20.2, STEEL_LIGHT, 0.8)
        + rect(26.6, 20.2, 3.6, 4.4, 0.6, STEEL, INK, 0.9)
        + circle(28.4, 18.4, 1, BONE, INK, 0.5)
    )


def aviary_building() -> str:
    """Salvaged roost: a steel frame under a ridge roof, bone netting over a perch
    bar with a bone bird on it, and a flight chevron over the ridge. The netting
    is the tell at 26px: the armory crosses two blades, the magazine stacks cans."""
    return site_pad() + (
        path_shape("M13.4,4.4 L18,7.2 L22.6,4.4", "none", STEEL_LIGHT, 1.5)
        + path_shape("M18,8 L26.4,12.6 L9.6,12.6 Z", STEEL, INK, 1)
        + rect(9.8, 12.6, 16.4, 12, 0.9, STEEL_DEEP, INK, 1)
        + line(13, 13.6, 13, 23.6, BONE, 0.6, opacity=0.8)
        + line(18, 13.6, 18, 23.6, BONE, 0.6, opacity=0.8)
        + line(23, 13.6, 23, 23.6, BONE, 0.6, opacity=0.8)
        + line(10.6, 17.2, 25.4, 17.2, BONE, 0.6, opacity=0.8)
        + rect(11.4, 20.4, 13.2, 1.8, 0.4, STEEL, INK, 0.7)
        + ellipse(15.6, 18.6, 2.4, 1.8, BONE, INK, 0.6)
        + circle(17.8, 17.4, 1.2, BONE, INK, 0.6)
    )


def beacon_building() -> str:
    """Signal lamp on a braced pole: a warm halo, the brightest mark on any tile."""
    return site_pad() + (
        ellipse(18, 9.8, 8.4, 7.2, HAZARD, opacity=0.16)
        + path_shape("M14.6,24.6 L16.4,12.6 L19.6,12.6 L21.4,24.6 Z", STEEL_DARK, INK, 0.9)
        + line(13.4, 20.6, 22.6, 20.6, STEEL, 1.2)
        + rect(13.4, 6.4, 9.2, 6.4, 0.9, STEEL, INK, 0.9)
        + path_shape("M12.6,6.4 L23.4,6.4 L21.8,3.8 L14.2,3.8 Z", STEEL_DARK, INK, 0.9)
        + rect(14.8, 7.8, 6.4, 3.4, 0.5, LAMP_LENS, INK, 0.7)
        + rect(14.8, 7.8, 3.0, 3.4, None, "#ffffff", opacity=0.45)
        + line(17.9, 12.8, 17.9, 24.4, STEEL_LIGHT, 0.6, opacity=0.5)
    )


def cache_body(body_fill: str, lid_fill: str) -> str:
    return (
        ellipse(18, 29.4, 10.5, 3.4, SITE_PAD_SHADOW)
        + rect(7.6, 13.6, 20.8, 13, 1.2, body_fill, INK, 1)
        + rect(7.6, 13.6, 20.8, 1.8, None, lid_fill)
        + line(7.6, 18.4, 28.4, 18.4, INK, 0.8, opacity=0.4)
    )


def sealed_cache() -> str:
    """Closed footlocker: hazard band on the lid, steel hasp, bone padlock."""
    return cache_body(CACHE_BODY_FILL, CACHE_LID_FILL) + (
        rect(6.8, 9.6, 22.4, 4.8, 1, CACHE_LID_FILL, INK, 1)
        + rect(6.8, 10.6, 22.4, 2.6, None, HAZARD, opacity=0.8)
        + line(6.8, 11.9, 29.2, 11.9, INK, 0.6, opacity=0.35)
        + path_shape("M16.2,14.6 L16.2,13.2 Q16.2,11.9 17.4,11.9 Q18.6,11.9 18.6,13.2 L18.6,14.6",
                     STEEL_LIGHT, INK, 0.8)
        + rect(15.2, 14.2, 5.6, 5, 0.8, STEEL, INK, 0.9)
        + circle(18, 16.2, 0.9, BONE, INK, 0.5)
        + rect(9.6, 13.6, 1.4, 13, None, STEEL_DARK, opacity=0.7)
        + rect(25, 13.6, 1.4, 13, None, STEEL_DARK, opacity=0.7)
    )


def unlocked_cache() -> str:
    """Opened: the lid is tipped back off a dark mouth, a light shaft comes out,
    and the card that came from it is still standing in the opening."""
    return cache_body(CACHE_BODY_FILL, CACHE_LID_FILL) + (
        path_shape("M9.2,13.6 L26.8,13.6 L28.6,4.4 L7.4,4.4 Z", BONE, opacity=0.15)
        + rect(8.8, 14.2, 18.4, 2.8, 0.4, CACHE_MOUTH_FILL)
        + svg_element("rect", {
            "x": 6.8, "y": 5.6, "width": 22.4, "height": 4.8, "rx": 1,
            "fill": CACHE_LID_FILL_OPEN, "stroke": INK, "stroke-width": 1, "transform": "rotate(-15 18 8)",
        })
        + svg_element("rect", {
            "x": 14.6, "y": 8.4, "width": 6, "height": 7, "rx": 0.6,
            "fill": BONE, "stroke": INK, "stroke-width": 0.8, "transform": "rotate(-6 18 11)",
        })
        + line(8.8, 17.4, 27.2, 17.4, HAZARD, 0.7, opacity=0.5)
        + rect(23.6, 18.4, 3.2, 3.2, 0.6, STEEL_DARK, INK, 0.7)
    )


def broken_cache() -> str:
    """Battered open: lid hanging off one hinge, splintered front, contents out."""
    return cache_body(CACHE_BODY_FILL_BROKEN, CACHE_LID_FILL_BROKEN) + (
        path_shape("M7.2,7.4 L28.4,4.6 L28.4,9.4 L7.2,12.2 Z", CACHE_LID_FILL_BROKEN, INK, 1)
        + rect(8.8, 14.2, 18.4, 2.6, 0.4, CACHE_MOUTH_FILL, opacity=0.8)
        + path_shape("M12.6,16.6 L15.8,21.4 L13.4,24.2 L17,29 M23.4,16.6 L21.6,22.6 L25.2,26.4",
                     INK, stroke_width=1.1, opacity=0.7)
        + svg_element("rect", {
            "x": 19.4, "y": 15.6, "width": 5, "height": 5.4, "rx": 0.5,
            "fill": BONE, "stroke": INK, "stroke-width": 0.7, "transform": "rotate(14 22 18)",
        })
        + circle(12.8, 27.4, 1.7, HAZARD, INK, 0.4)
        + circle(18.4, 28.4, 1.3, BONE_DARK, INK, 0.4)
        + circle(23.4, 26.6, 1.5, STEEL_LIGHT, INK, 0.4)
    )


def supply_drop_svg() -> str:
    """The boss package: a strapped crate with hazard chevrons. The pulsing ring
    that marks it stays MapSiteLayer markup, so only the crate is theme art."""
    parts = [
        ellipse(18, 29.4, 10.5, 3.4, SITE_PAD_SHADOW),
        rect(8, 13.2, 20, 14.2, 1.2, SCRAP_WOOD, INK, 1),
        rect(8, 13.2, 20, 2, None, SCRAP_WOOD_LIGHT, opacity=0.6),
    ]
    for stripe_offset in (9.0, 14.5, 20.0):
        parts.append(path_shape(f"M{num(stripe_offset)},27.4 L{num(stripe_offset + 2.6)},27.4 "
                                f"L{num(stripe_offset + 7.4)},13.2 L{num(stripe_offset + 4.8)},13.2 Z",
                                HAZARD, opacity=0.85))
    parts.append(rect(11.2, 13.2, 2, 14.2, None, STEEL_DARK, opacity=0.9))
    parts.append(rect(22.8, 13.2, 2, 14.2, None, STEEL_DARK, opacity=0.9))
    parts.append(rect(14.2, 10.2, 7.6, 3, 0.7, STEEL, INK, 0.9))
    parts.append(rect(16.8, 9.8, 2.4, 3.8, 0.5, STEEL_LIGHT, INK, 0.8))
    return "".join(parts)


def site_art() -> dict:
    """The theme's `sites` block: buildings, cache states, and the boss package
    crate, each wrapped in the 36x36 box the renderer turns into a symbol."""
    return {
        "buildings": {
            kind: tile_svg(draw()) for kind, draw in (
                ("armory", armory_building),
                ("magazine", magazine_building),
                ("beacon", beacon_building),
                ("foundry", foundry_building),
                ("clocktower", clocktower_building),
                ("aviary", aviary_building),
            )
        },
        "caches": {
            state: tile_svg(draw()) for state, draw in (
                ("sealed", sealed_cache),
                ("unlocked", unlocked_cache),
                ("broken", broken_cache),
            )
        },
        "supplyDrop": tile_svg(supply_drop_svg()),
    }


# --- assembly ---------------------------------------------------------------


def animation_record(duration: float, images: list[str]) -> dict:
    return {"duration": duration, "frames": [{"image": image} for image in images]}


def build_theme() -> dict:
    towers = {}
    for tower_id, name, color, icon, fire_duration, walk_duration in TOWER_META:
        draw = TOWER_DRAW[tower_id]
        rest = draw("rest")
        discharge = draw("discharge")
        smoke = draw("smoke")
        towers[tower_id] = {
            "name": name,
            "color": color,
            "icon": icon,
            "animation": animation_record(fire_duration, [rest, discharge, smoke]),
            "walking": animation_record(walk_duration, [rest]),
        }
    enemies = {}
    for enemy_id, name, color, shape, walk_duration, hit_duration, attack_duration in ENEMY_META:
        animations = build_enemy_animations(ENEMY_DRAW[enemy_id], enemy_id)
        enemies[enemy_id] = {
            "name": name,
            "color": color,
            "shape": shape,
            "walking": animation_record(walk_duration, animations["walking"]),
            "hitReaction": animation_record(hit_duration, animations["hit"]),
            "attack": animation_record(attack_duration, animations["attack"]),
        }
    region_tiles = aftermath_region_tiles()
    regions = [
        {
            "id": 0,
            "name": "Rustbloom Wastes",
            "tiles": region_tiles[0],
            "base": rustbloom_base(),
            "mapImage": region_map_art.rustbloom_wastes_map(),
            "mapLayout": region_map_art.AFTERMATH_MAP_LAYOUTS[0],
        },
        {
            "id": 1,
            "name": "Sand and Regret",
            "tiles": region_tiles[1],
            "base": sand_base(),
            "mapImage": region_map_art.sand_and_regret_map(),
            "mapLayout": region_map_art.AFTERMATH_MAP_LAYOUTS[1],
        },
        {
            "id": 2,
            "name": "Ashen Highs",
            "tiles": region_tiles[2],
            "base": ash_base(),
            "mapImage": region_map_art.ashen_highs_map(),
            "mapLayout": region_map_art.AFTERMATH_MAP_LAYOUTS[2],
        },
    ]
    return {
        "menuBackground": menu_background_art.aftermath_menu_background(),
        "towers": towers,
        "enemies": enemies,
        "regions": regions,
        "sites": site_art(),
        "spawns": spawn_art(),
    }


def validate_theme(theme: dict) -> None:
    menu_background_art.assert_menu_paint(theme["menuBackground"], "menu background")
    for tower_id, name, color, icon, fire_duration, walk_duration in TOWER_META:
        tower = theme["towers"][tower_id]
        frames = tower["animation"]["frames"]
        if tower["name"] != name or tower["color"] != color or tower["icon"] != icon:
            raise SystemExit(f"tower identity drifted: {tower_id}")
        if len(frames) != 3 or tower["animation"]["duration"] != fire_duration:
            raise SystemExit(f"tower animation contract failed: {tower_id}")
        if len(tower["walking"]["frames"]) != 1 or tower["walking"]["duration"] != walk_duration:
            raise SystemExit(f"tower walking contract failed: {tower_id}")
        if tower["walking"]["frames"][0]["image"] != frames[0]["image"]:
            raise SystemExit(f"walking frame is not the resting tower: {tower_id}")
        tower_images = [frame["image"] for frame in frames]
        for frame_index, image in enumerate(tower_images):
            assert_frame_inside_clip_box(image, f"tower {tower_id} animation#{frame_index}", TOWER_CLIP_HALF)
        assert_no_ground_shadow(tower_id, tower_images)
    for enemy_id, name, color, shape, walk_duration, hit_duration, attack_duration in ENEMY_META:
        enemy = theme["enemies"][enemy_id]
        if enemy["name"] != name or enemy["color"] != color or enemy["shape"] != shape:
            raise SystemExit(f"enemy identity drifted: {enemy_id}")
        if len(enemy["walking"]["frames"]) != 8 or enemy["walking"]["duration"] != walk_duration:
            raise SystemExit(f"walk contract failed: {enemy_id}")
        if len(enemy["hitReaction"]["frames"]) != 3 or enemy["hitReaction"]["duration"] != hit_duration:
            raise SystemExit(f"hit contract failed: {enemy_id}")
        if len(enemy["attack"]["frames"]) != 3 or enemy["attack"]["duration"] != attack_duration:
            raise SystemExit(f"attack contract failed: {enemy_id}")
        enemy_images = []
        for record_name in ("walking", "hitReaction", "attack"):
            record_images = [frame["image"] for frame in enemy[record_name]["frames"]]
            for frame_index, image in enumerate(record_images):
                assert_frame_inside_clip_box(
                    image, f"enemy {enemy_id} {record_name}#{frame_index}", ENEMY_CLIP_HALF)
            enemy_images.extend(record_images)
        assert_no_ground_shadow(enemy_id, enemy_images)
    if [region["name"] for region in theme["regions"]] != ["Rustbloom Wastes", "Sand and Regret", "Ashen Highs"]:
        raise SystemExit("region names drifted")
    for region_index, region in enumerate(theme["regions"]):
        if sorted(region["tiles"]) != sorted(TILE_KINDS):
            raise SystemExit(f"tile kinds drifted: {region['name']}")
        for tile_name, tile_images in region["tiles"].items():
            label = f"{region['name']} {tile_name}"
            if len(tile_images) != TILE_VARIANT_COUNT:
                raise SystemExit(f"{label}: expected {TILE_VARIANT_COUNT} variants, found {len(tile_images)}")
            field_fills = set()
            for variant_index, tile_image in enumerate(tile_images):
                assert_paint(tile_image, f"{label} v{variant_index}")
                assert_tile_paint(tile_image, f"{label} v{variant_index}")
                field_fills.add(first_field_fill(tile_image, f"{label} v{variant_index}"))
            if len(field_fills) != 1:
                raise SystemExit(f"{label}: variants disagree on the field fill {sorted(field_fills)}")
        assert_paint(region["base"], region["name"])
        if region["mapLayout"] != region_map_art.AFTERMATH_MAP_LAYOUTS[region_index]:
            raise SystemExit(f"map layout drifted: {region['name']}")
        region_map_art.assert_map_paint(region["mapImage"], f"{region['name']} map image")
    for spawn_name, spawn_image in theme["spawns"].items():
        assert_paint(spawn_image, spawn_name)
    validate_site_art(theme["sites"])


def validate_site_art(sites: dict) -> None:
    if sorted(sites) != ["buildings", "caches", "supplyDrop"]:
        raise SystemExit("sites block must carry buildings, caches, and supplyDrop")
    for group, ids in (("buildings", BUILDING_KINDS), ("caches", CACHE_STATES)):
        if sorted(sites[group]) != sorted(ids):
            raise SystemExit(f"sites.{group} must carry {ids}")
        for site_id in ids:
            assert_boxed_art(sites[group][site_id], f"site {group}.{site_id}")
    assert_boxed_art(sites["supplyDrop"], "site supplyDrop")


def assert_paint(image: str, label: str) -> None:
    if not image.startswith("<svg ") or "url(#" in image or "<filter" in image:
        raise SystemExit(f"paint constraint failed for {label}")


def non_color_numbers(svg: str) -> list[float]:
    """Every coordinate in the art, ignoring the numbers inside paint values."""
    stripped = re.sub(r'(?:fill|stroke)="[^"]*"', "", svg)
    return [float(value) for value in re.findall(r"\d+\.?\d*", stripped)]


def assert_boxed_art(image: str, label: str, box_size: float = TILE_SIZE) -> None:
    assert_paint(image, label)
    expected_view_box = f'<svg viewBox="0 0 {num(box_size)} {num(box_size)}">'
    if expected_view_box not in image:
        raise SystemExit(f"{label}: art must open with the {num(box_size)}x{num(box_size)} viewBox wrapper")
    for value in non_color_numbers(image):
        if value > box_size + 0.5:
            raise SystemExit(f"{label}: coordinate {value} runs past the {num(box_size)}px bounds")


# --- sprite ink bounds -------------------------------------------------------
#
# A rotating sprite is clipped to its own viewBox by the <use> element that draws it, so
# ink outside that box is not a smaller sprite, it is a missing sprite. These helpers
# answer one question: where does a frame's ink actually land. Group transforms are
# applied, curve bulges are resolved rather than read off the endpoints, a circle or
# ellipse is measured through the matrix instead of through the corners of its own box,
# and a stroked shape's box grows by half its stroke width.

TOWER_CLIP_HALF = 16.0
ENEMY_CLIP_HALF = 1.0

# Two num() roundings on one coordinate can move it 0.01, and a frame's box carries four
# of them, so this is the slack a legitimately flush frame is allowed.
CLIP_SLACK = 0.02

GROUND_SHADOW_COLOR = "#120e0c"

NUMBER = r"-?\d*\.?\d+(?:[eE]-?\d+)?"
SHAPE_NAMES = ("ellipse", "circle", "rect", "polygon", "polyline", "line", "path")
ANY_TAG = re.compile(r"<(/?[A-Za-z][\w:-]*)((?:\"[^\"]*\"|[^>\"])*?)(/?)>")
ATTRIBUTE = re.compile(r'([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"')
COORDINATE_PAIR = re.compile(rf"({NUMBER})[ ,]+({NUMBER})")
PATH_STREAM = re.compile(r"([A-Za-z])([^A-Za-z]*)")
TRANSFORM_OPERATION = re.compile(r"(\w+)\s*\(([^)]*)\)")
IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
CURVE_EPSILON = 1e-9
CURVE_ARGUMENT_COUNT = {"C": 6, "S": 4, "Q": 4, "T": 2}

# How finely an arc is walked. The bound on what the walk can miss scales as one over
# this, so it buys accuracy with time and nothing else.
ARC_SAMPLES = 2048

# Every frame is drawn inside a group that declares round joins and round caps, which is
# what makes half a stroke width the exact growth rather than an estimate: a round pen
# means the ink is the geometry swept by a disc. A frame that stops declaring it would be
# measured short at every corner, so the declaration is required rather than assumed.
ROUND_PEN_DECLARATION = 'stroke-linejoin="round" stroke-linecap="round"'

# A stroke narrower than this fraction of a device pixel, at the width a sprite is drawn
# on the board, cannot put ink a player could see outside its own geometry.
FAINT_STROKE_PIXELS = 0.1
BOARD_PIXELS = 27.0


class Ellipse(NamedTuple):
    """A circle or ellipse, which has no finite bounding point set and so cannot be
    measured corner by corner: it has to be carried through the matrix analytically."""

    center_x: float
    center_y: float
    radius_x: float
    radius_y: float


def tag_attributes(body: str) -> dict[str, str]:
    return dict(ATTRIBUTE.findall(body))


def multiply_matrices(left: tuple[float, ...], right: tuple[float, ...]) -> tuple[float, ...]:
    left_a, left_b, left_c, left_d, left_e, left_f = left
    right_a, right_b, right_c, right_d, right_e, right_f = right
    return (
        left_a * right_a + left_c * right_b,
        left_b * right_a + left_d * right_b,
        left_a * right_c + left_c * right_d,
        left_b * right_c + left_d * right_d,
        left_a * right_e + left_c * right_f + left_e,
        left_b * right_e + left_d * right_f + left_f,
    )


def transform_point(
    matrix: tuple[float, ...], point_x: float, point_y: float
) -> tuple[float, float]:
    matrix_a, matrix_b, matrix_c, matrix_d, matrix_e, matrix_f = matrix
    return (
        matrix_a * point_x + matrix_c * point_y + matrix_e,
        matrix_b * point_x + matrix_d * point_y + matrix_f,
    )


def matrix_from_transform(transform: str) -> tuple[float, ...]:
    """A transform list applies left to right, so each operation is appended on the right
    of the product built so far, and a rotate's pivot is composed around the point it
    names."""
    values = IDENTITY
    for name, argument_text in TRANSFORM_OPERATION.findall(transform):
        numbers = [float(value) for value in re.findall(NUMBER, argument_text)]
        if name == "translate":
            offset_x = numbers[0]
            offset_y = numbers[1] if len(numbers) > 1 else 0.0
            values = multiply_matrices(values, (1.0, 0.0, 0.0, 1.0, offset_x, offset_y))
        elif name == "scale":
            scale_x = numbers[0]
            scale_y = numbers[1] if len(numbers) > 1 else scale_x
            values = multiply_matrices(values, (scale_x, 0.0, 0.0, scale_y, 0.0, 0.0))
        elif name == "rotate":
            degrees = numbers[0]
            pivot_x = numbers[1] if len(numbers) > 2 else 0.0
            pivot_y = numbers[2] if len(numbers) > 2 else 0.0
            radians = math.radians(degrees)
            cosine, sine = math.cos(radians), math.sin(radians)
            about_pivot = multiply_matrices(
                multiply_matrices((1.0, 0.0, 0.0, 1.0, pivot_x, pivot_y),
                                  (cosine, sine, -sine, cosine, 0.0, 0.0)),
                (1.0, 0.0, 0.0, 1.0, -pivot_x, -pivot_y),
            )
            values = multiply_matrices(values, about_pivot)
    return values


def matrix_scale(matrix: tuple[float, ...]) -> float:
    """The largest factor the matrix multiplies any length by, which is what turns a
    stroke width written in a shape's own units into one in frame units."""
    return max(math.hypot(matrix[0], matrix[1]), math.hypot(matrix[2], matrix[3]))


def quadratic_roots(low: float, middle: float, high: float) -> list[float]:
    """Roots of a*t^2 + b*t + c, the shared shape of a quadratic Bezier's coordinate
    function and of a cubic's derivative."""
    leading = low - 2.0 * middle + high
    linear = 2.0 * (middle - low)
    constant = low
    if abs(leading) < CURVE_EPSILON:
        return [] if abs(linear) < CURVE_EPSILON else [-constant / linear]
    discriminant = linear * linear - 4.0 * leading * constant
    if discriminant < 0.0:
        return []
    root = math.sqrt(discriminant)
    return [(-linear + root) / (2.0 * leading), (-linear - root) / (2.0 * leading)]


def cubic_point(
    start: tuple[float, float],
    control_one: tuple[float, float],
    control_two: tuple[float, float],
    end: tuple[float, float],
    ratio: float,
) -> tuple[float, float]:
    inverse = 1.0 - ratio
    return (
        inverse ** 3 * start[0] + 3 * inverse * inverse * ratio * control_one[0]
        + 3 * inverse * ratio * ratio * control_two[0] + ratio ** 3 * end[0],
        inverse ** 3 * start[1] + 3 * inverse * inverse * ratio * control_one[1]
        + 3 * inverse * ratio * ratio * control_two[1] + ratio ** 3 * end[1],
    )


def cubic_extremes(
    start: tuple[float, float],
    control_one: tuple[float, float],
    control_two: tuple[float, float],
    end: tuple[float, float],
) -> list[tuple[float, float]]:
    """Endpoints plus the real stationary points. Endpoints alone miss whatever bulge the
    control points pull out, and a dense walk only approximates it, so the derivative is
    solved instead."""
    extremes = [start, end]
    for axis in (0, 1):
        for ratio in quadratic_roots(control_one[axis] - start[axis],
                                     control_two[axis] - control_one[axis],
                                     end[axis] - control_two[axis]):
            if CURVE_EPSILON < ratio < 1.0 - CURVE_EPSILON:
                extremes.append(cubic_point(start, control_one, control_two, end, ratio))
    return extremes


def quadratic_point(
    start: tuple[float, float], control: tuple[float, float], end: tuple[float, float], ratio: float
) -> tuple[float, float]:
    inverse = 1.0 - ratio
    squared_inverse, squared_ratio = inverse * inverse, ratio * ratio
    weight = 2.0 * inverse * ratio
    return (
        squared_inverse * start[0] + weight * control[0] + squared_ratio * end[0],
        squared_inverse * start[1] + weight * control[1] + squared_ratio * end[1],
    )


def quadratic_extremes(
    start: tuple[float, float], control: tuple[float, float], end: tuple[float, float]
) -> list[tuple[float, float]]:
    """Endpoints plus the real stationary points. A quadratic's coordinate function is
    itself a quadratic in the curve parameter, so its extremes are at t = 0, t = 1 and one
    interior root per axis."""
    extremes = [start, end]
    for axis in (0, 1):
        for ratio in quadratic_roots(start[axis], control[axis], end[axis]):
            if CURVE_EPSILON < ratio < 1.0 - CURVE_EPSILON:
                extremes.append(quadratic_point(start, control, end, ratio))
    return extremes


def absolute_or_relative(
    position: tuple[float, float], offset_x: float, offset_y: float, relative: bool
) -> tuple[float, float]:
    if not relative:
        return (offset_x, offset_y)
    return (position[0] + offset_x, position[1] + offset_y)


def segment_extremes(
    position: tuple[float, float], upper: str, segment: list[float], relative: bool
) -> list[tuple[float, float]]:
    """The bounding points of one curve segment. S and T mirror the previous control point
    about the current one, which changes curvature only, so the pen's destination and the
    first control point are read straight off the arguments."""
    end = absolute_or_relative(position, segment[-2], segment[-1], relative)
    control_one = absolute_or_relative(position, segment[0], segment[1], relative)
    if upper in ("Q", "T"):
        return quadratic_extremes(position, control_one, end)
    control_two = absolute_or_relative(position, segment[2], segment[3], relative)
    return cubic_extremes(position, control_one, control_two, end)


def ellipse_frame_angle(
    point: tuple[float, float],
    center_x: float,
    center_y: float,
    cosine: float,
    sine: float,
    radius_x: float,
    radius_y: float,
) -> float:
    """The parameter angle of a point on a tilted ellipse, which needs the offset from the
    centre turned into the ellipse's own frame first. Read off the unrotated offset, the
    walk follows a different curve than the renderer draws."""
    delta_x, delta_y = point[0] - center_x, point[1] - center_y
    local_x = cosine * delta_x + sine * delta_y
    local_y = -sine * delta_x + cosine * delta_y
    return math.atan2(local_y / radius_y, local_x / radius_x)


def arc_extremes(
    start: tuple[float, float],
    end: tuple[float, float],
    radius_x: float,
    radius_y: float,
    rotation_degrees: float,
    large_arc: float,
    sweep: float,
) -> tuple[list[tuple[float, float]], float]:
    """Endpoint-to-centre conversion per the SVG implementation notes, a dense walk of the
    sweep, and the bound on what the walk can miss.

    A loaf outline is mostly arcs, and measuring only their endpoints measures it flat. An
    ellipse moves at most max(radius_x, radius_y) per radian and no two samples are more
    than the sweep divided by the sample count apart, so growing the walked box by that
    product makes the result an upper bound, which is the direction that cannot ship a
    clipped sprite believing it fits.
    """
    tilt = math.radians(rotation_degrees)
    cosine, sine = math.cos(tilt), math.sin(tilt)
    mid_x, mid_y = (start[0] - end[0]) / 2.0, (start[1] - end[1]) / 2.0
    offset_x = cosine * mid_x + sine * mid_y
    offset_y = -sine * mid_x + cosine * mid_y
    scaled_x = offset_x / radius_x if radius_x else 0.0
    scaled_y = offset_y / radius_y if radius_y else 0.0
    distance = scaled_x * scaled_x + scaled_y * scaled_y
    if distance > 1.0:
        radius_x *= math.sqrt(distance)
        radius_y *= math.sqrt(distance)
    numerator = max(radius_x * radius_x * radius_y * radius_y
                    - radius_x * radius_x * offset_y * offset_y
                    - radius_y * radius_y * offset_x * offset_x, 0.0)
    denominator = (radius_x * radius_x * offset_y * offset_y
                   + radius_y * radius_y * offset_x * offset_x)
    factor = math.sqrt(numerator / denominator) if denominator else 0.0
    if bool(large_arc) == bool(sweep):
        factor = -factor
    prime_x = factor * radius_x * offset_y / radius_y if radius_y else 0.0
    prime_y = -factor * radius_y * offset_x / radius_x if radius_x else 0.0
    center_x = cosine * prime_x - sine * prime_y + (start[0] + end[0]) / 2.0
    center_y = sine * prime_x + cosine * prime_y + (start[1] + end[1]) / 2.0
    start_angle = ellipse_frame_angle(start, center_x, center_y, cosine, sine, radius_x, radius_y)
    span = (ellipse_frame_angle(end, center_x, center_y, cosine, sine, radius_x, radius_y)
            - start_angle)
    if sweep and span < 0.0:
        span += 2.0 * math.pi
    if not sweep and span > 0.0:
        span -= 2.0 * math.pi
    samples = []
    for step in range(ARC_SAMPLES + 1):
        theta = start_angle + span * step / ARC_SAMPLES
        samples.append((
            center_x + radius_x * math.cos(theta) * cosine - radius_y * math.sin(theta) * sine,
            center_y + radius_x * math.cos(theta) * sine + radius_y * math.sin(theta) * cosine,
        ))
    return samples, max(radius_x, radius_y) * abs(span) / ARC_SAMPLES


def path_points(path_data: str) -> list[tuple[float, float]]:
    """Every point that can bound a path: each command's own endpoints plus the interior
    stationary points of its curves. An unrecognised command raises instead of truncating
    the walk, because a truncated walk under-measures and would pass a sprite whose ink
    really does escape its clip box."""
    collected: list[tuple[float, float]] = []
    position = (0.0, 0.0)
    subpath_start = (0.0, 0.0)
    for letter, argument_text in PATH_STREAM.findall(path_data):
        numbers = [float(value) for value in re.findall(NUMBER, argument_text)]
        upper = letter.upper()
        relative = letter.islower()
        cursor = 0
        if upper == "Z":
            position = subpath_start
            collected.append(position)
            continue
        while cursor < len(numbers):
            if upper in ("M", "L"):
                position = absolute_or_relative(position, numbers[cursor], numbers[cursor + 1], relative)
                if upper == "M":
                    subpath_start = position
                    upper = "L"
                collected.append(position)
                cursor += 2
            elif upper == "H":
                position = (position[0] + numbers[cursor] if relative else numbers[cursor], position[1])
                collected.append(position)
                cursor += 1
            elif upper == "V":
                position = (position[0], position[1] + numbers[cursor] if relative else numbers[cursor])
                collected.append(position)
                cursor += 1
            elif upper in CURVE_ARGUMENT_COUNT:
                width = CURVE_ARGUMENT_COUNT[upper]
                segment = numbers[cursor:cursor + width]
                collected.extend(segment_extremes(position, upper, segment, relative))
                position = absolute_or_relative(position, segment[-2], segment[-1], relative)
                cursor += width
            elif upper == "A":
                radii = numbers[cursor:cursor + 7]
                end = absolute_or_relative(position, radii[5], radii[6], relative)
                samples, growth = arc_extremes(position, end, radii[0], radii[1], radii[2],
                                              radii[3], radii[4])
                collected.extend((point_x - growth, point_y - growth) for point_x, point_y in samples)
                collected.extend((point_x + growth, point_y + growth) for point_x, point_y in samples)
                position = end
                cursor += 7
            else:
                raise SystemExit(f"path command {letter} is not measured")
    return collected


def shape_points(name: str, attrs: dict[str, str]) -> list[tuple[float, float]] | Ellipse:
    """Either the exact finite point set that bounds the shape, or the Ellipse record a
    circle or ellipse needs in order to be measured through the matrix."""

    def number(key: str) -> float:
        return float(attrs.get(key, 0) or 0)

    if name in ("polygon", "polyline"):
        return [(float(pair[0]), float(pair[1])) for pair in COORDINATE_PAIR.findall(attrs["points"])]
    if name == "path":
        return path_points(attrs.get("d", ""))
    if name == "rect":
        origin_x, origin_y = number("x"), number("y")
        width, height = number("width"), number("height")
        near_x, near_y = min(width, 0.0), min(height, 0.0)
        far_x, far_y = near_x + width, near_y + height
        return [(origin_x + near_x, origin_y + near_y), (origin_x + near_x, origin_y + far_y),
                (origin_x + far_x, origin_y + near_y), (origin_x + far_x, origin_y + far_y)]
    if name == "ellipse":
        return Ellipse(number("cx"), number("cy"), number("rx"), number("ry"))
    if name == "circle":
        radius = number("r")
        return Ellipse(number("cx"), number("cy"), radius, radius)
    return [(number("x1"), number("y1")), (number("x2"), number("y2"))]


def ellipse_extent(
    matrix: tuple[float, ...], ellipse: Ellipse
) -> tuple[float, float, float, float]:
    """Half-extents of an ellipse carried through an arbitrary matrix, read off the images
    of its two basis vectors. A circle's extent under a rotation about any point is its
    radius, and an ellipse's is never more than max(radius_x, radius_y); carrying the
    corners of the ellipse's own box through the matrix instead measures a rotated disc as
    a rotated square, which over-reports by up to a factor of root two."""
    moved_x, moved_y = transform_point(matrix, ellipse.center_x, ellipse.center_y)
    half_width = math.hypot(matrix[0] * ellipse.radius_x, matrix[2] * ellipse.radius_y)
    half_height = math.hypot(matrix[1] * ellipse.radius_x, matrix[3] * ellipse.radius_y)
    return moved_x - half_width, moved_y - half_height, moved_x + half_width, moved_y + half_height


def shape_stroke_growth(
    attrs: dict[str, str], matrix: tuple[float, ...], pixels_per_unit: float
) -> float:
    """Half a stroke width in frame units, or zero when the stroke cannot put ink outside
    the geometry. A stroke is centred on its path, so whatever shape it is drawn on the
    box grows by exactly this much on each side under the round pen this theme declares."""
    if attrs.get("stroke") == "none":
        return 0.0
    stroke_width = float(attrs.get("stroke-width", 0) or 0)
    if stroke_width <= 0.0:
        return 0.0
    opacity = float(attrs.get("opacity", 1) or 1) * float(attrs.get("stroke-opacity", 1) or 1)
    if opacity * stroke_width * pixels_per_unit < FAINT_STROKE_PIXELS:
        return 0.0
    return stroke_width / 2.0 * matrix_scale(matrix)


def shape_box(
    name: str, attrs: dict[str, str], matrix: tuple[float, ...], pixels_per_unit: float
) -> tuple[float, float, float, float]:
    geometry = shape_points(name, attrs)
    if isinstance(geometry, Ellipse):
        minimum_x, minimum_y, maximum_x, maximum_y = ellipse_extent(matrix, geometry)
    else:
        moved = [transform_point(matrix, point_x, point_y) for point_x, point_y in geometry]
        minimum_x = min(point[0] for point in moved)
        maximum_x = max(point[0] for point in moved)
        minimum_y = min(point[1] for point in moved)
        maximum_y = max(point[1] for point in moved)
    growth = shape_stroke_growth(attrs, matrix, pixels_per_unit)
    return minimum_x - growth, minimum_y - growth, maximum_x + growth, maximum_y + growth


def frame_ink_box(image: str, box_width: float) -> tuple[float, float, float, float]:
    """The ink bounding box of one frame: group transforms applied, curve bulges resolved,
    a stroked shape grown by half its stroke width.

    box_width is the frame's own viewBox width, which is what says what a user unit is
    worth on the board. A tower frame is 32 units across and an enemy frame 2, and both are
    drawn 27 pixels wide, so the same stroke width is a very different weight in each. A
    finite point set is transformed point by point, which is exact because a minimum and a
    maximum commute with a per-point map; a circle or an ellipse is the one shape whose ink
    is an infinite set, so it is measured through the matrix analytically instead.

    Two things are deliberately measured as more ink than they carry, because a validator
    that under-reports is worse than one that over-reports. A dashed stroke is taken as
    solid, since a dash's ink is still bounded by the line it sits on. A rounded rect's
    corners are carried through the rotation even though the rounding cuts them back, which
    over-reports by at most corner_radius * (root two - 1).
    """
    pixels_per_unit = BOARD_PIXELS / box_width if box_width else 1.0
    boxes: list[tuple[float, float, float, float]] = []
    stack: list[tuple[float, ...]] = [IDENTITY]
    stroked = False

    for match in ANY_TAG.finditer(image):
        name = match.group(1)
        body = match.group(2)
        if name == "/g":
            if len(stack) > 1:
                stack.pop()
            continue
        if name == "g":
            # A nested group's transform is applied before its parent's, so the stack
            # accumulates by multiplication on the left.
            transform = tag_attributes(body).get("transform", "")
            if not match.group(3):
                stack.append(multiply_matrices(stack[-1], matrix_from_transform(transform)))
            continue
        if name not in SHAPE_NAMES:
            continue
        attrs = tag_attributes(body)
        if attrs.get("stroke", "none") != "none":
            stroked = True
        matrix = multiply_matrices(stack[-1], matrix_from_transform(attrs.get("transform", "")))
        boxes.append(shape_box(name, attrs, matrix, pixels_per_unit))

    if stroked and ROUND_PEN_DECLARATION not in image:
        raise SystemExit("a stroked frame must declare a round pen, or half-stroke growth"
                          " overstates what the miter joins actually paint")
    if not boxes:
        raise SystemExit("frame carries no measurable ink")
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )




def assert_frame_inside_clip_box(
    image: str, label: str, clip_half: float, allowance: float = CLIP_SLACK
) -> None:
    """A frame's ink has to stay inside the viewBox that clips it, to within the generator's
    own two-decimal coordinate rounding. This is the per-frame gate every sprite frame goes
    through, so the paint constraint rides here rather than beside it."""
    assert_paint(image, label)
    minimum_x, minimum_y, maximum_x, maximum_y = frame_ink_box(image, clip_half * 2.0)
    overrun = max(-clip_half - minimum_x, -clip_half - minimum_y,
                  maximum_x - clip_half, maximum_y - clip_half) - allowance
    if overrun > 0.0:
        raise SystemExit(f"{label}: ink leaves the {num(clip_half)} unit clip box "
                          f"by {num(round(overrun, 4))} units")


def assert_no_ground_shadow(unit_id: str, images: list[str]) -> None:
    """A baked ground shadow rotates with the sprite and lands as a dark wedge hanging off
    the wrong edge, which is the one defect a player sees immediately. The renderer injects
    nothing, so the generator has to refuse to write one."""
    for image in images:
        if GROUND_SHADOW_COLOR in image:
            raise SystemExit(f"{unit_id}: frame paints the ground shadow color "
                              f"{GROUND_SHADOW_COLOR}")


def first_field_fill(tile_image: str, label: str) -> str:
    """The first fill has to be the full-bleed field rect: the region backdrop
    tone and the progressive block preview both parse exactly that fill."""
    first_fill = re.search(r'fill="(#[0-9a-fA-F]{3,8})"', tile_image)
    if not first_fill:
        raise SystemExit(f"{label}: tile has no hex field fill")
    tag = tile_image[tile_image.rfind("<", 0, first_fill.start()):tile_image.find(">", first_fill.start())]
    if not tag.startswith("<rect") or 'width="36"' not in tag or 'height="36"' not in tag:
        raise SystemExit(f"{label}: first fill is not the full-bleed field rect")
    return first_fill.group(1)


def assert_tile_paint(tile_image: str, label: str) -> None:
    first_field_fill(tile_image, label)
    byte_length = len(tile_image.encode("utf-8"))
    if byte_length > TILE_BYTE_MAX:
        raise SystemExit(f"{label}: tile is {byte_length} bytes, over the {TILE_BYTE_MAX} byte budget")


NODE_PATTERN = re.compile(r'\{\s*"kind": "(\w+)",\s*"level": (\d+),\s*"x": (\d+),\s*"y": (\d+)\s*\}')
CONNECTION_PATTERN = re.compile(
    r'\{\s*"from": \{\s*"kind": "(\w+)",\s*"level": (\d+)\s*\},\s*'
    r'"to": \{\s*"kind": "(\w+)",\s*"level": (\d+)\s*\}\s*\}'
)


def collapse_layout_lines(text: str) -> str:
    def collapse_node(match: re.Match[str]) -> str:
        kind, level, x, y = match.groups()
        return f'{{ "kind": "{kind}", "level": {level}, "x": {x}, "y": {y} }}'

    def collapse_connection(match: re.Match[str]) -> str:
        from_kind, from_level, to_kind, to_level = match.groups()
        return (f'{{ "from": {{ "kind": "{from_kind}", "level": {from_level} }}, '
                f'"to": {{ "kind": "{to_kind}", "level": {to_level} }} }}')

    text = NODE_PATTERN.sub(collapse_node, text)
    return CONNECTION_PATTERN.sub(collapse_connection, text)


def write_theme(theme: dict) -> None:
    raw_text = theme_field_patch.load_theme_text(THEME_PATH, "the-aftermath", "Aftermath")
    for field_name in ("menuBackground", "towers", "enemies", "regions", "sites", "spawns"):
        value_text = theme_field_patch.render_value(theme[field_name])
        if field_name == "regions":
            value_text = collapse_layout_lines(value_text)
        raw_text = theme_field_patch.replace_top_level_value(raw_text, field_name, value_text)
    json.loads(raw_text)
    with open(THEME_PATH, "w", encoding="utf-8") as theme_file:
        theme_file.write(raw_text)


def sheet_svg(image: str, size: float) -> str:
    return image.replace("<svg ", f'<svg width="{num(size)}" height="{num(size)}" ', 1)


def strip_svg_wrapper(svg_text: str) -> str:
    open_tag = re.match(r"^<svg[^>]*>", svg_text)
    return svg_text[len(open_tag[0]):-len("</svg>")] if open_tag else svg_text


def tile_instance(tile_image: str, rotation: int, size: int, cell_x: int, cell_y: int) -> str:
    """One tile at one rotation, inlined rather than referenced through a
    <symbol> so the preview renders in headless browsers."""
    rotation_group = f'<g transform="rotate({rotation} 18 18)">' if rotation else ""
    return (f'<svg x="{cell_x}" y="{cell_y}" width="{size}" height="{size}" viewBox="0 0 36 36" '
            f'overflow="hidden">{rotation_group}{strip_svg_wrapper(tile_image)}{"</g>" if rotation else ""}</svg>')


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


def mosaic_kind(column: int, row: int, columns: int, rows: int) -> str:
    """A contiguous peak with a lane through it, so the mosaic shows the case
    that matters: one height stamped across a blob of cells."""
    center_x = (columns - 1) / 2
    center_y = (rows - 1) / 2
    distance = math.hypot(column - center_x, row - center_y) / math.hypot(center_x, center_y)
    height = 1 + min(3, int(round((1 - distance) * 3.2)))
    on_path_row = row in (rows // 2, rows // 2 + 1)
    on_path_column = abs(column - columns // 2) <= 1 and (row + column) % 3 != 0
    return "path" if on_path_row or on_path_column else f"terrain{height}"


def mosaic_svg(tiles: dict[str, list[str]], columns: int, rows: int, cell_size: int) -> str:
    """Stitches a synthetic map through the renderer's own variant and rotation
    hashes, so the sheet shows what a board actually looks like."""
    cells = []
    for row in range(rows):
        for column in range(columns):
            variants = tiles[mosaic_kind(column, row, columns, rows)]
            cells.append(tile_instance(
                variants[tile_variant_index(9137, column, row, len(variants))],
                tile_rotation(9137, column, row) * 90,
                cell_size, column * TILE_SIZE, row * TILE_SIZE,
            ))
    return (f'<svg width="{cell_size * columns}" height="{cell_size * rows}" '
            f'viewBox="0 0 {columns * TILE_SIZE} {rows * TILE_SIZE}" overflow="hidden">{"".join(cells)}</svg>')


def contact_sheet(theme: dict) -> str:
    parts = [
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/>",
        "<style>",
        "body{margin:0;background:#282828;color:#e8e0d4;font:14px/1.3 sans-serif;}",
        "h2{margin:16px 12px 4px;font-size:15px;}",
        ".row{display:flex;gap:8px;align-items:flex-end;padding:4px 12px;flex-wrap:wrap;}",
        ".cell{display:flex;flex-direction:column;align-items:center;gap:3px;}",
        ".cap{font-size:11px;color:#b8b0a4;}",
        ".seam{display:flex;background:#ff00ff;}",
        ".seam svg{display:block;}",
        ".mosaic{padding:4px 12px;}",
        ".mosaic svg{display:block;}",
        ".region-map{padding:4px 12px;}",
        ".region-map svg{display:block;width:1100px;height:700px;}",
        "</style></head><body>",
        "<h2>Towers at 27px and 81px, plus Bastion Wall at -45</h2>",
    ]
    for tower_id, name, _color, _icon, _fire, _walk in TOWER_META:
        frames = theme["towers"][tower_id]["animation"]["frames"]
        parts.append('<div class="row">')
        parts.append(f'<div class="cap" style="width:140px">{name}</div>')
        for frame_index, frame in enumerate(frames):
            parts.append('<div class="cell">')
            parts.append(sheet_svg(frame["image"], 27))
            parts.append(sheet_svg(frame["image"], 81))
            parts.append(f'<div class="cap">f{frame_index}</div></div>')
        if tower_id == "sturdyWall":
            turned = frames[0]["image"].replace(
                "<svg ", '<svg width="81" height="81" style="transform:rotate(-45deg)" ', 1
            )
            parts.append(f'<div class="cell">{turned}<div class="cap">rest -45</div></div>')
        parts.append("</div>")
    parts.append("<h2>Enemies, 54px. Walk, hit, attack. Boss also flipped.</h2>")
    for enemy_id, name, _color, _shape, _walk, _hit, _attack in ENEMY_META:
        enemy = theme["enemies"][enemy_id]
        for record_name in ("walking", "hitReaction", "attack"):
            parts.append('<div class="row">')
            parts.append(f'<div class="cap" style="width:140px">{name} {record_name}</div>')
            for frame in enemy[record_name]["frames"]:
                parts.append(sheet_svg(frame["image"], 54))
            if enemy_id == "boss" and record_name == "walking":
                flipped = enemy["walking"]["frames"][0]["image"].replace(
                    "<svg ", '<svg width="54" height="54" style="transform:scaleX(-1)" ', 1
                )
                parts.append(flipped)
            parts.append("</div>")
    parts.append("<h2>Tiles. Magenta shows a seam. Rotated copies per variant, then the height row.</h2>")
    for region in theme["regions"]:
        parts.append(f'<h2>{region["name"]}</h2>')
        for tile_name in TILE_KINDS:
            for variant_index, tile_image in enumerate(region["tiles"][tile_name]):
                parts.append(f'<div class="row"><div class="cap" style="width:140px">{tile_name} v{variant_index}</div>')
                parts.append('<div class="seam">')
                for turn in (0, 90, 180, 270):
                    turned = tile_image.replace(
                        "<svg ", f'<svg width="36" height="36" style="transform:rotate({turn}deg)" ', 1
                    )
                    parts.append(turned)
                parts.append("</div>")
                parts.append("</div>")
        parts.append('<div class="seam">')
        for tile_name in ("terrain1", "terrain2", "terrain3", "terrain4", "path"):
            parts.append(sheet_svg(region["tiles"][tile_name][0], 48))
        parts.append("</div>")
        parts.append('<div class="row">')
        parts.append(sheet_svg(region["base"], 160))
        parts.append("</div>")
        parts.append('<div class="mosaic">')
        parts.append(mosaic_svg(region["tiles"], 12, 8, 72))
        parts.append("</div>")
    parts.append("<h2>Spawns</h2><div class=\"row\">")
    for spawn_name in ("closed", "transition", "open"):
        cell = f'<div class="cell">{sheet_svg(theme["spawns"][spawn_name], 72)}<div class="cap">{spawn_name}</div></div>'
        parts.append(cell)
    parts.append("</div>")
    sites = theme["sites"]
    parts.append("<h2>Map site art at 26, 52, and 104px</h2>")
    for group, site_ids in (("buildings", BUILDING_KINDS), ("caches", CACHE_STATES)):
        parts.append(f"<h3>{group}</h3>")
        for site_id in site_ids:
            parts.append('<div class="row">')
            parts.append(f'<div class="cap" style="width:140px">{site_id}</div>')
            for size in (26, 52, 104):
                parts.append(sheet_svg(sites[group][site_id], size))
            parts.append("</div>")
    parts.append('<div class="row"><div class="cap" style="width:140px">supplyDrop</div>')
    for size in (26, 52, 104):
        parts.append(sheet_svg(sites["supplyDrop"], size))
    parts.append("</div>")
    parts.append("<h2>Region maps with node overlay</h2>")
    for region in theme["regions"]:
        overlay = region_map_art.map_overlay_elements(region["mapLayout"])
        parts.append(f'<div class="region-map">{region["mapImage"].replace("</svg>", overlay + "</svg>")}</div>')
    parts.append("<h2>Menu background</h2>")
    parts.append(f'<div class="region-map">{theme["menuBackground"]}</div>')
    parts.append("</body></html>")
    os.makedirs(os.path.dirname(SHEET_PATH), exist_ok=True)
    html = "".join(parts)
    with open(SHEET_PATH, "w", encoding="utf-8") as sheet_file:
        sheet_file.write(html)
    return SHEET_PATH


def main() -> None:
    theme = build_theme()
    validate_theme(theme)
    write_theme(theme)
    sheet_path = contact_sheet(theme)
    print(f"wrote {THEME_PATH}")
    print(f"wrote {sheet_path}")


if __name__ == "__main__":
    main()
