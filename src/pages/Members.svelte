<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import { getAuthState, onAuthChange, signIn } from '../lib/auth';
  import { logEvent } from '../lib/logger';
  import { getInitials } from '../lib/avatar';
  import {
    getAllMembers,
    addMember,
    updateMember,
    deleteMember,
    type Member,
  } from '../lib/firestore';

  let auth = $state(getAuthState());
  
  let members = $state<Member[]>([]);
  let filter = $state('');
  let editingId = $state<string | null>(null);
  let addOpen = $state(false);
  let toast = $state<{ kind: 'success' | 'error'; msg: string } | null>(null);

  const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  let toastTimer: number | null = null;

  function showToast(kind: 'success' | 'error', msg: string) {
    toast = { kind, msg };
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
    }, 2500);
  }

  onMount(() => {
    return onAuthChange((s) => {
      auth = s;
      if (s.user && s.isAdmin && members.length === 0) {
        getAllMembers().then(m => members = m).catch(console.error);
      }
    });
  });

  $effect(() => {
    if (auth.user && auth.isAdmin && members.length === 0) {
      getAllMembers().then(m => members = m).catch(console.error);
    }
  });

  const filteredMembers = $derived(
    filter.trim() === '' 
      ? members 
      : members.filter(m => 
          (m.name || '').toLowerCase().includes(filter.trim().toLowerCase()) || 
          (m.email || '').toLowerCase().includes(filter.trim().toLowerCase())
        )
  );

  const total = $derived(members.length);
  const activeCount = $derived(members.filter((m) => m.active).length);
  const inactiveCount = $derived(total - activeCount);

  function handleSignIn() {
    signIn().catch((e) => console.warn('Sign-in failed:', e));
  }

  // Add form state
  let newName = $state('');
  let newEmail = $state('');
  let newActive = $state(true);

  async function handleAddSave() {
    const name = newName.trim();
    const email = newEmail.trim();
    
    if (!name) {
      showToast('error', 'A név megadása kötelező.');
      return;
    }
    if (email && !EMAIL_REGEX.test(email)) {
      showToast('error', 'Érvénytelen email cím.');
      return;
    }
    try {
      await addMember({ name, email, active: newActive });
      void logEvent('info', 'Member added', { name, email });
      members = await getAllMembers();
      addOpen = false;
      newName = '';
      newEmail = '';
      newActive = true;
      showToast('success', `✓ ${name} hozzáadva`);
    } catch (e) {
      showToast('error', `Hiba: ${String(e)}`);
    }
  }

  async function handleDelete(m: Member) {
    if (!confirm(`Biztosan törlöd?\n\n${m.name} (${m.email})`)) return;
    try {
      await deleteMember(m.id!);
      void logEvent('warn', 'Member deleted', { name: m.name, email: m.email });
      members = members.filter((x) => x.id !== m.id);
      showToast('success', `🗑️ ${m.name} törölve`);
    } catch (e) {
      showToast('error', `Hiba: ${String(e)}`);
    }
  }

  function avatarHue(name: string): number {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return Math.abs(h) % 360;
  }

  // Row Edit state
  let editName = $state('');
  let editEmail = $state('');
  let editActive = $state(true);

  function startEdit(m: Member) {
    editingId = m.id!;
    editName = m.name || '';
    editEmail = m.email || '';
    editActive = m.active ?? true;
  }

  async function handleEditSave(id: string) {
    const name = editName.trim();
    const email = editEmail.trim();
    
    if (!name) {
      showToast('error', 'A név nem lehet üres.');
      return;
    }
    if (email && !EMAIL_REGEX.test(email)) {
      showToast('error', 'Érvénytelen email cím.');
      return;
    }
    try {
      await updateMember(id, { name, email, active: editActive });
      void logEvent('info', 'Member updated', { id, name, email });
      const m = members.find((x) => x.id === id);
      if (m) {
        m.name = name;
        m.email = email;
        m.active = editActive;
      }
      editingId = null;
      showToast('success', '✓ Mentve');
    } catch (e) {
      showToast('error', `Hiba: ${String(e)}`);
    }
  }
</script>

<div class="device">
  <Header currentPage="members" />
  
  <main id="members-body">
    {#if auth.loading}
      <div class="px-5 pt-5 space-y-3">
        <div class="grid grid-cols-2 gap-2.5">
          <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
          <div class="h-20 rounded-[22px] animate-pulse" style="background:var(--line)"></div>
        </div>
        <div class="h-14 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        {#each Array(5) as _}
          <div class="h-16 rounded-2xl animate-pulse" style="background:var(--line)"></div>
        {/each}
      </div>
    {:else if !auth.user}
      <div class="px-5 pt-5 pb-12 fade-up">
        <div class="card relative p-6 lg:p-8 text-center overflow-hidden" style="border-radius:24px">
          <div class="halo"></div>
          <div class="relative">
            <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
                 style="background:color-mix(in oklab,var(--accent) 14%,transparent)">
              <span class="text-3xl">🔒</span>
            </div>
            <p class="text-[17px] font-semibold text-fg-1 mb-1">Csak admin oldal</p>
            <p class="text-[13px] text-fg-3 max-w-[280px] mx-auto mb-5">
              A tagok kezeléséhez jelentkezz be az admin Google fiókoddal.
            </p>
            <button onclick={handleSignIn}
              class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-colors"
              style="background:var(--accent)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.35 11.1h-9.17v2.92h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.46 5 16.42 5 12c0-4.3 3.31-7.46 7.18-7.46 2.98 0 4.74 1.9 4.74 1.9L19 4.4S16.62 2 12.1 2 4 5.6 4 12c0 6.32 3.97 10 8.25 10 4.4 0 7.43-2.93 7.43-7.36 0-.94-.13-1.54-.13-1.54z"/>
              </svg>
              Bejelentkezés Google-lel
            </button>
          </div>
        </div>
      </div>
    {:else if !auth.isAdmin}
      <div class="px-5 pt-5 pb-12 fade-up">
        <div class="card-soft p-6 lg:p-8 text-center" style="border-radius:24px">
          <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
               style="background:color-mix(in oklab,#f59e0b 14%,transparent)">
            <span class="text-3xl">⛔</span>
          </div>
          <p class="text-[17px] font-semibold text-fg-1 mb-1">Nincs admin jogosultság</p>
          <p class="text-[13px] text-fg-3 max-w-[300px] mx-auto">
            A <span class="font-mono-tnum text-fg-1">{auth.user.email}</span> nem szerepel az admin email-ek között.
          </p>
        </div>
      </div>
    {:else}
      <div class="lg:grid lg:grid-cols-[320px_1fr] lg:gap-6 lg:p-6 lg:pt-5 lg:items-start">
        <aside class="lg:sticky lg:top-[110px] space-y-3 px-5 pt-5 lg:px-0 lg:pt-0">
          <div class="grid grid-cols-3 gap-2 fade-up">
            {@render statCard('Összes', total, 'red')}
            {@render statCard('Aktív', activeCount, 'emerald')}
            {@render statCard('Inaktív', inactiveCount, 'zinc')}
          </div>
          
          <div class="lg:hidden">
            {#if !addOpen}
              <button onclick={() => addOpen = true}
                class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[13px] font-semibold transition-colors fade-up"
                style="border:1.5px dashed var(--line-strong); background:var(--bg-card); color:var(--fg-2)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
                </svg>
                Új tag hozzáadása
              </button>
            {:else}
              {@render addForm(true)}
            {/if}
          </div>
          <div class="hidden lg:block">
            {@render addForm(false)}
          </div>
        </aside>

        <section class="px-5 pt-3 pb-12 lg:px-0 lg:pt-0 space-y-3">
          <div class="card flex items-center gap-2.5 px-3.5 py-2 fade-up" style="border-radius:16px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--fg-3);flex:none">
              <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input type="search" placeholder="Keresés név vagy email alapján…"
              bind:value={filter}
              class="flex-1 bg-transparent text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none py-1.5" />
            {#if filter}
              <button onclick={() => filter = ''} class="text-[11px] font-semibold transition-colors" style="color:var(--accent)">Töröl</button>
            {/if}
          </div>
          
          {#if filteredMembers.length === 0}
            <div class="card-soft p-8 text-center fade-up" style="border-radius:22px">
              <div class="text-3xl mb-2">{filter ? '🔍' : '👥'}</div>
              <p class="text-[14px] font-semibold text-fg-1">
                {filter ? 'Nincs találat' : 'Még nincs tag'}
              </p>
              <p class="text-[12px] text-fg-3 mt-1">
                {filter
                  ? `A "${filter}" keresésre nincs egyezés.`
                  : 'Adj hozzá egy új tagot.'}
              </p>
            </div>
          {:else}
            <div class="card overflow-hidden fade-up" style="border-radius:22px">
              <ul>
                {#each filteredMembers as m, i}
                  {#if editingId === m.id}
                    <li style="{i > 0 ? 'border-top:1px solid var(--line);' : ''} background:color-mix(in oklab,var(--accent) 6%,transparent)">
                      <div class="px-4 py-3.5 space-y-2.5">
                        <input class="w-full rounded-[12px] border px-3 py-2 text-[13.5px] text-fg-1 focus:outline-none"
                          style="border-color:var(--line-strong); background:var(--bg-card)"
                          type="text" bind:value={editName} placeholder="Név" />
                        <input class="w-full rounded-[12px] border px-3 py-2 text-[13.5px] text-fg-1 focus:outline-none"
                          style="border-color:var(--line-strong); background:var(--bg-card)"
                          type="email" bind:value={editEmail} placeholder="Email" />
                        <div class="flex items-center justify-between">
                          <label class="flex items-center gap-2 cursor-pointer">
                            <input class="w-4 h-4 rounded" style="accent-color:var(--accent)"
                              type="checkbox" bind:checked={editActive} />
                            <span class="text-[12px] text-fg-2">Aktív</span>
                          </label>
                          <div class="flex gap-2">
                            <button onclick={() => editingId = null} class="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
                              style="background:var(--bg-elev); color:var(--fg-2)">
                              Mégse
                            </button>
                            <button onclick={() => handleEditSave(m.id!)} class="px-3 py-1.5 rounded-full text-white text-[12px] font-semibold transition-colors"
                              style="background:var(--accent)">
                              Mentés
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  {:else}
                    <li class="hover:bg-[color:var(--bg-elev)] transition-colors" style="{i > 0 ? 'border-top:1px solid var(--line);' : ''}">
                      <div class="flex items-center gap-3 px-4 py-3">
                        <div class="rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[11px] relative"
                             style="width:36px;height:36px;background:linear-gradient(135deg,hsl({avatarHue(m.name || '?')} 80% 88%) 0%,hsl({(avatarHue(m.name || '?')+30)%360} 75% 78%) 100%);color:hsl({avatarHue(m.name || '?')} 60% 30%)">
                          {getInitials(m.name || '?')}
                          {#if !m.active}
                            <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full" style="background:#a3a3a3;border:2px solid var(--bg-card)" title="Inaktív"></span>
                          {/if}
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-[13.5px] font-semibold text-fg-1 truncate">{m.name || '(nincs név)'}</p>
                          <p class="text-[11.5px] text-fg-3 truncate font-mono-tnum">{m.email || '(nincs email)'}</p>
                        </div>
                        <div class="flex items-center gap-0.5 flex-shrink-0">
                          <button onclick={() => startEdit(m)} class="p-2 rounded-lg transition-colors hover:bg-[color:var(--bg-card)]"
                            title="Szerkesztés" style="color:var(--fg-3)">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                            </svg>
                          </button>
                          <button onclick={() => handleDelete(m)} class="p-2 rounded-lg transition-colors hover:bg-[color:var(--bg-card)]"
                            title="Törlés" style="color:var(--fg-3)">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </li>
                  {/if}
                {/each}
              </ul>
            </div>
          {/if}
        </section>
      </div>

      {#if toast}
        <div class="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-lg text-[12.5px] font-semibold fade-up"
          style="bottom:24px;{toast.kind === 'success' ? 'background:color-mix(in oklab,#10b981 14%,var(--bg-card));border:1px solid color-mix(in oklab,#10b981 30%,var(--line));color:#047857' : 'background:color-mix(in oklab,var(--danger) 14%,var(--bg-card));border:1px solid color-mix(in oklab,var(--danger) 30%,var(--line));color:var(--danger-ink)'}">
          {toast.msg}
        </div>
      {/if}
    {/if}
  </main>
</div>

{#snippet statCard(label: string, value: number, tone: 'red' | 'emerald' | 'zinc')}
  {@const tones = {
    red:     { dot:'var(--accent)',  tint:'color-mix(in oklab,var(--accent) 10%,transparent)' },
    emerald: { dot:'#10b981', tint:'rgba(16,185,129,0.10)' },
    zinc:    { dot:'#a3a3a3', tint:'rgba(160,160,160,0.08)' },
  }}
  {@const t = tones[tone]}
  <div class="card relative p-3.5 overflow-hidden lift">
    <div class="absolute -top-3 -right-3 w-14 h-14 rounded-full" style="background:{t.tint};filter:blur(8px)"></div>
    <div class="relative flex items-center justify-between mb-2">
      <span class="eyebrow text-[10px]">{label}</span>
      <span class="w-1.5 h-1.5 rounded-full" style="background:{t.dot}"></span>
    </div>
    <p class="relative font-mono-tnum font-semibold text-[26px] leading-none num-display text-fg-1">{value}</p>
  </div>
{/snippet}

{#snippet addForm(closable: boolean)}
  <div class="card p-4 lg:p-5 fade-up">
    <div class="flex items-center justify-between mb-3">
      <span class="eyebrow">Új tag</span>
      {#if closable}
        <button onclick={() => addOpen = false} class="text-[11px] text-fg-3 hover:text-fg-1 transition-colors">Mégse</button>
      {/if}
    </div>
    <div class="space-y-2.5">
      <label class="block">
        <span class="text-[10px] font-medium text-fg-3 block mb-1">Név</span>
        <input type="text" placeholder="Teljes név"
          bind:value={newName}
          class="w-full rounded-[12px] border px-3 py-2.5 text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none focus:border-current transition-colors"
          style="border-color:var(--line-strong); background:var(--bg-elev)" />
      </label>
      <label class="block">
        <span class="text-[10px] font-medium text-fg-3 block mb-1">Email</span>
        <input type="email" placeholder="nev@example.com"
          bind:value={newEmail}
          class="w-full rounded-[12px] border px-3 py-2.5 text-[13.5px] text-fg-1 placeholder-fg-3 focus:outline-none focus:border-current transition-colors"
          style="border-color:var(--line-strong); background:var(--bg-elev)" />
      </label>
      <label class="flex items-center gap-2 cursor-pointer py-1.5">
        <input type="checkbox" bind:checked={newActive} class="w-4 h-4 rounded" style="accent-color:var(--accent)" />
        <span class="text-[12.5px] text-fg-2">Aktív tag</span>
      </label>
      <button onclick={handleAddSave}
        class="w-full px-4 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-sm transition-colors"
        style="background:var(--accent)">
        Mentés
      </button>
    </div>
  </div>
{/snippet}
