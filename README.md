# 🎨 Cicada

**A minimalist, high-performance digital whiteboard for the modern web.**

Cicada is a lightweight sketching tool built for speed and elegance, it strips away the clutter to focus on what matters: your ideas.

[Live Demo](https://asong56.github.io/Cicada/)

---

## ✨ Key Features

- 🚀 **Extreme Performance:** Instant load times with zero-dependency architecture.
- 📦 **Single-File Deployment:** Optimized via Vite to a single, portable HTML file.
- 🔗 **Smart Link Sharing:** Entire drawings are compressed into ultra-short URLs using a custom binary codec—no database required.
- ✍️ **Natural Feel:** Smooth, pressure-simulated brush strokes and intelligent shape recognition (e.g., auto-snapping circles).
- 📱 **Fully Responsive:** Works seamlessly across Desktop, iPad, and Mobile.

---

## 🛠️ The Tech Stack

- **Custom Binary Codec:** Uses Varints and ZigZag encoding to serialize canvas data into compact Base64 strings for URL sharing.
- **RDP Path Simplification:** Implements the Ramer-Douglas-Peucker algorithm to keep stroke data lean without losing detail.
- **Vite + GitHub Actions:** A modern CI/CD pipeline that automatically builds and deploys the modular source code into a minified, single-file production build.

---

## 🚀 Quick Start

### 1. Development
Clone the repo and start the local dev server:
```bash
npm install
npm run dev
```

### 2. Build
Generate the optimized single-file `index.html`:
```bash
npm run build
```

---

## 📜 License

This project is licensed under the [**MIT License**](LICENSE).

---

> 🍀 Stay light, stay fast, stay creative.

Built with ❤️ by Ansel.
