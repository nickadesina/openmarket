# Research inputs (private)

Raw material pulled by scripts for reading, not for publishing
(`docs/prompts/tradeables/README.md`, "Research scripts"). Nothing here
leaves the repo until Nick has read it and written the note it feeds.
Each script is idempotent and records when it fetched in its own README.

| Output | Script | Feeds |
| --- | --- | --- |
| `polymarket-private-markets.csv` | `scripts/research/polymarket-private-markets.ts` | the resolution-quality note (research backlog 3) |
| `fund-marks.csv` | `scripts/research/edgar-nport-marks.ts`, since promoted to `npm run index:ingest -- --source=nport` (the `filer_marks` table) | the mark-dispersion figure (research backlog 4) |
| `backtest/out/uniform_loss_comparison.csv` | `backtest/uniform_loss_vs_lmsr.py` | the comparison table for Moallemi; `sim.py` never leaves |
