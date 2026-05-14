# Röpi App 🏐

Egy magyar amatőr röplabda csapat heti edzéseit menedzselő PWA.
Production: **https://attendanceapp-473208.web.app**

## Tech stack

- **Vite + TypeScript** — vanilla, framework nélkül
- **Tailwind CSS v4** — utility-first styling, design tokenekkel
- **Firebase**
  - Hosting (`firebase deploy --only hosting`)
  - Firestore (offline persistence, multi-tab)
  - Auth (Google OAuth, admin email allowlist)
  - Cloud Functions (`sendBillingEmails` — Gmail SMTP, Node.js 22)
- **PWA** — service worker, telepíthető, fullscreen, auto-update toast

## Funkciók

**Publikus oldalak**
- `Regisztráció` — admin felülettel mások jelenlétét regisztrálni
- `Alkalmak` — hero kártya, dátumválasztó, résztvevők (szerkesztés módban törölhető is)
- `Profil` — egy játékos statisztikái + diagrammok (kattintással elérhető)

**Bejelentkezés után**
- `Adatbázis` — ranglista + jelenléti rekordok + havi/éves diagramok + top 5
- `Statisztikák` — éves összesítők, top játékos évente
- `QR` — check-in QR kód

**Admin only**
- `Tagok` — CRUD
- `Elszámolás` — havi kalkuláció, PDF, email küldés
- `Befizetések` — Revolut CSV import + automatikus egyeztetés
- `Beállítások` — email beállítások, lemondott alkalmak
- `Diagnosztika` — Firestore teszt, app logok, teszt email

## Setup

```bash
npm install
cp .env.example .env   # Firebase config értékek
npm run dev            # http://localhost:5173
```

## Build & deploy

```bash
npm run build                        # → dist/
firebase deploy --only hosting       # hosting only
firebase deploy --only firestore:rules
firebase deploy --only functions     # Cloud Functions
firebase deploy                      # mindent
```

Cloud Functions Secrets:

```bash
firebase functions:secrets:set GMAIL_USER
firebase functions:secrets:set GMAIL_PASS
```

## Mappa struktúra

```
src/
├── lib/          # Firebase, auth, firestore helpers, logger, theme, ...
├── pages/        # oldalanként 1 TS modul (admin oldalak lazy import)
├── components/   # header
├── main.ts       # entry — startRouter + theme + PWA
└── style.css     # Tailwind import + design tokenek + dark mode

functions/src/    # Cloud Functions (sendBillingEmails)
firestore.rules   # security rules
firebase.json     # hosting + functions + firestore config
```

## Témaválasztás

- Header jobb felső sarokban toggle (☀️ / 🌙)
- Választás localStorage-ben — felülírja a rendszer beállítást
- Első indításnál a rendszer `prefers-color-scheme`-t követi
