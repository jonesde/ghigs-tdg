#!/usr/bin/env python3
"""Regenerate the mapImage and menuBackground values in the shipped theme JSON files.

Only the four art values per theme (three region mapImage values plus one
menuBackground) are rewritten; every other byte of each JSON file is
preserved, including the compact mapLayout formatting. The layouts in the
files are verified against region_map_art first so the art can never drift
away from the node coordinates it was drawn around.

The menuBackground is also written to the theme's sidecar file, which is what
the main-menu world card paints from, and the sidecar is read back to confirm
the two copies agree.
"""

from __future__ import annotations

import json
import os
import sys

SCRIPT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIRECTORY)
import menu_background_art  # noqa: E402
import region_map_art  # noqa: E402
import theme_field_patch  # noqa: E402

THEME_PATHS = {
    "default": os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "default-map-theme.json")),
    "the-aftermath": os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "the-aftermath.json")),
    "chrithmath": os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "chrithmath.json")),
}
# The main-menu world card paints from these sidecars instead of loading each theme
# in full, so they duplicate the menuBackground each theme JSON already carries.
# Both files are written here in the same pass; nothing else regenerates them.
MENU_BACKGROUND_PATHS = {
    "default": os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "default-menu.json")),
    "the-aftermath": os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "the-aftermath-menu.json")),
    "chrithmath": os.path.normpath(os.path.join(SCRIPT_DIRECTORY, "..", "data", "chrithmath-menu.json")),
}
PREVIEW_DIRECTORY = os.path.normpath(
    os.path.join(SCRIPT_DIRECTORY, "..", "..", "..", "..", "tmp", "region-map-preview")
)


def verify_layouts_match(raw_text: str, theme_id: str) -> None:
    theme = json.loads(raw_text)
    layouts = region_map_art.theme_map_layouts(theme_id)
    if len(theme["regions"]) != len(layouts):
        raise SystemExit(f"{theme_id}: region count drifted from region_map_art")
    for region, layout in zip(theme["regions"], layouts):
        if region["mapLayout"] != layout:
            raise SystemExit(f"{theme_id} region {region['id']}: mapLayout drifted from region_map_art")


def write_menu_background_sidecar(theme_id: str, menu_image: str) -> str:
    sidecar_path = MENU_BACKGROUND_PATHS[theme_id]
    sidecar_text = json.dumps({"menuBackground": menu_image}, indent=2, ensure_ascii=False) + "\n"
    with open(sidecar_path, "w", encoding="utf-8") as sidecar_file:
        sidecar_file.write(sidecar_text)
    return sidecar_path


def verify_sidecar_matches_theme(theme_id: str, menu_image: str) -> None:
    sidecar_path = MENU_BACKGROUND_PATHS[theme_id]
    with open(sidecar_path, encoding="utf-8") as sidecar_file:
        sidecar = json.load(sidecar_file)
    if sidecar.get("menuBackground") != menu_image:
        raise SystemExit(f"{theme_id}: {os.path.basename(sidecar_path)} drifted from the theme menuBackground")


def write_previews(theme_id: str, map_images: list[str], menu_image: str) -> None:
    layouts = region_map_art.theme_map_layouts(theme_id)
    os.makedirs(PREVIEW_DIRECTORY, exist_ok=True)
    previews = [(f"{theme_id}-menu", menu_image, 1600, 900)]
    for region_index, (image, layout) in enumerate(zip(map_images, layouts)):
        previews.append((
            f"{theme_id}-{region_index}",
            region_map_art.region_map_preview_html(image, layout, f"{theme_id}-{region_index}"),
            1100, 700,
        ))
    for name, html, width, height in previews:
        page = (f'<!DOCTYPE html><html><head><meta charset="utf-8"/><title>{name}</title>'
                f"<style>html,body{{margin:0;padding:0;background:#101010;}}"
                f"svg{{display:block;width:{width}px;height:{height}px;}}"
                f"</style></head><body>{html}</body></html>")
        with open(os.path.join(PREVIEW_DIRECTORY, f"{name}.html"), "w", encoding="utf-8") as page_file:
            page_file.write(page)


def main() -> None:
    for theme_id, theme_path in THEME_PATHS.items():
        with open(theme_path, encoding="utf-8") as theme_file:
            raw_text = theme_file.read()
        verify_layouts_match(raw_text, theme_id)
        map_images = region_map_art.theme_map_images(theme_id)
        menu_image = menu_background_art.theme_menu_background(theme_id)
        for region_index, image in enumerate(map_images):
            region_map_art.assert_map_paint(image, f"{theme_id} region {region_index}")
        menu_background_art.assert_menu_paint(menu_image, f"{theme_id} menu background")
        patched_text = theme_field_patch.replace_field_value_spans(
            raw_text, "mapImage", [json.dumps(image, ensure_ascii=False) for image in map_images]
        )
        patched_text = theme_field_patch.replace_top_level_value(
            patched_text, "menuBackground", json.dumps(menu_image, ensure_ascii=False)
        )
        with open(theme_path, "w", encoding="utf-8") as theme_file:
            theme_file.write(patched_text)
        sidecar_path = write_menu_background_sidecar(theme_id, menu_image)
        verify_sidecar_matches_theme(theme_id, menu_image)
        write_previews(theme_id, map_images, menu_image)
        print(f"{theme_id}: patched {len(map_images)} mapImage + 1 menuBackground "
              f"({len(raw_text)} -> {len(patched_text)} bytes), "
              f"wrote {os.path.basename(sidecar_path)}")
    print(f"previews: {PREVIEW_DIRECTORY}")


if __name__ == "__main__":
    main()
