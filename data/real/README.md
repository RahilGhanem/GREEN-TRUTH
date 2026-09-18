# data/real/

Real Earth-observation series produced by `notebooks/03_real_satellite_data_pipeline.ipynb`.
Not committed (derived from external data with their own licenses). Run notebook 03
and drop its outputs here:

- `flaring_by_field.csv` — real per-field annual flared-gas volumes, grouped from the
  World Bank Global Gas Flaring Tracker individual-flare-location dataset (VIIRS).
  Columns: field, year, volume, source. The app loads this file.
- `flaring_by_country.csv` — real country totals (international overview). Columns:
  country, year, volume, source.
- `methane_by_field_s5p.csv` — optional real methane cross-check from Sentinel-5P
  (Copernicus/ESA via Earth Engine). Columns: field, year, month, ch4_ppb, source.

Attribution: World Bank Global Flaring and Methane Reduction (GFMR) Partnership with
the Earth Observation Group, Payne Institute, Colorado School of Mines (flaring);
Copernicus/ESA (methane). See the notebook header for URLs and access date.

There is no synthetic data in this project. If these files are absent, the app says
so and points to notebook 03 rather than inventing numbers.
