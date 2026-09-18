# data/geo/

Basemap geometry for the interactive map.

## world_110m.json

- **Source**: Natural Earth, 1:110m Cultural Vectors, Admin 0 – Countries
- **URL**: https://www.naturalearthdata.com/downloads/110m-cultural-vectors/
- **Obtained from**: https://github.com/nvkelso/natural-earth-vector
  (`geojson/ne_110m_admin_0_countries.geojson`)
- **Licence**: **Public domain.** Natural Earth places all its data in the public
  domain; no permission or attribution is required, though attribution is
  offered in the interface as a courtesy.
- **Features**: 177 country polygons
- **Processing**: coordinates rounded to 2 decimal places (~1 km) and duplicate
  points removed, to cut the payload from 839 KB to 169 KB for browser
  rendering. Geometry is otherwise unmodified; no simplification algorithm was
  applied and no boundary was redrawn.
- **Properties kept**: `name`, `iso`

This file is committed because it is public domain and small. It is used only to
draw country outlines behind the field markers — no analysis depends on it, and
no value shown anywhere in GreenTruth is derived from it.

The field markers themselves come from `data/facilities_international.json`
(real coordinates) and `data/real/flaring_by_field.csv` (real observations).
