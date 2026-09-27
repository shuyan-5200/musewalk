<div align="center">

# Musewalk (入画) — a walkable 3D art-gallery engine built on Three.js: step into any painting, then dissolve into stardust.

### Walk into a museum that lives in a browser tab.
**Stand before the masters — then step _inside_ the canvas.**

*A folder of images + one JSON file = your own immersive 3D gallery.*
*No backend · no accounts · no code.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/shuyan-5200/musewalk/actions/workflows/ci.yml/badge.svg)](https://github.com/shuyan-5200/musewalk/actions/workflows/ci.yml)
[![Built with three.js](https://img.shields.io/badge/built%20with-three.js-000000.svg)](https://threejs.org)
[![No backend](https://img.shields.io/badge/backend-none-success.svg)](#-how-its-built)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/shuyan-5200/musewalk)

### ▶&nbsp;&nbsp;Live demo — coming with the first public release

<sub>no install · runs in any browser</sub>

[English](README.md) · [中文](README.zh-CN.md)

<!-- demo.gif goes here after the first release recording -->

![Walk through a 3D museum lined with masterpieces](docs/screenshots/gallery-vangogh.webp)

</div>

---

- 🚶 **Roam in first person** — WASD, click-to-walk, or drag to look around
- 🖼️ **36 masterpieces, ready on load** — Da Vinci to Van Gogh, all public domain
- 🌌 **Step into any painting** — it dissolves into ~50,000 drifting particles
- 🪄 **Sculpted painting bodies** — enter on *The Original* by default, then choose *In Relief* to raise the canvas into brush-stroke chips; zoom in close, then dissolve straight into stardust
- 🔇 **Sound on your terms** — ambient music starts off and can be toggled from the landing page, museum, painting view, or stardust
- 🧩 **100% config-driven** — your whole museum is one JSON file, zero code
- ⚡ **No backend** — it's a static site, deploy it anywhere in minutes

No framework — just three.js + camera-controls, driven by a single JSON file. Drop images in a folder and you have a museum.

Runs on modern WebGL2 browsers; WebGPURenderer/TSL migration is on the roadmap.

## What is this?

**Musewalk** turns a folder of images into a **walkable 3D museum** that runs entirely in the browser. Cross a domed rotunda, push through doors into the Classical, Modern, and Future wings, focus on a canvas to read its story — then **walk straight into it** and float inside the brushstrokes.

Everything — the rooms, the artists, the captions, the very mood of the light — comes from a single `gallery.config.json`. Change the file, get a different museum. **You never touch the 3D code.**

## ✨ Three moments that make it special

| 🚶 Walk in | 🔍 Focus & read | 🌌 Step into the painting |
| :---: | :---: | :---: |
| ![rotunda](docs/screenshots/rotunda.webp) | ![focus](docs/screenshots/focus.webp) | ![immersion](docs/screenshots/immersion.webp) |
| One continuous space — a rotunda and three wings — with smooth, weighty first-person movement. | The camera glides in and frames each work while a panel tells its story. | The signature moment: the canvas breaks into **~50k particles** and you drift through the color. |

## 🚀 Quick start

Requires Node.js 20.19 or newer.

```bash
git clone https://github.com/shuyan-5200/musewalk.git
cd musewalk
npm install
npm run dev      # → http://localhost:5173
npm run check    # config, assets, and IDs for your own museum
npm run build    # production build in dist/
```

The demo ships with **36 public-domain masterpieces**, so the gallery looks complete the moment it loads.

Maintainers use `npm run release:check` before publishing the official demo. It
adds the empty-future-wing, privacy, artwork provenance, reviewed-screenshot,
and asset-license gates to the customizable project checks.

## 🎨 Make it your own

The entire museum is data. To build your own, you (usually) never touch the rendering code:

1. Drop your images into `public/art/`.
2. Describe your museum in `public/gallery.config.json`.

```jsonc
{
  "title": "MY GALLERY",
  "wings": [
    {
      "id": "modern", "name": "Modern", "type": "collection",
      "wall": "#1b1d24", "accent": "#c9a86a",
      "artists": [
        {
          "id": "vangogh", "name": "Vincent van Gogh",
          "works": [
            { "id": "starry-night", "file": "art/starry-night.jpg", "title": "The Starry Night",
              "year": "1889", "desc": "A village asleep under a turbulent sky.",
              "wide": true }
          ]
        }
      ]
    },
    {
      "id": "future", "name": "Your Wing", "type": "open", "frames": 6
    }
  ]
}
```

- **`"type": "collection"`** — each artist gets a portrait portal that opens into their own private gallery.
- **`"type": "open"`** — mix real works with empty gold frames (`"frames": N`). Perfect for a _"your own art goes here"_ wing.
- **Future-wing baseline** — the bundled public demo deliberately keeps this wing empty: six gold frames, no artists or works.
- **Atmosphere** — wall color, frame style, lighting, and fog are all configurable, per wing and per artist.
- **Hot-swap configs** — try an alternate museum without changing a thing: `?config=my.json`.
- **Chinese demo** — browsers set to Chinese open it automatically (`altLang.lang: "zh"`); otherwise use the EN/中文 toggle on the landing page, or append `?config=gallery.config.zh.json`.
- **Mini demo** — append `?config=gallery.config.mini.json` for a six-painting Van Gogh build that is friendlier to online sandboxes.

## 🧱 How it's built

- **[three.js](https://threejs.org)** for rendering · **[camera-controls](https://github.com/yomotsu/camera-controls)** for the smooth first-person feel · **[Vite](https://vitejs.dev)** for dev & build.
- **No backend, no database.** Runtime code is just the two libraries above; the fonts are self-hosted via [Fontsource](https://fontsource.org), so the site makes no third-party requests.
- The ambient soundscape is **synthesized live** with the Web Audio API — there are no audio files.
- `scripts/verify.mjs` runs a **real-click headless-Chrome walkthrough** (12 stations) with failing assertions for navigation, sound, entry motion, painting modes, resources, and console errors.

## 📦 Project structure

```
public/
  gallery.config.json   the museum (wings / artists / works / copy) — edit this
  art/                  artwork images
src/
  appVariant.js  public-build boundary (neutral sculpture)
  data.js        config loading & normalization
  main.js        state machine & interaction routing
  lobby.js       rotunda + wings + portals
  hall.js        per-artist gallery generator
  dream.js       painting view: The Original → optional In Relief
  dreamBodies/strokes.js the single production relief renderer
  immersion.js   the "step into the painting" particle field
  fx.js          bloom / floating dust / light cones
  audio.js       Web Audio soundscape
  ui.js          all DOM UI
scripts/
  fetch_art.py   download a license-reviewed collection from Wikimedia Commons
  check-config.mjs config, asset, ID, symlink, and translation-parity checks
  check-privacy.mjs official-release privacy scan
  check-release-assets.mjs verifies artwork/screenshot records and blocks unresolved assets
  verify.mjs     12-station real-click walkthrough + screenshots
```

## 🖼️ Expand the collection

The bundled demo is a curated 36-painting set, optimized for a fast clone. To fetch the larger image set from Wikimedia Commons (resumable, rate-limit aware), run:

```bash
python scripts/fetch_art.py
```

The downloader resolves every file through the Commons API before use. It only
accepts an explicit `Public domain`, `CC0`, or `CC BY` `LicenseShortName`;
ShareAlike, NonCommercial, and unknown licenses are rejected even when they are
the first search result. Each accepted local JPEG is recorded in
`public/art/sources.manifest.json` with its hash, canonical description URL,
resolved Commons file title, license, and the `Artist` / `Credit` values from
Commons `extmetadata`. Commit that manifest together with the images.

To backfill provenance for files already present without downloading missing
works, run `python scripts/fetch_art.py --metadata-only`. Add
`--only WORK_ID` to audit or fetch a single configured work.

Then add any works you want back into `public/gallery.config.json`. That is the point of the config-driven setup: the engine stays the same while the museum grows.

## 🤝 Contributing

Issues and PRs are welcome — new wing themes, mobile polish, config features, performance work. **If you build a museum with it, open an issue and show it off.**

GitHub About topics: `threejs webgl 3d art-gallery virtual-museum vite javascript creative-coding config-driven interactive`

## 📄 License & credits

Source code is **[MIT](LICENSE)**. Demo assets keep their own terms: the 36
paintings and the central *Venus de Milo* scan (by SMK, National Gallery of
Denmark) are public domain; see **[CREDITS.md](CREDITS.md)** for every source
and attribution.

---

<div align="center">

*Walk all the way into a painting. That's the best part.*

⭐ **If this made you smile, a star helps others find it.**

</div>
