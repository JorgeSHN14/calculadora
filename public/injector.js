/**
 * ════════════════════════════════════════════════════════════════
 *  🪞 Mirror Injector v3 — Modo 100% Pasivo
 * ════════════════════════════════════════════════════════════════
 *
 *  SOLO LEE lo que ya está en memoria del navegador.
 *
 *  ✅ CERO requests al servidor original
 *  ✅ CERO modificaciones al DOM de la página
 *  ✅ CERO monkey-patching de APIs globales
 *  ✅ CERO eventos generados o disparados
 *
 *  Flujo: Lee DOM + CSS (en su orden exacto + @media) + imágenes
 *         renderizadas desde memoria → POST a localhost:3700
 *
 * ════════════════════════════════════════════════════════════════
 */
(function () {
    'use strict';

    if (window.__MIRROR__) return;
    window.__MIRROR__ = true;

    // ═══════════ CONFIG ═══════════

    var SERVER       = 'http://localhost:3700';
    var DEBOUNCE_MS  = 2000;
    var COOLDOWN_MS  = 5000;
    var URL_POLL_MS  = 5000;
    var INTERVAL_MS  = 5000;

    // ═══════════ REFS PRIVADAS ═══════════

    var _fetch        = window.fetch.bind(window);
    var _setTimeout   = window.setTimeout.bind(window);
    var _clearTimeout = window.clearTimeout.bind(window);
    var _setInterval  = window.setInterval.bind(window);
    var _Date         = Date;
    var _JSON         = JSON;
    var _perf         = performance;

    // ═══════════ ESTADO ═══════════

    var _timer        = null;
    var _busy         = false;
    var _lastSend     = 0;
    var _lastUrl      = location.href;
    var _lastSentKey  = null;
    var _lastSentUrl  = null;
    var _snapCount    = 0;

    function log() {
        var args = ['%c[Mirror]', 'color:#00bcd4;font-weight:bold'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    // ═══════════════════════════════════════════
    //  LECTURA PASIVA: CSS desde memoria
    // ═══════════════════════════════════════════

    function readSheetRules(sheet) {
        var css = '';
        try {
            var rules = sheet.cssRules || sheet.rules;
            if (!rules) return css;
            for (var i = 0; i < rules.length; i++) {
                if (rules[i].styleSheet) {
                    var importedCss = readSheetRules(rules[i].styleSheet);
                    if (importedCss) {
                        var impMedia = rules[i].media && rules[i].media.mediaText;
                        if (impMedia && impMedia !== 'all') {
                            css += '@media ' + impMedia + ' {\n' + importedCss + '\n}\n';
                        } else {
                            css += importedCss;
                        }
                    } else {
                        css += rules[i].cssText + '\n';
                    }
                } else {
                    css += rules[i].cssText + '\n';
                }
            }
        } catch (e) { /* CORS */ }
        return css;
    }

    function resolveUrlsInCss(css, baseUrl) {
        if (!baseUrl) return css;
        return css.replace(
            /url\(\s*(['"]?)(?!data:|blob:|#|about:)(.*?)\1\s*\)/gi,
            function (match, quote, rawUrl) {
                var trimmed = rawUrl.trim();
                if (!trimmed) return match;
                try {
                    var abs = new URL(trimmed, baseUrl).href;
                    return 'url(' + quote + abs + quote + ')';
                } catch (e) {
                    return match;
                }
            }
        );
    }

    /**
     * Captura stylesheets IN-PLACE sobre el clon, leyendo de memoria
     * sin hacer requests ni alterar el orden de cascada ni los @media.
     * DEBE llamarse antes de eliminar <script> o mutar el clon.
     */
    function inlineStylesInPlace(clone) {
        var liveNodes  = document.querySelectorAll('style, link[rel~="stylesheet"]');
        var cloneNodes = clone.querySelectorAll('style, link[rel~="stylesheet"]');

        for (var i = 0; i < liveNodes.length && i < cloneNodes.length; i++) {
            var liveEl  = liveNodes[i];
            var cloneEl = cloneNodes[i];

            if (liveEl.disabled) {
                if (cloneEl.parentNode) cloneEl.parentNode.removeChild(cloneEl);
                continue;
            }

            var sheet = liveEl.sheet;
            if (!sheet) continue;

            if (sheet.disabled) {
                if (cloneEl.parentNode) cloneEl.parentNode.removeChild(cloneEl);
                continue;
            }

            var css = readSheetRules(sheet);
            if (!css) continue; // CORS-blocked <link> o vacío → se conserva con href absoluto

            var base = sheet.href || document.baseURI;
            css = resolveUrlsInCss(css, base);

            // Respetar atributo media (ej: screen, print, (max-width: ...))
            var media = sheet.media && sheet.media.mediaText;
            if (media && media !== 'all') {
                css = '@media ' + media + ' {\n' + css + '\n}';
            }

            if (liveEl.tagName === 'LINK') {
                var styleEl = document.createElement('style');
                styleEl.setAttribute('data-mirror-from', sheet.href || '');
                styleEl.textContent = css;
                if (cloneEl.parentNode) cloneEl.parentNode.replaceChild(styleEl, cloneEl);
            } else {
                // <style> (incluye Emotion CSS-in-JS cuyo textContent está vacío en DOM)
                cloneEl.textContent = css;
            }
        }

        // Constructable stylesheets (document.adoptedStyleSheets), solo memoria
        try {
            if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0) {
                var head = clone.querySelector('head');
                if (head) {
                    for (var a = 0; a < document.adoptedStyleSheets.length; a++) {
                        var aCss = readSheetRules(document.adoptedStyleSheets[a]);
                        if (aCss) {
                            var aStyle = document.createElement('style');
                            aStyle.setAttribute('data-mirror', 'adopted-' + a);
                            aStyle.textContent = resolveUrlsInCss(aCss, document.baseURI);
                            head.appendChild(aStyle);
                        }
                    }
                }
            }
        } catch (e) {}
    }

    // ═══════════════════════════════════════════
    //  LECTURA PASIVA: CSS Variables de :root
    // ═══════════════════════════════════════════

    function readCssVariables() {
        var css = '';
        try {
            var rootStyle = getComputedStyle(document.documentElement);
            var vars = [];

            for (var j = 0; j < rootStyle.length; j++) {
                var prop = rootStyle[j];
                if (prop.indexOf('--') === 0) {
                    vars.push('  ' + prop + ': ' + rootStyle.getPropertyValue(prop).trim() + ';');
                }
            }

            if (vars.length > 0) {
                css = ':root {\n' + vars.join('\n') + '\n}\n';
            }
        } catch (e) {}
        return css;
    }

    // ═══════════════════════════════════════════
    //  LECTURA PASIVA: Imágenes ya renderizadas
    // ═══════════════════════════════════════════

    function readRenderedImages() {
        var map = {};
        var imgs = document.querySelectorAll('img');

        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            var src = img.src;

            if (!src || src.indexOf('data:') === 0 || src.indexOf('blob:') === 0) continue;
            if (map[src]) continue;
            if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) continue;

            try {
                var c   = document.createElement('canvas');
                c.width  = img.naturalWidth;
                c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                map[src] = c.toDataURL();
            } catch (e) {
                // Canvas tainted → skip
            }
        }

        return map;
    }

    // ═══════════════════════════════════════════
    //  LECTURA PASIVA: Canvas elements
    // ═══════════════════════════════════════════

    function captureCanvasElements(clone) {
        var liveCanvases  = document.querySelectorAll('canvas');
        var cloneCanvases = clone.querySelectorAll('canvas');

        for (var i = 0; i < liveCanvases.length && i < cloneCanvases.length; i++) {
            try {
                var dataUrl = liveCanvases[i].toDataURL();
                var img = document.createElement('img');
                img.setAttribute('src', dataUrl);
                img.setAttribute('width', liveCanvases[i].width);
                img.setAttribute('height', liveCanvases[i].height);
                img.setAttribute('style', cloneCanvases[i].getAttribute('style') || '');
                cloneCanvases[i].parentNode.replaceChild(img, cloneCanvases[i]);
            } catch (e) { /* tainted */ }
        }
    }

    // ═══════════════════════════════════════════
    //  LECTURA PASIVA: Estado de formularios
    // ═══════════════════════════════════════════

    function copyFormState(clone) {
        try {
            var liveInputs  = document.querySelectorAll('input');
            var cloneInputs = clone.querySelectorAll('input');
            for (var i = 0; i < liveInputs.length && i < cloneInputs.length; i++) {
                var li = liveInputs[i];
                var ci = cloneInputs[i];
                if (!li || !ci) continue;
                if (li.type === 'checkbox' || li.type === 'radio') {
                    if (li.checked) {
                        ci.setAttribute('checked', '');
                        ci.checked = true;
                    } else {
                        ci.removeAttribute('checked');
                        ci.checked = false;
                    }
                } else if (li.type !== 'file' && li.type !== 'password') {
                    ci.setAttribute('value', li.value || '');
                }
            }
        } catch (e) {}

        try {
            var liveTa  = document.querySelectorAll('textarea');
            var cloneTa = clone.querySelectorAll('textarea');
            for (var j = 0; j < liveTa.length && j < cloneTa.length; j++) {
                if (liveTa[j] && cloneTa[j]) {
                    cloneTa[j].textContent = liveTa[j].value || '';
                }
            }
        } catch (e) {}

        try {
            var liveSel  = document.querySelectorAll('select');
            var cloneSel = clone.querySelectorAll('select');
            for (var k = 0; k < liveSel.length && k < cloneSel.length; k++) {
                if (!liveSel[k] || !cloneSel[k]) continue;
                var opts = cloneSel[k].options;
                var liveOpts = liveSel[k].options;
                if (!opts || !liveOpts) continue;
                for (var o = 0; o < opts.length && o < liveOpts.length; o++) {
                    if (!opts[o] || !liveOpts[o]) continue;
                    if (liveOpts[o].selected) opts[o].setAttribute('selected', '');
                    else opts[o].removeAttribute('selected');
                }
            }
        } catch (e) {}
    }

    function inlineIframes(clone) {
        try {
            var liveIframes  = document.querySelectorAll('iframe');
            var cloneIframes = clone.querySelectorAll('iframe');
            for (var f = 0; f < liveIframes.length && f < cloneIframes.length; f++) {
                try {
                    var iframeDoc = liveIframes[f].contentDocument;
                    if (iframeDoc && iframeDoc.documentElement) {
                        var iframeHtml = iframeDoc.documentElement.outerHTML;
                        if (iframeHtml && iframeHtml.length > 50) {
                            cloneIframes[f].removeAttribute('src');
                            cloneIframes[f].setAttribute('srcdoc', '<!DOCTYPE html>\n' + iframeHtml);
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    // ═══════════════════════════════════════════
    //  RESOLUCIÓN DE URLs (puro string, sin red)
    // ═══════════════════════════════════════════

    function makeAbsolute(el, attr) {
        var val = el.getAttribute(attr);
        if (!val) return;
        if (val.indexOf('data:') === 0 || val.indexOf('blob:') === 0 ||
            val.indexOf('http:') === 0 || val.indexOf('https:') === 0 ||
            val.indexOf('//') === 0 || val.indexOf('#') === 0 ||
            val.indexOf('javascript:') === 0) return;
        try {
            el.setAttribute(attr, new URL(val, document.baseURI).href);
        } catch (e) {}
    }

    function resolveAllUrls(clone) {
        var links = clone.querySelectorAll('link[href]');
        for (var i = 0; i < links.length; i++) makeAbsolute(links[i], 'href');

        var anchors = clone.querySelectorAll('a[href]');
        for (var j = 0; j < anchors.length; j++) makeAbsolute(anchors[j], 'href');

        var imgs = clone.querySelectorAll('img[src]');
        for (var k = 0; k < imgs.length; k++) makeAbsolute(imgs[k], 'src');

        var sources = clone.querySelectorAll('source[src], source[srcset]');
        for (var s = 0; s < sources.length; s++) {
            makeAbsolute(sources[s], 'src');
            makeAbsolute(sources[s], 'srcset');
        }

        var media = clone.querySelectorAll('video[poster], video[src], audio[src]');
        for (var m = 0; m < media.length; m++) {
            makeAbsolute(media[m], 'poster');
            makeAbsolute(media[m], 'src');
        }

        var uses = clone.querySelectorAll('use[href]');
        for (var u = 0; u < uses.length; u++) makeAbsolute(uses[u], 'href');

        var forms = clone.querySelectorAll('form[action]');
        for (var f = 0; f < forms.length; f++) makeAbsolute(forms[f], 'action');
    }

    // ═══════════════════════════════════════════
    //  CONSTRUCCIÓN DEL SNAPSHOT
    // ═══════════════════════════════════════════

    function buildSnapshot() {
        var t0 = _perf.now();

        // ── 1. Leer CSS Variables e imágenes renderizadas (pura memoria) ──
        var cssVars = readCssVariables();
        var images  = readRenderedImages();

        // ── 2. Clonar documento (pura memoria) ──
        var clone = document.documentElement.cloneNode(true);

        // ── 3. Inlinear estilos EN SU POSICIÓN EXACTA antes de mutar el clon ──
        inlineStylesInPlace(clone);

        // ── 4. Copiar estado de formularios ──
        copyFormState(clone);

        // ── 4.1. Inlinear iframes (lecciones, quizzes, SCORM) ──
        inlineIframes(clone);

        // ── 5. Capturar canvas como imágenes estáticas ──
        captureCanvasElements(clone);

        // ── 6. Eliminar scripts y event handlers del clon ──
        var scripts = clone.querySelectorAll('script, noscript');
        for (var s = 0; s < scripts.length; s++) {
            scripts[s].parentNode.removeChild(scripts[s]);
        }

        var allEls = clone.querySelectorAll('*');
        for (var e = 0; e < allEls.length; e++) {
            var attrs = allEls[e].attributes;
            for (var a = attrs.length - 1; a >= 0; a--) {
                if (attrs[a].name.indexOf('on') === 0) {
                    allEls[e].removeAttribute(attrs[a].name);
                }
            }
        }

        // ── 7. Resolver URLs relativas a absolutas ──
        resolveAllUrls(clone);

        // ── 8. Inyectar CSS Variables calculadas en :root si existen ──
        var cloneHead = clone.querySelector('head');
        if (cloneHead && cssVars) {
            var varsStyle = document.createElement('style');
            varsStyle.setAttribute('data-mirror', 'css-variables');
            varsStyle.textContent = cssVars;
            cloneHead.appendChild(varsStyle);
        }

        // ── 9. Reemplazar src de imágenes con data URLs ──
        var cloneImgs = clone.querySelectorAll('img[src]');
        for (var ci = 0; ci < cloneImgs.length; ci++) {
            var cimg   = cloneImgs[ci];
            var imgSrc = cimg.getAttribute('src');
            if (!imgSrc || imgSrc.indexOf('data:') === 0) continue;

            if (images[imgSrc]) {
                cimg.setAttribute('src', images[imgSrc]);
            }

            if (cimg.hasAttribute('srcset')) cimg.removeAttribute('srcset');
            if (cimg.hasAttribute('loading')) cimg.removeAttribute('loading');
        }

        // ── 10. Asegurar meta viewport en el clon ──
        if (cloneHead) {
            var vp = cloneHead.querySelector('meta[name="viewport"]');
            if (!vp) {
                vp = document.createElement('meta');
                vp.setAttribute('name', 'viewport');
                vp.setAttribute('content', 'width=device-width, initial-scale=1');
                cloneHead.insertBefore(vp, cloneHead.firstChild);
            }
        }

        // ── 11. Agregar <base> tag ──
        var base = clone.querySelector('base');
        if (!base) {
            base = document.createElement('base');
            if (cloneHead) cloneHead.insertBefore(base, cloneHead.firstChild);
        }
        base.setAttribute('href', document.baseURI);
        base.setAttribute('target', '_blank');

        // ── 12. Desactivar interacciones en el clon ──
        var disableStyle = document.createElement('style');
        disableStyle.setAttribute('data-mirror', 'disable-interactions');
        disableStyle.textContent =
            'a[href]{pointer-events:none!important;cursor:default!important}' +
            'button{pointer-events:none!important}' +
            '[role="button"]{pointer-events:none!important}' +
            'input,select,textarea{pointer-events:auto}';
        if (cloneHead) cloneHead.appendChild(disableStyle);

        // ── 13. Serializar ──
        var doctype;
        try {
            doctype = document.doctype
                ? new XMLSerializer().serializeToString(document.doctype)
                : '<!DOCTYPE html>';
        } catch (ex) {
            doctype = '<!DOCTYPE html>';
        }

        var html = doctype + '\n' + clone.outerHTML;
        var elapsed = (_perf.now() - t0).toFixed(0);
        log('Snapshot construido: ' + Math.round(html.length / 1024) + ' KB, ' + elapsed + 'ms');

        return html;
    }

    // ═══════════════════════════════════════════
    //  NORMALIZACIÓN DE DIFFS (ignora relojes)
    // ═══════════════════════════════════════════

    function getDiffKey(html) {
        if (!html) return '';
        return html
            .replace(/id="time_running_value"[^>]*>[\s\S]*?<\/span>/gi, 'id="time_running_value">TIMER</span>')
            .replace(/id="quiz_time_running"[^>]*>[\s\S]*?<\/div>/gi, 'id="quiz_time_running">TIMER</div>')
            .replace(/class="[^"]*time_running[^"]*"[^>]*>[\s\S]*?<\/span>/gi, 'class="time_running">TIMER</span>')
            .replace(/class="[^"]*quiz_timer[^"]*"[^>]*>[\s\S]*?<\/span>/gi, 'class="quiz_timer">TIMER</span>');
    }

    // ═══════════════════════════════════════════
    //  ENVÍO AL SERVIDOR LOCAL
    // ═══════════════════════════════════════════

    function sendSnapshot(force) {
        if (_busy) return;
        var now = _Date.now();
        var sinceLast = now - _lastSend;
        if (!force && sinceLast < COOLDOWN_MS) {
            if (_timer === null) {
                _timer = _setTimeout(function () {
                    _timer = null;
                    sendSnapshot(false);
                }, COOLDOWN_MS - sinceLast + 50);
            }
            return;
        }

        _busy = true;
        var id = ++_snapCount;

        try {
            var html = buildSnapshot();
            var currentUrl = location.href;

            var currentKey = getDiffKey(html);
            if (!force && _lastSentKey !== null && currentKey === _lastSentKey && currentUrl === _lastSentUrl) {
                _busy = false;
                log('⏱️ Verificación (5s): Sin diferencias con el snapshot previo');
                return;
            }

            _fetch(SERVER + '/api/snapshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: _JSON.stringify({
                    url:            currentUrl,
                    title:          document.title,
                    html:           html,
                    viewportWidth:  innerWidth,
                    viewportHeight: innerHeight,
                }),
            })
            .then(function (resp) {
                _lastSend = _Date.now();
                if (resp.ok) {
                    _lastSentKey = currentKey;
                    _lastSentUrl = currentUrl;
                    resp.json().then(function (data) {
                        log('✅ #' + id + ' enviado (' + data.sizeKb + ' KB) [' + (force ? 'FORZADO/Navegación' : 'Diferencias') + ']');
                    });
                } else {
                    log('⚠️ #' + id + ' HTTP ' + resp.status);
                }
            })
            .catch(function (err) {
                log('❌ #' + id + ':', err.message || err);
            })
            .finally(function () {
                _busy = false;
            });

        } catch (err) {
            log('❌ #' + id + ':', err.message || err);
            _busy = false;
        }
    }

    // ═══════════════════════════════════════════
    //  DETECCIÓN DE CAMBIOS (100% pasiva)
    // ═══════════════════════════════════════════

    function scheduleCapture() {
        if (_timer === null) {
            _timer = _setTimeout(function () {
                _timer = null;
                sendSnapshot(false);
            }, DEBOUNCE_MS);
        }
    }

    var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if ((m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) ||
                m.type === 'attributes') {
                scheduleCapture();
                return;
            }
        }
    });

    var target = document.body || document.documentElement;
    observer.observe(target, {
        childList:       true,
        subtree:         true,
        attributes:      true,
        attributeFilter: ['class', 'style', 'src', 'href', 'hidden'],
    });

    // Detección rápida de cambios en radios/inputs en quizzes
    document.addEventListener('change', function (e) {
        if (e && e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
            scheduleCapture();
        }
    }, true);

    // Detección ágil de navegación SPA (cada 1s)
    _setInterval(function () {
        if (location.href !== _lastUrl) {
            _lastUrl = location.href;
            log('🔗 Navegación detectada:', _lastUrl);
            sendSnapshot(true);
        }
    }, 1000);

    // Ejecución periódica automática cada 5 segundos
    _setInterval(function () {
        if (!_busy) sendSnapshot(false);
    }, INTERVAL_MS);

    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        sendSnapshot(true);
    } else {
        window.addEventListener('DOMContentLoaded', function () { sendSnapshot(true); });
        window.addEventListener('load', function () { sendSnapshot(true); });
    }

    log('─────────────────────────────────────');
    log('🪞 Mirror v3 ACTIVO (modo pasivo)');
    log('   Envía a:', SERVER);
    log('─────────────────────────────────────');

})();
