#!/usr/bin/env python3
"""Main menu background art for the shipped map themes.

Wide 16:9 compositions drawn with the same vocabulary as the region maps so
the main menu, theme buttons, and map select read as one family.
"""

from __future__ import annotations

import math

from region_map_art import (
    BONE_DARK,
    INK,
    SCRAP_WOOD_DARK,
    angle_arc,
    barn_house,
    circle,
    conifer_unit,
    crop_field,
    dead_tree_unit,
    ellipse,
    line,
    num,
    path_shape,
    pitched_house,
    polygon,
    rect,
    onion_dome_house,
    regular_polygon_points,
    right_angle_mark,
    sampled_wave_path,
    silo_tank,
    telegraph_pole,
    text_element,
    tractor_unit,
    windmill_unit,
    wire_run,
)

MENU_VIEW_BOX = "0 0 1600 900"
MENU_WIDTH = 1600
MENU_HEIGHT = 900

# The crescent's bite is opaque and painted in this colour, so it has to be the exact
# colour of the sky directly behind the moon: nothing else may be drawn between the base
# rect and the bite at the moon's position, or the bite shows as a second disc.
CHRITHMATH_SKY = "#161e2c"

LIGHT_STRING_SPAN_SAMPLES = 12
LIGHT_STRING_BULB_SPACING = 56.0
LIGHT_STRING_ANCHOR_CLEARANCE = 20.0
LIGHT_STRING_BULB_RADIUS = 4.2
LIGHT_STRING_BULB_GLOW_RADIUS = 11.0


def assert_menu_paint(image: str, label: str) -> None:
    if not image.startswith("<svg "):
        raise SystemExit(f"menu paint constraint failed for {label}")
    if f'viewBox="{MENU_VIEW_BOX}"' not in image:
        raise SystemExit(f"menu viewBox constraint failed for {label}")
    if "url(#" in image or "<filter" in image or "id=" in image:
        raise SystemExit(f"menu paint constraint failed for {label}")


def menu_svg_root(content: str) -> str:
    return (f'<svg viewBox="{MENU_VIEW_BOX}" '
            f'preserveAspectRatio="xMidYMid slice">{content}</svg>')


def symbol_text(x: float, y: float, entity: str, color: str, size: float,
                opacity: float) -> str:
    return text_element(x, y, entity, color, size, opacity, "middle", None, 600)


def theme_menu_background(theme_id: str) -> str:
    if theme_id == "default":
        return polymath_menu_background()
    if theme_id == "the-aftermath":
        return aftermath_menu_background()
    if theme_id == "chrithmath":
        return chrithmath_menu_background()
    raise SystemExit(f"unknown theme id: {theme_id}")


def polymath_menu_background() -> str:
    background = "#243222"
    mid = "#2f4a2f"
    light = "#366836"
    accent = "#6abf6a"
    parts = [
        rect(0, 0, MENU_WIDTH, MENU_HEIGHT, 0, background),
        ellipse(420, 280, 420, 200, mid, opacity=0.28),
        ellipse(1240, 640, 450, 210, mid, opacity=0.22),
        ellipse(1000, 450, 320, 140, light, opacity=0.14),
    ]
    for grid_x in range(100, 1501, 100):
        parts.append(line(grid_x, 24, grid_x, 876, accent, 1, 0.05))
    for grid_y in range(100, 801, 100):
        parts.append(line(24, grid_y, 1576, grid_y, accent, 1, 0.05))
    parts.append(line(60, 470, 1540, 470, accent, 1, 0.1, dash="14 12"))
    parts.append(line(780, 120, 780, 820, accent, 1, 0.1, dash="14 12"))
    parts.append(circle(620, 450, 90, "none", accent, 1.5, 0.12))
    parts.append(circle(620, 450, 150, "none", accent, 1.5, 0.1))
    parts.append(circle(620, 450, 210, "none", accent, 1.5, 0.08))
    parts.append(symbol_text(620, 450, "+", accent, 54, 0.24))
    parts.append(polygon(regular_polygon_points(250, 640, 110, 6), "none", accent, 2, 0.14))
    parts.append(polygon(regular_polygon_points(250, 640, 58, 4, -45), "none", accent, 1.2, 0.1))
    parts.append(symbol_text(250, 640, "=", accent, 44, 0.22))
    parts.append(polygon(regular_polygon_points(1330, 560, 140, 3), "none", accent, 2, 0.14))
    parts.append(path_shape(angle_arc(1330, 420, 60, 120, 34), "none", accent, 1.2, 0.14))
    parts.append(polygon(right_angle_mark(1208.76, 630, -60, 0, 16), "none", accent, 1.2, 0.14))
    parts.append(symbol_text(1330, 592, "&#215;", accent, 46, 0.22))
    parts.append(symbol_text(900, 250, "&#247;", accent, 44, 0.2))
    parts.append(symbol_text(1060, 700, "&#8722;", accent, 44, 0.2))
    parts.append(symbol_text(330, 170, "&#8800;", accent, 40, 0.2))
    parts.append(symbol_text(1520, 220, "&#177;", accent, 40, 0.2))
    parts.append(symbol_text(1460, 780, "%", accent, 40, 0.2))
    parts.append(symbol_text(980, 790, "&#189;", accent, 40, 0.2))
    return menu_svg_root("".join(parts))


def city_skyline(base_y: float, blocks: list[tuple[float, float, float]], fill: str,
                 window_color: str, lit_windows: list[tuple[float, float]]) -> str:
    parts = []
    for block_x, block_width, block_height in blocks:
        parts.append(rect(block_x, base_y - block_height, block_width, block_height, 1,
                          fill, None, None, 0.9))
    for window_x, window_y in lit_windows:
        parts.append(rect(window_x, window_y, 3.5, 4, 0.5, window_color, None, None, 0.3))
    return "".join(parts)


def rust_bloom(x: float, y: float) -> str:
    return (ellipse(x, y, 26, 16, "#8a5a3a", opacity=0.18)
            + ellipse(x + 14, y + 6, 14, 9, "#b87333", opacity=0.12)
            + ellipse(x - 12, y + 4, 10, 6, "#8a5a3a", opacity=0.14))


def quadratic_point(start: tuple[float, float], control: tuple[float, float],
                    end: tuple[float, float], t: float) -> tuple[float, float]:
    inverse = 1 - t
    x = inverse * inverse * start[0] + 2 * t * inverse * control[0] + t * t * end[0]
    y = inverse * inverse * start[1] + 2 * t * inverse * control[1] + t * t * end[1]
    return (x, y)


def aftermath_menu_background() -> str:
    road_start = (90.0, 862.0)
    road_control = (700.0, 800.0)
    road_end = (1540.0, 560.0)
    parts = [
        rect(0, 0, MENU_WIDTH, MENU_HEIGHT, 0, "#2a1c16"),
        ellipse(420, 280, 420, 200, "#4a2e1c", opacity=0.35),
        ellipse(1240, 640, 450, 210, "#4a2e1c", opacity=0.3),
    ]
    for contour_y in (180, 235, 290):
        parts.append(path_shape(sampled_wave_path(60, 1540, contour_y, 16, 420), "none",
                                "#8a5a3a", 1.2, 0.1))
    parts.append(polygon(
        "0,580 260,520 520,560 820,505 1120,560 1380,530 1600,570 1600,900 0,900",
        "#332015", None, None, 0.5,
    ))
    parts.append(city_skyline(
        560,
        [(1060, 70, 100), (1130, 55, 70), (1190, 66, 130), (1260, 60, 85), (1330, 70, 110),
         (1400, 50, 60), (1450, 66, 95), (1520, 55, 75)],
        "#1f130c", "#b87333",
        [(1078, 478), (1096, 500), (1206, 448), (1222, 486), (1348, 468), (1366, 496),
         (1466, 480), (1532, 500)],
    ))
    for bloom_x, bloom_y in ((600, 300), (1300, 380), (200, 420), (900, 480), (1450, 200)):
        parts.append(rust_bloom(bloom_x, bloom_y))
    parts.append(crop_field(60, 660, 480, 175, "#3f5230", 0.24, "#5f7c42", 14, 4))
    parts.append(barn_house(200, 700, 90, 62, "#6a3a2a", "#3a2018", INK))
    parts.append(silo_tank(310, 690, 34, 80, "#7a6a5c", "#8a7a6c", INK))
    parts.append(tractor_unit(470, 800, "#7a5a3a"))
    parts.append(windmill_unit(430, 862, 80, "#5c5248"))
    road_d = (f"M {road_start[0]} {road_start[1]} Q {road_control[0]} {road_control[1]} "
              f"{road_end[0]} {road_end[1]}")
    parts.append(path_shape(road_d, "none", "#120e0c", 34, 0.55))
    parts.append(path_shape(road_d, "none", "#2a2018", 24, 0.6))
    parts.append(path_shape(road_d, "none", BONE_DARK, 3, 0.4, dash="26 20"))
    pole_positions = []
    for t in (0.3, 0.5, 0.7, 0.85):
        pole_x, pole_y = quadratic_point(road_start, road_control, road_end, t)
        pole_positions.append((pole_x, pole_y + 16))
    for pole_x, pole_y in pole_positions:
        parts.append(telegraph_pole(pole_x, pole_y, 18, SCRAP_WOOD_DARK))
    parts.append(wire_run([(pole_x, pole_y - 14.4) for pole_x, pole_y in pole_positions],
                          "#4a4038", 0.5))
    for tree_x, tree_y, tree_height in ((700, 560, 34), (980, 548, 30), (120, 500, 30)):
        parts.append(dead_tree_unit(tree_x, tree_y, tree_height, "#4a3a2c"))
    for index in range(3):
        bird_x = 1200 + index * 22
        bird_y = 200 + (index % 2) * 8
        parts.append(polygon(
            f"{bird_x - 5},{bird_y} {bird_x},{bird_y - 4} {bird_x + 5},{bird_y}",
            "none", "#8a5a3a", 1.6, 0.5,
        ))
    return menu_svg_root("".join(parts))


def light_string(anchors: list[tuple[float, float]], sag_per_hundred: float, wire_color: str,
                 wire_opacity: float, bulb_color: str, bulb_opacity: float,
                 glow_opacity: float) -> str:
    """One continuous wire strung through every anchor, with the bulbs hanging on it.

    Each span dips below its own chord by a share of sag_per_hundred scaled to that span's
    width, so a wide gap between two houses sags further than a narrow one. Bulbs are
    stepped along the sampled wire by arc length rather than placed by hand: hand-placed
    coordinates drift off the curve the moment a span's sag is retuned, and a bulb that
    misses the wire is what made the line read as a dotted trail. A bulb that would land on
    an anchor is dropped, because a light drawn on a ridge tip reads as a chimney spark.
    """
    path_parts = [f"M {num(anchors[0][0])} {num(anchors[0][1])}"]
    wire_points = []
    for span_index in range(len(anchors) - 1):
        span_start = anchors[span_index]
        span_end = anchors[span_index + 1]
        span_sag = sag_per_hundred * abs(span_end[0] - span_start[0]) / 100.0
        span_control = ((span_start[0] + span_end[0]) / 2,
                        (span_start[1] + span_end[1]) / 2 + span_sag * 2)
        path_parts.append(f"Q {num(span_control[0])} {num(span_control[1])} "
                          f"{num(span_end[0])} {num(span_end[1])}")
        for sample_index in range(LIGHT_STRING_SPAN_SAMPLES + 1):
            wire_points.append(quadratic_point(span_start, span_control, span_end,
                                              sample_index / LIGHT_STRING_SPAN_SAMPLES))
    bulb_parts = []
    next_bulb_distance = LIGHT_STRING_BULB_SPACING / 2
    walked_distance = 0.0
    for point_index in range(1, len(wire_points)):
        previous_point = wire_points[point_index - 1]
        current_point = wire_points[point_index]
        segment_length = math.dist(previous_point, current_point)
        while walked_distance + segment_length >= next_bulb_distance:
            reached_fraction = (next_bulb_distance - walked_distance) / segment_length
            bulb_point = (previous_point[0]
                          + (current_point[0] - previous_point[0]) * reached_fraction,
                          previous_point[1]
                          + (current_point[1] - previous_point[1]) * reached_fraction)
            next_bulb_distance += LIGHT_STRING_BULB_SPACING
            if any(math.dist(bulb_point, anchor) < LIGHT_STRING_ANCHOR_CLEARANCE
                   for anchor in anchors):
                continue
            bulb_parts.append(circle(bulb_point[0], bulb_point[1], LIGHT_STRING_BULB_GLOW_RADIUS,
                                     bulb_color, opacity=glow_opacity))
            bulb_parts.append(circle(bulb_point[0], bulb_point[1], LIGHT_STRING_BULB_RADIUS,
                                     bulb_color, opacity=bulb_opacity))
        walked_distance += segment_length
    return path_shape(" ".join(path_parts), "none", wire_color, 1.3,
                      wire_opacity) + "".join(bulb_parts)


def chrithmath_menu_background() -> str:
    """Night village, weighted to the left edge with the moon high on the right, so the
    centred menu card and the world rail land on open sky and the open snow bank instead of
    on the buildings. Every fill here is either darker than the card's scrim or small enough
    to read as a point of light; the dome is the only warm mass and it is kept desaturated
    so the bulbs stay the brightest thing in the village."""
    moon_x = 1332.0
    moon_y = 196.0
    moon_radius = 64.0
    bite_x = moon_x - 30.0
    bite_y = moon_y - 20.0
    bite_radius = 74.0
    parts = [
        rect(0, 0, MENU_WIDTH, MENU_HEIGHT, 0, CHRITHMATH_SKY),
        ellipse(420, 260, 420, 200, "#22304a", opacity=0.3),
        ellipse(1240, 620, 450, 210, "#22304a", opacity=0.24),
        ellipse(820, 380, 320, 150, "#28364e", opacity=0.16),
    ]
    for star_x, star_y, star_r in (
        (180, 140, 2.4), (360, 90, 1.8), (560, 170, 2.2), (760, 110, 1.8),
        (940, 180, 2.4), (1080, 90, 1.6), (1420, 150, 2.2), (1500, 300, 1.8),
        (240, 300, 1.6), (480, 260, 1.8), (1380, 420, 1.6), (90, 420, 1.6),
    ):
        parts.append(circle(star_x, star_y, star_r, "#d8e0ec", opacity=0.7))
    parts.append(circle(moon_x, moon_y, moon_radius, "#e8e2d8", opacity=0.85))
    parts.append(circle(bite_x, bite_y, bite_radius, CHRITHMATH_SKY))
    for glow_radius, glow_opacity in ((74.0, 0.018), (102.0, 0.017), (130.0, 0.016),
                                      (158.0, 0.015), (186.0, 0.014)):
        parts.append(circle(moon_x, moon_y, glow_radius, "#e8e2d8", opacity=glow_opacity))
    for drift_x, drift_y, drift_rx, drift_ry in (
        (300, 810, 420, 90), (820, 840, 460, 100), (1350, 800, 380, 80),
    ):
        parts.append(ellipse(drift_x, drift_y, drift_rx, drift_ry, "#2c3e50", opacity=0.5))
    for fir_x, fir_y, fir_width, fir_height in (
        (1440, 780, 44, 92), (1520, 800, 38, 80), (1360, 790, 40, 84),
    ):
        parts.append(conifer_unit(fir_x, fir_y, fir_width, fir_height, "#1f322c", "#3a2a1c"))
    parts.append(onion_dome_house(96, 630, 152, 162, "#222c44", "#4a4436", INK))
    parts.append(pitched_house(272, 664, 104, 126, "#243448", "#1a2530", INK))
    parts.append(barn_house(392, 682, 116, 114, "#3a2e22", "#22180f", INK))
    parts.append(pitched_house(524, 700, 94, 108, "#2a3a4e", "#1a2530", INK))
    for window_x, window_y in (
        (170, 702), (212, 726), (338, 720), (338, 752), (398, 740), (478, 740), (582, 758),
    ):
        parts.append(rect(window_x, window_y, 20, 26, 2, "#e8b464", None, None, 0.75))
    parts.append(telegraph_pole(58, 826, 148, "#3a2a1c"))
    parts.append(telegraph_pole(666, 826, 108, "#3a2a1c"))
    parts.append(light_string(
        [(58, 678), (172, 610), (324, 662), (450, 680), (571, 698), (666, 718)], 16.0,
        "#9a8a66", 0.5, "#f4d08c", 0.85, 0.12,
    ))
    # The near fir row is drawn after the buildings on purpose: at these x positions the
    # row sits in the gaps and in front of the walls, which is the only place a fir this
    # size is not swallowed whole by the house behind it.
    for fir_x, fir_y, fir_width, fir_height in (
        (52, 866, 40, 84), (262, 858, 40, 88), (520, 862, 38, 84), (648, 872, 40, 78),
    ):
        parts.append(conifer_unit(fir_x, fir_y, fir_width, fir_height, "#1f322c", "#3a2a1c"))
    for snow_x in range(40, MENU_WIDTH, 90):
        snow_point = (snow_x + (snow_x % 37), 100 + (snow_x * 7) % 600)
        if math.dist(snow_point, (bite_x, bite_y)) < bite_radius:
            continue
        parts.append(circle(snow_point[0], snow_point[1], 2.4, "#dfe6f2", opacity=0.5))
    return menu_svg_root("".join(parts))
