# Röpi App — Project Context (for Claude Design)

> Másold be ezt a fájl teljes tartalmát a Claude Design beszélgetés elejére,
> majd írd meg melyik oldalt szeretnéd designoltatni.

---

## What is the app?

**Röpi App** ("Röpi" = magyar szleng a "röplabda"-ra = volleyball) — egy Magyarországi
amatőr röplabda csapat heti edzéseit menedzselő webapp.

- Hetente kedden van edzés
- Tagok regisztrálnak hogy mennek-e (Yes/No)
- Admin felület: tagok, befizetések, statisztikák, havi elszámolás
- Publikus felület: alkalmak áttekintése, QR check-in az edzés helyszínén
- Nyelv: **magyar**
- Felhasználói arány: kb. 80% mobil, 20% asztali

---

## Tech stack & design constraints

- **Tailwind CSS v4** — utility-first, NO custom CSS files
- **Vanilla HTML + TypeScript** (nincs React/Vue/Svelte)
- Outputod legyen drop-in **HTML + Tailwind classes** — semmilyen framework-specifikus
  szintaxis (`v-bind`, `{...}`, `className=`) — csak `class=""` HTML
- **Mobile-first design** (`sm:`, `md:`, `lg:` breakpointokkal scale-elj felfelé)
- Modern, letisztult, baráti hangulat — NEM corporate / enterprise
- Sport / közösségi vibe — kicsi sportos energia, de nem agresszív

### Design tokens (már be vannak állítva a `src/style.css`-ben)

```css
@theme {
  --color-brand-50: #fef2f2;
  --color-brand-100: #fee2e2;
  --color-brand-500: #ef4444;   /* főszín — piros/röplabda */
  --color-brand-600: #dc2626;
  --color-brand-700: #b91c1c;

  --font-display: "Inter", system-ui, sans-serif;
}
```

- Háttér: `bg-zinc-50` (világos), `bg-white` (kártyák)
- Szöveg: `text-zinc-900` (címek), `text-zinc-600` (másodlagos), `text-zinc-500` (halvány)
- Border: `border-zinc-200`
- Accent / CTA: `bg-brand-500`, `text-brand-600`
- Pozitív állapot: `emerald-` paletta
- Hiba / figyelmeztetés: `amber-` és `red-` paletta

### Tipográfia
- Inter font (system-ui fallback-kel)
- Címek: `font-semibold` vagy `font-bold`
- Border-radius: alapból `rounded-xl` (12px) és `rounded-2xl` (16px)
- Shadow: `shadow-sm` finom, `shadow-lg` kiemeléshez

---

## Pages overview

Az app **9 oldalból** áll. A redesign egyenként történik.

### Publikus oldalak (nincs login)

1. **Alkalmak Áttekintése** — Dátumválasztó + résztvevők listája + létszám
2. **Admin Regisztráció** — Több névben egyszerre regisztrálni egy alkalomra (admin segít beírni)
3. **Adatbázis** — Tagok listája, kereshető, szűrhető
4. **📲 Check-in QR** — QR kódot generáló oldal (külön HTML-en már van)
5. **📊 Játékos Profil** — Egy játékos statisztikái (megjelenések, diagramok, eves összegek)

### Admin-only oldalak (Google OAuth login mögött)

6. **Havi Elszámolás** — Hónap kiválasztása → ki mennyivel tartozik az alkalmak után
7. **💳 Befizetések Ellenőrzése** — Revolut export feldolgozása, tag-payment párosítás
8. **👤 Tagok & Email** — Tagok hozzáadás/szerkesztés, email broadcast
9. **Beállítások (Kivételek)** — Lemondott alkalmak (pl. ünnepnap), edzői változások
10. **🛠️ Rendszer Diagnosztika** — Firestore/GSheets kapcsolatok tesztelése, logok

---

## Data model (Firestore collections)

```typescript
// attendance_records
{ name: string, status: "Yes" | "No", event_date: "YYYY-MM-DD", mode: "valós" | "teszt", timestamp: Timestamp }

// members
{ name: string, email: string, active: boolean }

// cancelled_sessions
{ date: "YYYY-MM-DD", reason?: string }

// invoices
{ target_year: number, target_month: number, month_name: string, pdf_url: string, total: number }

// settlements
{ player_name: string, year: number, month: number, sessions: number, amount: number, paid: boolean }
```

---

## What I want from you (Claude Design)

1. **Specifikus oldal redesignja** Tailwind CSS-szel (lásd külön prompt)
2. **Outputod legyen tiszta HTML** Tailwind class-okkal — semmi JS logika
3. **Helyettesítő adatokkal** (placeholder neveken, dátumokon mutasd be)
4. **Mobile-first** — előbb mobil layout, aztán `sm:` / `md:` / `lg:` breakpoint
5. **Hungarian language** a szövegekben
6. **Komponens-orientált** — ha valamit többször kell használni (kártya, badge, gomb),
   ugyanazt a class-kombinációt használd hogy könnyű legyen kiemelni component-té

---

## Outside the scope

Nem kell hogy designolj:
- Login folyamatot (`st.login` / Firebase Auth) — szabványos
- Hibakezelő modalokat — generikus
- Email küldés flow-t — backend feladat

---

## Reference: jelenlegi (Streamlit) verzió

A jelenlegi appot a Streamlit auto-generálja (Python-ból), így a design **alap default**:
szürke szövegek, alap dropdown-ok, semmi különleges. Az ÚJ designnak ennél sokkal
**vizuálisabbnak, modernebbnek és mobile-friendly-bbnek** kell lennie.

Pl. a "Résztvevők névsora" jelenleg csak bullet pontok — az új designban lehet:
- avatar (kezdőbetűk színes körben)
- vagy emoji-val díszítve (✅ jellegű)
- vagy card-grid layout 2 oszlopban mobile-on, 3-4 oszlopban desktopon
