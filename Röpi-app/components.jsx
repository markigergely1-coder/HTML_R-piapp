// ────────────────────────────────────────────────────────────────────
// Header — sticky, frosted, Apple-y
// ────────────────────────────────────────────────────────────────────
function Header({ density }) {
  return (
    <header className="glass sticky top-0 z-30">
      <div className="px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-fg-1">Röpi</span>
            <span className="eyebrow text-[9px] mt-0.5">Profil</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button aria-label="Keresés" className="w-8 h-8 rounded-full flex items-center justify-center hairline-strong border" style={{borderColor:'var(--line)'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-fg-2">
              <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
            </svg>
          </button>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold"
               style={{background:'color-mix(in oklab, var(--accent) 16%, transparent)', color:'var(--accent-ink)'}}>
            MG
          </div>
        </div>
      </div>
      <Tabs />
    </header>
  );
}

function Logo() {
  return (
    <div className="w-8 h-8 rounded-[10px] flex items-center justify-center relative overflow-hidden"
         style={{background:'linear-gradient(135deg, var(--accent) 0%, #f97316 100%)'}}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12c4.5-1.5 13.5-1.5 18 0" />
        <path d="M12 3c-2.5 4.5-2.5 13.5 0 18" />
        <path d="M12 3c2.5 4.5 2.5 13.5 0 18" />
      </svg>
    </div>
  );
}

function Tabs() {
  const tabs = [
    { key:'overview', label:'Alkalmak' },
    { key:'profile',  label:'Profil', active:true },
    { key:'qr',       label:'QR' },
    { key:'members',  label:'Tagok' },
  ];
  return (
    <nav className="px-3 -mt-1">
      <div className="flex gap-1">
        {tabs.map(t => (
          <a key={t.key} href="#"
             className="px-3 py-2.5 text-[13px] font-medium relative"
             style={{ color: t.active ? 'var(--fg-1)' : 'var(--fg-3)' }}>
            {t.label}
            {t.active && (
              <span className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full"
                    style={{background:'var(--accent)'}} />
            )}
          </a>
        ))}
      </div>
    </nav>
  );
}

// ────────────────────────────────────────────────────────────────────
// Selectors row
// ────────────────────────────────────────────────────────────────────
function Selectors({ player, year, onPlayer, onYear, years }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2.5 px-5 pt-5">
      <Field label="Játékos">
        <select value={player} onChange={e => onPlayer(e.target.value)}
                className="select-native w-full rounded-[14px] hairline border px-3.5 py-3 text-[15px] font-medium text-fg-1"
                style={{borderColor:'var(--line-strong)'}}>
          {PLAYERS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </Field>
      <Field label="Év">
        <select value={year} onChange={e => onYear(Number(e.target.value))}
                className="select-native rounded-[14px] hairline border px-3.5 py-3 text-[15px] font-medium text-fg-1"
                style={{borderColor:'var(--line-strong)'}}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </Field>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

// ────────────────────────────────────────────────────────────────────
// Activity rings + avatar hero
// ────────────────────────────────────────────────────────────────────
function HeroRings({ player, year, totals, monthlyThis, currentMonth }) {
  const yearCount = totals[year] ?? 0;
  const monthCount = monthlyThis[currentMonth - 1] ?? 0;

  // Goals chosen for prettier rings — full ring at "ideal" count
  const yearGoal = 40;        // ~40 tuesdays / year
  const monthGoal = 4;        // ~4 tuesdays / month
  const careerGoal = 100;

  const yp = Math.min(1, yearCount / yearGoal);
  const mp = Math.min(1, monthCount / monthGoal);
  const cp = Math.min(1, (totals.total ?? 0) / careerGoal);

  const initials = getInitials(player);
  const hue = avatarHue(player);

  return (
    <section className="relative px-5 pt-6 pb-2 fade-up">
      <div className="halo" />
      <div className="relative card noise lift overflow-hidden" style={{borderRadius:'28px'}}>
        <div className="relative p-5 flex items-center gap-5">
          {/* Rings + avatar */}
          <div className="relative flex-shrink-0" style={{width:124, height:124}}>
            <Ring size={124} stroke={9} progress={cp} color="var(--hue-ring-1)" delay={0} />
            <Ring size={102} stroke={9} progress={yp} color="var(--hue-ring-2)" delay={120} offset={11} />
            <Ring size={80}  stroke={9} progress={mp} color="var(--hue-ring-3)" delay={240} offset={22} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-[54px] h-[54px] rounded-full flex items-center justify-center font-semibold text-[18px]"
                   style={{
                     background:`linear-gradient(135deg, hsl(${hue} 80% 88%) 0%, hsl(${(hue+30)%360} 75% 78%) 100%)`,
                     color:`hsl(${hue} 60% 30%)`,
                   }}>
                {initials}
              </div>
            </div>
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <p className="eyebrow mb-1">Játékos · {year}</p>
            <h1 className="text-[26px] font-bold tracking-tight leading-[1.05] text-fg-1 truncate">{player}</h1>
            <p className="text-[13px] text-fg-2 mt-1.5">
              <span className="font-mono-tnum font-semibold text-fg-1">{totals.total}</span> alkalom összesen
            </p>
          </div>
        </div>

        {/* Ring legend */}
        <div className="grid grid-cols-3 hairline border-t" style={{borderColor:'var(--line)'}}>
          <RingStat color="var(--hue-ring-1)" label="Karrier" value={totals.total} sub={`/ ${careerGoal}`} />
          <RingStat color="var(--hue-ring-2)" label="Idei év"  value={yearCount}    sub={`/ ${yearGoal}`}   border />
          <RingStat color="var(--hue-ring-3)" label="Ez a hó"  value={monthCount}   sub={`/ ${monthGoal}`}  />
        </div>
      </div>
    </section>
  );
}

function Ring({ size, stroke, progress, color, delay=0, offset=0 }) {
  const r = (size - stroke) / 2 - offset;
  const c = 2 * Math.PI * r;
  const dash = c * progress;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={stroke}
              className="ring-track" strokeLinecap="round" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
              transform={`rotate(-90 ${size/2} ${size/2})`}
              className="ring-arc"
              style={{
                '--from-offset': c,
                '--to-offset': 0,
                animationDelay: `${delay}ms`,
                strokeDashoffset: 0,
              }} />
    </svg>
  );
}

function RingStat({ color, label, value, sub, border }) {
  return (
    <div className={`px-3 py-3 ${border ? 'border-l border-r' : ''}`} style={{borderColor:'var(--line)'}}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{background:color}} />
        <span className="eyebrow text-[10px]">{label}</span>
      </div>
      <p className="leading-none">
        <span className="font-mono-tnum font-semibold text-[20px] text-fg-1 num-display">{value}</span>
        <span className="font-mono-tnum text-[11px] text-fg-3 ml-1">{sub}</span>
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Stat grid (2x2 / 4x1)
// ────────────────────────────────────────────────────────────────────
function StatGrid({ totals, year, monthlyThis, monthlySelected, currentYear, currentMonth }) {
  const all = totals.total;
  const thisYear = totals[currentYear] ?? 0;
  const thisMonth = monthlyThis[currentMonth - 1] ?? 0;
  const selectedYear = totals[year] ?? 0;

  const cards = [
    { label:'Összes',       value:all,          tone:'red',    glyph:'∞' },
    { label:`${currentYear}`, value:thisYear,   tone:'amber',  glyph:'☉' },
    { label:`${currentYear}/${String(currentMonth).padStart(2,'0')}`, value:thisMonth, tone:'emerald', glyph:'◐' },
    { label:`${year}`,       value:selectedYear, tone:'violet', glyph:'☷' },
  ];

  return (
    <section className="px-5 pt-4 fade-up" style={{animationDelay:'80ms'}}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {cards.map((c,i) => <StatCard key={i} {...c} />)}
      </div>
    </section>
  );
}

const TONE = {
  red:     { dot:'#ef4444', tint:'rgba(239,68,68,0.10)' },
  amber:   { dot:'#f59e0b', tint:'rgba(245,158,11,0.10)' },
  emerald: { dot:'#10b981', tint:'rgba(16,185,129,0.10)' },
  violet:  { dot:'#8b5cf6', tint:'rgba(139,92,246,0.10)' },
};

function StatCard({ label, value, tone, glyph }) {
  const t = TONE[tone] || TONE.red;
  return (
    <div className="card relative p-3.5 overflow-hidden lift">
      <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full"
           style={{background:t.tint, filter:'blur(8px)'}} />
      <div className="relative flex items-center justify-between mb-3">
        <span className="eyebrow text-[10px] truncate">{label}</span>
        <span className="w-1.5 h-1.5 rounded-full" style={{background:t.dot}} />
      </div>
      <p className="relative font-mono-tnum font-semibold text-[28px] leading-none num-display text-fg-1">{value}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Financial summary
// ────────────────────────────────────────────────────────────────────
function Financial({ player, year, totals, settlements }) {
  const yearCount = totals[year] ?? 0;

  // Estimated cost (precise + simple)
  const hourlyRate = 8500;
  const duration   = 1.5;
  const avgAttendees = 11;
  const precise = yearCount * (hourlyRate * duration / avgAttendees);
  const simple  = yearCount * 2300;

  const exact = settlements?.reduce((a,b) => a + b.amount, 0) ?? 0;
  const hasExact = settlements && settlements.length > 0;
  const unpaid = settlements?.filter(s => !s.paid).reduce((a,b)=>a+b.amount,0) ?? 0;

  return (
    <section className="px-5 pt-4 fade-up" style={{animationDelay:'120ms'}}>
      <div className="flex items-end justify-between mb-3">
        <h2 className="text-[20px] font-semibold tracking-tight text-fg-1">Pénzügy</h2>
        <span className="eyebrow">{year}</span>
      </div>

      {/* Estimated — primary card */}
      <div className="card relative p-5 overflow-hidden lift" style={{borderRadius:'24px'}}>
        <div className="absolute inset-0 opacity-90"
             style={{background:'radial-gradient(120% 80% at 90% 0%, rgba(56,189,248,0.18) 0%, transparent 60%)'}} />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Becsült összeg</span>
            <span className="text-[10px] font-mono-tnum text-fg-3">{hourlyRate.toLocaleString('hu-HU')} Ft/h · {duration}h · {avgAttendees} fő</span>
          </div>
          <p className="font-mono-tnum num-display font-semibold text-[44px] leading-none mt-2 text-fg-1">
            ~{formatHuf(precise)}
          </p>
          <p className="text-[12px] text-fg-2 mt-2 font-mono-tnum">
            {formatHuf(precise / Math.max(1,yearCount))} / alkalom · {yearCount} alkalom
          </p>

          <div className="mt-4 pt-4 hairline border-t flex items-center justify-between">
            <div>
              <p className="eyebrow text-[10px] mb-0.5">Egyszerű becslés</p>
              <p className="text-[11px] text-fg-3 font-mono-tnum">2 300 Ft × {yearCount}</p>
            </div>
            <p className="font-mono-tnum font-semibold text-[18px] num-display text-fg-1">{formatHuf(simple)}</p>
          </div>
        </div>
      </div>

      {/* Exact (settlement) */}
      {hasExact ? (
        <div className="card relative p-5 overflow-hidden mt-3 lift" style={{borderRadius:'24px'}}>
          <div className="absolute inset-0"
               style={{background:'radial-gradient(120% 80% at 10% 0%, rgba(16,185,129,0.18) 0%, transparent 60%)'}} />
          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="eyebrow" style={{color:'#047857'}}>Pontos · {settlements.length} hónap</span>
              {unpaid > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{background:'rgba(239,68,68,0.10)', color:'var(--accent-ink)'}}>
                  {formatHuf(unpaid)} függőben
                </span>
              )}
            </div>
            <p className="font-mono-tnum num-display font-semibold text-[44px] leading-none mt-2 text-fg-1">
              {formatHuf(exact)}
            </p>
            <p className="text-[12px] text-fg-2 mt-1">Elszámolás alapján</p>

            <ul className="mt-4 pt-3 hairline border-t divide-y" style={{borderColor:'var(--line)'}}>
              {settlements.map(s => (
                <li key={s.month} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center font-mono-tnum text-[11px] font-semibold"
                          style={{background:s.paid ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                                  color: s.paid ? '#047857' : '#92400e'}}>
                      {String(s.month).padStart(2,'0')}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-fg-1 leading-tight">{s.name}</p>
                      <p className="text-[11px] text-fg-3 font-mono-tnum">{s.sessions} alkalom</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono-tnum text-[14px] font-semibold text-fg-1">{formatHuf(s.amount)}</p>
                    <p className="text-[10px] font-medium" style={{color: s.paid ? '#047857' : 'var(--accent-ink)'}}>
                      {s.paid ? '✓ Befizetve' : 'Függőben'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="card-soft mt-3 p-5 text-center" style={{borderRadius:'24px'}}>
          <div className="w-10 h-10 rounded-full mx-auto flex items-center justify-center mb-2.5"
               style={{background:'color-mix(in oklab, var(--fg-3) 16%, transparent)'}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-fg-2">
              <rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/>
            </svg>
          </div>
          <p className="text-[14px] font-semibold text-fg-1">Még nincs elszámolás</p>
          <p className="text-[12px] text-fg-2 mt-1 max-w-[260px] mx-auto">
            A hónap végén a pénztáros lezárja az alkalmakat, és itt látszik a pontos összeg.
          </p>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Yearly chart
// ────────────────────────────────────────────────────────────────────
function YearlyChart({ totals, year }) {
  const years = [2023, 2024, 2025, 2026];
  const max = Math.max(...years.map(y => totals[y] ?? 0), 1);
  const BAR = 140;

  return (
    <section className="px-5 pt-5 fade-up" style={{animationDelay:'160ms'}}>
      <div className="flex items-end justify-between mb-3">
        <h2 className="text-[20px] font-semibold tracking-tight text-fg-1">Éves összesítő</h2>
        <span className="eyebrow">{years[0]}–{years[years.length-1]}</span>
      </div>
      <div className="card p-5" style={{borderRadius:'24px'}}>
        <div className="flex items-end gap-4" style={{minHeight: BAR + 44}}>
          {years.map((y, i) => {
            const v = totals[y] ?? 0;
            const h = Math.max(8, Math.round((v / max) * BAR));
            const selected = y === year;
            return (
              <div key={y} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                <span className={`font-mono-tnum text-[12px] ${selected ? 'font-semibold text-fg-1' : 'text-fg-2'}`}>{v}</span>
                <div className="w-full max-w-[52px] relative">
                  <div
                    className={`bar-fill w-full rounded-t-[10px] ${selected ? 'bar-brand' : ''}`}
                    style={{
                      height: h,
                      animationDelay: `${i*80}ms`,
                      background: selected ? undefined : 'color-mix(in oklab, var(--fg-3) 28%, transparent)',
                    }}
                  />
                </div>
                <span className={`text-[11px] font-mono-tnum ${selected ? 'font-semibold text-fg-1' : 'text-fg-3'}`}>{y}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Monthly chart
// ────────────────────────────────────────────────────────────────────
function MonthlyChart({ year, monthly, currentYear, currentMonth }) {
  const max = Math.max(...monthly, 1);
  const BAR = 100;
  const total = monthly.reduce((a,b)=>a+b,0);

  return (
    <section className="px-5 pt-5 fade-up" style={{animationDelay:'200ms'}}>
      <div className="flex items-end justify-between mb-3">
        <h2 className="text-[20px] font-semibold tracking-tight text-fg-1">Havi bontás</h2>
        <span className="eyebrow">{year} · {total} alkalom</span>
      </div>
      <div className="card p-5" style={{borderRadius:'24px'}}>
        <div className="flex items-end gap-1.5" style={{minHeight: BAR + 36}}>
          {monthly.map((v, i) => {
            const h = Math.max(4, Math.round((v / max) * BAR));
            const isCurrent = year === currentYear && i + 1 === currentMonth;
            const empty = v === 0;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                <span className={`text-[10px] font-mono-tnum ${empty ? 'text-fg-3 opacity-60' : 'font-semibold text-fg-1'}`}>{v || '·'}</span>
                <div
                  className={`bar-fill w-full max-w-[20px] rounded-t-[6px] ${empty ? 'bar-empty' : (isCurrent ? 'bar-brand' : 'bar-emerald')}`}
                  style={{height: h, animationDelay: `${i*40}ms`}}
                />
                <span className="text-[10px] text-fg-3">{MONTH_SHORT[i]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Recent sessions — timeline
// ────────────────────────────────────────────────────────────────────
function RecentSessions({ player, currentYear, currentMonth }) {
  const dates = RECENT[player] ?? DEFAULT_RECENT;
  return (
    <section className="px-5 pt-5 pb-10 fade-up" style={{animationDelay:'240ms'}}>
      <div className="flex items-end justify-between mb-3">
        <h2 className="text-[20px] font-semibold tracking-tight text-fg-1">Utolsó {dates.length} alkalom</h2>
        <a href="#" className="text-[12px] font-medium" style={{color:'var(--accent)'}}>Összes →</a>
      </div>
      <div className="card overflow-hidden" style={{borderRadius:'24px'}}>
        <ol className="relative">
          {dates.map((iso, i) => {
            const [y,m,d] = iso.split('-').map(Number);
            const isCurrent = y === currentYear && m === currentMonth;
            return (
              <li key={iso} className="flex items-center gap-3 px-4 py-3 hairline border-b last:border-b-0"
                  style={{borderColor:'var(--line)'}}>
                <div className="w-11 h-11 rounded-[12px] flex flex-col items-center justify-center flex-shrink-0"
                     style={{
                       background: isCurrent ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'color-mix(in oklab, var(--fg-3) 12%, transparent)',
                     }}>
                  <span className="eyebrow text-[8px]" style={{color: isCurrent ? 'var(--accent-ink)' : undefined}}>{MONTH_SHORT[m-1]}</span>
                  <span className={`font-mono-tnum font-semibold text-[15px] leading-none mt-0.5 ${isCurrent ? '' : 'text-fg-1'}`}
                        style={{color: isCurrent ? 'var(--accent-ink)' : undefined}}>{d}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-fg-1">{formatHuLong(iso)}</p>
                  <p className="text-[11px] text-fg-3 font-mono-tnum">{y} · {String(m).padStart(2,'0')}. hónap</p>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{background:'rgba(16,185,129,0.12)', color:'#047857'}}>
                  ✓ Részt vett
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

Object.assign(window, {
  Header, Selectors, HeroRings, StatGrid, Financial, YearlyChart, MonthlyChart, RecentSessions,
});
