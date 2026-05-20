import './style.css';
import { startRouter } from './router';
import { maybeShowInAppBanner } from './lib/inappBrowser';
import { setupPwa } from './lib/pwa';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { setupAutoPushPrompt } from './lib/pushPrompt';

// Téma alkalmazása MIELŐTT bármi renderelődne (villanás-mentes initial paint)
applyTheme();
watchSystemTheme();

const app = document.querySelector<HTMLDivElement>('#app')!;
startRouter(app);

// Telepített PWA-ban: első bejelentkezésnél megkérdezzük engedélyezi-e a push-t
setupAutoPushPrompt();

// Messenger / Facebook / Instagram in-app browser figyelmeztető banner
// (Google OAuth nem működik bennük: "Hiba 403: disallowed_useragent")
maybeShowInAppBanner();

// PWA: service worker + auto-update prompt
setupPwa();
