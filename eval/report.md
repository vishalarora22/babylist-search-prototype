# Search quality eval: Babylist search vs prototype

Snapshot of Babylist's public product-search API (`/api/v3/products`), 40 queries, nDCG@10 and strict P@5.

> **Labels are category proxies written by the author, not human judgments.** A result counts as relevant if its Babylist category matches the query's intent (eval/queries.json). Read the numbers as directional.

- **Babylist**: the raw query sent to the API, in the API's order.
- **Prototype**: `lib/search-core.js`: typo map, price-cap parsing, rule-based rewrite of need-style queries, then re-ranking (no persona).

## By query class

| Class | Queries | nDCG@10 Babylist | nDCG@10 Prototype | P@5 Babylist | P@5 Prototype | Zero results (B / P) |
|---|---|---|---|---|---|---|
| head | 10 | 0.96 | 0.96 | 0.98 | 0.98 | 0 / 0 |
| specific | 6 | 0.90 | 0.90 | 0.93 | 0.93 | 0 / 0 |
| need | 8 | 0.39 | 0.63 | 0.30 | 0.55 | 1 / 0 |
| price | 6 | 0.09 | 0.84 | 0.10 | 0.83 | 0 / 0 |
| typo | 8 | 0.76 | 0.79 | 0.77 | 0.82 | 1 / 1 |
| **all** | 38 | **0.65** | **0.83** | 0.65 | 0.83 | 2 / 1 |

## Price constraints

Share of top-10 results over the stated price cap (or unpriced):

| Query | Babylist results | Babylist over cap | Prototype over cap |
|---|---|---|---|
| stroller under $200 | 1 | 0.00 | 0.00 |
| car seat under $150 | 400 | 0.70 | 0.00 |
| high chair under $100 | 1 | 0.00 | 0.00 |
| baby monitor under $100 | 1 | 0.00 | 0.00 |
| crib under $300 | 1 | 0.00 | 0.00 |
| baby carrier under $80 | 35 | 0.90 | 0.00 |

## Out-of-catalog queries

Ideal behavior is zero results plus a route to other retailers.

| Query | Babylist results | Top result |
|---|---|---|
| ps5 | 0 | (none) |
| lawn mower | 3 | Boon Lawn Countertop Drying Rack - Green [Bottle Accessories] |

## Per query

| Query | Class | Prototype rewrite | nDCG B | nDCG P | Δ |
|---|---|---|---|---|---|
| stroller | head | – | 1.00 | 1.00 | 0.00 |
| car seat | head | – | 1.00 | 1.00 | 0.00 |
| crib | head | – | 0.95 | 0.95 | 0.00 |
| bassinet | head | – | 0.78 | 0.78 | 0.00 |
| baby monitor | head | – | 1.00 | 1.00 | 0.00 |
| breast pump | head | – | 1.00 | 1.00 | 0.00 |
| high chair | head | – | 0.93 | 0.93 | 0.00 |
| diaper bag | head | – | 0.95 | 0.95 | 0.00 |
| baby carrier | head | – | 1.00 | 1.00 | 0.00 |
| swaddle | head | – | 1.00 | 1.00 | 0.00 |
| compact stroller | specific | – | 0.73 | 0.73 | 0.00 |
| travel stroller | specific | – | 0.92 | 0.92 | 0.00 |
| double stroller | specific | – | 0.83 | 0.83 | 0.00 |
| infant car seat | specific | – | 1.00 | 1.00 | 0.00 |
| convertible car seat | specific | – | 0.91 | 0.91 | 0.00 |
| crib mattress | specific | – | 1.00 | 1.00 | 0.00 |
| best stroller for urban family | need | "compact stroller" | 0.00 | 0.73 | +0.73 |
| stroller for a small car trunk | need | "stroller car trunk" | 0.16 | 0.22 | +0.06 |
| lightweight stroller for travel | need | "lightweight stroller travel" | 0.93 | 0.84 | -0.09 |
| stroller for twins | need | "double stroller" | 0.17 | 0.78 | +0.61 |
| bottle for baby with colic and reflux | need | "anti-colic bottle" | 0.36 | 1.00 | +0.64 |
| something to help baby sleep | need | – | 1.00 | 1.00 | 0.00 |
| monitor that works without wifi | need | – | 0.47 | 0.47 | 0.00 |
| what do I need for feeding a newborn | need | "what do feeding newborn" | 0.00 | 0.00 | 0.00 |
| stroller under $200 | price | "stroller" | 0.00 | 0.65 | +0.65 |
| car seat under $150 | price | "car seat" | 0.11 | 1.00 | +0.89 |
| high chair under $100 | price | "high chair" | 0.22 | 0.71 | +0.49 |
| baby monitor under $100 | price | "baby monitor" | 0.00 | 1.00 | +1.00 |
| crib under $300 | price | "crib" | 0.00 | 0.80 | +0.80 |
| baby carrier under $80 | price | "baby carrier" | 0.20 | 0.91 | +0.70 |
| stroler | typo | "stroller" | 1.00 | 1.00 | 0.00 |
| carseat | typo | "car seat" | 0.71 | 1.00 | +0.29 |
| matress | typo | "mattress" | 1.00 | 1.00 | 0.00 |
| bottel | typo | "bottle" | 1.00 | 1.00 | 0.00 |
| moniter | typo | "monitor" | 1.00 | 1.00 | 0.00 |
| bassinett | typo | – | 0.78 | 0.78 | 0.00 |
| pacifer | typo | – | 0.57 | 0.57 | 0.00 |
| hihg chair | typo | – | 0.00 | 0.00 | 0.00 |

## Biggest wins

- **baby monitor under $100** (0.00 → 1.00)
  - Babylist top 3: Nanit Floor Stand Accessory [Monitor Accessories, $80.00]
  - Prototype top 3: Babysense HD Split Screen Video Baby Monitor HD S2 - 1 Camera [Video Monitors, $99.98]; Motorola VM85 5" WiFi Smart Video Baby Monitor - 1 Camera [Video Monitors, $79.99]; Momcozy 5" 1080P Non-WiFi Video Baby Monitor BM01 - White [All Monitors, $97.99]
- **car seat under $150** (0.11 → 1.00)
  - Babylist top 3: Babylist Convertible Car Seat Fund [Cash Funds, $0.00]; Nuna LUMN Car Seat - Caviar [Convertible Car Seats, $680.00]; Joie Rue Infant Car Seat with Base - Mocha [Infant Car Seats, $169.99]
  - Prototype top 3: Graco SnugRide SnugFit Infant Car Seat - Gotham [Infant Car Seats, $143.99]; Graco SnugRide Lite LX Infant Car Seat - Studio [Infant Car Seats, $111.99]; AXKID Infant insert 16-23" (ONE 3) - Coastal Storm Black [Infant Car Seats, $100.00]
- **crib under $300** (0.00 → 0.80)
  - Babylist top 3: Nanit Floor Stand Accessory [Monitor Accessories, $80.00]
  - Prototype top 3: Delta Children Essex 4-in-1 Convertible Baby Crib - Bianca White With Natural Legs [Cribs, $175.99]; Kyte Baby Crib Sheet - Blush [Crib Sheets, $44.00]; daVinci Otto 3-in-1 Convertible Crib - Walnut [Cribs, $279.20]
- **best stroller for urban family** (0.00 → 0.73)
  - Babylist top 3: Thule Urban Glide 3 Bassinet - Black [Additional Seats & Bassinets]; Thule Urban Glide 3 Double - Black [Double Strollers]
  - Prototype top 3: Joie Compact Stroller Bag - Black [Travel Bags]; Graco Ready2Jet Compact Stroller [Travel Strollers]; Silver Cross Clic Compact Stroller - Latte [Travel Strollers]

## Biggest regressions

- **lightweight stroller for travel** (0.93 → 0.84)
  - Babylist top 3: Graco Ready2Jet Compact Stroller [Travel Strollers]; Joolz Aer2 Stroller - Space Black [Travel Strollers]; UPPAbaby Minu V3 Stroller - James [Travel Strollers]
  - Prototype top 3: Cybex LIBELLE Ultra Lightweight Travel Stroller - Magic Black [Travel Strollers]; Nuna TRVL lx + PIPA urbn - Cedar [Travel Systems]; Nuna TRVL Easy Fold Compact Stroller & Carry Bag - Caviar/Cognac [Travel Strollers]
