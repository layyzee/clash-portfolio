# 🚀 100% Free Live Deployment Guide (Zero Cost Forever)

Your 3D Clash of Clans Agile Citadel portfolio is pure client-side static WebGL (HTML, CSS, Three.js). It requires **no server builds, no node backend, and zero hosting fees**.

---

## ⚡ Option 1: GitHub Pages (Recommended — Permanent Free URL)

1. Create a new public repository on GitHub named `clash-portfolio` (or `<your-username>.github.io`).
2. Open Terminal and push this folder:
   ```bash
   cd /Users/layyzee/Downloads/Deepseek+REA/clash_portfolio_3d
   git init
   git add .
   git commit -m "feat: Clash of Clans TH18 3D Agile Citadel portfolio"
   git branch -M main
   git remote add origin https://github.com/<your-username>/clash-portfolio.git
   git push -u origin main
   ```
3. In GitHub, go to **Settings > Pages > Build and deployment > Source**, select **GitHub Actions**.
4. The included `.github/workflows/deploy.yml` workflow will automatically publish your portfolio live at:
   `https://<your-username>.github.io/clash-portfolio/`

---

## ⚡ Option 2: Vercel (Fastest — 30 Seconds, Custom Domain Ready)

1. Go to [vercel.com](https://vercel.com) and log in with GitHub.
2. Click **"Add New Project"** > Import the repository.
3. Keep default settings (Framework: Other, Root directory: `./`).
4. Click **Deploy**.
5. Your portfolio is instantly live on a global CDN at `https://<project-name>.vercel.app` with automatic HTTPS!

---

## ⚡ Option 3: Netlify Drop (Drag & Drop — Zero Git Required)

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the `/Users/layyzee/Downloads/Deepseek+REA/clash_portfolio_3d` folder directly into the browser window.
3. Done! Netlify assigns you a live public URL immediately.
