# Credits & Licenses

The **source code** of this project is released under the [MIT License](LICENSE).
The **bundled demo assets** come from the sources below — please honor their
individual terms if you reuse them.

## Artworks (Classical & Modern wings)

The 36 paintings bundled in the Classical and Modern wings are reproductions of
works by Leonardo da Vinci, Johannes Vermeer, Vincent van Gogh, Claude Monet,
Edvard Munch, and Gustav Klimt. Their linked Wikimedia Commons records mark the
works/reproductions as public domain; rights can vary by jurisdiction, so review
the individual source page before reusing a specific image.

They are downloaded from **[Wikimedia Commons](https://commons.wikimedia.org)**
by [`scripts/fetch_art.py`](scripts/fetch_art.py). The exact Commons file,
canonical description page, license metadata, Artist / Credit fields, local
path, byte size and SHA-256 for every bundled image are recorded in
[`public/art/sources.manifest.json`](public/art/sources.manifest.json). The
release gate verifies the manifest against the actual files; review the linked
Commons page before reusing a specific image because rights can vary by
jurisdiction.

## Central 3D sculpture

The *Venus de Milo* in the central rotunda
(`public/models/venus-de-milo-24k.geometry.json`) is a 3D scan of plaster cast
KAS434 by **[SMK – Statens Museum for Kunst](https://open.smk.dk/artwork/image/KAS434)**
(National Gallery of Denmark). SMK releases the scan into the public domain
([Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/) in
its Open API; CC0 on its Sketchfab channel). For this project the mesh was
decimated from 274,272 to 23,992 triangles, re-oriented and scaled; the source
file hash and processing steps are recorded in
`scripts/release-asset-licenses.json`.

To use a different sculpture, replace the file, update `SCULPTURE_MODEL` in
`src/appVariant.js`, and add its reviewed path, hash, author, source and
license to `scripts/release-asset-licenses.json`.

## Spotlight texture

`public/textures/disturb.jpg` is **“Disturb” by Mitch Featherston**, distributed
with the three.js spotlight example and licensed under
[CC BY 2.5](https://creativecommons.org/licenses/by/2.5/). It is used unchanged
as the rotating spotlight cookie. Keep this attribution in repository credits
and in credits accompanying any public video that prominently uses the effect.

## Project-generated imagery

`public/og-cover.jpg` and the images in `docs/screenshots/` were generated from
the public Musewalk demo by Musewalk contributors and are released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The individual
paintings visible inside them retain the source status recorded in
`public/art/sources.manifest.json`.

## Libraries

| Library | Author | License |
| --- | --- | --- |
| [three.js](https://threejs.org) | mrdoob & contributors | MIT |
| [camera-controls](https://github.com/yomotsu/camera-controls) | yomotsu | MIT |
| [Vite](https://vitejs.dev) | Evan You & contributors | MIT |
| [Fontsource](https://fontsource.org) font packages | Fontsource contributors | MIT (packaging) · OFL-1.1 (fonts) |
| puppeteer-core (dev only) | Google | Apache-2.0 |

## Fonts

[Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) and
[Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC), licensed
under the [SIL Open Font License 1.1](https://openfontlicense.org). They are
bundled with the site through [Fontsource](https://fontsource.org)
(`@fontsource-variable/cormorant-garamond`, `@fontsource-variable/noto-serif-sc`),
so pages make no requests to Google Fonts. The Chinese font is split by
`unicode-range`, and browsers only download the pieces they need.

## Ambient audio

There are **no audio files** in this project. The ambient soundscape is
synthesized live in the browser with the Web Audio API
(see [`src/audio.js`](src/audio.js)).
