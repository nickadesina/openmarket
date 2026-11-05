# Research inputs (private)

Raw material pulled by scripts for reading, not for publishing. Nothing
here leaves the repo until Nick has read it and written the note it feeds.
Each output records when it was fetched in its own README.

| Output | Script | Feeds |
| --- | --- | --- |
| `polymarket-private-markets.csv` | `scripts/research/polymarket-private-markets.ts`, archived with v1 (`git show archive/dealer-v1:scripts/research/polymarket-private-markets.ts`) | the resolution-quality note |

The fund-marks pull that used to live here (`fund-marks.csv`,
`scripts/research/edgar-nport-marks.ts`) became the index itself:
`npm run index:ingest -- --source=nport` writes the `filer_marks` table,
published at `/data/filer-marks.csv`. v1's LMSR comparison
(`backtest/uniform_loss_vs_lmsr.py`) is archived with the backtest at
`archive/dealer-v1`.
