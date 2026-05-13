import './style.css';
import { startRouter } from './router';
import { maybeShowInAppBanner } from './lib/inappBrowser';
import { setupPwa } from './lib/pwa';

const app = document.querySelector<HTMLDivElement>('#app')!;
startRouter(app);

// Messenger / Facebook / Instagram in-app browser figyelmeztető banner
// (Google OAuth nem működik bennük: "Hiba 403: disallowed_useragent")
maybeShowInAppBanner();

// PWA: service worker + auto-update prompt
setupPwa();
