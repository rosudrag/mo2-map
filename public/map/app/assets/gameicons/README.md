# Game icons

These seven glyphs are redrawn from the shipped map-marker textures
(`MapLocationIcon_*.png`, extracted to `auxilliary/mo2-terrain-map/work/work/icons/`),
which are 20x20 px 1-bit silhouettes — too small and too soft (JPEG/mip blur) to
upscale cleanly to the 28px marker size used here, and filled-raster art can't be
recolored by the per-category `currentColor` theming the way the existing
`assets/tabler/*.svg` set can. Each file below is hand-traced stroke-only line art
in the same `viewBox="0 0 24 24"`, `stroke-width="2"` format as the Tabler icons,
sized to read at 15px inside the map marker.

| icon file        | source texture                    | silhouette                                            |
| ----------------- | ---------------------------------- | ------------------------------------------------------ |
| `dungeon.svg`      | `MapLocationIcon_Dungeon.png`      | triple-arch gate facade, center arch tallest            |
| `cave.svg`         | `MapLocationIcon_Cave.png`         | rounded mound with an arched mouth cut into its base    |
| `town.svg`         | `MapLocationIcon_Town.png`         | crenellated castle wall with a center gate arch         |
| `wayshrine.svg`    | `MapLocationIcon_Wayshrine.png`    | freestanding stone portal arch with a glowing rune      |
| `outpost.svg`      | `MapLocationIcon_Outpost.png`      | pennant flag with an inward arrow notch, on a pole      |
| `relic.svg`        | `MapLocationIcon_Relic.png`        | rough-cut gem with a dark socket hole and a sparkle     |
| `camp.svg`         | `MapLocationIcon_Camp.png`         | A-frame tent with a center ridge seam                   |
