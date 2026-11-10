/* ============================================================
   Mirror Page — Lógica del Cliente + Adaptador Responsivo
   ============================================================ */
(function () {
    'use strict';

    const API        = window.location.origin;
    const IS_LOCAL   = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    const POLL_MS    = 5000;
    const ADMIN_MODE = new URLSearchParams(window.location.search).has('admin');

    if (ADMIN_MODE) {
        document.body.classList.add('admin-mode');
    }

    // ─── Elementos DOM ───
    const $main       = document.getElementById('main');
    const $frame      = document.getElementById('mirror-frame');
    const $empty      = document.getElementById('empty-state');
    const $status     = document.getElementById('status');
    const $url        = document.getElementById('current-url');
    const $timestamp  = document.getElementById('timestamp');
    const $snapInfo   = document.getElementById('snap-info');
    const $btnRefresh = document.getElementById('btn-refresh');
    const $btnAuto    = document.getElementById('btn-auto');
    const $history    = document.getElementById('sel-history');
    const $bookmark   = document.getElementById('bookmarklet-link');
    const $toasts     = document.getElementById('toast-container');
    const $vpBtns     = document.querySelectorAll('.vp-btn');

    // ─── Estado ───
    let autoRefresh    = true;
    let currentId      = null;
    let currentHtml    = null;
    let currentDiffKey = null;
    let pollTimer      = null;
    let viewportMode   = 'auto'; // 'auto' | 'mobile' | 'tablet' | 'desktop'

    // ─── Bookmarklet ───
    $bookmark.href = `javascript:void(document.head.appendChild(Object.assign(document.createElement('script'),{src:'${API}/injector.js?t='+Date.now()})))`;

    // ═══════════════════════════════════════════
    //  Fetch helpers
    // ═══════════════════════════════════════════

    async function apiGet(path) {
        const res = await fetch(`${API}${path}`);
        if (!res.ok) return null;
        return res.json();
    }

    // ═══════════════════════════════════════════
    //  Adaptador Responsivo (dentro del iframe)
    //
    //  Adapta snapshots capturados en desktop (o móvil)
    //  para que se vean fielmente según el ancho real
    //  del iframe (#mirror-frame), incluyendo los
    //  componentes React de Canvas (@instructure/ui).
    // ═══════════════════════════════════════════

    const RESPONSIVE_CSS = `
        /* ── Fallback responsivo universal para snapshots en móvil ── */
        @media (max-width: 767px) {
            html, body {
                max-width: 100% !important;
                overflow-x: hidden !important;
            }
            #wrapper, #main, #not_right_side, #content-wrapper, #content,
            .ic-Layout-wrapper, .ic-Layout-columns, .ic-app-main-content {
                max-width: 100% !important;
                min-width: 0 !important;
                box-sizing: border-box !important;
            }
            #mobile-header {
                max-width: 100% !important;
                box-sizing: border-box !important;
            }
            .mobile-header-title {
                min-width: 0 !important;
                overflow: hidden !important;
            }
            .mobile-header-title > div {
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
            }
            .ic-Dashboard-header__layout {
                height: auto !important;
                padding: 8px 12px !important;
            }
            .ic-Dashboard-header__layout > span {
                flex-wrap: wrap !important;
                max-width: 100% !important;
                gap: 6px !important;
            }
            .ic-Dashboard-header__actions,
            .PlannerHeader-styles__root {
                max-width: 100% !important;
                flex-wrap: wrap !important;
                white-space: normal !important;
            }
            .StickyButton-styles__newActivityButton {
                max-width: 100% !important;
                right: 0 !important;
            }
            .ic-DashboardCard__box {
                justify-content: center !important;
            }
            .ic-DashboardCard {
                max-width: 100% !important;
            }
            .user_content img, .message img, #content img {
                max-width: 100% !important;
                height: auto !important;
            }
            .user_content table, table.ic-Table, table.criterion {
                display: block;
                max-width: 100% !important;
                min-width: 0 !important;
                overflow-x: auto !important;
            }
            pre, code {
                max-width: 100% !important;
                overflow-x: auto !important;
            }
            .headerBar, .headerBar__layout {
                flex-wrap: wrap !important;
                max-width: 100% !important;
                gap: 6px;
            }
            .discussion-header-content, .discussion-section, .entry-content,
            .discussion-entries .entry {
                max-width: 100% !important;
                min-width: 0 !important;
                overflow-wrap: anywhere !important;
                word-wrap: break-word !important;
            }
            .discussion-entries .entry {
                margin-left: 8px !important;
            }
            .pages .header-bar-outer-container .header-bar-container {
                min-width: 0 !important;
                width: 100% !important;
            }
            .module-sequence-footer-content {
                flex-wrap: wrap !important;
                gap: 8px !important;
            }
            #quiz_student_details {
                columns: 1 !important;
            }
        }

        /* ── Modo móvil/tablet de Canvas Planner: quitar hero image/overlay heredado de desktop ── */
        .Grouping-styles__small .Grouping-styles__hero,
        .Grouping-styles__medium .Grouping-styles__hero {
            background-image: none !important;
        }
        .Grouping-styles__small .Grouping-styles__overlay,
        .Grouping-styles__medium .Grouping-styles__overlay {
            display: none !important;
            background-color: transparent !important;
        }

        /* ── Ocultar glifo roto ::before de icon-font cuando se reemplaza con SVG ── */
        i[data-mirror-icon-fixed]::before,
        i[data-mirror-icon-fixed]::after {
            content: none !important;
            display: none !important;
        }
    `;

    const ICON_FALLBACKS = {
        'icon-hamburger': '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" style="display:block"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>',
        'icon-arrow-open-down': '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" style="display:block"><path d="M7 10l5 5 5-5H7z"/></svg>',
        'icon-more': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="display:block"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
        'icon-home': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="display:block"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
        'icon-expand': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="display:block"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>',
        'icon-collapse': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="display:block"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg>',
        'icon-mark-as-read': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="display:block"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
        'icon-paperclip': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="display:block"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6h-1.5v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6H16.5z"/></svg>',
        'icon-discussion-check': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="display:block"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
        'icon-replied': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="display:block"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
    };

    function injectMissingIcons(doc) {
        for (const [cls, svg] of Object.entries(ICON_FALLBACKS)) {
            const icons = doc.querySelectorAll(`i.${cls}`);
            icons.forEach((el) => {
                if (el.dataset.mirrorIconFixed) return;
                el.dataset.mirrorIconFixed = '1';
                el.style.fontSize = '0';
                el.style.lineHeight = '0';
                el.style.display = 'inline-flex';
                el.style.alignItems = 'center';
                el.style.justifyContent = 'center';
                el.style.verticalAlign = 'middle';
                el.insertAdjacentHTML('beforeend', svg);
            });
        }
    }

    function ensureResponsiveStyle(doc) {
        if (!doc.head) return;
        if (doc.getElementById('__mirror_responsive_css__')) return;
        const style = doc.createElement('style');
        style.id = '__mirror_responsive_css__';
        style.textContent = RESPONSIVE_CSS;
        doc.head.appendChild(style);
    }

    function syncResponsiveClasses(doc, width) {
        if (!doc || !doc.body || !width) return;

        const isSmall  = width < 600;
        const isMedium = width >= 600 && width < 900;

        // 1. Header del Dashboard (.ic-Dashboard-header__layout)
        doc.querySelectorAll('.ic-Dashboard-header__layout').forEach((el) => {
            el.classList.remove('small', 'medium', 'large');
            if (isSmall) el.classList.add('small');
            else if (width < 960) el.classList.add('medium');
            else el.classList.add('large');
        });

        // 2. Grupos de cursos en el Planner (.Grouping-styles__root)
        doc.querySelectorAll('.Grouping-styles__root').forEach((el) => {
            el.classList.remove('Grouping-styles__small', 'Grouping-styles__medium');
            if (isSmall) el.classList.add('Grouping-styles__small');
            else if (isMedium) el.classList.add('Grouping-styles__medium');
        });

        // 3. Ítems del Planner (.PlannerItem-styles__root)
        doc.querySelectorAll('.PlannerItem-styles__root').forEach((el) => {
            el.classList.remove('PlannerItem-styles__small', 'PlannerItem-styles__medium');
            if (isSmall) el.classList.add('PlannerItem-styles__small');
            else if (isMedium) el.classList.add('PlannerItem-styles__medium');
        });

        // 4. Facade de ítems completados (.CompletedItemsFacade-styles__root)
        doc.querySelectorAll('.CompletedItemsFacade-styles__root').forEach((el) => {
            el.classList.toggle('CompletedItemsFacade-styles__small', isSmall);
        });

        // 5. Días vacíos (.EmptyDays-styles__root)
        doc.querySelectorAll('.EmptyDays-styles__root').forEach((el) => {
            el.classList.toggle('EmptyDays-styles__small', isSmall);
        });

        // 6. Indicadores de notificación (.NotificationBadge-styles__activityIndicator)
        doc.querySelectorAll('.NotificationBadge-styles__activityIndicator').forEach((el) => {
            el.classList.toggle('NotificationBadge-styles__small', isSmall);
        });

        // 7. Clase touch/no-touch en body según breakpoint móvil
        if (width < 768) {
            doc.body.classList.remove('no-touch');
            doc.body.classList.add('touch');
        } else {
            doc.body.classList.remove('touch');
            doc.body.classList.add('no-touch');
        }
    }

    function adaptMirrorFrame() {
        let doc;
        try {
            doc = $frame.contentDocument;
        } catch {
            return;
        }
        if (!doc || !doc.body) return;

        const width = $frame.clientWidth || ($frame.contentWindow && $frame.contentWindow.innerWidth);
        if (!width) return;

        ensureResponsiveStyle(doc);
        injectMissingIcons(doc);
        syncResponsiveClasses(doc, width);
    }

    $frame.addEventListener('load', adaptMirrorFrame);

    if (window.ResizeObserver) {
        const frameObserver = new ResizeObserver(() => {
            adaptMirrorFrame();
        });
        frameObserver.observe($frame);
    }
    window.addEventListener('resize', adaptMirrorFrame);

    // ═══════════════════════════════════════════
    //  Selector de Viewport (Auto / Móvil / Tablet / Web)
    // ═══════════════════════════════════════════

    function setViewportMode(mode) {
        viewportMode = mode;
        $vpBtns.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.vp === mode);
        });

        $main.classList.remove('stage-preview', 'stage-mobile', 'stage-tablet', 'stage-desktop');
        if (mode !== 'auto') {
            $main.classList.add('stage-preview', `stage-${mode}`);
        }

        // Esperar un frame tras cambiar ancho del iframe para adaptar clases
        requestAnimationFrame(() => adaptMirrorFrame());
    }

    $vpBtns.forEach((btn) => {
        btn.addEventListener('click', () => setViewportMode(btn.dataset.vp));
    });

    // ═══════════════════════════════════════════
    //  Renderizado
    // ═══════════════════════════════════════════

    function getDiffKey(html) {
        if (!html) return '';
        return html
            .replace(/id="time_running_value"[^>]*>[\s\S]*?<\/span>/gi, 'id="time_running_value">TIMER</span>')
            .replace(/id="quiz_time_running"[^>]*>[\s\S]*?<\/div>/gi, 'id="quiz_time_running">TIMER</div>')
            .replace(/class="[^"]*time_running[^"]*"[^>]*>[\s\S]*?<\/span>/gi, 'class="time_running">TIMER</span>')
            .replace(/class="[^"]*quiz_timer[^"]*"[^>]*>[\s\S]*?<\/span>/gi, 'class="quiz_timer">TIMER</span>');
    }

    function renderSnapshot(snap) {
        if (!snap || !snap.html) return;
        currentId = snap.id;

        $empty.style.display = 'none';
        $frame.style.display = 'block';

        // Solo recargar el iframe si hay diferencias reales (ignorando el reloj de cuenta regresiva)
        const snapDiffKey = getDiffKey(snap.html);
        const hasDiff = currentDiffKey !== snapDiffKey || !currentHtml;
        if (hasDiff) {
            currentHtml = snap.html;
            currentDiffKey = snapDiffKey;
            $frame.srcdoc = snap.html;
        }

        const cleanTitle = (snap.title || '').trim();
        document.title = cleanTitle || 'Aula Virtual';

        $url.textContent = snap.url || '—';
        $url.title       = snap.url || '';

        const date = snap.created_at ? new Date(snap.created_at) : new Date();
        $timestamp.textContent = date.toLocaleTimeString('es-EC');
        $timestamp.title       = date.toLocaleString('es-EC');

        $snapInfo.textContent = `#${snap.id} · ${snap.size_kb || '?'} KB`;

        setStatus('online', 'Conectado');
        if (hasDiff) {
            toast(`📸 Snapshot #${snap.id} cargado`, 'success');
        }
    }

    // ═══════════════════════════════════════════
    //  Polling
    // ═══════════════════════════════════════════

    async function checkForUpdates() {
        if (document.hidden) return;
        try {
            const meta = await apiGet('/api/snapshot/latest/meta');
            if (!meta) {
                setStatus('offline', 'Sin datos');
                return;
            }

            setStatus('online', 'Conectado');

            if (meta.id !== currentId) {
                const snap = await apiGet('/api/snapshot/latest');
                if (snap) {
                    renderSnapshot(snap);
                    if (ADMIN_MODE) refreshHistory();
                }
            }
        } catch (err) {
            setStatus('error', 'Error');
        }
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(checkForUpdates, POLL_MS);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && autoRefresh) {
            checkForUpdates();
        }
    });

    // ═══════════════════════════════════════════
    //  Historial
    // ═══════════════════════════════════════════

    async function refreshHistory() {
        const list = await apiGet('/api/snapshots');
        if (!list) return;

        $history.innerHTML = `<option value="">📜 Historial (${list.length})</option>`;

        for (const s of list) {
            const opt   = document.createElement('option');
            opt.value   = s.id;
            const t     = new Date(s.created_at).toLocaleTimeString('es-EC');
            const label = (s.title || '').substring(0, 40) || s.url || '—';
            opt.textContent = `#${s.id}  ${t}  ${label}`;
            if (s.id === currentId) opt.selected = true;
            $history.appendChild(opt);
        }
    }

    // ═══════════════════════════════════════════
    //  UI helpers
    // ═══════════════════════════════════════════

    function setStatus(type, text) {
        $status.className = `badge ${type}`;
        $status.textContent = text;
    }

    function toast(msg, type = 'info') {
        if (!ADMIN_MODE) return;
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = msg;
        $toasts.appendChild(el);
        setTimeout(() => { el.classList.add('fade-out'); }, 1800);
        setTimeout(() => { el.remove(); }, 2200);
    }

    // ═══════════════════════════════════════════
    //  Event listeners
    // ═══════════════════════════════════════════

    $btnRefresh.addEventListener('click', async () => {
        const snap = await apiGet('/api/snapshot/latest');
        if (snap) renderSnapshot(snap);
        else toast('No hay snapshots aún', 'info');
    });

    $btnAuto.addEventListener('click', () => {
        autoRefresh = !autoRefresh;
        $btnAuto.classList.toggle('active', autoRefresh);
        $btnAuto.title = autoRefresh ? 'Auto-refresh activado' : 'Auto-refresh desactivado';
        if (autoRefresh) startPolling();
        else stopPolling();
        toast(autoRefresh ? '⚡ Auto-refresh ON' : '⏸ Auto-refresh OFF');
    });

    $history.addEventListener('change', async (e) => {
        const id = e.target.value;
        if (!id) return;

        autoRefresh = false;
        $btnAuto.classList.remove('active');
        stopPolling();

        const snap = await apiGet(`/api/snapshot/${id}`);
        if (snap) renderSnapshot(snap);
    });

    // ═══════════════════════════════════════════
    //  Inicialización
    // ═══════════════════════════════════════════

    checkForUpdates();
    if (ADMIN_MODE) refreshHistory();
    startPolling();

})();
