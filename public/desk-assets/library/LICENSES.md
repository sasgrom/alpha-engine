# Assets of the fund-flow hall

Everything here is free to use in a commercial product. Sources as downloaded on 2026-11-11.

## People: Quaternius (CC0 1.0, public domain)

Animated low-poly figures by Quaternius (https://quaternius.com), fetched as GLB from Poly Pizza. The files are
unchanged; the hall merges each figure's parts at load time and recolours the jacket in its shader.

| File | Poly Pizza page |
| --- | --- |
| people/man-suit.glb | https://poly.pizza/m/mQnGoME1ez |
| people/man-longsleeves.glb | https://poly.pizza/m/DLptRuewTn |
| people/man-a.glb | https://poly.pizza/m/HMnuH5geEG |
| people/man-b.glb | https://poly.pizza/m/fjHyMd5Wxw |
| people/woman.glb | https://poly.pizza/m/AQsd9ngvKU |
| people/woman-casual.glb | https://poly.pizza/m/jpKRgGDxhk |
| people/woman-dress.glb | https://poly.pizza/m/zMyPlQXBzq |
| people/woman-tanktop.glb | https://poly.pizza/m/XqzeZGB7iU |

The wooden mannequin is built in code (src/desk/flows/hall/people.ts) on the men's skeleton.

## Textures and light: Poly Haven (CC0 1.0, public domain)

From https://polyhaven.com, converted to WebP at 1024 px (the floor's and the panelling's colour maps at 2048 px):
colour, OpenGL normal, and ambient occlusion / roughness / metalness where the set has one.

- textures/marble_tiles_* (https://polyhaven.com/a/marble_tiles), the floor
- textures/dark_paneled_wood_* (https://polyhaven.com/a/dark_paneled_wood), the panelled walls
- textures/marble_01_* (https://polyhaven.com/a/marble_01), columns, arch and cornice
- textures/plaster_grey_04_* (https://polyhaven.com/a/plaster_grey_04), the upper walls and the dome's relief
- textures/brown_leather_* (https://polyhaven.com/a/brown_leather), the relief of the book covers
- env/vestibule_1k.hdr (https://polyhaven.com/a/vestibule), the reflections

## Lettering: Cinzel (SIL Open Font License 1.1)

fonts/Cinzel-wght.ttf, Cinzel by Natanael Gama (https://github.com/NDISCOVER/Cinzel), the carved signs over the
bookcases. The licence text is in fonts/Cinzel-OFL.txt.
