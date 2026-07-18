(function () {
    'use strict';

    const DATA = window.DATA || [];
    const CFG = window.CONFIG || {};

    // Construir caché de búsqueda para optimizar rendimiento de "Explorar"
    function buildSearchCache() {
        if (window._searchCacheBuilt) return;
        DATA.forEach(d => {
            const tagsText = Array.isArray(d.tags) ? d.tags.join(' ') : (d.tags || '');
            // Incluir título, descripción, tags, categoría, y también el título sin acentos para búsqueda flexible
            const title = d.title || '';
            const desc = d.description || '';
            const cat = d.category || '';
            // Versión sin acentos para búsqueda tolerante
            const noAccent = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const titleNoAccent = noAccent(title);
            const descNoAccent = noAccent(desc);
            const tagsNoAccent = noAccent(tagsText);
            const catNoAccent = noAccent(cat);
            // También incluir palabras individuales del título para búsqueda parcial
            const titleWords = title.toLowerCase().split(/[\s,.-]+/).filter(w => w.length > 1).join(' ');
            d._searchText = `${title} ${desc} ${tagsText} ${cat} ${titleNoAccent} ${descNoAccent} ${tagsNoAccent} ${catNoAccent} ${titleWords}`.toLowerCase();
        });
        window._searchCacheBuilt = true;
    }

    // Aplicar configuración
    (function applyConfig() {
        const name = CFG.appName || 'ANiGo';
        document.title = name;

        // Header & Sidebar: logo imagen o texto
        const logos = document.querySelectorAll('.logo');
        logos.forEach(logoEl => {
            if (CFG.headerLogoUrl) {
                logoEl.innerHTML = `<img src="${CFG.headerLogoUrl}" alt="${name}" style="height:32px;object-fit:contain;vertical-align:middle">`;
            } else {
                logoEl.textContent = name;
            }
        });

        // Banner hero
        if (CFG.bannerUrl) {
            const hero = document.querySelector('.hero');
            if (hero) {
                hero.classList.add('lazy-bg');
                hero.dataset.bg = `url('${CFG.bannerUrl}')`;
                hero.style.backgroundSize = 'cover';
                hero.style.backgroundPosition = 'center';
            }
        }

        // Hero configurable
        const h = CFG.hero || {};
        const heroBg = document.getElementById('hero-bg');
        if (heroBg) {
            if (h.backgroundUrl) {
                heroBg.classList.add('lazy-bg');
                heroBg.dataset.bg = `url('${h.backgroundUrl}')`;
            }
        }
        const heroBadgeEl = document.getElementById('hero-badge');
        if (heroBadgeEl) {
            if (h.badge) { heroBadgeEl.textContent = h.badge; heroBadgeEl.style.display = ''; }
            else heroBadgeEl.style.display = 'none';
        }
        const heroTitleEl = document.getElementById('hero-title');
        if (heroTitleEl) heroTitleEl.textContent = h.title || '';
        const heroSubEl = document.getElementById('hero-subtitle');
        if (heroSubEl) heroSubEl.textContent = h.subtitle || '';
        const heroCta = document.getElementById('hero-cta-primary');
        const heroCtaLabel = document.getElementById('hero-cta-label');
        if (heroCtaLabel) heroCtaLabel.textContent = h.ctaLabel || 'Explorar';
        if (heroCta) {
            heroCta.dataset.heroNav = h.ctaNav || 'search';
            heroCta.style.display = h.ctaLabel ? '' : 'none';
        }
        const heroCta2 = document.getElementById('hero-cta-secondary');
        const heroCta2Label = document.getElementById('hero-cta2-label');
        if (heroCta2Label) heroCta2Label.textContent = h.cta2Label || '';
        if (heroCta2) {
            heroCta2.dataset.heroNav = h.cta2Nav || 'categories';
            heroCta2.style.display = h.cta2Label ? '' : 'none';
        }

        // Hero favorites button
        const heroFavBtn = document.getElementById('hero-fav-btn');
        if (heroFavBtn && h.heroId != null) {
            const hid = h.heroId;
            heroFavBtn.style.display = '';
            heroFavBtn.dataset.fav = hid;
            const active = isFav(hid);
            heroFavBtn.classList.toggle('active', active);
            heroFavBtn.querySelector('svg').setAttribute('fill', active ? 'currentColor' : 'none');
        }

        // Banner de perfil
        const profileBanner = document.getElementById('profile-banner');
        if (profileBanner) {
            if (CFG.profileBannerUrl) {
                profileBanner.classList.add('lazy-bg');
                profileBanner.dataset.bg = `url('${CFG.profileBannerUrl}')`;
            }
        }

        // Foto y nombre de perfil
        const avatar = document.getElementById('profile-avatar');
        if (avatar) {
            if (CFG.profilePhotoUrl) {
                avatar.innerHTML = `<img src="${CFG.profilePhotoUrl}" alt="perfil" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
            } else {
                avatar.textContent = (CFG.profileName || name).charAt(0).toUpperCase();
            }
        }
        const memberLabel = document.getElementById('profile-member-label');
        if (memberLabel) memberLabel.textContent = `Miembro de ${name}`;

        // Welcome Modal
        const welcomeTitle = document.getElementById('welcome-title-text');
        if (welcomeTitle) welcomeTitle.textContent = `¡Bienvenido a ${name}!`;

        const welcomeDesc = document.getElementById('welcome-desc-text');
        if (welcomeDesc) welcomeDesc.textContent = CFG.aboutDescription || `${name} es tu plataforma personal para descubrir y seguir el anime que más te gusta.`;

        const welcomeLogoContainer = document.getElementById('welcome-logo-container');
        if (welcomeLogoContainer) {
            if (CFG.aboutLogoUrl) {
                welcomeLogoContainer.innerHTML = `<img src="${CFG.aboutLogoUrl}" alt="${name}" style="height:48px;max-width:100%;object-fit:contain">`;
                welcomeLogoContainer.style.background = 'none';
                welcomeLogoContainer.style.boxShadow = 'none';
            } else {
                welcomeLogoContainer.innerHTML = `<span id="welcome-logo-icon" style="font-size: 36px; padding-bottom: 2px; color: #000;">${name.charAt(0).toUpperCase()}</span>`;
            }
        }
    })();

    const FAVS_KEY = 'favorites_v1';
    const WATCH_STATUS_KEY = 'watch_status_v1';
    let favs = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
    // watchStatus: { [id]: 'Viendo' | 'Completado' | 'Pendiente' }
    let watchStatus = JSON.parse(localStorage.getItem(WATCH_STATUS_KEY) || '{}');
    const APP_STATE_KEY = 'wolfanime_last_state';
    let state = { view: null, prev: null, detail: null, catFilter: null, searchQ: '', favFilter: 'all' };
    let _pendingCWDeleteId = null;
    let viewScrolls = {};

    function getLazyBgAttrs(classes, bgStr) {
        return `class="${classes} lazy-bg" data-bg="${bgStr}"`;
    }

    // --- Image Cache for GIFs and posters ---
    const IMG_CACHE = {};

    // --- Lazy Loading Hybrid System ---
    function forceLoadImage(el) {
        if (el.dataset.loading === '1') return;
        el.dataset.loading = '1';

        const bgStr = el.dataset.bg;
        if (!bgStr || bgStr === 'undefined') return;

        const match = bgStr.match(/url\(['"]?([^'"\)]+)['"]?\)/);
        if (match && match[1]) {
            const url = match[1];

            // Check cache first
            if (IMG_CACHE[url]) {
                el.style.backgroundImage = `url('${url}')`;
                if (el.classList.contains('cat-card')) {
                    el.style.setProperty('background-size', '100% 100%', 'important');
                    el.style.setProperty('background-position', 'center', 'important');
                }
                el.style.backgroundRepeat = 'no-repeat';
                const currentAnim = el.style.animation || '';
                if (currentAnim.includes('shimmer')) {
                    el.style.animation = currentAnim.split(',').filter(a => !a.includes('shimmer')).join(',').trim() || 'none';
                } else if (!el.style.animation) {
                    el.style.animation = 'none';
                }
                el.classList.add('loaded');
                return;
            }

            const img = new Image();
            const applyBg = () => {
                // Store in cache
                IMG_CACHE[url] = img;

                el.style.backgroundImage = `url('${url}')`;
                if (el.classList.contains('cat-card')) {
                    el.style.setProperty('background-size', '100% 100%', 'important');
                    el.style.setProperty('background-position', 'center', 'important');
                }
                el.style.backgroundRepeat = 'no-repeat';

                const currentAnim = el.style.animation || '';
                if (currentAnim.includes('shimmer')) {
                    el.style.animation = currentAnim.split(',').filter(a => !a.includes('shimmer')).join(',').trim() || 'none';
                } else if (!el.style.animation) {
                    el.style.animation = 'none';
                }

                el.classList.add('loaded');
            };
            img.onload = applyBg;
            img.onerror = applyBg;
            img.src = url;

            if (img.complete) {
                applyBg();
            } else {
                setTimeout(applyBg, 3000); // Failsafe
            }
        } else {
            el.style.setProperty('background-color', bgStr, 'important');
            el.classList.add('loaded');
        }
    }

    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                forceLoadImage(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { rootMargin: '1000px' });

    function unstickImagesInView(view) {
        if (!view) return;
        const els = view.querySelectorAll('.lazy-bg:not(.loaded):not([data-loading])');
        let processed = 0;
        els.forEach(el => {
            if (processed < 30) {
                forceLoadImage(el);
                processed++;
            }
        });
    }

    function observeImages() {
        document.querySelectorAll('.lazy-bg:not(.loaded)').forEach(el => {
            imageObserver.observe(el);
        });
        unstickImagesInView(document.querySelector('.view.active'));
    }

    const domObserver = new MutationObserver(() => {
        observeImages();
    });

    const saveWatchStatus = () => localStorage.setItem(WATCH_STATUS_KEY, JSON.stringify(watchStatus));
    const getWatchStatus = id => watchStatus[id] || null;
    const setWatchStatus = (id, status) => {
        if (status) watchStatus[id] = status;
        else delete watchStatus[id];
        saveWatchStatus();
    };

    // ── Historial de búsqueda ──────────────────────────────────
    const SEARCH_HISTORY_KEY = 'search_history_v1';
    const SEARCH_HISTORY_MAX = 10;
    let searchHistory = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');

    function saveSearchHistory() {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory));
    }

    function addToSearchHistory(query) {
        const q = query.trim();
        if (!q || q.length < 2) return;
        searchHistory = searchHistory.filter(h => h !== q);
        searchHistory.unshift(q);
        if (searchHistory.length > SEARCH_HISTORY_MAX) searchHistory = searchHistory.slice(0, SEARCH_HISTORY_MAX);
        saveSearchHistory();
    }

    let _pendingHistoryDeleteQuery = null;

    function clearSearchHistory() {
        searchHistory = [];
        saveSearchHistory();
        renderSearchHistory();
        showToast('Historial de búsqueda borrado');
        closeHistoryClearModal();
    }

    function removeFromSearchHistory(query) {
        searchHistory = searchHistory.filter(h => h !== query);
        saveSearchHistory();
        renderSearchHistory();
    }

    function openHistoryClearModal() {
        const overlay = $('history-clear-confirm-overlay');
        if (overlay) {
            overlay.classList.add('open');
            overlay.setAttribute('aria-hidden', 'false');
        }
    }

    function closeHistoryClearModal() {
        const overlay = $('history-clear-confirm-overlay');
        if (overlay) {
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
        }
    }

    function openSingleHistoryDeleteModal(query) {
        _pendingHistoryDeleteQuery = query;
        const textEl = $('history-single-confirm-query-text');
        if (textEl) textEl.textContent = `¿Deseas eliminar "${query}" de tu historial?`;

        const overlay = $('history-single-confirm-overlay');
        if (overlay) {
            overlay.classList.add('open');
            overlay.setAttribute('aria-hidden', 'false');
        }
    }

    function closeSingleHistoryDeleteModal() {
        _pendingHistoryDeleteQuery = null;
        const overlay = $('history-single-confirm-overlay');
        if (overlay) {
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
        }
    }

    function updateSearchHistoryCountLabel() {
        const lbl = $('search-history-count-label');
        if (!lbl) return;
        const n = searchHistory.length;
        lbl.textContent = n > 0 ? `${n} búsqueda${n !== 1 ? 's' : ''} guardada${n !== 1 ? 's' : ''}` : 'Historial vacío';
    }

    function renderSearchHistory() {
        const list = $('search-history-list');
        const empty = $('search-history-empty');
        if (!list || !empty) return;

        if (!searchHistory.length) {
            list.innerHTML = '';
            empty.style.display = 'flex';
            return;
        }

        empty.style.display = 'none';
        list.innerHTML = searchHistory.map(q => `
            <div class="history-item" data-history-q="${q}">
                <div class="history-item-left">
                    <div class="history-item-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                    </div>
                    <span class="history-item-text">${q}</span>
                </div>
                <button class="history-item-remove" data-history-remove="${q}" aria-label="Quitar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>
                    </svg>
                </button>
            </div>
        `).join('');

        list.onclick = (e) => {
            const removeBtn = e.target.closest('.history-item-remove');
            if (removeBtn) {
                e.stopPropagation();
                openSingleHistoryDeleteModal(removeBtn.dataset.historyRemove);
                return;
            }

            const row = e.target.closest('.history-item');
            if (row) {
                const q = row.dataset.historyQ;
                $('search-input').value = q;
                navigateTo('search');
                renderSearch(q);
            }
        };
    }
    // ────────────────────────────────────────────────────────────

    const $ = id => document.getElementById(id);
    const saveFavs = () => {
        localStorage.setItem(FAVS_KEY, JSON.stringify(favs));
        renderProfile();
    };
    const isFav = id => favs.includes(id);

    function showToast(msg, iconHTML = '') {
        const toast = $('toast');
        if (!toast) return;
        toast.innerHTML = (iconHTML || `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`) + `<span>${msg}</span>`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    const openModal = id => {
        const modal = $(id);
        if (modal) {
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
        }
    };

    const closeModal = id => {
        const modal = $(id);
        if (modal) {
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
        }
    };

    function generateTextBackup() {
        try {
            const cwData = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('wa_cw_meta_') || k.startsWith('wa_resume_') || k.startsWith('wa_watched_')) {
                    cwData[k] = localStorage.getItem(k);
                }
            }

            const data = {
                favs: favs,
                watchStatus: watchStatus,
                history: searchHistory,
                cw: cwData,
                settings: { h: hCatEnabled },
                v: '1.2',
                app: 'WolfAnime'
            };
            const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
            const area = $('backup-text-area');
            if (area) area.value = b64;
            openModal('backup-text-overlay');
        } catch (e) {
            showToast('Error al generar respaldo', '<span style="color:#ff4d6d">!</span>');
        }
    }

    function restoreFromTextBackup() {
        const area = $('restore-text-area');
        if (!area || !area.value.trim()) {
            showToast('Pega el código primero', '<span style="color:#ff4d6d">!</span>');
            return;
        }
        try {
            const json = decodeURIComponent(escape(atob(area.value.trim())));
            const data = JSON.parse(json);
            
            if (data.favs) { favs = data.favs; saveFavs(); }
            if (data.watchStatus) { watchStatus = data.watchStatus; saveWatchStatus(); }
            if (data.history) { searchHistory = data.history; saveSearchHistory(); }
            
            if (data.cw) {
                Object.entries(data.cw).forEach(([k, v]) => {
                    localStorage.setItem(k, v);
                });
            }

            if (data.settings) {
                if (data.settings.h !== undefined) {
                    hCatEnabled = data.settings.h;
                    localStorage.setItem('h_enabled', hCatEnabled ? '1' : '0');
                }
            }

            showToast('Restauración completada');
            closeModal('restore-text-overlay');
            refreshAllUI();
        } catch (e) {
            showToast('Código de respaldo inválido', '<span style="color:#ff4d6d">!</span>');
        }
    }

    function refreshAllUI() {
        renderHome();
        renderFavorites();
        renderProfile();
        renderCategories();
        if (state.view === 'all-library') renderAllLibrary();
        if (state.view === 'search') renderSearch($('search-input')?.value || '');
        if (state.view === 'settings-data') updateSearchHistoryCountLabel();
    }

    function clearFavorites() {
        if (confirm('¿Estás seguro de que deseas borrar todos tus favoritos?')) {
            favs = [];
            saveFavs();
            renderFavorites();
            renderHome();
            showToast('Favoritos borrados');
        }
    }

    function clearWatchHistory() {
        if (confirm('¿Estás seguro de que deseas borrar todo tu historial de visto?')) {
            watchStatus = {};
            saveWatchStatus();
            renderHome();
            renderSearch();
            renderProfile();
            showToast('Historial borrado');
        }
    }

    function exportUserData() {
        try {
            // Collect all "Continue Watching" related keys from localStorage
            const cwData = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('wa_cw_meta_') || k.startsWith('wa_resume_') || k.startsWith('wa_watched_')) {
                    cwData[k] = localStorage.getItem(k);
                }
            }

            const data = {
                favorites: favs,
                watchStatus: watchStatus,
                searchHistory: searchHistory,
                continueWatching: cwData,
                settings: {
                    hCatEnabled: hCatEnabled,
                    preferredLang: localStorage.getItem('preferred_lang') || 'Latino'
                },
                exportDate: new Date().toISOString(),
                app: 'WolfAnime'
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `wolfanime_full_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Respaldo completo exportado');
        } catch (e) {
            showToast('Error al exportar', '<span style="color:#ff4d6d">!</span>');
        }
    }

    function importUserData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const data = JSON.parse(event.target.result);
                    
                    // 1. Favorites
                    if (data.favorites) {
                        favs = data.favorites;
                        saveFavs();
                    }
                    
                    // 2. Watch Status (Mi Lista)
                    if (data.watchStatus) {
                        watchStatus = data.watchStatus;
                        saveWatchStatus();
                    }
                    
                    // 3. Continue Watching (Progress, Medata, Watched marks)
                    if (data.continueWatching) {
                        Object.entries(data.continueWatching).forEach(([k, v]) => {
                            localStorage.setItem(k, v);
                        });
                    }

                    // 4. Settings
                    if (data.settings) {
                        if (data.settings.hCatEnabled !== undefined) {
                            hCatEnabled = data.settings.hCatEnabled;
                            localStorage.setItem('h_enabled', hCatEnabled ? '1' : '0');
                        }
                        if (data.settings.preferredLang) {
                            localStorage.setItem('preferred_lang', data.settings.preferredLang);
                        }
                    }

                    // 5. Search History
                    if (data.searchHistory) {
                        searchHistory = data.searchHistory;
                        saveSearchHistory();
                    }

                    showToast('Datos restaurados correctamente');
                    closeModalByOverlayId('import-data-modal'); // If applicable, otherwise just finish
                    refreshAllUI();
                } catch (e) {
                    showToast('Error: archivo inválido', '<span style="color:#ff4d6d">!</span>');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    const toggleFav = id => {
        favs = isFav(id) ? favs.filter(f => f !== id) : [...favs, id];
        saveFavs();
    };

    function debounce(fn, ms) {
        let t;
        return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    }

    function getURLParams() {
        const params = new URLSearchParams(window.location.search);
        return Object.fromEntries(params.entries());
    }

    function updateURL(newParams = {}) {
        try {
            const url = new URL(window.location.href);
            const params = new URLSearchParams();

            Object.entries(newParams).forEach(([k, v]) => {
                if (v !== null && v !== undefined && v !== '') params.set(k, v);
            });

            const newUrl = params.toString() ? `${url.pathname}?${params.toString()}` : url.pathname;
            window.history.replaceState({}, '', newUrl);
        } catch(e) {}

        localStorage.setItem(APP_STATE_KEY, JSON.stringify(newParams));
    }

    function handleURLParams() {
        let p = getURLParams();
        const hasRelevantParams = p.cat || p.q || p.view;

        if (!hasRelevantParams) {
            const saved = localStorage.getItem(APP_STATE_KEY);
            if (saved) {
                try {
                    const sp = JSON.parse(saved);
                    if (sp && Object.keys(sp).length > 0) p = sp;
                } catch (e) { }
            }
        }

        if (p.cat) {
            state.catFilter = p.cat;
            renderCatLibrary(p.cat);
            navigateTo('cat-library');
            return true;
        }
        if (p.q) {
            if ($('search-input')) $('search-input').value = p.q;
            renderSearch(p.q);
            navigateTo('search');
            return true;
        }
        if (p.view) {
            navigateTo(p.view);
            return true;
        }
        return false;
    }

    const CATS_CFG = window.CATEGORIES_CONFIG || [];
    const CATEGORIES = CATS_CFG.filter(c => !c.isH).map(c => c.name);
    const CAT_COLORS = Object.fromEntries(CATS_CFG.map(c => [c.name, c.color]));
    const CAT_ACCENT = Object.fromEntries(CATS_CFG.map(c => [c.name, c.accent]));
    const CAT_ICONS_MAP = Object.fromEntries(CATS_CFG.map(c => [c.name, c.icon]));

    let hCatEnabled = localStorage.getItem('h_enabled') === '1';

    // FIX: Guardar el valor por defecto explícitamente en el localStorage si no existe
    const autoplayRaw = localStorage.getItem('autoplay_enabled');
    let autoplayEnabled = autoplayRaw !== '0'; // Por defecto true
    if (autoplayRaw === null) {
        localStorage.setItem('autoplay_enabled', '1');
    }
    const saveAutoplayEnabled = () => localStorage.setItem('autoplay_enabled', autoplayEnabled ? '1' : '0');

    const isH = item => {
        if (!item) return false;
        // Check category field (case-insensitive)
        if (item.category) {
            const cats = item.category.split(/,\s*/).map(c => c.trim().toUpperCase());
            if (cats.includes('H')) return true;
        }
        // Check genre field (alias for category)
        if (item.genre) {
            const genres = item.genre.split(/,\s*/).map(c => c.trim().toUpperCase());
            if (genres.includes('H')) return true;
        }
        // Check tags array for 'H' tag
        if (item.tags) {
            if (Array.isArray(item.tags)) {
                if (item.tags.some(t => t.trim().toUpperCase() === 'H')) return true;
            } else if (typeof item.tags === 'string') {
                const tagList = item.tags.split(/,\s*/).map(t => t.trim().toUpperCase());
                if (tagList.includes('H')) return true;
            }
        }
        return false;
    };

    // Deduplicar DATA por ID para evitar entradas repetidas
    const uniqueData = (arr) => {
        const seen = new Set();
        return arr.filter(item => {
            if (!item || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });
    };

    const visibleDATA = () => {
        const filtered = hCatEnabled ? DATA : DATA.filter(d => !isH(d));
        return uniqueData(filtered);
    };

    const saveHEnabled = () => localStorage.setItem('h_enabled', hCatEnabled ? '1' : '0');

    function formatAdded(d) {
        if (!d) return '';
        const [y, m, day] = d.split('-');
        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
    }

    function getStatusClass(s) {
        if (!s) return 'status-off';
        if (s === 'En emisión') return 'status-on';
        if (s === 'En pausa') return 'status-pause';
        return 'status-off';
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
            return `<div class="mini-card${h ? ' scard-h' : ''}" data-id="${item.id}">
      <div ${getLazyBgAttrs('mini-card-img', posterBg(item))}></div>
      <div class="mini-card-body">
        <div class="mini-card-title">${item.title}</div>
        <div style="font-size:11px;color:var(--text3)">${item.episodes} eps</div>
      </div>
    </div>`;
        }
        // Optimized lightweight card structure
        return `<div class="card${h ? ' card-h' : ''}" data-id="${item.id}" style="animation-delay: 0ms;">
    <div ${getLazyBgAttrs('card-img', posterBg(item))}>
      <div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);border-radius:20px;padding:3px 8px;font-size:11px;font-weight:600;color:#fff">${item.status}</div>
      ${item.addedDate ? `<div style="position:absolute;bottom:8px;left:8px;background:rgba(0,230,118,0.18);border:1px solid rgba(0,230,118,0.35);border-radius:20px;padding:3px 8px;font-size:10px;font-weight:600;color:#00E676">+ ${formatAdded(item.addedDate)}</div>` : ''}
      ${h ? '<span class="h-badge">18+</span>' : ''}
    </div>
    <div class="card-body">
      <div class="card-title">${item.title}</div>
      <div class="card-meta">
        <div class="meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${item.readTime}</div>
        <div class="meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>${item.episodes} eps</div>
        <div class="meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>${item.source}</div>
      </div>
      <div class="card-desc">${item.description}</div>
      <div class="card-actions">
        <button class="cta-btn" data-cta="${item.id}">Ver anime</button>
        <button class="mylist-add-btn${(isFav(item.id) || getWatchStatus(item.id)) ? ' in-list' : ''}" data-mylist="${item.id}" aria-label="Agregar a Mi Lista">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${(isFav(item.id) || getWatchStatus(item.id)) ? 'En Mi Lista' : 'Mi Lista'}</span>
        </button>
      </div>
    </div>
  </div>`;
    }

    // Staggered animation system for cards
    function applyStaggeredAnimations(container, selector = '.card, .scard, .recent-card, .slider-card') {
        if (!container) return;
        const cards = container.querySelectorAll(selector);
        cards.forEach((card, index) => {
            // Stagger delay: 60ms between each card for smooth sequential appearance
            const delay = index * 60;
            card.style.animationDelay = `${delay}ms`;
        });
    }

    let _homeRendering = false;
    let _homeRenderCount = 0;
    function renderHome() {
        // Evitar re-renderizados duplicados en rápida sucesión
        if (_homeRendering) return;
        _homeRendering = true;
        const myRenderId = ++_homeRenderCount;
        // Liberar después de un tiempo prudente para permitir re-renderizados legítimos
        setTimeout(() => { if (_homeRenderCount === myRenderId) _homeRendering = false; }, 500);

        const featured = visibleDATA().filter(d => d.featured);
        const airing = visibleDATA().filter(d => d.status === 'En emisión').slice(0, 10);

        initSlider('featured-track', 'featured-dots', featured, true, 'horizontal', true);
        initSlider('popular-track', 'popular-dots', airing, false, 'vertical', false);

        const grid = $('home-grid');
        if (!grid) return;
        const sorted = [...visibleDATA()].sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || '')).slice(0, 5);
        grid.innerHTML = sorted.map((d, i) => recentCardHTML(d, i + 1, i)).join('');
        
        // Apply staggered animations to cards
        requestAnimationFrame(() => {
            applyStaggeredAnimations(grid, '.recent-card');
            const featuredTrack = $('featured-track');
            const popularTrack = $('popular-track');
            if (featuredTrack) applyStaggeredAnimations(featuredTrack, '.slider-card');
            if (popularTrack) applyStaggeredAnimations(popularTrack, '.slider-card');
        });

        renderHomeFavs();
        renderContinueWatching();
    }



    function initSlider(trackId, dotsId, data, isAutoPlay, layout = 'horizontal', showPagination = true) {
        const track = $(trackId);
        const dotsEl = $(dotsId);
        if (!track || !dotsEl || !data.length) return;

        if (!showPagination) {
            dotsEl.style.display = 'none';
        } else {
            dotsEl.style.display = '';
        }

        track.innerHTML = '';
        const frag = document.createDocumentFragment();
        data.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = `slider-card ${layout}`;
            div.dataset.id = item.id;
            const statusColor = item.status === 'En emisión' ? '#00e676' : item.status === 'En pausa' ? '#ffb300' : '#aaa';
            const year = item.date ? item.date.substring(0, 4) : '';
            const bg = layout === 'horizontal' ? backdropBg(item) : posterBg(item);
            const badgeText = isAutoPlay ? 'DESTACADO' : (layout === 'vertical' ? 'EN EMISIÓN' : 'TENDENCIA');
            const badgeClass = isAutoPlay ? 'badge-featured' : (layout === 'vertical' ? 'badge-airing' : 'badge-trending');

            div.innerHTML = `<div class="slider-poster">
                <div ${getLazyBgAttrs('slider-poster-bg', bg)}></div>
                <div class="slider-poster-overlay"></div>
                <div class="slider-poster-badge ${badgeClass}">${badgeText}</div>
                ${layout === 'vertical' ? '' : `<span class="slider-poster-eps">${item.episodes} eps</span>`}
                <div class="slider-poster-info">
                    <div class="slider-poster-title">${item.title}</div>
                    <div class="slider-poster-meta">
                        <span class="slider-poster-status" style="color:${statusColor}">${item.status}</span>
                        <span class="slider-poster-dot">•</span>
                        <span class="slider-poster-year">${year}</span>
                    </div>
                </div>
            </div>`;
            frag.appendChild(div);
        });
        track.appendChild(frag);

        dotsEl.innerHTML = `
            <div class="slider-counter ${showPagination ? '' : 'hidden'}">
                <span class="slider-counter-current">01</span>
                <span class="slider-counter-sep">/</span>
                <span class="slider-counter-total">${String(data.length).padStart(2, '0')}</span>
            </div>
            <div class="slider-progress-bar"><div class="slider-progress-fill"></div></div>
            <div class="slider-dots-row">${data.map((_, i) => `<div class="dot${i === 0 ? ' active' : ''}" data-dot="${i}"></div>`).join('')}</div>
        `;

        let autoIdx = 0;
        let timer = null;

        function updateUI(idx) {
            const dots = dotsEl.querySelectorAll('.dot');
            dots.forEach((d, i) => d.classList.toggle('active', i === idx));
            const current = dotsEl.querySelector('.slider-counter-current');
            if (current) {
                current.textContent = String(idx + 1).padStart(2, '0');
                current.classList.remove('animating');
                void current.offsetWidth;
                current.classList.add('animating');
            }
            const fill = dotsEl.querySelector('.slider-progress-fill');
            if (fill) fill.style.width = ((idx + 1) / data.length * 100) + '%';
        }

        function scrollToIndex(idx) {
            const cards = track.querySelectorAll('.slider-card');
            if (!cards[idx]) return;
            const card = cards[idx];
            const scrollLeft = card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
            track.scrollTo({ left: scrollLeft, behavior: 'smooth' });
            updateUI(idx);
            autoIdx = idx;
        }

        let isScrolling = false;
        track.addEventListener('scroll', () => {
            if (isScrolling) return;
            isScrolling = true;
            setTimeout(() => {
                const card = track.querySelector('.slider-card');
                const cardW = card?.offsetWidth || 200;
                const idx = Math.round(track.scrollLeft / (cardW + 12));
                if (idx !== autoIdx && idx >= 0 && idx < data.length) {
                    autoIdx = idx;
                    updateUI(idx);
                }
                isScrolling = false;
            }, 150);
        }, { passive: true });

        dotsEl.onclick = (e) => {
            const dot = e.target.closest('.dot');
            if (dot) scrollToIndex(parseInt(dot.dataset.dot));
        };

        if (isAutoPlay) {
            const startAuto = () => {
                clearInterval(timer);
                timer = setInterval(() => {
                    autoIdx = (autoIdx + 1) % data.length;
                    scrollToIndex(autoIdx);
                }, 5000);
            };
            startAuto();
            track.addEventListener('touchstart', () => clearInterval(timer), { passive: true });
            track.addEventListener('touchend', startAuto, { passive: true });
        }
    }

    function recentCardHTML(item, num, index = 0) {
        const h = isH(item);
        // Optimized lightweight structure with inline animation delay
        return `<div class="recent-card${h ? ' recent-card-h' : ''}" data-id="${item.id}" style="animation-delay: 0ms;">
    <div class="recent-poster">
      <div ${getLazyBgAttrs('recent-poster-img', posterBg(item))}></div>
      <div class="recent-poster-num">#${num}</div>
      ${h ? '<span class="h-badge">18+</span>' : ''}
    </div>
    <div class="recent-body">
      <div class="recent-title">${item.title}</div>
      <div class="recent-meta">
        <span class="recent-pill">${item.episodes} eps</span>
      </div>
      <div class="recent-date">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${formatAdded(item.addedDate)}
      </div>
    </div>
  </div>`;
    }

    function renderHomeFavs() {
        const container = $('home-favs');
        if (!container) return;
        const favItems = visibleDATA().filter(d => isFav(d.id));
        if (!favItems.length) {
            container.innerHTML = '<div style="padding:8px 0;font-size:13px;color:var(--text3)">Aún no tienes favoritos</div>';
            return;
        }
        container.innerHTML = favItems.map(d => cardHTML(d, true)).join('');
    }

    // ── Continuar Viendo ─────────────────────────────────────
    function renderContinueWatching() {
        const section = document.getElementById('cw-section');
        const track = document.getElementById('cw-track');
        if (!section || !track) return;

        // Collect all CW metadata from localStorage
        const items = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('wa_cw_meta_')) {
                try {
                    const meta = JSON.parse(localStorage.getItem(k));
                    if (meta && meta.serieId && meta.progress > 0 && meta.progress < 95) {
                        // Filter out H-tagged content when +18 is disabled
                        // meta.isH is saved directly from SERIE.tags in series-anime-V72.js
                        if (!hCatEnabled && meta.isH) continue;
                        items.push(meta);
                    }
                } catch (e) {}
            }
        }

        // Sort by most recently updated
        items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        if (!items.length) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        track.innerHTML = items.map((meta, idx) => {
            const poster = meta.poster || '';
            const timeLeft = meta.duration && meta.currentTime
                ? fmtTimeCW(meta.duration - meta.currentTime)
                : '';
            const epLabel = meta.epType === 'movie' ? 'Película' : ('Ep. ' + meta.epNum);
            const title = meta.serieTitle || 'Sin título';

            return `<div class="cw-card" data-idx="${idx}" data-serieid="${meta.serieId}" data-url="${meta.serieUrl || ''}" data-resumekey="${meta.resumeKey || ''}" style="animation-delay:${idx * 60}ms">
                <div class="cw-thumb">
                    <div class="cw-thumb-bg lazy-bg" data-bg="url('${poster}')" style="width:100%;height:100%;background-size:cover;background-position:center"></div>
                    <div class="cw-thumb-overlay"></div>
                    <button class="cw-play-btn" aria-label="Reproducir">
                        <svg fill="currentColor" viewBox="0 0 24 24" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="cw-remove-btn" aria-label="Eliminar de continuar viendo">
                        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <div class="cw-progress-bar"><div class="cw-progress-fill" style="width:${meta.progress}%"></div></div>
                </div>
                <div class="cw-info">
                    <div class="cw-title">${title}</div>
                    <div class="cw-sub">${epLabel}${meta.epTitle ? ' · ' + meta.epTitle : ''}</div>
                    ${timeLeft ? `<div class="cw-time-left">${timeLeft} restantes</div>` : ''}
                </div>
            </div>`;
        }).join('');

        // Lazy load backgrounds
        requestAnimationFrame(() => {
            track.querySelectorAll('.lazy-bg').forEach(el => {
                const bg = el.dataset.bg;
                if (bg) el.style.backgroundImage = bg;
            });
        });

        // Click handler
        track.onclick = (e) => {
            const card = e.target.closest('.cw-card');
            const removeBtn = e.target.closest('.cw-remove-btn');
            const playBtn = e.target.closest('.cw-play-btn');

            if (!card) return;

            const serieId = card.dataset.serieid;
            const url = card.dataset.url;
            const resumeKey = card.dataset.resumekey;

            // Remove button - open confirmation modal
            if (removeBtn) {
                e.stopPropagation();
                const metaKey = 'wa_cw_meta_' + serieId;
                const title = card.querySelector('.cw-title');
                openCWRemoveConfirm(serieId, metaKey, resumeKey, title ? title.textContent : '');
                return;
            }

            // Play button - navigate to series URL
            if (playBtn) {
                e.stopPropagation();
                if (url) location.href = url;
                return;
            }

            // Card click - navigate to series
            if (url) location.href = url;
        };
    }

    function fmtTimeCW(seconds) {
        if (!seconds || seconds < 0) return '';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const rm = m % 60;
            return h + 'h ' + rm + 'm';
        }
        return m + 'm ' + s + 's';
    }

    // SCROLL INFINITO MEJORADO PARA RENDERINCHUNKS
    let _chunkObserver = null;
    function renderInChunks(items, container, rendererFunc, chunkSize = 24) {
        if (!container) return;
        container.innerHTML = '';
        if (_chunkObserver) {
            _chunkObserver.disconnect();
            _chunkObserver = null;
        }
        if (!items || items.length === 0) return;

        let pos = 0;
        function renderNextChunk() {
            const chunk = items.slice(pos, pos + chunkSize);
            if (chunk.length === 0) return;

            // Render HTML
            const html = chunk.map((item, i) => rendererFunc(item, pos + i)).join('');
            container.insertAdjacentHTML('beforeend', html);
            pos += chunkSize;

            // Trigger eager load on visible new elements
            setTimeout(observeImages, 10);

            // Set up IntersectionObserver to load the next chunk when scrolled near bottom
            if (pos < items.length) {
                const sentinel = document.createElement('div');
                sentinel.className = 'scroll-sentinel';
                sentinel.style.height = '1px';
                sentinel.style.width = '100%';
                sentinel.style.gridColumn = '1 / -1'; // Ensure it spans the whole grid
                container.appendChild(sentinel);

                _chunkObserver = new IntersectionObserver((entries) => {
                    if (entries[0].isIntersecting) {
                        _chunkObserver.disconnect();
                        sentinel.remove();
                        requestAnimationFrame(renderNextChunk);
                    }
                }, { rootMargin: '400px' }); // Load early 
                _chunkObserver.observe(sentinel);
            }
        }
        renderNextChunk();
    }

    function searchCardHTML(item, index = 0, purple = false, eager = false) {
        const h = purple || isH(item);
        let bgStr = posterBg(item);
        let bgAttrs = getLazyBgAttrs('scard-poster', bgStr);
        if (eager && bgAttrs.includes('lazy-bg')) {
            bgAttrs = `class="scard-poster loaded" style="background: ${bgStr} !important; animation: none !important;"`;
        }
        // Optimized lightweight structure with inline animation delay placeholder
        return `<div class="scard${h ? ' scard-h' : ''}" data-id="${item.id}" style="animation-delay: 0ms;">
    <div ${bgAttrs}>
      <div class="scard-status ${getStatusClass(item.status)}">${item.status}</div>
      ${h ? '<span class="h-badge">18+</span>' : ''}
    </div>
    <div class="scard-body">
      <div class="scard-title">${item.title}</div>
      <div class="scard-pills">
        <span class="scard-pill">${item.episodes} eps</span>
        <span class="scard-pill">${item.readTime}</span>
        <span class="scard-pill">${item.date ? item.date.slice(0, 4) : ''}</span>
      </div>
    </div>
  </div>`;
    }

    function renderSearch(q = '') {
        const grid = $('search-grid');
        const empty = $('search-empty');
        const meta = $('search-meta');

        const trimmedQ = q.trim();
        const lower = trimmedQ.toLowerCase();

        // Si no hay consulta, mostrar mensaje placeholder en lugar de todos los resultados
        if (!trimmedQ) {
            grid.innerHTML = '';
            empty.style.display = 'flex';
            empty.querySelector('p').textContent = 'Escribe tu anime favorito a buscar';
            empty.querySelector('small').textContent = 'Los resultados aparecerán aquí conforme escribas';
            meta.textContent = '';
            return;
        }

        let results = visibleDATA();

        // Uso la caché pre-computada de búsqueda (muy rápido)
        // También buscar sin acentos para mejorar resultados
        const lowerNoAccent = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        results = results.filter(d => {
            const st = d._searchText || '';
            return st.includes(lower) || st.includes(lowerNoAccent);
        });

        if (!results.length) {
            grid.innerHTML = '';
            empty.style.display = 'flex';
            empty.querySelector('p').textContent = 'Sin resultados';
            empty.querySelector('small').textContent = 'Intenta con otro término';
            meta.textContent = '';
        } else {
            empty.style.display = 'none';
            renderInChunks(results, grid, (d, i) => searchCardHTML(d, i, false, true));
            meta.textContent = `${results.length} resultado${results.length !== 1 ? 's' : ''} para "${trimmedQ}"`;
            
            // Apply staggered animations with delay for smooth appearance
            requestAnimationFrame(() => {
                applyStaggeredAnimations(grid, '.scard');
            });
        }
    }

    let lastRenderedHState = null;
    function renderCategories() {
        const catGrid = $('cat-grid');
        if (!catGrid) return;

        if (catGrid.children.length > 0 && lastRenderedHState === hCatEnabled) return;
        lastRenderedHState = hCatEnabled;

        const data = visibleDATA();
        const counts = {};
        data.forEach(item => {
            if (!item.category) return;
            const itemCats = item.category.split(/,\s*/);
            itemCats.forEach(c => {
                const trimmed = c.trim();
                // Normalizar 'H' a mayúscula para conteo consistente
                const key = trimmed.toUpperCase() === 'H' ? 'H' : trimmed;
                counts[key] = (counts[key] || 0) + 1;
            });
        });

        const visibleCats = hCatEnabled ? [...CATEGORIES, 'H'] : CATEGORIES;
        catGrid.innerHTML = visibleCats.map((cat, index) => {
            const count = counts[cat] || 0;
            const cfg = (window.CATEGORIES_CONFIG || []).find(x => x.name.toLowerCase().replace(':', '') === cat.toLowerCase().replace(':', '')) || { name: cat };
            const icon = cfg.icon || '';
            const accent = cfg.accent || 'var(--accent)';
            const staggerDelay = Math.min(index, 15) * 0.04;

            return `
                <div class="cat-card" data-cat="${cat}">
                    <img class="cat-card-bg" src="${cfg.backdrop || ''}" alt="" loading="lazy" style="display: ${cfg.backdrop ? 'block' : 'none'};">
                    <div class="cat-card-icon" style="color:${accent}; border-color:${accent}44; background: ${accent}11;">${icon}</div>
                    <div class="cat-card-info">
                        <h3>${cat}</h3>
                        <div class="cat-card-count" style="background:${accent}; color:#000">${count} anime${count !== 1 ? 's' : ''}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderCatLibrary(cat) {
        $('cat-library-title').textContent = cat === 'H' ? 'Contenido H' : cat;
        const trimmedCat = cat.trim();
        const catUpper = trimmedCat.toUpperCase();
        const items = visibleDATA().filter(d => {
            if (!d.category) return false;
            const cats = d.category.split(/,\s*/).map(c => c.trim());
            // Comparación case-insensitive para 'H', exacta para el resto
            if (catUpper === 'H') return cats.some(c => c.toUpperCase() === 'H');
            return cats.includes(trimmedCat);
        });
        if (items.length === 0) {
            $('cat-library-grid').innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;padding:60px 20px;text-align:center">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text3);margin-bottom:8px"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="9" y1="9" x2="15" y2="9"/></svg>
        <p style="margin-top:12px;font-size:16px;font-weight:700;color:var(--text2)">Sin contenido aún</p>
        <small style="color:var(--text3);font-size:13px">No hay series en esta categoría todavía</small>
      </div>`;
        } else {
            renderInChunks(items, $('cat-library-grid'), (d, i) => searchCardHTML(d, i, cat === 'H'));
        }
    }

    function renderAllLibrary() {
        let items = visibleDATA();
        let title = 'Últimos agregados';
        const grid = $('all-library-grid');
        if (!grid) return;

        grid.classList.remove('layout-horizontal');

        if (state.filterType === 'featured') {
            items = items.filter(d => d.featured);
            title = 'Todos los Destacados';
        } else if (state.filterType === 'airing') {
            items = items.filter(d => d.status === 'En emisión');
            title = 'En Emisión';
        }

        const sorted = [...items].sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || ''));
        const titleEl = document.querySelector('#view-all-library .cat-library-title');
        if (titleEl) titleEl.textContent = title;

        const countEl = $('all-library-count');
        if (countEl) countEl.textContent = `${items.length} títulos`;

        renderInChunks(sorted, grid, (d, i) => searchCardHTML(d, i, false));
    }

    function myListCardHTML(item, index = 0) {
        const ws = getWatchStatus(item.id);
        const fav = isFav(item.id);
        const h = isH(item);
        const delay = (index % 24) * 0.04;

        // SIN LAZY LOADING: Inyectamos el estilo inline directamente
        const bgStyle = `background: ${posterBg(item)} !important; background-size: cover !important; background-position: center !important;`;

        return `<div class="scard${h ? ' scard-h' : ''}" data-id="${item.id}">
    <div class="scard-poster loaded" style="${bgStyle}">
      <div class="scard-status ${getStatusClass(item.status)}">${item.status}</div>
      ${h ? '<span class="h-badge">18+</span>' : ''}
    </div>
    <div class="scard-body">
      <div class="scard-title">${item.title}</div>
      <div class="scard-pills">
        <span class="scard-pill">${item.episodes} eps</span>
        <span class="scard-pill">${item.readTime}</span>
        <span class="scard-pill">${item.date ? item.date.slice(0, 4) : ''}</span>
      </div>
      <div class="fav-watch-btns">
        <button class="ws-btn${ws === 'Viendo' ? ' active' : ''}" data-ws="Viendo" data-ws-item="${item.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Viendo</button>
        <button class="ws-btn${ws === 'Completado' ? ' active' : ''}" data-ws="Completado" data-ws-item="${item.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Completado</button>
        <button class="ws-btn${ws === 'Pendiente' ? ' active' : ''}" data-ws="Pendiente" data-ws-item="${item.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Pendiente</button>
      </div>
    </div>
    <button class="mylist-remove-btn" data-remove="${item.id}" aria-label="Eliminar de Mi Lista">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    </button>
  </div>`;
    }

    function renderFavorites() {
        const grid = $('fav-grid');
        const empty = $('fav-empty');
        const countEl = $('mylist-count');

        let items = visibleDATA().filter(d => isFav(d.id) || getWatchStatus(d.id));

        const filter = state.favFilter;
        if (filter === 'fav') {
            items = items.filter(d => isFav(d.id));
        } else if (filter === 'Viendo' || filter === 'Completado' || filter === 'Pendiente') {
            items = items.filter(d => getWatchStatus(d.id) === filter);
        }

        if (countEl) countEl.textContent = items.length ? `${items.length} serie${items.length !== 1 ? 's' : ''}` : '';

        if (!items.length) {
            grid.innerHTML = '';
            empty.style.display = 'flex';
        } else {
            empty.style.display = 'none';
            // Usa el nuevo renderizado directo (sin lazy loading)
            grid.innerHTML = items.map((d, i) => myListCardHTML(d, i)).join('');
            
            // Apply staggered animations
            requestAnimationFrame(() => {
                applyStaggeredAnimations(grid, '.mylist-card');
            });
        }
    }

    function renderProfile() {
        const favCount = favs.length;
        const badge = $('fav-badge-profile');
        if (badge) badge.textContent = favCount;

        const visibleCategories = hCatEnabled
            ? CATS_CFG.map(c => c.name)
            : CATS_CFG.filter(c => !c.isH).map(c => c.name);

        const stats = $('profile-stats');
        if (stats) {
            stats.innerHTML = `
                <div class="stat-item"><div class="stat-num">${visibleDATA().length}</div><div class="stat-label">Animes</div></div>
                <div class="stat-item"><div class="stat-num">${favCount}</div><div class="stat-label">Favoritos</div></div>
                <div class="stat-item"><div class="stat-num">${visibleCategories.length}</div><div class="stat-label">Géneros</div></div>
            `;
        }
        const pill = $('h-toggle-pill');
        if (pill) pill.classList.toggle('active', hCatEnabled);

        const apPill = $('autoplay-toggle-pill');
        if (apPill) apPill.classList.toggle('active', autoplayEnabled);

        // Auto-watched active by default internally
        localStorage.setItem('auto_watched', '1');

        const langSel = $('preferred-lang-select');
        if (langSel) {
            const saved = localStorage.getItem('preferred_lang');
            if (!saved) {
                localStorage.setItem('preferred_lang', 'Latino');
                langSel.value = 'Latino';
            } else {
                langSel.value = saved;
            }
        }

        const versionEl = $('profile-version');
        if (versionEl) versionEl.textContent = CFG.version || '1.0.0';

        const reqBtn = $('request-content-btn');
        const reqGrp = $('request-content-group');
        if (reqBtn) {
            if (CFG.requestContentUrl) {
                if (reqGrp) reqGrp.style.display = 'block';
                reqBtn.style.display = '';
                reqBtn.onclick = () => location.href = CFG.requestContentUrl;
            } else {
                if (reqGrp) reqGrp.style.display = 'none';
                reqBtn.style.display = 'none';
            }
        }
    }

    function renderAboutInfo() {
        const appName = CFG.appName || 'WolfAnime';
        const version = CFG.version || '1.0.0';

        const titleEl = $('info-app-name');
        const versionEl = $('info-app-version');
        const descEl = $('info-description');
        const iconEl = $('info-app-icon');
        const featuresEl = $('info-features-list');
        const versionTextEl = $('info-version-text');
        const developerTextEl = $('info-developer-text');

        if (titleEl) titleEl.textContent = appName;
        if (versionEl) versionEl.textContent = `v${version}`;
        if (versionTextEl) versionTextEl.textContent = version;
        if (developerTextEl) developerTextEl.textContent = CFG.developerName || 'WolfAnime Team';
        if (descEl) descEl.textContent = CFG.aboutDescription || `${appName} es tu plataforma personal para descubrir y seguir el anime que más te gusta.`;

        if (iconEl) {
            if (CFG.aboutLogoUrl) {
                iconEl.innerHTML = `<img src="${CFG.aboutLogoUrl}" alt="${appName}" style="height:36px;object-fit:contain">`;
                iconEl.style.background = 'none';
            } else {
                iconEl.innerHTML = `<span style="font-size:24px;font-weight:900;background:linear-gradient(90deg,var(--accent),#69ffb4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${appName.charAt(0)}</span>`;
            }
        }

        if (featuresEl && CFG.aboutFeatures && CFG.aboutFeatures.length) {
            featuresEl.innerHTML = CFG.aboutFeatures.map(f =>
                `<div class="about-feature">${f.icon || `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`}<span>${f.text || f}</span></div>`
            ).join('');
        }
    }

    // Detail view removed - cards navigate directly to series URL

    function navigateTo(view, back = false) {
        if (view === 'featured-all') {
            state.filterType = 'featured';
            view = 'all-library';
        } else if (view === 'airing-all') {
            state.filterType = 'airing';
            view = 'all-library';
        } else if (view === 'all-library') {
            state.filterType = null;
        }
        const views = document.querySelectorAll('.view');
        const current = state.view ? document.getElementById('view-' + state.view) : null;
        const next = document.getElementById('view-' + view);
        if (!next || (state.view === view && next.classList.contains('active'))) return;

        if (current) {
            current.classList.remove('active');
            current.classList.add('slide-left');
            setTimeout(() => { current.classList.remove('slide-left'); }, 350);
        }

        if (state.view) {
            const oldView = document.getElementById(`view-${state.view}`);
            if (oldView) viewScrolls[state.view] = oldView.scrollTop;
        }

        state.prev = state.view;
        state.view = view;
        next.classList.add('active');

        if (viewScrolls[view] !== undefined) {
            next.scrollTop = viewScrolls[view];
        } else {
            next.scrollTop = 0;
        }

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === view || (view === 'cat-library' && b.dataset.nav === 'categories') || (view === 'all-library' && b.dataset.nav === 'home')));

        if (view === 'settings-info') renderAboutInfo();
        if (view === 'settings-data') updateSearchHistoryCountLabel();

        const header = document.getElementById('header');
        const main = document.getElementById('main');
        const isFullscreenView = ['search', 'search-history', 'categories', 'cat-library', 'all-library', 'detail', 'favorites'].includes(view) || view.startsWith('settings');

        if (isFullscreenView) {
            header.style.display = 'none';
            main.style.marginTop = '0';
        } else {
            header.style.display = '';
            main.style.marginTop = '';
        }

        if (view === 'home' && state.prev !== null) renderHomeFavs();
        if (view === 'search') { renderSearch($('search-input').value); updateSearchHistoryCountLabel(); }
        if (view === 'search-history') renderSearchHistory();
        if (view === 'categories') renderCategories();
        if (view === 'all-library') renderAllLibrary();
        if (view === 'favorites') renderFavorites();
        if (view === 'profile') {
            renderProfile();
            const pb = document.getElementById('profile-banner');
            if (pb) forceLoadImage(pb);
        }

        setTimeout(() => unstickImagesInView(document.getElementById(`view-${view}`)), 50);
        setTimeout(() => unstickImagesInView(document.getElementById(`view-${view}`)), 300);

        const params = { view: view };
        if (view === 'search' && $('search-input')?.value) params.q = $('search-input').value;
        if (view === 'cat-library') params.cat = state.catFilter;
        if (view === 'detail' && state.detail) params.id = state.detail.id;
        updateURL(params);
    }
    window.navigateTo = navigateTo;

    function openDetail(id) {
        // Detail view removed - navigate directly to series URL
        const item = DATA.find(d => d.id === id);
        if (item && item.url) location.href = item.url;
    }
    window.openDetail = openDetail;

    // ── Modal Mi Lista ──────────────────────────────────────────
    let modalItemId = null;
    let modalPendingStatus = undefined;
    let modalPendingCat = undefined;

    // ── Categoría persistente por serie ─────────────────────────
    const MYLIST_CAT_KEY = 'mylist_categories_v1';
    let mylistCategories = {};

    function loadMyListCategories() {
        try {
            const raw = localStorage.getItem(MYLIST_CAT_KEY);
            mylistCategories = raw ? JSON.parse(raw) : {};
        } catch { mylistCategories = {}; }
    }
    function saveMyListCategories() {
        localStorage.setItem(MYLIST_CAT_KEY, JSON.stringify(mylistCategories));
    }
    function getMyListCat(id) { return mylistCategories[id] || null; }
    function setMyListCat(id, cat) {
        if (cat) mylistCategories[id] = cat;
        else delete mylistCategories[id];
        saveMyListCategories();
    }

    function openMyListModal(id) {
        const item = DATA.find(d => d.id === id);
        if (!item) return;
        modalItemId = id;
        modalPendingStatus = undefined;
        modalPendingCat = undefined;

        document.getElementById('modal-poster').style.background = posterBg(item);
        document.getElementById('modal-title').textContent = item.title;

        // Renderizar opciones de categoría dinámicamente
        const catContainer = document.getElementById('modal-cat-options');
        if (catContainer) {
            const cats = CATEGORIES.length ? CATEGORIES : [];
            const currentCat = getMyListCat(id);
            catContainer.innerHTML = cats.map(cat => {
                const isActive = currentCat === cat;
                const iconHtml = CAT_ICONS_MAP[cat] || `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
                return `<label class="modal-opt${isActive ? ' active' : ''}" data-modal-cat="${cat}">
                    <span class="modal-opt-icon">${iconHtml}</span>
                    <span class="modal-opt-label">${cat}</span>
                    <span class="modal-radio${isActive ? ' checked' : ''}" id="modal-cat-check-${cat.replace(/\s+/g,'-')}"/>
                </label>`;
            }).join('');
        }

        updateModalChecks();

        const overlay = $('mylist-modal-overlay');
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
    }

    function updateModalChecks() {
        const ws = modalPendingStatus !== undefined ? modalPendingStatus : getWatchStatus(modalItemId);
        const keys = ['Viendo', 'Completado', 'Pendiente'];
        keys.forEach(key => {
            const btn = document.querySelector(`[data-modal-ws="${key}"]`);
            const radio = document.getElementById(`modal-check-${key}`);
            if (!btn || !radio) return;
            const active = ws === key;
            btn.classList.toggle('active', active);
            radio.classList.toggle('checked', active);
        });
        const saved = getWatchStatus(modalItemId);
        const confirmBtn = $('modal-confirm-btn');
        if (confirmBtn) {
            const hasChange = modalPendingStatus !== undefined && modalPendingStatus !== saved;
            confirmBtn.disabled = !hasChange;
        }
    }

    function closeMyListModal() {
        const overlay = $('mylist-modal-overlay');
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        if (state.view === 'favorites') renderFavorites();
        if (state.view === 'home') renderHome();
        if (state.view === 'search') renderSearch($('search-input').value);
        renderProfile();

        if (state.view === 'detail' && state.detail) {
            const btn = document.getElementById('detail-mylist-btn');
            if (btn) {
                const ws = getWatchStatus(state.detail.id);
                const statusIcons = { Viendo: '▶', Completado: '✓', Pendiente: '⏳' };
                btn.classList.toggle('in-list', !!ws);
                btn.innerHTML = ws
                    ? `${statusIcons[ws] || ''} ${ws}`
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Añadir a Mi Lista`;
            }
        }
        modalItemId = null;
        modalPendingStatus = undefined;
        modalPendingCat = undefined;
    }

    $('mylist-modal-overlay').addEventListener('click', e => {
        if (e.target === $('mylist-modal-overlay')) closeMyListModal();
    });
    $('modal-close-btn').addEventListener('click', closeMyListModal);

    document.getElementById('mylist-modal').addEventListener('click', e => {
        const opt = e.target.closest('[data-modal-ws]');
        if (!opt || modalItemId === null) return;
        const key = opt.dataset.modalWs;
        const saved = getWatchStatus(modalItemId);
        const current = modalPendingStatus !== undefined ? modalPendingStatus : saved;
        modalPendingStatus = current === key ? null : key;
        updateModalChecks();
    });

    // Click handler para categorías en el modal
    document.getElementById('mylist-modal').addEventListener('click', e => {
        const catOpt = e.target.closest('[data-modal-cat]');
        if (!catOpt || modalItemId === null) return;
        const cat = catOpt.dataset.modalCat;
        const currentCat = modalPendingCat !== undefined ? modalPendingCat : getMyListCat(modalItemId);
        modalPendingCat = currentCat === cat ? null : cat;
        // Actualizar UI de categorías
        document.querySelectorAll('#modal-cat-options .modal-opt').forEach(el => {
            const c = el.dataset.modalCat;
            const isActive = c === modalPendingCat;
            el.classList.toggle('active', isActive);
            const radio = el.querySelector('.modal-radio');
            if (radio) radio.classList.toggle('checked', isActive);
        });
    });

    $('modal-confirm-btn').addEventListener('click', () => {
        if (modalItemId === null || modalPendingStatus === undefined) return;
        setWatchStatus(modalItemId, modalPendingStatus || null);
        // Guardar categoría si se seleccionó
        if (modalPendingCat !== undefined) {
            setMyListCat(modalItemId, modalPendingCat || null);
        }
        closeMyListModal();
    });


    function renderFilterChips() {
        const chips = $('filter-chips');
        if (!chips) return;
        // Filter chips ya no se usan en búsqueda, solo se renderiza vacío
        chips.innerHTML = '';
    }

    // ── Modal Confirmar Eliminación ──
    let _removeTargetId = null;
    let _removeSelFav = false;
    let _removeSelWs = false;

    function _updateRemoveAcceptBtn() {
        const btn = document.getElementById('remove-confirm-accept');
        if (btn) btn.disabled = !_removeSelFav && !_removeSelWs;
    }

    function openRemoveConfirm(id) {
        const item = DATA.find(d => d.id === id);
        if (!item) return;
        _removeTargetId = id;
        const hasFav = isFav(id);
        const hasWs = !!getWatchStatus(id);
        const filter = state.favFilter;

        const desc = document.getElementById('remove-confirm-desc');
        if (desc) desc.textContent = item.title;

        const title = document.querySelector('.remove-confirm-title');
        const optFav = document.getElementById('remove-opt-fav');
        const optWs = document.getElementById('remove-opt-ws');
        const wsLabel = document.getElementById('remove-opt-ws-label');
        const acceptBtn = document.getElementById('remove-confirm-accept');
        const options = document.getElementById('remove-confirm-options');

        const tabNames = { fav: 'Favoritos', Viendo: 'Viendo', Completado: 'Completado', Pendiente: 'Pendiente' };

        if (filter !== 'all') {
            if (title) title.textContent = `¿Eliminar de ${tabNames[filter] || filter}?`;
            if (options) options.style.display = 'none';
            if (acceptBtn) { acceptBtn.textContent = 'Eliminar'; acceptBtn.disabled = false; }
            _removeSelFav = filter === 'fav';
            _removeSelWs = filter !== 'fav';
        } else {
            if (title) title.textContent = '¿Qué deseas eliminar?';
            if (options) options.style.display = '';
            if (optFav) optFav.style.display = hasFav ? '' : 'none';
            if (optWs) optWs.style.display = hasWs ? '' : 'none';
            if (wsLabel && hasWs) wsLabel.textContent = `Quitar estado "${getWatchStatus(id)}"`;
            _removeSelFav = hasFav;
            _removeSelWs = hasWs;
            const chkFav = document.getElementById('remove-chk-fav');
            const chkWs = document.getElementById('remove-chk-ws');
            if (chkFav) chkFav.classList.toggle('checked', _removeSelFav);
            if (chkWs) chkWs.classList.toggle('checked', _removeSelWs);
            if (acceptBtn) acceptBtn.textContent = 'Eliminar';
            _updateRemoveAcceptBtn();
        }

        const o = document.getElementById('remove-confirm-overlay');
        o.classList.add('open');
        o.setAttribute('aria-hidden', 'false');
    }

    function closeRemoveConfirm() {
        const o = document.getElementById('remove-confirm-overlay');
        o.classList.remove('open');
        o.setAttribute('aria-hidden', 'true');
        _removeTargetId = null;
        _removeSelFav = false;
        _removeSelWs = false;
    }

    // ── CW Remove Confirmation Modal ──
    let _cwRemoveData = null;

    function openCWRemoveConfirm(serieId, metaKey, resumeKey, title) {
        _cwRemoveData = { serieId, metaKey, resumeKey };
        const desc = document.getElementById('cw-remove-desc');
        if (desc) desc.textContent = title || 'Este contenido';
        const o = document.getElementById('cw-remove-overlay');
        if (o) {
            o.classList.add('open');
            o.setAttribute('aria-hidden', 'false');
        }
    }

    function closeCWRemoveConfirm() {
        const o = document.getElementById('cw-remove-overlay');
        if (o) {
            o.classList.remove('open');
            o.setAttribute('aria-hidden', 'true');
        }
        _cwRemoveData = null;
    }

    function executeCWRemove() {
        if (!_cwRemoveData) return;
        const { metaKey, resumeKey } = _cwRemoveData;
        localStorage.removeItem(metaKey);
        if (resumeKey) localStorage.removeItem(resumeKey);
        closeCWRemoveConfirm();
        renderContinueWatching();
    }

    document.addEventListener('click', e => {
        const heroBtn = e.target.closest('[data-hero-nav]');
        if (heroBtn) { navigateTo(heroBtn.dataset.heroNav); return; }

        const navBtn = e.target.closest('.nav-btn');
        if (navBtn) { navigateTo(navBtn.dataset.nav); return; }

        const seeAll = e.target.closest('.see-all');
        if (seeAll) {
            navigateTo(seeAll.dataset.nav);
            return;
        }

        const mylistBtn = e.target.closest('[data-mylist]');
        if (mylistBtn) {
            e.stopPropagation();
            openMyListModal(+mylistBtn.dataset.mylist);
            return;
        }

        const favBtn = e.target.closest('[data-fav]');
        if (favBtn) {
            e.stopPropagation();
            const id = +favBtn.dataset.fav;
            toggleFav(id);
            const active = isFav(id);
            favBtn.classList.toggle('active', active);
            favBtn.querySelector('svg').setAttribute('fill', active ? 'currentColor' : 'none');
            if (state.view === 'favorites') renderFavorites();
            renderProfile();
            return;
        }

        const removeBtn = e.target.closest('[data-remove]');
        if (removeBtn) {
            e.stopPropagation();
            openRemoveConfirm(+removeBtn.dataset.remove);
            return;
        }

        const ctaBtn = e.target.closest('[data-cta]');
        if (ctaBtn) {
            e.stopPropagation();
            const item = DATA.find(d => d.id === +ctaBtn.dataset.cta);
            if (item && item.url) { location.href = item.url; }
            return;
        }

        const card = e.target.closest('.card, .slider-card, .mini-card, .recent-card, .scard');
        if (card && card.dataset.id) {
            const item = DATA.find(d => d.id === +card.dataset.id);
            if (item && item.url) { location.href = item.url; }
            return;
        }

        const catCard = e.target.closest('.cat-card');
        if (catCard) {
            state.catFilter = catCard.dataset.cat;
            renderCatLibrary(state.catFilter);
            navigateTo('cat-library');
            return;
        }

        // NOTA: Los chips de categoría en búsqueda han sido eliminados

        const favChip = e.target.closest('[data-fav-filter]');
        if (favChip) {
            state.favFilter = favChip.dataset.favFilter || 'all';
            document.querySelectorAll('[data-fav-filter]').forEach(c => c.classList.toggle('active', c.dataset.favFilter === favChip.dataset.favFilter));
            renderFavorites();
            return;
        }

        const wsBtn = e.target.closest('[data-ws]');
        if (wsBtn) {
            e.stopPropagation();
            const id = +wsBtn.dataset.wsItem;
            const newStatus = wsBtn.dataset.ws;
            const current = getWatchStatus(id);
            setWatchStatus(id, current === newStatus ? null : newStatus);
            renderFavorites();
            renderProfile();
            return;
        }

        const dot = e.target.closest('[data-dot]');
        if (dot) {
            const idx = +dot.dataset.dot;
            const track = $('slider-track');
            if (track._sliderGoTo) track._sliderGoTo(idx);
            return;
        }

        const tag = e.target.closest('.tag');
        if (tag && !tag.classList.contains('tag-show-more')) {
            const q = tag.textContent.trim();
            const input = $('search-input');
            const clear = $('search-clear');
            if (input) input.value = q;
            if (clear) clear.classList.add('visible');
            renderSearch(q);
            navigateTo('search');
            return;
        }
    });

    function init() {
        buildSearchCache(); // Construir caché de búsqueda
        loadMyListCategories(); // Cargar categorías de Mi Lista

        function handleWelcomeClose() {
            const cb = $('welcome-dont-show-cb');
            if (cb && cb.checked) {
                localStorage.setItem('wolfanime_welcome_seen_v1', '1');
            } else {
                localStorage.removeItem('wolfanime_welcome_seen_v1');
            }
            closeModal('welcome-modal-overlay');
        }

        if (!localStorage.getItem('wolfanime_welcome_seen_v1')) {
            openModal('welcome-modal-overlay');
        }

        const welcomeLogoContainer = document.getElementById('welcome-logo-container');
        if (welcomeLogoContainer) {
            if (CFG.aboutLogoUrl) {
                welcomeLogoContainer.innerHTML = `<img src="${CFG.aboutLogoUrl}" alt="${CFG.appName}" style="height:48px;max-width:100%;object-fit:contain">`;
                welcomeLogoContainer.style.background = 'none';
                welcomeLogoContainer.style.boxShadow = 'none';
            } else {
                const initial = CFG.appName ? CFG.appName.charAt(0).toUpperCase() : 'W';
                welcomeLogoContainer.innerHTML = `<span id="welcome-logo-icon" style="font-size: 36px; padding-bottom: 2px; color: #000; font-weight: 800;">${initial}</span>`;
            }
        }

        // Nuestras Apps Modal (Render dinámico y scrollable)
        function renderProjectsModal() {
            const projectsContainer = document.getElementById('projects-list-container');
            if (projectsContainer && CFG.ourApps && Array.isArray(CFG.ourApps)) {
                if (CFG.ourApps.length === 0) {
                    projectsContainer.innerHTML = '<p style="text-align:center;color:var(--text3);font-size:13px;padding:24px 0;">No hay apps configuradas.</p>';
                    return;
                }
                projectsContainer.innerHTML = CFG.ourApps.map(app => `
                    <div class="project-item" style="padding:14px 14px 12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; transition: transform 0.2s ease;">
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:${app.description ? '8px' : '0'};">
                            <div style="width:42px; height:42px; border-radius:10px; overflow:hidden; flex-shrink:0; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center;">
                                <img src="${app.logo || ''}" alt="${app.name}" style="width:100%; height:100%; object-fit:contain;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22white%22 stroke-width=%222%22><rect x=%223%22 y=%223%22 width=%2218%22 height=%2218%22 rx=%222%22/><path d=%22M9 12l2 2 4-4%22/></svg>'">
                            </div>
                            <div style="font-size:15px; font-weight:700; flex:1; color:var(--text);">${app.name}</div>
                            <button style="background:var(--accent); border:none; padding:8px 16px; border-radius:20px; color:#000; font-size:12px; font-weight:800; cursor:pointer; flex-shrink:0; transition: transform 0.2s;" onclick="window.open('${app.url}', '_blank')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">Descargar</button>
                        </div>
                        ${app.description ? `<p style="margin:0; font-size:13px; color:var(--text2); line-height:1.55; word-break:break-word;">${app.description}</p>` : ''}
                    </div>
                `).join('');
            }
        }
        renderProjectsModal();

        const btnWelcomeStart = $('welcome-start-btn');
        if (btnWelcomeStart) btnWelcomeStart.addEventListener('click', handleWelcomeClose);

        const btnWelcomeClose = $('welcome-close-btn');
        if (btnWelcomeClose) btnWelcomeClose.addEventListener('click', handleWelcomeClose);

        const btnWelcomeProjects = $('welcome-projects-btn');
        if (btnWelcomeProjects) {
            btnWelcomeProjects.addEventListener('click', () => {
                handleWelcomeClose();
                openModal('projects-modal-overlay');
            });
        }

        const btnProjectsBack = $('projects-back-btn');
        if (btnProjectsBack) {
            btnProjectsBack.addEventListener('click', () => {
                closeModal('projects-modal-overlay');
                openModal('welcome-modal-overlay');
            });
        }

        renderHome();
        renderSearch();
        renderCategories();
        renderFavorites();
        renderProfile();
        renderSearchHistory();

        if (!handleURLParams()) {
            navigateTo('home');
            // renderHome() already called above, so renderHomeFavs() inside navigateTo('home') would duplicate favorites
            // We handle this by checking if renderHomeFavs was already called
        }

        document.getElementById('cat-library-back').addEventListener('click', () => navigateTo('categories', true));
        document.getElementById('all-library-back').addEventListener('click', () => navigateTo('home', true));

        const historyBtn = $('search-history-btn');
        if (historyBtn) {
            historyBtn.addEventListener('click', () => {
                navigateTo('search-history');
            });
        }

        // ── Buscador ──
        const searchInputEl = $('search-input');
        const searchClearEl = $('search-clear');

        if (searchInputEl && searchClearEl) {
            searchInputEl.setAttribute('type', 'text');
            searchInputEl.addEventListener('search', (e) => e.preventDefault());

            searchInputEl.addEventListener('input', debounce(e => {
                const q = e.target.value;
                searchClearEl.classList.toggle('visible', q.length > 0);

                renderSearch(q);
                if (state.view === 'search-history') navigateTo('search');
                if (state.view === 'search') {
                    updateURL({ view: 'search', q: q });
                }
            }, 300));

            searchInputEl.addEventListener('blur', () => {
                const q = searchInputEl.value.trim();
                if (q.length >= 2) addToSearchHistory(q);
            });

            searchInputEl.addEventListener('focus', () => {
                if (!searchInputEl.value.trim()) renderSearchHistory();
            });

            searchClearEl.addEventListener('click', () => {
                searchInputEl.value = '';
                searchClearEl.classList.remove('visible');
                renderSearch('');
                renderSearchHistory();
                if (state.view === 'search') {
                    updateURL({ view: 'search', q: '' });
                }
                searchInputEl.focus();
            });
        }

        const clearHistoryDedicated = $('search-history-clear-dedicated');
        if (clearHistoryDedicated) {
            clearHistoryDedicated.addEventListener('click', () => {
                if (searchHistory.length === 0) return;
                openHistoryClearModal();
            });
        }

        const hClearCancel = $('history-clear-cancel');
        if (hClearCancel) hClearCancel.addEventListener('click', closeHistoryClearModal);

        const hClearConfirm = $('history-clear-confirm');
        if (hClearConfirm) hClearConfirm.addEventListener('click', clearSearchHistory);

        const hClearOverlay = $('history-clear-confirm-overlay');
        if (hClearOverlay) {
            hClearOverlay.addEventListener('click', (e) => {
                if (e.target === hClearOverlay) closeHistoryClearModal();
            });
        }

        const hSingleCancel = $('history-single-cancel');
        if (hSingleCancel) hSingleCancel.addEventListener('click', closeSingleHistoryDeleteModal);

        const hSingleConfirm = $('history-single-confirm');
        if (hSingleConfirm) {
            hSingleConfirm.addEventListener('click', () => {
                if (_pendingHistoryDeleteQuery) {
                    removeFromSearchHistory(_pendingHistoryDeleteQuery);
                    closeSingleHistoryDeleteModal();
                }
            });
        }

        const hSingleOverlay = $('history-single-confirm-overlay');
        if (hSingleOverlay) {
            hSingleOverlay.addEventListener('click', (e) => {
                if (e.target === hSingleOverlay) closeSingleHistoryDeleteModal();
            });
        }

        function applyHToggle() {
            saveHEnabled();
            renderProfile();
            renderCategories();
            renderHome();
            renderSearch($('search-input').value);
            renderFavorites();
            if (!hCatEnabled && state.view === 'cat-library' && state.catFilter === 'H') {
                navigateTo('categories', true);
            }
            if (state.view === 'all-library') renderAllLibrary();
        }

        document.getElementById('h-toggle-item').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            if (hCatEnabled) {
                hCatEnabled = false;
                applyHToggle();
            } else {
                const o = $('h-confirm-overlay');
                o.classList.add('open');
                o.setAttribute('aria-hidden', 'false');
            }

            return false;
        });

        document.getElementById('h-confirm-accept').addEventListener('click', () => {
            hCatEnabled = true;
            const o = $('h-confirm-overlay');
            o.classList.remove('open');
            o.setAttribute('aria-hidden', 'true');
            applyHToggle();
        });

        document.getElementById('h-confirm-cancel').addEventListener('click', () => {
            const o = $('h-confirm-overlay');
            o.classList.remove('open');
            o.setAttribute('aria-hidden', 'true');
        });

        $('h-confirm-overlay').addEventListener('click', e => {
            if (e.target === $('h-confirm-overlay')) {
                $('h-confirm-overlay').classList.remove('open');
                $('h-confirm-overlay').setAttribute('aria-hidden', 'true');
            }
        });

        const autoplayToggle = document.getElementById('autoplay-toggle-item');
        if (autoplayToggle) {
            autoplayToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                const actionText = autoplayEnabled ? 'Desactivar' : 'Activar';
                const descText = autoplayEnabled 
                    ? 'Si desactivas esta opción, el siguiente episodio no se reproducirá automáticamente al terminar el actual.'
                    : 'Si activas esta opción, el siguiente episodio se reproducirá automáticamente sin pausas al finalizar el actual.';
                
                const actionSpan = document.getElementById('autoplay-modal-action-text');
                const descP = document.getElementById('autoplay-modal-desc-text');
                if (actionSpan) actionSpan.textContent = actionText;
                if (descP) descP.textContent = descText;
                
                const o = document.getElementById('autoplay-confirm-overlay');
                if (o) {
                    o.classList.add('open');
                    o.setAttribute('aria-hidden', 'false');
                }
            });
        }

        const apAcceptBtn = document.getElementById('autoplay-confirm-accept');
        if (apAcceptBtn) {
            apAcceptBtn.addEventListener('click', () => {
                autoplayEnabled = !autoplayEnabled;
                saveAutoplayEnabled();
                renderProfile();
                showToast(autoplayEnabled ? 'Autoplay activado' : 'Autoplay desactivado');
                const o = document.getElementById('autoplay-confirm-overlay');
                if (o) {
                    o.classList.remove('open');
                    o.setAttribute('aria-hidden', 'true');
                }
            });
        }

        const apCancelBtn = document.getElementById('autoplay-confirm-cancel');
        if (apCancelBtn) {
            apCancelBtn.addEventListener('click', () => {
                const o = document.getElementById('autoplay-confirm-overlay');
                if (o) {
                    o.classList.remove('open');
                    o.setAttribute('aria-hidden', 'true');
                }
            });
        }

        const apOverlay = document.getElementById('autoplay-confirm-overlay');
        if (apOverlay) {
            apOverlay.addEventListener('click', (e) => {
                if (e.target === apOverlay) {
                    apOverlay.classList.remove('open');
                    apOverlay.setAttribute('aria-hidden', 'true');
                }
            });
        }

        $('remove-confirm-cancel').addEventListener('click', closeRemoveConfirm);
        $('remove-confirm-overlay').addEventListener('click', e => {
            if (e.target === $('remove-confirm-overlay')) closeRemoveConfirm();
        });

        document.getElementById('remove-opt-fav').addEventListener('click', () => {
            _removeSelFav = !_removeSelFav;
            document.getElementById('remove-chk-fav').classList.toggle('checked', _removeSelFav);
            _updateRemoveAcceptBtn();
        });
        document.getElementById('remove-opt-ws').addEventListener('click', () => {
            _removeSelWs = !_removeSelWs;
            document.getElementById('remove-chk-ws').classList.toggle('checked', _removeSelWs);
            _updateRemoveAcceptBtn();
        });

        $('remove-confirm-accept').addEventListener('click', () => {
            if (_removeTargetId === null) return;
            if (_removeSelFav) {
                favs = favs.filter(f => f !== _removeTargetId);
                saveFavs();
            }
            if (_removeSelWs) {
                delete watchStatus[_removeTargetId];
                saveWatchStatus();
            }
            closeRemoveConfirm();
            renderFavorites();
            renderProfile();
        });

        // CW Remove modal listeners
        $('cw-remove-cancel').addEventListener('click', closeCWRemoveConfirm);
        $('cw-remove-overlay').addEventListener('click', e => {
            if (e.target === $('cw-remove-overlay')) closeCWRemoveConfirm();
        });
        $('cw-remove-accept').addEventListener('click', executeCWRemove);

        let hTaps = 0, hTimer;
        const catTitle = document.getElementById('cat-page-title');
        if (catTitle) {
            catTitle.addEventListener('click', () => {
                hTaps++;
                clearTimeout(hTimer);
                hTimer = setTimeout(() => { hTaps = 0; }, 1500);
                if (hTaps >= 5) {
                    hTaps = 0;
                    hCatEnabled = !hCatEnabled;
                    applyHToggle();
                }
            });
        }


        const langSelect = document.getElementById('preferred-lang-select');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                localStorage.setItem('preferred_lang', e.target.value);
            });
        }

        const clearFavsBtn = $('clear-favs-btn');
        if (clearFavsBtn) clearFavsBtn.addEventListener('click', clearFavorites);

        const clearWatchedBtn = $('clear-watched-btn');
        if (clearWatchedBtn) clearWatchedBtn.addEventListener('click', clearWatchHistory);

        const exportDataBtn = $('export-data-btn');
        if (exportDataBtn) exportDataBtn.addEventListener('click', exportUserData);

        const importDataBtn = $('import-data-btn');
        if (importDataBtn) importDataBtn.addEventListener('click', importUserData);

        const bkCreateBtn = $('backup-create-btn');
        if (bkCreateBtn) bkCreateBtn.addEventListener('click', generateTextBackup);

        const bkRestoreBtn = $('backup-restore-btn');
        if (bkRestoreBtn) bkRestoreBtn.addEventListener('click', () => openModal('restore-text-overlay'));

        const bkCloseBtn = $('backup-close-btn');
        if (bkCloseBtn) bkCloseBtn.addEventListener('click', () => closeModal('backup-text-overlay'));

        const rsCloseBtn = $('restore-close-btn');
        if (rsCloseBtn) rsCloseBtn.addEventListener('click', () => closeModal('restore-text-overlay'));

        const bkCopyBtn = $('backup-copy-btn');
        if (bkCopyBtn) {
            bkCopyBtn.addEventListener('click', () => {
                const area = $('backup-text-area');
                if (area) {
                    area.select();
                    document.execCommand('copy');
                    showToast('Copiado al portapapeles');
                }
            });
        }

        const rsSubmitBtn = $('restore-submit-btn');
        if (rsSubmitBtn) rsSubmitBtn.addEventListener('click', restoreFromTextBackup);

        const catGrid = $('cat-grid');
        if (catGrid) {
            catGrid.addEventListener('click', (e) => {
                const card = e.target.closest('.cat-card');
                if (card) {
                    const cat = card.dataset.cat;
                    navigateTo("cat-library", { cat });
                }
            });
        }

        const helpBtn = $("help-backup-btn");
        if (helpBtn) helpBtn.addEventListener("click", () => navigateTo("settings-help"));

        // Continuar Viendo Confirm Delete
        const cwDeleteCancel = $('cw-delete-cancel');
        if (cwDeleteCancel) cwDeleteCancel.addEventListener('click', () => closeModal('cw-delete-confirm-overlay'));

        const cwDeleteConfirm = $('cw-delete-confirm');
        if (cwDeleteConfirm) {
            cwDeleteConfirm.addEventListener('click', () => {
                if (!_pendingCWDeleteId) return;
                const id = _pendingCWDeleteId;

                // Clear metadata
                localStorage.removeItem('wa_cw_meta_' + id);

                // Clear related resume keys
                const allKeys = Object.keys(localStorage);
                allKeys.forEach(k => {
                    if (k.startsWith('wa_resume_' + id + '_')) {
                        localStorage.removeItem(k);
                    }
                });

                closeModal('cw-delete-confirm-overlay');
                _pendingCWDeleteId = null;
                showToast('Eliminado de Continuar Viendo');
            });
        }

        ["backup-text-overlay", "restore-text-overlay", "h-confirm-overlay", "cw-delete-confirm-overlay"].forEach(id => {
            const o = $(id);
            if (o) o.addEventListener("click", e => { if (e.target === o) closeModal(id); });
        });

        setTimeout(observeImages, 300);
    }

    init();
})();
