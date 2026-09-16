# Quote templates — what Finance actually wants to see

`FeedSpark_Reiss_Quote_Sept_26.xlsx` is the **governing reference** for the Quote generator's
Excel export (`/aiquote` → ⇩ Export quote). Ray, 16 Sep 2026:

> "this is the output excel that our Finance team wants to see — so stick as close to this format
> as possible — especially section that covers One-off section and Monthly cost"

The export in `docs/FeedSpark_AIQuote.html` (`quoteSheet()`) replicates it: the header block, the
three cost bands in Finance's order, their section headings, their subtotal and grand-total rows,
their column map (A/B label · D:F Quantity/Cost/Total · H:I Discount · K Net · M Additional Notes),
their fills, their number formats, their `Dayrate` defined name and their live formulas.

Read this file before changing the export. `tools/../scratchpad` harness
`qa_aiquote_v21_fin.mjs` pins the shape; the CLAUDE.md `/aiquote` entry records the mapping and the
two deliberate departures (money shows pence; the date reads dd/mm/yyyy).

Drop a newer workbook in here when Finance changes their layout, and re-point the export at it.
