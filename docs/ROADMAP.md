# Röpi App — Tervezett fejlesztések

> Új chat session indításához szóló kontextus. Másold be a Claude beszélgetésbe
> a `PROJECT_CONTEXT.md` mellé, és válassz egy pontot a TODO szekcióból.

---

## Projekt áttekintő

- **Tech stack:** Vite + TypeScript + Tailwind CSS v4 + Firebase
- **Hosting:** Firebase Hosting → https://attendanceapp-473208.firebaseapp.com
- **Repo:** github.com/markigergely1-coder/HTML_R-piapp
- **Helyi útvonal:** `C:\Users\marki\Github\HTML_R-piapp`
- **Backend:** Firebase Functions (`functions/`) — `sendBillingEmails` callable
- **Admin emailek:** markigergely1@gmail.com, annemaryaf@gmail.com

---

## ✅ Már implementált funkciók

### Oldalak (Streamlit verzió mind portolva)
- Alkalmak Áttekintése (csak múltbeli + kedd 21:00-tól aznapi)
- Regisztráció (3-step wizard, Apple-style guest stepper)
- Adatbázis (rekordok + ranglista)
- Check-in QR
- Játékos Profil (statisztikák + diagramok + nyilvánosan elérhető)
- Havi Elszámolás (kalkuláció + bulk + PDF + email küldés)
- Befizetések (Revolut CSV import + automatikus egyeztetés + név mapping)
- Tagok & Email (CRUD)
- Kivételek (lemondott edzések)
- Diagnosztika (FS teszt + logok)

### Backend & infrastruktúra
- **Firebase Hosting** deploy (`firebase deploy --only hosting`)
- **Cloud Functions** — `sendBillingEmails` (nodemailer + Gmail SMTP)
- **Firestore Security Rules** verziózva (`firestore.rules`)
- **Offline persistence** (IndexedDB cache, többkártyás támogatás)
- **PWA** — telepíthető, fullscreen, service worker, auto-update toast
- **In-app browser banner** (Messenger/FB/IG figyelmeztetés OAuth-hoz)
- **Auth:** popup-first + redirect fallback (Firebase Hostingon stabil)

### UX/Design
- Mobile-first layout, sticky desktop columns
- Apple-style vendég stepper (sky-blue, in-place update)
- Activity ring diagramok profil oldalon
- Globális tooltip rendszer
- Glass surface design, gradient avatar, halo effektek
- PDF letöltés gomb az elszámolásnál (lazy-loaded jsPDF)

---

## 📋 TODO — Még nem implementált

### 🔥 Magas prioritás

#### 1. Diagramok az Adatbázis oldalon
A Streamlit verzióban volt Altair-alapú több diagram (Havi részvétel, Éves trend,
Top 5 leg aktívabb játékos). Most az HTML appban csak rekord-lista + ranglista van.

**Mit kell csinálni:**
- Új `Statisztikák` tab a Database oldalon (vagy külön oldal)
- Havi részvétel oszlop-chart (a kiválasztott évhez)
- Éves trend chart (több év összehasonlítása)
- Top 5 leg aktívabb játékos kártya
- Megoldás: vagy a meglévő canvas-alapú chart komponens újrahasználata
  (lásd profile.ts), vagy egy mini Chart.js (~50 KB lazy import)

**Helyek:** `src/pages/database.ts` + új `src/lib/charts.ts` (ha külön kell)

#### 2. Profil oldal pénzügyi szekció ellenőrzés
A Streamlit verzió `profile.py`-jában van egy "💰 Pénzügyi összesítő" rész:
- Becsült fizetendő összeg (alkalmak × óradíj / átlag létszám)
- Pontos összeg az elmentett `settlements`-ből
- Havi bontás táblázat

**Mit kell csinálni:**
- Ellenőrizni a TS `profile.ts`-t: van-e ez a szekció?
- Ha nincs → portolni a `estimate_cost_for_player` logikát
- `getAllSettlementsForPlayer(playerName)` Firestore helper
- Az `cost.ts` lib-ben már van helper függvény

**Helyek:** `src/pages/profile.ts`, `src/lib/cost.ts`, `src/lib/firestore.ts`

---

### ⚡ Közepes prioritás

#### 3. Önregisztráció ("Jelentkezem" gomb)
Jelenleg csak admin tud másnak regisztrálni (admin.ts). Akkor lenne értelmes, ha
a tagok maguk is jelezhetnék hogy jönnek-e (Yes/No).

**Mit kell csinálni:**
- Az Alkalmak hero kártyán működővé tenni a (most placeholder) gombot
- Bejelentkezve: "Megyek" / "Nem megyek" toggle
- A user emailje alapján beazonosítani a tagot (`members` collection)
- Új `attendance_records` doc-ot írni
- Egyik nehézség: ki minek a nevében regisztrál? Email alapú lookup
  vagy a user adjon meg nevet, ha első alkalom
- Firestore Rules: `attendance_records` write csak admin VAGY a saját
  email-jéhez tartozó név esetén

**Helyek:** `src/pages/overview.ts`, `firestore.rules`, esetleg új flow

#### 4. App logs írása
A Diagnosztika oldal már OLVAS logokat (`app_logs` collection), de a TS app
SEMMIT nem ír. A Streamlit verzió logolja az admin bejelentkezést, regisztrációt
stb.

**Mit kell csinálni:**
- `src/lib/logger.ts` — `logEvent(level, message, payload)`
- Beillesztés:
  - Admin login (auth.ts onAuthStateChanged)
  - Sikeres elszámolás mentés (accounting.ts)
  - Sikeres email küldés (accounting.ts)
  - Revolut import (payments.ts)
  - Settings változások (settings.ts, members.ts)
- Rules: `app_logs` create publikus auth-hoz kötve

**Helyek:** új `src/lib/logger.ts` + minden oldal handler

#### 5. Code splitting (további)
A bundle most ~611 KB main + ~430 KB lazy PDF + ~199 KB html2canvas.
Még lehetne tovább szabdalni.

**Mit kell csinálni:**
- `payments.ts`, `accounting.ts`, `admin.ts`, `diagnostics.ts` lazy import
  a routerből — csak admin-bejelentkezés után töltődnek le
- A `firebase/auth` és `firebase/firestore` SDK-k mai 611 KB → nehéz csökkenteni,
  de a saját kódunkat darabolhatjuk
- Várható eredmény: ~400-450 KB initial bundle (gzip ~120 KB)

**Helyek:** `src/router.ts` (`import()` használata)

---

### 🌱 Alacsony prioritás (nice-to-have)

#### 6. Dark mode
Toggle vagy system preference alapján auto. A design tokens már változókkal
működnek (`var(--bg-page)`, `var(--fg-1)` stb.), tehát `@media (prefers-color-scheme: dark)`
blokkal lefedhető a `style.css`-ben.

**Helyek:** `src/style.css` (új sötét paletta) + esetleg user toggle a header-ben

#### 7. Éves összesítő oldal
Új oldal: év végi statisztikák — top X aktív játékos, leghosszabb sorozat
megjelenés, leglátogatottabb hónap, összes alkalom, összes ráfordítás stb.

**Helyek:** új `src/pages/yearStats.ts` + router bejegyzés + header tab

#### 8. Csapat-szintű statisztikák
Az Adatbázis vagy egy új oldalon: átlag létszám / alkalom, max létszám rekord,
részvétel-megoszlás (mely napon hányan voltak), stb.

#### 9. Email kapcsolat-teszt a Diagnosztikán
A Streamlit verzióban a Diagnosztika oldal megmutatja hogy az Email-konfig OK-e.
Itt lehetne egy "Send test email to yourself" gomb, ami a `sendBillingEmails`
function-t hívja egy fake input-tal csak az admin-nak.

**Helyek:** `src/pages/diagnostics.ts` + functions/src/index.ts (új test function)

#### 10. Email-beállítás UI (haladó)
Most a Gmail user/pass Firebase Secrets-ben van. Lehetne egy admin UI ami
összerakja a SMTP konfigurációt (másik provider — pl. Outlook — támogatása)
és a Functions Secret Manager-be írja. **Csak akkor érdemes ha SMTP-t váltunk.**

---

## ❌ Tudatosan elvetett

- **Push notifications** — Apple iOS-en csak telepített PWA-ban működik,
  a barátok többsége valószínűleg nem fogja telepíteni
- **Auto-deploy GitHub Actions** — manuális `firebase deploy --only hosting`
  marad

---

## Munkamódszer új fejlesztéshez

1. Helyi setup: `cd C:\Users\marki\Github\HTML_R-piapp && npm install`
2. Dev szerver: `npm run dev` → http://localhost:5173
3. Build: `npm run build`
4. Deploy hosting: `firebase deploy --only hosting`
5. Deploy hosting + functions + rules: `firebase deploy`

## Hasznos parancsok

```powershell
# Build + deploy egy menetben
npm run build; firebase deploy --only hosting

# Csak Firestore Rules
firebase deploy --only firestore:rules

# Csak Functions
firebase deploy --only functions

# Functions logs
firebase functions:log

# Secret kezelés
firebase functions:secrets:access GMAIL_USER
firebase functions:secrets:set GMAIL_PASS
firebase functions:secrets:prune

# PWA ikonok regenerálása (ha cseréled app-icon.svg-t)
npx pwa-assets-generator
```
