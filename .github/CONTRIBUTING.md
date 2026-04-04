# Contributing to Cicada

Cicada is built for anyone who needs a whiteboard and doesn't want to open a browser tab just to find out the tool takes five seconds to load. Contributions are welcome — but file size is treated as a hard constraint, not a suggestion.

---

## Reporting Bugs

Open a [GitHub issue](https://github.com/Ansel-S/Cicada/issues/new) and include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Device, browser, and input method (mouse / trackpad / stylus / touch)

Drawing tools behave differently across input methods, so this context matters.

---

## Suggesting Features

Open an issue before writing any code. Describe the problem you're solving, not just the feature you want.

Ask yourself: does this make Cicada feel lighter and faster, or heavier? Cicada's promise is that it's always ready when you are. Anything that delays that — longer load times, more UI to parse, more decisions to make — works against the tool's core purpose.

---

## Submitting Code

### Setup

```bash
git clone https://github.com/Ansel-S/Cicada.git
cd Cicada
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`. The production build outputs a single self-contained `index.html`:

```bash
npm run build
# Output: dist/index.html
```

### Workflow

1. Fork the repo and create a branch: `git checkout -b fix/your-description`
2. Make your changes. Keep commits small and focused.
3. Test across browsers and input methods.
4. **Check the file size before opening a PR** — see requirements below.
5. Open a pull request with a clear description of what changed and why.

---

## ⚠️ File Size Requirements

This is non-negotiable. Before submitting any pull request:

```bash
npm run build
ls -lh dist/index.html        # Check raw size
gzip -c dist/index.html | wc -c  # Check gzipped size
```

**Rules:**
- Every PR must include the before/after sizes in the description
- Any increase in gzipped size must be explicitly justified — "it's a small change" is not sufficient
- PRs that add external runtime dependencies will not be accepted, no exceptions
- If you're unsure whether a change is too heavy, open an issue first and ask

The goal is a tool that loads instantly. That only stays true if everyone treats file size as a first-class concern.

---

## Code Style

- **Vanilla JavaScript** — no frameworks, no runtime dependencies.
- The binary codec (Varint + ZigZag + Base64) and RDP path simplification are core algorithms. Changes here need careful testing across complex strokes and edge cases.
- Keep the production output as a **single `index.html`**. No external assets, no CDN calls at runtime.
- Prefer clarity over cleverness. The codebase should be readable by someone who didn't write it.
- Use `requestAnimationFrame` for all visual updates. No synchronous work during stroke input.

---

## What We Won't Accept

- External runtime dependencies
- Features that require a server, database, or login
- Changes that break single-file deployment
- Lossy changes to the codec that corrupt existing shared URLs
- PRs without before/after file size measurements

---

## Not Sure Where to Start?

You don't need to understand the codec or the rendering pipeline to contribute. Browser compatibility fixes, accessibility improvements, and documentation updates are always useful — and a good way to get familiar with how the project works.

---

## Philosophy

Cicada should open faster than you can second-guess using it. Every addition carries a cost. When a feature makes Cicada more capable but slower to load or harder to approach, the answer is no.
