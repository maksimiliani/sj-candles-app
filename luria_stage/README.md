# Luria Voice Test

A tiny GitHub Pages-ready test harness for the Soul Journey Life **Luria** Rive experience.

## Pick this Rive platform

For this prototype choose **Web (JS)**.

Why:
- fastest way to test microphone → `voiceLevel` without building the app;
- works directly on GitHub Pages over HTTPS, which is important for microphone permission;
- uses Rive's recommended `@rive-app/webgl2` runtime, which uses the Rive Renderer;
- you can still ship the same `.riv` file later through React Native / Apple / Android once the app framework is confirmed.

This is a **test harness**, not a decision about the final mobile runtime.

## Rive setup expected

The test assumes:

- exported file: `assets/luria.riv`
- State Machine: `Luria State Machine`
- your Luria View Model is assigned as the artboard's default View Model
- a View Model Instance is marked **Default**
- Number property: `voiceLevel`
- `LuriaStarsNode.voiceLevel` is data-bound to that `voiceLevel`
- `LuriaChestGlareNode.voiceLevel` is data-bound to the same `voiceLevel`

At runtime the page writes a continuous value from **0.0 to 3.0**.

If your state machine name differs, change `STATE_MACHINE` at the top of `app.js`.

## Add your Rive file

Export your `.riv`, rename it:

```text
luria.riv
```

and place it here:

```text
assets/luria.riv
```

## Test locally

Do not open `index.html` directly from Finder because the Rive asset and microphone should be served over HTTP.

From this folder:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

`localhost` is allowed to request microphone access.

## GitHub Pages

1. Create a GitHub repository.
2. Upload the contents of this folder to the repository root.
3. Put `luria.riv` inside `assets/`.
4. In GitHub: **Settings → Pages**.
5. Choose **Deploy from a branch**.
6. Select `main` and `/ (root)`.
7. Open the generated HTTPS Pages URL.
8. Tap/click **Enable microphone** and allow access.

GitHub Pages uses HTTPS, so browser microphone permission can work there.

## UI shell

`assets/shell-overlay.png` was prepared from the supplied 390×844 Figma shell screenshot.

The Rive canvas is:
- 390×746
- positioned at the top of the phone
- with the status glyphs and native bottom navigation overlaid above it

This matches the current Luria artboard structure.

## Voice mapping

The browser calculates microphone RMS amplitude, applies:
- noise gate
- sensitivity
- attack smoothing
- release smoothing

and writes:

```text
voiceLevel = 0.0 ... 3.0
```

Both the chest glare and stars can use the same value.

The tester also has a manual 0–3 slider so you can verify Data Binding before granting microphone permission.

## Runtime

The page loads the latest Rive WebGL2 runtime:

```html
https://unpkg.com/@rive-app/webgl2@latest
```

This is intentional while validating a file authored with current scripting/GPU Canvas features. After the prototype is stable, pin the exact runtime version before production.
