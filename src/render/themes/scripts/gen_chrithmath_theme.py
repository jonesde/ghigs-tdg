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
from typing import Callable, NamedTuple

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
# The Candy Cane Coil's declared color, kept as its own constant because the peppermint
# railgun needs the deeper CANE_RED for its stripes and the two would otherwise trade.
COIL_RED = "#e87a7a"
CANE_WHITE = "#f0ece6"
# Three towers whose declared color in TOWER_META differs from every color their own art
# paints. The declared color is what the shop card, the minimap glyph and the HP bar draw,
# so a tower painted in something else reads as one thing on the board and another in the UI.
# Each gets its own constant rather than moving a tone the rest of the theme shares.
RAILGUN_WHITE = "#e8e8f0"
JIMMY_AMBER = "#e0a040"
NUTCRACKER_PLATE = "#b0a08c"
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

# Each enemy id carries a declared colour in ENEMY_META, and TextEnemyManager.ts draws the
# minimap glyph and StatsPanel.vue draws the HP bar in it, so the board creature has to be
# painted in the family that colour names instead of borrowing a shared accent.
BRASS = "#e8b04a"
BRASS_DARK = "#9c6f26"
BRASS_LIGHT = "#f6d68c"
TEDDY = "#b08050"
TEDDY_DARK = "#7a5c38"
TEDDY_LIGHT = "#d2a878"
MUSIC_ROSE = "#e8a0c0"
MUSIC_ROSE_LIGHT = "#f6d4e2"
MUSIC_ROSE_DARK = "#b06a88"
JACK_RED = "#d05050"
JACK_RED_LIGHT = "#e07070"
JACK_RED_DARK = "#943838"

# The three airborne toys declared cream, mint and silver and then painted themselves in the
# shared candy accents, so the minimap glyph and the HP bar named a different creature from
# the one on the board. Their bodies carry the declared colour itself, so a cream kite on a
# near-white snow tile and a silver tumbler on the same tile are read off the INK outline
# rather than off a hue difference, which is why all three outlines are drawn a step heavier
# than the ground creatures'.
NEWSPRINT = "#e8e0c0"
NEWSPRINT_DARK = "#b8ac8c"
NEWSPRINT_LIGHT = "#f6f2e2"
MINT = "#70c0a0"
MINT_DARK = "#3f8c72"
MINT_LIGHT = "#a8e0cc"
PEWTER = "#c0c8d0"
PEWTER_DARK = "#7e8894"
PEWTER_LIGHT = "#e2e8ee"

# The three late enemies declare their own colours and paint their own bodies in
# them, so the minimap glyph and the HP bar name the same creature as the board.
MENDER_MINT = "#7ec8a8"
MENDER_MINT_DARK = "#4e9c78"
MENDER_MINT_LIGHT = "#b8e8cc"
FROST = "#90b4e0"
FROST_DARK = "#5c7cae"
FROST_LIGHT = "#c2d6f2"
GINGER = "#d8a050"
GINGER_DARK = "#9c6f2c"
GINGER_LIGHT = "#f2d49c"


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
    """A cookie seen from directly above. The renderer rotates this sprite by the
    aim angle, so the standing gingerbread man it replaces lay down at 90 degrees.
    A disc with two arms out along +-y and one mark on +X has no top to lose."""
    shift = {"rest": 0.0, "discharge": -2.4, "smoke": -0.7}[pose]
    arms = rect(-2.2, 5.6, 4.4, 8.0, 2.2, GINGERBREAD, INK, 0.9) + rect(
        -2.2, -13.6, 4.4, 8.0, 2.2, GINGERBREAD, INK, 0.9
    )
    sprinkles = ""
    for dot_index in range(8):
        dot_angle = math.radians(22.5 + dot_index * 45)
        sprinkles += circle(math.cos(dot_angle) * 5.0, math.sin(dot_angle) * 5.0, 0.8, ICING)
    cookie = circle(0, 0, 8.2, GINGERBREAD, INK, 0.9) + sprinkles + circle(0, 0, 1.5, GINGERBREAD_LIGHT, INK, 0.5)
    cannon = (
        rect(5.2, -2.5, 8.0, 5.0, 1.6, GINGERBREAD_LIGHT, INK, 0.9)
        + rect(11.4, -2.5, 1.6, 5.0, 0.8, GINGERBREAD_DARK)
        + path_shape("M6.4 0 L11.0 0", "none", ICING, 1.1)
    )
    body = arms + cookie + cannon
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(10.6, 0)
    elif pose == "smoke":
        effect = smoke_puff(11.4, 0)
    return tower_svg(svg_group(body, f"translate({num(shift)} 0)") + effect)


def candy_cane_coil(pose: str) -> str:
    """Candy cane wound flat on a biscuit: concentric stripes about a centre post
    survive any rotation, which is why the upright cane hook and its slab go."""
    shift = {"rest": 0.0, "discharge": -2.4, "smoke": -0.6}[pose]
    stripes = ""
    for ring_radius, ring_width in ((3.6, 2.8), (6.8, 2.5), (9.6, 2.1)):
        stripes += circle(0, 0, ring_radius, "none", COIL_RED, ring_width)
    coil = circle(0, 0, 12.4, GINGERBREAD, INK, 0.95) + circle(0, 0, 11.0, CANE_WHITE) + stripes
    coil += circle(0, 0, 2.0, COIL_RED, INK, 0.55) + circle(0, 0, 0.8, ICING)
    muzzle = rect(9.2, -2.0, 3.6, 4.0, 1.5, CANE_WHITE, INK, 0.85) + rect(11.4, -2.0, 1.6, 4.0, 0.8, COIL_RED)
    body = coil + muzzle
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(11.0, 0)
    elif pose == "smoke":
        effect = smoke_puff(11.6, -1.2) + circle(12.2, 1.4, 1.0, CANE_WHITE, opacity=0.4)
    return tower_svg(svg_group(body, f"translate({num(shift)} 0)") + effect)


def nutcracker(pose: str) -> str:
    """A nutcracker from overhead: the square biscuit he stands on, his hat as a
    disc with a gold band, his jaw as a slot, and a long thin barrel on +X.
    Compactly square about the origin so the aim sweep never tips him over."""
    jaw_gape = {"rest": 2.6, "discharge": 4.6, "smoke": 3.2}[pose]
    shift = {"rest": 0.0, "discharge": -1.6, "smoke": -0.5}[pose]
    plate = rect(-11.4, -11.4, 22.8, 22.8, 2.6, NUTCRACKER_PLATE, INK, 0.95)
    crumbs = circle(-6.6, -6.6, 1.3, GINGERBREAD_LIGHT) + circle(6.6, -6.6, 1.3, GINGERBREAD_LIGHT)
    crumbs += circle(-6.6, 6.6, 1.3, GINGERBREAD_LIGHT) + circle(6.6, 6.6, 1.3, GINGERBREAD_LIGHT)
    hat = circle(0, 0, 7.6, TOY_RED, INK, 0.95)
    hat_band = circle(0, 0, 5.2, "none", TOY_GOLD, 2.0)
    hat_crown = circle(0, 0, 3.0, TOY_RED_DARK, INK, 0.5) + circle(0, 0, 1.2, ICING)
    jaw = rect(2.2, -jaw_gape / 2, 5.2, jaw_gape, 0.8, INK)
    teeth = line(3.4, -jaw_gape / 2 + 0.5, 3.4, jaw_gape / 2 - 0.5, ICING, 0.7)
    barrel = rect(5.4, -1.4, 7.6, 2.8, 0.9, TIN_BODY, INK, 0.85)
    barrel_band = rect(7.6, -1.4, 1.0, 2.8, None, TIN_DARK)
    sight = rect(6.2, -2.0, 1.8, 4.0, 0.6, TOY_GOLD, INK, 0.5)
    turret = svg_group(barrel + barrel_band + sight, f"translate({num(shift)} 0)")
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(10.8, 0)
    elif pose == "smoke":
        effect = smoke_puff(11.0, -0.8)
    return tower_svg(plate + crumbs + hat + hat_band + hat_crown + jaw + teeth + turret + effect)


def marzipan_rosette(center_x: float, center_y: float, ring_radius: float, blob_radius: float, fill: str) -> str:
    """A piped ring of overlapping outlined blobs. Marzipan is a smooth paste, so its
    decoration is one piped rosette rather than a scatter of dots, and a ring of
    blobs reads the same at every heading. The outline is what makes it read as
    piped beads instead of a flat doily."""
    blobs = ""
    for blob_index in range(8):
        blob_angle = math.radians(blob_index * 45)
        blobs += circle(center_x + math.cos(blob_angle) * ring_radius,
                        center_y + math.sin(blob_angle) * ring_radius, blob_radius, fill, INK, 0.45)
    return blobs + circle(center_x, center_y, blob_radius * 0.7, fill, INK, 0.45)


def marzipan_mortar(pose: str) -> str:
    """A mortar from above, and only from above: the tube has to show its length and
    its bore, because a plan-view silhouette is the whole read at 27px. The bore is a
    ring around a dark cup with the shot seated in it, so the muzzle reads as a cup
    holding a ball rather than a dot stuck on a disc."""
    shift = {"rest": 0.0, "discharge": -2.6, "smoke": -0.7}[pose]
    platform = circle(0, 0, 7.2, MARZIPAN_LIGHT, INK, 0.95)
    platform += circle(0, 0, 6.1, "none", MARZIPAN_DARK, 0.9)
    platform += circle(0, 0, 4.6, MARZIPAN)
    platform += marzipan_rosette(0, 0, 3.0, 1.5, MARZIPAN_LIGHT)
    tube = rect(4.4, -2.5, 9.4, 5.0, 2.0, MARZIPAN, INK, 0.9)
    bands = rect(7.4, -3.0, 1.2, 6.0, 0.5, MARZIPAN_DARK)
    bands += rect(10.2, -3.0, 1.2, 6.0, 0.5, MARZIPAN_DARK)
    muzzle = rect(11.9, -3.2, 1.9, 6.4, 0.9, MARZIPAN_DARK, INK, 0.8)
    bore_ring = circle(12.5, 0, 1.9, "none", INK, 1.1)
    bore_cup = circle(12.5, 0, 1.45, INK)
    shot = circle(12.5, 0, 1.1, JIMMY_RED, INK, 0.45)
    body = platform + tube + bands + muzzle + bore_ring + bore_cup + shot
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(10.0, 0)
    elif pose == "smoke":
        effect = smoke_puff(11.4, -0.8) + circle(12.0, 1.2, 1.1, "#d8d4cc", opacity=0.4)
    return tower_svg(svg_group(body, f"translate({num(shift)} 0)") + effect)


def floss_lobe(center_x: float, center_y: float, radius: float, fill: str) -> str:
    return circle(center_x, center_y, radius, fill, INK, 0.8)


def cotton_candy_cloud(pose: str) -> str:
    """Floss from directly above: lobes packed radially about a small base disc, and
    the arc mark radiating on +X. The floss head over a hanging stick was the cue
    that tipped over, and the stick goes with it."""
    lobes = ""
    for lobe_degrees, lobe_fill in ((30, COTTON_CANDY), (90, COTTON_CANDY_DEEP), (150, COTTON_CANDY),
                                    (210, COTTON_CANDY), (270, COTTON_CANDY_DEEP), (330, COTTON_CANDY)):
        lobe_radians = math.radians(lobe_degrees)
        lobes += floss_lobe(math.cos(lobe_radians) * 6.2, math.sin(lobe_radians) * 6.2, 4.8, lobe_fill)
    base = circle(0, 0, 4.4, TIN_LIGHT, INK, 0.85) + circle(0, 0, 2.0, TIN_DARK)
    emitter = rect(3.2, -2.4, 5.6, 4.8, 1.8, TIN_LIGHT, INK, 0.85)
    emitter_tip = circle(8.8, 0, 2.4, TIN_LIGHT, INK, 0.8)
    reach = {"rest": 3.0, "discharge": 5.0, "smoke": 3.6}[pose]
    width = {"rest": 0.9, "discharge": 1.5, "smoke": 0.7}[pose]
    fade = {"rest": 1.0, "discharge": 1.0, "smoke": 0.55}[pose]
    fork_x = 8.8 + reach * 0.55
    tip_x = 8.8 + reach * 0.85
    zaps = path_shape(
        f"M8.8 0 L{num(fork_x)} {num(-reach * 0.5)} L{num(fork_x)} {num(reach * 0.5)}",
        "none", "#fff6b0", width, fade,
    )
    zaps += path_shape(
        f"M8.8 0 L{num(tip_x)} {num(-reach * 0.9)} L{num(tip_x)} {num(reach * 0.9)}",
        "none", COTTON_CANDY_DEEP, width * 0.6, fade * 0.85,
    )
    body = lobes + base + emitter + emitter_tip + zaps
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(10.0, 0)
    elif pose == "smoke":
        effect = smoke_puff(10.4, -1.0)
    return tower_svg(body + effect)


def peppermint_railgun(pose: str) -> str:
    """Breech and barrel from above rather than in profile: a striped tube on +X over
    a rectangular breech with candy-cane corners. The old side profile tipped, and it
    also ran 0.8 units past the +16 clip so the frame rescaled the whole sprite.
    The breech is tin rather than near-white so the whole sprite is not the same
    red-and-white peppermints as the Candy Cane Coil; the barrel keeps the stripes."""
    shift = {"rest": 0.0, "discharge": -1.6, "smoke": -0.45}[pose]
    breech = rect(-12.2, -7.0, 12.4, 14.0, 2.0, TIN_LIGHT, INK, 0.95)
    corners = ""
    for corner_x, corner_y in ((-12.2, -7.0), (-0.9, -7.0), (-12.2, 4.4), (-0.9, 4.4)):
        corners += circle(corner_x + 1.2, corner_y + 1.2, 2.0, CANE_RED)
    breech_seam = line(-10.4, 0, -1.8, 0, TIN_DARK, 0.8)
    barrel = rect(-2.2, -2.1, 15.4, 4.2, 1.4, RAILGUN_WHITE, INK, 0.9)
    stripes = path_shape("M-1.0 0 L10.4 0", "none", CANE_RED, 4.2, 0.95, "2.6 3.4")
    breech_block = rect(-2.2, -2.1, 3.2, 4.2, 1.2, CANE_RED, INK, 0.7)
    barrel_shadow = path_shape("M0.6 0 L10.4 0", "none", ICING, 1.0, 0.9)
    body = breech + corners + breech_seam + barrel + stripes + breech_block + barrel_shadow
    lance = ""
    if pose == "discharge":
        lance = polygon([(9.6, -2.2), (13.2, 0), (9.6, 2.2)], RAILGUN_WHITE, INK, 0.6)
        lance += polygon([(10.0, -1.0), (12.2, 0), (10.0, 1.0)], ICING)
    effect = ""
    if pose == "discharge":
        effect = muzzle_flash(10.8, 0)
    elif pose == "smoke":
        effect = smoke_puff(11.4, -1.0)
    return tower_svg(svg_group(body, f"translate({num(shift)} 0)") + lance + effect)


STOLLEN_TOP = "#bb9464"


def loaf_outline(half_length: float, half_width: float, bow: float) -> str:
    """A batard outline: semicircular end caps and sides bowed out along the spine by
    a control point `bow * 2` past the edge. Equal corner radii are what made the old
    slab read as a plank; a loaf has no corners at the ends and a gentle dome on top."""
    cap_center = half_length - half_width
    top = f"M{num(-cap_center)} {num(-half_width)} Q0 {num(-half_width - bow * 2)} {num(cap_center)} {num(-half_width)}"
    right_cap = f"A{num(half_width)} {num(half_width)} 0 0 1 {num(cap_center)} {num(half_width)}"
    bottom = f"Q0 {num(half_width + bow * 2)} {num(-cap_center)} {num(half_width)}"
    left_cap = f"A{num(half_width)} {num(half_width)} 0 0 1 {num(-cap_center)} {num(-half_width)} Z"
    return top + right_cap + bottom + left_cap


def stollen_dusting(half_length: float, band: float) -> str:
    """The powdered-sugar stripe as overlapping blobs along the spine with a
    palindromic radius sequence, so the band gets a soft scalloped edge while
    staying symmetric about both axes at the same time."""
    blob_count = 11
    step = half_length * 2 / (blob_count - 1)
    pattern = (1.75, 2.25, 1.55, 2.15, 1.9, 2.0, 1.9, 2.15, 1.55, 2.25, 1.75)
    blobs = ""
    for blob_index in range(blob_count):
        blob_x = -half_length + blob_index * step
        blobs += circle(blob_x, 0, pattern[blob_index] * band, ICING)
    return blobs


def stollen_bastion(pose: str) -> str:
    """The one tower with no aim: range 0 and no fixedAim means it never fires and
    holds -45 degrees all run. A loaf symmetric about BOTH axes has no rotation that
    changes how it reads, so the permanent heading is invisible. It also grows to
    nearly the whole 32-unit box, because a wall is the most-placed tower on the board."""
    swell = {"rest": 1.0, "discharge": 1.22, "smoke": 1.1}[pose]
    loaf = path_shape(loaf_outline(14.6, 6.2, 0.35), STOLLEN, INK, 1.0)
    dome = path_shape(loaf_outline(13.0, 4.7, 0.3), STOLLEN_TOP, STOLLEN_DARK, 0.6)
    icing = stollen_dusting(11.6, swell)
    icing += line(-11.6, 0, 11.6, 0, "#e6dccc", 0.6)
    sugar_scale = {"rest": 1.0, "discharge": 1.25, "smoke": 1.1}[pose]
    sugar_positions = ((-10.4, 4.2), (-7.0, 4.8), (-3.2, 4.0), (3.4, 4.7), (7.2, 4.1), (10.2, 4.5))
    sugar_sizes = (0.5, 0.8, 0.45, 0.72, 0.55, 0.66)
    sugar = ""
    for sugar_index, (sugar_x, sugar_y) in enumerate(sugar_positions):
        for mirror_x in (sugar_x, -sugar_x):
            sugar += circle(mirror_x, sugar_y, sugar_sizes[sugar_index] * sugar_scale, ICING, opacity=0.9)
            sugar += circle(mirror_x, -sugar_y, sugar_sizes[sugar_index] * sugar_scale, ICING, opacity=0.9)
    crumbs = ""
    if pose != "rest":
        crumb_radius = {"discharge": 1.3, "smoke": 1.0}[pose]
        for crumb_x in (-6.4, 6.4):
            crumbs += circle(crumb_x, -7.6, crumb_radius, STOLLEN_TOP)
            crumbs += circle(crumb_x, 7.6, crumb_radius, STOLLEN_TOP)
    return tower_svg(loaf + dome + icing + sugar + crumbs)


def jimmie_blaster(pose: str) -> str:
    """Crate from above with the jimmie spread laid across the muzzle on +X. The old
    front-facing crate put its muzzle tile behind a dark throat so the blue read as
    something floating free of the crate, and the three jimmies read as buttons."""
    shift = {"rest": 0.0, "discharge": -1.8, "smoke": -0.55}[pose]
    crate = rect(-11.4, -8.2, 14.8, 16.4, 1.8, TOY_WOOD, INK, 0.95)
    crate_side = rect(-11.4, -8.2, 3.4, 16.4, 1.8, TOY_WOOD_DARK)
    crate_light = rect(-8.4, -7.2, 10.8, 14.4, 1.2, TOY_WOOD_LIGHT, INK, 0.6)
    planks = line(-6.0, -7.2, -6.0, 7.2, TOY_WOOD_DARK, 0.8)
    planks += line(-0.4, -7.2, -0.4, 7.2, TOY_WOOD_DARK, 0.8)
    muzzle = rect(3.0, -5.0, 6.6, 10.0, 1.6, TIN_BODY, INK, 0.9)
    muzzle_bore = rect(8.2, -3.6, 1.4, 7.2, 0.6, INK)
    barrel_rim = rect(6.0, -5.6, 2.0, 11.2, 0.9, TIN_LIGHT)
    spread = circle(11.0, -3.4, 1.7, JIMMY_RED, INK, 0.6)
    spread += circle(11.8, -1.1, 1.7, JIMMY_AMBER, INK, 0.6)
    spread += circle(11.8, 1.1, 1.7, JIMMY_GREEN, INK, 0.6)
    spread += circle(11.0, 3.4, 1.7, JIMMY_BLUE, INK, 0.6)
    body = crate + crate_side + crate_light + planks + muzzle + muzzle_bore + barrel_rim + spread
    shower = ""
    if pose == "discharge":
        shower = circle(12.8, -2.2, 1.4, JIMMY_RED, INK, 0.5)
        shower += circle(13.2, 2.2, 1.4, JIMMY_BLUE, INK, 0.5)
        shower += muzzle_flash(10.6, 0)
    elif pose == "smoke":
        shower = smoke_puff(11.8, -0.8) + circle(12.4, 1.4, 1.2, "#b7b1a8", opacity=0.35)
    return tower_svg(svg_group(body, f"translate({num(shift)} 0)") + shower)


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

STRIDE_AMPLITUDE = (0.2, 0.14)
STRIDE_LAG = (0.0, 90.0)


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
        """One side's stride offset, in units. The two sides run a quarter cycle apart
        rather than in antiphase: an antiphase pair repeats after four phases and
        WALK_BOB is itself symmetric about phase 4, so the second half of the cycle came
        out byte-identical to the first."""
        if self.action != "walk":
            return 0.0
        amplitude = STRIDE_AMPLITUDE[parity % 2]
        lag = STRIDE_LAG[parity % 2]
        return amplitude * math.sin(math.radians(45.0 * self.phase - lag))


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


def stride_feet(
    pose: Pose,
    hip_front: float,
    hip_back: float,
    track: float,
    half_length: float,
    half_width: float,
    fill: str,
) -> str:
    """Feet seen from directly above: one oval on each side of the body, sliding along
    the facing axis. An elevation hangs the feet below the body and that is exactly the
    cue that tips the sprite over, so both feet ride the body's own track here and trade
    fore and aft instead of stacking one under the other."""
    feet = []
    for foot_index, (hip_x, side) in enumerate(((hip_front, 1), (hip_back, -1))):
        foot_x = hip_x + pose.gait(foot_index)
        feet.append(ellipse(foot_x, side * track, half_length, half_width, fill, INK, 0.05))
    return "".join(feet)


def mark_offset(pose: Pose, travel: float) -> float:
    """How far the +X attack mark rides out at this action phase, in units. The reaching
    limb this replaces was 0.9 to 1.1 units long, one and a half to two body widths, so it
    pushed attack ink well past the clip box and the symbol viewBox then rescaled the whole
    sprite mid-attack. A mark this size cannot leave the box."""
    if pose.action != "attack":
        return 0.0
    return pose.reach * travel


def train_wheel(center_x: float, center_y: float, radius: float, spoke_degrees: float) -> str:
    """A brass wheel with a single spoke drawn from the hub to the rim. A diameter would
    repeat after 180 degrees and hand the walk cycle four distinct frames instead of
    eight; one radius-length spoke turns a full turn per eight-frame cycle."""
    spoke_radians = math.radians(spoke_degrees)
    spoke_tip_x = center_x + math.cos(spoke_radians) * radius * 0.82
    spoke_tip_y = center_y + math.sin(spoke_radians) * radius * 0.82
    return (
        circle(center_x, center_y, radius, BRASS_DARK, INK, 0.06)
        + circle(center_x, center_y, radius * 0.3, BRASS, INK, 0.05)
        + line(center_x, center_y, spoke_tip_x, spoke_tip_y, BRASS_LIGHT, 0.045)
    )


def marble_arm(arm_radius: float, arm_angle: float, fill: str, width: float) -> str:
    """One rib of the swirl wound inside the glass, bowed the same way whichever way it
    points so the set always reads as a swirl and never as straight spokes."""
    tip_x = math.cos(arm_angle) * arm_radius
    tip_y = math.sin(arm_angle) * arm_radius
    bow = arm_radius * 0.34
    control_x = tip_x * 0.5 - math.sin(arm_angle) * bow
    control_y = tip_y * 0.5 + math.cos(arm_angle) * bow
    return path_shape(
        f"M0 0 Q{num(control_x)} {num(control_y)} {num(tip_x)} {num(tip_y)}", "none", fill, width
    )


def tin_soldier(pose: Pose) -> str:
    """A tin soldier from directly above: tin helmet disc with a dark brow chord across its
    front, the red plume crest fanned out behind it, a shoulder lobe on each side and the
    rifle on +X with a bright muzzle cap. The elevation this replaces hung the helmet at
    -y with the legs at +-y around it, so the unit fell over the moment it turned. The
    shoulders are the walk: they swing fore and aft along the facing axis, which is where a
    marching figure's arms move, and neither shoulder is a foot below the body."""
    radius_x, radius_y = squashed(0.33, 0.35, pose.squash)
    stride_front = pose.gait(0)
    stride_back = pose.gait(1)
    shoulders = ellipse(stride_front, 0.37, 0.15, 0.125, TIN_LIGHT, INK, 0.06)
    shoulders += ellipse(stride_back, -0.37, 0.15, 0.125, TIN_LIGHT, INK, 0.06)
    helmet = ellipse(0, 0, radius_x, radius_y, TIN_BODY, INK, 0.08)
    brow = path_shape(f"M{radius_x * 0.3} {num(-radius_y * 0.8)} A{num(radius_x)} "
                      f"{num(radius_y)} 0 0 1 {num(radius_x * 0.3)} {num(radius_y * 0.8)}",
                      "none", TIN_DARK, 0.06)
    crest = ellipse(-0.29, 0, 0.15, 0.095, TOY_RED, INK, 0.05)
    crest += ellipse(-0.25, 0.125, 0.105, 0.06, TOY_RED, INK, 0.05)
    crest += ellipse(-0.25, -0.125, 0.105, 0.06, TOY_RED, INK, 0.05)
    lunge = mark_offset(pose, 0.1)
    rifle = svg_group(
        rect(0.2, -0.08, 0.26, 0.16, 0.04, TIN_DARK, INK, 0.06)
        + rect(0.28, -0.085, 0.06, 0.17, 0.02, TOY_GOLD)
        + rect(0.44, -0.095, 0.17, 0.19, 0.05, ICING, INK, 0.06),
        f"translate({num(lunge)} 0)",
    )
    spark = ""
    if pose.action == "attack":
        spark = polygon(
            [(0.65 + lunge, 0.0), (0.71 + lunge, -0.06), (0.71 + lunge, 0.06)], ICING, INK, 0.04
        )
    return shoulders + helmet + brow + crest + rifle + spark


def all_aboard(pose: Pose) -> str:
    """A toy engine from above: brass body slab, boiler barrel forward with the smokebox
    as the front, four wheels down the two sides. The wheels turn a spoke per frame,
    which is the walk cycle the red side profile never had."""
    spoke_degrees = 45.0 * pose.phase + pose.reach * 40.0
    wheels = ""
    for wheel_x in (-0.28, 0.12):
        for wheel_side in (1, -1):
            wheels += train_wheel(wheel_x, wheel_side * 0.3, 0.115, spoke_degrees)
    body = rect(-0.42, -0.22, 0.66, 0.44, 0.09, BRASS, INK, 0.08)
    cab = rect(-0.42, -0.22, 0.2, 0.44, 0.07, BRASS_DARK, INK, 0.06)
    boiler = circle(0.32, 0, 0.24, BRASS_LIGHT, INK, 0.08)
    bands = line(0.24, -0.2, 0.24, 0.2, BRASS_DARK, 0.05)
    bands += line(0.42, -0.19, 0.42, 0.19, BRASS_DARK, 0.05)
    smokebox = circle(0.5, 0, 0.1, INK)
    smokebox_rim = circle(0.5, 0, 0.14, "none", BRASS_DARK, 0.05)
    puff = ""
    if pose.action == "attack":
        puff_x = 0.68 + mark_offset(pose, 0.06)
        puff = circle(puff_x, -0.11, 0.07, "#dfe6ea", opacity=0.75)
        puff += circle(puff_x, 0.11, 0.07, "#dfe6ea", opacity=0.75)
    return wheels + body + cab + boiler + bands + smokebox_rim + smokebox + puff


def grizzly_ted(pose: Pose) -> str:
    """A teddy bear from directly above: round head, the two ears set back at -X and to
    either side rather than on top, muzzle forward on +X. The elevation it replaces put
    the ears at -y, which is the one cue that cannot survive a turn."""
    radius_x, radius_y = squashed(0.44, 0.44, pose.squash)
    feet = stride_feet(pose, 0.06, -0.08, 0.42, 0.14, 0.1, TEDDY_DARK)
    ears = circle(-0.3, 0.32, 0.19, TEDDY_DARK, INK, 0.07)
    ears += circle(-0.3, -0.32, 0.19, TEDDY_DARK, INK, 0.07)
    head = ellipse(0, 0, radius_x, radius_y, TEDDY, INK, 0.1)
    muzzle = ellipse(0.3, 0, 0.26, 0.19, TEDDY_LIGHT, INK, 0.07)
    nose = circle(0.52, 0, 0.075, INK)
    claw = ""
    if pose.action == "attack":
        claw_x = 0.62 + mark_offset(pose, 0.09)
        claw = path_shape(
            f"M{num(claw_x)} -0.13 Q{num(claw_x + 0.11)} 0 {num(claw_x)} 0.13", "none", ICING, 0.05
        )
    return feet + ears + head + muzzle + nose + claw


def marbles_the_man(pose: Pose) -> str:
    """A glass marble from directly above: the swirl turns inside the sphere and carries
    the walk, and the seed pip stays put on +X because a rotating swirl cannot double as
    the facing mark."""
    radius_x, radius_y = squashed(0.53, 0.46, pose.squash)
    glass = ellipse(0, 0, radius_x, radius_y, "#8fd0e8", INK, 0.08)
    rim = ellipse(0, 0, radius_x, radius_y, "none", "#cfeef6", 0.05)
    spin = 45.0 * pose.phase + pose.reach * 40.0
    swirl = ""
    for arm_index in range(3):
        arm_angle = math.radians(spin + arm_index * 120)
        swirl += marble_arm(0.4, arm_angle, "#5c98b0", 0.065)
    swirl += marble_arm(0.24, math.radians(spin + 180), "#cfeef6", 0.05)
    pip = circle(0.33, 0, 0.115, "#2f5566", INK, 0.05)
    pip += circle(0.33, 0, 0.05, "#cfeef6")
    return glass + rim + swirl + pip


def music_box_mender(pose: Pose) -> str:
    """A music box from directly above: rose box, pinned cylinder laid across the lid,
    crank handle on +X, and a note puff circling the lid while the box rocks. The lid
    band that used to sit across the -y edge is gone, and with it any sense of a lid
    standing open. Nothing here is allowed an asymmetric note stem, so the puff is a
    symmetric three-lobe cloud rather than a written note."""
    rock = 5.0 * math.sin(math.radians(45.0 * pose.phase))
    crank_degrees = 45.0 * pose.phase + pose.reach * 90.0
    box = svg_group(
        rect(-0.46, -0.4, 0.78, 0.8, 0.12, MUSIC_ROSE, INK, 0.09)
        + rect(-0.36, -0.31, 0.58, 0.62, 0.08, MUSIC_ROSE_LIGHT, INK, 0.05)
        + rect(-0.22, -0.27, 0.14, 0.54, 0.06, MUSIC_ROSE_DARK, INK, 0.05),
        f"rotate({num(rock)} 0 0)",
    )
    for pin_y in (-0.19, -0.095, 0.0, 0.095, 0.19):
        box += circle(-0.15, pin_y, 0.035, TOY_GOLD, INK, 0.03)
    crank_radians = math.radians(crank_degrees)
    crank_tip_x = 0.36 + math.cos(crank_radians) * 0.11
    crank_tip_y = math.sin(crank_radians) * 0.11
    crank = rect(0.26, -0.045, 0.13, 0.09, 0.03, MUSIC_ROSE_DARK, INK, 0.05)
    crank += line(0.36, 0, crank_tip_x, crank_tip_y, MUSIC_ROSE_DARK, 0.05)
    crank += circle(crank_tip_x, crank_tip_y, 0.085, MUSIC_ROSE_DARK, INK, 0.05)
    crank += circle(crank_tip_x, crank_tip_y, 0.035, MUSIC_ROSE_LIGHT)
    orbit = math.radians(25.0 + 45.0 * pose.phase)
    pulse = 1.0 + 0.12 * math.sin(math.radians(45.0 * pose.phase + 20.0))
    note_x = math.cos(orbit) * 0.36 * pulse
    note_y = math.sin(orbit) * 0.25 * pulse
    note = ellipse(note_x, note_y, 0.115 * pulse, 0.085 * pulse, ICING, INK, 0.05)
    note += circle(note_x, note_y - 0.085 * pulse, 0.055 * pulse, ICING, INK, 0.04)
    note += circle(note_x, note_y + 0.085 * pulse, 0.055 * pulse, ICING, INK, 0.04)
    burst = ""
    if pose.action == "attack":
        burst_x = 0.62 + mark_offset(pose, 0.08)
        burst = ellipse(burst_x, -0.13, 0.075, 0.06, ICING, INK, 0.045)
        burst += ellipse(burst_x, 0.13, 0.075, 0.06, ICING, INK, 0.045)
    return box + crank + note + burst


def jack_in_the_box(pose: Pose) -> str:
    """The box from above: a wide red face carrying a small lid disc that turns about the
    box centre, with the star riding out along +X as it turns. Hinging the lid on the -y
    edge swung its far corner to y = -1.32 and the clip box sliced the tip off on attack
    frame 1; a disc turning about the origin cannot leave the box. The disc is kept small
    on purpose, because a lid that fills its own box reads as a record on a turntable
    rather than as a jack in a box."""
    open_amount = (0.3, 1.0, 0.5)[pose.action_phase] if pose.action == "attack" else 0.0
    lid_angle = 24.0 * math.sin(math.radians(45.0 * pose.phase)) + 55.0 * open_amount
    box = rect(-0.8, -0.7, 1.6, 1.4, 0.22, JACK_RED, INK, 0.09)
    bands = rect(-0.8, -0.27, 1.6, 0.12, 0.04, TOY_GOLD)
    bands += rect(-0.8, 0.15, 1.6, 0.12, 0.04, TOY_GOLD)
    studs = ""
    for stud_x, stud_y in ((-0.64, -0.56), (-0.64, 0.56), (0.64, -0.56), (0.64, 0.56)):
        studs += circle(stud_x, stud_y, 0.075, TOY_GOLD)
    lid = circle(0, 0, 0.34, JACK_RED_LIGHT, INK, 0.07)
    lid += rect(-0.27, -0.055, 0.54, 0.11, 0.03, TOY_GOLD, INK, 0.04)
    lid += rect(-0.055, -0.27, 0.11, 0.54, 0.03, TOY_GOLD, INK, 0.04)
    lid += circle(0, 0, 0.1, TOY_GOLD, INK, 0.05)
    lid = svg_group(lid, f"translate({num(0.06 * open_amount)} 0) rotate({num(lid_angle)})")
    star_radius = 0.58 + 0.04 * math.cos(math.radians(45.0 * pose.phase)) + 0.03 * open_amount
    star = svg_group(
        polygon(star_points(0, 0, 0.2 + 0.02 * open_amount, 0.085), TOY_GOLD, INK, 0.07),
        f"translate({num(star_radius)} 0)",
    )
    return box + bands + studs + lid + star


def paper_kite(pose: Pose) -> str:
    """A paper kite from directly above, nose forward on +X: a bellied diamond sail with the
    two spars crossing at its centre, tape patches at the nose and tail vertices, and a
    three-joint tail streaming out to -X. The elevation this replaces ran the tail to +y off
    a cross that read as a mast, and that is the one arrangement no rotation can rescue: a
    string hanging from a fixed point says the kite is suspended, and a plan view has no up.
    A kite's tail trails behind it in the air, so -X is both the correct construction and the
    rear cue a plan view can carry. The sail's four edges bow outward because a kite under
    tension bellies, and a flat rhombus that thin reads as a leaf rather than a sail. The
    flutter down the tail is the walk: every joint swings on its own quarter cycle, so the
    tip lags the root the way a real tail does."""
    half_span = 0.4
    half_length = 0.33
    edge_bow = 0.11
    reach_gain = 1.0 + 0.6 * pose.reach
    joint_x = (-0.33, -0.43, -0.53, -0.6)
    joint_lag = (0.0, 25.0, 75.0, 125.0)
    joint_amplitude = (0.0, 0.1, 0.14, 0.17)
    joints = []
    for joint_index, root_x in enumerate(joint_x):
        swing = joint_amplitude[joint_index] * reach_gain * math.sin(
            math.radians(45.0 * pose.phase + joint_lag[joint_index])
        )
        joints.append((root_x, swing))
    corners = [(half_length, 0.0), (0.0, half_span), (-half_length, 0.0), (0.0, -half_span)]
    edge_ends = ""
    for corner_index in range(4):
        start_x, start_y = corners[corner_index]
        end_x, end_y = corners[(corner_index + 1) % 4]
        edge_length = math.hypot(end_y - start_y, start_x - end_x)
        control_x = (start_x + end_x) / 2 + (end_y - start_y) / edge_length * edge_bow
        control_y = (start_y + end_y) / 2 + (start_x - end_x) / edge_length * edge_bow
        edge_ends += f"Q{num(control_x)} {num(control_y)} {num(end_x)} {num(end_y)} "
    sail = path_shape(f"M{num(corners[0][0])} {num(corners[0][1])} {edge_ends}Z", NEWSPRINT, INK, 0.1)
    spars = line(corners[0][0], 0.0, corners[2][0], 0.0, NEWSPRINT_DARK, 0.075)
    spars += line(0.0, corners[1][1], 0.0, corners[3][1], NEWSPRINT_DARK, 0.075)
    patches = polygon(
        [(half_length, 0.0), (half_length - 0.13, 0.085), (half_length - 0.13, -0.085)],
        MARZIPAN_DARK,
        INK,
        0.04,
    )
    patches += polygon(
        [(-half_length, 0.0), (-half_length + 0.11, 0.07), (-half_length + 0.11, -0.07)],
        MARZIPAN_DARK,
        INK,
        0.04,
    )
    cord = ""
    for near_joint, far_joint in zip(joints, joints[1:]):
        cord += line(near_joint[0], near_joint[1], far_joint[0], far_joint[1], INK, 0.13)
        cord += line(near_joint[0], near_joint[1], far_joint[0], far_joint[1], MARZIPAN_DARK, 0.07)
    bows = ""
    for bow_index in (1, 2, 3):
        bow_x, bow_y = joints[bow_index]
        bows += ellipse(bow_x, bow_y, 0.085, 0.055, MARZIPAN_DARK, INK, 0.045)
    dash = ""
    if pose.action == "attack":
        dash_tip_x = half_length + 0.14 + mark_offset(pose, 0.16)
        dash = polygon(
            [(dash_tip_x, 0.0), (dash_tip_x - 0.1, 0.075), (dash_tip_x - 0.1, -0.075)],
            MARZIPAN_DARK,
            INK,
            0.04,
        )
    return sail + spars + patches + cord + bows + dash


def yo_yo(pose: Pose) -> str:
    """A yo-yo towed through the air, seen from directly above: the disc on +X with its
    hub turning, the string trailing behind it to -X and ending in the finger loop. The
    elevation this replaces ran the string up to +y with the finger ball above the disc,
    which is a hanging mass and nothing else; dragging the same toy through the air puts
    the string behind it, and behind is the one rear cue a plan view carries honestly. The
    loop is a stroked ring rather than a filled dot so it stays a loop at detail size
    without costing the silhouette a whole disc at 27px. The string sway plus the turning
    hub is the walk, and squashing on the hit is what tells a drone apart from a yo-yo
    coming off a string."""
    disc_x = 0.3
    radius_x, radius_y = squashed(0.4, 0.4, pose.squash)
    well_x, well_y = squashed(0.27, 0.27, pose.squash)
    hub_x, hub_y = squashed(0.115, 0.115, pose.squash)
    spin = 45.0 * pose.phase + pose.reach * 120.0
    bow = 0.18 * math.sin(math.radians(45.0 * pose.phase + 20.0)) + 0.07 * pose.reach
    loop_x = -0.475
    loop_radius = 0.09
    anchor_x = disc_x
    mid_x = -0.28
    cord = line(anchor_x, 0.0, mid_x, bow, INK, 0.13)
    cord += line(anchor_x, 0.0, mid_x, bow, MARZIPAN_DARK, 0.07)
    cord += line(mid_x, bow, loop_x, 0.0, INK, 0.13)
    cord += line(mid_x, bow, loop_x, 0.0, MARZIPAN_DARK, 0.07)
    loop = circle(loop_x, 0.0, loop_radius, "none", MINT_LIGHT, 0.07)
    rim = ellipse(disc_x, 0.0, radius_x, radius_y, MINT, INK, 0.12)
    well = ellipse(disc_x, 0.0, well_x, well_y, MINT_DARK, INK, 0.08)
    spokes = ""
    for spoke_index in range(3):
        spoke_radians = math.radians(spin + 120.0 * spoke_index)
        spoke_outer = 0.25
        spokes += line(
            disc_x + math.cos(spoke_radians) * 0.13,
            math.sin(spoke_radians) * spoke_outer,
            disc_x + math.cos(spoke_radians) * spoke_outer,
            math.sin(spoke_radians) * spoke_outer,
            MINT_LIGHT,
            0.08,
        )
    hub = ellipse(disc_x, 0.0, hub_x, hub_y, MINT, INK, 0.065)
    axle = circle(disc_x, 0.0, 0.042, INK)
    plug = polygon(
        [(disc_x + 0.26, -0.07), (disc_x + 0.4, -0.07), (disc_x + 0.4, 0.07), (disc_x + 0.26, 0.07)],
        MINT_LIGHT,
    )
    streak = ""
    if pose.action == "attack":
        streak_x = disc_x + 0.47 + mark_offset(pose, 0.1)
        streak = ellipse(streak_x, 0.0, 0.11, 0.045, MINT_LIGHT, INK, 0.035)
    return cord + loop + rim + well + spokes + hub + axle + plug + streak


def roly_poly(pose: Pose) -> str:
    """The roly-poly from directly above: a silver shell disc carrying the stripe that goes
    around its dome, migrating from the rear of the disc to the front and back as it rolls,
    with the pole showing through whenever the stripe has rolled off it. The elevation this
    replaces banded the -y face of a bowl and set two eyes above the band, which is a face
    on the upper surface — the one cue a plan view has no room for. Both the stripe and the
    tilt turn about the sprite origin rather than about a contact point: rotating about an
    off-centre pivot is an elevation telling you which way is down. That travel plus the
    tilt is the walk."""
    shell_radius = 0.488
    wobble = math.radians(45.0 * pose.phase)
    jolt = math.radians(70.0) * pose.reach
    tilt = 14.0 * math.sin(wobble + jolt)
    band_travel = 0.26 * math.cos(wobble + jolt) + 0.09 * pose.squash
    band_half_width = 0.125 - 0.03 * pose.squash
    band_low = max(band_travel - band_half_width, -0.465)
    band_high = min(band_travel + band_half_width, 0.465)
    low_half = math.sqrt(max(shell_radius**2 - band_low**2, 0.0001))
    high_half = math.sqrt(max(shell_radius**2 - band_high**2, 0.0001))
    shell = circle(0.0, 0.0, shell_radius, PEWTER, INK, 0.11)
    dome = circle(0.0, 0.0, 0.3, PEWTER_LIGHT, INK, 0.045)
    pole = circle(0.0, 0.0, 0.105, PEWTER_DARK, INK, 0.045)
    band = path_shape(
        f"M{num(-low_half)} {num(band_low)} L{num(low_half)} {num(band_low)} "
        f"A{num(shell_radius)} {num(shell_radius)} 0 0 1 {num(high_half)} {num(band_high)} "
        f"L{num(-high_half)} {num(band_high)} "
        f"A{num(shell_radius)} {num(shell_radius)} 0 0 1 {num(-low_half)} {num(band_low)} Z",
        PEWTER_DARK,
        INK,
        0.045,
    )
    nose = svg_group(
        polygon([(0.35, -0.095), (0.47, -0.095), (0.47, 0.095), (0.35, 0.095)], PEWTER_DARK, INK, 0.04),
        f"translate({num(mark_offset(pose, 0.11))} 0)",
    )
    return svg_group(shell + dome + pole + band + nose, f"rotate({num(tilt)} 0 0)")



def mince_pie_medic(pose: Pose) -> str:
    """A mince pie from directly above: a broad mint disc with a pale lattice laid
    across it, a crumb orbiting the face, marching feet down both sides, and a pierced
    tab on +X. The lattice is symmetric about both axes and the crumb is a plain disc,
    so nothing here nominates a top; the orbit plus the stride is the walk."""
    radius_x, radius_y = squashed(0.55, 0.5, pose.squash)
    feet = stride_feet(pose, 0.12, -0.14, 0.5, 0.15, 0.1, MENDER_MINT_DARK)
    pie = ellipse(0, 0, radius_x, radius_y, MENDER_MINT, INK, 0.1)
    rim = ellipse(0, 0, radius_x, radius_y, "none", MENDER_MINT_DARK, 0.06)
    lattice = line(-0.34, -0.34, 0.34, 0.34, MENDER_MINT_LIGHT, 0.07)
    lattice += line(-0.34, 0.34, 0.34, -0.34, MENDER_MINT_LIGHT, 0.07)
    lattice += circle(0, 0, 0.09, MENDER_MINT_LIGHT, INK, 0.05)
    orbit = math.radians(25.0 + 45.0 * pose.phase)
    pulse = 1.0 + 0.12 * math.sin(math.radians(45.0 * pose.phase + 20.0))
    crumb_x = math.cos(orbit) * 0.36 * pulse
    crumb_y = math.sin(orbit) * 0.3 * pulse
    crumb = circle(crumb_x, crumb_y, 0.07 * pulse, MENDER_MINT_DARK, INK, 0.045)
    nose = svg_group(
        polygon([(0.5, -0.09), (0.64, -0.09), (0.64, 0.09), (0.5, 0.09)],
                MENDER_MINT_DARK, INK, 0.04),
        f"translate({num(mark_offset(pose, 0.08))} 0)",
    )
    burst = ""
    if pose.action == "attack":
        burst_x = 0.7 + mark_offset(pose, 0.08)
        burst = ellipse(burst_x, -0.12, 0.07, 0.055, ICING, INK, 0.04)
        burst += ellipse(burst_x, 0.12, 0.07, 0.055, ICING, INK, 0.04)
    return feet + pie + rim + lattice + crumb + nose + burst


def frost_star(pose: Pose) -> str:
    """A tree-top star dragged through the air, seen from directly above: a small
    five-point star turning about its own centre, a hub pip, and a fixed spike on +X
    that stays put while the star turns behind it. Turning about the origin cannot
    leave the clip box, and the spike is the only facing mark the drawing is allowed."""
    spin = 45.0 * pose.phase + pose.reach * 30.0
    star = svg_group(
        polygon(star_points(0, 0, 0.42, 0.18), FROST, INK, 0.07)
        + circle(0, 0, 0.12, FROST_LIGHT, INK, 0.05)
        + circle(0, 0, 0.05, FROST_DARK),
        f"rotate({num(spin)} 0 0)",
    )
    nose = polygon([(0.38, -0.06), (0.54, 0.0), (0.38, 0.06)], FROST_DARK, INK, 0.04)
    streak = ""
    if pose.action == "attack":
        streak_x = 0.6 + mark_offset(pose, 0.1)
        streak = ellipse(streak_x, 0.0, 0.1, 0.04, FROST_LIGHT, INK, 0.03)
    return star + nose + streak


def ginger_brood(pose: Pose) -> str:
    """A ginger cracker cut as a broad triangle, seen from directly above: a bellied
    sail with one spar, a cord of three bows streaming out to -X, and three pale
    brood dots trailing off the cord tip. The dots spread on the attack, which is the
    spawn pulse the broodwing carries, so no extra art is needed for it. The tail
    trails behind the sail in the air, which is the one rear cue a plan view carries
    honestly, and every joint swings on its own quarter cycle so the tip lags the root
    the way a real tail does."""
    half_span = 0.45
    half_length = 0.55
    edge_bow = 0.1
    reach_gain = 1.0 + 0.6 * pose.reach
    joint_x = (-0.35, -0.45, -0.55, -0.62)
    joint_lag = (0.0, 25.0, 75.0, 125.0)
    joint_amplitude = (0.0, 0.1, 0.14, 0.17)
    joints = []
    for joint_index, root_x in enumerate(joint_x):
        swing = joint_amplitude[joint_index] * reach_gain * math.sin(
            math.radians(45.0 * pose.phase + joint_lag[joint_index])
        )
        joints.append((root_x, swing))
    corners = [(half_length, 0.0), (-0.35, half_span), (-0.35, -half_span)]
    center_x = sum(corner[0] for corner in corners) / 3
    center_y = sum(corner[1] for corner in corners) / 3
    edge_path = ""
    for corner_index in range(3):
        start_x, start_y = corners[corner_index]
        end_x, end_y = corners[(corner_index + 1) % 3]
        mid_x, mid_y = (start_x + end_x) / 2, (start_y + end_y) / 2
        push_x, push_y = mid_x - center_x, mid_y - center_y
        push_length = math.hypot(push_x, push_y) or 1.0
        control_x = mid_x + push_x / push_length * edge_bow
        control_y = mid_y + push_y / push_length * edge_bow
        edge_path += f"Q{num(control_x)} {num(control_y)} {num(end_x)} {num(end_y)} "
    sail = path_shape(f"M{num(corners[0][0])} {num(corners[0][1])} {edge_path}Z", GINGER, INK, 0.09)
    spar = line(0.5, 0.0, -0.3, 0.0, GINGER_DARK, 0.07)
    spar += line(-0.05, 0.28, -0.05, -0.28, GINGER_DARK, 0.06)
    patch = polygon(
        [(half_length, 0.0), (half_length - 0.13, 0.085), (half_length - 0.13, -0.085)],
        GINGER_DARK,
        INK,
        0.04,
    )
    cord = ""
    for near_joint, far_joint in zip(joints, joints[1:]):
        cord += line(near_joint[0], near_joint[1], far_joint[0], far_joint[1], INK, 0.12)
        cord += line(near_joint[0], near_joint[1], far_joint[0], far_joint[1], GINGER_DARK, 0.07)
    bows = ""
    for bow_index in (1, 2, 3):
        bow_x, bow_y = joints[bow_index]
        bows += ellipse(bow_x, bow_y, 0.08, 0.05, GINGER_DARK, INK, 0.04)
    spread = pose.reach * 0.08
    dots = circle(-0.68 - spread, 0.0, 0.055, GINGER_LIGHT, INK, 0.035)
    dots += circle(-0.73 - spread, -0.06 - spread * 0.6, 0.045, GINGER_LIGHT, INK, 0.035)
    dots += circle(-0.73 - spread, 0.06 + spread * 0.6, 0.045, GINGER_LIGHT, INK, 0.035)
    dash = ""
    if pose.action == "attack":
        dash_tip_x = half_length + 0.1 + mark_offset(pose, 0.1)
        dash = polygon(
            [(dash_tip_x, 0.0), (dash_tip_x - 0.1, 0.075), (dash_tip_x - 0.1, -0.075)],
            GINGER_DARK,
            INK,
            0.04,
        )
    return sail + spar + patch + cord + bows + dots + dash


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
    "mender": mince_pie_medic,
    "skyhold": frost_star,
    "broodwing": ginger_brood,
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
    ("mender", "Mince Pie Medic", "#7ec8a8", "✛", 1.0, 0.3, 0.2),
    ("skyhold", "Frost Star", "#90b4e0", "▾", 0.8, 0.3, 0.2),
    ("broodwing", "Ginger Brood", "#d8a050", "❖", 0.9, 0.3, 0.2),
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
# Below about two units across, a mark stops being a mark once its cell lands at a
# quarter turn and reads as speckle instead, so the pebble is sized to survive that
# same rule the motif has to survive.
PEBBLE_RADIUS_RANGE = (1.1, 1.5)
PEBBLE_OPACITY_RANGE = (0.4, 0.45)
# Interior drifts stay clear of the motif margin so a drift never collides with
# an edge smear in the same tile.
DRIFT_CENTER_MARGIN = 9.0
# Three variants per kind is what all shipped themes ship; the byte budget keeps
# 45 tile images inside a theme file the renderer still loads eagerly.
TILE_BYTE_MAX = 1200

# The motif is the one thing in a tile that may not cross the cell edge: rotated
# neighbours have to meet on identical pixels, so anything with direction gives the
# quarter turn away as a seam. Its reach is measured off its own art and the legal
# placement range is derived from that, so a painter that grows cannot quietly start
# seaming without the generator refusing to write.
MOTIF_EDGE_CLEARANCE = 3.0
# A narrow size jitter across variants, which is enough that two cells of one kind do
# not read as one stamp repeated and not enough that the three variants stop matching.
MOTIF_SIZE_RANGE = (0.94, 1.06)
MOTIF_REACH_CACHE: dict[str, float] = {}


def tile_seed(region_index: int, kind_index: int, variant_index: int) -> int:
    """One deterministic seed per region, kind, and variant, so a rerun with the
    same table reproduces the same art byte for byte."""
    return 7000 + region_index * 100 + kind_index * 10 + variant_index


def ramp_extremes(motif_colors: list[str]) -> tuple[str, str]:
    """The light end and the dark end of one kind's own ramp. Painters ask for a crown
    and a trough rather than a first and a second colour, because the tables list the
    siblings in the order each hand-drawn tile happened to use them."""
    ordered = sorted(motif_colors, key=hex_luminance)
    return ordered[-1], ordered[0]


def footprint_stamps(motif_colors: list[str], size_factor: float) -> str:
    """Two boot soles pressed into packed snow, set on a stride axis. A track mark this
    size has no room for tread bars, so the pair and the lateral stride offset are what
    carry the read: one lone lozenge is a drift, and two of them side by side are not a
    walk. Painted in the lighter ramp sibling at close to full strength because the two
    are the only values the region's table carries on a path fill, and a footprint drawn
    weaker than the drifts around it is not a footprint."""
    light, _dark = ramp_extremes(motif_colors)
    across = 2.2 * size_factor
    along = 1.7 * size_factor
    return (ellipse(along, -across, 2.6 * size_factor, 1.6 * size_factor, light, opacity=0.8)
            + ellipse(along + 1.6 * size_factor, across, 2.35 * size_factor, 1.6 * size_factor,
                      light, opacity=0.72))


def snow_crystals(motif_colors: list[str], size_factor: float) -> str:
    """Two hexagonal crystals lying on fresh snow. They stay the faintest marks in the
    set, because the palest tile is the one whose job is to read as untouched ground,
    but they sit above the drift band rather than inside it."""
    _light, dark = ramp_extremes(motif_colors)
    return (polygon(star_points(-2.2 * size_factor, -2.0 * size_factor, 3.1 * size_factor,
                                1.0 * size_factor, 6), dark, opacity=0.42)
            + polygon(star_points(2.4 * size_factor, 2.3 * size_factor, 2.5 * size_factor,
                                  0.85 * size_factor, 6), dark, opacity=0.36))


def fir_crown_shadows(motif_colors: list[str], size_factor: float) -> str:
    """Round fir crowns shadowing snow: three soft discs overlapping, so the shadow edge
    scallops instead of ending. Discs are what survive a quarter turn unchanged, which
    is the whole constraint on a radial mark, and they are packed tight enough to read
    as one crown rather than as three more drifts."""
    _light, dark = ramp_extremes(motif_colors)
    radius = 2.4 * size_factor
    return (circle(-2.2 * size_factor, 0.4 * size_factor, radius, dark, opacity=0.4)
            + circle(0.6 * size_factor, -1.4 * size_factor, radius * 0.86, dark, opacity=0.36)
            + circle(1.1 * size_factor, 1.8 * size_factor, radius * 0.72, dark, opacity=0.3))


def drift_ridges(motif_colors: list[str], size_factor: float) -> str:
    """Two wind-built drift crests, a lit crown over its own shadow. They are held a full
    mark apart across the wind and matched in length, because two crests that overlap in
    the middle stop being two crests and print a leaf."""
    light, dark = ramp_extremes(motif_colors)
    return (ellipse(0, -2.6 * size_factor, 5.4 * size_factor, 1.7 * size_factor,
                    light, opacity=0.32)
            + ellipse(0.4 * size_factor, 2.6 * size_factor, 5.0 * size_factor, 1.6 * size_factor,
                      dark, opacity=0.28))


def fir_crowns(motif_colors: list[str], size_factor: float) -> str:
    """Fir crowns seen from above on the highest ground: three rounded lobes each, which
    is the one silhouette in this set that no snow drift makes. The lobes are rounded
    well past halfway out, because a crown drawn as a hard triangle reads as a shard."""
    _light, dark = ramp_extremes(motif_colors)
    return (polygon(star_points(-1.8 * size_factor, -1.6 * size_factor, 3.6 * size_factor,
                                2.4 * size_factor, 3), dark, opacity=0.6)
            + polygon(star_points(2.9 * size_factor, 2.5 * size_factor, 2.8 * size_factor,
                                  1.9 * size_factor, 3), dark, opacity=0.52))


def gravel_scatter(motif_colors: list[str], size_factor: float) -> str:
    """Gravel pressed into a dry earth track. Three loose discs read as grit where the
    same three discs tight-clustered would read as a shrub, so they are kept apart. The
    path's two ramp siblings are both within a few percent of the field fill, so the
    contrast has to come from opacity rather than from the value."""
    light, dark = ramp_extremes(motif_colors)
    return (circle(-3.0 * size_factor, -1.6 * size_factor, 2.0 * size_factor, light, opacity=0.9)
            + circle(2.8 * size_factor, 1.2 * size_factor, 2.2 * size_factor, light, opacity=0.82)
            + circle(0.2 * size_factor, 3.4 * size_factor, 1.8 * size_factor, dark, opacity=0.7))


def wind_ripples(motif_colors: list[str], size_factor: float) -> str:
    """Wind ripples in pale sand: three crests much finer than the drifts around them and
    running parallel, each offset along its own length so they never stack into one bar.
    Finer and plural is the whole difference between a ripple field and one more oval."""
    _light, dark = ramp_extremes(motif_colors)
    return (ellipse(-1.8 * size_factor, -2.8 * size_factor, 4.2 * size_factor, 1.15 * size_factor,
                    dark, opacity=0.4)
            + ellipse(0.6 * size_factor, 0.2 * size_factor, 4.6 * size_factor, 1.25 * size_factor,
                      dark, opacity=0.36)
            + ellipse(-1.2 * size_factor, 3.2 * size_factor, 3.8 * size_factor, 1.1 * size_factor,
                      dark, opacity=0.32))


# A dry-earth crack is a branching polyline: one jagged trunk with three stubs parting
# off it and a second fissure above. Stroked rather than filled, because a filled sliver
# of the ground colour is a stain again, which is the mark this band has to stop being.
CRACK_TRUNK = ((-4.8, 1.4), (-2.6, 0.0), (0.2, 1.6), (3.2, 0.4), (4.8, -1.6))
CRACK_STUBS = (((-2.6, 0.0), (-1.8, -3.4)), ((0.2, 1.6), (1.2, 4.2)), ((-0.6, 0.8), (-3.6, 3.2)))
CRACK_FISSURE = ((-0.4, 5.0), (2.6, 4.2), (4.6, 5.2))
CRACK_STROKE_WIDTH = 2.2


def polyline_data(points: tuple[tuple[float, float], ...], size_factor: float) -> str:
    scaled = [(point_x * size_factor, point_y * size_factor) for point_x, point_y in points]
    commands = [f"M{num(scaled[0][0])},{num(scaled[0][1])}"]
    commands.extend(f"L{num(point_x)},{num(point_y)}" for point_x, point_y in scaled[1:])
    return " ".join(commands)


def cracked_earth(motif_colors: list[str], size_factor: float) -> str:
    """Cracked earth: a jagged trunk with three stubs parting off it and a second
    fissure alongside. The stroke is the widest the rotation survival rule allows and
    it is worth it, because a connected fourteen unit network reads as ground where a
    scatter of thinner marks would read as the speckle the same marks become once their
    neighbours turn."""
    _light, dark = ramp_extremes(motif_colors)
    trunk = " ".join([polyline_data(CRACK_TRUNK, size_factor)]
                     + [polyline_data(stub, size_factor) for stub in CRACK_STUBS])
    return (path_shape(trunk, "none", dark, CRACK_STROKE_WIDTH * size_factor, 0.58)
            + path_shape(polyline_data(CRACK_FISSURE, size_factor), "none", dark,
                         CRACK_STROKE_WIDTH * 0.8 * size_factor, 0.4))


def olive_litter(motif_colors: list[str], size_factor: float) -> str:
    """The floor of an olive grove: leaf litter and dropped fruit lying in the grove's
    own shadow, which is the only thing a top-down grove can honestly show. The three are
    held well apart, because the same three nested into one another print a ring."""
    _light, dark = ramp_extremes(motif_colors)
    return (ellipse(-3.4 * size_factor, -2.0 * size_factor, 2.2 * size_factor, 1.5 * size_factor,
                    dark, opacity=0.58)
            + ellipse(3.2 * size_factor, -1.2 * size_factor, 1.8 * size_factor, 1.3 * size_factor,
                      dark, opacity=0.52)
            + ellipse(-0.4 * size_factor, 3.4 * size_factor, 1.6 * size_factor, 1.2 * size_factor,
                      dark, opacity=0.46))


def rock_facets(motif_colors: list[str], size_factor: float) -> str:
    """Shadowed rock coast: two straight-edged facets, one in shadow and one catching
    the light. Straight edges are the only marks in the set that no soft drift and no
    stain makes, and they are what says stone."""
    light, dark = ramp_extremes(motif_colors)
    return (polygon([(-5.3 * size_factor, -1.9 * size_factor),
                     (-0.7 * size_factor, -4.1 * size_factor),
                     (2.2 * size_factor, -0.5 * size_factor),
                     (-2.9 * size_factor, 1.9 * size_factor)], dark, opacity=0.64)
            + polygon([(1.7 * size_factor, 1.4 * size_factor),
                       (5.5 * size_factor, 0.2 * size_factor),
                       (4.8 * size_factor, 4.8 * size_factor),
                       (1.0 * size_factor, 5.0 * size_factor)], light, opacity=0.44))


def frost_grains(motif_colors: list[str], size_factor: float) -> str:
    """Frost grains in a shadowed snow track: two small hexagons in the lighter ramp
    sibling, since nothing darker than the field fill exists to be a crystal here, and
    at close to full strength because that sibling is barely a step above the fill."""
    light, _dark = ramp_extremes(motif_colors)
    return (polygon(star_points(-2.4 * size_factor, -2.0 * size_factor, 2.8 * size_factor,
                                0.9 * size_factor, 6), light, opacity=0.62)
            + polygon(star_points(2.6 * size_factor, 2.2 * size_factor, 2.2 * size_factor,
                                  0.75 * size_factor, 6), light, opacity=0.54))


def snow_star_points(motif_colors: list[str], size_factor: float) -> str:
    """Star points on the palest snow: two sparse four-point flares in the darker ramp
    sibling, which is the only direction contrast exists on a tile whose two siblings
    both sit below its own field value."""
    _light, dark = ramp_extremes(motif_colors)
    return (polygon(star_points(-2.2 * size_factor, -1.6 * size_factor, 3.0 * size_factor,
                                0.75 * size_factor, 4), dark, opacity=0.56)
            + polygon(star_points(2.6 * size_factor, 2.4 * size_factor, 2.3 * size_factor,
                                  0.6 * size_factor, 4), dark, opacity=0.46))


def sastrugi_ridges(motif_colors: list[str], size_factor: float) -> str:
    """Wind-scoured sastrugi: three short crests running parallel, which is how wind
    direction gets drawn without a single line that has to stay off the cell edge. Each
    crest is offset along its own length, so three of them never stack into one bar."""
    light, dark = ramp_extremes(motif_colors)
    return (ellipse(-1.6 * size_factor, -2.6 * size_factor, 4.4 * size_factor, 1.7 * size_factor,
                    light, opacity=0.34)
            + ellipse(0.6 * size_factor, 0.2 * size_factor, 5.0 * size_factor, 1.8 * size_factor,
                      light, opacity=0.3)
            + ellipse(-1.0 * size_factor, 3.0 * size_factor, 4.0 * size_factor, 1.6 * size_factor,
                      dark, opacity=0.28))


def hoar_frost(motif_colors: list[str], size_factor: float) -> str:
    """Rimed-over snow: one crystal with the two shadow lumps it casts. Deep blue ground
    carries almost no contrast on its own, so the lumps are what make the crystal
    legible there at all."""
    light, dark = ramp_extremes(motif_colors)
    return (polygon(star_points(-0.6 * size_factor, -0.8 * size_factor, 3.6 * size_factor,
                                1.2 * size_factor, 6), light, opacity=0.5)
            + circle(3.4 * size_factor, 2.4 * size_factor, 1.9 * size_factor, dark, opacity=0.5)
            + circle(-3.2 * size_factor, 2.6 * size_factor, 1.6 * size_factor, dark, opacity=0.44))


def candle_lights(motif_colors: list[str], size_factor: float) -> str:
    """Points of light burning on deep snow: a bright core inside a soft glow in the same
    value, because a dark halo under a bright core prints a target ring rather than a
    light. The core sits off the glow's centre for the same reason. The plan asked for
    gold candle specks here and this region's ramp carries no warm hue at all, so the
    cores are the coolest steel the palette holds and read as distant flames rather than
    as gold."""
    light, _dark = ramp_extremes(motif_colors)
    glow = 3.2 * size_factor
    lean_x = 0.8 * size_factor
    lean_y = 0.5 * size_factor
    return (circle(-2.6 * size_factor, -2.0 * size_factor, glow, light, opacity=0.32)
            + circle(-2.6 * size_factor + lean_x, -2.0 * size_factor - lean_y, 1.8 * size_factor,
                     light, opacity=0.95)
            + circle(2.4 * size_factor, 2.2 * size_factor, glow * 0.82, light, opacity=0.26)
            + circle(2.4 * size_factor - lean_x, 2.2 * size_factor + lean_y, 1.6 * size_factor,
                     light, opacity=0.9))


# One painter per mark. The keys are what a region's palette names, so the table is the
# only place a kind chooses its motif and a painter cannot drift onto the wrong ground.
MOTIF_PAINTERS: dict[str, Callable[[list[str], float], str]] = {
    "footprint_stamps": footprint_stamps,
    "snow_crystals": snow_crystals,
    "fir_crown_shadows": fir_crown_shadows,
    "drift_ridges": drift_ridges,
    "fir_crowns": fir_crowns,
    "gravel_scatter": gravel_scatter,
    "wind_ripples": wind_ripples,
    "cracked_earth": cracked_earth,
    "olive_litter": olive_litter,
    "rock_facets": rock_facets,
    "frost_grains": frost_grains,
    "snow_star_points": snow_star_points,
    "sastrugi_ridges": sastrugi_ridges,
    "hoar_frost": hoar_frost,
    "candle_lights": candle_lights,
}


def motif_reach(motif_name: str) -> float:
    """How far the motif's ink can get from its own centre, measured by stamping it dead
    centre on a probe tile and reading the ink box rather than by declaring it. That is
    what makes the edge band a rule instead of a habit: a painter that grows fails the
    placement check on the next run instead of quietly seaming a board. The stamp is
    built straight from the painter rather than through tile_motif, which asks this
    question back."""
    if motif_name not in MOTIF_REACH_CACHE:
        half = TILE_SIZE / 2
        center = num(half)
        probe = tile_svg(svg_group(
            MOTIF_PAINTERS[motif_name](["#7f7f7f", "#7f7f7f"], 1.0),
            f"rotate(0 {center} {center}) translate({center} {center})",
        ))
        low_x, low_y, high_x, high_y = frame_ink_box(probe, TILE_SIZE)
        MOTIF_REACH_CACHE[motif_name] = max(
            math.hypot(low_x - half, low_y - half), math.hypot(high_x - half, low_y - half),
            math.hypot(low_x - half, high_y - half), math.hypot(high_x - half, high_y - half),
        )
    return MOTIF_REACH_CACHE[motif_name]


def motif_center_range(motif_name: str, size_factor: float = 1.0) -> tuple[float, float]:
    """Where a motif of this size may sit so that no rotation of it reaches the cell
    edge band."""
    low = MOTIF_EDGE_CLEARANCE + motif_reach(motif_name) * size_factor
    return low, TILE_SIZE - low


def tile_motif(
    motif_name: str,
    motif_colors: list[str],
    center_x: float,
    center_y: float,
    angle_degrees: float,
    size_factor: float = 1.0,
) -> str:
    """One motif stamp, painted in local coordinates and rotated about its own centre.
    Every cell carries its tile at an arbitrary quarter turn, so the rotation has to
    live on the stamp rather than on the tile: a mark that survives 90 degrees is one
    whose silhouette does not depend on which way is up."""
    low, high = motif_center_range(motif_name, size_factor)
    if not low - 0.05 <= center_x <= high + 0.05 or not low - 0.05 <= center_y <= high + 0.05:
        raise SystemExit(
            f"tile motif {motif_name} at {num(center_x)},{num(center_y)} reaches the "
            f"{num(MOTIF_EDGE_CLEARANCE)} unit cell edge band; it must sit in "
            f"{num(low)}..{num(high)}"
        )
    return svg_group(
        MOTIF_PAINTERS[motif_name](motif_colors, size_factor),
        f"rotate({num(angle_degrees)} {num(center_x)} {num(center_y)}) "
        f"translate({num(center_x)} {num(center_y)})",
    )


def tile_variant(region_palette: dict, kind: str, variant_index: int) -> str:
    """One seeded variant in the same construction as the shipped tile: field fill,
    three interior drifts, the kind's own motif, a pebble, and three edge smears. The
    motif comes from the same painter the hand-drawn tile uses, so the three variants
    differ in where the scatter fell and in nothing else."""
    kind_index = TILE_KINDS.index(kind)
    kind_palette = region_palette["tiles"][kind]
    rng = random.Random(tile_seed(region_palette["index"], kind_index, variant_index))
    field, motif_colors = kind_palette.field_fill, kind_palette.motif_colors

    center_range = DRIFT_CENTER_MARGIN, TILE_SIZE - DRIFT_CENTER_MARGIN
    motifs = ""
    for drift_index in range(3):
        motifs += smear(
            rng.uniform(*center_range), rng.uniform(*center_range),
            rng.uniform(*kind_palette.drift_radius_x),
            rng.uniform(*kind_palette.drift_radius_y),
            rng.choice(motif_colors), rng.uniform(*INTERIOR_MOTIF_OPACITY_RANGE),
        )

    size_factor = rng.uniform(*MOTIF_SIZE_RANGE)
    motif_range = motif_center_range(kind_palette.motif, size_factor)
    motifs += tile_motif(
        kind_palette.motif, motif_colors,
        rng.uniform(*motif_range), rng.uniform(*motif_range), rng.uniform(0.0, 360.0), size_factor,
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


class TileKindPalette(NamedTuple):
    """One tile kind's variant inputs.

    `motif_colors` are the ramp siblings the motif may be painted in, so neither a seeded
    variant nor a hand-drawn tile can introduce a hue the region's own table does not
    carry, and `motif` names the mark that says what this ground is. The two radius bands
    keep a variant's drifts inside the proportions of the tile it stands in for.
    """

    field_fill: str
    motif_colors: list[str]
    drift_radius_x: tuple[float, float]
    drift_radius_y: tuple[float, float]
    motif: str


TileMotifPalette = dict[str, TileKindPalette]


def region_tile_palette(index: int, tiles: TileMotifPalette) -> dict:
    """Palette for one region's variants. The two checks here are the ones a table gets
    wrong silently: a motif name with no painter behind it would raise far from the table
    that asked for it, and a motif colour equal to the field fill paints an invisible mark
    that still costs the byte budget."""
    for kind, kind_palette in tiles.items():
        if kind_palette.motif not in MOTIF_PAINTERS:
            raise SystemExit(f"region {index} {kind}: no painter for motif {kind_palette.motif}")
        if all(color == kind_palette.field_fill for color in kind_palette.motif_colors):
            raise SystemExit(f"region {index} {kind}: every motif colour is the field fill")
    return {"index": index, "tiles": tiles}


# The settled field fills from the plan's palette table; motif hexes are ramp
# siblings read off the same table, so no tile, hand-drawn or seeded, introduces a hue
# the region does not already carry.
YULE_VALE_TILE_PALETTE = region_tile_palette(
    0,
    {
        "path": TileKindPalette("#2f3a44", ["#3d4a56", "#475665"], (5.0, 8.0), (4.0, 6.0),
                                "footprint_stamps"),
        "terrain1": TileKindPalette("#eef3f8", ["#c8d6e2", "#94a9bd"], (5.0, 11.0), (4.0, 7.0),
                                    "snow_crystals"),
        "terrain2": TileKindPalette("#c8d6e2", ["#eef3f8", "#94a9bd", "#5c7186"],
                                    (6.0, 8.0), (3.0, 8.0), "fir_crown_shadows"),
        "terrain3": TileKindPalette("#94a9bd", ["#c8d6e2", "#5c7186", "#748ba0"],
                                    (5.0, 8.0), (5.0, 8.0), "drift_ridges"),
        "terrain4": TileKindPalette("#5c7186", ["#3d4a56", "#94a9bd", "#748ba0"],
                                    (5.0, 7.0), (4.5, 7.0), "fir_crowns"),
    },
)

SUNSPICE_TILE_PALETTE = region_tile_palette(
    1,
    {
        "path": TileKindPalette("#2a2016", ["#3a2e20", "#332818"], (7.0, 11.0), (3.0, 3.4),
                                "gravel_scatter"),
        "terrain1": TileKindPalette("#e8d6ae", ["#f0e2c0", "#bd9a6b"], (3.0, 11.0), (2.8, 6.5),
                                    "wind_ripples"),
        "terrain2": TileKindPalette("#bd9a6b", ["#e8d6ae", "#a8854f", "#8a6c3f"],
                                    (2.8, 11.0), (2.6, 6.0), "cracked_earth"),
        "terrain3": TileKindPalette("#6d7a4e", ["#87945e", "#55613c"], (6.0, 9.0), (3.5, 4.5),
                                    "olive_litter"),
        "terrain4": TileKindPalette("#463c33", ["#32291f", "#5a4d40"], (4.0, 8.0), (4.0, 5.0),
                                    "rock_facets"),
    },
)

ICON_SNOWS_TILE_PALETTE = region_tile_palette(
    2,
    {
        "path": TileKindPalette("#252b3e", ["#323a50", "#3a4360"], (5.0, 8.0), (4.0, 6.0),
                                "frost_grains"),
        "terrain1": TileKindPalette("#dfe6f2", ["#a8b6cc", "#c4d0e2"], (5.0, 11.0), (4.0, 7.0),
                                    "snow_star_points"),
        "terrain2": TileKindPalette("#a8b6cc", ["#dfe6f2", "#6e7f9e", "#8fa0bc"],
                                    (6.0, 8.0), (3.0, 8.0), "sastrugi_ridges"),
        "terrain3": TileKindPalette("#6e7f9e", ["#a8b6cc", "#39435c", "#8fa0bc"],
                                    (5.0, 8.0), (5.0, 8.0), "hoar_frost"),
        "terrain4": TileKindPalette("#39435c", ["#252b3e", "#4a5570"], (5.0, 7.0), (4.5, 7.0),
                                    "candle_lights"),
    },
)


def yule_vale_tiles() -> dict[str, str]:
    # Packed snow under firs: the path is a slate track walked through tree shadow, and
    # each band of the ramp carries the mark that names it.
    path = (
        smear(12, 18, 7, 5, "#3d4a56", 0.55)
        + smear(24, 14, 6, 4.5, "#475665", 0.5)
        + smear(20, 26, 5.5, 4, "#3d4a56", 0.48)
        + tile_motif("footprint_stamps", ["#3d4a56", "#475665"], 20, 19, 32)
        + pebble(14, 24, 1.2, "#475665", 0.4)
        + smear(2.5, 10, 5.5, 4, "#3d4a56", 0.28)
        + smear(33, 22, 6, 4.5, "#475665", 0.26)
        + smear(14, 33.5, 6, 4, "#3d4a56", 0.24)
    )
    terrain1 = (
        smear(18, 16, 10, 7, "#c8d6e2", 0.42)
        + smear(12, 24, 6, 5, "#94a9bd", 0.4)
        + smear(26, 22, 5, 4, "#c8d6e2", 0.45)
        + tile_motif("snow_crystals", ["#c8d6e2", "#94a9bd"], 17, 19, 15)
        + pebble(11, 12, 1.1, "#94a9bd", 0.4)
        + smear(4, 1.5, 6, 4.5, "#c8d6e2", 0.26)
        + smear(33.5, 14, 4.5, 6, "#94a9bd", 0.28)
        + smear(1.5, 28, 5, 4, "#c8d6e2", 0.24)
    )
    terrain2 = (
        smear(15, 14, 7, 6, "#eef3f8", 0.5)
        + smear(23, 21, 6, 5, "#94a9bd", 0.52)
        + smear(13, 26, 5.5, 4, "#5c7186", 0.48)
        + tile_motif("fir_crown_shadows", ["#eef3f8", "#94a9bd", "#5c7186"], 18, 18, 0)
        + smear(27, 11, 3.5, 4, "#eef3f8", 0.4)
        + pebble(20, 29, 1.2, "#94a9bd", 0.45)
        + smear(30, 2, 5, 5, "#eef3f8", 0.26)
        + smear(2, 16, 5.5, 4, "#5c7186", 0.28)
        + smear(22, 33.5, 7, 3.5, "#94a9bd", 0.24)
    )
    terrain3 = (
        smear(17, 17, 8, 7, "#c8d6e2", 0.58)
        + smear(21, 19, 5.5, 4.5, "#5c7186", 0.6)
        + smear(14, 20, 4.5, 3.5, "#748ba0", 0.55)
        + tile_motif("drift_ridges", ["#c8d6e2", "#5c7186", "#748ba0"], 18, 19, -22)
        + smear(27, 12, 3.5, 4.5, "#5c7186", 0.42)
        + smear(9, 12, 3.5, 4, "#c8d6e2", 0.4)
        + pebble(26, 27, 1.4, "#5c7186", 0.45)
        + smear(8, 2, 5, 5, "#c8d6e2", 0.24)
        + smear(33.5, 8, 5, 4.5, "#748ba0", 0.26)
        + smear(1.5, 24, 4.5, 6, "#5c7186", 0.28)
    )
    terrain4 = (
        smear(20, 18, 8, 7, "#3d4a56", 0.58)
        + smear(16, 16, 5, 4.5, "#748ba0", 0.62)
        + smear(23, 22, 5, 4, "#94a9bd", 0.55)
        + tile_motif("fir_crowns", ["#3d4a56", "#94a9bd", "#748ba0"], 19, 18, 40)
        + smear(10, 20, 4, 5, "#748ba0", 0.45)
        + smear(28, 14, 3, 4, "#94a9bd", 0.42)
        + pebble(26, 29, 1.1, "#3d4a56", 0.48)
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
    # The hottest and most saturated of the three: pale sand, cracked earth, an olive
    # grove, then a rock coast in shadow. The motif colours are chosen against each
    # band's own field value rather than carried over from the snow regions.
    path = (
        smear(18, 16, 11, 3.2, "#3a2e20", 0.48)
        + smear(14, 24, 7, 3, "#332818", 0.55)
        + smear(26, 20, 5, 3.4, "#3a2e20", 0.45)
        + tile_motif("gravel_scatter", ["#3a2e20", "#332818"], 19, 19, 0)
        + pebble(11, 12, 1.1, "#3a2e20", 0.4)
        + smear(2, 6, 5, 3.5, "#332818", 0.28)
        + smear(33, 10, 5, 4, "#3a2e20", 0.26)
        + smear(26, 33.8, 6, 3.2, "#3a2e20", 0.24)
    )
    terrain1 = (
        smear(18, 14, 11, 3.2, "#f0e2c0", 0.5)
        + smear(16, 22, 10, 2.8, "#bd9a6b", 0.52)
        + smear(26, 18, 3, 6.5, "#f0e2c0", 0.42)
        + tile_motif("wind_ripples", ["#f0e2c0", "#bd9a6b"], 18, 18, 18)
        + pebble(12, 10, 1.0, "#bd9a6b", 0.4)
        + smear(10, 1, 7, 3.5, "#f0e2c0", 0.28)
        + smear(33.5, 20, 4, 6, "#bd9a6b", 0.26)
        + smear(2, 32, 5, 3, "#f0e2c0", 0.24)
    )
    terrain2 = (
        smear(17, 12, 10, 2.8, "#e8d6ae", 0.52)
        + smear(19, 20, 11, 3, "#a8854f", 0.58)
        + smear(12, 26, 8, 2.6, "#8a6c3f", 0.5)
        + tile_motif("cracked_earth", ["#e8d6ae", "#a8854f", "#8a6c3f"], 18, 18, -14)
        + pebble(22, 28, 1.2, "#a8854f", 0.42)
        + smear(32, 2, 5, 3.2, "#e8d6ae", 0.26)
        + smear(1.5, 18, 4.5, 3, "#8a6c3f", 0.28)
        + smear(14, 34, 8, 3, "#a8854f", 0.24)
    )
    terrain3 = (
        smear(16, 15, 9, 4.5, "#87945e", 0.55)
        + smear(22, 18, 7, 4, "#87945e", 0.5)
        + smear(14, 22, 6, 3.5, "#55613c", 0.6)
        + tile_motif("olive_litter", ["#87945e", "#55613c"], 18, 18, 55)
        + smear(26, 26, 4.5, 3, "#55613c", 0.45)
        + smear(9, 14, 3.5, 4, "#87945e", 0.4)
        + pebble(20, 28, 1.2, "#55613c", 0.42)
        + smear(3, 2, 6, 4, "#87945e", 0.26)
        + smear(33, 16, 4.5, 5, "#55613c", 0.28)
        + smear(20, 33.5, 6, 3.5, "#87945e", 0.24)
    )
    terrain4 = (
        smear(15, 14, 8, 5, "#5a4d40", 0.55)
        + smear(22, 17, 7, 4.5, "#32291f", 0.6)
        + smear(18, 23, 8, 4, "#463c33", 0.55)
        + tile_motif("rock_facets", ["#32291f", "#5a4d40"], 18, 19, -30)
        + smear(10, 24, 4, 3.5, "#5a4d40", 0.45)
        + smear(27, 24, 3.5, 4, "#32291f", 0.42)
        + pebble(12, 12, 1.1, "#32291f", 0.45)
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
    # Deep-winter snow: pale blue, steel, deep blue, then near-midnight carrying the only
    # points of light on the whole board.
    path = (
        smear(18, 16, 7, 5, "#323a50", 0.55)
        + smear(24, 22, 6, 4.5, "#3a4360", 0.5)
        + smear(14, 24, 5.5, 4, "#323a50", 0.48)
        + tile_motif("frost_grains", ["#323a50", "#3a4360"], 20, 18, 25)
        + pebble(13, 25, 1.2, "#3a4360", 0.4)
        + smear(2.5, 10, 5.5, 4, "#323a50", 0.28)
        + smear(33, 22, 6, 4.5, "#3a4360", 0.26)
        + smear(14, 33.5, 6, 4, "#323a50", 0.24)
    )
    terrain1 = (
        smear(18, 16, 10, 7, "#c4d0e2", 0.42)
        + smear(12, 24, 6, 5, "#a8b6cc", 0.4)
        + smear(26, 22, 5, 4, "#c4d0e2", 0.45)
        + tile_motif("snow_star_points", ["#a8b6cc", "#c4d0e2"], 17, 19, 12)
        + pebble(11, 12, 1.1, "#a8b6cc", 0.4)
        + smear(4, 1.5, 6, 4.5, "#c4d0e2", 0.26)
        + smear(33.5, 14, 4.5, 6, "#a8b6cc", 0.28)
        + smear(1.5, 28, 5, 4, "#c4d0e2", 0.24)
    )
    terrain2 = (
        smear(15, 14, 7, 6, "#dfe6f2", 0.5)
        + smear(23, 21, 6, 5, "#8fa0bc", 0.52)
        + smear(13, 26, 5.5, 4, "#6e7f9e", 0.48)
        + tile_motif("sastrugi_ridges", ["#dfe6f2", "#6e7f9e", "#8fa0bc"], 18, 18, 8)
        + smear(27, 11, 3.5, 4, "#dfe6f2", 0.4)
        + pebble(20, 29, 1.2, "#8fa0bc", 0.45)
        + smear(30, 2, 5, 5, "#dfe6f2", 0.26)
        + smear(2, 16, 5.5, 4, "#6e7f9e", 0.28)
        + smear(22, 33.5, 7, 3.5, "#8fa0bc", 0.24)
    )
    terrain3 = (
        smear(17, 17, 8, 7, "#a8b6cc", 0.58)
        + smear(21, 19, 5.5, 4.5, "#39435c", 0.6)
        + smear(14, 20, 4.5, 3.5, "#8fa0bc", 0.55)
        + tile_motif("hoar_frost", ["#a8b6cc", "#39435c", "#8fa0bc"], 18, 19, -18)
        + smear(27, 12, 3.5, 4.5, "#39435c", 0.42)
        + smear(9, 12, 3.5, 4, "#a8b6cc", 0.4)
        + pebble(26, 27, 1.4, "#39435c", 0.45)
        + smear(8, 2, 5, 5, "#a8b6cc", 0.24)
        + smear(33.5, 8, 5, 4.5, "#8fa0bc", 0.26)
        + smear(1.5, 24, 4.5, 6, "#39435c", 0.28)
    )
    terrain4 = (
        smear(20, 18, 8, 7, "#252b3e", 0.58)
        + smear(16, 16, 5, 4.5, "#4a5570", 0.62)
        + smear(23, 22, 5, 4, "#39435c", 0.55)
        + tile_motif("candle_lights", ["#252b3e", "#4a5570"], 18, 18, 0)
        + smear(10, 20, 4, 5, "#4a5570", 0.45)
        + smear(28, 14, 3, 4, "#39435c", 0.42)
        + pebble(26, 29, 1.1, "#252b3e", 0.48)
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
    """A beach veranda house at dusk, standing on a low bank of lit sand.

    Base art is an elevation, so light in it has to have a source the picture can point
    at. The dusk this camp used to open with was a warm disc floating in the sky above
    the roof, which has no source and reads as a solid object rather than as light. Every
    warm tone here belongs to the building instead: the film the eave throws across the
    cream wall, the open doorway, the pool the doorway throws on the deck boards, and the
    six bulbs strung between the veranda posts.
    """
    sand_lit = "#e8d6a8"
    sand_shade = "#cfae7c"
    roof_fill = "#a87c4a"
    roof_dark = "#8a6038"
    wall_warm = "#f8dcae"
    lamp = "#f6cc7a"

    # Two stacked aprons rather than one bright oval: the upper is sunlit sand, the lower
    # the shaded near edge, and the pair reads as a dune bank the house stands on instead
    # of a plate laid under it. The low-opacity shadow under the footprint lands the
    # building on that bank.
    ground = (
        ellipse(54, 70, 45, 20, sand_lit, opacity=0.7)
        + ellipse(54, 80, 40, 14, sand_shade, opacity=0.5)
        + ellipse(54, 76, 30, 5, "#8f7250", opacity=0.32)
    )

    # Overlapping canopy lobes with a lighter crown and fruit at the lower edge. One flat
    # ellipse on a straight pole was a lollipop and the fruit dots were sub-pixel.
    mango = (
        polygon([(14.4, 74), (17.6, 74), (16.8, 52), (15.2, 52)], TOY_WOOD_DARK, INK, 0.6)
        + line(16.2, 56, 12.4, 50.5, TOY_WOOD_DARK, 1.1)
        + line(16.2, 56, 20.4, 51.5, TOY_WOOD_DARK, 1.1)
        + ellipse(16, 46, 9.4, 8, "#4f8f52", INK, 0.8)
        + ellipse(11.8, 44.2, 5.2, 4.6, "#5f9f5c")
        + ellipse(20.4, 45, 5.4, 4.8, "#5f9f5c")
        + ellipse(14.6, 40.4, 5.6, 4.2, "#74b06a")
        + circle(12.4, 50.6, 1.5, JIMMY_GOLD, INK, 0.5)
        + circle(19.8, 52, 1.4, "#d8a028", INK, 0.5)
        + circle(15.2, 53.4, 1.3, CANE_RED, INK, 0.4)
    )
    olive = (
        polygon([(90.6, 74), (93.4, 74), (92.7, 52), (91.5, 52)], TOY_WOOD_DARK, INK, 0.55)
        + line(92.2, 56, 88.4, 51, TOY_WOOD_DARK, 1.0)
        + line(92.2, 56, 96.4, 51.6, TOY_WOOD_DARK, 1.0)
        + ellipse(92, 46, 7.6, 6.6, "#7d8a4e", INK, 0.75)
        + ellipse(88, 44.6, 4.6, 4, "#8d9a5a")
        + ellipse(96, 45.4, 4.8, 4.2, "#8d9a5a")
        + ellipse(90.8, 41.4, 4.4, 3.4, "#9aa668")
        + circle(89, 51.4, 1.1, "#5f6a34")
        + circle(95.4, 52.2, 1, "#5f6a34")
    )

    wall = rect(33, 44, 42, 28, 1.2, "#f0e2c0", INK, 1.2)
    # One faint warm film over the whole facade rather than a banded ramp. Stepped bands
    # put a hard horizontal edge across the wall that reads as a valance, and a strong
    # wash turns the cream wall into one yellow slab; the dusk is carried by the lit
    # doorway, the lit windows and the bulbs instead.
    wall_warmth = rect(33, 44, 42, 28, 0, wall_warm, opacity=0.16)
    door = rect(47, 53, 12, 19, 0.6, "#7a5c34", INK, 0.9)
    door_light = rect(48.8, 54.8, 8.4, 17.2, 0.3, lamp)

    # Each window is a recessed opening with lit glass and a mullion, with one shutter
    # leaf folded flat on the wall beside it. Flat blue rectangles over the wall read as
    # stickers; a leaf standing off a lit opening reads as a shutter.
    window_left = (
        rect(35.5, 53.5, 8, 9, 0.5, "#3a2a1c", INK, 0.8)
        + rect(36.7, 54.7, 5.6, 6.6, 0.3, lamp)
        + line(39.5, 54.7, 39.5, 61.3, INK, 0.6)
        + line(36.7, 58, 42.3, 58, INK, 0.6)
        + polygon([(32.6, 52.9), (35.5, 53.5), (35.5, 62.5), (32.6, 61.7)], JIMMY_BLUE, INK, 0.6)
        + line(33.2, 56.5, 34.9, 57, INK, 0.4)
        + line(33.2, 58.9, 34.9, 59.4, INK, 0.4)
    )
    window_right = (
        rect(64.5, 53.5, 8, 9, 0.5, "#3a2a1c", INK, 0.8)
        + rect(65.7, 54.7, 5.6, 6.6, 0.3, lamp)
        + line(68.5, 54.7, 68.5, 61.3, INK, 0.6)
        + line(65.7, 58, 71.3, 58, INK, 0.6)
        + polygon([(72.5, 53.5), (75.4, 52.9), (75.4, 61.7), (72.5, 62.5)], JIMMY_BLUE, INK, 0.6)
        + line(73.1, 57, 74.8, 56.5, INK, 0.4)
        + line(73.1, 59.4, 74.8, 58.9, INK, 0.4)
    )

    # A shallow gable with the far plane one tone down and batten marks down the slopes.
    # The old flat slab roof read as a table top over the house.
    roof = (
        polygon([(21, 42), (54, 28.5), (87, 42)], roof_fill, INK, 1.2)
        + polygon([(54, 30), (85.4, 42), (54, 42)], roof_dark)
        + line(38, 34.6, 38, 42, roof_dark, 0.7)
        + line(46, 30.9, 46, 42, roof_dark, 0.7)
        + line(62, 30.9, 62, 42, roof_dark, 0.7)
        + line(70, 34.6, 70, 42, roof_dark, 0.7)
        + rect(19.6, 41, 68.8, 2.2, 0.4, TOY_WOOD, INK, 0.9)
    )

    deck = (
        rect(27, 71, 54, 4.6, 0, "#d8b880")
        + line(27, 73.6, 81, 73.6, "#b09060", 0.8)
        + rect(25.4, 75.6, 57.2, 2.4, 0.4, TOY_WOOD, INK, 0.8)
    )
    deck_light = ellipse(56, 73, 8, 2.2, lamp, opacity=0.34)

    # Plate, mound, cream and fruit, stood on the deck in front of the open doorway where
    # the rail leaves a clear bay. The old two-ellipse blob was 7px of white with a pink
    # one on top and vanished into the wall behind it.
    pavlova = (
        ellipse(51, 72.4, 6.2, 2, ICING, INK, 0.5)
        + ellipse(51, 69.4, 5, 3.6, ICING, INK, 0.65)
        + ellipse(51, 68.2, 4, 2, COTTON_CANDY, None, None, 0.85)
        + circle(49, 66.6, 1.2, JIMMY_GREEN, INK, 0.45)
        + circle(53, 67, 1, CANE_RED, INK, 0.45)
    )

    # Posts from the fascia to the deck edge, and a picket rail between them: the detail
    # that says veranda. The old stubs sat below a single rail and read as a low fence.
    # The rail stops either side of the door bay so the doorway, its light and the pavlova
    # stay readable instead of sitting behind a cage.
    posts = (
        line(27.5, 43.6, 27.5, 75.6, TOY_WOOD_DARK, 1.7)
        + line(45, 43.6, 45, 75.6, TOY_WOOD_DARK, 1.7)
        + line(63, 43.6, 63, 75.6, TOY_WOOD_DARK, 1.7)
        + line(80.5, 43.6, 80.5, 75.6, TOY_WOOD_DARK, 1.7)
    )
    railing = (
        line(26, 66.4, 45, 66.4, TOY_WOOD_DARK, 1.7)
        + line(26, 71.4, 45, 71.4, TOY_WOOD_DARK, 1)
        + line(29.9, 67.25, 29.9, 70.9, TOY_WOOD_DARK, 0.9)
        + line(36.2, 67.25, 36.2, 70.9, TOY_WOOD_DARK, 0.9)
        + line(42.5, 67.25, 42.5, 70.9, TOY_WOOD_DARK, 0.9)
        + line(63, 66.4, 82, 66.4, TOY_WOOD_DARK, 1.7)
        + line(63, 71.4, 82, 71.4, TOY_WOOD_DARK, 1)
        + line(65.3, 67.25, 65.3, 70.9, TOY_WOOD_DARK, 0.9)
        + line(71.6, 67.25, 71.6, 70.9, TOY_WOOD_DARK, 0.9)
        + line(77.9, 67.25, 77.9, 70.9, TOY_WOOD_DARK, 0.9)
    )

    # The cord sags post to post instead of running one long line across the wall, and it
    # is a warm mid-brown at half alpha: full-opacity dark brown on cream was a hairline
    # crack, not a string. Each bulb carries its own halo, which is what makes the run of
    # them read as lights rather than as dots on a wire.
    cord = "".join(
        path_shape(
            f"M{anchor_x} 43.4 Q{num((anchor_x + next_anchor_x) / 2)} 48.6 {num(next_anchor_x)} 43.4",
            "none", "#8a6c4a", 0.7, 0.55,
        )
        for anchor_x, next_anchor_x in ((27.5, 45), (45, 63), (63, 80.5))
    )
    bulb_spots = ((33.3, JIMMY_GOLD), (39.2, JIMMY_RED), (50.8, JIMMY_GREEN),
                  (57.2, JIMMY_BLUE), (68.2, JIMMY_GOLD), (75.3, JIMMY_RED))
    bulbs = "".join(
        ellipse(bulb_x, 45.7, 2.2, 2.2, lamp, opacity=0.3) + circle(bulb_x, 45.7, 1.2, bulb_color)
        for bulb_x, bulb_color in bulb_spots
    )

    return base_svg(
        ground + mango + olive + wall + wall_warmth + door + door_light + window_left
        + window_right + roof + deck + deck_light + pavlova + posts + railing + cord + bulbs
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


# The hinge the lid turns on: the box's top rim, just in from its left corner. It has to
# sit on the rim rather than on the lid's own middle so the lid's near end swings down
# against the box front instead of out through the tile's left edge.
LID_HINGE_X = 10.0
LID_HINGE_Y = 16.0


def swung_lid(lid: str, degrees: float, foreshorten: float) -> str:
    """The lid opened on its hinge, tipped up and foreshortened along its length.

    Both happen at once because a hinge at the lid's left end does both: the lid tips up
    and it swings toward the camera, which shortens it. The tip alone cannot pay for a
    readable open state here, because a 26 unit plank pivoting on one end leaves the
    36x36 tile after about 20 degrees, and a <symbol> clips its overflow, so a lid at
    65 degrees used to lose 20 units of its height off the top of the tile and arrive on
    screen as an unidentifiable red sliver. Foreshortening is what buys the angle back.
    """
    return svg_group(
        lid,
        f"translate({num(LID_HINGE_X)} {num(LID_HINGE_Y)}) rotate({num(-degrees)}) "
        f"scale({num(foreshorten)} 1) translate({num(-LID_HINGE_X)} {num(-LID_HINGE_Y)})",
    )


def spawn_art() -> dict[str, str]:
    closed_lid = rect(5, 9, 26, 7, 1.2, TOY_RED, INK, 1.0) + rect(5, 9, 26, 2.2, 1.0, ICING, 0.5)
    peek = (
        circle(14, 13.5, 2.0, "#8fd0e8", INK, 0.5)
        + polygon(star_points(21, 13, 2.2, 0.9), TOY_GOLD, INK, 0.5)
    )
    closed = tile_svg(toy_box_base() + closed_lid)
    transition = tile_svg(toy_box_base() + swung_lid(closed_lid, 22.0, 1.0))
    opened = tile_svg(toy_box_base() + peek + swung_lid(closed_lid, 70.0, 0.55))
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
    """A steeple bell hanging in an open belfry.

    The old beacon was a gold disc on a post with a halo behind it, which reads as a lamp
    or a chess pawn and carries none of what makes a bell a bell: a crown to hang from,
    a waist, and a skirt that flares out over the mouth. The dark belfry recess behind it
    is what makes the brass read at 26px, where a 6 unit bell is four pixels across.
    """
    roof = polygon([(12.6, 11.4), (18, 5.2), (23.4, 11.4)], TOY_RED, INK, 0.9)
    belfry = (
        rect(13.8, 11.4, 8.4, 8.4, 0.3, "#2f261c", INK, 0.7)
        + rect(14.2, 12.4, 1.2, 6.6, 0.3, TOY_WOOD, INK, 0.5)
        + rect(20.6, 12.4, 1.2, 6.6, 0.3, TOY_WOOD, INK, 0.5)
    )
    bell = (
        circle(18, 12.4, 0.9, "none", BRASS_DARK, 0.7)
        + path_shape(
            "M17 13.4 L19 13.4 C19.8 15.2, 20.5 17.4, 20.9 19 L21.5 20.4 L14.5 20.4 "
            "L15.1 19 C15.5 17.4, 16.2 15.2, 17 13.4 Z",
            BRASS, INK, 0.9,
        )
        + line(14.5, 20.4, 21.5, 20.4, INK, 0.8)
        + circle(18, 19.2, 0.7, "#3a2e1c")
    )
    sill = rect(13, 20.2, 10, 1.8, 0.4, TOY_WOOD, INK, 0.8)
    pedestal = polygon([(15.8, 22), (20.2, 22), (19.6, 24.6), (16.4, 24.6)], TOY_WOOD_DARK, INK, 0.8)
    return site_pad() + roof + belfry + bell + sill + pedestal


def foundry_building() -> str:
    """A fudge kettle over a fire, with the fire actually visible.

    The old foundry painted its flames before the kettle body, so the kettle covered every
    one of them and the promised fire did not exist. The flames now go down first as a
    wide bed across the hearth and then come back in front as two tongues lapping the
    kettle's base, which is what puts the kettle over the fire rather than beside it.
    """
    hearth = polygon([(9, 24.6), (27, 24.6), (25.4, 20.4), (10.6, 20.4)], TOY_WOOD_DARK, INK, 0.8)
    coals = (
        ellipse(18, 22.6, 6.4, 1.4, "#a84828")
        + ellipse(18, 22.6, 3.6, 0.7, "#e8a040")
        + line(11.6, 23.4, 24, 21.6, "#6a4028", 1.5)
        + line(12.6, 21.4, 23.4, 23.8, "#6a4028", 1.5)
    )
    # A wide bed of flame, tallest at the right of the kettle so that a tongue clears the
    # kettle's shoulder instead of hiding behind it.
    flame_bed = (
        path_shape("M10.8 21.2 C9.8 18.6, 11.2 17, 12 15 C12.6 17, 13.6 18.4, 13.4 21.2 Z", "#e8722c")
        + path_shape(
            "M16.4 21.2 C15.2 18, 17 16.4, 18.4 12.4 C19.8 16.4, 20.8 18, 20.6 21.2 Z", "#ff9a3c")
        + path_shape(
            "M19.6 21.2 C18.4 17.2, 20.6 15, 22 9.6 C23.2 15, 24.4 17.2, 24 21.2 Z", "#ff9a3c")
        + path_shape("M23 21.2 C22.4 18.4, 23.8 16.6, 24.6 14 C25.2 16.8, 25.8 18.4, 26 21.2 Z",
                     "#e8722c")
    )
    kettle = (
        path_shape(
            "M14.5 19.4 C11.5 19.4, 10.4 17, 10.4 14.4 C10.4 11.6, 12.2 9.8, 14.5 9.8 "
            "C16.8 9.8, 18.6 11.6, 18.6 14.4 C18.6 17, 17.5 19.4, 14.5 19.4 Z",
            "#8a5a3a", INK, 1.0,
        )
        + path_shape("M10.4 13.6 C11.4 12.2, 12.9 11.3, 14.5 11.3 C16.1 11.3, 17.6 12.2, 18.6 13.6",
                     "none", "#5a3a22", 1.3)
        + path_shape("M18.2 13 C19.8 11.8, 21.8 11.4, 23.2 11.6 C22.4 13.2, 20.8 14.4, 18.6 14.8 Z",
                     "#8a5a3a", INK, 0.8)
        + path_shape("M12.2 11 C12.7 9.4, 13.5 8.4, 14.5 8.4 C15.5 8.4, 16.3 9.4, 16.8 11 Z",
                     "#a06a44", INK, 0.8)
        + circle(14.5, 7.9, 0.9, INK)
        + ellipse(12.6, 14.8, 1.7, 1.1, "#c89a6a", opacity=0.7)
    )
    flame_tongues = (
        path_shape("M10.6 21.6 C9.8 19.6, 11.2 18.4, 11.8 16.6 C12.6 18.6, 13.4 19.6, 13.4 21.6 Z",
                   "#ff9a3c", INK, 0.5)
        + path_shape("M17 21.8 C16.2 19.4, 18 18.2, 18.8 16 C19.6 18.4, 20.4 19.6, 20.4 21.8 Z",
                     "#ff9a3c", INK, 0.5)
    )
    return site_pad() + hearth + coals + flame_bed + kettle + flame_tongues


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
        animations = build_enemy_animations(ENEMY_DRAW[enemy_id], enemy_id)
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
        assert_declared_color_is_painted(tower_id, color, tower_images)
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
        for record_name, clip_half in (("walking", ENEMY_CLIP_HALF), ("hitReaction", ENEMY_CLIP_HALF),
                                       ("attack", ENEMY_CLIP_HALF)):
            record_images = [frame["image"] for frame in enemy[record_name]["frames"]]
            for frame_index, image in enumerate(record_images):
                assert_frame_inside_clip_box(
                    image, f"enemy {enemy_id} {record_name}#{frame_index}", clip_half)
            enemy_images.extend(record_images)
        assert_no_ground_shadow(enemy_id, enemy_images)
        assert_declared_color_is_painted(enemy_id, color, enemy_images)
        assert_walk_cycle_is_animated(enemy_id, [frame["image"] for frame in enemy["walking"]["frames"]])
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
        assert_boxed_art(spawn_image, f"spawn {spawn_name}")
    validate_site_art(theme["sites"])


def menu_sidecar_text(menu_image: str) -> str:
    """The sidecar file text, byte for byte what gen_theme_images.py's
    write_menu_background_sidecar writes. Both writers own one of the three
    sidecars, so a shared exact expression is what keeps their writes
    indistinguishable; formatting that drifts here fails
    gen_theme_images.py's own read-back on the next run."""
    return json.dumps({"menuBackground": menu_image}, indent=2, ensure_ascii=False) + "\n"


def verify_sidecar_round_trips(theme: dict) -> None:
    """Read the sidecar back off disk and confirm it equals the theme that was just
    written, rather than comparing against the file that was already there before
    this run. A pre-write comparison cannot distinguish 'unchanged' from 'stale',
    so editing the menu art made the generator refuse to write its own output."""
    with open(SIDECAR_PATH, encoding="utf-8") as sidecar_file:
        written_text = sidecar_file.read()
    if written_text != menu_sidecar_text(theme["menuBackground"]):
        raise SystemExit(f"{os.path.basename(SIDECAR_PATH)} does not round-trip the written theme")


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
    """Every coordinate in the art, ignoring the numbers inside paint values and inside
    transform attributes. A transform's arguments are not coordinates: a rotate of -70
    degrees is an angle, and reading its digits as a coordinate puts 70 past the 36 unit
    spawn tile on art that in fact swings entirely inside its box.
    """
    stripped = re.sub(r'(?:fill|stroke)="[^"]*"', "", svg)
    stripped = re.sub(r'transform="[^"]*"', "", stripped)
    return [float(value) for value in re.findall(r"\d+\.?\d*", stripped)]


def assert_boxed_art(image: str, label: str, box_size: float = TILE_SIZE) -> None:
    """Art that will be clipped must stay inside its viewBox, and it needs both checks.

    The raw coordinate scan is necessary but not sufficient: it reads the numbers without
    resolving group transforms, so a shape that leaves the box purely through a rotate()
    passes it. That is exactly how the spawn lid used to escape, hinging at its own left end
    and swinging its far corner 20 units off the top of the tile, arriving on screen as an
    unidentifiable sliver. The ink box resolves the transforms, so it is the check that
    actually catches it.
    """
    assert_paint(image, label)
    expected_view_box = f'<svg viewBox="0 0 {num(box_size)} {num(box_size)}">'
    if expected_view_box not in image:
        raise SystemExit(f"{label}: art must open with the {num(box_size)}x{num(box_size)} viewBox wrapper")
    for value in non_color_numbers(image):
        if value > box_size + 0.5:
            raise SystemExit(f"{label}: coordinate {value} runs past the {num(box_size + 0.5)} bound")
    minimum_x, minimum_y, maximum_x, maximum_y = frame_ink_box(image, box_size)
    overrun = max(-minimum_x, -minimum_y, maximum_x - box_size, maximum_y - box_size) - CLIP_SLACK
    if overrun > 0.0:
        raise SystemExit(f"{label}: ink leaves the {num(box_size)} unit box "
                          f"by {num(round(overrun, 4))} units")


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


# --- sprite ink bounds -------------------------------------------------------
#
# A rotating sprite is clipped to its own viewBox by the <use> element that draws it, so
# ink outside that box is not a smaller sprite, it is a missing sprite. These helpers
# answer one question: where does a frame's ink actually land. Group transforms are
# applied, curve bulges are resolved rather than read off the endpoints, a circle or
# ellipse is measured through the matrix instead of through the corners of its own box,
# and a stroked shape's box grows by half its stroke width.

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

TOWER_CLIP_HALF = 16.0
ENEMY_CLIP_HALF = 1.0
SPAWN_CLIP_HALF = 18.0

# Two num() roundings on one coordinate can move it 0.01, and a frame's box carries four
# of them, so this is the slack a legitimately flush frame is allowed.
CLIP_SLACK = 0.02

GROUND_SHADOW_COLOR = "#120e0c"


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


def assert_walk_cycle_is_animated(unit_id: str, frames: list[str]) -> None:
    """Every walk frame has to be its own drawing. The defect this catches was five enemies
    whose eight frames differed only by the shared bob translate, a shift of 0.04 units that
    is invisible on a 27px sprite, so byte-distinctness is the honest form of the rule and
    anything cleverer would only hide the next one."""
    distinct = len(set(frames))
    if distinct != len(frames):
        raise SystemExit(f"{unit_id}: walk cycle repeats a frame, "
                          f"{distinct} distinct of {len(frames)}")


def assert_declared_color_is_painted(unit_id: str, color: str, images: list[str]) -> None:
    """The declared color is what the minimap and the HP bar draw, so it has to be a paint
    in the sprite it belongs to or the two disagree on screen. Comparing the value as
    written is deliberate: a near miss is still a disagreement."""
    if not any(re.search(rf'(?:fill|stroke)="{re.escape(color)}"', image) for image in images):
        raise SystemExit(f"{unit_id}: declared color {color} is not painted in its own art")


def assert_no_ground_shadow(unit_id: str, images: list[str]) -> None:
    """A baked ground shadow rotates with the sprite and lands as a dark wedge hanging off
    the wrong edge, which is the one defect a player sees immediately. The renderer injects
    nothing, so the generator has to refuse to write one."""
    for image in images:
        if GROUND_SHADOW_COLOR in image:
            raise SystemExit(f"{unit_id}: frame paints the ground shadow color "
                              f"{GROUND_SHADOW_COLOR}")


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
    with open(SIDECAR_PATH, "w", encoding="utf-8") as sidecar_file:
        sidecar_file.write(menu_sidecar_text(theme["menuBackground"]))


def sheet_svg(image: str, size: float) -> str:
    return image.replace("<svg ", f'<svg width="{num(size)}" height="{num(size)}" ', 1)


ROTATION_ANGLES = (0, 45, 90, 135, 180, 225, 270, 315)
ROTATION_DETAIL_SIZE = 72
ROTATION_GAME_SIZE = 27


def rotated_sheet_svg(image: str, size: float, angle: int) -> str:
    """One sprite copy turned about its own centre, the way TowerManager and EnemyManager
    turn the live <use>. A 45-degree cell paints outside its box, so the strip's cell
    padding reserves that overhang rather than letting it collide with the next cell."""
    return image.replace(
        "<svg ",
        f'<svg width="{num(size)}" height="{num(size)}" style="transform:rotate({num(angle)}deg)" ',
        1,
    )


def rotation_cell(image: str, angle: int) -> str:
    return (f'<div class="rotcell"><div class="rotpair">'
            f'{rotated_sheet_svg(image, ROTATION_DETAIL_SIZE, angle)}'
            f'{rotated_sheet_svg(image, ROTATION_GAME_SIZE, angle)}</div>'
            f'<div class="cap">{num(angle)}°</div></div>')


def rotation_row(label: str, image: str) -> str:
    cells = "".join(rotation_cell(image, angle) for angle in ROTATION_ANGLES)
    return f'<div class="rotrow"><div class="cap" style="width:140px">{label}</div>{cells}</div>'


def rotation_strip(theme: dict) -> list[str]:
    """A row per sprite at every heading the renderer can turn it to. This is the stand-in
    for the plan-view rule in MapThemeHowTo.md: no geometric metric separates a side
    elevation from a plan view, so the check is a reviewer looking for a tipping or
    head-up read. Towers contribute their rest frame, enemies their first walking frame."""
    rows = []
    for tower_id, name, _color, _icon, _fire, _walk in TOWER_META:
        rows.append(rotation_row(name, theme["towers"][tower_id]["animation"]["frames"][0]["image"]))
    for enemy_id, name, _color, _shape, _walk, _hit, _attack in ENEMY_META:
        rows.append(rotation_row(name, theme["enemies"][enemy_id]["walking"]["frames"][0]["image"]))
    expected = len(TOWER_META) + len(ENEMY_META)
    if len(rows) != expected:
        raise SystemExit(f"rotation strip has {len(rows)} sprite rows, expected {expected}")
    return rows


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
        ".rotrow{display:flex;gap:8px;align-items:center;padding:6px 12px;flex-wrap:nowrap;}",
        ".rotcell{display:flex;flex-direction:column;align-items:center;gap:2px;padding:0 17px;}",
        ".rotpair{display:flex;align-items:center;gap:6px;}",
        ".mosaic{padding:4px 12px;}",
        ".mosaic svg{display:block;}",
        ".region-map{padding:4px 12px;}",
        ".region-map svg{display:block;width:1100px;height:700px;}",
        "</style></head><body>",
        "<h2>Rotation strip. Every sprite at 0, 45, 90, 135, 180, 225, 270 and 315, "
        f"detail at {num(ROTATION_DETAIL_SIZE)}px beside the {num(ROTATION_GAME_SIZE)}px game-size copy. "
        "The renderer turns each tower and enemy by a live angle, so a sprite that tips over or "
        "reads as a standing figure here is a side elevation, not a plan view.</h2>",
    ]
    parts.extend(rotation_strip(theme))
    parts.append("<h2>Towers at 27px and 81px</h2>")
    for tower_id, name, _color, _icon, _fire, _walk in TOWER_META:
        frames = theme["towers"][tower_id]["animation"]["frames"]
        parts.append('<div class="row">')
        parts.append(f'<div class="cap" style="width:140px">{name}</div>')
        for frame_index, frame in enumerate(frames):
            parts.append('<div class="cell">')
            parts.append(sheet_svg(frame["image"], 27))
            parts.append(sheet_svg(frame["image"], 81))
            parts.append(f'<div class="cap">f{frame_index}</div></div>')
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
    verify_sidecar_round_trips(theme)
    sheet_path = contact_sheet(theme)
    print(f"wrote {THEME_PATH}")
    print(f"wrote {SIDECAR_PATH}")
    print(f"wrote {sheet_path}")


if __name__ == "__main__":
    main()
