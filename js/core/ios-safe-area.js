(function () {
    'use strict';

    const root = document.documentElement;
    const userAgent = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(userAgent)
        || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
    const standaloneQuery = window.matchMedia
        ? window.matchMedia('(display-mode: standalone)')
        : null;

    function syncDisplayMode() {
        const isStandalone = Boolean(navigator.standalone)
            || Boolean(standaloneQuery && standaloneQuery.matches);
        root.classList.toggle('is-ios', isIOS);
        root.classList.toggle('is-standalone', isStandalone);
        root.classList.toggle('is-ios-pwa', isIOS && isStandalone);
    }

    function syncVisualViewport() {
        const viewport = window.visualViewport;
        const height = viewport ? viewport.height : window.innerHeight;
        const offsetTop = viewport ? viewport.offsetTop : 0;
        if (Number.isFinite(height) && height > 0) {
            root.style.setProperty('--ovo-visual-viewport-height', `${height}px`);
        }
        if (Number.isFinite(offsetTop)) {
            root.style.setProperty('--ovo-visual-viewport-offset-top', `${offsetTop}px`);
        }
    }

    syncDisplayMode();
    syncVisualViewport();

    if (standaloneQuery) {
        if (typeof standaloneQuery.addEventListener === 'function') {
            standaloneQuery.addEventListener('change', syncDisplayMode);
        } else if (typeof standaloneQuery.addListener === 'function') {
            standaloneQuery.addListener(syncDisplayMode);
        }
    }

    window.addEventListener('pageshow', function () {
        syncDisplayMode();
        syncVisualViewport();
    });
    window.addEventListener('resize', syncVisualViewport, { passive: true });
    window.addEventListener('orientationchange', syncVisualViewport, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncVisualViewport, { passive: true });
        window.visualViewport.addEventListener('scroll', syncVisualViewport, { passive: true });
    }
})();
