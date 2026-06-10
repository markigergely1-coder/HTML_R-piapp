<script lang="ts">
  import { getAuthState, signIn, signOut } from '../lib/auth';
  import { getInitials } from '../lib/avatar';
  import { getCurrentTheme, toggleTheme } from '../lib/theme';
  import { onAuthChange } from '../lib/auth';
  import { onMount } from 'svelte';

  export type PageKey =
    | 'overview'
    | 'profile'
    | 'me'
    | 'database'
    | 'yearly'
    | 'qr'
    | 'admin'
    | 'members'
    | 'accounting'
    | 'payments'
    | 'settings'
    | 'diagnostics';

  interface TabDef {
    key: PageKey;
    label: string;
    href: string;
    visibility: 'always' | 'authed' | 'admin' | 'transient';
  }

  const TABS: TabDef[] = [
    { key: 'me',          label: 'Jelenlét',    href: '#/me',          visibility: 'authed' },
    { key: 'overview',    label: 'Alkalmak',    href: '#/',            visibility: 'always' },
    { key: 'admin',       label: 'Regisztráció', href: '#/admin',       visibility: 'always' },
    { key: 'profile',     label: 'Profil',      href: '#/profile',     visibility: 'transient' },
    { key: 'database',    label: 'Adatbázis',   href: '#/database',    visibility: 'admin' },
    { key: 'yearly',      label: 'Statisztikák',href: '#/yearly',      visibility: 'admin' },
    { key: 'qr',          label: 'QR',          href: '#/qr',          visibility: 'admin' },
    { key: 'members',     label: 'Tagok',       href: '#/members',     visibility: 'admin' },
    { key: 'accounting',  label: 'Elszámolás',  href: '#/accounting',  visibility: 'admin' },
    { key: 'payments',    label: 'Befizetések', href: '#/payments',    visibility: 'admin' },
    { key: 'settings',    label: 'Beállítások', href: '#/settings',    visibility: 'admin' },
    { key: 'diagnostics', label: 'Diagnosztika',href: '#/diagnostics', visibility: 'admin' },
  ];

  const PAGE_LABEL: Record<PageKey, string> = {
    overview:    'Alkalmak',
    profile:     'Profil',
    me:          'Jelenlét',
    database:    'Adatbázis',
    yearly:      'Statisztikák',
    qr:          'Check-in',
    admin:       'Regisztráció',
    members:     'Tagok',
    accounting:  'Elszámolás',
    payments:    'Befizetések',
    settings:    'Beállítások',
    diagnostics: 'Diagnosztika',
  };

  let { currentPage = 'overview' }: { currentPage?: PageKey } = $props();

  let auth = $state(getAuthState());
  let isDark = $state(getCurrentTheme() === 'dark');

  onMount(() => {
    return onAuthChange((s) => {
      auth = s;
    });
  });

  const isLoggedIn = $derived(!!auth.user);
  const isAdmin = $derived(auth.isAdmin);

  const visibleTabs = $derived(TABS.filter((t) => {
    if (t.visibility === 'always') return true;
    if (t.visibility === 'transient') return t.key === currentPage;
    if (t.visibility === 'authed') return isLoggedIn;
    if (t.visibility === 'admin') return isAdmin;
    return false;
  }));

  function handleSignIn() {
    signIn().catch(e => console.warn('Sign-in failed:', e));
  }

  function handleSignOut() {
    signOut().catch(e => console.warn('Sign-out failed:', e));
  }

  function handleToggleTheme() {
    toggleTheme();
    isDark = getCurrentTheme() === 'dark';
  }

  let scroller: HTMLElement | undefined = $state();

  $effect(() => {
    if (scroller && currentPage) {
      const activeLink = scroller.querySelector(`a[href="${TABS.find(t => t.key === currentPage)?.href}"]`) as HTMLElement;
      if (activeLink) {
        requestAnimationFrame(() => {
          const targetLeft = activeLink.offsetLeft - (scroller!.offsetWidth - activeLink.offsetWidth) / 2;
          scroller!.scrollTo({ left: Math.max(0, targetLeft), behavior: 'instant' });
        });
      }
    }
  });
</script>

<div class="glass sticky top-0 z-30">
  <div class="px-5 py-3 flex items-center justify-between">
    <a href="#/" class="flex items-center gap-2.5 no-underline" style="color:inherit;text-decoration:none" aria-label="Főoldal">
      <div class="w-8 h-8 rounded-[10px] flex items-center justify-center relative overflow-hidden"
           style="background: linear-gradient(135deg, var(--accent) 0%, #14b8a6 100%)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="1.5">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12c4.5-1.5 13.5-1.5 18 0" />
          <path d="M12 3c-2.5 4.5-2.5 13.5 0 18" />
          <path d="M12 3c2.5 4.5 2.5 13.5 0 18" />
        </svg>
      </div>
      <div class="flex flex-col leading-none">
        <span class="text-[15px] font-semibold tracking-tight text-fg-1">Röpi</span>
        <span class="eyebrow text-[9px] mt-0.5">{PAGE_LABEL[currentPage]}</span>
      </div>
    </a>
    <div class="flex items-center gap-2">
      <button type="button" onclick={handleToggleTheme}
        class="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        style="background:var(--bg-elev);color:var(--fg-2);border:1px solid var(--line)"
        title={isDark ? 'Világos mód' : 'Sötét mód'} aria-label={isDark ? 'Világos mód' : 'Sötét mód'}>
        {#if isDark}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
        {/if}
      </button>

      {#if auth.loading}
        <div class="w-8 h-8 rounded-full animate-pulse" style="background:var(--line)"></div>
      {:else if !auth.user}
        <button onclick={handleSignIn}
          class="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold transition-colors"
          style="background:var(--accent)">
          Bejelentkezés
        </button>
      {:else}
        <div class="flex items-center gap-2 relative">
          <a href="#/me" class="relative no-underline" title="Saját — {auth.user.displayName || auth.user.email || '?'}" aria-label="Saját oldal">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold transition-transform hover:scale-105"
                 style="background:color-mix(in oklab, var(--accent) 16%, transparent); color:var(--accent-ink)">
              {getInitials(auth.user.displayName || auth.user.email || '?')}
            </div>
            {#if auth.isAdmin}
              <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500" style="border:2px solid var(--bg-card)" title="Admin"></span>
            {/if}
          </a>
          <button onclick={handleSignOut}
            class="text-[11px] font-medium text-fg-2 hover:text-fg-1 transition-colors">
            Kilépés
          </button>
        </div>
      {/if}
    </div>
  </div>
  <nav class="-mt-1">
    <div bind:this={scroller} class="flex gap-1 overflow-x-auto no-scrollbar px-3 pb-0.5">
      {#each visibleTabs as t}
        <a href={t.href}
           class="flex-none px-3 py-2.5 text-[13px] font-medium relative whitespace-nowrap"
           style="color: {t.key === currentPage ? 'var(--fg-1)' : 'var(--fg-3)'}">
          {t.label}
          {#if t.key === currentPage}
            <span class="absolute left-3 right-3 bottom-0 h-[2px] rounded-full" style="background:var(--accent)"></span>
          {/if}
        </a>
      {/each}
    </div>
  </nav>
</div>
