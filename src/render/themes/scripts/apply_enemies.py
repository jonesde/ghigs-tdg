#!/usr/bin/env python3
"""Superseded by gen_aftermath_theme.py. Do not run this against the-aftermath.json.

Replace enemies section in the-aftermath.json with generated sprites.
"""
import json

# Load generated enemies
with open('/tmp/enemies_output.json') as f:
    new_enemies = json.load(f)

# Load the original theme file
with open('/home/jonesde/agents/lol-ya-tdg/src/render/themes/data/the-aftermath.json') as f:
    theme = json.load(f)

# Verify original enemies exist
print("Original enemy keys:", list(theme['enemies'].keys()))

# Replace enemies
theme['enemies'] = new_enemies['enemies']

# Merge new tower definitions (preserves existing towers)
new_towers = new_enemies.get('towers', {})
for tower_key, tower_def in new_towers.items():
    theme['towers'][tower_key] = tower_def

# Write back with 2-space indent
with open('/home/jonesde/agents/lol-ya-tdg/src/render/themes/data/the-aftermath.json', 'w') as f:
    json.dump(theme, f, indent=2, ensure_ascii=False)
    f.write('\n')

# Verify the written file
with open('/home/jonesde/agents/lol-ya-tdg/src/render/themes/data/the-aftermath.json') as f:
    verified = json.load(f)

print("Verification passed. Enemy keys:", list(verified['enemies'].keys()))
print("Tower keys:", list(verified['towers'].keys()))
print("Region count:", len(verified['regions']))

# Verify frame counts
for etype in verified['enemies']:
    e = verified['enemies'][etype]
    wf = len(e['walking']['frames'])
    hf = len(e['hitReaction']['frames'])
    fn = e['name']
    svg_len = len(e['walking']['frames'][0]['image'])
    print(f"  {etype} ({fn}): {wf} walk frames, {hf} hit frames, first frame: {svg_len} chars")