# Objection catalog

What people said about OpenMarket, in their words, with the design
element it hits and the current answer. One row per objection. Add a
row within a day of every call. `scripts/export-objections.ts` writes
`objections-anon.md` (role and firm type only, answer column dropped);
that file is the one that leaves the repo. Names appear here only when
the person said it on the record or in print.

Design elements: settlement, classification (SBS vs CFTC), depth
(two-sided interest), why-you (vs Entropy, Polymarket, Kalshi,
Pascal, Soar), mechanism (dealer, LMSR, clip, cap), rails (Solana,
offshore, geofence), reference-price demand, team.

| Date | Who | Objection, in their words | Element | Current answer | Status |
| --- | --- | --- | --- | --- | --- |
| 2026-10-08 | President, Pantera Capital (in person, Token2049) | Depth of interest on both sides of the bet is the concern. Continuous pricing of these assets has been wanted for a long time and nobody has figured it out. | depth | The venue is the dealer, so there is a quote before there is interest; the position cap bounds what the dealer can lose while the book is one-sided. The backtest's public outputs show how often each name printed. Depth is still the right objection and the paper books are the evidence to collect. | open |
| 2026-06-08 | Jay Yu, then Pantera, in "Tokenized Startups" (published) | Ventuals died on a rumor-fed oracle. | settlement | Settlement is a published, versioned source hierarchy on a priced round's post-money, not a blended oracle, and no print voids with refund. | answered |
| 2026-06-08 | Jay Yu, same piece | trade.xyz's oracle-less perp only worked because Cerebras had a listing date. | settlement | The binary resolves on an announcement, and the forward settles on the print or voids; neither needs a listing date or a spot price. | answered |
| 2026-06-08 | Jay Yu, same piece | A single-name pre-IPO perp is a security-based swap barred from US retail. | classification | Not resolved. The quarterly binary is an event contract; the forward's classification is the open legal question and the reason the first venue is offshore and US-geofenced with a DCM listing as the business. | open |
| 2026-10-15 | dingaling (@dingalingts, Predict.fun), in conversation | You will get fleeced on an AMM. | mechanism | The dealer quotes around a model mid with a hard position cap and widens on event flags; the backtest against an insider who knows every print puts the loss at about a fifth of the bound carried. An order book comes with flow. | answered |
| 2026-08 | a16z Speedrun alpha (rejection, no reason given) | No. | team / why-you | Reapplied to SR008 with the current design. The objection has no words, so the answer is the artifact list. | open |
| 2026-10-19 | Nick, anticipating VCs | The thesis is not pinned down the way APEC pinned theirs. | why-you | Five names, two contracts each, one rulebook, a reference-price business; the deck is modeled on APEC's harmonization memo. | answered |
| 2026-10-26 | Research pass over the pipeline (several investors' published views) | Polymarket already lists OpenAI and Anthropic valuation contracts settled on Nasdaq Private Market data, so the binary exists. | why-you | Polymarket's contracts depend on one data vendor and no published revision rule; OpenMarket publishes the hierarchy and the reference price is the product, with the binary as one input. The resolution-source map is the answer in one page. | open |
