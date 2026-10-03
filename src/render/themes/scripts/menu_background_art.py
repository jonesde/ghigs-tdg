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
    crop_field,
    dead_tree_unit,
    ellipse,
    line,
    path_shape,
    polygon,
    rect,
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


def menu_frame(accent: str) -> str:
    return rect(24, 24, MENU_WIDTH - 48, MENU_HEIGHT - 48, 32, "none", accent, 5, 0.35)


def symbol_text(x: float, y: float, entity: str, color: str, size: float,
                opacity: float) -> str:
    return text_element(x, y, entity, color, size, opacity, "middle", None, 600)


def theme_menu_background(theme_id: str) -> str:
    if theme_id == "default":
        return polymath_menu_background()
    if theme_id == "the-aftermath":
        return aftermath_menu_background()
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
    parts.append(menu_frame(accent))
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
    accent = "#b87333"
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
    parts.append(menu_frame(accent))
    return menu_svg_root("".join(parts))
