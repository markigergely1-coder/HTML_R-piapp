import { mount } from 'svelte';
import './style.css';
import App from './App.svelte';
import { maybeShowInAppBanner } from './lib/inappBrowser';
import { setupPwa } from './lib/pwa';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { setupAutoPushPrompt } from './lib/pushPrompt';
import { setupPushTokenKeepAlive } from './lib/notifications';
import { setupInstallPrompt } from './lib/installPrompt';

// Téma alkalmazása MIELŐTT bármi renderelődne (villanás-mentes initial paint)
applyTheme();
watchSystemTheme();

const app = document.querySelector<HTMLDivElement>('#app')!;
mount(App, { target: app });

// Telepített PWA-ban: első bejelentkezésnél megkérdezzük engedélyezi-e a push-t
setupAutoPushPrompt();

// Push token keepalive: minden app-indításkor frissíti az FCM tokent és
// automatikusan újra-feliratkoztat ha a subscription elveszett volna.
setupPushTokenKeepAlive();

// Messenger / Facebook / Instagram in-app browser figyelmeztető banner
// (Google OAuth nem működik bennük: "Hiba 403: disallowed_useragent")
maybeShowInAppBanner();

// PWA: service worker + auto-update prompt
setupPwa();

// PWA: „App telepítése" banner — natív prompt Androidon, iOS útmutató iPhone-on
setupInstallPrompt();
