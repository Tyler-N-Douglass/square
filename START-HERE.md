# Start here (the simple version)

**What is this?** SQUARE — an app that turns a phone into five home-project tools:

1. **SCAN** — slide the phone across a wall; it beeps over the screws that mark a stud.
2. **LEVEL** — a level and plumb bob, with a camera view so you can see it on the shelf itself.
3. **CORNER** — take a photo of a door frame or cabinet; it tells you the true corner angle.
4. **LAYOUT** — "I want five pictures evenly spaced on this wall" → it gives you the marks.
5. **BEVEL** — hold the phone against an angled cut; it tells you how to set your saw to match.

It works with no internet, keeps everything on the phone, and when it can't measure
something reliably it tells you so instead of guessing.

## How to put it online (2 minutes, one time)

1. Go to **app.netlify.com/drop**
2. Build the app if you haven't: `npm ci && npm run build` — this creates a `dist` folder.
   (Or use the `square-deploy.zip` you already have.)
3. Drag the `dist` folder (or the zip) onto that page.
4. The link it gives you is the app. Open it on your phone. Done.

## First time using it

- Open the link on your phone and allow the sensor permissions when asked.
- Tap SCAN and follow the built-in walkthrough — it teaches you as you go.
- Every tool has a **DEMO** button that shows it working on a known wall first,
  including examples of it *refusing* to answer — so you learn what it can't do
  before you drill anything.

## The two things worth knowing

- **It finds screws, not wood.** On plaster walls, metal framing, or near electrical
  boxes it can't work reliably — and it will show a warning instead of a wrong answer.
- **On Android**, one phone setting unlocks the best stud-finding mode: open Chrome,
  go to `chrome://flags/#enable-generic-sensor-extra-classes`, set it to Enabled,
  restart Chrome. The app explains this too, right where it matters.

## Where the detailed stuff lives (if you ever want it)

- `README.md` — developer setup and deploy details
- `docs/FIELD-TEST.md` — a 90-minute checklist for testing it against a real tape measure
- `docs/` — the math, the accuracy numbers, and the design decisions
