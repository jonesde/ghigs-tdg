#!/usr/bin/env python3
"""Splice generated field values into the raw text of a theme JSON file.

Theme files are co-owned: the generators write the art fields and the file
keeps id, label and the maps override. Splicing works on the raw text so the
file-owned sections are never re-serialized, and values are rendered the way
the Biome-formatted file carries them, so a run that generates identical art
leaves the file byte-identical.
"""
from __future__ import annotations

import json
import re
from typing import Any


def find_value_span(text: str, start: int) -> int:
    """Index just past the JSON value that begins at `start`, skipping strings."""
    opening = text[start]
    if opening == '"':
        cursor = start + 1
        while cursor < len(text):
            if text[cursor] == "\\":
                cursor += 2
                continue
            if text[cursor] == '"':
                return cursor + 1
            cursor += 1
        raise SystemExit("unterminated JSON string")
    if opening in "[{":
        depth = 0
        cursor = start
        while cursor < len(text):
            char = text[cursor]
            if char == '"':
                cursor = find_value_span(text, cursor)
                continue
            if char in "[{":
                depth += 1
            elif char in "]}":
                depth -= 1
                if depth == 0:
                    return cursor + 1
            cursor += 1
        raise SystemExit("unterminated JSON value")
    raise SystemExit(f"unexpected JSON value start {opening!r}")


def render_value(value: Any) -> str:
    """Serialize a value as it appears nested one level under a top-level
    field: json.dumps at 2-space indent with a further 2 spaces on every line
    after the first. Single-line values (strings, scalars) pass through
    unchanged."""
    dumped = json.dumps(value, indent=2, ensure_ascii=False)
    lines = dumped.splitlines()
    return lines[0] + "".join("\n  " + line for line in lines[1:])


def replace_field_value_spans(text: str, field_name: str, value_texts: list[str]) -> str:
    """Swap the value of every occurrence of `field_name` (any indent) for the
    matching pre-rendered replacement, in file order."""
    field_pattern = re.compile(rf'^[ \t]*"{field_name}": ', re.MULTILINE)
    matches = list(field_pattern.finditer(text))
    if len(matches) != len(value_texts):
        raise SystemExit(f"expected {len(value_texts)} occurrences of {field_name}, found {len(matches)}")
    for match, value_text in zip(reversed(matches), reversed(value_texts)):
        value_start = match.end()
        value_end = find_value_span(text, value_start)
        text = text[:value_start] + value_text + text[value_end:]
    return text


def replace_top_level_value(text: str, field_name: str, value_text: str) -> str:
    """Swap the value of the one top-level (2-space-indented) `field_name` for a
    pre-rendered replacement."""
    field_pattern = re.compile(rf'^  "{field_name}": ', re.MULTILINE)
    matches = list(field_pattern.finditer(text))
    if len(matches) != 1:
        raise SystemExit(f"expected one top-level {field_name} field, found {len(matches)}")
    value_start = matches[0].end()
    value_end = find_value_span(text, value_start)
    return text[:value_start] + value_text + text[value_end:]


def load_theme_text(theme_path: str, expected_id: str, expected_label: str) -> str:
    """Read a theme file the generator writes into and confirm it is the right
    file, so a drifted id/label or a missing file fails before any splice."""
    try:
        with open(theme_path, encoding="utf-8") as theme_file:
            raw_text = theme_file.read()
    except FileNotFoundError:
        raise SystemExit(
            f"missing {theme_path}: create it with its id/label (and the maps override) "
            "before running the generator")
    theme = json.loads(raw_text)
    if theme.get("id") != expected_id or theme.get("label") != expected_label:
        raise SystemExit(
            f"{theme_path}: id/label is {theme.get('id')!r}/{theme.get('label')!r}, "
            f"expected {expected_id!r}/{expected_label!r}")
    return raw_text
