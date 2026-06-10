<script lang="ts">
  import { onMount } from 'svelte';
  import { onAuthChange, getAuthState } from './lib/auth';
  import Overview from './pages/Overview.svelte';
  import Members from './pages/Members.svelte';
  import Profile from './pages/Profile.svelte';
  import Me from './pages/Me.svelte';
  import Admin from './pages/Admin.svelte';
  import Database from './pages/Database.svelte';
  import Accounting from './pages/Accounting.svelte';
  import Payments from './pages/Payments.svelte';
  import Yearly from './pages/Yearly.svelte';
  import Qr from './pages/Qr.svelte';
  import Settings from './pages/Settings.svelte';
  import Diagnostics from './pages/Diagnostics.svelte';
  
  let hash = $state(window.location.hash || '#/');
  let authState = $state(getAuthState());

  const OVERVIEW_KEEP_EMAILS = new Set([
    'domokos.csenge2000@gmail.com',
  ]);

  let initialRedirectDone = false;

  onMount(() => {
    const handleHashChange = () => {
      let raw = window.location.hash || '#/';
      const qIdx = raw.indexOf('?');
      hash = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
      
      if (!initialRedirectDone && !authState.loading) {
        initialRedirectDone = true;
        if (
          /^#?\/?$/.test(hash) &&
          authState.user &&
          !authState.isAdmin &&
          !OVERVIEW_KEEP_EMAILS.has(authState.user.email?.toLowerCase() ?? '')
        ) {
          window.location.hash = '#/me';
          return;
        }
      }
    };
    
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    
    const unsub = onAuthChange((state) => {
      authState = state;
      handleHashChange();
    });
    
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      unsub();
    };
  });
</script>

{#if /^#?\/?$/.test(hash)}
  <Overview />
{:else if /^#?\/members\/?$/.test(hash)}
  <Members />
{:else if /^#?\/profile\/?$/.test(hash)}
  <Profile />
{:else if /^#?\/me\/?$/.test(hash)}
  <Me />
{:else if /^#?\/admin\/?$/.test(hash)}
  <Admin />
{:else if /^#?\/database\/?$/.test(hash)}
  <Database />
{:else if /^#?\/accounting\/?$/.test(hash)}
  <Accounting />
{:else if /^#?\/payments\/?$/.test(hash)}
  <Payments />
{:else if /^#?\/yearly\/?$/.test(hash)}
  <Yearly />
{:else if /^#?\/qr\/?$/.test(hash)}
  <Qr />
{:else if /^#?\/settings\/?$/.test(hash)}
  <Settings />
{:else if /^#?\/diagnostics\/?$/.test(hash)}
  <Diagnostics />
{:else}
  <!-- Default to overview if route unknown -->
  <Overview />
{/if}
