# Ground Held is Ground Stood

GHiGS is a browser-based tower defense game with pure SVG rendering, gem-based meta-progression, and an upgrade unlock system. Built with Vue 3, Pinia, and Vite.

**Human Goals**

1. Explore and refine AI assisted coding workflow and toolset, both AI-specific tools like OpenCode and general coding tools like compilers, linters, formatters, and frameworks that help steer AI toward .
2. Build a burnout game: casual engagement for distraction, felt progress for reward; player in control while game does all the work

**AI Usage**

This application is primarily AI generated with lazy human auditing (no full human audit; human audit as needed). Initial one-shot was done by GLM 5.2, a no-build HTML/CSS/JS app with all canvas rendering. All work since then has been done by Qwen 3.6 27B and Ornith 1.0 35B running local, including the refactorings to use VueJS and compiled TypeScript. See the old_plans directory for some of the more significant changes along the way.

## Overview

Defend your base against 100 waves of enemies across 36 procedurally-generated maps spanning 3 regions. Place and upgrade 8 tower types with deep specialization trees, earn gems to unlock permanent upgrades in the skill tree, and adjust difficulty to scale both enemy power and gem rewards.

### Game Features
- **36 maps** across 3 regions (Verdant Marches, Sunscorch Coast, Thornpeak Wilds), each with increasing difficulty and different gem multipliers
- **Map themes** selectable on the map-select screen: swaps visual identity (SVG sprites, tile images, base art, display names) of towers, enemies, and maps without affecting gameplay stats
- **8 tower types** with 3 specialization variants each (unlock at level 4)
- **6 enemy types** including minions, runners, tanks, shielded, healers, and bosses
- **Gem economy** with milestone rewards, first-time bonuses, and difficulty scaling
- **General add-ons** for starting gold/health, upgrade cost reduction, terrain bonuses, and damage milestones

## Keyboard Controls

| Key | Action |
|---|---|
| `Escape` / `x` | Close open dialogs (equivalent to Cancel/Resume/etc button in dialog), or if none then exit build mode if active, or if not then deselect selected tower if one selected, or if none then toggle pause menu dialog |
| `Enter` | If dialog open and has default/active button (like OK) then same as button press |
| `Spacebar` | Toggle pause state (state change only, do not open pause menu dialog; if pause menu dialog open then do same as Escape: close and unpause) |
| `Tab` | If build mode active then cycle tower type (next to the right in the shop menu, from last loop back to first), or if no build mode then cycle time scale forward (1× → 2× → 4× → 8×) |
| `Shift` + `Tab` | Same as `Tab` but in reverse (previous tower type in build mode, or reverse cycle time scale 8× → 4× → 2× → 1×) |
| `1`–`9` | Build mode for corresponding tower type (use current shop panel order; support up to 9 even though there are only 6 towers now) |
| `Up Arrow` / `Down Arrow` / `Left Arrow` / `Right Arrow` | Move tower selection in that direction (direction-priority search); in build mode: move build position. Once zoomed in, the view pans when that tile or placement site comes within 20% of the screen width of an edge, and only far enough to clear that line |
| `Page Up` / `Page Down` | Zoom in / zoom out. Page Down returns to the whole map |
| `w` or `u` | Upgrade the selected tower. If the tower needs specialization and only one specialization is available, selects it directly |
| `e` or `c` | When the selected tower needs specialization: `e` selects Specialization A, `c` selects Specialization B |
| `a` | Reverse cycle time scale (8× → 4× → 2× → 1×) |
| `s` | Downgrade the selected tower if level >1, otherwise sell it; nothing if no tower selected |
| `d` | Cycle time scale forward (1× → 2× → 4× → 8×) |
| `f` | Cycle targeting mode on the selected tower (first → last → closest → strong → furthest) |
| Click on empty tile (build mode) | Place selected tower |
| Click on tower | Select tower for upgrade/sell |
| Click upgrade button (on selected tower) | Upgrade tower |

### Mouse Controls

| Input | Action |
|---|---|
| Wheel | Zoom in (wheel up) or out (wheel down) about the cursor |
| Right-button drag | Pan the view |
| Alt + left-button drag | Pan the view |

On a progressive map, opening a block choice zooms the view back out to the whole board.

## Tech Stack

| Library | Version | Purpose |
|---|---|---|
| **Vue 3** | ^3.5.0 | Reactive components, `<script setup>` syntax |
| **Vue Router** | ^4.5.0 | Screen navigation (`/`, `/map-select`, `/game`, `/skill-tree`, `/game-over`, `/victory`, `/history`) |
| **Pinia** | ^3.0.0 | State management (4 stores: `game`, `persist`, `ui`, `mapTheme`) |
| **Vite** | ^6.0.0 | Build tool with HMR, code splitting, and tree-shaking |

No UI component libraries — all styling uses scoped CSS with CSS custom properties for theming.

## Build & Run

### Prerequisites
- Node.js 18+
- npm

### Development
```bash
npm install
npm run dev
```
Starts Vite dev server at `http://localhost:3000` with HMR.

### Production Build
```bash
npm run build
```
Outputs optimized, code-split assets to `dist/`.

### Preview Production Build
```bash
npm run preview
```
Serves the `dist/` directory locally.

### Linting & Formatting

This project uses [Biome](https://biomejs.dev) for linting and formatting.

```bash
# Check for lint and format issues
npm run lint

# Auto-fix lint and format issues
npm run lint:fix

# Check formatting only
npm run format

# Auto-fix formatting only
npm run format:fix
```

### Type Checking

This project uses TypeScript with `tsc` in `--noEmit` mode for full type checking of `.ts` and `.vue` files. The `tsconfig.json` enables `strict: true` and `allowJs: false`, meaning only TypeScript files are type-checked.

```bash
# Type-check all TypeScript and Vue files
npm run typecheck
```

## Testing

### Run Tests

```bash
npm run test
# or equivalently:
npx vitest run
```

Runs all tests with Vitest (jsdom environment).

### Partial Test Runs

```bash
# Run a single test file
npm run test -- tests/unit/towers.test.ts

# Run all tests in a directory
npm run test -- tests/unit/components/

# Run only component tests
npm run test -- tests/unit/components/game-shop.test.ts tests/unit/components/tower-panel.test.ts

# Watch mode (re-runs on file changes)
npm run test:watch

# Watch mode for a specific file
npm run test:watch -- tests/unit/enemies.test.ts

# Run matching by name
npm run test -- -t "sell value"

# Run with coverage report
npm run test -- --coverage
```

## For Developers

Detailed architecture, file structure, design decisions, and testing coverage are documented in [TECHNICAL.md](./TECHNICAL.md).

