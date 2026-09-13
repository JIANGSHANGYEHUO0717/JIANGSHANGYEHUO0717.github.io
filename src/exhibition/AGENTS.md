# Isolated terrain preview

- This folder and exhibition.html are an independent preview, not a replacement for the archive or C04 observation flow.
- Latest user instruction: terrain only. Do not import, preload or add the five models.
- 2026-08-30: user approved both the current terrain and the dramatic lighting iteration. Freeze the height field, point positions and camera. The approved default is low-angle warm side light with soft terrain shadows and restrained cool fill. Keep the original-lighting comparison button; changing lighting must not resample geometry.
- Latest shape feedback: avoid parallel long ridges and bright crest lines. Use irregularly spaced round, blunt soil mounds with soft shading.
- Confirmed target: user selected the SECOND displayed generated image, outputs/terrain-concepts-20260830-round-mounds/option-2.png (exec-72b27963-a972-4e96-97be-844b869476ba.png). Five unequal, dispersed principal mounds and two tiny swells, broad open center; no 20-mound field.
- Use real procedural 3D points on black; reference media must never become a scene texture, background image or video.
- No rendered lines, tubes, trails or Bloom. Muted warm-gray and gray-cyan accents only.
- Desktop only. The terrain can rotate clockwise; controls must support pause and return to reference view.
- Preserve the original App.jsx, archive terrain modules and existing design-qa.md.
- Verification evidence belongs in qa/exhibition; unit tests in tests/exhibition-terrain.test.mjs.
