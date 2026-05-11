# Röpi App v2 🏐

A [ropi-app](https://github.com/markigergely1-coder/ropi-app) Streamlit verzió HTML/TypeScript átirata.

## Tech stack

- **Vite** — build tool
- **TypeScript** — típusos JS
- **Tailwind CSS v4** — utility-first styling
- **Firebase JS SDK** — Firestore + Auth (Google sign-in)
- **Vercel** — hosting (frontend + serverless functions)

## Architektúra

```
Browser (HTML + TS) ──► Firebase Auth (Google login)
                  └──► Firestore (közvetlen olvasás/írás)
                  └──► Vercel serverless fn (csak GSheets sync-hez)
```

## Setup

```bash
npm install
cp .env.example .env   # töltsd ki Firebase configgal
npm run dev            # http://localhost:5173
```

## Scripts

- `npm run dev` — fejlesztői szerver (HMR)
- `npm run build` — production build a `dist/`-be
- `npm run preview` — production build előnézet

## Mappa struktúra

```
src/
├── lib/          # Firebase setup, utility-k
├── pages/        # oldalankénti TS belépési pontok
├── components/   # újrahasználható UI elemek
├── main.ts       # app entry point
└── style.css     # Tailwind import + globális stílus
```

## Állapot

- [x] Fázis 0 — Setup (Vite + TS + Tailwind + Firebase SDK)
- [ ] Fázis 1 — Claude Design mockup-ok
- [ ] Fázis 2 — Firebase + Vercel infrastruktúra
- [ ] Fázis 3 — Oldalak migrálása
- [ ] Fázis 4 — GSheets sync serverless fn
- [ ] Fázis 5 — Tesztelés
- [ ] Fázis 6 — Átállás
