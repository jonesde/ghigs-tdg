#!/usr/bin/env python3
"""Draw the Aftermath map theme and overwrite data/the-aftermath.json.

Flat three-tone paint, no gradients and no url() references. Tower symbols are
clipped to viewBox -16 -16 32 32, enemies to -1 -1 2 2, tiles and spawns to
0 0 36 36. Base art is inserted with the outer svg stripped, so its coordinates
are game pixels across the 108px (3x36) camp footprint.
"""

from __future__ import annotations

import json
import math
import os
from typing import Callable

SCRIPT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
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


def contact_shadow(radius_x: float, radius_y: float, center_y: float, space: str) -> str:
    opacity = 0.38 if space == "tower" else 0.4
    return ellipse(0, center_y, radius_x, radius_y, "#120e0c", opacity=opacity)


def muzzle_flash(origin_x: float, origin_y: float) -> str:
    outer = polygon(
        [
            (origin_x, origin_y - 2.4),
            (origin_x + 3.6, origin_y - 3.3),
            (origin_x + 2.1, origin_y - 0.7),
            (origin_x + 4.2, origin_y),
            (origin_x + 2.1, origin_y + 0.7),
            (origin_x + 3.6, origin_y + 3.3),
            (origin_x, origin_y + 2.4),
            (origin_x + 1.1, origin_y),
        ],
        "#ff9a1f",
    )
    inner = polygon(
        [
            (origin_x + 0.4, origin_y - 1.2),
            (origin_x + 2.4, origin_y - 1.5),
            (origin_x + 2.8, origin_y),
            (origin_x + 2.4, origin_y + 1.5),
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
    return tower_svg(contact_shadow(10.5, 3.4, 7.2, "tower") + body + effect)


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
    return tower_svg(contact_shadow(10.2, 3.3, 7.4, "tower") + body + vapor)


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
        effect = rect(12.2, -0.55, 2.4, 1.1, 0.3, "#fff6e4") + muzzle_flash(12.4, 0)
    elif pose == "smoke":
        body = longshot_body(-0.4)
        effect = circle(13.4, 0, 1.15, "none", "#c8c8c8", 0.55, 0.7)
    else:
        body = longshot_body(0.4)
        effect = ""
    return tower_svg(contact_shadow(9.5, 3.1, 8.2, "tower") + body + effect)


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
    return tower_svg(contact_shadow(11, 3.6, 8.0, "tower") + body + scrap)


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
    return tower_svg(contact_shadow(8.4, 3.0, 7.6, "tower") + foil_hat(lightning_arcs(strength)))


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
    return tower_svg(contact_shadow(12, 3.2, 7.8, "tower") + art)


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
    return tower_svg(contact_shadow(10.5, 3.6, 9.2, "tower") + "".join(bags) + sign + sign_face + tire + dust)


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
    return tower_svg(contact_shadow(11.2, 3.5, 8.6, "tower") + body + effect)


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


def enemy_frame(pose: Pose, body: str) -> str:
    moved = svg_group(body, f"translate({num(pose.shift_x)} {num(pose.bob)})")
    flash = ""
    if pose.action == "hit" and pose.action_phase == 0:
        flash = circle(pose.shift_x + 0.08, pose.bob, 0.09, "#fff", opacity=0.7)
    shadow = ellipse(0, 0.18, 0.46, 0.12, "#120e0c", opacity=0.4)
    return enemy_svg(shadow + moved + flash)


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
    tip_x = root_x + 0.36 + reach * 0.16
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
    head_shift = max(reach, 0) * 0.08
    head = svg_group(rex_head(reach), f"translate({num(head_shift)} 0)")
    return tail + tail_light + duster + thigh_upper + thigh_lower + foot_upper + foot_lower + body + arm + gun + head


def rex_head(reach: float) -> str:
    jaw = max(reach, 0) * 0.06
    skull = volume_ellipse(0.34, -0.02, 0.28, 0.2, "#d07020", "#8a3c0c", "#f2b070", INK, 0.045, "enemy")
    upper = polygon(
        [(0.46, -0.1), (0.74 + jaw, -0.22), (0.82 + jaw, -0.06), (0.5, 0.0)],
        "#e07828",
        "#6a3010",
        0.035,
    )
    lower = polygon(
        [(0.46, 0.06), (0.7 + jaw, 0.2), (0.66 + jaw, 0.28), (0.44, 0.12)],
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


ENEMY_DRAW: dict[str, Callable[[Pose], str]] = {
    "minion": bad_bug,
    "runner": mantis,
    "tank": yow_guy,
    "shielded": shell_shocked,
    "healer": mole_mender,
    "boss": death_draw,
}

ENEMY_META = [
    ("minion", "Bad Bug", "#88aa44", "●", 0.8, 0.3, 0.2),
    ("runner", "Manic Mantis", "#44aa44", "◆", 0.6, 0.3, 0.2),
    ("tank", "Yow Guy", "#886644", "■", 1.0, 0.3, 0.2),
    ("shielded", "Shell Shocked", "#99aabb", "◇", 0.7, 0.3, 0.2),
    ("healer", "Mole Mender", "#bb77aa", "▲", 0.9, 0.3, 0.2),
    ("boss", "Death Draw", "#cc6600", "★", 1.2, 0.4, 0.2),
]


def build_enemy_animations(draw: Callable[[Pose], str]) -> dict[str, dict]:
    walking = []
    for phase in range(8):
        pose = Pose(phase, WALK_BOB[phase], "walk", 0)
        walking.append(enemy_frame(pose, draw(pose)))
    hit = []
    for action_phase in range(3):
        pose = Pose(0, 0.0, "hit", action_phase)
        hit.append(enemy_frame(pose, draw(pose)))
    attack = []
    for action_phase in range(3):
        pose = Pose(0, 0.0, "attack", action_phase)
        attack.append(enemy_frame(pose, draw(pose)))
    return {"walking": walking, "hit": hit, "attack": attack}


# --- ground -----------------------------------------------------------------


def ground_tile(fill: str, motifs: str) -> str:
    return tile_svg(rect(0, 0, 36, 36, 0, fill) + motifs)


def pebble(center_x: float, center_y: float, radius: float, fill: str, opacity: float = 0.85) -> str:
    return circle(center_x, center_y, radius, fill, opacity=opacity)


def rustbloom_tiles() -> dict[str, str]:
    path_motifs = (
        path_shape("M8 14 L14 18 L12 24", "none", "#4a3c34", 0.8)
        + path_shape("M22 10 L27 16", "none", "#4a3c34", 0.7)
        + pebble(16, 11, 1.3, "#c4a484", 0.7)
        + pebble(24, 26, 1.0, "#8a5a32", 0.8)
    )
    terrain1 = (
        pebble(10, 12, 1.4, "#a68464")
        + pebble(24, 22, 1.1, "#b89878")
        + pebble(16, 27, 0.9, "#8a6848", 0.7)
    )
    terrain2 = (
        pebble(9, 10, 1.6, "#7a5840")
        + pebble(22, 16, 1.3, "#6a4834")
        + path_shape("M12 22 L18 26 L16 30", "none", "#4a3020", 0.8)
        + pebble(27, 27, 1.5, "#8a5a38")
    )
    terrain3 = (
        circle(14, 16, 3.2, "#b87333", opacity=0.55)
        + circle(16.5, 18, 1.6, "#8a4a22", opacity=0.8)
        + pebble(26, 10, 1.5, "#5a3824")
        + path_shape("M8 24 L14 28", "none", "#3a2418", 0.9)
    )
    terrain4 = (
        circle(12, 14, 4.2, "#a86428", opacity=0.7)
        + circle(18, 20, 2.4, "#6a3818")
        + circle(26, 24, 2.8, "#8a4c20", opacity=0.65)
        + pebble(8, 26, 1.4, "#3a2418")
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
        path_shape("M10 20 L16 14 L22 22", "none", "#5a4c3c", 0.8)
        + pebble(26, 12, 1.2, "#d8c8a0", 0.65)
        + pebble(12, 28, 1.0, "#8a7a58", 0.6)
    )
    terrain1 = (
        pebble(12, 14, 1.5, "#c4b08a", 0.7)
        + pebble(24, 24, 1.2, "#b8a480", 0.65)
        + pebble(18, 8, 0.8, "#a89878", 0.5)
    )
    terrain2 = (
        pebble(10, 18, 1.7, "#a08860")
        + path_shape("M20 10 L26 16 L22 22", "none", "#8a7048", 0.7)
        + pebble(15, 28, 1.3, "#c2a878", 0.7)
    )
    terrain3 = (
        polygon([(10, 12), (16, 10), (18, 16), (12, 18)], "#dfe8c8", "#6a7848", 0.5, 0.55)
        + polygon([(22, 20), (28, 18), (27, 26), (21, 25)], "#e8f0d4", "#5a6840", 0.45, 0.4)
        + circle(16, 24, 1.15, "#7CFF6B", opacity=0.55)
    )
    terrain4 = (
        polygon([(8, 10), (15, 8), (17, 15), (9, 16)], "#e4f0c0", "#3a4828", 0.55, 0.5)
        + polygon([(20, 18), (29, 16), (28, 26), (18, 24)], "#d8e8b0", "#2e3c22", 0.5, 0.45)
        + circle(14, 26, 1.4, "#7CFF6B", opacity=0.6)
        + circle(25, 11, 1.0, "#b8ff9a", opacity=0.45)
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
        path_shape("M9 12 L15 18 L11 26", "none", "#4a4a4a", 0.8)
        + pebble(24, 14, 1.2, "#9a9690", 0.45)
        + pebble(20, 27, 1.0, "#6a6660", 0.5)
    )
    terrain1 = (
        pebble(11, 15, 1.6, "#a8a39c", 0.7)
        + pebble(24, 22, 1.2, "#b4afa8", 0.55)
        + pebble(16, 28, 0.9, "#8e8982", 0.5)
    )
    terrain2 = (
        pebble(10, 12, 1.8, "#7a756e")
        + path_shape("M18 20 L24 26", "none", "#5a564e", 0.8)
        + pebble(28, 10, 1.1, "#6a6660")
    )
    terrain3 = (
        ellipse(12, 22, 4.2, 2.2, "#2e2e2e", opacity=0.55)
        + ellipse(24, 12, 3.4, 1.8, "#242424", opacity=0.45)
        + path_shape("M9 27 C13 22 15 18 14 13", "none", "#2a2a2a", 1.15)
        + pebble(27, 26, 1.3, "#3a3a3a")
    )
    terrain4 = (
        path_shape("M8 29 C12 20 11 14 9 8", "none", "#121212", 1.7)
        + path_shape("M11 17 C16 13 19 16 26 11", "none", "#121212", 1.2)
        + circle(25, 24, 3.1, "#141414", opacity=0.8)
        + ellipse(14, 12, 3.6, 1.6, "#1c1c1c", opacity=0.55)
    )
    return {
        "path": ground_tile("#222222", path_motifs),
        "terrain1": ground_tile("#d2cdc6", terrain1),
        "terrain2": ground_tile("#a8a39c", terrain2),
        "terrain3": ground_tile("#6e6a64", terrain3),
        "terrain4": ground_tile("#3e3e3e", terrain4),
    }


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
        animations = build_enemy_animations(ENEMY_DRAW[enemy_id])
        enemies[enemy_id] = {
            "name": name,
            "color": color,
            "shape": shape,
            "walking": animation_record(walk_duration, animations["walking"]),
            "hitReaction": animation_record(hit_duration, animations["hit"]),
            "attack": animation_record(attack_duration, animations["attack"]),
        }
    regions = [
        {"id": 0, "name": "Rustbloom Wastes", "tiles": rustbloom_tiles(), "base": rustbloom_base()},
        {"id": 1, "name": "Sand and Regret", "tiles": sand_tiles(), "base": sand_base()},
        {"id": 2, "name": "Ashen Highs", "tiles": ash_tiles(), "base": ash_base()},
    ]
    return {
        "id": "the-aftermath",
        "label": "Aftermath",
        "towers": towers,
        "enemies": enemies,
        "regions": regions,
        "spawns": spawn_art(),
    }


def validate_theme(theme: dict) -> None:
    if theme["id"] != "the-aftermath" or theme["label"] != "Aftermath":
        raise SystemExit("theme id/label drifted")
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
        for frame in frames:
            assert_paint(frame["image"], tower_id)
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
        for record in (enemy["walking"], enemy["hitReaction"], enemy["attack"]):
            for frame in record["frames"]:
                assert_paint(frame["image"], enemy_id)
    if [region["name"] for region in theme["regions"]] != ["Rustbloom Wastes", "Sand and Regret", "Ashen Highs"]:
        raise SystemExit("region names drifted")
    for region in theme["regions"]:
        for tile_name, tile_image in region["tiles"].items():
            assert_paint(tile_image, f"{region['name']} {tile_name}")
        assert_paint(region["base"], region["name"])
    for spawn_name, spawn_image in theme["spawns"].items():
        assert_paint(spawn_image, spawn_name)


def assert_paint(image: str, label: str) -> None:
    if not image.startswith("<svg ") or "url(#" in image or "<filter" in image:
        raise SystemExit(f"paint constraint failed for {label}")


def write_theme(theme: dict) -> None:
    with open(THEME_PATH, "w", encoding="utf-8") as theme_file:
        json.dump(theme, theme_file, indent=2, ensure_ascii=False)
        theme_file.write("\n")


def sheet_svg(image: str, size: float) -> str:
    return image.replace("<svg ", f'<svg width="{num(size)}" height="{num(size)}" ', 1)


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
    parts.append("<h2>Tiles. Magenta shows a seam. Rotated copies of terrain2, then the height row.</h2>")
    for region in theme["regions"]:
        parts.append(f'<h2>{region["name"]}</h2>')
        parts.append('<div class="seam">')
        for turn in (0, 90, 180, 270):
            turned = region["tiles"]["terrain2"].replace(
                "<svg ", f'<svg width="36" height="36" style="transform:rotate({turn}deg)" ', 1
            )
            parts.append(turned)
        parts.append("</div>")
        parts.append('<div class="seam">')
        for tile_name in ("terrain1", "terrain2", "terrain3", "terrain4", "path"):
            parts.append(sheet_svg(region["tiles"][tile_name], 48))
        parts.append("</div>")
        parts.append('<div class="row">')
        parts.append(sheet_svg(region["base"], 160))
        parts.append("</div>")
    parts.append("<h2>Spawns</h2><div class=\"row\">")
    for spawn_name in ("closed", "transition", "open"):
        cell = f'<div class="cell">{sheet_svg(theme["spawns"][spawn_name], 72)}<div class="cap">{spawn_name}</div></div>'
        parts.append(cell)
    parts.append("</div></body></html>")
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
