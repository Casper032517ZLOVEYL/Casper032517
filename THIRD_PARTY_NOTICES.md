# Licenses and attribution

Original OpsPilot code and project documentation are licensed under the MIT
License in LICENSE. This grant does not replace third-party dataset rights.

## UCI Online Retail

- Chen, D. (2015). Online Retail [Dataset]. UCI Machine Learning Repository.
- DOI: https://doi.org/10.24432/C5BW33
- Source: https://archive.ics.uci.edu/dataset/352/online+retail
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
  https://creativecommons.org/licenses/by/4.0/
- Files: dist/datasets/uci-orders-nov2011.csv, uci-daily-nov2011.csv and
  uci-manifest.json.
- Changes: select UK November 2011 transactions; exclude cancellations and
  nonpositive quantity/price; aggregate to invoice and day level. Customer IDs
  and product descriptions are omitted. All amount conventions, hashes and
  exclusions are recorded in docs/REAL_DATA.md and the manifest.
- The code's MIT license does not relicense these data. Preserve attribution
  and disclose transformations when redistributing them. No endorsement by
  UCI or the dataset author is implied.

Synthetic dist/sample.csv is a regression fixture, not observed business data.
Historical docs/assets and docs/archive illustrate earlier versions; current
capabilities and verification limits are documented in README.md.
