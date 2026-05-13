/**
 * In-app browser detektálás (Messenger, Facebook, Instagram, TikTok, stb).
 *
 * Miért fontos: a Google OAuth bejelentkezés HIBÁT dob ezekben a webview-okban
 * (Hiba 403: disallowed_useragent), mert a Google biztonsági policy-je
 * letiltja az embedded WebView-on keresztüli authentikációt.
 *
 * A megoldás: figyelmeztető bannert mutatunk és kérjük hogy a felhasználó
 * nyissa meg az oldalt valódi böngészőben.
 */

export interface InAppDetection {
  isInApp: boolean;
  source: string | null;     // emberi olvasású név (pl. "Messenger", "Facebook")
  isIOS: boolean;
  isAndroid: boolean;
}

export function detectInAppBrowser(): InAppDetection {
  const ua = navigator.userAgent || '';
  const lower = ua.toLowerCase();

  const isIOS = /iphone|ipad|ipod/.test(lower);
  const isAndroid = /android/.test(lower);

  // Egyes appok specifikus markert raknak az UA-ba
  // (Facebook/Messenger: FBAN, FBAV; Instagram: Instagram; TikTok: aweme, musical_ly stb.)
  const sources: { match: RegExp; name: string }[] = [
    { match: /FBAN|FBAV|FB_IAB/i, name: 'Facebook' },
    { match: /Messenger|FB_Messenger|MessengerLiteForiOS/i, name: 'Messenger' },
    { match: /Instagram/i, name: 'Instagram' },
    { match: /Twitter/i, name: 'Twitter / X' },
    { match: /Snapchat/i, name: 'Snapchat' },
    { match: /LinkedInApp/i, name: 'LinkedIn' },
    { match: /Line\//i, name: 'LINE' },
    { match: /MicroMessenger/i, name: 'WeChat' },
    { match: /BytedanceWebview|TikTok|aweme|musical_ly/i, name: 'TikTok' },
  ];
  for (const s of sources) {
    if (s.match.test(ua)) {
      return { isInApp: true, source: s.name, isIOS, isAndroid };
    }
  }

  // Generic webview-detektálás iOS-en: ha nincs Safari/CriOS string, de van iPhone és AppleWebKit
  if (isIOS && /AppleWebKit/i.test(ua) && !/Safari|CriOS|FxiOS|EdgiOS/i.test(ua)) {
    return { isInApp: true, source: 'in-app WebView', isIOS, isAndroid };
  }
  // Android: wv-marker
  if (isAndroid && /\bwv\b/.test(lower)) {
    return { isInApp: true, source: 'in-app WebView', isIOS, isAndroid };
  }

  return { isInApp: false, source: null, isIOS, isAndroid };
}

/**
 * Megmutat egy banner-t az oldal tetején, ami informálja a felhasználót
 * hogy nyissa meg az oldalt valódi böngészőben.
 */
export function maybeShowInAppBanner(): void {
  const det = detectInAppBrowser();
  if (!det.isInApp) return;

  // Ne mutassuk újra ha már bezárta
  if (sessionStorage.getItem('inapp-banner-dismissed') === '1') return;

  const url = window.location.href;

  const banner = document.createElement('div');
  banner.id = 'inapp-banner';
  banner.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:100',
    'background:linear-gradient(135deg, #f59e0b, #ef4444)',
    'color:#fff',
    'padding:12px 14px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.18)',
    'font-family:Inter, system-ui, sans-serif',
    'animation:slideDown 320ms cubic-bezier(0.22, 1, 0.36, 1)',
  ].join(';');

  const helpStep = det.isIOS
    ? 'Koppints a jobb felső <strong>···</strong> ikonra, majd válaszd: <strong>Megnyitás Safariban</strong>'
    : det.isAndroid
      ? 'Koppints a jobb felső <strong>⋮</strong> ikonra, majd válaszd: <strong>Megnyitás böngészőben</strong>'
      : 'Másold ki a fenti linket és nyisd meg valódi böngészőben (Chrome / Safari / Firefox)';

  banner.innerHTML = `
    <div style="max-width:560px;margin:0 auto;display:flex;align-items:flex-start;gap:10px">
      <div style="font-size:20px;line-height:1">⚠️</div>
      <div style="flex:1;min-width:0">
        <p style="font-size:13.5px;font-weight:600;margin:0 0 4px 0">${escapeHtml(det.source ?? 'in-app browser')} — bejelentkezés nem fog működni</p>
        <p style="font-size:11.5px;line-height:1.45;margin:0 0 6px 0;opacity:0.92">${helpStep}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="inapp-copy" style="
            background:rgba(255,255,255,0.18);color:#fff;border:none;
            border-radius:9999px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer">
            📋 Link másolása
          </button>
          <a id="inapp-open" href="${escapeAttr(url)}" target="_blank" rel="noopener" style="
            background:rgba(255,255,255,0.18);color:#fff;text-decoration:none;
            border-radius:9999px;padding:5px 10px;font-size:11.5px;font-weight:600">
            🌐 Megnyitás kívül
          </a>
        </div>
      </div>
      <button id="inapp-close" aria-label="Bezárás" style="
        background:transparent;color:#fff;border:none;
        font-size:18px;line-height:1;cursor:pointer;padding:0 4px;opacity:0.7">×</button>
    </div>
  `;

  // CSS keyframe injectelése egyszer
  if (!document.getElementById('inapp-banner-style')) {
    const style = document.createElement('style');
    style.id = 'inapp-banner-style';
    style.textContent = `
      @keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }
      body.has-inapp-banner { padding-top: 96px; }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(banner);
  document.body.classList.add('has-inapp-banner');

  // Handlerek
  banner.querySelector('#inapp-close')?.addEventListener('click', () => {
    banner.remove();
    document.body.classList.remove('has-inapp-banner');
    sessionStorage.setItem('inapp-banner-dismissed', '1');
  });

  banner.querySelector('#inapp-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      const btn = banner.querySelector<HTMLButtonElement>('#inapp-copy');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ Másolva';
        setTimeout(() => { if (btn) btn.textContent = orig; }, 1800);
      }
    } catch {
      // Fallback ha clipboard API nem elérhető
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
  });

  // iOS: x-safari-https:// scheme próbálkozás (csak Safari-ban működik)
  if (det.isIOS) {
    const openLink = banner.querySelector<HTMLAnchorElement>('#inapp-open');
    if (openLink) {
      openLink.addEventListener('click', (e) => {
        // Ne az alapértelmezett target=_blank menjen, hanem próbáljuk Safari-ban
        const safariUrl = url.replace(/^https:\/\//, 'x-safari-https://');
        // Ha a böngésző tudja kezelni → Safari megnyílik
        // Ha nem → marad a sima link
        window.location.href = safariUrl;
        e.preventDefault();
      });
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
