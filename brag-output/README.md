# Pocket Lab launch video

A 25-second, 1920×1080, 30 fps launch film created locally with the [Brag workflow](https://github.com/latent-spaces/brag) and [HyperFrames](https://hyperframes.heygen.com/).

- [Watch or download the video](brag.mp4)
- [Poster image](brag.jpg)
- [Storyboard](brag-plan.md)
- [Composition brief](composition-brief.md)
- [Share caption](share-copy.txt)
- [Credits and music attribution](CREDITS.md)

The graph view is captured from the actual app. The enlarged question-and-proposal sequence is an illustrative UI animation, labeled on screen. It demonstrates the workflow without claiming measured scientific or financial results.

## Edit and render

From `composition/`, run:

```sh
npm run dev
npm run check
npm run render -- --quality delivery --fps 30 --output ../brag.mp4
```

The editable source, fonts, music, and effects are bundled locally. Node.js 22+, Chrome, and FFmpeg are required. The project pins HyperFrames 0.8.223. Rendering needs no Pocket Lab credentials or live database connection.

The delivered MP4 has its chosen poster baked into frame zero. Re-rendering the composition creates a fresh video; extract the settled frame at 15.8 seconds and bake it again if the idle thumbnail should remain identical.
