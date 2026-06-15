# Röpi App 🏐

Egy magyar amatőr röplabda csapat heti edzéseit menedzselő modern webes alkalmazás (PWA).
Production: **https://attendanceapp-473208.web.app**

## Tech stack

- **Svelte 5** — reaktív komponensek és letisztult állapotkezelés (`$state`, `$derived`)
- **Vite + TypeScript** — villámgyors build eszköz és típusbiztonság
- **Tailwind CSS v4** — utility-first styling, modern design tokenekkel
- **Firebase**
  - Hosting (`firebase deploy --only hosting`)
  - Firestore (offline persistence, valós idejű szinkronizáció)
  - Auth (Google OAuth, admin email engedélyezőlista)
  - Cloud Functions (`sendBillingEmails` — Gmail SMTP, Node.js 22)
- **PWA** — vite-plugin-pwa, telepíthető (iOS/Android/Desktop), service worker, offline támogatás

## Funkciók

**Mindenki számára elérhető (Publikus)**
- `Alkalmak` — közelgő edzések áttekintése hero kártyával, dátumválasztóval, résztvevők listájával.
- `Regisztráció` — vendégek és saját jelenlét gyors rögzítése.

**Bejelentkezés után (Játékosok)**
- `Jelenlét` (Saját) — profil és egyéni jelenléti beállítások, értesítések kezelése, önregisztráció kezelése.
- `Profil` — egy játékos személyes statisztikái, részvételek aránya.

**Admin only (Szervezők)**
- `Adatbázis` — ranglista, jelenléti rekordok napi/havi/éves bontásban, grafikonok és Top 5 játékosok.
- `Statisztikák` — éves összesítők, legaktívabb játékosok évenként.
- `QR / Check-in` — helyszíni QR kódos bejelentkezés generálása.
- `Tagok` — játékosbázis kezelése (CRUD), email címek és azonosítók összekapcsolása.
- `Elszámolás` — havi költségkalkuláció, PDF generálás (jspdf), és automatikus email küldés a fizetendőkről.
- `Befizetések` — Revolut CSV importálás + automatikus egyeztetés az elszámolásokkal.
- `Beállítások` — értesítő emailek konfigurálása, edzések lemondása vagy módosítása.
- `Diagnosztika` — Firestore kapcsolat tesztelése, app logok megtekintése, teszt email küldés.

## Setup

```bash
npm install
cp .env.example .env   # Firebase config értékek és környezeti változók
npm run dev            # http://localhost:5173
```

## Build & deploy

```bash
npm run build                        # → dist/ mappa generálása
firebase deploy --only hosting       # Csak a weboldal frissítése
firebase deploy --only firestore:rules # Biztonsági szabályok frissítése
firebase deploy --only functions     # Cloud Functions frissítése
firebase deploy                      # Minden feltöltése
```

Cloud Functions Secrets beállítása:

```bash
firebase functions:secrets:set GMAIL_USER
firebase functions:secrets:set GMAIL_PASS
```

## Mappa struktúra

```
src/
├── lib/          # Firebase, auth, firestore segédfüggvények, dátumkezelés, PWA értesítések...
├── pages/        # Az egyes nézetek (Svelte komponensek), lazy-loading támogatással
├── components/   # Újrahasználható UI elemek (pl. Header)
├── main.ts       # Belépési pont — router beállítás, PWA inicializálás
└── style.css     # Tailwind importok, design tokenek, dark/light mód változók

functions/src/    # Cloud Functions (pl. sendBillingEmails)
firestore.rules   # Adatbázis biztonsági szabályok
firebase.json     # Hosting, Functions és Firestore konfiguráció
```

## UI/UX & Design

- **Dark/Light mód**: A Header jobb felső sarkában váltható (☀️ / 🌙), az állapot localStorage-ben tárolódik. Első indításnál a rendszer `prefers-color-scheme`-t követi.
- **Reszponzív dizájn**: Mobilra optimalizált felület, "glassmorphism" elemek, mikró-animációk és Svelte 5 alapú zökkenőmentes állapotváltások.
