# web/fonts/

Served locally so the interface renders its typography with no network access
and no CDN (a live demo should not depend on one).

| file | what | source | licence |
|---|---|---|---|
| `roboto-latin.woff2` | Roboto, variable weight 100–900, Latin subset | Google Fonts (`fonts.gstatic.com`, Roboto v51) | SIL Open Font License 1.1 |
| `notika-icon.woff` | Notika line-icon font | `notika-master/notika/green-horizotal/fonts/` | MIT — Notika admin template by Colorlib |

Roboto is the typeface of the Notika design system GreenTruth's interface follows
(`notika-master/.../style.css`: `font-family: 'Roboto', sans-serif`, loaded at
weights 100/300/400/700/900). The variable file covers all of those weights.

Notika is MIT-licensed; its licence asks that Colorlib be credited as the
original author of the template, which the interface footer does.
