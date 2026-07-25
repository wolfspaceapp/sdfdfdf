// ── Utility functions (must be defined first, before any code that uses them) ──
const $ = id => document.getElementById(id);
const qs = (sel, ctx) => (ctx || document).querySelector(sel);
const qsa = (sel, ctx) => (ctx || document).querySelectorAll(sel);

(function () {
    'use strict';

    const DATA = window.DATA || [];
    const CFG = window.CONFIG || {};

    // ══════════════════════════════════════════════════════════
    // SISTEMA DE PERFIL ANÓNIMO CON FIREBASE
    // ══════════════════════════════════════════════════════════

    // Configuración de Firebase - se carga desde el widget "Wolf Firebase" en Blogger
    var FIREBASE_CONFIG = (window.CONFIG && window.CONFIG.firebase) ? window.CONFIG.firebase : {
        apiKey: "AIzaSyC6X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8",
        authDomain: "wolfanime-anon.firebaseapp.com",
        projectId: "wolfanime-anon",
        storageBucket: "wolfanime-anon.appspot.com",
        messagingSenderId: "000000000000",
        appId: "1:000000000000:web:0000000000000000000000"
    };

    // ── Helper to get icon for genre ──
    function getLucideIcon(genre) {
        if (!genre) return '';
        var key = genre.toLowerCase().trim();
        return LUCIDE_ICONS[key] || LUCIDE_ICONS['action'] || '';
    }

    // ── Expose functions globally ──
    window.getLucideIcon = getLucideIcon;

    // ── Punto de entrada principal (se ejecuta al final del archivo) ──
    function init() {
        refreshAllUI();
        startRealtimeListener();
    }

    // ── Auto-sync cada 5 minutos ──
    setInterval(queueAutoSync, 300000);

    // ── Refresh all UI sections ──
    function refreshAllUI() {
        renderHero();
        renderFeaturedSlider();
        renderPopularSlider();
        renderHome();
        renderHomeFavs();
        renderContinueWatching();
        var searchInput = $('home-search-input');
        if (searchInput && searchInput.value) {
            renderSearch(searchInput.value);
        }
        updateAnonProfileUI();
    }

    // Exportar funciones globalmente
    window.refreshAllUI = refreshAllUI;
    window.renderSearch = renderSearch;
    window.renderHome = renderHome;
    window.renderHero = renderHero;
    window.renderFeaturedSlider = renderFeaturedSlider;
    window.renderPopularSlider = renderPopularSlider;
    window.renderHomeFavs = renderHomeFavs;
    window.renderContinueWatching = renderContinueWatching;
    window.openAnonProfileModal = openAnonProfileModal;
    window.anonCreateProfile = anonCreateProfile;
    window.anonLogin = anonLogin;
    window.anonRecoverCode = anonRecoverCode;
    window.anonLogout = anonLogout;
    window.anonSyncData = anonSyncData;
    window.toggleHCat = toggleHCat;

    var ANON_DB = null; // Firestore instance
    var anonProfile = null; // { username, code, favAnime, createdAt }
    var ANON_PROFILE_KEY = 'wolfanime_anon_profile';

    // Cargar perfil guardado
    (function loadSavedAnonProfile() {
        try {
            var saved = localStorage.getItem(ANON_PROFILE_KEY);
            if (saved) {
                anonProfile = JSON.parse(saved);
            }
        } catch (e) { }
    })();

    function initFirebase() {
        if (ANON_DB) return true;
        if (typeof firebase === 'undefined' || !firebase.initializeApp) {
            console.warn('[AnonProfile] Firebase SDK no disponible');
            return false;
        }
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            ANON_DB = firebase.firestore();
            // Usar cache persistente para mejor rendimiento offline
            ANON_DB.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
            console.log('[AnonProfile] Firebase inicializado');
            return true;
        } catch (e) {
            console.warn('[AnonProfile] Error inicializando Firebase:', e);
            return false;
        }
    }

    function generateProfileCode() {
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var code = '';
        for (var i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    function saveAnonProfile(profile) {
        anonProfile = profile;
        try {
            localStorage.setItem(ANON_PROFILE_KEY, JSON.stringify(profile));
        } catch (e) { }
        updateAnonProfileUI();
    }

    function clearAnonProfile() {
        anonProfile = null;
        try {
            localStorage.removeItem(ANON_PROFILE_KEY);
        } catch (e) { }
        updateAnonProfileUI();
    }

    function updateAnonProfileUI() {
        var statusEl = document.getElementById('anon-profile-status');
        var codeEl = document.getElementById('anon-profile-code');
        var loginBtn = document.getElementById('anon-login-btn');
        var logoutBtn = document.getElementById('anon-logout-btn');
        var syncBtn = document.getElementById('anon-sync-btn');
        var createBtn = document.getElementById('anon-create-btn');

        if (anonProfile) {
            if (statusEl) statusEl.textContent = anonProfile.username || 'Usuario';
            if (codeEl) codeEl.textContent = anonProfile.code || '';
            if (loginBtn) loginBtn.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'inline-flex';
            if (syncBtn) syncBtn.style.display = 'inline-flex';
            if (createBtn) createBtn.style.display = 'none';
        } else {
            if (statusEl) statusEl.textContent = 'No has iniciado sesión';
            if (codeEl) codeEl.textContent = '---';
            if (loginBtn) loginBtn.style.display = 'inline-flex';
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (syncBtn) syncBtn.style.display = 'none';
            if (createBtn) createBtn.style.display = 'inline-flex';
        }
    }

    function showAnonProfileError(msg) {
        var errEl = document.getElementById('anon-profile-error');
        var loginErrEl = document.getElementById('anon-login-error');
        var recoverErrEl = document.getElementById('anon-recover-error');
        if (errEl) errEl.textContent = msg;
        if (loginErrEl) loginErrEl.textContent = msg;
        if (recoverErrEl) recoverErrEl.textContent = msg;
    }

    function showAnonProfileView(view) {
        var views = ['anon-create-view', 'anon-login-view', 'anon-profile-view', 'anon-recover-view'];
        views.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        var target = document.getElementById(view);
        if (target) target.style.display = 'block';
        // Limpiar errores al cambiar de vista
        showAnonProfileError('');
        // Limpiar resultado de recuperación
        var recoverResult = document.getElementById('anon-recover-result');
        if (recoverResult) recoverResult.style.display = 'none';
    }

    function openAnonProfileModal() {
        var modal = document.getElementById('anon-profile-modal');
        if (!modal) return;
        modal.classList.add('open');
        if (anonProfile) {
            showAnonProfileView('anon-profile-view');
            updateAnonProfileUI();
        } else {
            showAnonProfileView('anon-create-view');
        }
    }

    async function anonCreateProfile() {
        var userInput = document.getElementById('anon-create-user');
        var favInput = document.getElementById('anon-create-fav');
        var username = (userInput.value || '').trim();
        var favAnime = (favInput.value || '').trim();

        if (!username || !favAnime) {
            showAnonProfileError('Por favor completa todos los campos.');
            return;
        }
        if (username.length < 3) {
            showAnonProfileError('El nombre de usuario debe tener al menos 3 caracteres.');
            return;
        }

        if (!initFirebase()) {
            showAnonProfileError('Firebase no está disponible. Intenta más tarde.');
            return;
        }

        try {
            // Verificar si el nombre de usuario ya existe
            var existing = await ANON_DB.collection('profiles').doc(username).get();
            if (existing.exists) {
                showAnonProfileError('Este nombre de usuario ya está registrado. Intenta con otro.');
                return;
            }

            var code = generateProfileCode();
            var profile = {
                username: username,
                code: code,
                favAnime: favAnime,
                createdAt: new Date().toISOString()
            };

            await ANON_DB.collection('profiles').doc(username).set(profile);
            saveAnonProfile(profile);
            showAnonProfileView('anon-profile-view');
            showAnonProfileError('');
        } catch (e) {
            console.error('[AnonProfile] Error creando perfil:', e);
            showAnonProfileError('Error al crear perfil. Verifica tu conexión.');
        }
    }

    async function anonLogin() {
        var codeInput = document.getElementById('anon-login-code');
        var code = (codeInput.value || '').trim().toUpperCase();

        if (!code) {
            showAnonProfileError('Ingresa tu código de acceso.');
            return;
        }

        if (!initFirebase()) {
            showAnonProfileError('Firebase no está disponible. Intenta más tarde.');
            return;
        }

        try {
            var snapshot = await ANON_DB.collection('profiles').where('code', '==', code).get();
            if (snapshot.empty) {
                showAnonProfileError('Código inválido. Verifica e intenta de nuevo.');
                return;
            }

            var doc = snapshot.docs[0];
            var data = doc.data();
            saveAnonProfile({
                username: data.username,
                code: data.code,
                favAnime: data.favAnime,
                createdAt: data.createdAt
            });
            showAnonProfileView('anon-profile-view');
            showAnonProfileError('');
        } catch (e) {
            console.error('[AnonProfile] Error al iniciar sesión:', e);
            showAnonProfileError('Error al iniciar sesión. Verifica tu conexión.');
        }
    }

    async function anonRecoverCode() {
        var userInput = document.getElementById('anon-recover-user');
        var favInput = document.getElementById('anon-recover-fav');
        var username = (userInput.value || '').trim();
        var favAnime = (favInput.value || '').trim();

        if (!username || !favAnime) {
            showAnonProfileError('Por favor completa todos los campos.');
            return;
        }

        if (!initFirebase()) {
            showAnonProfileError('Firebase no está disponible. Intenta más tarde.');
            return;
        }

        try {
            var doc = await ANON_DB.collection('profiles').doc(username).get();
            if (!doc.exists) {
                showAnonProfileError('No se encontró una cuenta con ese nombre de usuario.');
                return;
            }

            var data = doc.data();
            if (data.favAnime.toLowerCase() !== favAnime.toLowerCase()) {
                showAnonProfileError('El anime favorito no coincide. Verifica e intenta de nuevo.');
                return;
            }

            // Mostrar el código recuperado
            var resultEl = document.getElementById('anon-recover-result');
            var codeSpan = document.getElementById('anon-recovered-code');
            if (resultEl && codeSpan) {
                codeSpan.textContent = data.code;
                resultEl.style.display = 'block';
            }
            showAnonProfileError('');
        } catch (e) {
            console.error('[AnonProfile] Error recuperando código:', e);
            showAnonProfileError('Error al recuperar código. Verifica tu conexión.');
        }
    }

    function anonLogout() {
        clearAnonProfile();
        showAnonProfileView('anon-create-view');
        showAnonProfileError('');
    }

    async function anonSyncData() {
        if (!anonProfile || !anonProfile.username) {
            showAnonProfileError('No hay perfil anónimo activo.');
            return;
        }
        if (!initFirebase()) {
            showAnonProfileError('Firebase no está disponible.');
            return;
        }

        try {
            var userDataRef = ANON_DB.collection('userData').doc(anonProfile.username);
            var localData = {
                favorites: JSON.parse(localStorage.getItem('wolfanime_favs') || '[]'),
                watchStatus: JSON.parse(localStorage.getItem('wolfanime_watch_status') || '{}'),
                continueWatching: JSON.parse(localStorage.getItem('wolfanime_cw') || '[]'),
                mylistCategories: JSON.parse(localStorage.getItem('wolfanime_mylist_cats') || '{}'),
                settings: {
                    theme: localStorage.getItem('wolfanime_theme') || 'dark',
                    lastSync: new Date().toISOString()
                }
            };

            await userDataRef.set(localData);
            showAnonProfileError('Datos sincronizados correctamente.');
            setTimeout(function () { showAnonProfileError(''); }, 3000);
        } catch (e) {
            console.error('[AnonProfile] Error sincronizando:', e);
            showAnonProfileError('Error al sincronizar. Verifica tu conexión.');
        }
    }

    function collectCWData() {
        try {
            return JSON.parse(localStorage.getItem('wolfanime_cw') || '[]');
        } catch (e) { return []; }
    }

    function mergeCloudData(cloudData) {
        if (!cloudData) return;
        try {
            if (cloudData.favorites && Array.isArray(cloudData.favorites)) {
                var localFavs = JSON.parse(localStorage.getItem('wolfanime_favs') || '[]');
                var merged = Array.from(new Set([...localFavs, ...cloudData.favorites]));
                localStorage.setItem('wolfanime_favs', JSON.stringify(merged));
            }
            if (cloudData.watchStatus && typeof cloudData.watchStatus === 'object') {
                var localWS = JSON.parse(localStorage.getItem('wolfanime_watch_status') || '{}');
                Object.keys(cloudData.watchStatus).forEach(function (key) {
                    if (!localWS[key]) localWS[key] = cloudData.watchStatus[key];
                });
                localStorage.setItem('wolfanime_watch_status', JSON.stringify(localWS));
            }
            if (cloudData.continueWatching && Array.isArray(cloudData.continueWatching)) {
                var localCW = JSON.parse(localStorage.getItem('wolfanime_cw') || '[]');
                var existingKeys = new Set(localCW.map(function (item) { return item.serieId + '-' + (item.metaKey || ''); }));
                cloudData.continueWatching.forEach(function (item) {
                    var key = item.serieId + '-' + (item.metaKey || '');
                    if (!existingKeys.has(key)) {
                        localCW.push(item);
                        existingKeys.add(key);
                    }
                });
                localStorage.setItem('wolfanime_cw', JSON.stringify(localCW));
            }
            if (cloudData.mylistCategories && typeof cloudData.mylistCategories === 'object') {
                var localCats = JSON.parse(localStorage.getItem('wolfanime_mylist_cats') || '{}');
                Object.keys(cloudData.mylistCategories).forEach(function (key) {
                    if (!localCats[key]) localCats[key] = cloudData.mylistCategories[key];
                });
                localStorage.setItem('wolfanime_mylist_cats', JSON.stringify(localCats));
            }
        } catch (e) {
            console.error('[AnonProfile] Error merging cloud data:', e);
        }
    }

    function queueAutoSync() {
        if (!anonProfile || !anonProfile.username) return;
        if (!initFirebase()) return;

        try {
            var userDataRef = ANON_DB.collection('userData').doc(anonProfile.username);
            var localData = {
                favorites: JSON.parse(localStorage.getItem('wolfanime_favs') || '[]'),
                watchStatus: JSON.parse(localStorage.getItem('wolfanime_watch_status') || '{}'),
                continueWatching: JSON.parse(localStorage.getItem('wolfanime_cw') || '[]'),
                mylistCategories: JSON.parse(localStorage.getItem('wolfanime_mylist_cats') || '{}'),
                settings: {
                    theme: localStorage.getItem('wolfanime_theme') || 'dark',
                    lastSync: new Date().toISOString()
                }
            };
            userDataRef.set(localData).catch(function (e) {
                console.warn('[AnonProfile] Auto-sync error:', e);
            });
        } catch (e) { }
    }

    function startRealtimeListener() {
        if (!anonProfile || !anonProfile.username) return;
        if (!initFirebase()) return;

        stopRealtimeListener();

        try {
            var userDataRef = ANON_DB.collection('userData').doc(anonProfile.username);
            window._anonListener = userDataRef.onSnapshot(function (snapshot) {
                if (snapshot.exists) {
                    mergeCloudData(snapshot.data());
                    refreshAllUI();
                }
            }, function (error) {
                console.warn('[AnonProfile] Realtime listener error:', error);
            });
        } catch (e) {
            console.warn('[AnonProfile] Error starting listener:', e);
        }
    }

    function stopRealtimeListener() {
        if (window._anonListener) {
            window._anonListener();
            window._anonListener = null;
        }
    }

    let state = {
        view: 'home',
        filterType: 'all',
        searchQuery: '',
        catLibrary: null,
        sortBy: 'addedDate',
        sortOrder: 'desc'
    };

    // ── Cache de búsqueda ──
    var searchCache = null;
    var searchCacheKey = '';

    function buildSearchCache() {
        var data = visibleDATA();
        var key = data.map(function (d) { return d.id; }).join(',');
        if (searchCache && searchCacheKey === key) return;
        searchCache = data.map(function (item) {
            var title = (item.title || item.name || '').toLowerCase();
            var alt = (item.altTitle || '').toLowerCase();
            var cats = (item.category || '').toLowerCase();
            var genre = (item.genre || '').toLowerCase();
            var tags = Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase() : (item.tags || '').toLowerCase();
            var synopsis = (item.synopsis || '').toLowerCase();
            return { item: item, searchText: title + ' ' + alt + ' ' + cats + ' ' + genre + ' ' + tags + ' ' + synopsis };
        });
        searchCacheKey = key;
    }

    function filterData(query) {
        buildSearchCache();
        if (!query) return searchCache.map(function (x) { return x.item; });
        var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        return searchCache.filter(function (entry) {
            return terms.every(function (term) { return entry.searchText.indexOf(term) !== -1; });
        }).map(function (entry) { return entry.item; });
    }

    // ── Favorites ──
    function getFavs() {
        try { return JSON.parse(localStorage.getItem('wolfanime_favs') || '[]'); } catch (e) { return []; }
    }

    function isFav(id) {
        return getFavs().indexOf(id) !== -1;
    }

    // ── Watch Status ──
    function getWatchStatus(id) {
        try {
            var all = JSON.parse(localStorage.getItem('wolfanime_watch_status') || '{}');
            return all[id] || '';
        } catch (e) { return ''; }
    }

    // ── H detection ──
    function isH(item) {
        if (!item) return false;
        const cat = (item.category || '').toUpperCase();
        const genre = (item.genre || '').toUpperCase();
        const tags = Array.isArray(item.tags) ? item.tags.map(t => t.toUpperCase()) : (item.tags || '').toUpperCase();
        if (cat === 'H' || genre === 'H' || (Array.isArray(tags) && tags.indexOf('H') !== -1) || tags === 'H') return true;
        return false;
    }

    // ── Visible data (filter H) ──
    var hCatEnabled = false;

    function toggleHCat() {
        hCatEnabled = !hCatEnabled;
        var btn = document.getElementById('h-cat-toggle');
        if (btn) btn.classList.toggle('active', hCatEnabled);
        refreshAllUI();
    }

    function visibleDATA() {
        if (hCatEnabled) return DATA;
        return DATA.filter(function (d) { return !isH(d); });
    }

    function uniqueData(arr) {
        var seen = new Set();
        return arr.filter(function (item) {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });
    }

    function formatAdded(d) {
        if (!d) return '';
        var date = new Date(d);
        if (isNaN(date.getTime())) return d;
        var now = new Date();
        var diff = (now - date) / 1000;
        if (diff < 60) return 'Ahora';
        if (diff < 3600) return Math.floor(diff / 60) + 'm';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h';
        if (diff < 2592000) return Math.floor(diff / 86400) + 'd';
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    }

    function getStatusClass(s) {
        if (!s) return '';
        var map = { 'completado': 'status-done', 'viendo': 'status-watching', 'pendiente': 'status-pending', 'pausado': 'status-paused', 'drop': 'status-dropped' };
        return map[s.toLowerCase()] || '';
    }

    function posterBg(item) {
        if (item.poster) return `url('${item.poster}') center/cover no-repeat`;
        if (item.image && (item.image.startsWith('http') || item.image.startsWith('//'))) {
            return `url('${item.image}') center/cover no-repeat`;
        }
        return item.image || 'var(--card-bg)';
    }

    function backdropBg(item) {
        const url = item.backdrop || item.poster || item.image;
        if (url && (url.startsWith('http') || url.startsWith('//'))) {
            return `url('${url}') center/cover no-repeat`;
        }
        return url || 'var(--card-bg)';
    }

    function cardHTML(item, mini = false) {
        const fav = isFav(item.id);
        const h = isH(item);
        if (mini) {
            return [
                '<div class="scard', h ? ' card-h' : '', '" onclick="openDetail(\'', item.id, '\')">',
                '<div class="scard-img" style="background:', posterBg(item), '">',
                '<div class="scard-overlay"></div>',
                fav ? '<div class="scard-fav"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></div>' : '',
                '</div>',
                '<div class="scard-info">',
                '<div class="scard-title">', item.title || item.name || '', '</div>',
                '<div class="scard-meta">',
                '<span>', item.type || 'Anime', '</span>',
                item.eps ? '<span>' + item.eps + ' ep</span>' : '',
                '</div>',
                '</div>',
                '</div>'
            ].join('');
        }

        const ws = getWatchStatus(item.id);
        const wsClass = getStatusClass(ws);
        const added = formatAdded(item.addedDate);

        return [
            '<div class="card', h ? ' card-h' : '', '" onclick="openDetail(\'', item.id, '\')">',
            '<div class="card-img" style="background:', posterBg(item), '">',
            '<div class="card-overlay"></div>',
            '<div class="card-badges">',
            added ? '<span class="card-badge card-badge-new">' + added + '</span>' : '',
            ws ? '<span class="card-badge ' + wsClass + '">' + ws + '</span>' : '',
            '</div>',
            fav ? '<div class="card-fav"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></div>' : '',
            '</div>',
            '<div class="card-info">',
            '<div class="card-title">', item.title || item.name || '', '</div>',
            '<div class="card-meta">',
            '<span>', item.type || 'Anime', '</span>',
            item.eps ? '<span>' + item.eps + ' ep</span>' : '',
            '</div>',
            '</div>',
            '</div>'
        ].join('');
    }

    function applyStaggeredAnimations(container, selector) {
        if (!container) return;
        selector = selector || '.card, .scard, .recent-card, .slider-card';
        var items = container.querySelectorAll(selector);
        items.forEach(function (el, i) {
            el.style.setProperty('--i', i);
            el.style.opacity = '0';
        });
        requestAnimationFrame(function () {
            items.forEach(function (el) {
                el.style.opacity = '';
            });
        });
    }

    function renderHome() {
        const homeGrid = $('home-grid');
        if (!homeGrid) return;
        const data = visibleDATA();
        const sorted = [...data].sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || ''));
        const items = sorted.slice(0, 24);
        homeGrid.innerHTML = items.map(function (d) { return cardHTML(d); }).join('');
        applyStaggeredAnimations(homeGrid);
    }

    // ── Hero Section ──
    function renderHero() {
        var cfg = (window.CONFIG && window.CONFIG.hero) ? window.CONFIG.hero : {};
        var data = visibleDATA();

        // Determinar item hero
        var heroItem = null;
        if (cfg.heroId) {
            heroItem = data.find(function (d) { return String(d.id) === String(cfg.heroId); });
        }
        if (!heroItem) {
            var featured = data.filter(function (d) { return d.featured; });
            heroItem = featured.length ? featured[0] : data[0];
        }

        // Rellenar elementos del hero
        var heroBg = $('hero-bg');
        var heroTitle = $('hero-title');
        var heroSub = $('hero-subtitle');
        var heroBadge = $('hero-badge');
        var heroCta1 = $('hero-cta-primary');
        var heroCta2 = $('hero-cta-secondary');
        var heroLabel1 = $('hero-cta-label');
        var heroLabel2 = $('hero-cta2-label');
        var heroFavBtn = $('hero-fav-btn');

        if (cfg.backgroundUrl && heroBg) {
            heroBg.style.backgroundImage = "url('" + cfg.backgroundUrl + "')";
            heroBg.style.backgroundSize = 'cover';
            heroBg.style.backgroundPosition = 'center';
        } else if (heroItem && heroBg) {
            var bgUrl = heroItem.backdrop || heroItem.poster || heroItem.image || '';
            if (bgUrl) { heroBg.style.backgroundImage = "url('" + bgUrl + "')"; heroBg.style.backgroundSize = 'cover'; heroBg.style.backgroundPosition = 'center'; }
        }

        if (heroBadge) heroBadge.textContent = cfg.badge || '';

        if (heroTitle) {
            heroTitle.textContent = cfg.title || (heroItem ? (heroItem.title || heroItem.name || '') : '');
        }
        if (heroSub) {
            heroSub.textContent = cfg.subtitle || (heroItem ? (heroItem.description || '') : '');
        }

        if (heroLabel1) heroLabel1.textContent = cfg.ctaLabel || 'Buscar';
        if (heroLabel2) heroLabel2.textContent = cfg.cta2Label || 'Explorar';

        if (heroCta1) {
            heroCta1.onclick = function () {
                var nav = cfg.ctaNav;
                if (nav && typeof window.navigateTo === 'function') window.navigateTo(nav);
                else if (heroItem && typeof window.openDetail === 'function') window.openDetail(heroItem.id);
            };
        }
        if (heroCta2) {
            heroCta2.onclick = function () {
                var nav = cfg.cta2Nav;
                if (nav && typeof window.navigateTo === 'function') window.navigateTo(nav);
            };
        }

        // Botón favorito del hero
        if (heroFavBtn && heroItem) {
            heroFavBtn.style.display = '';
            heroFavBtn.onclick = function () {
                var favs = [];
                try { favs = JSON.parse(localStorage.getItem('wolfanime_favs') || '[]'); } catch (e) { }
                var idx = favs.indexOf(heroItem.id);
                if (idx === -1) { favs.push(heroItem.id); } else { favs.splice(idx, 1); }
                localStorage.setItem('wolfanime_favs', JSON.stringify(favs));
                refreshAllUI();
            };
        }
    }

    // ── Featured Slider (Destacados) ──
    function renderFeaturedSlider() {
        var track = $('featured-track');
        if (!track) return;
        var data = visibleDATA();
        var featured = data.filter(function (d) { return d.featured; });
        if (!featured.length) featured = data.slice(0, 8);
        else featured = featured.slice(0, 10);
        initSlider('featured-track', 'featured-dots', featured, true, 'horizontal', true);
    }

    // ── Popular / En emisión Slider ──
    function renderPopularSlider() {
        var track = $('popular-track');
        if (!track) return;
        var data = visibleDATA();
        // Ordenar por fecha de agregado (más recientes = En emisión)
        var sorted = data.slice().sort(function (a, b) {
            return (b.addedDate || '').localeCompare(a.addedDate || '');
        });
        var popular = sorted.slice(0, 10);
        initSlider('popular-track', 'popular-dots', popular, false, 'horizontal', true);
    }

    function initSlider(trackId, dotsId, data, isAutoPlay, layout, showPagination) {
        layout = layout || 'horizontal';
        showPagination = showPagination !== undefined ? showPagination : true;
        var track = document.getElementById(trackId);
        var dotsContainer = document.getElementById(dotsId);
        if (!track) return;

        var isHorizontal = layout === 'horizontal';
        var currentIndex = 0;

        if (isHorizontal) {
            track.innerHTML = data.map(function (item, i) {
                return recentCardHTML(item, i, i);
            }).join('');
        } else {
            track.innerHTML = data.map(function (item, i) {
                return '<div class="slider-card" style="background:' + posterBg(item) + '"><div class="slider-overlay"></div><div class="slider-title">' + (item.title || '') + '</div></div>';
            }).join('');
        }

        var cards = track.children;
        if (!cards.length) return;

        function updateUI(idx) {
            currentIndex = Math.max(0, Math.min(idx, cards.length - 1));
            if (dotsContainer && showPagination) {
                var dots = dotsContainer.querySelectorAll('.dot');
                dots.forEach(function (d, i) {
                    d.classList.toggle('active', i === currentIndex);
                });
            }
            if (isHorizontal) {
                var card = cards[currentIndex];
                if (card) {
                    var offset = card.offsetLeft - track.parentElement.offsetWidth / 2 + card.offsetWidth / 2;
                    track.scrollTo({ left: offset, behavior: 'smooth' });
                }
            }
        }

        function scrollToIndex(idx) {
            updateUI(idx);
        }

        if (dotsContainer && showPagination) {
            dotsContainer.innerHTML = data.map(function (_, i) {
                return '<span class="dot' + (i === 0 ? ' active' : '') + '" data-index="' + i + '"></span>';
            }).join('');
            dotsContainer.addEventListener('click', function (e) {
                var dot = e.target.closest('.dot');
                if (dot) scrollToIndex(parseInt(dot.dataset.index));
            });
        }

        if (isHorizontal) {
            var ticking = false;
            track.addEventListener('scroll', function () {
                if (!ticking) {
                    window.requestAnimationFrame(function () {
                        var center = track.parentElement.offsetWidth / 2;
                        var bestIdx = 0;
                        var bestDist = Infinity;
                        Array.from(cards).forEach(function (c, i) {
                            var dist = Math.abs(c.offsetLeft + c.offsetWidth / 2 - track.scrollLeft - center);
                            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                        });
                        currentIndex = bestIdx;
                        if (dotsContainer && showPagination) {
                            var dots = dotsContainer.querySelectorAll('.dot');
                            dots.forEach(function (d, i) { d.classList.toggle('active', i === currentIndex); });
                        }
                        ticking = false;
                    });
                    ticking = true;
                }
            });
        }

        if (isAutoPlay) {
            var interval = setInterval(function () {
                var next = (currentIndex + 1) % cards.length;
                updateUI(next);
            }, 5000);
            track.parentElement.addEventListener('mouseenter', function () { clearInterval(interval); });
            var startAuto = function () {
                interval = setInterval(function () {
                    var next = (currentIndex + 1) % cards.length;
                    updateUI(next);
                }, 5000);
            };
            track.parentElement.addEventListener('mouseleave', startAuto);
        }

        updateUI(0);
    }

    function recentCardHTML(item, num, index) {
        var fav = isFav(item.id);
        var h = isH(item);
        var ws = getWatchStatus(item.id);
        var wsClass = getStatusClass(ws);
        var added = formatAdded(item.addedDate);
        var eps = item.eps || '?';
        var type = item.type || 'Anime';

        return [
            '<div class="recent-card', h ? ' card-h' : '', '" onclick="openDetail(\'', item.id, '\')" style="--i:', index, '">',
            '<div class="recent-card-img" style="background:', posterBg(item), '">',
            '<div class="recent-overlay"></div>',
            '<div class="recent-badges">',
            added ? '<span class="card-badge card-badge-new">' + added + '</span>' : '',
            ws ? '<span class="card-badge ' + wsClass + '">' + ws + '</span>' : '',
            '</div>',
            fav ? '<div class="recent-fav"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></div>' : '',
            '<div class="recent-ep">', eps, '</div>',
            '</div>',
            '<div class="recent-info">',
            '<div class="recent-title">', item.title || item.name || '', '</div>',
            '<div class="recent-meta">',
            '<span>', type, '</span>',
            '</div>',
            '</div>',
            '</div>'
        ].join('');
    }

    function renderHomeFavs() {
        var container = $('home-favs');
        if (!container) return;
        var favs = getFavs();
        if (favs.length === 0) {
            container.innerHTML = '<div class="empty-favs">Toca el <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> para agregar a favoritos</div>';
            return;
        }
        var data = visibleDATA().filter(function (d) { return favs.indexOf(d.id) !== -1; });
        container.innerHTML = data.map(function (d) { return cardHTML(d, true); }).join('');
        applyStaggeredAnimations(container, '.scard');
    }

    function renderContinueWatching() {
        var container = $('cw-track');
        if (!container) return;
        try {
            var cwData = JSON.parse(localStorage.getItem('wolfanime_cw') || '[]');
            if (!cwData.length) {
                container.innerHTML = '';
                var wrap = container.closest('.section');
                if (wrap) wrap.style.display = 'none';
                return;
            }
            var wrap = container.closest('.section');
            if (wrap) wrap.style.display = '';

            var dataMap = {};
            (window.DATA || []).forEach(function (d) { dataMap[d.id] = d; });

            var html = cwData.map(function (item) {
                var serie = dataMap[item.serieId];
                if (!serie) return '';
                var title = serie.title || serie.name || '';
                var ep = item.episode || 1;
                var season = item.season || 1;
                var pct = item.progress || 0;
                var img = serie.backdrop || serie.poster || serie.image || '';
                var metaKey = item.metaKey || '';

                return [
                    '<div class="cw-card" data-serie="', item.serieId, '" data-metakey="', metaKey, '" onclick="window.handleCWClick(\'', item.serieId, '\', \'', metaKey, '\')">',
                    '<div class="cw-card-bg lazy-bg" style="background-image:url(\'', img, '\')"></div>',
                    '<div class="cw-card-overlay"></div>',
                    '<div class="cw-card-content">',
                    '<div class="cw-card-title">', title, '</div>',
                    '<div class="cw-card-ep">Episodio ', ep, ' - Temporada ', season, '</div>',
                    '<div class="cw-progress-bar"><div class="cw-progress-fill" style="width:', pct, '%"></div></div>',
                    '</div>',
                    '<button class="cw-remove-btn" onclick="event.stopPropagation();window.handleCWRemove(\'', item.serieId, '\',\'', metaKey, '\',\'', title.replace(/'/g, "\\'"), '\')" title="Eliminar">',
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
                    '</button>',
                    '</div>'
                ].join('');
            }).join('');

            container.innerHTML = html;

            // Aplicar lazy-bg loaded después de renderizar
            container.querySelectorAll('.lazy-bg').forEach(function (el) {
                if (el.style.backgroundImage && el.style.backgroundImage !== 'none' && el.style.backgroundImage !== 'url("")' && el.style.backgroundImage !== 'url(\'\')') {
                    el.classList.add('loaded');
                }
            });
        } catch (e) {
            console.warn('[CW] Error rendering:', e);
        }
    }

    function fmtTimeCW(seconds) {
        if (!seconds || seconds < 0) return '0:00';
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = Math.floor(seconds % 60);
        if (h > 0) {
            return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function renderInChunks(items, container, rendererFunc, chunkSize) {
        chunkSize = chunkSize || 24;
        if (!container) return;
        container.innerHTML = '';
        var index = 0;

        function renderNextChunk() {
            var fragment = document.createDocumentFragment();
            var limit = Math.min(index + chunkSize, items.length);
            while (index < limit) {
                var el = rendererFunc(items[index], index);
                if (typeof el === 'string') {
                    var temp = document.createElement('div');
                    temp.innerHTML = el;
                    while (temp.firstChild) fragment.appendChild(temp.firstChild);
                } else if (el instanceof Node) {
                    fragment.appendChild(el);
                }
                index++;
            }
            container.appendChild(fragment);
            if (index < items.length) {
                requestAnimationFrame(renderNextChunk);
            }
        }
        renderNextChunk();
    }

    function searchCardHTML(item, index, purple, eager) {
        purple = purple || false;
        eager = eager || false;
        var fav = isFav(item.id);
        var h = isH(item);
        var ws = getWatchStatus(item.id);
        var wsClass = getStatusClass(ws);
        var added = formatAdded(item.addedDate);
        var eps = item.eps || '?';
        var type = item.type || 'Anime';
        var img = item.poster || item.image || '';

        return [
            '<div class="card', h ? ' card-h' : '', purple ? ' card-purple' : '', '" onclick="openDetail(\'', item.id, '\')" style="--i:', index, '">',
            '<div class="card-img" style="background:url(\'', img, '\') center/cover no-repeat">',
            '<div class="card-overlay"></div>',
            '<div class="card-badges">',
            added ? '<span class="card-badge card-badge-new">' + added + '</span>' : '',
            ws ? '<span class="card-badge ' + wsClass + '">' + ws + '</span>' : '',
            '</div>',
            fav ? '<div class="card-fav"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></div>' : '',
            '</div>',
            '<div class="card-info">',
            '<div class="card-title">', item.title || item.name || '', '</div>',
            '<div class="card-meta">',
            '<span>', type, '</span>',
            '<span>', eps, ' ep</span>',
            '</div>',
            '</div>',
            '</div>'
        ].join('');
    }

    function renderSearch(q, showLoading) {
        showLoading = showLoading || false;
        var grid = $('search-grid');
        var countEl = $('search-count');
        if (!grid) return;

        if (showLoading) {
            grid.innerHTML = '<div class="search-loading" style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3)">Buscando…</div>';
            return;
        }

        if (!q) {
            grid.innerHTML = '';
            if (countEl) countEl.textContent = '';
            return;
        }

        var results = filterData(q);
        if (countEl) countEl.textContent = results.length + ' resultados';

        if (results.length === 0) {
            grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:60px 20px;text-align:center"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text3);margin-bottom:8px"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><p style="margin-top:12px;font-size:16px;font-weight:700;color:var(--text2)">Sin resultados</p><small style="color:var(--text3);font-size:13px">Intenta con otros términos</small></div>';
            return;
        }

        renderInChunks(results, grid, function (item, i) { return searchCardHTML(item, i, false, i < 12); });
    }

    function genreColor(genreName) {
        const PALETTE = [
            '#e63946', '#00b894', '#fdcb6e', '#a29bfe', '#a855f7',
            '#64748b', '#8b5cf6', '#fd79a8', '#74b9ff', '#dc2626',
            '#f472b6', '#3b82f6', '#f59e0b', '#10b981', '#7c3aed',
            '#eab308', '#06b6d4', '#ef4444', '#991b1b', '#9f1239',
            '#b45309', '#db2777', '#14b8a6', '#312e81', '#71717a',
            '#b91c1c', '#c026d3', '#e60063', '#6700e6', '#0ea5e9',
            '#84cc16', '#22c55e', '#f97316', '#ec4899', '#6366f1'
        ];
        let hash = 0;
        const s = String(genreName);
        for (let i = 0; i < s.length; i++) {
            hash = s.charCodeAt(i) + ((hash << 5) - hash);
        }
        return PALETTE[Math.abs(hash) % PALETTE.length];
    }

    // ── Lucide Icons mapping for dynamically extracted genres/tags ──
    var LUCIDE_ICONS = {
        accion: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
        action: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
        aventura: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>',
        comedia: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 13s1.5 3 4 3 4-3 4-3"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>',
        drama: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 15s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>',
        fantasia: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>',
        misterio: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        psicologico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
        romance: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
        'ciencia ficcion': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"></path></svg>',
        seinen: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
        shoujo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
        colegial: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>',
        shounen: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>',
        'cosas de la vida': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
        sobrenatural: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>',
        'super poderes': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
        deportes: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>',
        thriller: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        demonios: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path><line x1="12" y1="18" x2="12" y2="22"></line><line x1="12" y1="2" x2="12" y2="6"></line></svg>',
        vampiros: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
        historico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
        harem: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
        musica: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
        terror: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
        mecha: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>',
        samurai: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>',
        magia: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"></path><path d="M15 16v-2"></path><path d="M8 9h2"></path><path d="M20 9h2"></path><path d="M17.8 11.8 19 13"></path><path d="M15 9h0"></path><path d="M17.8 6.2 19 5"></path><path d="m3 21 9-9"></path><path d="M12.2 6.2 11 5"></path></svg>',
        isekai: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a7 7 0 0 0-7 7v3a7 7 0 0 0 14 0V9a7 7 0 0 0-7-7z"></path><path d="M9 22h6"></path><path d="M12 18v4"></path></svg>',
        ecchi: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
        'artes marciales': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>',
        militar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
        cocina: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"></path><path d="M7 2v20"></path><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"></path></svg>',
        'recuentos de la vida': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
        'slice of life': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
        supernatural: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>',
        horror: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
        school: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>',
        comedy: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 13s1.5 3 4 3 4-3 4-3"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>',
        fantasy: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>',
        mystery: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        psychological: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
        'sci-fi': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"></path></svg>',
        scifi: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"></path></svg>',
        martial: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>',
        'supernatural': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>',
        'super powers': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
        sports: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>',
        demons: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path><line x1="12" y1="18" x2="12" y2="22"></line><line x1="12" y1="2" x2="12" y2="6"></line></svg>',
        vampires: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
        historical: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
        music: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
        magic: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"></path><path d="M15 16v-2"></path><path d="M8 9h2"></path><path d="M20 9h2"></path><path d="M17.8 11.8 19 13"></path><path d="M15 9h0"></path><path d="M17.8 6.2 19 5"></path><path d="m3 21 9-9"></path><path d="M12.2 6.2 11 5"></path></svg>',
        cooking: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"></path><path d="M7 2v20"></path><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"></path></svg>',
        'slice-of-life': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
    };

    // ── Inicializar la aplicación después de que todo esté definido ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
