# Prompt: 📊 Játékos Profil oldal

Másold be a teljes `docs/PROJECT_CONTEXT.md` tartalmát ELŐSZÖR egy új Claude beszélgetésbe.
Aztán illeszd be ezt a prompt-ot:

---

```
## Page to design: "Játékos Profil" (Player Profile)

This is a PUBLIC page (anyone can view) where you select a player from the volleyball
team and see their full statistics + financial summary for the year.

### Page structure (top to bottom):

1. **Header bar** — same sticky style as the overview page (🏐 Röpi logo + "Profil" label on right)

2. **Selectors row** — TWO dropdowns side by side
   - 👤 Player selector (alphabetical list of all members, e.g. "Kovács Anna")
   - 📅 Year selector (for monthly chart + financial calculations)

3. **Hero stat card** — featured stat for the selected player
   - Big avatar (initials, colored — same logic as overview page)
   - Player name in big text
   - Below: "X alkalom összesen" subtle subtitle

4. **4 stat cards in a grid** (2x2 on mobile, 4x1 on desktop)
   - 🏆 Összes alkalom (Total sessions ever)
   - 📅 [current_year] (e.g. "2026") - sessions this year
   - 🗓️ [current_year]/[current_month] (e.g. "2026/05") - sessions this month
   - 📌 [selected_year] - sessions in the selected year (for chart)

5. **Financial summary section** — for the selected year
   This has TWO variants side by side (or stacked on mobile):

   A) **Estimated cost** (always shown):
      - Big primary card: "~85 200 Ft" (precise estimate)
      - Small note: hourly rate × duration ÷ attendees × sessions
      - Below: small secondary card with "simple estimate" (sessions × 2300 Ft)

   B) **Exact cost** (shown IF settlement records exist):
      - Big green card: "73 500 Ft (pontos)"
      - Subtitle: "X hónap alapján"
      - Below: a table/list with monthly breakdown:
        | Hónap | Alkalmak | Fizetendő |
        | Január | 3 | 6 900 Ft |
        | Február | 4 | 9 200 Ft |
        ...

   IF NO settlement: instead show a friendly "Még nincs elszámolás" empty state with
   suggestion text.

6. **Yearly chart** — "📈 Éves összesítő"
   - Bar chart: X axis = years (2023, 2024, 2025, 2026), Y axis = session count
   - Numbers on top of each bar
   - Use brand-500 color for bars

7. **Monthly chart** — "🗂️ Havi bontás — [selected_year]"
   - Bar chart: 12 months Jan-Dec on X axis
   - Bars in emerald-500 for months with sessions, zinc-200 for empty months
   - Numbers on top of bars
   - Should show ALL 12 months (even if 0 sessions)

8. **Last 10 sessions** — "🕐 Utolsó 10 alkalom"
   - Compact list/cards with dates
   - "2026. máj. 19., kedd" format
   - Subtle, not the focus

### Sample data:
- Player: "Kovács Anna"
- Years: 2023, 2024, 2025, 2026
- 4 stat cards: 87 / 23 / 4 / 23 (total / this year / this month / selected year)
- Estimated: ~85 200 Ft precise, ~52 900 Ft simple
- Exact (from settlements): 73 500 Ft from 6 months
- Yearly chart: 2023=18, 2024=22, 2025=24, 2026=23
- Monthly chart (2026): Jan=3, Feb=4, Már=5, Ápr=3, Máj=4, Jún=2, others=0
- Recent dates: 2026-05-19, 2026-05-12, 2026-05-05, 2026-04-28...

### Design notes:
- Mobile-first (375px wide phone in mind)
- Charts can be **pure HTML+CSS bars** for the mockup — I will replace them with
  Chart.js / ApexCharts at integration time. So just use divs with `bg-brand-500 h-[XX]`
  styling for bars, with labels above them. Make them look nice but don't worry about
  interactivity.
- Heavy use of cards, soft shadows, rounded corners
- Hungarian language throughout
- Color hierarchy:
  - Estimated cost → blue/zinc tones (it's an approximation)
  - Exact cost → emerald/green tones (it's confirmed)
  - Charts → brand-500 (red) for yearly, emerald-500 for monthly
  - Stat cards → variety, subtle backgrounds

### What to output:
Pure HTML + Tailwind v4 classes only. Include ALL states in your output:
- Main state (player with all data)
- Empty state if no settlement records (just for the financial section)
- Loading skeleton state would be nice too (gray pulsing boxes)

Show me 2 design variations if you have different ideas — especially for the financial
summary section (it's the most info-dense part).
```

---

## Mikor visszakaptad

Másold ki a kapott HTML-t és illeszd be a chat-be, és én integrálom élő Firestore adatokkal.
