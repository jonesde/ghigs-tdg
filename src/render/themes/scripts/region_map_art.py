#!/usr/bin/env python3
"""Region map background art for the shipped map themes.

Each region builder returns the inline SVG string stored as the theme JSON
mapImage value. The layout constants mirror the committed mapLayout fields so
the generator scripts can write both without the values drifting apart.
"""

from __future__ import annotations

import math

MAP_VIEW_BOX = "0 0 1100 700"
MAP_WIDTH = 1100
MAP_HEIGHT = 700

INK = "#1a120e"
BONE = "#e4d3b0"
BONE_DARK = "#b7a27a"
STEEL = "#5c656e"
STEEL_DARK = "#2e353c"
STEEL_LIGHT = "#a8b0b8"
SCRAP_WOOD = "#6a4e38"
SCRAP_WOOD_DARK = "#3a2a1c"
SCRAP_WOOD_LIGHT = "#a68462"
HAZARD = "#e2c044"

VERDANT_NODES = [
    ("level", 1, 100, 240), ("level", 2, 270, 190), ("level", 3, 440, 240),
    ("level", 4, 610, 190), ("level", 5, 780, 240), ("level", 6, 950, 190),
    ("level", 7, 950, 500), ("level", 8, 780, 450), ("level", 9, 610, 500),
    ("level", 10, 440, 450), ("level", 11, 270, 500), ("level", 12, 100, 450),
    ("progressive", 1, 100, 90), ("progressive", 5, 780, 90),
    ("progressive", 9, 610, 620), ("progressive", 12, 100, 620),
]

SUNSCORCH_NODES = [
    ("level", 1, 160, 360), ("level", 2, 212, 240), ("level", 3, 355, 152),
    ("level", 4, 550, 120), ("level", 5, 745, 152), ("level", 6, 888, 240),
    ("level", 7, 940, 360), ("level", 8, 888, 480), ("level", 9, 745, 568),
    ("level", 10, 550, 600), ("level", 11, 355, 568), ("level", 12, 212, 480),
    ("progressive", 1, 45, 360), ("progressive", 5, 830, 55),
    ("progressive", 9, 850, 655), ("progressive", 12, 95, 590),
]

THORNPEAK_NODES = [
    ("level", 1, 200, 120), ("level", 2, 200, 280), ("level", 3, 200, 440),
    ("level", 4, 200, 600), ("level", 5, 480, 600), ("level", 6, 480, 440),
    ("level", 7, 480, 280), ("level", 8, 480, 120), ("level", 9, 760, 120),
    ("level", 10, 760, 280), ("level", 11, 760, 440), ("level", 12, 760, 600),
    ("progressive", 1, 60, 120), ("progressive", 5, 340, 520),
    ("progressive", 9, 900, 200), ("progressive", 12, 920, 600),
]

RUSTBLOOM_NODES = [
    ("level", 1, 90, 580), ("level", 2, 230, 500), ("level", 3, 370, 580),
    ("level", 4, 510, 500), ("level", 5, 650, 580), ("level", 6, 790, 500),
    ("level", 7, 930, 580), ("level", 8, 990, 430), ("level", 9, 850, 350),
    ("level", 10, 700, 420), ("level", 11, 560, 330), ("level", 12, 420, 240),
    ("progressive", 1, 120, 415), ("progressive", 5, 680, 260),
    ("progressive", 9, 850, 190), ("progressive", 12, 270, 130),
]

SAND_NODES = [
    ("level", 1, 100, 530), ("level", 2, 185, 350), ("level", 3, 270, 170),
    ("level", 4, 355, 350), ("level", 5, 440, 530), ("level", 6, 525, 350),
    ("level", 7, 610, 170), ("level", 8, 695, 350), ("level", 9, 780, 530),
    ("level", 10, 865, 350), ("level", 11, 950, 170), ("level", 12, 1035, 350),
    ("progressive", 1, 200, 650), ("progressive", 5, 330, 650),
    ("progressive", 9, 880, 650), ("progressive", 12, 1040, 530),
]

ASHEN_NODES = [
    ("level", 1, 100, 580), ("level", 2, 119, 473), ("level", 3, 171, 374),
    ("level", 4, 255, 293), ("level", 5, 363, 234), ("level", 6, 486, 204),
    ("level", 7, 614, 204), ("level", 8, 737, 234), ("level", 9, 845, 293),
    ("level", 10, 929, 374), ("level", 11, 981, 473), ("level", 12, 1000, 580),
    ("progressive", 1, 230, 660), ("progressive", 5, 300, 100),
    ("progressive", 9, 930, 160), ("progressive", 12, 870, 660),
]

YULE_VALE_NODES = [
    ("level", 1, 95, 600), ("level", 2, 225, 545), ("level", 3, 355, 585),
    ("level", 4, 485, 525), ("level", 5, 615, 570), ("level", 6, 745, 510),
    ("level", 7, 875, 560), ("level", 8, 975, 465), ("level", 9, 930, 350),
    ("level", 10, 800, 300), ("level", 11, 665, 350), ("level", 12, 540, 250),
    ("progressive", 1, 150, 450), ("progressive", 5, 640, 430),
    ("progressive", 9, 1010, 300), ("progressive", 12, 400, 160),
]

SUNSPICE_NODES = [
    ("level", 1, 100, 610), ("level", 2, 240, 590), ("level", 3, 380, 615),
    ("level", 4, 520, 585), ("level", 5, 660, 610), ("level", 6, 800, 575),
    ("level", 7, 930, 600), ("level", 8, 990, 480), ("level", 9, 880, 400),
    ("level", 10, 950, 300), ("level", 11, 830, 230), ("level", 12, 920, 140),
    ("progressive", 1, 180, 480), ("progressive", 5, 700, 470),
    ("progressive", 9, 780, 330), ("progressive", 12, 1040, 220),
]

ICON_SNOWS_NODES = [
    ("level", 1, 180, 560), ("level", 2, 120, 420), ("level", 3, 150, 280),
    ("level", 4, 260, 180), ("level", 5, 400, 120), ("level", 6, 550, 100),
    ("level", 7, 700, 120), ("level", 8, 840, 180), ("level", 9, 950, 280),
    ("level", 10, 980, 420), ("level", 11, 920, 560), ("level", 12, 790, 620),
    ("progressive", 1, 320, 480), ("progressive", 5, 300, 260),
    ("progressive", 9, 760, 250), ("progressive", 12, 640, 470),
]


def standard_connections() -> list[dict]:
    connections = []
    for level in range(1, 12):
        connections.append({
            "from": {"kind": "level", "level": level},
            "to": {"kind": "level", "level": level + 1},
        })
    for branch_level in (1, 5, 9, 12):
        connections.append({
            "from": {"kind": "level", "level": branch_level},
            "to": {"kind": "progressive", "level": branch_level},
        })
    return connections


def build_map_layout(nodes: list[tuple[str, int, int, int]]) -> dict:
    return {
        "viewBox": MAP_VIEW_BOX,
        "nodes": [{"kind": kind, "level": level, "x": x, "y": y} for kind, level, x, y in nodes],
        "connections": standard_connections(),
    }


POLYMATH_MAP_LAYOUTS = [
    build_map_layout(nodes) for nodes in (VERDANT_NODES, SUNSCORCH_NODES, THORNPEAK_NODES)
]
AFTERMATH_MAP_LAYOUTS = [
    build_map_layout(nodes) for nodes in (RUSTBLOOM_NODES, SAND_NODES, ASHEN_NODES)
]
CHRITHMATH_MAP_LAYOUTS = [
    build_map_layout(nodes) for nodes in (YULE_VALE_NODES, SUNSPICE_NODES, ICON_SNOWS_NODES)
]


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


def circle(cx: float, cy: float, r: float, fill: str | None = None, stroke: str | None = None,
           stroke_width: float | None = None, opacity: float | None = None,
           dash: str | None = None) -> str:
    return svg_element("circle", {
        "cx": num(cx), "cy": num(cy), "r": num(r), "fill": fill, "stroke": stroke,
        "stroke-width": num(stroke_width) if stroke_width is not None else None,
        "stroke-dasharray": dash, "opacity": num(opacity) if opacity is not None else None,
    })


def ellipse(cx: float, cy: float, rx: float, ry: float, fill: str | None = None,
            stroke: str | None = None, stroke_width: float | None = None,
            opacity: float | None = None) -> str:
    return svg_element("ellipse", {
        "cx": num(cx), "cy": num(cy), "rx": num(rx), "ry": num(ry), "fill": fill,
        "stroke": stroke,
        "stroke-width": num(stroke_width) if stroke_width is not None else None,
        "opacity": num(opacity) if opacity is not None else None,
    })


def rect(x: float, y: float, width: float, height: float, rx: float | None = None,
         fill: str | None = None, stroke: str | None = None,
         stroke_width: float | None = None, opacity: float | None = None) -> str:
    return svg_element("rect", {
        "x": num(x), "y": num(y), "width": num(width), "height": num(height),
        "rx": num(rx) if rx else None, "fill": fill, "stroke": stroke,
        "stroke-width": num(stroke_width) if stroke_width is not None else None,
        "opacity": num(opacity) if opacity is not None else None,
    })


def polygon(points: str, fill: str | None = None, stroke: str | None = None,
            stroke_width: float | None = None, opacity: float | None = None) -> str:
    return svg_element("polygon", {
        "points": points, "fill": fill, "stroke": stroke,
        "stroke-width": num(stroke_width) if stroke_width is not None else None,
        "opacity": num(opacity) if opacity is not None else None,
    })


def line(x1: float, y1: float, x2: float, y2: float, stroke: str | None = None,
         stroke_width: float | None = None, opacity: float | None = None,
         dash: str | None = None, cap: str = "round") -> str:
    return svg_element("line", {
        "x1": num(x1), "y1": num(y1), "x2": num(x2), "y2": num(y2), "stroke": stroke,
        "stroke-width": num(stroke_width) if stroke_width is not None else None,
        "stroke-dasharray": dash, "stroke-linecap": cap,
        "opacity": num(opacity) if opacity is not None else None,
    })


def polyline(points: str, stroke: str | None = None, stroke_width: float | None = None,
             opacity: float | None = None, dash: str | None = None, cap: str = "round",
             join: str = "round") -> str:
    return svg_element("polyline", {
        "points": points, "fill": "none", "stroke": stroke,
        "stroke-width": num(stroke_width) if stroke_width is not None else None,
        "stroke-dasharray": dash, "stroke-linecap": cap, "stroke-linejoin": join,
        "opacity": num(opacity) if opacity is not None else None,
    })


def path_shape(d: str, fill: str | None = None, stroke: str | None = None,
               stroke_width: float | None = None, opacity: float | None = None,
               dash: str | None = None, cap: str = "round", join: str = "round") -> str:
    return svg_element("path", {
        "d": d, "fill": fill, "stroke": stroke,
        "stroke-width": num(stroke_width) if stroke_width is not None else None,
        "stroke-dasharray": dash, "stroke-linecap": cap, "stroke-linejoin": join,
        "opacity": num(opacity) if opacity is not None else None,
    })


def text_element(x: float, y: float, content: str, fill: str, font_size: float,
                 opacity: float | None = None, anchor: str = "middle",
                 letter_spacing: float | None = None, weight: str | None = None,
                 family: str = "Arial, sans-serif") -> str:
    return svg_element("text", {
        "x": num(x), "y": num(y), "fill": fill, "font-size": num(font_size),
        "font-family": family, "text-anchor": anchor,
        "letter-spacing": num(letter_spacing) if letter_spacing else None,
        "font-weight": weight,
        "opacity": num(opacity) if opacity is not None else None,
    })[:-2] + f">{content}</text>"


def svg_root(content: str) -> str:
    return f'<svg viewBox="{MAP_VIEW_BOX}">{content}</svg>'


def assert_map_paint(image: str, label: str) -> None:
    if not image.startswith("<svg "):
        raise SystemExit(f"map paint constraint failed for {label}")
    if f'viewBox="{MAP_VIEW_BOX}"' not in image:
        raise SystemExit(f"map viewBox constraint failed for {label}")
    if "url(#" in image or "<filter" in image or "id=" in image:
        raise SystemExit(f"map paint constraint failed for {label}")


def regular_polygon_points(cx: float, cy: float, radius: float, sides: int,
                           rotation_degrees: float = -90) -> str:
    points = []
    for index in range(sides):
        angle = math.radians(rotation_degrees + index * 360 / sides)
        points.append(f"{num(cx + math.cos(angle) * radius)},{num(cy + math.sin(angle) * radius)}")
    return " ".join(points)


def angle_arc(x: float, y: float, start_degrees: float, end_degrees: float,
              radius: float) -> str:
    start_rad = math.radians(start_degrees)
    end_rad = math.radians(end_degrees)
    start_x = x + math.cos(start_rad) * radius
    start_y = y + math.sin(start_rad) * radius
    end_x = x + math.cos(end_rad) * radius
    end_y = y + math.sin(end_rad) * radius
    sweep = 1 if end_degrees > start_degrees else 0
    return (f"M {num(start_x)} {num(start_y)} "
            f"A {num(radius)} {num(radius)} 0 0 {sweep} {num(end_x)} {num(end_y)}")


def right_angle_mark(x: float, y: float, first_degrees: float, second_degrees: float,
                     size: float) -> str:
    first_rad = math.radians(first_degrees)
    second_rad = math.radians(second_degrees)
    first_x = x + math.cos(first_rad) * size
    first_y = y + math.sin(first_rad) * size
    second_x = x + math.cos(second_rad) * size
    second_y = y + math.sin(second_rad) * size
    corner_x = first_x + second_x - x
    corner_y = first_y + second_y - y
    return (f"{num(first_x)},{num(first_y)} {num(corner_x)},{num(corner_y)} "
            f"{num(second_x)},{num(second_y)}")


def sampled_wave_path(x_start: float, x_end: float, y_base: float, amplitude: float,
                      wavelength: float, samples: int = 64) -> str:
    points = []
    for index in range(samples + 1):
        fraction = index / samples
        x = x_start + (x_end - x_start) * fraction
        offset = amplitude * math.sin((x - x_start) * 2 * math.pi / wavelength)
        points.append(f"{num(x)},{num(y_base + offset)}")
    return "M " + " L ".join(points)


def golden_spiral_path(cx: float, cy: float, radius: float, total_degrees: float,
                       rotation_degrees: float, samples: int = 60) -> str:
    points = []
    growth = math.pow(1.618, 1 / 90)
    for index in range(samples + 1):
        fraction = index / samples
        degrees = rotation_degrees + total_degrees * fraction
        spiral_radius = radius * math.pow(growth, total_degrees * fraction)
        angle = math.radians(degrees)
        points.append(f"{num(cx + math.cos(angle) * spiral_radius)},{num(cy + math.sin(angle) * spiral_radius)}")
    return "M " + " L ".join(points)


def scatter_offsets(count: int, radius: float) -> list[tuple[float, float]]:
    offsets = []
    golden_angle = math.pi * (3 - math.sqrt(5))
    for index in range(count):
        angle = index * golden_angle
        distance = radius * math.sqrt((index + 0.5) / count)
        offsets.append((math.cos(angle) * distance, math.sin(angle) * distance))
    return offsets


def region_frame(accent: str) -> str:
    return rect(16, 16, MAP_WIDTH - 32, MAP_HEIGHT - 32, 24, "none", accent, 4, 0.35)


def symbol_text(x: float, y: float, entity: str, color: str, size: float,
                opacity: float) -> str:
    return text_element(x, y, entity, color, size, opacity, "middle", None, 600)


def pitched_house(x: float, y: float, width: float, height: float, wall: str,
                  roof_color: str, outline: str, opacity: float | None = None) -> str:
    body_top = y + height * 0.42
    body = rect(x, body_top, width, height * 0.58, 0, wall, outline, 1.1, opacity)
    roof = polygon(
        f"{num(x - 2)},{num(body_top + 1)} {num(x + width * 0.5)},{num(y)} "
        f"{num(x + width + 2)},{num(body_top + 1)}",
        roof_color, outline, 1.1, opacity,
    )
    door = rect(x + width * 0.4, y + height * 0.62, width * 0.2, height * 0.38, 0,
                outline, None, None, opacity)
    window = rect(x + width * 0.14, body_top + height * 0.08, width * 0.18,
                  height * 0.16, 0, BONE_DARK, None, None, opacity)
    return body + roof + door + window


def city_block(x: float, y: float, width: float, height: float, wall: str,
               outline: str, window: str, columns: int, rows: int,
               opacity: float | None = None) -> str:
    parts = [rect(x, y, width, height, 1.5, wall, outline, 1.1, opacity)]
    cell_width = width / columns
    cell_height = height / rows
    for row in range(rows):
        for column in range(columns):
            window_x = x + cell_width * (column + 0.26)
            window_y = y + cell_height * (row + 0.3)
            parts.append(rect(window_x, window_y, cell_width * 0.48, cell_height * 0.4,
                              0, window, None, None, opacity))
    return "".join(parts)


def barn_house(x: float, y: float, width: float, height: float, wall: str,
               roof_color: str, outline: str, opacity: float | None = None) -> str:
    roof_height = height * 0.45
    body = rect(x, y + roof_height, width, height - roof_height, 0, wall, outline, 1.1, opacity)
    roof = polygon(
        f"{num(x - 2)},{num(y + roof_height)} {num(x + width * 0.22)},{num(y + roof_height * 0.3)} "
        f"{num(x + width * 0.5)},{num(y)} {num(x + width * 0.78)},{num(y + roof_height * 0.3)} "
        f"{num(x + width + 2)},{num(y + roof_height)}",
        roof_color, outline, 1.1, opacity,
    )
    door = rect(x + width * 0.32, y + height * 0.55, width * 0.36, height * 0.45, 0,
                outline, None, None, opacity)
    loft = circle(x + width * 0.5, y + roof_height + height * 0.12, 2.4, outline,
                  None, None, opacity)
    return body + roof + door + loft


def silo_tank(x: float, y: float, width: float, height: float, body: str, dome: str,
              outline: str, opacity: float | None = None) -> str:
    cylinder = rect(x, y + width * 0.4, width, height - width * 0.4, 0, body, outline, 1.0, opacity)
    cap = ellipse(x + width / 2, y + width * 0.42, width * 0.5, width * 0.42, dome,
                  outline, 1.0, opacity)
    band_one = line(x, y + height * 0.45, x + width, y + height * 0.45, outline, 0.8, opacity)
    band_two = line(x, y + height * 0.72, x + width, y + height * 0.72, outline, 0.8, opacity)
    return cylinder + cap + band_one + band_two


def tractor_unit(x: float, y: float, color: str) -> str:
    return (rect(x, y, 30, 14, 2, color, INK, 1.0)
            + circle(x + 6, y + 18, 8, "#3a2a1c", INK, 1.0)
            + circle(x + 26, y + 20, 6, "#3a2a1c", INK, 1.0)
            + rect(x + 20, y - 10, 10, 12, 1, color, INK, 1.0))


def windmill_unit(cx: float, base_y: float, height: float, color: str,
                  opacity: float | None = None) -> str:
    half = height * 0.18
    hub_y = base_y - height
    leg_one = line(cx - half, base_y, cx, hub_y, color, 2.2, opacity)
    leg_two = line(cx + half, base_y, cx, hub_y, color, 2.2, opacity)
    brace = line(cx - half * 0.6, base_y - height * 0.4, cx + half * 0.6,
                 base_y - height * 0.4, color, 1.4, opacity)
    hub = circle(cx, hub_y, 2.6, color, INK, 0.8, opacity)
    blades = []
    for angle in (45, 135, 225, 315):
        blade_rad = math.radians(angle)
        blade_length = height * 0.42
        blades.append(line(cx, hub_y, cx + math.cos(blade_rad) * blade_length,
                           hub_y + math.sin(blade_rad) * blade_length, color, 1.8, opacity))
    tail = line(cx + 2, hub_y + 3, cx + height * 0.2, hub_y + height * 0.16, color, 1.2, opacity)
    return leg_one + leg_two + brace + hub + "".join(blades) + tail


def windpump_unit(cx: float, base_y: float, height: float, color: str,
                  opacity: float | None = None) -> str:
    half = height * 0.2
    hub_y = base_y - height
    leg_one = line(cx - half, base_y, cx, hub_y, color, 2.0, opacity)
    leg_two = line(cx + half, base_y, cx, hub_y, color, 2.0, opacity)
    bar_one = line(cx - half * 0.66, base_y - height * 0.33, cx + half * 0.66,
                   base_y - height * 0.33, color, 1.2, opacity)
    bar_two = line(cx - half * 0.33, base_y - height * 0.66, cx + half * 0.33,
                   base_y - height * 0.66, color, 1.2, opacity)
    rotor = circle(cx, hub_y, height * 0.15, "none", color, 1.4, opacity)
    blades = []
    for angle in (20, 110, 200, 290):
        blade_rad = math.radians(angle)
        blade_length = height * 0.3
        blades.append(line(cx, hub_y, cx + math.cos(blade_rad) * blade_length,
                           hub_y + math.sin(blade_rad) * blade_length, color, 1.5, opacity))
    return leg_one + leg_two + bar_one + bar_two + rotor + "".join(blades)


def water_tank_unit(cx: float, base_y: float, width: float, height: float, color: str,
                    outline: str, opacity: float | None = None) -> str:
    leg_top = base_y - height * 0.55
    leg_one = line(cx - width * 0.4, base_y, cx - width * 0.18, leg_top, outline, 1.6, opacity)
    leg_two = line(cx + width * 0.4, base_y, cx + width * 0.18, leg_top, outline, 1.6, opacity)
    tank = rect(cx - width / 2, base_y - height, width, height * 0.45, 2, color,
                outline, 1.1, opacity)
    roof = polygon(
        f"{num(cx - width * 0.55)},{num(base_y - height)} {num(cx)},{num(base_y - height - width * 0.3)} "
        f"{num(cx + width * 0.55)},{num(base_y - height)}",
        color, outline, 1.1, opacity,
    )
    band = line(cx - width / 2, base_y - height * 0.7, cx + width / 2, base_y - height * 0.7,
                outline, 0.9, opacity)
    return leg_one + leg_two + tank + roof + band


def church_unit(x: float, y: float, width: float, height: float, wall: str,
                roof_color: str, outline: str, opacity: float | None = None) -> str:
    cross_x = x + width * 0.76
    cross = (line(cross_x, y, cross_x, y + 5, outline, 1.2, opacity)
             + line(cross_x - 2.5, y + 1.5, cross_x + 2.5, y + 1.5, outline, 1.2, opacity))
    spire = polygon(
        f"{num(x + width * 0.6)},{num(y + height * 0.22)} {num(cross_x)},{num(y + 5)} "
        f"{num(x + width * 0.92)},{num(y + height * 0.22)}",
        roof_color, outline, 1.1, opacity,
    )
    tower = rect(x + width * 0.6, y + height * 0.22, width * 0.32, height * 0.4, 0,
                 wall, outline, 1.1, opacity)
    nave_roof = polygon(
        f"{num(x)},{num(y + height * 0.38)} {num(x + width * 0.5)},{num(y + height * 0.16)} "
        f"{num(x + width * 0.6)},{num(y + height * 0.22)}",
        roof_color, outline, 1.1, opacity,
    )
    nave = rect(x, y + height * 0.38, width * 0.6, height * 0.62, 0, wall, outline, 1.1, opacity)
    window = rect(x + width * 0.18, y + height * 0.52, width * 0.14, height * 0.18, 0,
                  outline, None, None, opacity)
    return cross + spire + tower + nave_roof + nave + window


def onion_dome_house(x: float, y: float, width: float, height: float, wall: str,
                     dome_color: str, outline: str, opacity: float | None = None) -> str:
    wall_top = y + height * 0.42
    body = rect(x, wall_top, width, height * 0.58, 0, wall, outline, 1.1, opacity)
    dome_cx = x + width * 0.5
    dome_width = width * 0.56
    dome_height = height * 0.46
    dome = path_shape(
        f"M {num(x + width * 0.22)},{num(wall_top + 1)} "
        f"C {num(dome_cx - dome_width * 0.62)},{num(wall_top - dome_height * 0.42)} "
        f"{num(dome_cx - dome_width * 0.3)},{num(wall_top - dome_height * 0.72)} "
        f"{num(dome_cx)},{num(wall_top - dome_height)} "
        f"C {num(dome_cx + dome_width * 0.3)},{num(wall_top - dome_height * 0.72)} "
        f"{num(dome_cx + dome_width * 0.62)},{num(wall_top - dome_height * 0.42)} "
        f"{num(x + width * 0.78)},{num(wall_top + 1)} Z",
        dome_color, outline, 1.1, opacity,
    )
    cross = (line(dome_cx, wall_top - dome_height, dome_cx, wall_top - dome_height - 6, outline, 1.2, opacity)
             + line(dome_cx - 3, wall_top - dome_height - 4, dome_cx + 3,
                    wall_top - dome_height - 4, outline, 1.2, opacity))
    door = rect(x + width * 0.4, y + height * 0.68, width * 0.2, height * 0.32, 0,
                outline, None, None, opacity)
    window = rect(x + width * 0.14, wall_top + height * 0.1, width * 0.16,
                  height * 0.18, 0, BONE_DARK, None, None, opacity)
    return body + dome + cross + door + window


def lighthouse_unit(x: float, base_y: float, width: float, height: float, wall: str,
                    stripe: str, outline: str, opacity: float | None = None) -> str:
    tower = polygon(
        f"{num(x)},{num(base_y)} {num(x + width * 0.18)},{num(base_y - height)} "
        f"{num(x + width * 0.82)},{num(base_y - height)} {num(x + width)},{num(base_y)}",
        wall, outline, 1.1, opacity,
    )
    band_top = base_y - height * 0.72
    band_bottom = base_y - height * 0.52
    band = polygon(
        f"{num(x + width * 0.22)},{num(band_bottom)} {num(x + width * 0.25)},{num(band_top)} "
        f"{num(x + width * 0.75)},{num(band_top)} {num(x + width * 0.78)},{num(band_bottom)}",
        stripe, outline, 0.8, opacity,
    )
    lantern_top = base_y - height - width * 0.34
    lantern = rect(x + width * 0.28, lantern_top, width * 0.44, width * 0.34, 0,
                   BONE_DARK, outline, 1.0, opacity)
    roof = polygon(
        f"{num(x + width * 0.22)},{num(lantern_top)} {num(x + width * 0.5)},{num(lantern_top - width * 0.36)} "
        f"{num(x + width * 0.78)},{num(lantern_top)}",
        stripe, outline, 1.0, opacity,
    )
    light = circle(x + width * 0.5, lantern_top + width * 0.17, width * 0.3, "none", stripe, 1.2,
                   (opacity if opacity is not None else 1.0) * 0.5)
    return tower + band + lantern + roof + light


def shop_front(x: float, y: float, width: float, height: float, wall: str,
               front: str, outline: str, opacity: float | None = None) -> str:
    body = rect(x, y, width, height, 0, wall, outline, 1.0, opacity)
    parapet = rect(x - 2, y - 4, width + 4, 8, 1, front, outline, 1.0, opacity)
    shop_window = rect(x + width * 0.12, y + height * 0.35, width * 0.3, height * 0.3, 0,
                       INK, None, None, opacity)
    door = rect(x + width * 0.58, y + height * 0.4, width * 0.24, height * 0.6, 0,
                INK, None, None, opacity)
    awning = rect(x + width * 0.08, y + height * 0.28, width * 0.84, 3, 1, front,
                  None, None, opacity)
    return body + parapet + shop_window + door + awning


def smokestack_unit(cx: float, base_y: float, base_width: float, top_width: float,
                    height: float, color: str, outline: str,
                    opacity: float | None = None) -> str:
    stack = polygon(
        f"{num(cx - base_width / 2)},{num(base_y)} {num(cx - top_width / 2)},{num(base_y - height)} "
        f"{num(cx + top_width / 2)},{num(base_y - height)} {num(cx + base_width / 2)},{num(base_y)}",
        color, outline, 1.0, opacity,
    )
    band = line(cx - top_width / 2 - 1, base_y - height * 0.82,
                cx + top_width / 2 + 1, base_y - height * 0.82, outline, 0.8, opacity)
    return stack + band


def smoke_wisp(x: float, y: float, color: str, opacity: float = 0.6) -> str:
    return (circle(x, y, 3.2, color, None, None, opacity)
            + circle(x + 2.2, y - 7, 2.6, color, None, None, opacity * 0.6)
            + circle(x + 4.6, y - 13, 2.0, color, None, None, opacity * 0.4)
            + circle(x + 6.8, y - 18, 1.5, color, None, None, opacity * 0.28))


def dead_tree_unit(cx: float, base_y: float, height: float, color: str,
                   opacity: float | None = None) -> str:
    trunk = line(cx, base_y, cx, base_y - height, color, 2.0, opacity)
    branch_one = line(cx, base_y - height * 0.55, cx - height * 0.28, base_y - height * 0.78,
                      color, 1.4, opacity)
    branch_two = line(cx, base_y - height * 0.7, cx + height * 0.3, base_y - height * 0.92,
                      color, 1.4, opacity)
    branch_three = line(cx, base_y - height * 0.4, cx + height * 0.22, base_y - height * 0.6,
                        color, 1.2, opacity)
    return trunk + branch_one + branch_two + branch_three


def conifer_unit(cx: float, base_y: float, width: float, height: float, fill: str,
                 trunk_color: str, opacity: float | None = None) -> str:
    trunk = line(cx, base_y, cx, base_y - height * 0.18, trunk_color, 2.2, opacity)
    lower = polygon(
        f"{num(cx)},{num(base_y - height)} {num(cx - width * 0.35)},{num(base_y - height * 0.45)} "
        f"{num(cx + width * 0.35)},{num(base_y - height * 0.45)}",
        fill, None, None, opacity,
    )
    upper = polygon(
        f"{num(cx)},{num(base_y - height * 1.05)} {num(cx - width * 0.45)},{num(base_y - height * 0.55)} "
        f"{num(cx + width * 0.45)},{num(base_y - height * 0.55)}",
        fill, None, None, opacity,
    )
    return trunk + lower + upper


def fence_run(x_start: float, y_start: float, x_end: float, y_end: float, color: str,
              opacity: float | None = None) -> str:
    rail_one = line(x_start, y_start - 4, x_end, y_end - 4, color, 1.4, opacity)
    rail_two = line(x_start, y_start + 3, x_end, y_end + 3, color, 1.4, opacity)
    posts = []
    length = math.hypot(x_end - x_start, y_end - y_start)
    post_count = max(2, int(length / 22))
    for index in range(post_count + 1):
        fraction = index / post_count
        post_x = x_start + (x_end - x_start) * fraction
        post_y = y_start + (y_end - y_start) * fraction
        posts.append(line(post_x, post_y - 8, post_x, post_y + 6, color, 1.6, opacity))
    return rail_one + rail_two + "".join(posts)


def crop_field(x: float, y: float, width: float, height: float, base: str,
               base_opacity: float, row_color: str, row_gap: float,
               row_width: float = 3) -> str:
    parts = [rect(x, y, width, height, 1, base, None, None, base_opacity)]
    step = row_gap + row_width
    row_y = y + 2
    while row_y < y + height - 2:
        parts.append(line(x + 3, row_y, x + width - 3, row_y, row_color, row_width,
                          base_opacity + 0.1))
        row_y += step
    return "".join(parts)


def pivot_field(cx: float, cy: float, radius: float, crop_color: str, ring_color: str,
                crop_opacity: float = 0.55) -> str:
    disc = circle(cx, cy, radius, crop_color, None, None, crop_opacity)
    ring = circle(cx, cy, radius, "none", ring_color, 1.4, crop_opacity + 0.15)
    arms = []
    for angle in (25, 145, 265):
        arm_rad = math.radians(angle)
        arms.append(line(cx, cy, cx + math.cos(arm_rad) * radius * 0.9,
                         cy + math.sin(arm_rad) * radius * 0.9, ring_color, 1.0, crop_opacity))
    center = circle(cx, cy, 2.2, ring_color, None, None, crop_opacity + 0.2)
    return disc + ring + "".join(arms) + center


def cactus_unit(cx: float, base_y: float, height: float, color: str,
                opacity: float | None = None) -> str:
    trunk_width = height * 0.16
    trunk = rect(cx - trunk_width / 2, base_y - height, trunk_width, height, trunk_width / 2,
                 color, None, None, opacity)
    arm_one = rect(cx - height * 0.34, base_y - height * 0.62, trunk_width, height * 0.26,
                   trunk_width / 2, color, None, None, opacity)
    arm_one_join = rect(cx - height * 0.34, base_y - height * 0.42, height * 0.3, trunk_width,
                        trunk_width / 2, color, None, None, opacity)
    arm_two = rect(cx + height * 0.18, base_y - height * 0.7, trunk_width, height * 0.3,
                   trunk_width / 2, color, None, None, opacity)
    arm_two_join = rect(cx + height * 0.04, base_y - height * 0.48, height * 0.3, trunk_width,
                        trunk_width / 2, color, None, None, opacity)
    return trunk + arm_one + arm_one_join + arm_two + arm_two_join


def mesa_unit(x: float, y: float, width: float, height: float, body: str, ledge: str,
              opacity: float | None = None) -> str:
    shape = polygon(
        f"{num(x)},{num(y + height)} {num(x + width * 0.14)},{num(y)} "
        f"{num(x + width * 0.86)},{num(y)} {num(x + width)},{num(y + height)}",
        body, None, None, opacity,
    )
    inner = polygon(
        f"{num(x + width * 0.2)},{num(y + height * 0.14)} {num(x + width * 0.8)},{num(y + height * 0.14)} "
        f"{num(x + width * 0.76)},{num(y + height * 0.34)} {num(x + width * 0.24)},{num(y + height * 0.34)}",
        ledge, None, None, None if opacity is None else opacity * 0.8,
    )
    return shape + inner


def telegraph_pole(x: float, y: float, height: float, color: str,
                   opacity: float | None = None) -> str:
    pole = line(x, y, x, y - height, color, 1.8, opacity)
    crossarm = line(x - height * 0.22, y - height * 0.8, x + height * 0.22, y - height * 0.8,
                    color, 1.4, opacity)
    crossarm_lower = line(x - height * 0.16, y - height * 0.6, x + height * 0.16,
                          y - height * 0.6, color, 1.2, opacity)
    return pole + crossarm + crossarm_lower


def wire_run(points: list[tuple[float, float]], color: str,
             opacity: float | None = None) -> str:
    point_text = " ".join(f"{num(point_x)},{num(point_y)}" for point_x, point_y in points)
    return polyline(point_text, color, 1.1, opacity)


def billboard_unit(x: float, y: float, width: float, height: float, panel: str,
                   post: str, opacity: float | None = None) -> str:
    panel_height = height * 0.55
    board = rect(x, y, width, panel_height, 1, panel, post, 1.0, opacity)
    leg_one = line(x + width * 0.25, y + panel_height, x + width * 0.25, y + height,
                   post, 1.6, opacity)
    leg_two = line(x + width * 0.75, y + panel_height, x + width * 0.75, y + height,
                   post, 1.6, opacity)
    trim = line(x, y + panel_height * 0.5, x + width, y + panel_height * 0.5, post, 0.8, opacity)
    return board + leg_one + leg_two + trim


def headframe_unit(x: float, y: float, width: float, height: float, color: str,
                   outline: str, opacity: float | None = None) -> str:
    apex_x = x + width * 0.5
    leg_one = line(x, y + height, apex_x, y, color, 2.2, opacity)
    leg_two = line(x + width, y + height, apex_x, y, color, 2.2, opacity)
    braces = []
    for fraction in (0.35, 0.6, 0.85):
        brace_y = y + height * fraction
        half_span = width * 0.5 * (1 - fraction)
        braces.append(line(apex_x - half_span, brace_y, apex_x + half_span, brace_y,
                           color, 1.2, opacity))
    wheel = circle(apex_x, y + height * 0.18, width * 0.18, "none", outline, 1.0, opacity)
    return leg_one + leg_two + "".join(braces) + wheel


def scatter_dots(cx: float, cy: float, radius: float, count: int, color: str,
                 opacity: float) -> str:
    parts = []
    for offset_x, offset_y in scatter_offsets(count, radius):
        parts.append(circle(cx + offset_x, cy + offset_y, 1.6, color, None, None, opacity))
    return "".join(parts)


def birds_unit(x: float, y: float, color: str, count: int,
               opacity: float | None = None) -> str:
    parts = []
    for index in range(count):
        bird_x = x + index * 20
        bird_y = y + (index % 2) * 6
        parts.append(polyline(
            f"{num(bird_x - 4)},{num(bird_y)} {num(bird_x)},{num(bird_y - 3)} {num(bird_x + 4)},{num(bird_y)}",
            color, 1.6, opacity,
        ))
    return "".join(parts)


def dune_fill(x_start: float, x_end: float, y_base: float, amplitude: float,
              wavelength: float, fill: str, opacity: float) -> str:
    crest = sampled_wave_path(x_start, x_end, y_base, amplitude, wavelength)
    d = f"{crest} L {num(x_end)} {num(MAP_HEIGHT)} L {num(x_start)} {num(MAP_HEIGHT)} Z"
    return path_shape(d, fill, None, None, opacity)


def route_geometry(layout: dict) -> tuple[str, list[tuple[tuple[float, float], tuple[float, float]]]]:
    positions = {(node["kind"], node["level"]): (node["x"], node["y"]) for node in layout["nodes"]}
    chain_connections = [
        connection for connection in layout["connections"]
        if connection["from"]["kind"] == "level" and connection["to"]["kind"] == "level"
    ]
    chain_points = [positions[("level", chain_connections[0]["from"]["level"])]]
    for connection in chain_connections:
        chain_points.append(positions[("level", connection["to"]["level"])])
    chain_d = "M " + " L ".join(f"{num(point_x)} {num(point_y)}" for point_x, point_y in chain_points)
    branches = [
        (positions[(connection["from"]["kind"], connection["from"]["level"])],
         positions[(connection["to"]["kind"], connection["to"]["level"])])
        for connection in layout["connections"]
        if connection not in chain_connections
    ]
    return chain_d, branches


def route_band(layout: dict, outer_color: str, inner_color: str, dash_color: str,
               branch_color: str) -> str:
    chain_d, branches = route_geometry(layout)
    outer = path_shape(chain_d, "none", outer_color, 30, 0.5)
    inner = path_shape(chain_d, "none", inner_color, 20, 0.6)
    dashes = path_shape(chain_d, "none", dash_color, 2.5, 0.4, dash="20 16")
    tracks = []
    for (start_x, start_y), (end_x, end_y) in branches:
        tracks.append(line(start_x, start_y, end_x, end_y, branch_color, 12, 0.45, dash="10 9"))
    return outer + inner + dashes + "".join(tracks)


def verdant_marches_map() -> str:
    background = "#243222"
    mid = "#2f4a2f"
    light = "#366836"
    accent = "#6abf6a"
    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, background),
        ellipse(260, 190, 280, 130, mid, opacity=0.3),
        ellipse(840, 520, 300, 140, mid, opacity=0.25),
        ellipse(640, 350, 210, 95, light, opacity=0.18),
    ]
    for grid_x in range(100, 1001, 100):
        parts.append(line(grid_x, 22, grid_x, 678, accent, 1, 0.06))
    for grid_y in range(100, 601, 100):
        parts.append(line(24, grid_y, 1076, grid_y, accent, 1, 0.06))
    parts.append(line(40, 350, 1060, 350, accent, 1, 0.12, dash="12 10"))
    parts.append(line(550, 180, 550, 520, accent, 1, 0.12, dash="12 10"))
    parts.append(circle(550, 350, 60, "none", accent, 1.5, 0.14))
    parts.append(circle(550, 350, 100, "none", accent, 1.5, 0.12))
    parts.append(circle(550, 350, 140, "none", accent, 1.5, 0.1))
    parts.append(polygon(regular_polygon_points(200, 350, 90, 6), "none", accent, 2, 0.16))
    parts.append(polygon(regular_polygon_points(200, 350, 48, 4, -45), "none", accent, 1.2, 0.12))
    parts.append(polygon(regular_polygon_points(900, 350, 90, 3), "none", accent, 2, 0.16))
    parts.append(path_shape(angle_arc(900, 260, 60, 120, 26), "none", accent, 1.2, 0.16))
    parts.append(polygon(right_angle_mark(822, 395, -60, 0, 13), "none", accent, 1.2, 0.16))
    parts.append(symbol_text(550, 350, "+", accent, 46, 0.3))
    parts.append(symbol_text(200, 350, "=", accent, 38, 0.28))
    parts.append(symbol_text(900, 352, "&#215;", accent, 38, 0.28))
    parts.append(symbol_text(330, 300, "&#8722;", accent, 34, 0.24))
    parts.append(symbol_text(330, 404, "&#247;", accent, 34, 0.24))
    parts.append(symbol_text(740, 300, "&lt;", accent, 34, 0.24))
    parts.append(symbol_text(740, 402, "&gt;", accent, 34, 0.24))
    parts.append(symbol_text(350, 60, "&#8800;", accent, 34, 0.24))
    parts.append(symbol_text(450, 60, "&#177;", accent, 34, 0.24))
    parts.append(symbol_text(250, 660, "%", accent, 36, 0.24))
    parts.append(symbol_text(360, 660, "&#189;", accent, 36, 0.24))
    parts.append(region_frame(accent))
    return svg_root("".join(parts))


def sunscorch_coast_map() -> str:
    background = "#322a1a"
    mid = "#4a3d28"
    light = "#b8a56a"
    accent = "#e8c96a"
    sun_x = 550
    sun_y = 360
    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, background),
        ellipse(260, 190, 280, 130, mid, opacity=0.28),
        ellipse(840, 520, 300, 140, mid, opacity=0.22),
    ]
    for wave_y in (330, 372, 414):
        parts.append(path_shape(sampled_wave_path(30, 1070, wave_y, 22, 260), "none",
                                accent, 2, 0.1))
    parts.append(circle(sun_x, sun_y, 140, light, None, None, 0.05))
    parts.append(circle(sun_x, sun_y, 95, accent, None, None, 0.06))
    parts.append(circle(sun_x, sun_y, 50, accent, None, None, 0.09))
    parts.append(circle(sun_x, sun_y, 140, "none", accent, 1.5, 0.14))
    for ray_index in range(16):
        ray_rad = math.radians(ray_index * 22.5)
        parts.append(line(sun_x + math.cos(ray_rad) * 155, sun_y + math.sin(ray_rad) * 155,
                          sun_x + math.cos(ray_rad) * 190, sun_y + math.sin(ray_rad) * 190,
                          accent, 2, 0.12))
    for tick_degrees in range(0, 360, 15):
        tick_rad = math.radians(tick_degrees)
        long_tick = tick_degrees % 45 == 0
        inner_radius = 190 if long_tick else 196
        outer_radius = 208 if long_tick else 206
        parts.append(line(
            sun_x + math.cos(tick_rad) * inner_radius, sun_y + math.sin(tick_rad) * inner_radius,
            sun_x + math.cos(tick_rad) * outer_radius, sun_y + math.sin(tick_rad) * outer_radius,
            accent, 2.2 if long_tick else 1.4, 0.12,
        ))
    parts.append(path_shape(golden_spiral_path(120, 102, 8, 360, 180), "none", accent, 2, 0.16))
    parts.append(symbol_text(sun_x, sun_y, "&#960;", accent, 46, 0.3))
    parts.append(symbol_text(120, 190, "&#966;", accent, 34, 0.28))
    parts.append(symbol_text(1000, 120, "&#8730;", accent, 40, 0.28))
    parts.append(symbol_text(85, 295, "&#952;", accent, 36, 0.28))
    parts.append(symbol_text(990, 620, "&#969;", accent, 36, 0.26))
    parts.append(symbol_text(420, 70, "&#8734;", accent, 38, 0.28))
    parts.append(symbol_text(180, 650, "&#916;", accent, 36, 0.26))
    parts.append(symbol_text(770, 630, "&#8776;", accent, 36, 0.26))
    parts.append(symbol_text(290, 110, "&#176;", accent, 32, 0.26))
    parts.append(region_frame(accent))
    return svg_root("".join(parts))


def thornpeak_wilds_map() -> str:
    background = "#2b2823"
    mid = "#3a3730"
    light = "#7a6c5e"
    accent = "#8a7d6a"

    def peak(apex_x: float, base_y: float, half_width: float, height: float,
             filled: bool = False) -> str:
        points = (f"{num(apex_x)},{num(base_y - height)} "
                  f"{num(apex_x - half_width)},{num(base_y)} {num(apex_x + half_width)},{num(base_y)}")
        if filled:
            return polygon(points, "#453f36", accent, 1.8, 0.55)
        return polygon(points, "none", accent, 1.8, None)

    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, background),
        ellipse(260, 190, 280, 130, mid, opacity=0.2),
        ellipse(840, 520, 300, 140, mid, opacity=0.16),
    ]
    for dot_x in range(25, 1076, 60):
        for dot_y in range(25, 676, 60):
            parts.append(circle(dot_x, dot_y, 1.4, accent, None, None, 0.08))
    parts.append(peak(340, 245, 48, 95))
    parts.append(peak(312, 310, 34, 75, True))
    parts.append(peak(378, 352, 44, 77))
    parts.append(peak(330, 655, 34, 57, True))
    parts.append(peak(378, 668, 38, 53))
    parts.append(peak(620, 245, 50, 100))
    parts.append(peak(598, 415, 35, 80, True))
    parts.append(peak(655, 505, 40, 80))
    parts.append(peak(865, 425, 45, 95, True))
    parts.append(peak(935, 478, 42, 93))
    parts.append(peak(82, 350, 52, 95))
    parts.append(peak(58, 540, 36, 70, True))
    parts.append(peak(550, 58, 34, 36, True))
    parts.append(peak(645, 60, 33, 32))
    parts.append(peak(900, 54, 32, 34, True))
    parts.append(polygon(right_angle_mark(388, 245, -117, 180, 12), "none", accent, 1.2, 0.16))
    parts.append(polygon(right_angle_mark(820, 425, -65, 0, 12), "none", accent, 1.2, 0.16))
    parts.append(path_shape(angle_arc(620, 145, 63, 117, 26), "none", accent, 1.2, 0.16))
    parts.append(path_shape(angle_arc(82, 255, 61, 119, 26), "none", accent, 1.2, 0.16))
    parts.append(polyline("312,362 352,398 314,432 352,458", accent, 2, 0.15))
    parts.append(symbol_text(60, 600, "&#8747;", accent, 40, 0.3))
    parts.append(symbol_text(340, 415, "&#8706;", accent, 36, 0.28))
    parts.append(symbol_text(620, 575, "&#8711;", accent, 36, 0.28))
    parts.append(symbol_text(620, 80, "&#8721;", accent, 34, 0.28))
    parts.append(symbol_text(960, 300, "&#8719;", accent, 34, 0.28))
    parts.append(symbol_text(110, 405, "&#8704;", accent, 34, 0.26))
    parts.append(symbol_text(900, 540, "&#8707;", accent, 32, 0.26))
    parts.append(symbol_text(660, 650, "&#8712;", accent, 32, 0.26))
    parts.append(symbol_text(960, 660, "&#955;", accent, 34, 0.26))
    parts.append(symbol_text(30, 190, "&#956;", accent, 34, 0.26))
    parts.append(region_frame(accent))
    return svg_root("".join(parts))


def polymath_map_images() -> list[str]:
    return [verdant_marches_map(), sunscorch_coast_map(), thornpeak_wilds_map()]


def rust_bloom(x: float, y: float) -> str:
    return (ellipse(x, y, 26, 16, "#8a5a3a", opacity=0.18)
            + ellipse(x + 14, y + 6, 14, 9, "#b87333", opacity=0.12)
            + ellipse(x - 12, y + 4, 10, 6, "#8a5a3a", opacity=0.14))


def rustbloom_wastes_map() -> str:
    accent = "#b87333"
    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, "#2a1c16"),
        ellipse(260, 190, 280, 130, "#4a2e1c", opacity=0.4),
        ellipse(840, 520, 300, 140, "#4a2e1c", opacity=0.32),
        ellipse(640, 300, 210, 95, "#8a5a3a", opacity=0.16),
        ellipse(240, 650, 250, 50, "#4a2e1c", opacity=0.25),
    ]
    for bloom_x, bloom_y in ((500, 168), (150, 180), (985, 248), (350, 455), (770, 138),
                             (1052, 428), (520, 428)):
        parts.append(rust_bloom(bloom_x, bloom_y))
    for contour_y in (92, 120, 155):
        parts.append(path_shape(sampled_wave_path(40, 1060, contour_y, 14, 300), "none",
                                "#8a5a3a", 1.2, 0.12))
    parts.append(route_band(AFTERMATH_MAP_LAYOUTS[0], "#120e0c", "#2a2018", BONE_DARK,
                            "#3a2a1c"))
    bottom_poles = [(160, 554), (300, 554), (440, 554), (580, 554), (720, 554), (860, 554)]
    climb_poles = [(960, 519), (920, 404), (775, 399), (630, 389), (490, 299)]
    for pole_x, pole_y in bottom_poles + climb_poles:
        parts.append(telegraph_pole(pole_x, pole_y, 16, SCRAP_WOOD_DARK))
    parts.append(wire_run([(pole_x, pole_y - 12.8) for pole_x, pole_y in bottom_poles],
                          "#4a4038", 0.5))
    parts.append(wire_run([(pole_x, pole_y - 12.8) for pole_x, pole_y in climb_poles],
                          "#4a4038", 0.5))
    parts.append(crop_field(40, 636, 392, 42, "#465a30", 0.4, "#6a8a4c", 7))
    parts.append(barn_house(150, 630, 58, 40, "#6a3a2a", "#3a2018", INK))
    parts.append(silo_tank(222, 618, 22, 52, "#7a6a5c", "#8a7a6c", INK))
    parts.append(tractor_unit(268, 646, "#7a5a3a"))
    parts.append(windmill_unit(455, 676, 44, "#5c5248"))
    parts.append(fence_run(470, 660, 540, 656, SCRAP_WOOD))
    parts.append(water_tank_unit(515, 676, 30, 56, "#7a6a5c", INK))
    for shop_x, shop_wall, shop_front_color in (
        (545, "#6a4e38", SCRAP_WOOD_LIGHT),
        (597, "#5a4a3a", BONE_DARK),
        (649, "#6a5a44", SCRAP_WOOD_LIGHT),
        (701, "#4e4034", BONE_DARK),
    ):
        parts.append(shop_front(shop_x, 646, 46, 34, shop_wall, shop_front_color, INK))
    parts.append(church_unit(760, 606, 34, 70, "#5a4a3a", "#3a2a1c", INK))
    for street_x in (950, 1000, 1048):
        parts.append(line(street_x, 490, street_x, 676, "#120e0c", 5, 0.3))
    for street_y in (545, 600, 655):
        parts.append(line(930, street_y, 1076, street_y, "#120e0c", 5, 0.3))
    for block_x, block_y, block_width, block_height, block_wall, block_columns, block_rows in (
        (910, 255, 48, 62, "#4a4e54", 4, 4),
        (975, 320, 40, 50, "#3f444b", 3, 3),
        (995, 495, 52, 70, "#4a4e54", 4, 5),
        (1048, 490, 32, 100, "#3f444b", 3, 8),
        (990, 585, 44, 93, "#454a51", 4, 6),
        (1040, 620, 38, 58, "#3f444b", 3, 4),
    ):
        parts.append(city_block(block_x, block_y, block_width, block_height, block_wall,
                                INK, "#20242a", block_columns, block_rows))
    parts.append(pitched_house(895, 642, 66, 36, SCRAP_WOOD, SCRAP_WOOD_DARK, INK))
    parts.append(smokestack_unit(852, 678, 14, 10, 93, "#5c5248", INK))
    parts.append(smokestack_unit(820, 678, 12, 9, 68, "#5c5248", INK))
    parts.append(smoke_wisp(852, 582, "#9a9288", 0.4))
    for skyline_x, skyline_width, skyline_height in ((730, 60, 58), (800, 46, 36), (856, 54, 68),
                                                     (920, 44, 44), (972, 58, 72), (1040, 40, 40)):
        parts.append(rect(skyline_x, 128 - skyline_height, skyline_width, skyline_height, 1,
                          "#1f130c", None, None, 0.9))
    for window_x, window_y in ((748, 82), (766, 96), (870, 74), (888, 96), (990, 68), (1006, 90)):
        parts.append(rect(window_x, window_y, 3.5, 4, 0.5, "#b87333", None, None, 0.3))
    parts.append(line(190, 352, 360, 352, "#120e0c", 8, 0.4))
    for house_x, house_wall, house_roof in (
        (196, SCRAP_WOOD, SCRAP_WOOD_DARK), (232, "#5a4a3a", SCRAP_WOOD_DARK),
        (268, "#6a5a44", SCRAP_WOOD_DARK), (304, "#5a4a3a", SCRAP_WOOD_DARK),
        (340, "#4e4034", SCRAP_WOOD_DARK),
    ):
        parts.append(pitched_house(house_x, 322, 26, 24, house_wall, house_roof, INK))
    parts.append(pitched_house(214, 364, 24, 20, "#5a4a3a", SCRAP_WOOD_DARK, INK))
    parts.append(pitched_house(250, 364, 24, 20, SCRAP_WOOD, SCRAP_WOOD_DARK, INK))
    for tree_x, tree_y, tree_height in ((80, 258, 30), (560, 188, 28), (1005, 152, 26),
                                        (620, 132, 30)):
        parts.append(dead_tree_unit(tree_x, tree_y, tree_height, "#4a3a2c"))
    parts.append(birds_unit(760, 76, "#8a5a3a", 3))
    parts.append(birds_unit(300, 56, "#8a5a3a", 2))
    parts.append(region_frame(accent))
    return svg_root("".join(parts))


def sand_and_regret_map() -> str:
    accent = "#d2c09a"
    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, "#2e2a1e"),
        ellipse(260, 190, 280, 130, "#4a4230", opacity=0.35),
        ellipse(840, 520, 300, 140, "#4a4230", opacity=0.3),
    ]
    for dune_y, dune_amplitude, dune_wavelength, dune_fill_color, dune_opacity in (
        (140, 16, 240, "#4a4230", 0.22), (330, 18, 300, "#3a3428", 0.22),
        (520, 16, 260, "#4a4230", 0.26), (660, 20, 320, "#3a3428", 0.28),
    ):
        parts.append(dune_fill(0, MAP_WIDTH, dune_y, dune_amplitude, dune_wavelength,
                               dune_fill_color, dune_opacity))
    for patch_x, patch_y, patch_rx, patch_ry, patch_opacity in (
        (430, 240, 150, 50, 0.1), (760, 420, 180, 60, 0.08), (180, 440, 120, 40, 0.09),
    ):
        parts.append(ellipse(patch_x, patch_y, patch_rx, patch_ry, accent, opacity=patch_opacity))
    for mesa_x, mesa_y, mesa_width, mesa_height in ((360, 24, 130, 126), (700, 26, 110, 90),
                                                    (835, 26, 70, 96)):
        parts.append(mesa_unit(mesa_x, mesa_y, mesa_width, mesa_height, "#3a3428", "#5a5244"))
    parts.append(route_band(AFTERMATH_MAP_LAYOUTS[1], "#141009", "#3a3428", accent, "#c2b280"))
    parts.append(pivot_field(148, 616, 36, "#5a6a44", accent, 0.45))
    parts.append(pivot_field(252, 620, 26, "#6a7a4a", accent, 0.4))
    parts.append(windpump_unit(56, 648, 54, "#5c5248"))
    parts.append(pitched_house(70, 598, 30, 22, SCRAP_WOOD, SCRAP_WOOD_DARK, INK))
    parts.append(fence_run(206, 560, 262, 560, SCRAP_WOOD))
    parts.append(fence_run(206, 560, 206, 592, SCRAP_WOOD))
    parts.append(fence_run(262, 560, 262, 592, SCRAP_WOOD))
    parts.append(rect(246, 470, 64, 10, 1, "#c45a48", INK, 1.0))
    parts.append(line(250, 480, 250, 498, SCRAP_WOOD_DARK, 2))
    parts.append(line(306, 480, 306, 498, SCRAP_WOOD_DARK, 2))
    parts.append(rect(258, 484, 8, 14, 1, STEEL_LIGHT, INK, 1.0))
    parts.append(rect(280, 484, 8, 14, 1, STEEL_LIGHT, INK, 1.0))
    parts.append(rect(318, 462, 30, 30, 1, "#6a5a44", INK, 1.0))
    parts.append(rect(324, 468, 18, 10, 0, INK, None, None))
    parts.append(pitched_house(300, 516, 44, 26, "#6a5a44", SCRAP_WOOD_DARK, INK))
    parts.append(line(346, 512, 346, 496, SCRAP_WOOD_DARK, 1.6))
    parts.append(rect(338, 486, 18, 12, 1, "#c45a48", INK, 1.0))
    parts.append(line(252, 540, 252, 586, SCRAP_WOOD_DARK, 2))
    parts.append(rect(238, 522, 28, 18, 1, "#c45a48", INK, 1.0))
    parts.append(rect(243, 527, 18, 8, 0, BONE, None, None, 0.8))
    parts.append(dead_tree_unit(288, 585, 26, "#4a3a2c"))
    parts.append(dead_tree_unit(372, 570, 30, "#4a3a2c"))
    parts.append(line(410, 632, 795, 632, "#141009", 5, 0.35))
    parts.append(line(410, 668, 795, 668, "#141009", 5, 0.35))
    for house_x, house_wall in ((420, SCRAP_WOOD), (480, "#5a4a3a"), (540, SCRAP_WOOD),
                                (600, "#4e4034"), (660, SCRAP_WOOD), (720, "#5a4a3a")):
        parts.append(pitched_house(house_x, 604, 24, 20, house_wall, SCRAP_WOOD_DARK, INK))
    for house_x, house_wall in ((450, "#5a4a3a"), (510, SCRAP_WOOD), (570, "#4e4034"),
                                (630, SCRAP_WOOD), (690, "#5a4a3a")):
        parts.append(pitched_house(house_x, 640, 22, 18, house_wall, SCRAP_WOOD_DARK, INK))
    parts.append(conifer_unit(752, 626, 20, 26, "#5a6a44", "#4a3a2c"))
    parts.append(conifer_unit(768, 654, 16, 20, "#5a6a44", "#4a3a2c"))
    parts.append(ellipse(730, 660, 14, 6, "#3a4a4a", opacity=0.5))
    parts.append(line(1015, 592, 1015, 676, "#141009", 5, 0.3))
    parts.append(line(1045, 592, 1045, 676, "#141009", 5, 0.3))
    for block_x, block_y, block_width, block_height, block_wall, block_columns, block_rows in (
        (1000, 236, 40, 54, "#4a4e54", 3, 4),
        (1046, 250, 32, 40, "#3f444b", 2, 3),
        (1010, 410, 36, 60, "#454a51", 3, 4),
        (1050, 420, 26, 50, "#3f444b", 2, 4),
        (995, 592, 40, 86, "#4a4e54", 3, 5),
        (1042, 600, 34, 78, "#3f444b", 3, 5),
    ):
        parts.append(city_block(block_x, block_y, block_width, block_height, block_wall,
                                INK, "#242a30", block_columns, block_rows))
    parts.append(line(1078, 310, 1078, 220, STEEL_LIGHT, 1.6, 0.8))
    for mast_y in (240, 262, 284):
        parts.append(line(1070, mast_y, 1082, mast_y, STEEL_LIGHT, 1.2, 0.8))
    parts.append(ellipse(968, 620, 10, 8, STEEL, INK, 1.0))
    parts.append(ellipse(968, 644, 10, 8, STEEL, INK, 1.0))
    for cactus_x, cactus_y, cactus_height in ((480, 268, 26), (720, 146, 24), (860, 268, 28),
                                              (56, 274, 24), (900, 584, 26)):
        parts.append(cactus_unit(cactus_x, cactus_y, cactus_height, "#5a6a44", 0.8))
    parts.append(billboard_unit(468, 606, 34, 22, "#c45a48", SCRAP_WOOD_DARK))
    parts.append(billboard_unit(810, 612, 34, 22, "#c45a48", SCRAP_WOOD_DARK))
    pole_positions = [(142, 456), (312, 276), (482, 456), (652, 276), (822, 456), (992, 276)]
    for pole_x, pole_y in pole_positions:
        parts.append(telegraph_pole(pole_x, pole_y, 16, SCRAP_WOOD_DARK))
    parts.append(wire_run([(pole_x, pole_y - 12.8) for pole_x, pole_y in pole_positions],
                          "#4a4038", 0.5))
    parts.append(region_frame("#c2b280"))
    return svg_root("".join(parts))


def ashen_highs_map() -> str:
    accent = "#9a9690"
    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, "#232323"),
        polygon(
            "0,330 100,262 200,196 300,128 390,88 500,60 610,50 700,58 790,80 870,104 "
            "950,140 1030,180 1100,210 1100,700 0,700",
            "#333333", None, None, 0.5,
        ),
        polygon("586,74 610,50 634,74", "#9a9690", None, None, 0.2),
        polygon("478,80 500,60 522,80", "#9a9690", None, None, 0.18),
        polygon("370,104 390,88 410,104", "#9a9690", None, None, 0.15),
        polygon(
            "0,470 160,392 330,330 480,300 620,296 760,320 900,360 1000,400 1100,430 "
            "1100,700 0,700",
            "#3a3a3a", None, None, 0.3,
        ),
        ellipse(300, 600, 240, 60, "#9a9690", opacity=0.07),
        ellipse(700, 640, 280, 70, "#9a9690", opacity=0.06),
        ellipse(150, 180, 160, 60, "#9a9690", opacity=0.08),
    ]
    for scree_x, scree_y, scree_radius, scree_count, scree_opacity in (
        (180, 520, 60, 26, 0.25), (620, 420, 70, 30, 0.2), (930, 520, 55, 22, 0.2),
    ):
        parts.append(scatter_dots(scree_x, scree_y, scree_radius, scree_count, "#8a9090",
                                  scree_opacity))
    parts.append(route_band(AFTERMATH_MAP_LAYOUTS[2], "#141414", "#2a2a2a", accent, "#8a9090"))
    parts.append(ellipse(560, 520, 70, 22, "#2e2e32", None, None, 0.7))
    parts.append(ellipse(560, 520, 70, 22, "none", "#6a6a68", 1.2, 0.35))
    parts.append(conifer_unit(646, 486, 16, 22, "#4a4a44", "#3a3230"))
    parts.append(conifer_unit(488, 496, 14, 18, "#4a4a44", "#3a3230"))
    parts.append(smoke_wisp(614, 44, accent, 0.5))
    parts.append(crop_field(30, 660, 140, 16, "#3f4a34", 0.4, "#5a6a44", 5))
    parts.append(pitched_house(34, 634, 34, 24, "#5a4638", SCRAP_WOOD_DARK, INK))
    parts.append(silo_tank(138, 630, 14, 40, "#6a6058", "#7a7068", INK))
    parts.append(pitched_house(248, 462, 26, 20, "#5a4638", SCRAP_WOOD_DARK, INK))
    parts.append(pitched_house(284, 478, 26, 20, "#4a4038", "#241c16", INK))
    parts.append(pitched_house(318, 458, 24, 18, "#5a4638", SCRAP_WOOD_DARK, INK))
    parts.append(headframe_unit(344, 470, 26, 46, "#6a665e", INK))
    parts.append(ellipse(300, 542, 42, 13, "#4a4844", opacity=0.5))
    parts.append(scatter_dots(300, 538, 36, 16, "#6a665e", 0.3))
    for conifer_x, conifer_y, conifer_width, conifer_height in ((505, 306, 18, 26),
                                                                (768, 356, 16, 24),
                                                                (430, 326, 16, 22)):
        parts.append(conifer_unit(conifer_x, conifer_y, conifer_width, conifer_height,
                                  "#4a4a44", "#3a3230"))
    parts.append(line(700, 452, 780, 452, "#161616", 6, 0.5))
    for house_x, house_y, house_width, house_height, house_wall, house_roof in (
        (704, 396, 24, 20, "#5a4638", SCRAP_WOOD_DARK),
        (740, 396, 24, 20, "#4a4038", "#241c16"),
        (766, 420, 22, 18, "#5a4a3e", "#2a221c"),
        (704, 470, 24, 20, "#5a4638", SCRAP_WOOD_DARK),
        (740, 470, 24, 20, "#4a4038", "#241c16"),
    ):
        parts.append(pitched_house(house_x, house_y, house_width, house_height, house_wall,
                                   house_roof, INK))
    parts.append(pitched_house(960, 646, 54, 30, "#4a4038", "#2a221c", INK))
    parts.append(smokestack_unit(1058, 678, 14, 10, 44, "#5c5248", INK))
    parts.append(smokestack_unit(1042, 678, 12, 9, 30, "#5c5248", INK))
    parts.append(pitched_house(968, 662, 22, 16, "#5a4638", "#2a221c", INK))
    parts.append(pitched_house(996, 664, 20, 14, "#5a4638", "#2a221c", INK))
    parts.append(smoke_wisp(1051, 630, accent, 0.4))
    parts.append(smoke_wisp(1048, 644, accent, 0.3))
    parts.append(birds_unit(700, 100, "#8a9090", 2))
    parts.append(birds_unit(250, 214, "#8a9090", 2))
    parts.append(region_frame("#8a9099"))
    return svg_root("".join(parts))


def yule_vale_map() -> str:
    accent = "#8fb8d8"
    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, "#1c2833"),
        ellipse(260, 190, 280, 130, "#26384a", opacity=0.35),
        ellipse(840, 520, 300, 140, "#26384a", opacity=0.3),
        ellipse(560, 300, 220, 100, "#2c3e50", opacity=0.25),
    ]
    for drift_x, drift_y, drift_rx, drift_ry in (
        (420, 662, 160, 26), (720, 646, 140, 22), (250, 140, 130, 24),
        (950, 110, 110, 20), (110, 330, 90, 20), (560, 200, 100, 18),
    ):
        parts.append(ellipse(drift_x, drift_y, drift_rx, drift_ry, "#3a4c5e", opacity=0.45))
    fir_positions = (
        (60, 120, 26, 44), (110, 140, 22, 38), (160, 110, 24, 42), (230, 90, 22, 36),
        (300, 120, 26, 44), (380, 80, 22, 36), (470, 110, 24, 40), (560, 80, 22, 36),
        (660, 100, 26, 42), (760, 70, 22, 34), (860, 100, 24, 40), (960, 80, 22, 36),
        (60, 420, 24, 40), (30, 520, 22, 36), (1050, 420, 24, 40), (1060, 560, 22, 36),
    )
    for fir_x, fir_y, fir_width, fir_height in fir_positions:
        parts.append(conifer_unit(fir_x, fir_y, fir_width, fir_height, "#2e4a40", "#3a2a1c"))
    parts.append(route_band(CHRITHMATH_MAP_LAYOUTS[0], "#141d26", "#3d4a56", accent, "#475665"))
    village_houses = (
        (150, 616, 30, 24, "#3a4c60", "#22344a"), (200, 634, 28, 22, "#31465e", "#22344a"),
        (240, 610, 30, 24, "#3a4c60", "#22344a"), (420, 560, 28, 22, "#31465e", "#22344a"),
        (470, 586, 30, 24, "#3a4c60", "#22344a"), (680, 540, 28, 22, "#31465e", "#22344a"),
        (730, 566, 30, 24, "#3a4c60", "#22344a"), (830, 596, 28, 22, "#31465e", "#22344a"),
    )
    for house_x, house_y, house_width, house_height, house_wall, house_roof in village_houses:
        parts.append(pitched_house(house_x, house_y, house_width, house_height, house_wall,
                                   house_roof, INK))
    parts.append(barn_house(300, 630, 40, 30, "#4a3a2c", "#22303f", INK))
    parts.append(fence_run(140, 620, 290, 620, "#3a2a1c", 0.7))
    parts.append(fence_run(660, 546, 800, 546, "#3a2a1c", 0.7))
    parts.append(polyline("165,610 220,600 262,604 438,552 486,578", accent, 1.6, 0.4,
                          dash="2 7"))
    parts.append(church_unit(430, 170, 44, 76, "#31465e", "#22344a", INK))
    parts.append(onion_dome_house(320, 200, 54, 64, "#2c3e50", "#8fb8d8", INK, 0.8))
    parts.append(birds_unit(640, 150, accent, 3, 0.5))
    parts.append(birds_unit(340, 250, accent, 2, 0.4))
    parts.append(scatter_dots(550, 350, 330, 48, "#c8d6e2", 0.12))
    parts.append(region_frame(accent))
    return svg_root("".join(parts))


def sunspice_coast_map() -> str:
    accent = "#d2c09a"
    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, "#2e2718"),
        ellipse(260, 190, 280, 130, "#4a4230", opacity=0.3),
        ellipse(620, 420, 300, 140, "#4a4230", opacity=0.22),
        dune_fill(0, MAP_WIDTH, 606, 14, 260, "#4a4230", 0.3),
    ]
    sea_crest = sampled_wave_path(0, MAP_WIDTH, 660, 12, 300)
    parts.append(path_shape(f"{sea_crest} L {MAP_WIDTH} {MAP_HEIGHT} L 0 {MAP_HEIGHT} Z",
                            "#1f3438", None, None, 0.9))
    parts.append(path_shape(sampled_wave_path(40, 1060, 672, 8, 220), "none", accent, 1.6, 0.25))
    parts.append(path_shape(sampled_wave_path(60, 1040, 686, 7, 240), "none", accent, 1.2, 0.18))
    boat = (polygon("270,676 330,676 318,688 282,688", "#3a3428", INK, 1.0)
            + line(300, 676, 300, 648, accent, 1.4, 0.8)
            + polygon("300,650 300,674 322,674", "#c2b280", None, None, 0.7))
    parts.append(boat)
    parts.append(route_band(CHRITHMATH_MAP_LAYOUTS[1], "#17130c", "#3a2e20", accent, "#5a4d40"))
    for shop_x, shop_wall, shop_front_color in (
        (430, "#6a5a44", "#c45a48"), (484, "#5a4a3a", "#4a8a8a"), (538, "#6a5a44", "#4a6a9a"),
    ):
        parts.append(shop_front(shop_x, 622, 46, 30, shop_wall, shop_front_color, INK))
    parts.append(pitched_house(620, 626, 34, 24, "#6a5a44", "#3a2a1c", INK))
    parts.append(pitched_house(790, 624, 30, 22, "#5a4a3a", "#3a2a1c", INK))
    parts.append(barn_house(940, 622, 44, 30, "#6a5a44", "#3a2a1c", INK))
    for cactus_x, cactus_y, cactus_height in ((380, 640, 26), (700, 650, 24), (900, 648, 28)):
        parts.append(cactus_unit(cactus_x, cactus_y, cactus_height, "#5a6a44", 0.8))
    parts.append(dead_tree_unit(760, 660, 26, "#4a3a2c"))
    parts.append(dead_tree_unit(330, 654, 22, "#4a3a2c"))
    parts.append(fence_run(420, 618, 600, 618, "#3a2a1c", 0.7))
    parts.append(lighthouse_unit(955, 158, 34, 118, "#5a5248", "#c45a48", INK))
    parts.append(ellipse(972, 66, 30, 10, "#c45a48", opacity=0.18))
    parts.append(birds_unit(500, 120, accent, 3, 0.5))
    parts.append(birds_unit(820, 200, accent, 2, 0.4))
    parts.append(scatter_dots(450, 300, 340, 36, "#c2b280", 0.1))
    parts.append(region_frame(accent))
    return svg_root("".join(parts))


def icon_snows_map() -> str:
    accent = "#8fa4c8"
    parts = [
        rect(0, 0, MAP_WIDTH, MAP_HEIGHT, 0, "#161c2b"),
        ellipse(260, 190, 280, 130, "#222c44", opacity=0.4),
        ellipse(840, 520, 300, 140, "#222c44", opacity=0.35),
        ellipse(550, 360, 250, 170, "#283352", opacity=0.3),
    ]
    parts.append(circle(550, 360, 150, "none", accent, 1.5, 0.14))
    parts.append(circle(550, 360, 210, "none", accent, 1.2, 0.1))
    parts.append(route_band(CHRITHMATH_MAP_LAYOUTS[2], "#10141f", "#323a50", accent, "#3a4360"))
    parts.append(onion_dome_house(495, 276, 110, 128, "#2c3650", "#e0b040", INK))
    for chapel_x, chapel_y in ((268, 214), (716, 214), (288, 436), (608, 436)):
        parts.append(onion_dome_house(chapel_x, chapel_y, 60, 68, "#26304a", "#e0b040", INK, 0.85))
    for drift_x, drift_y, drift_rx, drift_ry in (
        (550, 420, 90, 20), (300, 300, 70, 16), (800, 320, 70, 16), (560, 120, 90, 16),
    ):
        parts.append(ellipse(drift_x, drift_y, drift_rx, drift_ry, "#3a4360", opacity=0.4))
    for fir_x, fir_y, fir_width, fir_height in (
        (60, 120, 26, 44), (110, 150, 22, 38), (980, 100, 24, 42), (1040, 150, 22, 36),
        (60, 620, 24, 40), (1040, 640, 24, 40), (300, 640, 22, 36), (760, 660, 22, 36),
    ):
        parts.append(conifer_unit(fir_x, fir_y, fir_width, fir_height, "#2e4a40", "#3a2a1c"))
    parts.append(fence_run(470, 430, 630, 430, "#3a2a1c", 0.6))
    parts.append(birds_unit(500, 80, accent, 3, 0.5))
    parts.append(scatter_dots(550, 360, 300, 44, "#c8d6e2", 0.1))
    parts.append(region_frame(accent))
    return svg_root("".join(parts))


def chrithmath_map_images() -> list[str]:
    return [yule_vale_map(), sunspice_coast_map(), icon_snows_map()]


def map_overlay_elements(layout: dict) -> str:
    positions = {(node["kind"], node["level"]): (node["x"], node["y"]) for node in layout["nodes"]}
    parts = []
    for connection in layout["connections"]:
        start = positions[(connection["from"]["kind"], connection["from"]["level"])]
        end = positions[(connection["to"]["kind"], connection["to"]["level"])]
        branch = connection["from"]["kind"] == "progressive" or connection["to"]["kind"] == "progressive"
        parts.append(line(start[0], start[1], end[0], end[1], "rgba(236,228,214,0.26)", 6,
                          dash="16 12" if branch else None))
    for node in layout["nodes"]:
        progressive = node["kind"] == "progressive"
        parts.append(circle(node["x"], node["y"], 34, "rgba(217,164,65,0.16)",
                            "rgba(217,164,65,0.75)", 5,
                            dash="14 10" if progressive else None))
        label = f"P{node['level']}" if progressive else str(node["level"])
        parts.append(text_element(node["x"], node["y"] + 10, label, "#ece4d6", 30, 1,
                                  "middle", None, 700))
    return "".join(parts)


def region_map_preview_html(map_image: str, layout: dict, title: str) -> str:
    overlay = map_overlay_elements(layout)
    combined = map_image.replace("</svg>", overlay + "</svg>")
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"/>'
        f"<title>{title}</title><style>"
        "html,body{margin:0;padding:0;background:#101010;}"
        "svg{display:block;width:1100px;height:700px;}"
        "</style></head><body>" + combined + "</body></html>"
    )


def aftermath_map_images() -> list[str]:
    return [rustbloom_wastes_map(), sand_and_regret_map(), ashen_highs_map()]


def theme_map_images(theme_id: str) -> list[str]:
    if theme_id == "default":
        return polymath_map_images()
    if theme_id == "the-aftermath":
        return aftermath_map_images()
    if theme_id == "chrithmath":
        return chrithmath_map_images()
    raise SystemExit(f"unknown theme id: {theme_id}")


def theme_map_layouts(theme_id: str) -> list[dict]:
    if theme_id == "default":
        return POLYMATH_MAP_LAYOUTS
    if theme_id == "the-aftermath":
        return AFTERMATH_MAP_LAYOUTS
    if theme_id == "chrithmath":
        return CHRITHMATH_MAP_LAYOUTS
    raise SystemExit(f"unknown theme id: {theme_id}")
