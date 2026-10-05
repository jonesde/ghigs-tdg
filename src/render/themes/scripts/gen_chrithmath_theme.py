#!/usr/bin/env python3
"""Draw the Chrithmath map theme and overwrite data/chrithmath.json.

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
from typing import Callable

SCRIPT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIRECTORY)
import menu_background_art  # noqa: E402
import region_map_art  # noqa: E402

THEME_PATH = os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "chrithmath.json"))
SIDECAR_PATH = os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "chrithmath-menu.json"))
SHEET_PATH = os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "..", "..", "..", "tmp", "chrithmath-contact.html"))

INK = "#241a12"
GINGERBREAD = "#c8804a"
GINGERBREAD_DARK = "#8a5428"
GINGERBREAD_LIGHT = "#e2a86a"
ICING = "#f2ede4"
CANE_RED = "#d04848"
CANE_WHITE = "#f0ece6"
MARZIPAN = "#d8c8a8"
MARZIPAN_DARK = "#a89070"
MARZIPAN_LIGHT = "#efe2c8"
ROCK_CANDY = "#e8e2ea"
COTTON_CANDY = "#f0c0d0"
COTTON_CANDY_DEEP = "#d898b4"
STOLLEN = "#a08050"
STOLLEN_DARK = "#6e5434"
JIMMY_RED = "#d04848"
JIMMY_BLUE = "#5c88c8"
JIMMY_GREEN = "#68a868"
JIMMY_GOLD = "#e0b040"
TOY_WOOD = "#b08850"
TOY_WOOD_DARK = "#7a5c34"
TOY_WOOD_LIGHT = "#d0a870"
TIN_BODY = "#9fb4c4"
TIN_DARK = "#5c7080"
TIN_LIGHT = "#c8d8e4"
TOY_RED = "#c84040"
TOY_RED_DARK = "#902828"
TOY_GOLD = "#e0b040"
SNOW_SHADE = "#c8d6e2"
SAND_SHADE = "#bd9a6b"


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


def menu_root(content: str) -> str:
    return f'<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">{content}</svg>'


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
    dash: str | None = None,
) -> str:
    return svg_element(
        "path",
        {
            "d": path_data,
            "fill": fill,
            "stroke": stroke,
            "stroke-width": None if stroke_width is None else num(stroke_width),
            "opacity": None if opacity is None else num(opacity),
            "stroke-dasharray": dash,
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
    dash: str | None = None,
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
            "stroke-dasharray": dash,
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


def star_points(
    center_x: float, center_y: float, outer_radius: float, inner_radius: float, point_count: int = 5
) -> list[tuple[float, float]]:
    points = []
    for index in range(point_count * 2):
        angle = math.radians(-90 + index * (180 / point_count))
        radius = outer_radius if index % 2 == 0 else inner_radius
        points.append((center_x + math.cos(angle) * radius, center_y + math.sin(angle) * radius))
    return points


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
        COTTON_CANDY,
    )
    inner = polygon(
        [
            (origin_x + 0.4, origin_y - 1.2),
            (origin_x + 2.4, origin_y - 1.5),
            (origin_x + 2.8, origin_y),
            (origin_x + 2.4, origin_y + 1.5),
            (origin_x + 0.4, origin_y + 1.2),
        ],
        ICING,
    )
    return outer + inner


def smoke_puff(origin_x: float, origin_y: float) -> str:
    return (
        circle(origin_x, origin_y - 1.1, 1.7, "#d8d4cc", opacity=0.5)
        + circle(origin_x + 1.6, origin_y + 1.0, 1.15, "#ece8e0", opacity=0.4)
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


def gingerbread_barrage(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -1.6, "smoke": -0.45}[pose]
    body = (
        ellipse(0, 2.6, 5.4, 5.0, GINGERBREAD, INK, 0.9)
        + circle(0, -4.2, 3.5, GINGERBREAD, INK, 0.9)
        + circle(-1.2, -4.9, 0.55, ICING)
        + circle(1.2, -4.9, 0.55, ICING)
        + circle(0, -3.4, 0.55, ICING)
        + path_shape("M-4.8 0.6 L-8.2 3.4", "none", GINGERBREAD_DARK, 2.2)
        + path_shape("M-2.6 6.9 L-4.8 10.6", "none", GINGERBREAD_DARK, 2.4)
        + path_shape("M2.6 6.9 L4.8 10.6", "none", GINGERBREAD_DARK, 2.4)
        + path_shape("M4.4 2.2 L12.8 0.6", "none", GINGERBREAD, 2.8)
        + path_shape("M4.2 1.2 L12.6 -0.2", "none", ICING, 1.0)
    )
    effect = ""
    if pose == "discharge":
        effect = circle(14.2, 0, 1.5, GINGERBREAD, INK, 0.6) + muzzle_flash(12.6, 0.2)
    elif pose == "smoke":
        effect = smoke_puff(13.4, -0.6)
    return tower_svg(contact_shadow(9.5, 3.2, 8.4, "tower") + svg_group(body, f"translate({num(shift)} 0)") + effect)


def candy_cane_coil(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -1.2, "smoke": -0.35}[pose]
    cane_curve = "M-9 3 L9.5 3 A4.6 4.6 0 1 1 9.5 -7.2"
    body = (
        rect(-10.4, 6.4, 20.4, 4.6, 1.1, GINGERBREAD, INK, 0.9)
        + path_shape("M-10.4 7 L9.6 7", "none", ICING, 1.1, 0.85, "5 4")
        + path_shape(cane_curve, "none", CANE_RED, 3.4)
        + path_shape(cane_curve, "none", CANE_WHITE, 3.4, 0.9, "3.4 6.8")
        + circle(9.5, -7.2, 1.7, CANE_RED, INK, 0.55)
    )
    effect = ""
    if pose == "discharge":
        effect = circle(13.4, -8.2, 1.4, CANE_WHITE, INK, 0.5) + muzzle_flash(11.6, -7.4)
    elif pose == "smoke":
        effect = smoke_puff(12.4, -8.4)
    return tower_svg(contact_shadow(9.8, 3.3, 10.4, "tower") + svg_group(body, f"translate({num(shift)} 0)") + effect)


def nutcracker(pose: str) -> str:
    jaw_drop = {"rest": 0.0, "discharge": 1.6, "smoke": 0.6}[pose]
    hat = polygon([(0, -12.6), (-3.6, -6.4), (3.6, -6.4)], TOY_RED, INK, 0.85)
    hat_band = rect(-3.2, -7.4, 6.4, 1.5, 0.4, TOY_GOLD, INK, 0.55)
    head = rect(-3.4, -6.4, 6.8, 6.6, 1.0, "#e8c8a0", INK, 0.9)
    eyes = circle(-1.4, -4.6, 0.55, INK) + circle(1.4, -4.6, 0.55, INK)
    jaw = rect(-3.8, -0.4 + jaw_drop, 7.6, 2.3, 0.6, GINGERBREAD_DARK, INK, 0.7)
    body = rect(-5.4, 2.2 + jaw_drop * 0.4, 10.8, 8.4, 1.2, TOY_RED, INK, 0.9)
    belt = rect(-5.4, 5.6 + jaw_drop * 0.4, 10.8, 1.7, 0.3, TOY_GOLD)
    barrel = rect(4.8, 4.6, 8.6, 2.3, 0.5, TIN_BODY, INK, 0.7)
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(12.8, 5.7)
    elif pose == "smoke":
        effect = smoke_puff(13.6, 4.8)
    return tower_svg(contact_shadow(8.8, 3.2, 11.0, "tower") + hat + hat_band + head + eyes + jaw + body + belt + barrel + effect)


def marzipan_mortar(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -1.8, "smoke": -0.6}[pose]
    body = (
        rect(-8.6, 3.4, 11.2, 7.4, 1.3, TOY_WOOD_DARK, INK, 0.9)
        + rect(-8.6, 3.4, 11.2, 1.8, None, TOY_WOOD, opacity=0.6)
        + circle(1.6, 1.6, 7.0, MARZIPAN_DARK)
        + circle(0.4, 0.4, 7.0, MARZIPAN, INK, 0.9)
        + ellipse(-1.8, -1.9, 2.7, 1.9, MARZIPAN_LIGHT, opacity=0.85)
        + circle(4.4, 1.4, 2.1, "#8a7454", INK, 0.6)
    )
    effect = ""
    if pose == "discharge":
        effect = circle(9.4, -5.4, 2.0, MARZIPAN, INK, 0.6) + muzzle_flash(8.6, -2.6)
    elif pose == "smoke":
        effect = smoke_puff(10.2, -4.2)
    return tower_svg(contact_shadow(10.6, 3.6, 10.4, "tower") + svg_group(body, f"translate({num(shift)} 0)") + effect)


def cotton_candy_cloud(pose: str) -> str:
    cloud = (
        rect(-1.2, 1.6, 2.4, 9.4, 0.5, TIN_DARK, INK, 0.6)
        + circle(-3.2, -2.4, 4.4, COTTON_CANDY, INK, 0.7)
        + circle(2.8, -3.6, 5.0, COTTON_CANDY, INK, 0.7)
        + circle(0.6, 0.6, 4.2, COTTON_CANDY_DEEP, INK, 0.55)
    )
    if pose == "discharge":
        zap = (
            path_shape("M5.4 -3.4 L10.2 -4.4 L8.6 -1.4 L13.6 -2.4", "none", "#fff6b0", 1.4)
            + path_shape("M5.8 -2.6 L11.4 -3.6 L9.6 -0.8 L13.4 -1.6", "none", COTTON_CANDY_DEEP, 0.9)
        )
    elif pose == "smoke":
        zap = path_shape("M5.6 -3.0 L10.6 -3.8 L9.0 -1.0", "none", COTTON_CANDY_DEEP, 0.7, 0.55)
    else:
        zap = path_shape("M5.2 -2.8 L9.8 -3.4 L8.4 -0.8", "none", COTTON_CANDY_DEEP, 0.85)
    return tower_svg(contact_shadow(8.6, 3.0, 11.2, "tower") + cloud + zap)


def peppermint_railgun(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -1.4, "smoke": -0.4}[pose]
    body = (
        rect(-12.4, -4.2, 9.6, 10.4, 1.3, CANE_WHITE, INK, 0.9)
        + rect(-12.4, -4.2, 9.6, 2.2, 0.5, CANE_RED)
        + rect(-12.4, 1.6, 9.6, 2.2, 0.5, CANE_RED)
        + rect(-3.2, -1.5, 15.8, 3.0, 0.5, CANE_WHITE, INK, 0.7)
        + path_shape("M-2.6 0 L11.8 0", "none", CANE_RED, 3.0, 0.9, "2.8 3.6")
    )
    if pose == "discharge":
        lance = polygon([(10.8, -1.7), (15.4, 0), (10.8, 1.7)], CANE_WHITE, INK, 0.5)
    else:
        lance = ""
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(13.6, 0)
    elif pose == "smoke":
        effect = smoke_puff(14.4, -0.8)
    return tower_svg(contact_shadow(11.6, 3.3, 8.2, "tower") + svg_group(body, f"translate({num(shift)} 0)") + lance + effect)


def stollen_bastion(pose: str) -> str:
    nudge = 0.85 if pose == "discharge" else (0.35 if pose == "smoke" else 0.0)
    bread = rect(-11.4, -4.4, 22.8, 9.8, 4.6, STOLLEN, INK, 0.95)
    bread_light = rect(-9.6, -3.2, 19.2, 2.2, 1.0, "#c09a68", opacity=0.55)
    icing = path_shape(
        f"M-9.6 -4.4 L-7.2 {-2.6 - nudge} L-4.8 -4.4 L-2.4 {-2.6 - nudge} L0 -4.4 "
        f"L2.4 {-2.6 - nudge} L4.8 -4.4 L7.2 {-2.6 - nudge} L9.6 -4.4",
        "none", ICING, 1.6,
    )
    sugar = (
        circle(-6.4, 0.8, 0.5, ICING, opacity=0.8)
        + circle(-1.8, 2.4, 0.5, ICING, opacity=0.7)
        + circle(3.2, 0.4, 0.5, ICING, opacity=0.8)
        + circle(7.4, 2.0, 0.5, ICING, opacity=0.7)
    )
    dust = ""
    if pose == "discharge":
        dust = ellipse(7.4, 6.4, 2.4, 1.1, "#c4b09a", opacity=0.45) + ellipse(-8.0, 4.8, 1.9, 0.9, "#c4b09a", opacity=0.35)
    elif pose == "smoke":
        dust = ellipse(6.2, 7.2, 1.7, 0.8, "#c4b09a", opacity=0.25)
    return tower_svg(contact_shadow(10.8, 3.6, 9.4, "tower") + bread + bread_light + icing + sugar + dust)


def jimmie_blaster(pose: str) -> str:
    shift = {"rest": 0.0, "discharge": -1.8, "smoke": -0.55}[pose]
    body = (
        rect(-11.8, -6.2, 17.4, 12.8, 1.6, TOY_WOOD, INK, 0.9)
        + rect(-11.8, -6.2, 17.4, 2.2, 1.0, TOY_WOOD_LIGHT, opacity=0.6)
        + circle(-5.8, 1.6, 2.6, TOY_RED, INK, 0.6)
        + circle(-1.2, 1.6, 2.6, JIMMY_GOLD, INK, 0.6)
        + circle(3.4, 1.6, 2.6, JIMMY_GREEN, INK, 0.6)
        + rect(5.6, -3.6, 3.2, 7.2, 0.6, INK, opacity=0.85)
        + rect(8.4, -2.2, 4.4, 4.4, 0.5, TIN_BODY, INK, 0.7)
    )
    shower = ""
    if pose == "discharge":
        shower = (
            rect(13.4, -3.4, 2.0, 0.9, 0.3, JIMMY_RED)
            + rect(14.2, -1.4, 2.0, 0.9, 0.3, JIMMY_BLUE)
            + rect(13.8, 0.6, 2.0, 0.9, 0.3, JIMMY_GREEN)
            + rect(14.6, 2.4, 2.0, 0.9, 0.3, JIMMY_GOLD)
            + muzzle_flash(12.6, 0)
        )
    elif pose == "smoke":
        shower = smoke_puff(13.6, -0.8) + circle(14.4, 1.4, 1.2, "#b7b1a8", opacity=0.35)
    return tower_svg(contact_shadow(11.0, 3.5, 8.8, "tower") + svg_group(body, f"translate({num(shift)} 0)") + shower)


TOWER_DRAW: dict[str, Callable[[str], str]] = {
    "basic": gingerbread_barrage,
    "ice": candy_cane_coil,
    "sniper": nutcracker,
    "cannon": marzipan_mortar,
    "lightning": cotton_candy_cloud,
    "railgun": peppermint_railgun,
    "sturdyWall": stollen_bastion,
    "shotgunTank": jimmie_blaster,
}

TOWER_META = [
    ("basic", "Gingerbread Barrage", "#c8804a", "▪", 0.3, 0.6),
    ("ice", "Candy Cane Coil", "#e87a7a", "◆", 0.4, 0.7),
    ("sniper", "The Nutcracker", "#b0a08c", "◎", 0.35, 0.65),
    ("cannon", "Marzipan Mortar", "#d8c8a8", "◉", 0.5, 0.8),
    ("lightning", "Cotton Candy Cloud", "#f0c0d0", "⚡", 0.25, 0.55),
    ("railgun", "Peppermint Railgun", "#e8e8f0", "▲", 0.45, 0.75),
    ("sturdyWall", "Stollen Bastion", "#a08050", "◧", 0.3, 0.6),
    ("shotgunTank", "Jimmie Blaster", "#e0a040", "◳", 0.3, 0.6),
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


def enemy_frame(pose: Pose, body: str, airborne: bool = False) -> str:
    # A flyer sits above a small shadow so the same frame reads as off the ground.
    lift = -0.12 if airborne else 0.0
    moved = svg_group(body, f"translate({num(pose.shift_x)} {num(pose.bob + lift)})")
    flash = ""
    if pose.action == "hit" and pose.action_phase == 0:
        flash = circle(pose.shift_x + 0.08, pose.bob + lift, 0.09, "#fff", opacity=0.7)
    if airborne:
        shadow = ellipse(0, 0.55, 0.22, 0.05, "#120e0c", opacity=0.28)
    else:
        shadow = ellipse(0, 0.18, 0.46, 0.12, "#120e0c", opacity=0.4)
    return enemy_svg(shadow + moved + flash)


def squashed(radius_x: float, radius_y: float, squash: float) -> tuple[float, float]:
    return radius_x * (1 + squash * 0.14), radius_y * (1 - squash * 0.28)


def walk_legs(pose: Pose, hip_front: float, hip_back: float) -> str:
    legs = []
    for leg_index, (hip_x, side) in enumerate(((hip_front, 1), (hip_back, -1))):
        swing = pose.gait(leg_index)
        knee_x = hip_x - 0.05 + swing
        foot_x = hip_x - 0.02 + swing * 1.3
        legs.append(
            path_shape(
                f"M{num(hip_x)} {num(side * 0.1)} L{num(knee_x)} {num(side * 0.26)} L{num(foot_x)} {num(side * 0.5)}",
                "none",
                INK,
                0.09,
            )
        )
    return "".join(legs)


def reach_arm(pose: Pose, shoulder_x: float, length: float) -> str:
    if pose.action != "attack":
        return ""
    arm_x = shoulder_x + 0.1 + pose.reach * length
    return path_shape(f"M{num(shoulder_x)} {num(-0.06)} L{num(arm_x)} {num(-0.02)}", "none", INK, 0.08)


def tin_soldier(pose: Pose) -> str:
    radius_x, radius_y = squashed(0.27, 0.2, pose.squash)
    body = (
        walk_legs(pose, 0.1, -0.12)
        + ellipse(0, 0, radius_x, radius_y, TIN_BODY, INK, 0.09)
        + rect(-0.14, -0.09, 0.22, 0.18, 0.03, TIN_LIGHT, INK, 0.06)
        + circle(0.22, -0.16, 0.13, TIN_LIGHT, INK, 0.09)
        + rect(0.12, -0.34, 0.2, 0.12, 0.02, TOY_RED, INK, 0.05)
    )
    return body + reach_arm(pose, 0.18, 0.9)


def all_aboard(pose: Pose) -> str:
    body = (
        ellipse(0, 0, 0.4, 0.2, TOY_RED, INK, 0.09)
        + rect(-0.36, -0.14, 0.3, 0.16, 0.03, TOY_RED_DARK, INK, 0.05)
        + circle(-0.22, -0.24, 0.07, TIN_DARK, INK, 0.05)
        + polygon([(0.34, -0.12), (0.54, 0.02), (0.34, 0.12)], TIN_DARK, INK, 0.05)
        + circle(-0.2, 0.22, 0.1, "#241c16", INK, 0.07)
        + circle(0.18, 0.22, 0.1, "#241c16", INK, 0.07)
    )
    if pose.action == "attack":
        body += circle(0.52, -0.32, 0.05, "#c2bbb2", opacity=0.6)
    return body


def grizzly_ted(pose: Pose) -> str:
    radius_x, radius_y = squashed(0.36, 0.28, pose.squash)
    body = (
        walk_legs(pose, 0.1, -0.12)
        + ellipse(0, 0, radius_x, radius_y, TOY_WOOD, INK, 0.1)
        + circle(-0.1, -0.3, 0.1, TOY_WOOD, INK, 0.08)
        + circle(0.12, -0.3, 0.1, TOY_WOOD, INK, 0.08)
        + ellipse(0.28, -0.08, 0.12, 0.09, TOY_WOOD_LIGHT, INK, 0.07)
        + circle(0.31, -0.11, 0.035, INK)
        + circle(0.08, -0.18, 0.035, INK)
    )
    return body + reach_arm(pose, 0.26, 1.1)


def marbles_the_man(pose: Pose) -> str:
    radius_x, radius_y = squashed(0.3, 0.26, pose.squash)
    return (
        ellipse(0, 0, radius_x, radius_y, "#8fd0e8", INK, 0.08)
        + path_shape("M-0.16 -0.06 C-0.02 -0.2, 0.14 -0.02, 0.18 -0.14", "none", "#5c98b0", 0.05)
        + path_shape("M-0.1 0.08 C0.02 -0.02, 0.1 0.06, 0.14 -0.04", "none", "#a8dce8", 0.04)
        + circle(-0.11, -0.11, 0.07, "#d8f0f8", opacity=0.8)
    )


def music_box_mender(pose: Pose) -> str:
    body = (
        walk_legs(pose, 0.08, -0.1)
        + rect(-0.28, -0.26, 0.5, 0.42, 0.04, TOY_WOOD, INK, 0.09)
        + rect(-0.28, -0.26, 0.5, 0.1, 0.03, TOY_WOOD_LIGHT, opacity=0.8)
        + circle(0, -0.02, 0.1, TOY_RED, INK, 0.06)
        + circle(-0.17, -0.02, 0.035, INK)
        + circle(0.17, -0.02, 0.035, INK)
    )
    if pose.action == "attack":
        body += circle(0.36 + pose.reach * 0.3, -0.34, 0.045, "#e8a0c0", INK, 0.05)
    else:
        body += circle(0.3, -0.36, 0.04, COTTON_CANDY_DEEP, INK, 0.05)
    return body


def jack_in_the_box(pose: Pose) -> str:
    if pose.action == "attack":
        open_amount = (0.3, 1.0, 0.5)[pose.action_phase]
    else:
        open_amount = 0.0
    box = (
        rect(-0.5, -0.3, 1.0, 0.85, 0.05, TOY_RED, INK, 0.12)
        + rect(-0.5, -0.12, 1.0, 0.1, 0.02, TOY_GOLD)
        + rect(-0.5, 0.28, 1.0, 0.1, 0.02, TOY_GOLD)
        + circle(0, 0.06, 0.09, TOY_GOLD, INK, 0.06)
    )
    spring = path_shape(f"M0.02 {-0.3 - open_amount * 0.24} L0.02 -0.3", "none", TIN_LIGHT, 0.04)
    star = polygon(star_points(0.02, -0.44 - open_amount * 0.24, 0.16, 0.065), TOY_GOLD, INK, 0.07)
    lid = svg_group(
        rect(-0.5, -0.44, 1.0, 0.14, 0.04, TOY_RED_DARK, INK, 0.1),
        f"rotate({num(-open_amount * 70)} -0.5 -0.35)",
    )
    return box + spring + star + lid


def paper_kite(pose: Pose) -> str:
    return (
        polygon([(0, -0.42), (0.26, -0.02), (0, 0.3), (-0.26, -0.02)], CANE_RED, INK, 0.08)
        + path_shape("M0 -0.42 L0 0.3", "none", ICING, 0.04)
        + path_shape("M-0.26 -0.02 L0.26 -0.02", "none", ICING, 0.04)
        + path_shape("M0 0.3 C0.08 0.44, -0.06 0.5, 0.04 0.62", "none", TIN_DARK, 0.03)
    )


def yo_yo(pose: Pose) -> str:
    radius_x, radius_y = squashed(0.28, 0.28, pose.squash)
    return (
        ellipse(0, 0.06, radius_x, radius_y, TOY_GOLD, INK, 0.1)
        + circle(0, 0.06, 0.14, JIMMY_RED, INK, 0.07)
        + path_shape("M0 -0.22 L0 -0.5", "none", ICING, 0.035)
        + circle(0, -0.55, 0.09, TIN_LIGHT, INK, 0.07)
    )


def roly_poly(pose: Pose) -> str:
    tilt = 0.0
    if pose.action == "walk":
        tilt = 6 if pose.phase % 2 == 0 else -6
    body = (
        ellipse(0, 0.04, 0.3, 0.26, TOY_RED, INK, 0.09)
        + path_shape("M-0.26 -0.08 C-0.12 -0.02, 0.12 -0.02, 0.26 -0.08 L0.2 0.2 C0.1 0.28, -0.1 0.28, -0.2 0.2 Z",
                     ICING, INK, 0.05)
        + circle(-0.1, -0.1, 0.035, INK)
        + circle(0.1, -0.1, 0.035, INK)
    )
    return svg_group(body, f"rotate({num(tilt)} 0 0.24)")


ENEMY_DRAW: dict[str, Callable[[Pose], str]] = {
    "minion": tin_soldier,
    "runner": all_aboard,
    "tank": grizzly_ted,
    "shielded": marbles_the_man,
    "healer": music_box_mender,
    "boss": jack_in_the_box,
    "flyer": paper_kite,
    "jet": yo_yo,
    "aegis": roly_poly,
}

ENEMY_META = [
    ("minion", "Tin Soldier", "#9fb4c4", "■", 0.8, 0.3, 0.2),
    ("runner", "All Aboard", "#e8b04a", "▸", 0.6, 0.3, 0.2),
    ("tank", "Grizzly Ted", "#b08050", "⬢", 1.0, 0.3, 0.2),
    ("shielded", "Marble's the Man", "#8fd0e8", "●", 0.7, 0.3, 0.2),
    ("healer", "Music Box Mender", "#e8a0c0", "♪", 0.9, 0.3, 0.2),
    ("boss", "Jack in the Box", "#d05050", "★", 1.2, 0.4, 0.2),
    ("flyer", "Paper Kite", "#e8e0c0", "◈", 0.7, 0.3, 0.2),
    ("jet", "Yo-Yo", "#70c0a0", "◆", 0.45, 0.3, 0.2),
    ("aegis", "Roly-Poly", "#c0c8d0", "✚", 0.9, 0.3, 0.2),
]

AIRBORNE_ENEMY_IDS = {"flyer", "jet", "aegis"}


def build_enemy_animations(draw: Callable[[Pose], str], airborne: bool = False) -> dict[str, dict]:
    walking = []
    for phase in range(8):
        pose = Pose(phase, WALK_BOB[phase], "walk", 0)
        walking.append(enemy_frame(pose, draw(pose), airborne))
    hit = []
    for action_phase in range(3):
        pose = Pose(0, 0.0, "hit", action_phase)
        hit.append(enemy_frame(pose, draw(pose), airborne))
    attack = []
    for action_phase in range(3):
        pose = Pose(0, 0.0, "attack", action_phase)
        attack.append(enemy_frame(pose, draw(pose), airborne))
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
# Three variants per kind is what all shipped themes ship; the byte budget keeps
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
    band — the variants have to stay inside their kind's own proportions."""
    return {"index": index, "tiles": tiles}


# The settled field fills from the plan's palette table; motif hexes are ramp
# siblings read off the same table, so a seeded variant never introduces a hue
# the hand-drawn variant does not already carry.
YULE_VALE_TILE_PALETTE = region_tile_palette(
    0,
    {
        "path": ("#2f3a44", ["#3d4a56", "#475665"], (5.0, 8.0, 4.0, 6.0)),
        "terrain1": ("#eef3f8", ["#c8d6e2", "#94a9bd"], (5.0, 11.0, 4.0, 7.0)),
        "terrain2": ("#c8d6e2", ["#eef3f8", "#94a9bd", "#5c7186"], (6.0, 8.0, 3.0, 8.0)),
        "terrain3": ("#94a9bd", ["#c8d6e2", "#5c7186", "#748ba0"], (5.0, 8.0, 5.0, 8.0)),
        "terrain4": ("#5c7186", ["#3d4a56", "#94a9bd", "#748ba0"], (5.0, 7.0, 4.5, 7.0)),
    },
)

SUNSPICE_TILE_PALETTE = region_tile_palette(
    1,
    {
        "path": ("#2a2016", ["#3a2e20", "#332818"], (7.0, 11.0, 3.0, 3.4)),
        "terrain1": ("#e8d6ae", ["#f0e2c0", "#bd9a6b"], (3.0, 11.0, 2.8, 6.5)),
        "terrain2": ("#bd9a6b", ["#e8d6ae", "#a8854f", "#8a6c3f"], (2.8, 11.0, 2.6, 6.0)),
        "terrain3": ("#6d7a4e", ["#87945e", "#55613c"], (6.0, 9.0, 3.5, 4.5)),
        "terrain4": ("#463c33", ["#32291f", "#5a4d40"], (4.0, 8.0, 4.0, 5.0)),
    },
)

ICON_SNOWS_TILE_PALETTE = region_tile_palette(
    2,
    {
        "path": ("#252b3e", ["#323a50", "#3a4360"], (5.0, 8.0, 4.0, 6.0)),
        "terrain1": ("#dfe6f2", ["#a8b6cc", "#c4d0e2"], (5.0, 11.0, 4.0, 7.0)),
        "terrain2": ("#a8b6cc", ["#dfe6f2", "#6e7f9e", "#8fa0bc"], (6.0, 8.0, 3.0, 8.0)),
        "terrain3": ("#6e7f9e", ["#a8b6cc", "#39435c", "#8fa0bc"], (5.0, 8.0, 5.0, 8.0)),
        "terrain4": ("#39435c", ["#252b3e", "#4a5570"], (5.0, 7.0, 4.5, 7.0)),
    },
)


def yule_vale_tiles() -> dict[str, str]:
    # Packed snow in tree shadow: a dark slate track with brighter drifts and footprints.
    path = (
        smear(12, 18, 7, 5, "#3d4a56", 0.55)
        + smear(24, 14, 6, 4.5, "#475665", 0.5)
        + smear(20, 26, 5.5, 4, "#3d4a56", 0.48)
        + stain(
            "M16 12 C19 9, 25 10, 26 14 C27 18, 21 20, 17 17 C14 15, 14 13, 16 12 Z",
            "#475665",
            0.42,
        )
        + pebble(14, 24, 1.0, "#475665", 0.4)
        + pebble(17, 21, 0.8, "#3d4a56", 0.4)
        + smear(2.5, 10, 5.5, 4, "#3d4a56", 0.28)
        + smear(33, 22, 6, 4.5, "#475665", 0.26)
        + smear(14, 33.5, 6, 4, "#3d4a56", 0.24)
    )
    terrain1 = (
        smear(18, 16, 10, 7, "#c8d6e2", 0.42)
        + smear(12, 24, 6, 5, "#94a9bd", 0.4)
        + smear(26, 22, 5, 4, "#c8d6e2", 0.45)
        + stain(
            "M20 10 C24 9, 28 12, 27 16 C26 19, 20 19, 18 15 C17 12, 17 11, 20 10 Z",
            "#c8d6e2",
            0.4,
        )
        + pebble(11, 12, 0.9, "#94a9bd", 0.4)
        + smear(4, 1.5, 6, 4.5, "#c8d6e2", 0.26)
        + smear(33.5, 14, 4.5, 6, "#94a9bd", 0.28)
        + smear(1.5, 28, 5, 4, "#c8d6e2", 0.24)
    )
    terrain2 = (
        smear(15, 14, 7, 6, "#eef3f8", 0.5)
        + smear(23, 21, 6, 5, "#94a9bd", 0.52)
        + smear(13, 26, 5.5, 4, "#5c7186", 0.48)
        + stain(
            "M16 15 C19 11, 25 12, 26 17 C27 22, 21 24, 17 21 C13 18, 13 17, 16 15 Z",
            "#5c7186",
            0.45,
        )
        + smear(27, 11, 3.5, 4, "#eef3f8", 0.4)
        + pebble(20, 29, 1.0, "#94a9bd", 0.45)
        + smear(30, 2, 5, 5, "#eef3f8", 0.26)
        + smear(2, 16, 5.5, 4, "#5c7186", 0.28)
        + smear(22, 33.5, 7, 3.5, "#94a9bd", 0.24)
    )
    terrain3 = (
        smear(17, 17, 8, 7, "#c8d6e2", 0.58)
        + smear(21, 19, 5.5, 4.5, "#5c7186", 0.6)
        + smear(14, 20, 4.5, 3.5, "#748ba0", 0.55)
        + stain(
            "M11 17 C11 12, 16 10, 21 13 C25 16, 24 23, 18 25 C13 27, 11 22, 11 17 Z",
            "#5c7186",
            0.5,
        )
        + smear(27, 12, 3.5, 4.5, "#5c7186", 0.42)
        + smear(9, 12, 3.5, 4, "#c8d6e2", 0.4)
        + pebble(26, 27, 1.1, "#5c7186", 0.45)
        + smear(8, 2, 5, 5, "#c8d6e2", 0.24)
        + smear(33.5, 8, 5, 4.5, "#748ba0", 0.26)
        + smear(1.5, 24, 4.5, 6, "#5c7186", 0.28)
    )
    terrain4 = (
        smear(20, 18, 8, 7, "#3d4a56", 0.58)
        + smear(16, 16, 5, 4.5, "#748ba0", 0.62)
        + smear(23, 22, 5, 4, "#94a9bd", 0.55)
        + stain(
            "M14 12 C17 8, 24 9, 26 14 C28 19, 23 23, 17 21 C12 19, 11 15, 14 12 Z",
            "#3d4a56",
            0.5,
        )
        + smear(10, 20, 4, 5, "#748ba0", 0.45)
        + smear(28, 14, 3, 4, "#94a9bd", 0.42)
        + pebble(26, 29, 0.9, "#3d4a56", 0.48)
        + smear(16, 1, 7, 4, "#748ba0", 0.26)
        + smear(33, 28, 4.5, 5, "#3d4a56", 0.28)
        + smear(6, 33.5, 6, 4, "#94a9bd", 0.24)
    )
    return {
        "path": ground_tile("#2f3a44", path),
        "terrain1": ground_tile("#eef3f8", terrain1),
        "terrain2": ground_tile("#c8d6e2", terrain2),
        "terrain3": ground_tile("#94a9bd", terrain3),
        "terrain4": ground_tile("#5c7186", terrain4),
    }


def sunspice_tiles() -> dict[str, str]:
    # Shaded sandy track: a warm dark earth path with dry cracks and pebbles.
    path = (
        smear(18, 16, 11, 3.2, "#3a2e20", 0.48)
        + smear(14, 24, 7, 3, "#332818", 0.55)
        + smear(26, 20, 5, 3.4, "#3a2e20", 0.45)
        + stain(
            "M22 10 C26 9, 30 12, 29 16 C28 19, 23 20, 21 17 C19 14, 19 11, 22 10 Z",
            "#3a2e20",
            0.4,
        )
        + pebble(11, 12, 0.9, "#3a2e20", 0.4)
        + smear(2, 6, 5, 3.5, "#332818", 0.28)
        + smear(33, 10, 5, 4, "#3a2e20", 0.26)
        + smear(26, 33.8, 6, 3.2, "#3a2e20", 0.24)
    )
    terrain1 = (
        smear(18, 14, 11, 3.2, "#f0e2c0", 0.5)
        + smear(16, 22, 10, 2.8, "#bd9a6b", 0.52)
        + smear(26, 18, 3, 6.5, "#f0e2c0", 0.42)
        + stain(
            "M9 26 C13 23, 22 23, 28 26 C30 28, 22 31, 12 30 C8 29, 6 28, 9 26 Z",
            "#bd9a6b",
            0.42,
        )
        + pebble(12, 10, 0.8, "#bd9a6b", 0.4)
        + smear(10, 1, 7, 3.5, "#f0e2c0", 0.28)
        + smear(33.5, 20, 4, 6, "#bd9a6b", 0.26)
        + smear(2, 32, 5, 3, "#f0e2c0", 0.24)
    )
    terrain2 = (
        smear(17, 12, 10, 2.8, "#e8d6ae", 0.52)
        + smear(19, 20, 11, 3, "#a8854f", 0.58)
        + smear(12, 26, 8, 2.6, "#8a6c3f", 0.5)
        + stain(
            "M10 16 C14 13, 22 14, 24 17 C26 20, 18 22, 12 20 C8 18, 7 17, 10 16 Z",
            "#8a6c3f",
            0.45,
        )
        + pebble(22, 28, 1.0, "#a8854f", 0.42)
        + smear(32, 2, 5, 3.2, "#e8d6ae", 0.26)
        + smear(1.5, 18, 4.5, 3, "#8a6c3f", 0.28)
        + smear(14, 34, 8, 3, "#a8854f", 0.24)
    )
    terrain3 = (
        smear(16, 15, 9, 4.5, "#87945e", 0.55)
        + smear(22, 18, 7, 4, "#87945e", 0.5)
        + smear(14, 22, 6, 3.5, "#55613c", 0.6)
        + stain(
            "M12 12 C16 9, 24 10, 27 14 C29 17, 24 20, 16 19 C11 18, 9 15, 12 12 Z",
            "#55613c",
            0.48,
        )
        + smear(26, 26, 4.5, 3, "#55613c", 0.45)
        + smear(9, 14, 3.5, 4, "#87945e", 0.4)
        + pebble(20, 28, 1.0, "#55613c", 0.42)
        + smear(3, 2, 6, 4, "#87945e", 0.26)
        + smear(33, 16, 4.5, 5, "#55613c", 0.28)
        + smear(20, 33.5, 6, 3.5, "#87945e", 0.24)
    )
    terrain4 = (
        smear(15, 14, 8, 5, "#5a4d40", 0.55)
        + smear(22, 17, 7, 4.5, "#32291f", 0.6)
        + smear(18, 23, 8, 4, "#463c33", 0.55)
        + stain(
            "M11 11 C15 8, 23 9, 27 13 C30 16, 25 20, 16 19 C11 18, 8 15, 11 11 Z",
            "#32291f",
            0.5,
        )
        + smear(10, 24, 4, 3.5, "#5a4d40", 0.45)
        + smear(27, 24, 3.5, 4, "#32291f", 0.42)
        + pebble(12, 12, 0.9, "#32291f", 0.45)
        + smear(2, 10, 5, 4, "#5a4d40", 0.26)
        + smear(28, 1.5, 6, 4, "#32291f", 0.24)
        + smear(33, 30, 4.5, 5, "#32291f", 0.28)
    )
    return {
        "path": ground_tile("#2a2016", path),
        "terrain1": ground_tile("#e8d6ae", terrain1),
        "terrain2": ground_tile("#bd9a6b", terrain2),
        "terrain3": ground_tile("#6d7a4e", terrain3),
        "terrain4": ground_tile("#463c33", terrain4),
    }


def icon_snows_tiles() -> dict[str, str]:
    # Packed blue-white snow in deep shadow: a near-midnight track with steel drifts.
    path = (
        smear(18, 16, 7, 5, "#323a50", 0.55)
        + smear(24, 22, 6, 4.5, "#3a4360", 0.5)
        + smear(14, 24, 5.5, 4, "#323a50", 0.48)
        + stain(
            "M15 12 C18 9, 24 10, 25 14 C26 18, 20 20, 16 17 C13 15, 13 13, 15 12 Z",
            "#3a4360",
            0.42,
        )
        + pebble(13, 25, 1.0, "#3a4360", 0.4)
        + pebble(16, 22, 0.8, "#323a50", 0.4)
        + smear(2.5, 10, 5.5, 4, "#323a50", 0.28)
        + smear(33, 22, 6, 4.5, "#3a4360", 0.26)
        + smear(14, 33.5, 6, 4, "#323a50", 0.24)
    )
    terrain1 = (
        smear(18, 16, 10, 7, "#c4d0e2", 0.42)
        + smear(12, 24, 6, 5, "#a8b6cc", 0.4)
        + smear(26, 22, 5, 4, "#c4d0e2", 0.45)
        + stain(
            "M20 10 C24 9, 28 12, 27 16 C26 19, 20 19, 18 15 C17 12, 17 11, 20 10 Z",
            "#c4d0e2",
            0.4,
        )
        + pebble(11, 12, 0.9, "#a8b6cc", 0.4)
        + smear(4, 1.5, 6, 4.5, "#c4d0e2", 0.26)
        + smear(33.5, 14, 4.5, 6, "#a8b6cc", 0.28)
        + smear(1.5, 28, 5, 4, "#c4d0e2", 0.24)
    )
    terrain2 = (
        smear(15, 14, 7, 6, "#dfe6f2", 0.5)
        + smear(23, 21, 6, 5, "#8fa0bc", 0.52)
        + smear(13, 26, 5.5, 4, "#6e7f9e", 0.48)
        + stain(
            "M16 15 C19 11, 25 12, 26 17 C27 22, 21 24, 17 21 C13 18, 13 17, 16 15 Z",
            "#6e7f9e",
            0.45,
        )
        + smear(27, 11, 3.5, 4, "#dfe6f2", 0.4)
        + pebble(20, 29, 1.0, "#8fa0bc", 0.45)
        + smear(30, 2, 5, 5, "#dfe6f2", 0.26)
        + smear(2, 16, 5.5, 4, "#6e7f9e", 0.28)
        + smear(22, 33.5, 7, 3.5, "#8fa0bc", 0.24)
    )
    terrain3 = (
        smear(17, 17, 8, 7, "#a8b6cc", 0.58)
        + smear(21, 19, 5.5, 4.5, "#39435c", 0.6)
        + smear(14, 20, 4.5, 3.5, "#8fa0bc", 0.55)
        + stain(
            "M11 17 C11 12, 16 10, 21 13 C25 16, 24 23, 18 25 C13 27, 11 22, 11 17 Z",
            "#39435c",
            0.5,
        )
        + smear(27, 12, 3.5, 4.5, "#39435c", 0.42)
        + smear(9, 12, 3.5, 4, "#a8b6cc", 0.4)
        + pebble(26, 27, 1.1, "#39435c", 0.45)
        + smear(8, 2, 5, 5, "#a8b6cc", 0.24)
        + smear(33.5, 8, 5, 4.5, "#8fa0bc", 0.26)
        + smear(1.5, 24, 4.5, 6, "#39435c", 0.28)
    )
    terrain4 = (
        smear(20, 18, 8, 7, "#252b3e", 0.58)
        + smear(16, 16, 5, 4.5, "#4a5570", 0.62)
        + smear(23, 22, 5, 4, "#39435c", 0.55)
        + stain(
            "M14 12 C17 8, 24 9, 26 14 C28 19, 23 23, 17 21 C12 19, 11 15, 14 12 Z",
            "#252b3e",
            0.5,
        )
        + smear(10, 20, 4, 5, "#4a5570", 0.45)
        + smear(28, 14, 3, 4, "#39435c", 0.42)
        + pebble(26, 29, 0.9, "#252b3e", 0.48)
        + smear(16, 1, 7, 4, "#4a5570", 0.26)
        + smear(33, 28, 4.5, 5, "#252b3e", 0.28)
        + smear(6, 33.5, 6, 4, "#39435c", 0.24)
    )
    return {
        "path": ground_tile("#252b3e", path),
        "terrain1": ground_tile("#dfe6f2", terrain1),
        "terrain2": ground_tile("#a8b6cc", terrain2),
        "terrain3": ground_tile("#6e7f9e", terrain3),
        "terrain4": ground_tile("#39435c", terrain4),
    }


def chrithmath_region_tiles() -> list[dict[str, list[str]]]:
    return [
        tile_variants(YULE_VALE_TILE_PALETTE, yule_vale_tiles()),
        tile_variants(SUNSPICE_TILE_PALETTE, sunspice_tiles()),
        tile_variants(ICON_SNOWS_TILE_PALETTE, icon_snows_tiles()),
    ]


# --- base art (108px camp footprint) -----------------------------------------


def yule_vale_base() -> str:
    pad = ellipse(54, 62, 42, 28, "#dfe6ee", opacity=0.95)
    plinth = rect(33, 70, 42, 10, 1.5, ROCK_CANDY, INK, 0.8)
    plinth_candy = rect(35, 72, 38, 2, 0.4, CANE_RED, 0.7) + rect(35, 76.5, 38, 2, 0.4, ICING, 0.6)
    house = rect(36, 46, 36, 26, 1.2, GINGERBREAD, INK, 1.2)
    roof = polygon([(32, 46), (54, 27), (76, 46)], "#5c7186", INK, 1.2)
    roof_snow = path_shape("M34 43.5 L54 28.5 L74 43.5", "none", ICING, 2.6)
    icicles = (
        polygon([(36, 46), (37.4, 51), (38.8, 46)], ICING)
        + polygon([(43, 46.5), (44.4, 52), (45.8, 46.5)], ICING)
        + polygon([(58, 46.5), (59.4, 52), (60.8, 46.5)], ICING)
        + polygon([(66, 46), (67.4, 51), (68.8, 46)], ICING)
    )
    chimney = rect(60, 30, 7, 12, 0.8, GINGERBREAD_DARK, INK, 0.9)
    chimney_stones = rect(61, 32, 5, 2.2, 0.3, ICING, 0.7) + rect(61, 35.5, 5, 2.2, 0.3, CANE_RED, 0.5)
    chimney_snow = rect(59.2, 28.4, 8.6, 2.4, 0.5, ICING)
    door = rect(48, 58, 12, 14, 5.5, GINGERBREAD_DARK, INK, 0.9)
    wreath = circle(54, 63, 3.2, "none", JIMMY_GREEN, 1.4)
    wreath_berries = circle(54, 60.2, 0.7, CANE_RED) + circle(56.3, 64, 0.7, CANE_RED) + circle(51.7, 64, 0.7, CANE_RED)
    icing_trim = path_shape("M36 49 L72 49", "none", ICING, 1.6, 0.9, "5 4")
    window = rect(63, 51, 7, 6, 0.6, "#e8b464", INK, 0.7)
    star = polygon(star_points(54, 22, 5, 2), TOY_GOLD, INK, 0.8)
    return base_svg(
        pad + plinth + plinth_candy + house + roof + roof_snow + icicles + chimney
        + chimney_stones + chimney_snow + door + wreath + wreath_berries + icing_trim + window + star
    )


def sunspice_base() -> str:
    pad = ellipse(54, 64, 44, 26, "#e0c896", opacity=0.92)
    dusk = ellipse(54, 34, 42, 13, "#e8a860", opacity=0.28)
    mango_canopy = ellipse(21, 43, 9, 10, "#68a868", opacity=0.92)
    mango_trunk = line(21, 50, 21, 68, TOY_WOOD_DARK, 2.2)
    mango_fruit = circle(18, 47, 1.3, JIMMY_GOLD) + circle(24, 49, 1.3, CANE_RED)
    olive_canopy = ellipse(88, 47, 7, 8, "#8a9458", opacity=0.92)
    olive_trunk = line(88, 52, 88, 68, TOY_WOOD_DARK, 2.0)
    wall = rect(30, 48, 48, 26, 1.2, "#f0e2c0", INK, 1.2)
    roof = rect(24, 40, 60, 8, 1.0, "#8a6c3f", INK, 1.1)
    roof_light = rect(26, 41.5, 56, 2.2, 0.6, "#b08850", opacity=0.8)
    veranda = rect(27, 47, 54, 4, 0.8, TOY_WOOD, INK, 0.9)
    door = rect(44, 56, 10, 18, 0.8, "#7a5c34", INK, 0.9)
    shutters = rect(38, 56, 6, 10, 0.6, JIMMY_BLUE, INK, 0.7) + rect(54, 56, 6, 10, 0.6, JIMMY_BLUE, INK, 0.7)
    window = rect(63, 56, 9, 8, 0.6, "#e8b464", INK, 0.7)
    railing = line(30, 67, 78, 67, TOY_WOOD_DARK, 1.2)
    posts = line(32, 67, 32, 74, TOY_WOOD_DARK, 1.4) + line(54, 67, 54, 74, TOY_WOOD_DARK, 1.4) + line(76, 67, 76, 74, TOY_WOOD_DARK, 1.4)
    pavlova = ellipse(40, 64.5, 3.4, 2.6, ICING) + ellipse(40, 63, 2.2, 1.6, COTTON_CANDY)
    string = path_shape("M30 49 Q54 55 78 49", "none", "#4a3a28", 0.8)
    bulbs = (
        circle(38, 50.6, 1.1, JIMMY_GOLD)
        + circle(46, 52.2, 1.1, JIMMY_RED)
        + circle(54, 52.6, 1.1, JIMMY_BLUE)
        + circle(62, 52.2, 1.1, JIMMY_GREEN)
        + circle(70, 50.6, 1.1, JIMMY_GOLD)
    )
    return base_svg(
        pad + dusk + mango_canopy + mango_trunk + mango_fruit + olive_canopy + olive_trunk
        + wall + roof + roof_light + veranda + door + shutters + window + railing + posts
        + pavlova + string + bulbs
    )


def icon_snows_base() -> str:
    pad = ellipse(54, 62, 42, 28, "#c8d2e6", opacity=0.94)
    house = rect(36, 46, 36, 28, 1.4, GINGERBREAD, INK, 1.3)
    roof = polygon([(32, 46), (54, 30), (76, 46)], "#748ba0", INK, 1.2)
    roof_snow = path_shape("M34 43.5 L54 31.5 L74 43.5", "none", ICING, 2.4)
    drum = rect(48, 23, 12, 9, 0.8, GINGERBREAD_DARK, INK, 0.9)
    dome = path_shape("M54 11 C48 15, 46 19, 46 23 L62 23 C62 19, 60 15, 54 11 Z", TOY_GOLD, INK, 1.1)
    dome_shade = path_shape("M54 11 C51 14, 49.5 18, 49.5 23 L53 23 C52.5 18, 53.5 14, 54 11 Z", TOY_GOLD, INK, 0.7, 0.35)
    cross = line(54, 5, 54, 11, "#e8d080", 1.6) + line(51.4, 7.5, 56.6, 7.5, "#e8d080", 1.6)
    icon_panel = rect(44, 52, 9, 11, 0.6, TOY_GOLD, INK, 0.8)
    icon_figure = rect(46.5, 54.5, 4, 6, 0.4, "#8a5428")
    door = rect(57, 58, 11, 16, 5, TOY_RED_DARK, INK, 0.9)
    candle = circle(39, 55, 2, "#ffe9a8", INK, 0.5)
    candle_glow = ellipse(39, 57.5, 3.6, 2.6, "#e8b464", opacity=0.3)
    garland = path_shape("M36 50 Q45 55 54 50 Q63 45 72 50", "none", JIMMY_GREEN, 1.6)
    garland_berries = circle(42, 52.2, 0.7, CANE_RED) + circle(54, 49.6, 0.7, CANE_RED) + circle(66, 52.2, 0.7, CANE_RED)
    return base_svg(
        pad + house + roof + roof_snow + drum + dome + dome_shade + cross + icon_panel + icon_figure
        + door + candle + candle_glow + garland + garland_berries
    )


# --- spawn art (toy-box hatch, 36x36) -----------------------------------------


def toy_box_base() -> str:
    return (
        rect(6, 15, 24, 14, 1.4, TOY_RED, INK, 1.0)
        + rect(6, 15, 24, 3.0, 1.0, TOY_RED_DARK)
        + rect(10, 19, 16, 7.5, 0.8, TOY_WOOD, INK, 0.7)
        + rect(13, 20.5, 4, 4.5, 0.5, TIN_BODY, INK, 0.5)
        + rect(19, 20.5, 4, 4.5, 0.5, JIMMY_GOLD, INK, 0.5)
    )


def spawn_art() -> dict[str, str]:
    closed_lid = rect(5, 9, 26, 7, 1.2, TOY_RED, INK, 1.0) + rect(5, 9, 26, 2.2, 1.0, ICING, 0.5)
    closed = tile_svg(toy_box_base() + closed_lid)
    transition = tile_svg(toy_box_base() + svg_group(closed_lid, "rotate(-38 5 12.5)"))
    peek = (
        circle(14, 13.5, 2.0, "#8fd0e8", INK, 0.5)
        + polygon(star_points(21, 13, 2.2, 0.9), TOY_GOLD, INK, 0.5)
    )
    opened = tile_svg(toy_box_base() + peek + svg_group(closed_lid, "translate(-9 -7) rotate(-65 5 12.5)"))
    return {"closed": closed, "open": opened, "transition": transition}


# ===== Map site art (drawn at 26 world px from a 36x36 authoring box) =====

SITE_PAD_SHADOW = "rgba(0,0,0,0.28)"
SITE_PLATE_FILL = "#3a2f26"
SITE_PLATE_LIGHT = "#5a4c3e"
CACHE_BODY_FILL = "#8a3a3a"
CACHE_BODY_FILL_BROKEN = "#5a2a2a"
CACHE_LID_FILL = "#a84848"
CACHE_RIBBON = "#e8c848"

BUILDING_KINDS = ["armory", "magazine", "beacon", "foundry", "clocktower", "aviary"]
CACHE_STATES = ["sealed", "unlocked", "broken"]


def site_pad() -> str:
    """Contact shadow plus a dark plate, the ground mark every site shares. The
    plate is dark enough to carry a silhouette on the lightest snow tile and to
    stay off the darkest rock tile."""
    return (
        ellipse(18, 29.4, 10.5, 3.4, SITE_PAD_SHADOW)
        + rect(7.5, 24.6, 21, 4.6, 1, SITE_PLATE_FILL, INK, 0.9)
        + rect(7.5, 24.6, 21, 1.4, None, SITE_PLATE_LIGHT, opacity=0.5)
    )


def armory_building() -> str:
    return site_pad() + (
        rect(9.6, 14.8, 16.8, 2.2, 0.5, TOY_WOOD, INK, 0.9)
        + rect(10.6, 17, 2.4, 7.6, 0.4, TOY_WOOD_DARK, INK, 0.7)
        + rect(23, 17, 2.4, 7.6, 0.4, TOY_WOOD_DARK, INK, 0.7)
        + rect(12.4, 8.4, 4.4, 6.4, 0.7, TIN_BODY, INK, 0.8)
        + rect(13.6, 6.0, 2.0, 2.4, 0.4, TOY_RED, INK, 0.7)
        + rect(19.2, 10.2, 3.6, 4.6, 0.6, JIMMY_GOLD, INK, 0.7)
        + circle(21, 11.6, 0.8, INK)
    )


def magazine_building() -> str:
    jars = (
        rect(10.2, 13.6, 5.4, 11, 1.0, JIMMY_RED, INK, 0.8)
        + rect(10.2, 12.4, 5.4, 2.0, 0.6, TOY_WOOD_DARK, INK, 0.7)
        + rect(15.3, 10.8, 5.4, 13.8, 1.0, JIMMY_BLUE, INK, 0.8)
        + rect(15.3, 9.6, 5.4, 2.0, 0.6, TOY_WOOD_DARK, INK, 0.7)
        + rect(20.4, 14.8, 5.4, 9.8, 1.0, JIMMY_GREEN, INK, 0.8)
        + rect(20.4, 13.6, 5.4, 2.0, 0.6, TOY_WOOD_DARK, INK, 0.7)
    )
    return site_pad() + jars


def beacon_building() -> str:
    return site_pad() + (
        path_shape("M15.4,24.6 L16.6,10.4 L19.4,10.4 L20.6,24.6 Z", TOY_WOOD_DARK, INK, 0.9)
        + rect(13.4, 6.4, 9.2, 4.4, 0.8, TOY_WOOD, INK, 0.9)
        + path_shape("M12.6,6.4 L23.4,6.4 L18,1.6 Z", TOY_RED, INK, 0.9)
        + ellipse(18, 12.6, 2.6, 2.4, JIMMY_GOLD, INK, 0.7)
        + circle(18, 15.4, 0.7, "#3a2e1c")
        + ellipse(18, 12.8, 4.6, 4.2, JIMMY_GOLD, opacity=0.18)
    )


def foundry_building() -> str:
    return site_pad() + (
        polygon([(11.8, 24.6), (24.2, 24.6), (21.4, 20.4), (14.6, 20.4)], TOY_WOOD_DARK, INK, 0.8)
        + ellipse(18, 21.8, 3.4, 1.5, "#ff9a3c", opacity=0.8)
        + path_shape("M18 22.4 C14 22.4, 11.6 19.6, 11.6 16.2 C11.6 12.6, 14.4 10.2, 18 10.2 "
                     "C21.6 10.2, 24.4 12.6, 24.4 16.2 C24.4 19.6, 22 22.4, 18 22.4 Z",
                     "#8a5a3a", INK, 1.0)
        + path_shape("M11.6 16.2 C11.6 12.6, 14.4 10.2, 18 10.2 C21.6 10.2, 24.4 12.6, 24.4 16.2",
                     "none", "#5a3a22", 1.4)
        + ellipse(15.4, 13.8, 1.8, 1.2, "#c89a6a", opacity=0.7)
        + path_shape("M24.4 15.4 C26.4 14.6, 27.6 15.4, 27.2 17.2", "none", "#5a3a22", 1.4)
    )


def clocktower_building() -> str:
    return site_pad() + (
        rect(13.4, 8.2, 9.2, 16.4, 1.0, TOY_WOOD, INK, 0.9)
        + path_shape("M12.6,8.2 L23.4,8.2 L18,3.8 Z", TOY_RED, INK, 0.9)
        + circle(18, 13.4, 3.2, ICING, INK, 0.8)
        + line(18, 13.4, 18, 11.2, INK, 0.7)
        + line(18, 13.4, 19.8, 14.2, INK, 0.7)
        + circle(18, 19.4, 1.1, JIMMY_GOLD, INK, 0.6)
        + rect(14.8, 20.6, 6.4, 4.0, 0.5, TOY_WOOD_DARK, INK, 0.8)
    )


def aviary_building() -> str:
    return site_pad() + (
        path_shape("M10.6,24.6 C10.6,19.4, 13.4,16.8, 18,16.8 C22.6,16.8, 25.4,19.4, 25.4,24.6",
                   "none", TOY_WOOD, 2.2)
        + rect(13.4, 20.6, 9.2, 2.0, 0.4, TOY_WOOD_LIGHT, opacity=0.8)
        + circle(18, 21.4, 1.6, TIN_LIGHT, INK, 0.6)
        + polygon(star_points(18, 12.6, 4.2, 1.7), TOY_GOLD, INK, 0.8)
        + line(10.6, 24.6, 10.6, 18.6, TOY_WOOD, 1.6)
        + line(25.4, 24.6, 25.4, 18.6, TOY_WOOD, 1.6)
    )


def cache_body(body_fill: str, lid_fill: str) -> str:
    return (
        ellipse(18, 29.4, 10.5, 3.4, SITE_PAD_SHADOW)
        + rect(7.6, 13.6, 20.8, 13, 1.2, body_fill, INK, 1)
        + rect(17.2, 13.6, 1.6, 13, None, CACHE_RIBBON)
        + rect(7.6, 19.0, 20.8, 1.6, None, CACHE_RIBBON)
    )


def sealed_cache() -> str:
    return cache_body(CACHE_BODY_FILL, CACHE_LID_FILL) + (
        rect(6.8, 9.4, 22.4, 4.6, 1, CACHE_LID_FILL, INK, 1)
        + rect(17.2, 9.4, 1.6, 4.6, None, CACHE_RIBBON)
        + circle(16.2, 8.2, 1.6, CACHE_RIBBON, INK, 0.7)
        + circle(19.8, 8.2, 1.6, CACHE_RIBBON, INK, 0.7)
        + rect(23.4, 12.2, 4.2, 2.6, 0.4, ICING, INK, 0.6)
    )


def unlocked_cache() -> str:
    return cache_body(CACHE_BODY_FILL, CACHE_LID_FILL) + (
        rect(8.8, 14.2, 18.4, 2.6, 0.4, "#3a1c1c")
        + svg_element("rect", {
            "x": 6.8, "y": 5.4, "width": 22.4, "height": 4.6, "rx": 1,
            "fill": CACHE_LID_FILL, "stroke": INK, "stroke-width": 1,
            "transform": "rotate(-14 18 8)",
        })
        + svg_element("rect", {
            "x": 14.6, "y": 8.2, "width": 6, "height": 6.6, "rx": 0.6,
            "fill": ICING, "stroke": INK, "stroke-width": 0.8,
            "transform": "rotate(-6 18 11)",
        })
    )


def broken_cache() -> str:
    return cache_body(CACHE_BODY_FILL_BROKEN, CACHE_LID_FILL) + (
        path_shape("M7.2,7.6 L28.4,4.8 L28.4,9.2 L7.2,11.8 Z", CACHE_LID_FILL, INK, 1)
        + rect(8.8, 14.2, 18.4, 2.4, 0.4, "#3a1c1c", opacity=0.8)
        + svg_element("rect", {
            "x": 19.2, "y": 15.4, "width": 5, "height": 5.2, "rx": 0.5,
            "fill": ICING, "stroke": INK, "stroke-width": 0.7,
            "transform": "rotate(14 22 18)",
        })
        + circle(12.8, 27.2, 1.7, JIMMY_RED, INK, 0.4)
        + circle(18.4, 28.2, 1.3, JIMMY_GOLD, INK, 0.4)
        + circle(23.4, 26.4, 1.5, JIMMY_BLUE, INK, 0.4)
    )


def supply_drop_svg() -> str:
    """The boss package: Santa's sack with toys peeking. The pulsing ring that
    marks it stays MapSiteLayer markup, so only the sack is theme art."""
    parts = [
        ellipse(18, 29.4, 10.5, 3.4, SITE_PAD_SHADOW),
        path_shape("M10 27.4 C8 20, 10 12, 15 10 L21 10 C26 12, 28 20, 26 27.4 Z", TOY_RED, INK, 1.0),
        rect(13.8, 7.6, 8.4, 3.4, 0.8, TOY_RED_DARK, INK, 0.9),
        circle(15.6, 13.4, 1.8, "#8fd0e8", INK, 0.6),
        polygon(star_points(20.8, 12.8, 2.0, 0.8), TOY_GOLD, INK, 0.6),
        circle(18, 15.8, 1.5, JIMMY_GREEN, INK, 0.6),
    ]
    return "".join(parts)


def site_art() -> dict:
    """The theme's `sites` block: buildings, cache states, and the boss package
    sack, each wrapped in the 36x36 box the renderer turns into a symbol."""
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


# --- region maps --------------------------------------------------------------
# The compositions live in region_map_art.py next to their node tables, mirroring
# how gen_aftermath_theme.py pulls rustbloom / sand / ashen from the same module.


def yule_vale_map() -> str:
    return region_map_art.yule_vale_map()


def sunspice_coast_map() -> str:
    return region_map_art.sunspice_coast_map()


def icon_snows_map() -> str:
    return region_map_art.icon_snows_map()


def chrithmath_menu_background() -> str:
    return menu_background_art.chrithmath_menu_background()


# --- assembly ---------------------------------------------------------------

# The Chrithmath world's own map catalog, overriding the default one through
# ThemeMapsOverrideSchema (src/content/schemas/maps.ts): 36 level configs and
# the 12 progressive variant seeds. Data rather than art, but it belongs to this
# script because the script rewrites the whole theme file — without it here a
# rerun would drop the override and hand the world the default catalog back.
CHRITHMATH_MAP_LEVELS = [
    (15, 10, 0, 1, "serpentine", 76111),
    (15, 10, 0, 2, "canyon", 76222),
    (10, 15, 0, 3, "serpentine", 76333),
    (15, 10, 0, 4, "split", 76444),
    (18, 18, 0, 5, "bastion", 76555),
    (18, 18, 0, 6, "battlefield", 76666),
    (20, 12, 0, 7, "canyon", 76777),
    (20, 12, 0, 8, "serpentine", 76888),
    (12, 20, 0, 9, "split", 76999),
    (25, 15, 0, 10, "bastion", 760000),
    (25, 18, 0, 11, "battlefield", 760111),
    (25, 18, 0, 12, "open", 760222),
    (15, 10, 1, 1, "serpentine", 86111),
    (20, 12, 1, 2, "split", 86222),
    (20, 20, 1, 3, "bastion", 86333),
    (20, 20, 1, 4, "battlefield", 86444),
    (25, 15, 1, 5, "open", 86555),
    (25, 15, 1, 6, "canyon", 86666),
    (15, 20, 1, 7, "split", 86777),
    (25, 20, 1, 8, "bastion", 86888),
    (25, 25, 1, 9, "battlefield", 86999),
    (25, 25, 1, 10, "open", 860000),
    (30, 20, 1, 11, "canyon", 860111),
    (30, 20, 1, 12, "serpentine", 860222),
    (20, 20, 2, 1, "bastion", 96111),
    (20, 20, 2, 2, "battlefield", 96222),
    (25, 15, 2, 3, "open", 96333),
    (25, 15, 2, 4, "canyon", 96444),
    (15, 25, 2, 5, "serpentine", 96555),
    (30, 20, 2, 6, "split", 96666),
    (25, 25, 2, 7, "open", 96777),
    (30, 20, 2, 8, "canyon", 96888),
    (30, 20, 2, 9, "serpentine", 96999),
    (18, 25, 2, 10, "split", 960000),
    (30, 20, 2, 11, "battlefield", 960111),
    (30, 20, 2, 12, "bastion", 960222),
]

# (regionId, branch level, entry count, seed) per progressive variant.
CHRITHMATH_PROGRESSIVE_VARIANTS = [
    (0, 1, 1, 76161),
    (0, 5, 2, 57575),
    (0, 9, 3, 97979),
    (0, 12, 4, 970004),
    (1, 1, 1, 970005),
    (1, 5, 2, 970006),
    (1, 9, 3, 970007),
    (1, 12, 4, 970008),
    (2, 1, 1, 970009),
    (2, 5, 2, 970010),
    (2, 9, 3, 970011),
    (2, 12, 4, 970012),
]


def maps_override() -> dict:
    return {
        "levels": [
            {
                "width": width,
                "height": height,
                "regionId": region_id,
                "level": level,
                "style": style,
                "seed": seed,
            }
            for width, height, region_id, level, style, seed in CHRITHMATH_MAP_LEVELS
        ],
        "progressive": {
            "blockSize": 5,
            "placementInterval": 3,
            "rerollGoldPerWave": 3,
            "variants": [
                {
                    "regionId": region_id,
                    "level": level,
                    "entryCount": entry_count,
                    "seed": seed,
                }
                for region_id, level, entry_count, seed in CHRITHMATH_PROGRESSIVE_VARIANTS
            ],
        },
    }


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
        animations = build_enemy_animations(ENEMY_DRAW[enemy_id], enemy_id in AIRBORNE_ENEMY_IDS)
        enemies[enemy_id] = {
            "name": name,
            "color": color,
            "shape": shape,
            "walking": animation_record(walk_duration, animations["walking"]),
            "hitReaction": animation_record(hit_duration, animations["hit"]),
            "attack": animation_record(attack_duration, animations["attack"]),
        }
    region_tiles = chrithmath_region_tiles()
    regions = [
        {
            "id": 0,
            "name": "The Yule Vale",
            "tiles": region_tiles[0],
            "base": yule_vale_base(),
            "mapImage": yule_vale_map(),
            "mapLayout": region_map_art.CHRITHMATH_MAP_LAYOUTS[0],
        },
        {
            "id": 1,
            "name": "The Sunspice Coast",
            "tiles": region_tiles[1],
            "base": sunspice_base(),
            "mapImage": sunspice_coast_map(),
            "mapLayout": region_map_art.CHRITHMATH_MAP_LAYOUTS[1],
        },
        {
            "id": 2,
            "name": "The Icon Snows",
            "tiles": region_tiles[2],
            "base": icon_snows_base(),
            "mapImage": icon_snows_map(),
            "mapLayout": region_map_art.CHRITHMATH_MAP_LAYOUTS[2],
        },
    ]
    return {
        "id": "chrithmath",
        "label": "Chrithmath",
        "maps": maps_override(),
        "menuBackground": chrithmath_menu_background(),
        "towers": towers,
        "enemies": enemies,
        "regions": regions,
        "sites": site_art(),
        "spawns": spawn_art(),
    }


# --- validation ---------------------------------------------------------------


def srgb_channel_to_linear(channel: int) -> float:
    """Mirrors channelToLinear in relativeLuminanceOfChannels
    (tests/unit/map-theme.test.ts) so the generator rejects the same ramps the
    mirrored test would reject."""
    srgb = channel / 255
    return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4


def hex_luminance(hex_value: str) -> float:
    value = hex_value.lstrip("#")
    red = int(value[0:2], 16)
    green = int(value[2:4], 16)
    blue = int(value[4:6], 16)
    return 0.2126 * srgb_channel_to_linear(red) + 0.7152 * srgb_channel_to_linear(green) + 0.0722 * srgb_channel_to_linear(blue)


def validate_region_palette(region_name: str, field_fills: dict[str, str]) -> None:
    """The path is the darkest value in its region, and the four terrain steps
    read as a light-to-dark ramp on the board and in the block preview."""
    path_luminance = hex_luminance(field_fills["path"])
    terrain_luminances = [hex_luminance(field_fills[kind]) for kind in ("terrain1", "terrain2", "terrain3", "terrain4")]
    for step in range(1, 4):
        if terrain_luminances[step] > terrain_luminances[step - 1]:
            raise SystemExit(f"{region_name}: terrain ramp is not monotonically non-increasing at terrain{step + 1}")
    span = terrain_luminances[0] - terrain_luminances[3]
    if span < 0.4:
        raise SystemExit(f"{region_name}: terrain ramp span {span:.3f} is below the 0.4 floor")
    for kind, luminance in zip(("terrain1", "terrain2", "terrain3", "terrain4"), terrain_luminances):
        margin = luminance - path_luminance
        if margin < 0.02:
            raise SystemExit(f"{region_name}: path margin over {kind} is {margin:.3f}, below the 0.02 floor")
    for step in range(1, 4):
        step_size = terrain_luminances[step - 1] - terrain_luminances[step]
        if step_size < 0.10:
            raise SystemExit(f"{region_name}: terrain{step} to terrain{step + 1} step {step_size:.3f} is below the 0.10 floor")


def validate_theme(theme: dict) -> None:
    if theme["id"] != "chrithmath" or theme["label"] != "Chrithmath":
        raise SystemExit("theme id/label drifted")
    validate_maps_override(theme["maps"])
    menu_background_art.assert_menu_paint(theme["menuBackground"], "menu background")
    verify_sidecar_matches_theme(theme["menuBackground"])
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
    if [region["name"] for region in theme["regions"]] != ["The Yule Vale", "The Sunspice Coast", "The Icon Snows"]:
        raise SystemExit("region names drifted")
    for region_index, region in enumerate(theme["regions"]):
        field_fills = {}
        if sorted(region["tiles"]) != sorted(TILE_KINDS):
            raise SystemExit(f"tile kinds drifted: {region['name']}")
        for tile_name, tile_images in region["tiles"].items():
            label = f"{region['name']} {tile_name}"
            if len(tile_images) != TILE_VARIANT_COUNT:
                raise SystemExit(f"{label}: expected {TILE_VARIANT_COUNT} variants, found {len(tile_images)}")
            variant_field_fills = set()
            for variant_index, tile_image in enumerate(tile_images):
                assert_paint(tile_image, f"{label} v{variant_index}")
                assert_tile_paint(tile_image, f"{label} v{variant_index}")
                variant_field_fills.add(first_field_fill(tile_image, f"{label} v{variant_index}"))
            if len(variant_field_fills) != 1:
                raise SystemExit(f"{label}: variants disagree on the field fill {sorted(variant_field_fills)}")
            field_fills[tile_name] = next(iter(variant_field_fills))
        validate_region_palette(region["name"], field_fills)
        assert_paint(region["base"], region["name"])
        if region["mapLayout"] != region_map_art.CHRITHMATH_MAP_LAYOUTS[region_index]:
            raise SystemExit(f"map layout drifted: {region['name']}")
        region_map_art.assert_map_paint(region["mapImage"], f"{region['name']} map image")
    for spawn_name, spawn_image in theme["spawns"].items():
        assert_paint(spawn_image, spawn_name)
    validate_site_art(theme["sites"])


def verify_sidecar_matches_theme(menu_image: str) -> None:
    """The sidecar is a duplicate of the theme's menuBackground, written by
    gen_theme_images.py; if one already exists it must match byte for byte."""
    if not os.path.exists(SIDECAR_PATH):
        return
    with open(SIDECAR_PATH, encoding="utf-8") as sidecar_file:
        sidecar = json.load(sidecar_file)
    if sidecar.get("menuBackground") != menu_image:
        raise SystemExit("menu sidecar drifted from the theme's menuBackground")


def validate_maps_override(override: dict) -> None:
    """The world catalog has to survive every rerun of this script, so it is
    checked against the same shape ThemeMapsOverrideSchema enforces."""
    if sorted(override) != ["levels", "progressive"]:
        raise SystemExit("maps override carries fields the theme schema does not allow")
    if len(override["levels"]) != 36:
        raise SystemExit(f"maps override needs 36 levels, found {len(override['levels'])}")
    for level_number, level_config in enumerate(override["levels"], start=1):
        if (level_config["level"] != (level_number - 1) % 12 + 1
                or level_config["regionId"] != (level_number - 1) // 12):
            raise SystemExit(f"maps override level {level_number} is out of region order")
    progressive = override["progressive"]
    if progressive["blockSize"] != 5 or len(progressive["variants"]) != 12:
        raise SystemExit("maps override progressive block drifted")


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


# Biome keeps a short JSON object on one line, so the maps catalog rows are
# emitted that way too: a rerun then leaves the file byte identical instead of
# dirtying it with a pure formatting diff.
MAPS_LEVEL_PATTERN = re.compile(
    r'\{\s*"width": (\d+),\s*"height": (\d+),\s*"regionId": (\d+),\s*"level": (\d+),\s*'
    r'"style": "(\w+)",\s*"seed": (\d+)\s*\}'
)
MAPS_VARIANT_PATTERN = re.compile(
    r'\{\s*"regionId": (\d+),\s*"level": (\d+),\s*"entryCount": (\d+),\s*"seed": (\d+)\s*\}'
)


def collapse_maps_lines(text: str) -> str:
    def collapse_level(match: re.Match[str]) -> str:
        width, height, region_id, level, style, seed = match.groups()
        return (f'{{ "width": {width}, "height": {height}, "regionId": {region_id}, '
                f'"level": {level}, "style": "{style}", "seed": {seed} }}')

    def collapse_variant(match: re.Match[str]) -> str:
        region_id, level, entry_count, seed = match.groups()
        return (f'{{ "regionId": {region_id}, "level": {level}, '
                f'"entryCount": {entry_count}, "seed": {seed} }}')

    text = MAPS_LEVEL_PATTERN.sub(collapse_level, text)
    return MAPS_VARIANT_PATTERN.sub(collapse_variant, text)


def write_theme(theme: dict) -> None:
    dumped = collapse_layout_lines(collapse_maps_lines(json.dumps(theme, indent=2, ensure_ascii=False)))
    with open(THEME_PATH, "w", encoding="utf-8") as theme_file:
        theme_file.write(dumped + "\n")


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
        "<h2>Towers at 27px and 81px, plus Stollen Bastion at -45</h2>",
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
