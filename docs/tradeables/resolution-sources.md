# How private-company valuation venues settle

As of 2026-10-26. One row per venue or product that prices a private company's valuation. OpenMarket's row is computed from its rulebook (v1.0.0, https://openmarket.systems/api/ref/rulebook). Rows marked unverified have not been confirmed against a primary source. "Unknown" marks a field the research did not establish.

License: CC BY 4.0, cite OpenMarket.

| Venue | Product | Instrument | Settles on | Rule published | Revision window | Void rule | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Polymarket | IPO-timing and valuation-threshold event contracts on OpenAI, Anthropic, Stripe, Databricks and Kraken | binary | Nasdaq Private Market data | yes | Unknown | Unknown | live |
| Soar (unverified) | Binary valuation ladders (strike by valuation threshold and date) on Anthropic, Anduril, OpenAI, Databricks, Stripe, Figure and others; spot shares planned | binary ladder | Not published for real money. Their own post on implied pricing flags Polymarket's dependency on Nasdaq Private Market marks. | no | Unknown | Unknown | paper beta |
| Pascal (unverified) | Long/short event contracts for professional traders, including markets on Anthropic and OpenAI that the team says trade like futures | long/short contract | Not found in public materials as of the as_of date | no | Unknown | Unknown | live, private beta |
| Ventuals | Pre-IPO perpetual futures on Hyperliquid (HIP-3), in units of valuation divided by one billion | perpetual | Hybrid oracle: a blend of secondary trades, priced rounds, mutual-fund marks, 409A valuations and comparables, mixed 50/50 with an 8-hour EMA of the venue's own mark; converts to a standard perp at IPO | yes | Unknown | None. Positions were settled by the venue at wind-down: OpenAI 1341.80, Anthropic 1618.90. | shut down 2026-06-15 |
| trade.xyz (unverified) | IPO perpetuals on Hyperliquid without a pre-listing oracle; the Cerebras IPO perp is the cited case | perpetual | The IPO's opening public price; no oracle before listing, which limits the product to names with a near-term listing date | yes | Unknown | Unknown | live |
| EntropyIO (unverified) | Pre-IPO perpetuals on Hyperliquid, starting with Anthropic | perpetual | Not found in public materials as of the as_of date | no | Unknown | Unknown | announced |
| Liquid (liquid.trade) | Non-custodial front end routing to Hyperliquid, Lighter and Ostium; lists perps on OpenAI and Anthropic beside prediction-market positions | front end (perpetuals) | Whatever the routed venue publishes; Liquid is a distributor, not a settlement venue | no | Unknown | Unknown | live |
| Freeport Markets (unverified) | Trading front end for pre-IPO shares, equities, crypto and perpetuals with AI-generated trade ideas (YC F25) | front end (shares, perpetuals) | No published pricing methodology for the pre-IPO names it shows | no | Unknown | Unknown | live |
| American Perpetuals Exchange (APEC) | Planned CFTC-regulated perpetual futures on single-name public equities and indices under joint CFTC/SEC oversight | perpetual (planned) | Public equity prices; no private names proposed | yes | Unknown | Unknown | pre-launch; DCM and DCO applications planned |
| Kalshi (unverified) | CFTC-regulated event contracts; BTCPERP approved May 2026; no private-company valuation contracts found | none on private names | Not applicable; Kalshi has no published settlement source for private-company valuations | no | Unknown | Unknown | no private-name contracts as of the as_of date |
| OpenMarket | Quarterly timing binary (a priced round by quarter-end; a public S-1 for the labs) and a cash-settled forward on the next post-money, as the rulebook specifies them; OpenMarket quotes neither | binary and forward | The post-money valuation of a priced primary equity round, publicly reported. For the labs, also an IPO's first-day closing market capitalisation. Ranked sources: 1 Company or lead-investor release; 2 SEC filing; 3 Two independent Tier-1 outlets citing closed terms; 4 One Tier-1 outlet citing closed terms. Tier-1 outlets: Bloomberg, Reuters, The Wall Street Journal, Financial Times, The Information, TechCrunch, Axios, The New York Times. | yes | 7 days for a higher-ranked source, plus 1 day of observation grace after the deadline | No print by expiry voids every position with full refund of collateral. | rulebook published; no market live (the v1 paper markets are archived) |

## Notes

**Polymarket.** The closest live comp to OpenMarket's quarterly binary. Resolution depends on a single third-party data provider; no public review of resolution quality has been published as of the as_of date. Threshold contracts on Volmex indices and HIP-3 open-interest markets are also listed. Launched 2026-05-19. Sources read 2026-10-26.

**Soar.** Direct competitor on the same names. Their design essays argue for keeping binaries and rebuilding the order book with cross-rung netting. Funding and backers not disclosed. Settlement for live money is the open question. Launched 2026-06-09. Sources read 2026-10-26.

**Pascal.** Solana funds, offchain matching engine, 0.01 fee constant with a 50% maker rebate. Seed from Wintermute Ventures and DBA (Aug 2025), $9M Series A led by USV (Jul 2026). The founder has said insider trading on open venues is arguably price discovery. Launched 2026-06. Sources read 2026-10-26.

**Ventuals.** The oracle failure that defines the category: on 2026-05-28 the SpaceX perp fell about 45% in 30 minutes on bad offchain data, 484 users were liquidated for $1.74M and the venue compensated them. Cumulative volume about $650M, 11k traders. The founding team joined Phantom on 2026-06-30 to build wallet-native perps and private-market trading. The founder wrote that lab employees used the book to mark their own equity. Launched 2025-09. Sources read 2026-10-26.

**trade.xyz.** Pantera's June 2026 map reports the Cerebras perp settled within 3% of the open. trade.xyz co-signed the Hyperliquid Policy Center's August 2026 letter to the SEC proposing that pre-IPO perps list only inside a window after a public S-1 filing, with the oracle and settlement disclosed in advance. Launched 2026. Sources read 2026-10-26.

**EntropyIO.** $14M seed led by Ribbit Capital (Aug 2026); team from Citadel, Optiver, Polymarket and Millennium. The nearest funded competitor on the same first name. No settlement rule located; fill in from their docs when they publish. Launched 2026-08.

**Liquid (liquid.trade).** About $3B volume and 40k users by May 2026; $25.6M raised (Paradigm led the seed; Left Lane co-led the April 2026 extension). The founder cites the CFTC's Phantom no-action letter for not registering as a broker or exchange. A reference-price customer, not a comp. Launched 2025. Sources read 2026-10-26.

**Freeport Markets.** Three to five people in New York; backed by YC, Inventum and Alliance. Founder is an ex-Jane Street, IMC and Akuna options trader. A reference-price customer. Launched 2025-10. Sources read 2026-10-26.

**American Perpetuals Exchange (APEC).** About $30M led by Lux Capital at about $300M (June 2026). The June 4, 2026 SEC Harmonization Initiative memo asks for a DCM license with an exemption to list perps on securities. The memo does not address a reference price for names with no spot market, which is the gap OpenMarket sits in. Sources read 2026-10-26.

**Kalshi.** The DCM a US listing would resemble. Kalshi's contract rules go through CFTC self-certification; its head of research has described the resolvability test on the record. A third-party reference price is what Kalshi would need to list these names. Sources read 2026-10-26.

**OpenMarket.** The rulebook is code, versioned (v1.0.0), and published as JSON at /api/ref/rulebook. Sources read 2026-10-26.

## Context

**Hyperliquid Policy Center letter to the SEC on pre-IPO perps (2026-08-18).** Five pillars: classification, disclosures, listing eligibility only inside a window after a public S-1, phased access with leverage and position limits, market-integrity controls on deployer MNPI. Cites the SK Hynix oracle anomaly in which one trade moved a mark 18%.

**Pantera, Tokenized Startups: Restoring Access to Pre-IPO Companies (2026-06-08).** Maps Jarsy, Ventuals, PreStocks, trade.xyz, RVI and USVC. Flags Ventuals' oracle risk from unaudited valuation rumors, notes that Ventuals-style perps are security-based swaps barred from US retail, and that founders can void tokenized sales.

## Sources

1. https://theblock.co/post/401866/polymarket-rolls-out-prediction-markets-tracking-ipos-valuations-for-private-companies-like-openai-and-spacex
2. https://www.shopifreaks.com/polymarket-launches-prediction-markets-for-private-company-ipo-timing-and-valuations-powered-by-nasdaq-private-market-data/
3. https://trysoar.com/blog/stop-reinventing-the-bet-fix-the-book
4. https://trysoar.com/blog/what-is-implied-pricing
5. https://trysoar.com/blog/markets-were-committed-to-building
6. https://www.wintermute.com/insights/views/opinions/the-prediction-market-boom-has-an-infrastructure-problem
7. https://fortune.com/2026/07/16/exclusive-prediction-market-startup-pascal-9-million-heavyweights-kalshi-and-polymarket/
8. https://www.usv.com/writing/2026/07/pascal/
9. https://www.hypurr.co/blog-posts/uncoil-x-hypurrco-community-research-ventuals-perpetual-futures-on-innovation
10. https://www.theblock.co/post/402991/
11. https://www.banklesstimes.com/articles/2026/06/15/ventuals-winds-down-after-650m-in-pre-ipo-perps-volume/
12. https://cryptobriefing.com/phantom-integrates-ventuals-team-trading/
13. https://www.thetokendispatch.com/p/pricing-anthropic
14. https://panteracapital.com/tokenized-startups-restoring-pre-ipo-companies/
15. https://cryptobriefing.com/hyperliquid-tradexyz-sec-pre-ipo-perpetuals/
16. https://crypto.news/hyperliquid-proposes-5-rule-pillars-for-pre-ipo-perps/
17. https://www.theblock.co/post/402496/liquid-launches-co-invest
18. https://liquid.trade/
19. https://www.ycombinator.com/companies/freeport-markets
20. https://www.ycombinator.com/launches/OeQ-freeport-intelligent-defi-investment-platform
21. https://www.sec.gov/files/harmonization-memo-apec-060426.pdf
22. https://theblock.co/post/405334/sen-gillibrand-son-building-perps-exchange-dual-cftc-sec-oversight
23. https://www.coindesk.com/policy/2026/05/28/u-s-cftc-opens-crypto-perp-door-with-approval-of-first-regulated-firm
24. https://shows.acast.com/on-the-tape-with-danny-moses/episodes/nicole-kagan-empowering-kalshi-through-research
25. https://openmarket.systems/api/ref/rulebook
