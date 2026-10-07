# Plan: Zod schemas + initial content packs

Implemented. Declarative game data lives in `src/content/data/*.json`, validated by Zod; `Constants*` are facades over `getGameContent()`. Variant `apply` functions replaced by declarative `statOps`. Theme / LLM / persist load boundaries also Zod-validated.

See TECHNICAL.md §"Game Content Packs (Zod)".
