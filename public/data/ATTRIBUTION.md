# Local map asset attribution

These static reference assets are bundled with Atlas Signal so its default map
does not depend on a paid map service, a remote tile server, or remote font
requests. They are reference cartography, not live reporting, event locations,
verified analytical risk, or an authoritative statement about disputed borders.

## Country boundaries

- Local file: `countries.geojson`.
- Dataset: Natural Earth, 1:110m Admin 0 Countries, 177 polygon/multipolygon
  features. This intentionally generalized world overview omits some small
  territories and is not suitable for street-level or legal boundary decisions.
- Source:
  https://github.com/nvkelso/natural-earth-vector/blob/9380cca83db5f9aef52d5e762765100745f84b27/geojson/ne_110m_admin_0_countries.geojson
- Downloaded on September 13, 2026, without changing feature geometry or
  properties. This is a static dataset, not a claim of current geopolitical status.
- SHA-256:
  `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`.
- License: public domain. The source project's license is preserved in
  `NATURAL-EARTH-LICENSE.md`.
- License source:
  https://github.com/nvkelso/natural-earth-vector/blob/master/LICENSE.md
- Natural Earth terms:
  https://www.naturalearthdata.com/about/terms-of-use/
- Suggested attribution: "Made with Natural Earth."

`ISO_A2_EH` provides two-character map join keys for France (`FR`), Norway (`NO`),
and Taiwan (`TW`), where `ISO_A2` is missing or has a different representation.
Kosovo is represented as `XK` by this dataset. Northern Cyprus and Somaliland
retain the source's `-99` value; it must not be treated as an ISO country code or
silently converted into an invented code. Preserve source labels and distinguish
reference geography from the origin, scope, or accuracy of any associated event.

## Static country label anchors

- Local file: `country-labels.geojson`.
- Derived mechanically from the same Natural Earth features above.
- Each point uses the source feature's `LABEL_X` and `LABEL_Y`, unchanged.
- Retained properties: `NAME_EN`, `LABELRANK`, `MIN_LABEL`, and `ISO_A2_EH`.
- These are cartographic label placement anchors only. They are not event
  coordinates and must never be used to fill missing coordinates in a report.
- All 177 English labels fit the bundled font's Latin-1 glyph range.
- The same Natural Earth public-domain terms apply.

## Map label glyphs

- Local file: `fonts/Noto Sans Regular/0-255.pbf`.
- Source: the official MapLibre demo assets, copied without modification.
- Pinned asset source:
  https://github.com/maplibre/demotiles/blob/c071b1914cb6f0ee8a8014d51a906ddfd7149848/font/Noto%20Sans%20Regular/0-255.pbf
- Downloaded on September 13, 2026.
- SHA-256:
  `ef1f38a3f1978591e846e9eaddf8a54f7047f546fc6aaed7872cc53151a5de78`.
- Font family: Noto Sans Regular. The source PBF identifies a Noto fallback font
  stack and contains the `0-255` range; only that range is bundled.
- License: SIL Open Font License, Version 1.1. The full license supplied alongside
  this exact glyph asset is preserved verbatim in
  `fonts/Noto Sans Regular/LICENSE.md`.
- Pinned license source:
  https://github.com/maplibre/demotiles/blob/c071b1914cb6f0ee8a8014d51a906ddfd7149848/font/Noto%20Sans%20Regular/LICENSE.md
- Upstream Noto license reference:
  https://github.com/notofonts/noto-fonts/blob/main/LICENSE

The MapLibre-supplied font license does not identify the exact upstream Noto
revision or provide a copyright-holder header. Atlas Signal preserves that
source license and records the exact glyph source and checksum rather than
claiming an unverified font version.

The map font stack must use `Noto Sans Regular` and the local glyph URL template
`/data/fonts/{fontstack}/{range}.pbf`. Additional scripts or glyph ranges require
their own local assets and preserved source licenses before they are enabled.

## Local MapLibre worker

- Local files: `maplibre/maplibre-gl-worker.mjs` and
  `maplibre/maplibre-gl-shared.mjs`.
- Copied, without modification, from the installed `maplibre-gl` npm
  distribution, initially version 6.9.0.
- These two modules must always be synchronized with the installed main
  MapLibre package. The worker and its shared module use relative imports.
- The application configures the same-origin worker URL explicitly because
  MapLibre's default sibling-module lookup does not follow Next.js chunk paths.
- License: BSD 3-Clause. The distribution's full license and included dependency
  notices are preserved in `maplibre/LICENSE.txt`.
- Source project: https://github.com/maplibre/maplibre-gl-js
- A same-origin module worker requires `worker-src 'self'` and
  `script-src 'self'`; it does not require a third-party worker host.

## Locally bundled interface font

- The application shell uses Inter Variable from the installed
  `@fontsource-variable/inter` npm package.
- The font is bundled with the application; the browser does not contact a
  hosted font service.
- License: SIL Open Font License 1.1, copyright The Inter Project Authors.
- The installed package's complete notice is preserved in
  `fonts/INTER-LICENSE.txt` by the local asset-sync script.
- Source project: https://github.com/rsms/inter
