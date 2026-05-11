const { useState, useEffect, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "sand",
  "accent": "#ef4444",
  "density": "comfy",
  "showFinancial": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [player, setPlayer] = useState('Kovács Anna');
  const [year, setYear] = useState(2026);

  const currentYear = 2026;
  const currentMonth = 5; // May

  // Apply theme + accent to body
  useEffect(() => {
    document.body.classList.remove('theme-sand','theme-light','theme-dark');
    document.body.classList.add('theme-' + tweaks.theme);
    document.documentElement.style.setProperty('--accent', tweaks.accent);
    // derive a soft and ink shade
    document.documentElement.style.setProperty('--accent-soft', tweaks.accent + '22');
    document.documentElement.style.setProperty('--accent-ink', tweaks.accent);
    document.documentElement.style.setProperty('--hue-ring-1', tweaks.accent);
  }, [tweaks.theme, tweaks.accent]);

  const totals = YEARLY_TOTALS[player] ?? YEARLY_TOTALS['Kovács Anna'];
  const monthlyThis = MONTHLY_2026[player] ?? MONTHLY_2026['Kovács Anna'];
  const monthlySelected = year === 2026 ? monthlyThis : Array(12).fill(0).map((_,i) => i<6 ? Math.floor((totals[year] ?? 0)/6) : 0);
  const settlements = SETTLEMENTS_2026[player];

  return (
    <div className="device">
      <Header density={tweaks.density} />

      <Selectors
        player={player} year={year}
        onPlayer={setPlayer} onYear={setYear}
        years={[2023,2024,2025,2026]}
      />

      <HeroRings
        player={player} year={year}
        totals={totals} monthlyThis={monthlyThis}
        currentMonth={currentMonth}
      />

      <StatGrid
        totals={totals} year={year}
        monthlyThis={monthlyThis} monthlySelected={monthlySelected}
        currentYear={currentYear} currentMonth={currentMonth}
      />

      {tweaks.showFinancial && (
        <Financial player={player} year={year} totals={totals} settlements={settlements} />
      )}

      <YearlyChart totals={totals} year={year} />
      <MonthlyChart year={year} monthly={monthlySelected} currentYear={currentYear} currentMonth={currentMonth} />
      <RecentSessions player={player} currentYear={currentYear} currentMonth={currentMonth} />

      <TweaksPanel title="Tweaks">
        <TweakSection title="Téma">
          <TweakRadio
            label="Megjelenés"
            value={tweaks.theme}
            onChange={v => setTweak('theme', v)}
            options={[
              { value:'sand',  label:'Homok' },
              { value:'light', label:'Világos' },
              { value:'dark',  label:'Sötét' },
            ]}
          />
          <TweakColor
            label="Akcent szín"
            value={tweaks.accent}
            onChange={v => setTweak('accent', v)}
            options={['#ef4444', '#f97316', '#0ea5e9', '#8b5cf6']}
          />
        </TweakSection>
        <TweakSection title="Megjelenítés">
          <TweakToggle
            label="Pénzügy szekció"
            value={tweaks.showFinancial}
            onChange={v => setTweak('showFinancial', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
