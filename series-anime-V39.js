// ═══════════════════════════════════════════════════════════
// SISTEMA INTEGRADO DE SERIES CON REPRODUCTOR
// ═══════════════════════════════════════════════════════════

const WATCHED_KEY = 'wa_watched_' + SERIE.id;
let activeSeason = 0;
let currentEpisode = null;
let activeLang = 0;
let activeServer = 0;
let hlsInstance = null;
let wolfInstance = null;
let renderCount = 0;
let resumeToastShown = false;

const GLOBAL_IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// ── Utilidades ────────────────────────────────────────────
const $ = id => document.getElementById(id);

function getWatchedMap() {
    return JSON.parse(localStorage.getItem(WATCHED_KEY) || '{}');
}

const isWatched = (map, s, e) => !!(map.seasons?.[s]?.[e]);

const setWatched = (s, e, val) => {
    let map = getWatchedMap();
    if (!map.seasons) map.seasons = {};
    if (!map.seasons[s]) map.seasons[s] = {};
    if (val) map.seasons[s][e] = true;
    else delete map.seasons[s][e];
    localStorage.setItem(WATCHED_KEY, JSON.stringify(map));
};

function fmtTime(s) {
    s = Math.floor(s || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + ss;
    return m + ':' + ss;
}

// ── Progreso / continuar viendo ───────────────────────────
function resumeKey() {
    if (!currentEpisode || !currentEpisode.langs || !currentEpisode.langs[activeLang]) return null;
    const langName = currentEpisode.langs[activeLang].name;
    return 'wa_resume_' + SERIE.id + '_s' + activeSeason + '_e' + currentEpisode.num + '_' + langName;
}

function updateCWMetadata(currentTime, duration) {
    if (!currentEpisode) return;
    try {
        const metaKey = 'wa_cw_meta_' + SERIE.id;
        const langName = (currentEpisode.langs && currentEpisode.langs[activeLang]) ? currentEpisode.langs[activeLang].name : '';
        const ep = currentEpisode;
        const season = SERIE.seasons[activeSeason];
        const key = resumeKey();

        const isH = (SERIE.tags || []).some(t => t.trim().toLowerCase() === 'h');

        const meta = {
            serieId: SERIE.id,
            serieTitle: SERIE.title,
            poster: ep.thumb || SERIE.poster || SERIE.image || '',
            serieUrl: SERIE.urlContinue || '',
            seasonIdx: activeSeason,
            seasonLabel: season ? (season.label || ('Temporada ' + season.num)) : '',
            epNum: ep.num,
            epTitle: ep.title || '',
            epType: ep.type || 'episode',
            lang: langName,
            resumeKey: key,
            currentTime: Math.floor(currentTime || 0),
            duration: Math.floor(duration || 0),
            progress: duration ? Math.min(100, Math.round((currentTime / duration) * 100)) : 0,
            isH: isH,
            updatedAt: Date.now()
        };
        localStorage.setItem(metaKey, JSON.stringify(meta));
    } catch (e) { }
}

function saveProgress(currentTime, duration) {
    const key = resumeKey();
    if (!key || !duration || currentTime < 5) return;
    if (currentTime / duration > 0.95) {
        localStorage.removeItem(key);
        // Remove CW metadata if this was the active entry
        try {
            const metaKey = 'wa_cw_meta_' + SERIE.id;
            const existing = JSON.parse(localStorage.getItem(metaKey) || 'null');
            if (existing && existing.resumeKey === key) localStorage.removeItem(metaKey);
        } catch (e) { }
        return;
    }
    const time = Math.floor(currentTime);
    localStorage.setItem(key, String(time));

    // ── Save Continue Watching metadata for home page slider ──
    updateCWMetadata(currentTime, duration);
}

function getSavedTime() {
    const key = resumeKey();
    if (!key) return 0;
    const t = parseInt(localStorage.getItem(key) || '0', 10);
    return t > 5 ? t : 0;
}

function showResumeToast(savedTime, onResume, onDismiss) {
    if (resumeToastShown) return;
    resumeToastShown = true;

    const existing = $('vp-resume-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'vp-resume-overlay';
    overlay.innerHTML = `
      <div id="vp-resume-modal">
        <div class="vp-resume-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="vp-resume-title">Continuar viendo</div>
        <div class="vp-resume-sub">Quedaste en <strong>${fmtTime(savedTime)}</strong></div>
        <div class="vp-resume-btns">
          <button class="vp-resume-btn vp-resume-yes">Continuar</button>
          <button class="vp-resume-btn vp-resume-no">Desde el inicio</button>
        </div>
      </div>`;
    $('player-wrap').appendChild(overlay);

    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));

    const dismissTimer = setTimeout(() => dismiss(true), 10000);

    function dismiss(doResume) {
        clearTimeout(dismissTimer);
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 280);
        if (doResume) onResume();
        else onDismiss();
    }

    overlay.querySelector('.vp-resume-yes').addEventListener('click', () => dismiss(true));
    overlay.querySelector('.vp-resume-no').addEventListener('click', () => dismiss(false));
}

// ── Smart Play ────────────────────────────────────────────

/**
 * Retorna el target de reproducción inteligente.
 *
 * La función es pura: no accede a `SERIE` ni a `localStorage` de forma global,
 * sino que recibe ambos como parámetros para facilitar el testing aislado.
 *
 * @param {Object} serie    - Objeto SERIE con la estructura { id, seasons[] }
 * @param {Object} storage  - Mapa clave→valor que representa el contenido del
 *                            localStorage relevante para la serie (puede ser el
 *                            objeto `localStorage` real o un mock en tests).
 *                            Se accede únicamente con `storage[key]` (lectura).
 * @returns {{ seasonIdx: number, epNum: number }}
 */
function getSmartPlayTarget(serie, storage) {
    // Fallback de seguridad: serie o temporadas no disponibles
    if (!serie || !serie.seasons || serie.seasons.length === 0) {
        return { seasonIdx: 0, epNum: 1 };
    }

    // Iterar en orden: temporada 0 → N, episodio primero → último
    for (let sIdx = 0; sIdx < serie.seasons.length; sIdx++) {
        const season = serie.seasons[sIdx];
        if (!season || !season.episodes) continue;

        for (let eIdx = 0; eIdx < season.episodes.length; eIdx++) {
            const ep = season.episodes[eIdx];
            if (!ep) continue;

            // Usar el nombre del primer idioma disponible (igual que el sistema de guardado)
            const langName = (ep.langs && ep.langs[0] && ep.langs[0].name) ? ep.langs[0].name : '';
            const key = 'wa_resume_' + serie.id + '_s' + sIdx + '_e' + ep.num + '_' + langName;

            // Leer el tiempo guardado con tolerancia a localStorage no disponible
            let saved = 0;
            try {
                saved = parseInt(storage[key] || '0', 10);
            } catch (e) {
                saved = 0;
            }

            if (saved > 5) {
                return { seasonIdx: sIdx, epNum: ep.num };
            }
        }
    }

    // Sin progreso → primer episodio de la primera temporada
    if (serie.seasons.length > 0 && serie.seasons[0].episodes && serie.seasons[0].episodes.length > 0) {
        return {
            seasonIdx: 0,
            epNum: serie.seasons[0].episodes[0].num
        };
    }
    
    // Fallback absoluto si la estructura está vacía
    return { seasonIdx: 0, epNum: 1 };
}

/**
 * Actualiza el texto e `aria-label` del Smart Play Button (#btn-reproducir-serie)
 * según el target obtenido por `getSmartPlayTarget()`.
 *
 * - Con progreso:  "Continuar · Ep X"  /  aria-label "Continuar reproducción del episodio X"
 * - Sin progreso:  "Reproducir"         /  aria-label "Reproducir primer episodio"
 */
function updateSmartPlayLabel() {
    const btn = document.getElementById('btn-reproducir-serie');
    if (!btn) return;

    const target = getSmartPlayTarget(SERIE, localStorage);

    // Comprobar si existe progreso real para cualquier episodio:
    //   a) el target no apunta al primer episodio de la primera temporada, o
    //   b) hay tiempo guardado para el primer episodio (target es el 1º pero con progreso)
    const firstEp = (SERIE.seasons && SERIE.seasons.length > 0 && SERIE.seasons[0].episodes && SERIE.seasons[0].episodes.length > 0)
        ? SERIE.seasons[0].episodes[0]
        : { num: 1, langs: [] };
    const hasProgressElsewhere = target.epNum !== firstEp.num || target.seasonIdx !== 0;

    const firstLangName = (firstEp.langs && firstEp.langs[0] && firstEp.langs[0].name)
        ? firstEp.langs[0].name : '';
    const firstEpKey = 'wa_resume_' + SERIE.id + '_s0_e' + firstEp.num + '_' + firstLangName;
    let firstEpSaved = 0;
    try {
        firstEpSaved = parseInt(localStorage.getItem(firstEpKey) || '0', 10);
    } catch (e) {
        firstEpSaved = 0;
    }
    const hasAnyProgress = hasProgressElsewhere || firstEpSaved > 5;

    const svgPlay = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="flex-shrink:0"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

    if (hasAnyProgress) {
        btn.innerHTML = svgPlay + `Continuar &middot; Ep ${target.epNum}`;
        btn.setAttribute('aria-label', `Continuar reproducción del episodio ${target.epNum}`);
    } else {
        btn.innerHTML = svgPlay + 'Reproducir';
        btn.setAttribute('aria-label', 'Reproducir primer episodio');
    }

    // Asignar (o reasignar) el listener de clic usando onclick para evitar duplicados
    btn.onclick = function () {
        playEpisode(target.seasonIdx, target.epNum);
    };
}

// ── Renderizado de temporadas y episodios ─────────────────
if (SERIE.seasons) {
    SERIE.seasons.sort((a, b) => (a.id || 0) - (b.id || 0));
}

const headerTitle = $('header-title');
if (headerTitle) headerTitle.textContent = SERIE.title;
document.title = SERIE.title;

// ── SeasonDropdown Component ──────────────────────────────
/**
 * Componente dropdown para seleccionar temporadas.
 *
 * @param {HTMLElement} container  - Elemento contenedor donde se renderiza (#embedded-seasons-container)
 * @param {Array}       seasons    - Array de objetos de temporada (SERIE.seasons)
 * @param {number}      activeSeason - Índice de la temporada actualmente activa
 * @param {Function}    onSeasonChange - Callback invocado con el nuevo índice al seleccionar
 */
class SeasonDropdown {
    constructor(container, seasons, activeSeason, onSeasonChange) {
        this.container      = container;
        this.seasons        = seasons;
        this.activeSeason   = activeSeason;
        this.onSeasonChange = onSeasonChange;
        this.isOpen         = false;

        // Referencias a elementos del DOM — se asignan en render()
        this._btn  = null;
        this._menu = null;

        // Listener de cierre al clickear fuera — se guarda para poder removerlo si es necesario
        this._outsideClickHandler = null;
    }

    /**
     * Genera el HTML, lo inyecta en container y registra los event listeners.
     */
    render() {
        const currentSeason  = this.seasons[this.activeSeason];
        const currentLabel   = currentSeason
            ? (currentSeason.label || `Temporada ${currentSeason.num}`)
            : 'Temporada';

        const optionsHTML = this.seasons.map((s, i) => {
            const name = s.label || `Temporada ${s.num}`;
            const epCount = s.episodes ? s.episodes.length : 0;
            return `<li role="option"
                        class="season-option${i === this.activeSeason ? ' active' : ''}"
                        data-season-idx="${i}"
                        aria-selected="${i === this.activeSeason ? 'true' : 'false'}"
                        aria-label="${name}, ${epCount} episodio${epCount !== 1 ? 's' : ''}"
                        tabindex="0">
                        ${name}
                        ${i === this.activeSeason
                            ? '<svg class="season-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
                            : ''}
                    </li>`;
        }).join('');

        this.container.innerHTML = `
            <div class="season-dropdown">
                <button class="season-dropdown-btn"
                        role="button"
                        aria-haspopup="listbox"
                        aria-expanded="false"
                        aria-label="Seleccionar temporada">
                    <span class="season-label">${currentLabel}</span>
                    <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <ul class="season-dropdown-menu" role="listbox" aria-hidden="true">
                    ${optionsHTML}
                </ul>
            </div>
        `;

        this._btn  = this.container.querySelector('.season-dropdown-btn');
        this._menu = this.container.querySelector('.season-dropdown-menu');

        this._attachEventListeners();
    }

    /**
     * Abre o cierra el menú desplegable actualizando los atributos ARIA y las clases CSS.
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Abre el menú desplegable.
     */
    open() {
        this.isOpen = true;
        this._btn.setAttribute('aria-expanded', 'true');
        this._menu.setAttribute('aria-hidden', 'false');
        this._menu.classList.add('open');
    }

    /**
     * Cierra el menú desplegable.
     */
    close() {
        this.isOpen = false;
        this._btn.setAttribute('aria-expanded', 'false');
        this._menu.setAttribute('aria-hidden', 'true');
        this._menu.classList.remove('open');
    }

    /**
     * Selecciona una temporada por índice, cierra el menú e invoca el callback.
     * @param {number} idx - Índice de la temporada seleccionada
     */
    selectSeason(idx) {
        if (idx === this.activeSeason) {
            this.close();
            return;
        }
        this.activeSeason = idx;
        this.close();
        this.onSeasonChange(idx);
    }

    /**
     * Registra todos los event listeners necesarios.
     * @private
     */
    _attachEventListeners() {
        // ── Botón principal: toggle al hacer click ────────
        this._btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // ── Botón principal: teclado ──────────────────────
        this._btn.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                e.preventDefault();
                this.close();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!this.isOpen) this.open();
                // Mover foco al primer elemento del menú
                const firstOption = this._menu.querySelector('.season-option');
                if (firstOption) firstOption.focus();
            }
        });

        // ── Opciones del menú ─────────────────────────────
        const options = this._menu.querySelectorAll('.season-option');
        options.forEach((option) => {
            option.addEventListener('click', () => {
                const idx = parseInt(option.dataset.seasonIdx, 10);
                this.selectSeason(idx);
            });

            option.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    option.click();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.close();
                    this._btn.focus();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = option.nextElementSibling;
                    if (next) next.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = option.previousElementSibling;
                    if (prev) {
                        prev.focus();
                    } else {
                        // Si no hay opción anterior, devolver foco al botón
                        this._btn.focus();
                    }
                }
            });
        });

        // ── Cerrar al hacer click fuera del dropdown ──────
        // Remover listener previo si existía para evitar duplicados
        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
        }
        this._outsideClickHandler = (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        };
        document.addEventListener('click', this._outsideClickHandler);
    }
}

// ── renderTabs ────────────────────────────────────────────
function renderTabs() {
    const tabs = $('embedded-seasons-container');
    if (!tabs) return;

    // Suprimir el dropdown si solo hay una temporada o si no hay temporadas
    if (!SERIE.seasons || SERIE.seasons.length <= 1) {
        tabs.innerHTML = '';
        return;
    }

    // Instanciar y renderizar el SeasonDropdown
    const dropdown = new SeasonDropdown(
        tabs,
        SERIE.seasons,
        activeSeason,
        (newSeasonIdx) => {
            activeSeason = newSeasonIdx;
            renderTabs();
            renderEpisodes(true);
        }
    );
    dropdown.render();
}

// ── Helper: format duration seconds → "Xm" or "Xh Ym" ────
function fmtDuration(raw) {
    if (!raw) return '';
    // If already a string like "24 min" or "1h 30m", return as-is
    if (typeof raw === 'string' && !/^\d+$/.test(raw.trim())) return raw;
    const secs = parseInt(raw, 10);
    if (isNaN(secs) || secs <= 0) return String(raw);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${m}m`;
}

// ── Helper: truncate synopsis to ~120 chars at word boundary ──
function truncateSynopsis(text, maxLen) {
    maxLen = maxLen || 120;
    if (!text || text.length <= maxLen) return text || '';
    const cut = text.lastIndexOf(' ', maxLen);
    return (cut > 0 ? text.slice(0, cut) : text.slice(0, maxLen)) + '…';
}

/**
 * Genera el HTML dinámico de un Episode Card.
 *
 * @param {Object}      ep          - Objeto episodio de SERIE.seasons[n].episodes[n]
 * @param {number}      seasonIdx   - Índice de la temporada (0-based)
 * @param {Object}      watchedMap  - Mapa de vistos obtenido con getWatchedMap()
 * @param {Object|null} resumeData  - Resultado de getSmartPlayTarget(SERIE, localStorage).
 *                                    Si { seasonIdx, epNum } coincide con este episodio,
 *                                    se agrega la clase 'current-episode' para destacarlo.
 *                                    Puede ser null si no se desea destacar ninguno.
 * @returns {string} HTML string del card
 */
function renderEpisodeCard(ep, seasonIdx, watchedMap, resumeData) {
    // ── thumbnail: usar image URL o gradiente de fallback ─
    const thumbStyle = ep.thumb
        ? `background-image:url('${ep.thumb}')`
        : `background:linear-gradient(135deg,#0a1628,#001a0d)`;

    // ── watched state ──────────────────────────────────────
    const watched = isWatched(watchedMap, seasonIdx, ep.num);

    // ── progress calculation ───────────────────────────────
    // Lee el tiempo guardado en localStorage para el primer idioma disponible.
    // Si no hay duration no se puede calcular porcentaje.
    let progressPercent = 0;
    if (ep.langs && ep.langs.length > 0) {
        const langName = ep.langs[0].name;
        const rKey = `wa_resume_${SERIE.id}_s${seasonIdx}_e${ep.num}_${langName}`;
        const savedTime = parseInt(localStorage.getItem(rKey) || '0', 10);
        if (savedTime > 5 && ep.duration) {
            const dur = parseInt(ep.duration, 10);
            if (dur > 0) progressPercent = Math.min(95, (savedTime / dur) * 100);
        }
    }
    const hasProgress = progressPercent > 0 && progressPercent < 95;

    // ── current-episode highlight ──────────────────────────
    // Se aplica cuando este episodio coincide con el target del Smart Play Button
    // (el último episodio con progreso pendiente < 95%).
    const isCurrentEpisode = resumeData != null
        && resumeData.seasonIdx === seasonIdx
        && resumeData.epNum === ep.num;

    // ── title fallback: "Episodio X" si no hay título ─────
    const epTitle = ep.title || `Episodio ${ep.num}`;

    // ── optional metadata: omitir si no existe ────────────
    const durationHTML = ep.duration
        ? `<div class="ep-duration">${fmtDuration(ep.duration)}</div>`
        : '';

    // Synopsis truncada a 120 chars; omitir sección si no existe
    const synopsisHTML = ep.synopsis
        ? `<div class="ep-synopsis">${truncateSynopsis(ep.synopsis, 120)}</div>`
        : '';

    // ── card classes ───────────────────────────────────────
    const cardClasses = ['ep-card'];
    if (watched)          cardClasses.push('watched');
    if (hasProgress)      cardClasses.push('in-progress');
    if (isCurrentEpisode) cardClasses.push('current-episode');

    return `<div class="${cardClasses.join(' ')}" data-season="${seasonIdx}" data-episode="${ep.num}">
  <div class="ep-thumb" role="img" aria-label="Miniatura episodio ${ep.num}">
    <div class="ep-thumb-img" style="${thumbStyle}"></div>

    <div class="ep-progress-bar"${hasProgress ? ` style="width:${progressPercent.toFixed(1)}%"` : ' style="width:0;display:none"'}></div>

    <div class="ep-watched-badge"${watched ? '' : ' hidden'} aria-label="Episodio visto">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="rgba(0,0,0,0.75)"/>
        <path d="M9 12l2 2 4-4" stroke="#00e676" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <div class="ep-thumb-overlay" aria-hidden="true">
      <svg class="play-icon" width="48" height="48" viewBox="0 0 24 24" fill="white">
        <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.6)"/>
        <polygon points="10 8 16 12 10 16 10 8" fill="white"/>
      </svg>
    </div>

    <div class="ep-thumb-num" aria-hidden="true">EP ${ep.num}</div>
  </div>
  <div class="ep-body">
    <div class="ep-num" aria-hidden="true">Episodio ${ep.num}</div>
    <div class="ep-title">${epTitle}</div>
    ${durationHTML}
    ${synopsisHTML}
    <div class="ep-switch-row">
      <label class="ep-switch" data-season="${seasonIdx}" data-episode="${ep.num}" aria-label="${watched ? 'Marcar como no visto' : 'Marcar como visto'}">
        <input type="checkbox" ${watched ? 'checked' : ''}>
        <span class="ep-switch-track"></span>
        <span class="ep-switch-thumb"></span>
      </label>
      <span class="ep-switch-label${watched ? ' on' : ''}" id="lbl-${seasonIdx}-${ep.num}">${watched ? 'Visto' : 'No visto'}</span>
    </div>
  </div>
</div>`;
}

function renderEpisodes(animate) {
    const map = getWatchedMap();
    const list = $('episodes-list');
    if (!list) return;
    
    if (!SERIE.seasons || !SERIE.seasons[activeSeason] || !SERIE.seasons[activeSeason].episodes) {
        list.innerHTML = '';
        return;
    }
    
    const eps = SERIE.seasons[activeSeason].episodes;

    // Obtener el target del Smart Play para destacar el episodio con progreso activo
    const resumeData = getSmartPlayTarget(SERIE, localStorage);

    list.innerHTML = eps.map(ep => renderEpisodeCard(ep, activeSeason, map, resumeData)).join('');

    // ── Event delegation: card click → play ───────────────
    list.querySelectorAll('.ep-card').forEach(c =>
        c.addEventListener('click', e => {
            if (e.target.closest('.ep-switch')) return;
            const s = +c.dataset.season, epNum = +c.dataset.episode;
            playEpisode(s, epNum);
        })
    );

    // ── Event delegation: watched toggle ──────────────────
    list.querySelectorAll('.ep-switch').forEach(sw =>
        sw.addEventListener('change', () => {
            const s = +sw.dataset.season, ep = +sw.dataset.episode;
            const val = sw.querySelector('input').checked;
            setWatched(s, ep, val);
            const lbl = $(`lbl-${s}-${ep}`);
            if (lbl) { lbl.textContent = val ? 'Visto' : 'No visto'; lbl.classList.toggle('on', val); }
            // Update watched badge immediately without full re-render
            const card = list.querySelector(`.ep-card[data-season="${s}"][data-episode="${ep}"]`);
            if (card) {
                const badge = card.querySelector('.ep-watched-badge');
                if (badge) {
                    if (val) {
                        badge.removeAttribute('hidden');
                    } else {
                        badge.setAttribute('hidden', '');
                    }
                }
                card.classList.toggle('watched', val);
            }
            // Update label aria
            sw.setAttribute('aria-label', val ? 'Marcar como no visto' : 'Marcar como visto');
        })
    );

    if (animate) {
        list.classList.remove('season-change');
        void list.offsetWidth;
        list.classList.add('season-change');
    }
}

// ── Reproductor ───────────────────────────────────────────
function playEpisode(seasonIdx, epNum, animate = false, isAutoAdvance = false) {
    activeSeason = seasonIdx;
    const eps = SERIE.seasons[seasonIdx].episodes;
    currentEpisode = eps.find(e => e.num === epNum);

    if (!currentEpisode || !currentEpisode.langs) {
        alert('Este episodio no tiene servidores disponibles');
        return;
    }

    const isCurrentMovie = SERIE.type === 'movie' || currentEpisode.type === 'movie';

    // Marcar como visto (Siempre activo por defecto)
    setWatched(seasonIdx, epNum, true);
    const input = document.querySelector(`.ep-switch[data-season="${seasonIdx}"][data-episode="${epNum}"] input`);
    if (input) input.checked = true;
    const lbl = $(`lbl-${seasonIdx}-${epNum}`);
    if (lbl) { lbl.textContent = 'Visto'; lbl.classList.add('on'); }
    // Also update badge DOM directly if list is visible
    const epCard = document.querySelector(`.ep-card[data-season="${seasonIdx}"][data-episode="${epNum}"]`);
    if (epCard) {
        const badge = epCard.querySelector('.ep-watched-badge');
        if (badge) badge.removeAttribute('hidden');
        epCard.classList.add('watched');
    }

    // Global language persistence
    let prefLang = localStorage.getItem('preferred_lang');
    if (prefLang) {
        const pIdx = currentEpisode.langs.findIndex(l => l.name === prefLang);
        activeLang = pIdx !== -1 ? pIdx : 0;
    } else if (!prefLang && currentEpisode.langs.length > 0) {
        localStorage.setItem('preferred_lang', currentEpisode.langs[0].name);
        activeLang = 0;
    }

    // Server reset on next/episode change
    activeServer = 0;
    
    window._isAutoplay = isAutoAdvance;

    if (document.fullscreenElement) {
        window._pendingFullscreen = true;
    }

    if (window._pendingFullscreen) {
        const wrap = document.getElementById('player-wrap');
        if (wrap && wrap.requestFullscreen) {
            wrap.requestFullscreen().catch(()=>{});
        }
    }

    resumeToastShown = false;

    // Auto-update Home Slider meta
    updateCWMetadata(0, 0);

    // Cancelar autoplay pendiente
    if (window._autoplayTimer) {
        clearInterval(window._autoplayTimer);
        window._autoplayTimer = null;
    }
    document.querySelectorAll('.autoplay-fs-overlay').forEach(el => el.remove());
    const nb = document.getElementById('btn-next');
    if (nb) {
        nb.classList.remove('autoplay-loading');
        const sp = nb.querySelector('span');
        if (sp) sp.textContent = 'Siguiente';
    }

    // Mostrar reproductor y ocultar interfaz de serie
    const playerSection = $('player-section');
    if (playerSection) playerSection.style.display = 'flex';
    const epListEl = $('episodes-list');
    const seasonsWrapEl = document.querySelector('.seasons-wrap');
    if (epListEl) epListEl.style.display = 'none';
    if (seasonsWrapEl) seasonsWrapEl.style.display = 'none';
    
    // Mostrar el reproductor completo (wrap y footer)
    const playerWrap = $('player-wrap');
    const playerFooter = $('player-footer');
    if (playerWrap) playerWrap.style.display = '';
    if (playerFooter) playerFooter.style.display = '';
    
    const sHeader = $('serie-header');
    const playerHeader = document.getElementById('player-header');
    // Siempre ocultar el serie-header y mostrar el player-header
    if (sHeader) sHeader.style.display = 'none';
    if (playerHeader) playerHeader.style.display = '';

    // Botón cerrar del player: siempre visible
    const closeBtn = $('btn-close-player');
    if (closeBtn) {
        closeBtn.style.display = '';
        closeBtn.setAttribute('aria-label',
            isCurrentMovie ? 'Volver al catálogo' : 'Volver a episodios'
        );
        // El listener global ya llama a closePlayer(), que para películas redirige a backUrl
    }

    // Título del episodio: en películas solo el nombre, en series "Ep. X · Título"
    const playerEpTitle = $('player-ep-title');
    if (playerEpTitle) {
        playerEpTitle.style.display = '';
        const titleText = isCurrentMovie
            ? (currentEpisode.title || SERIE.title)
            : `Ep. ${epNum} · ${currentEpisode.title}`;
        // Decodificar entidades HTML
        const temp = document.createElement('textarea');
        temp.innerHTML = titleText;
        playerEpTitle.textContent = temp.value;
    }

    // Ocultar botón de reset (no aplica a películas)
    if (isCurrentMovie) {
        const resetBtn = $('btn-serie-reset');
        if (resetBtn) resetBtn.style.display = 'none';
    }

    // Configurar botones de navegación con lógica de temporadas
    const prevBtn = $('btn-prev');
    const nextBtn = $('btn-next');

    // Encontrar índice del episodio actual en el array
    const currentIdx = eps.findIndex(e => e.num === epNum);

    // Buscar episodio anterior
    let prevEp = null;
    let prevSeasonIdx = seasonIdx;

    if (currentIdx > 0) {
        // Hay episodio anterior en esta temporada
        prevEp = eps[currentIdx - 1];
    } else if (seasonIdx > 0) {
        // Buscar en la temporada anterior
        const prevSeason = SERIE.seasons[seasonIdx - 1];
        if (prevSeason && prevSeason.episodes.length > 0) {
            prevEp = prevSeason.episodes[prevSeason.episodes.length - 1];
            prevSeasonIdx = seasonIdx - 1;
        }
    }

    // Buscar episodio siguiente
    let nextEp = null;
    let nextSeasonIdx = seasonIdx;

    if (currentIdx >= 0 && currentIdx < eps.length - 1) {
        // Hay episodio siguiente en esta temporada
        nextEp = eps[currentIdx + 1];
    } else if (seasonIdx < SERIE.seasons.length - 1) {
        // Buscar en la siguiente temporada
        const nextSeason = SERIE.seasons[seasonIdx + 1];
        if (nextSeason && nextSeason.episodes.length > 0) {
            nextEp = nextSeason.episodes[0];
            nextSeasonIdx = seasonIdx + 1;
        }
    }

    if (isCurrentMovie) {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        // Ocultar el footer completo en películas
        const playerFooter = document.getElementById('player-footer');
        if (playerFooter) playerFooter.style.display = 'none';
    } else {
        // Restaurar footer para series
        const playerFooter = document.getElementById('player-footer');
        if (playerFooter) playerFooter.style.display = '';
        if (prevBtn) {
            prevBtn.style.display = prevEp ? '' : 'none';
            prevBtn.disabled = !prevEp;
        }
        if (nextBtn) {
            nextBtn.style.display = nextEp ? '' : 'none';
            nextBtn.disabled = !nextEp;
        }
    }

    if (prevBtn) prevBtn.onclick = () => {
        if (prevEp) playEpisode(prevSeasonIdx, prevEp.num, true);
    };

    if (nextBtn) nextBtn.onclick = () => {
        if (nextEp) playEpisode(nextSeasonIdx, nextEp.num, true);
    };

    updateLabels();
    renderPlayer(animate);
}

function closePlayer() {
    const isCurrentMovie = SERIE.type === 'movie' || (currentEpisode && currentEpisode.type === 'movie');
    
    if (isCurrentMovie) {
        window.location.href = SERIE.backUrl || 'go:home';
        return;
    }

    // Si no hay episodio cargado, volver a la sección de detalles
    if (!currentEpisode) {
        const detailSection = document.getElementById('serie-detail-section');
        const playerHeader = document.getElementById('player-header');
        const playerWrap = $('player-wrap');
        const playerFooter = $('player-footer');
        const seasonsWrap = document.querySelector('.seasons-wrap');
        const episodesList = $('episodes-list');
        
        if (detailSection) detailSection.style.display = 'block';
        if (playerHeader) playerHeader.style.display = 'none';
        if (playerWrap) playerWrap.style.display = 'none';
        if (playerFooter) playerFooter.style.display = 'none';
        if (seasonsWrap) seasonsWrap.style.display = 'none';
        if (episodesList) episodesList.style.display = 'none';
        return;
    }

    // Si hay episodio cargado, volver a la lista de episodios y detalles
    $('player-section').style.display = 'none';
    const detailSection = document.getElementById('serie-detail-section');
    if (detailSection) detailSection.style.display = 'block';
    
    const epListEl = $('episodes-list');
    if (epListEl) epListEl.style.display = '';
    
    const seasonsWrapEl = document.querySelector('.seasons-wrap');
    if (seasonsWrapEl) seasonsWrapEl.style.display = '';
    
    const sHeader = $('serie-header');
    if (sHeader) sHeader.style.display = 'flex';

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) {
        if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy();
        wolfInstance = null;
    }

    // Detener cualquier video residual
    const residualVideos = $('player-wrap').querySelectorAll('video');
    residualVideos.forEach(v => { v.pause(); v.src = ''; v.load(); v.remove(); });

    // Cancelar autoplay pendiente
    if (window._autoplayTimer) {
        clearInterval(window._autoplayTimer);
        window._autoplayTimer = null;
    }
    document.querySelectorAll('.autoplay-fs-overlay').forEach(el => el.remove());
    const nb2 = document.getElementById('btn-next');
    if (nb2) {
        nb2.classList.remove('autoplay-loading');
        const sp2 = nb2.querySelector('span');
        if (sp2) sp2.textContent = 'Siguiente';
    }

    $('player-wrap').innerHTML = '';
    currentEpisode = null;
    renderCount++; // Invalidar cualquier carga asíncrona en curso
}

function updateLabels() {
    if (!currentEpisode) return;
    if (!currentEpisode.langs || !currentEpisode.langs[activeLang]) {
        console.error('Error: idioma no disponible', activeLang);
        return;
    }
    const lang = currentEpisode.langs[activeLang];
    if (!lang.servers || !lang.servers[activeServer]) {
        console.error('Error: servidor no disponible', activeServer);
        return;
    }
    const langLabel = $('btn-lang-label');
    const srvLabel  = $('btn-srv-label');
    if (langLabel) langLabel.textContent = lang.name;
    if (srvLabel)  srvLabel.textContent  = lang.servers[activeServer].name;
}

function openPicker(type) {
    const isLang = type === "lang";
    const items = isLang
        ? currentEpisode.langs.map((l, i) => ({ label: l.name, idx: i }))
        : currentEpisode.langs[activeLang].servers.map((s, i) => {
             let url = (s.url || "").toLowerCase();
             let extra = "";
             let extraClass = "";
             if (s.sandbox) {
                 extra = "Híbrido";
                 extraClass = "hibrido";
             } else if (s.deobfuscate || url.includes(".m3u8") || url.includes("directo")) {
                 extra = "Premium";
                 extraClass = "premium";
             } else if (url.includes("mega")) {
                 extra = "No Ads";
                 extraClass = "noads";
             }
             return { label: s.name, idx: i, extra, extraClass };
          });
    const current = isLang ? activeLang : activeServer;

    const existing = document.getElementById("vp-custom-picker");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "vp-custom-picker";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity 0.25s ease";
    
    const isMobile = window.innerWidth <= 768;
    const sheetStyles = isMobile 
        ? "background:#141414;width:100%;border-radius:24px 24px 0 0;padding:24px 20px;border-top:1px solid rgba(255,255,255,0.08);transform:translateY(100%);transition:transform 0.3s cubic-bezier(0.34, 1.2, 0.64, 1);max-height:80vh;display:flex;flex-direction:column"
        : "background:#141414;width:100%;max-width:400px;border-radius:20px;padding:24px;border:1px solid rgba(255,255,255,0.08);transform:scale(0.95);opacity:0;transition:all 0.25s cubic-bezier(0.34, 1.2, 0.64, 1);margin:auto;max-height:85vh;display:flex;flex-direction:column";

    const sheet = document.createElement("div");
    sheet.style.cssText = sheetStyles;
    
    const title = isLang ? "Seleccionar Idioma" : "Seleccionar Servidor";
    
    let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-shrink:0">
      <h3 style="margin:0;font-size:18px;font-weight:700;color:#fff">${title}</h3>
      <button id="vp-picker-close" style="background:rgba(255,255,255,0.1);border:none;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div style="overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:4px" id="vp-picker-list">
    `;

    items.forEach(it => {
        const isSelected = it.idx === current;
        const bg = isSelected ? "rgba(0,230,118,0.1)" : "rgba(255,255,255,0.04)";
        const border = isSelected ? "1px solid rgba(0,230,118,0.3)" : "1px solid transparent";
        const textColor = isSelected ? "#00e676" : "#fff";
        
        let extraBadge = "";
        if (it.extra) {
            let badgeBg = "#333";
            let badgeColor = "#fff";
            if (it.extraClass === "hibrido") { badgeBg = "rgba(255, 152, 0, 0.15)"; badgeColor = "#ff9800"; }
            else if (it.extraClass === "premium") { badgeBg = "rgba(255, 200, 0, 0.15)"; badgeColor = "#ffc107"; }
            else if (it.extraClass === "noads") { badgeBg = "rgba(33, 150, 243, 0.15)"; badgeColor = "#2196f3"; }
            
            extraBadge = `<span style="font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px;background:${badgeBg};color:${badgeColor};margin-left:auto;white-space:nowrap">${it.extra}</span>`;
        }

        html += `
        <button class="vp-picker-opt" data-idx="${it.idx}" style="background:${bg};border:${border};color:${textColor};padding:14px 16px;border-radius:14px;display:flex;align-items:center;cursor:pointer;text-align:left;font-family:inherit;font-size:15px;font-weight:600;transition:all 0.2s;width:100%">
          <span style="flex:1">${it.label}</span>
          ${extraBadge}
        </button>
        `;
    });

    html += `</div>`;
    sheet.innerHTML = html;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = "1";
        if (isMobile) {
            sheet.style.transform = "translateY(0)";
        } else {
            sheet.style.transform = "scale(1)";
            sheet.style.opacity = "1";
        }
    });

    function closePicker() {
        overlay.style.opacity = "0";
        if (isMobile) {
            sheet.style.transform = "translateY(100%)";
        } else {
            sheet.style.transform = "scale(0.95)";
            sheet.style.opacity = "0";
        }
        setTimeout(() => overlay.remove(), 300);
    }

    document.getElementById("vp-picker-close").addEventListener("click", closePicker);
    overlay.addEventListener("click", e => {
        if (e.target === overlay) closePicker();
    });

    overlay.querySelectorAll(".vp-picker-opt").forEach(btn => {
        // Removido: hover effects
        
        btn.addEventListener("click", () => {
            const idx = +btn.dataset.idx;
            if (isLang) {
                activeLang = idx;
                activeServer = 0;
                localStorage.setItem("preferred_lang", currentEpisode.langs[idx].name);
            } else {
                activeServer = idx;
            }
            resumeToastShown = false;
            updateLabels();
            renderPlayer();
            closePicker();
        });
    });
}

function createLoadingOverlay(parent) {
    const el = document.createElement('div');
    el.className = 'vp-loading';
    el.innerHTML = `
      <div class="vp-loading-ring">
        <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/></svg>
      </div>
      <span class="vp-loading-text">Cargando servidor...</span>`;
    parent.appendChild(el);
    return {
        hide() {
            el.classList.add('done');
            setTimeout(() => el.remove(), 420);
        }
    };
}

// ── Utilidades de detección y desofuscación ──────────────
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS_PROXIES = [
    url => {
        const base = SERIE.proxyUrl;
        if (!base) return null;
        return base.replace(/\/?$/, '/') + '?url=' + encodeURIComponent(url);
    },
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&user_agent=${encodeURIComponent(DESKTOP_UA)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

function proxyFetch(url, timeoutMs) {
    if (!GLOBAL_IS_MOBILE) {
        console.log('WOLF_INTERCEPT_URL:', url);
        console.log('🚀 [Direct Fetch] Desktop detected, bypassing proxy:', url);

        // Bridge para Electron: si existe ipcRenderer, esperamos la respuesta del proceso Main
        if (window.ipcRenderer) {
            return new Promise((resolve) => {
                const handler = (event, res) => {
                    if (res.originalUrl === url) {
                        ipcRenderer.removeListener('proxy-response', handler);
                        resolve(res.data || { contents: '' });
                    }
                };
                ipcRenderer.on('proxy-response', handler);
                // Fallback temporal si Electron tarda mucho
                setTimeout(() => {
                    ipcRenderer.removeListener('proxy-response', handler);
                    fetchDirect(url, timeoutMs).then(resolve).catch(() => resolve({ contents: '' }));
                }, 10000);
            });
        }

        return fetchDirect(url, timeoutMs);
    }

    console.log('🌐 [Proxy Fetch] Mobile detected, using proxy for:', url);
    const opts = timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {};
    const tryProxy = (idx) => {
        if (idx >= CORS_PROXIES.length) return Promise.reject(new Error('Todos los proxies fallaron'));
        const proxyUrl = CORS_PROXIES[idx](url);
        if (!proxyUrl) {
            console.warn(`⚠️ Proxy ${idx + 1} omitido (sin URL) → siguiente...`);
            return tryProxy(idx + 1);
        }
        return fetch(proxyUrl, opts)
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                // Clonar la respuesta para poder leer el body múltiples veces
                const cloned = r.clone();
                return r.json().catch(() => cloned.text().then(t => ({ contents: t })));
            })
            .catch(e => {
                console.warn(`⚠️ Proxy ${idx + 1} falló:`, e.message, '→ intentando siguiente...');
                return tryProxy(idx + 1);
            });
    };
    return tryProxy(0);
}

function fetchDirect(url, timeoutMs) {
    const opts = timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {};
    return fetch(url, opts)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            // Clonar la respuesta para poder leer el body múltiples veces
            const cloned = r.clone();
            return r.json().catch(() => cloned.text().then(t => ({ contents: t })));
        });
}

function isDirectVideo(url) {
    if (url.includes('pixeldrain.com')) return false;
    return /\.(mp4|webm|ogg|m3u8)(\?.*)?$/i.test(url) ||
        /[\/=](mp4|webm|ogg|m3u8)([\/\?&]|$)/i.test(url);
}

function isHLS(url) {
    if (url.includes('pixeldrain.com')) return false;
    return /\.m3u8(\?.*)?$/i.test(url) ||
        /[\/=]m3u8([\/\?&]|$)/i.test(url);
}

function detectVideoType(url) {
    if (url.includes('pixeldrain.com')) return Promise.resolve('iframe');

    // Si la URL ya tiene extensión reconocible, no hace falta fetch
    if (/\.(mp4|webm|ogg)(?:[\/\?&]|$)/i.test(url) || /[\/=](mp4|webm|ogg)(?:[\/\?&]|$)/i.test(url)) return Promise.resolve('mp4');
    if (/\.m3u8(?:[\/\?&]|$)/i.test(url) || /[\/=]m3u8(?:[\/\?&]|$)/i.test(url)) return Promise.resolve('hls');

    // Solo tratar como iframe directamente si tiene palabras clave MUY específicas de embeds
    // y no parece tener una extensión o segmento de video
    if (/\/(play|embed|player|watch)\//i.test(url) && !/[\/=](mp4|webm|m3u8)(?:[\/\?&]|$)/i.test(url) && !/\.(mp4|webm|m3u8)/i.test(url)) {
        return Promise.resolve('iframe');
    }

    // Intentar HEAD request directo (sin proxy) para ver Content-Type
    const referPolicy = url.includes('pixeldrain.com') ? 'no-referrer' : 'strict-origin-when-cross-origin';
    return fetch(url, { method: 'HEAD', mode: 'no-cors', referrerPolicy: referPolicy })
        .then(() => {
            return proxyFetch(url, 5000)
                .then(data => {
                    const ct = (data.content_type || '').toLowerCase();
                    if (ct.includes('mpegurl') || ct.includes('x-mpegurl') || ct.includes('m3u8')) return 'hls';
                    if (ct.includes('mp4') || ct.includes('video/') || ct.includes('octet-stream')) {
                        const body = (data.contents || '').trimStart();
                        if (body.startsWith('#EXTM3U')) return 'hls';
                        if (body.toLowerCase().startsWith('<html') || body.toLowerCase().startsWith('<!doctype')) return 'iframe';
                        return 'mp4';
                    }
                    return 'iframe';
                });
        })
        .catch(() => 'iframe'); // Si falla cualquier fetch → tratar como iframe
}

function extractVideoUrl(code) {
    if (!code) return null;
    const patterns = [
        /\b(?:url|file|src|source|link|video)\s*[:=]\s*['"`](https?:\/\/[^'"`\s,}]{10,}\.(?:m3u8|mp4|webm|ogg)[^'"`\s]*)/i,
        /(https?:\/\/[^\s"'`<>]{10,}\.(?:m3u8|mp4|webm|ogg)(?:\?[^\s"'`<>]*)?)/i,
        /["']?(?:file|src|source|hls|stream|video|link)["']?\s*[=:]\s*["'`](https?:\/\/[^"'` \s,}]{10,}(?!\.(?:js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|otf|map|json)(?:\?|$))[^"'` \s,}]*)/i,
        /data-(?:src|url|video)=["'](https?:\/\/[^"']{10,}\.(?:m3u8|mp4|webm|ogg)[^"']*)["']/i,
    ];

    for (let re of patterns) {
        // Convert to global exactly to search all matches, not just the first abort if pixeldrain
        const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        const matches = [...code.matchAll(globalRe)];
        for (const m of matches) {
            if (m && m[1] && !m[1].includes('pixeldrain.com')) {
                return m[1];
            }
        }
    }
    return null;
}

function tryUnpack(code) {
    const packed = unpackPACKED(code);
    if (packed) return packed;
    const b64m = code.match(/eval\s*\(\s*atob\s*\(\s*['"`]([\s\S]+?)['"`]\s*\)\s*\)/);
    if (b64m) { try { return atob(b64m[1]); } catch { } }
    const urim = code.match(/eval\s*\(\s*decodeURIComponent\s*\(\s*['"`]([\s\S]+?)['"`]\s*\)\s*\)/);
    if (urim) { try { return decodeURIComponent(urim[1]); } catch { } }
    const strm = code.match(/^[\s]*eval\s*\(\s*(['"`])([\s\S]*)\1\s*\)\s*;?\s*$/);
    if (strm) return strm[2]
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (/\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}/.test(code))
        return code
            .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return null;
}

function unpackPACKED(code) {
    const m = code.match(/eval\s*\(\s*function\s*\(p,a,c,k,e[^)]*\)\s*\{[\s\S]*?\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'[\s\S]*?\)\s*\)/);
    if (!m) return null;
    try {
        const p = m[1], a = parseInt(m[2]), c = parseInt(m[3]), k = m[4].split('|');
        let result = p;
        for (let i = c - 1; i >= 0; i--) {
            if (k[i]) result = result.replace(new RegExp('\\b' + i.toString(a) + '\\b', 'g'), k[i]);
        }
        return result;
    } catch { return null; }
}

function resolveUrl(server) {
    const url = server.url;
    if (!url) return Promise.resolve('');
    const isKnownObfuscated =
        url.includes('jkanime.net') ||
        url.includes('playmudos.com') ||
        url.includes('streamani.me');
    if (!server.deobfuscate && !isKnownObfuscated) return Promise.resolve(url);

    console.group('🔍 resolveUrl:', url);

    const timeout = new Promise(resolve => setTimeout(() => {
        console.warn('⏱️ Timeout — mostrando iframe directamente');
        console.groupEnd();
        resolve(url);
    }, 10000));

    const extract = proxyFetch(url)
        .then(data => {
            let code = data.contents || '';
            console.log('📄 HTML recibido:', code.length, 'chars');
            if (!code) { console.warn('⚠️ HTML vacío'); console.groupEnd(); return url; }

            let found = extractVideoUrl(code);
            if (found) { console.log('✅ Capa 1 (HTML crudo):', found); console.groupEnd(); return found; }

            const scripts = [...code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
            for (let si = 0; si < scripts.length; si++) {
                found = extractVideoUrl(scripts[si][1]);
                if (found) { console.log(`✅ Capa 2 (script #${si + 1}):`, found); console.groupEnd(); return found; }
            }

            let current = code;
            for (let i = 0; i < 10; i++) {
                const decoded = tryUnpack(current);
                if (!decoded || decoded === current) break;
                current = decoded;
                found = extractVideoUrl(current);
                if (found) { console.log(`✅ Capa 3 (desofuscado ${i + 1}):`, found); console.groupEnd(); return found; }
            }

            for (let si = 0; si < scripts.length; si++) {
                let sc = scripts[si][1];
                for (let i = 0; i < 8; i++) {
                    const decoded = tryUnpack(sc);
                    if (!decoded || decoded === sc) break;
                    sc = decoded;
                    found = extractVideoUrl(sc);
                    if (found) { console.log(`✅ Capa 4 (script #${si + 1} capa ${i + 1}):`, found); console.groupEnd(); return found; }
                }
            }

            console.warn('⚠️ No se encontró URL — usando iframe');
            console.groupEnd();
            return url;
        })
        .catch(e => {
            console.error('❌ Error fetch:', e.message, '— usando iframe');
            console.groupEnd();
            return url;
        });

    return Promise.race([extract, timeout]);
}

function updateCast(url) {
    const castBtn = $('btn-cast');
    if (!castBtn) return;
    if (!url) { castBtn.style.display = 'none'; return; }
    castBtn.style.display = '';
    castBtn._castUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=${url.startsWith('https') ? 'https' : 'http'};package=com.instantbits.cast.webvideo;end`;
}

function loadIframe(wrap, url, server, loader, requestId) {
    if (requestId && requestId !== renderCount) return;

    wrap.innerHTML = '';
    const f = document.createElement('iframe');
    f.id = 'player-frame';
    f.src = url;
    f.allowFullscreen = true;
    f.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#000';
    f.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer; clipboard-write');
    f.setAttribute('scrolling', 'no');
    if (server && server.sandbox) {
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-fullscreen');
    }
    const iframeWrap = document.createElement('div');
    iframeWrap.style.cssText = 'position:relative;width:100%;height:100%';

    // Botón pantalla completa solo para iframes de jkanime (solo en móvil)
    if (/jkanime\.net/i.test(url) && GLOBAL_IS_MOBILE) {
        const iconExpand = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
        const iconCollapse = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`;
        const fsBtn = document.createElement('button');
        fsBtn.style.cssText = 'position:absolute;top:10px;right:10px;z-index:10;background:rgba(0,0,0,0.7);border:none;color:#fff;border-radius:8px;height:36px;padding:0 12px;display:flex;align-items:center;gap:6px;cursor:pointer;backdrop-filter:blur(4px);transition:background 0.2s;font-size:12px;font-weight:700;font-family:inherit;white-space:nowrap';
        const updateBtn = () => {
            const isFs = !!document.fullscreenElement;
            fsBtn.innerHTML = (isFs ? iconCollapse : iconExpand) + `<span>${isFs ? 'Salir' : 'Pantalla completa'}</span>`;
        };
        updateBtn();
        fsBtn.addEventListener('mouseenter', () => fsBtn.style.background = 'rgba(0,230,118,0.85)');
        fsBtn.addEventListener('mouseleave', () => fsBtn.style.background = 'rgba(0,0,0,0.7)');
        fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                const el = iframeWrap;
                if (el.requestFullscreen) el.requestFullscreen();
                else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            }
        });
        document.addEventListener('fullscreenchange', updateBtn);
        document.addEventListener('webkitfullscreenchange', updateBtn);
        iframeWrap.appendChild(fsBtn);
    }

    // Bloqueador de popups
    const adBlocker = document.createElement('div');
    adBlocker.style.cssText = 'position:absolute;inset:0;z-index:2;pointer-events:none';
    const origOpen = window.open;
    window.open = () => null;

    iframeWrap.appendChild(f);
    iframeWrap.appendChild(adBlocker);
    wrap.appendChild(iframeWrap);

    f.addEventListener('load', () => {
        loader.hide();
        window.open = origOpen;
    }, { once: true });

    setTimeout(() => {
        loader.hide();
        window.open = origOpen;
    }, 15000);
}

function updateInterfaceForEpisode(seasonIdx, ep) {
    try {
        // Actualiza toda la UI sin tocar el reproductor de video
        activeSeason = seasonIdx;
        const isCurrentMovie = SERIE.type === 'movie' || (ep && ep.type === 'movie');

        // Título del episodio en el header del player
        const playerTitle = document.getElementById('player-ep-title');
        if (playerTitle) {
            playerTitle.textContent = isCurrentMovie 
                ? (ep.title || SERIE.title)
                : `Ep. ${ep.num} · ${ep.title || ''}`;
        }

        // Marcar como visto
        setWatched(seasonIdx, ep.num, true);
        const input = document.querySelector(`.ep-switch[data-season="${seasonIdx}"][data-episode="${ep.num}"] input`);
        if (input) input.checked = true;
        const lbl = document.getElementById(`lbl-${seasonIdx}-${ep.num}`);
        if (lbl) { lbl.textContent = 'Visto'; lbl.classList.add('on'); }
        // Update watched badge DOM
        const epCardAuto = document.querySelector(`.ep-card[data-season="${seasonIdx}"][data-episode="${ep.num}"]`);
        if (epCardAuto) {
            const badgeAuto = epCardAuto.querySelector('.ep-watched-badge');
            if (badgeAuto) badgeAuto.removeAttribute('hidden');
            epCardAuto.classList.add('watched');
        }

        // Idioma y servidor (safe checks)
        if (ep.langs && ep.langs.length > 0) {
            let prefLang = localStorage.getItem('preferred_lang');
            const newLangIdx = prefLang ? ep.langs.findIndex(l => l.name === prefLang) : 0;
            activeLang = newLangIdx >= 0 ? newLangIdx : 0;
            activeServer = 0;

            const langLabel = document.getElementById('btn-lang-label');
            const srvLabel  = document.getElementById('btn-srv-label');
            if (langLabel && ep.langs[activeLang]) langLabel.textContent = ep.langs[activeLang].name || '';
            if (srvLabel  && ep.langs[activeLang]?.servers?.[0]) srvLabel.textContent = ep.langs[activeLang].servers[0].name || '';
        }

        // Botones prev/next
        const eps      = SERIE.seasons[seasonIdx].episodes;
        const idx      = eps.findIndex(e => String(e.num) === String(ep.num));
        const prevBtn  = document.getElementById('btn-prev');
        const nextBtn  = document.getElementById('btn-next');

        let prevEp = null, prevSeasonIdx = seasonIdx;
        if (idx > 0) { prevEp = eps[idx - 1]; }
        else if (seasonIdx > 0) {
            const ps = SERIE.seasons[seasonIdx - 1];
            if (ps && ps.episodes && ps.episodes.length) { prevEp = ps.episodes[ps.episodes.length - 1]; prevSeasonIdx = seasonIdx - 1; }
        }

        let nextEp2 = null, nextSeasonIdx2 = seasonIdx;
        if (idx >= 0 && idx < eps.length - 1) { nextEp2 = eps[idx + 1]; }
        else if (seasonIdx < SERIE.seasons.length - 1) {
            const ns = SERIE.seasons[seasonIdx + 1];
            if (ns && ns.episodes && ns.episodes.length) { nextEp2 = ns.episodes[0]; nextSeasonIdx2 = seasonIdx + 1; }
        }

        if (prevBtn) { 
            prevBtn.disabled = !prevEp; 
            prevBtn.style.display = prevEp ? '' : 'none';
            prevBtn.onclick = () => { if (prevEp) playEpisode(prevSeasonIdx, prevEp.num, true); }; 
        }
        if (nextBtn) { 
            nextBtn.disabled = !nextEp2; 
            nextBtn.style.display = nextEp2 ? '' : 'none';
            // IMPORTANTE: Aseguramos la limpieza del estado visual del botón de "Siguiente"
            nextBtn.classList.remove('autoplay-loading');
            const spNext = nextBtn.querySelector('span');
            if (spNext) spNext.textContent = 'Siguiente';
            nextBtn.onclick = () => { if (nextEp2) playEpisode(nextSeasonIdx2, nextEp2.num, true); }; 
        }
    } catch (err) {
        console.error("Error updating interface for episode:", err);
    }
}

function handleAutoplayNext() {
    const isCurrentMovie = SERIE.type === 'movie' || (currentEpisode && currentEpisode.type === 'movie');

    // Si es película, siempre mostrar pantalla de finalizado sin importar autoplay
    if (isCurrentMovie) {
        const playerWrap = document.getElementById('player-wrap');
        const activeFsElement = document.fullscreenElement || document.webkitFullscreenElement || playerWrap;
        document.querySelectorAll('.autoplay-fs-overlay').forEach(el => el.remove());
        const fsOverlay = document.createElement('div');
        fsOverlay.className = 'autoplay-fs-overlay';

        const img = currentEpisode.thumb || currentEpisode.img || SERIE.poster || SERIE.image || '';
        const bgHtml = img
            ? `<div style="position:absolute;inset:-10%;background-image:url('${img}');background-size:cover;background-position:center;filter:blur(12px);opacity:0.5;z-index:1;pointer-events:none;"></div><div style="position:absolute;inset:0;background:radial-gradient(circle,rgba(0,0,0,0.3) 0%,rgba(0,0,0,0.9) 100%);z-index:1;pointer-events:none;"></div><div style="position:absolute;inset:0;background:#000;z-index:0;opacity:0.85;pointer-events:none;"></div>`
            : '<div style="position:absolute;inset:0;background:#000;z-index:0;pointer-events:none;"></div>';

        fsOverlay.innerHTML = `
            ${bgHtml}
            <div style="position:relative;z-index:2;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:20px;box-sizing:border-box;">
                <div class="fs-ep-img" style="border-radius:12px;overflow:hidden;margin-bottom:20px;box-shadow:0 10px 30px rgba(0,0,0,0.6);background:#111;position:relative;z-index:2;">
                    ${img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;">` : ''}
                    <div style="position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                </div>
                <div style="font-size:14px;color:var(--accent);font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Película Finalizada</div>
                <div style="font-size:28px;font-weight:900;color:#fff;line-height:1.2;margin-bottom:12px;max-width:600px;">${SERIE.title || ''}</div>
                <div style="font-size:15px;color:#aaa;margin-bottom:24px;max-width:500px;">¡Esperamos que la hayas disfrutado!</div>
                <button id="fs-back-movie-btn" style="background:var(--accent);color:#000;border:none;padding:12px 32px;border-radius:24px;font-size:15px;font-weight:800;cursor:pointer;transition:transform 0.2s;">Volver</button>
            </div>
        `;
        if (activeFsElement) activeFsElement.appendChild(fsOverlay);

        const backBtn = fsOverlay.querySelector('#fs-back-movie-btn');
        if (backBtn) {
            backBtn.onmouseenter = () => backBtn.style.transform = 'scale(1.05)';
            backBtn.onmouseleave = () => backBtn.style.transform = 'scale(1)';
            backBtn.onclick = (e) => {
                e.stopPropagation();
                fsOverlay.remove();
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    if (document.exitFullscreen) document.exitFullscreen();
                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                }
                closePlayer();
            };
        }
        return;
    }

    if (localStorage.getItem('autoplay_enabled') !== '1') return;
    
    let nextEp = null;
    let nextSeasonIdx = activeSeason;

    {
        const eps = SERIE.seasons[activeSeason].episodes;
        const currentIdx = eps.findIndex(e => String(e.num) === String(currentEpisode.num));

        if (currentIdx >= 0 && currentIdx < eps.length - 1) {
            nextEp = eps[currentIdx + 1];
        } else if (activeSeason < SERIE.seasons.length - 1) {
            let sIdx = activeSeason + 1;
            while (sIdx < SERIE.seasons.length) {
                const nextSeason = SERIE.seasons[sIdx];
                if (nextSeason && nextSeason.episodes && nextSeason.episodes.length > 0) {
                    nextEp = nextSeason.episodes[0];
                    nextSeasonIdx = sIdx;
                    break;
                }
                sIdx++;
            }
        }
    }

    const playerWrap = document.getElementById('player-wrap');
    if (!playerWrap) return;
    const isFullscreenStart = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const activeFsElement = document.fullscreenElement || document.webkitFullscreenElement || playerWrap;

    if (nextEp) {
        const nextBtn = document.getElementById('btn-next');
        
        let fsOverlay = null;
        if (isFullscreenStart && playerWrap) {
            window._pendingFullscreen = true;
            document.querySelectorAll('.autoplay-fs-overlay').forEach(el => el.remove());
            fsOverlay = document.createElement('div');
            fsOverlay.className = 'autoplay-fs-overlay';
            const epImg = nextEp.thumb || nextEp.img || SERIE.poster || SERIE.image || '';
            const epImgHtml = epImg ? `<div class="fs-ep-img" style="border-radius:12px; overflow:hidden; margin-bottom:10px; box-shadow:0 10px 30px rgba(0,0,0,0.6); background:#111; position:relative; z-index:2;"><img src="${epImg}" style="width:100%; height:100%; object-fit:cover;"></div>` : '';
            fsOverlay.style.background = 'transparent'; // Evitar fondo negro que tape todo
            const bgHtml = epImg ? `<div style="position:absolute; inset:-10%; background-image:url('${epImg}'); background-size:cover; background-position:center; filter:blur(12px); opacity:0.6; z-index:1; pointer-events:none;"></div><div style="position:absolute; inset:0; background:radial-gradient(circle, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.8) 100%); z-index:1; pointer-events:none;"></div><div style="position:absolute; inset:0; background:#000; z-index:0; opacity:0.85; pointer-events:none;"></div>` : '<div style="position:absolute; inset:0; background:#000; z-index:0; pointer-events:none;"></div>';
            
            const nextSeasonObj = SERIE.seasons[nextSeasonIdx];
            const seasonLabel = nextSeasonIdx !== activeSeason ? ` (T${nextSeasonObj.num || (nextSeasonIdx + 1)})` : '';

            fsOverlay.innerHTML = `
                ${bgHtml}
                <div class="autoplay-fs-content" style="position:relative; z-index:2;">
                    ${epImgHtml}
                    <div class="fs-next-label" style="font-size:13px; color:var(--accent); font-weight:800; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px;">A continuación</div>
                    <div class="fs-title" style="font-size:26px; font-weight:800; color:#fff; line-height:1.2; margin-bottom:6px; max-width:600px;">${SERIE.title || ''}</div>
                    <div class="fs-subtitle" style="font-size:16px; color:#aaa; margin-bottom:24px; max-width:500px;">Episodio ${nextEp.num}${seasonLabel}${nextEp.title ? ` - ${nextEp.title}` : ''}</div>
                    <div class="fs-text" style="margin-bottom:16px;">Iniciando en <span id="fs-countdown">5</span></div>
                    <button id="fs-cancel-btn">Cancelar</button>
                </div>
            `;
            const activeFsElement = document.fullscreenElement || document.webkitFullscreenElement || playerWrap;
            activeFsElement.appendChild(fsOverlay);

        } else {
            window._pendingFullscreen = false;
        }

        let countdown = 5;
        let span = null;

        // Limpiar animaciones residuales de clicks anteriores de inmediato
        const nextBtnVisible = nextBtn && nextBtn.style.display !== 'none' && !nextBtn.disabled;
        if (nextBtnVisible) {
            nextBtn.classList.add('autoplay-loading');
            span = nextBtn.querySelector('span');
            if (span) {
                span.textContent = `Siguiente en ${countdown}...`;
            }
        }

        if (window._autoplayTimer) {
            clearInterval(window._autoplayTimer);
        }
        window._autoplayTimer = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                if (span) span.textContent = `Siguiente en ${countdown}...`;
                const fsCount = document.getElementById('fs-countdown');
                if (fsCount) fsCount.textContent = countdown;
            } else {
                clearInterval(window._autoplayTimer);
                window._autoplayTimer = null;
                if (fsOverlay) fsOverlay.remove();
                
                // Forzar reset agresivo del botón al terminar contador
                if (nextBtn) {
                    nextBtn.classList.remove('autoplay-loading');
                    const spReset = nextBtn.querySelector('span');
                    if (spReset) spReset.textContent = 'Siguiente';
                }

                if (isFullscreenStart) {
                    swapVideoInFullscreen(nextEp, nextSeasonIdx);
                } else {
                    playEpisode(nextSeasonIdx, nextEp.num, true, true);
                }
            }
        }, 1000);
            
            if (fsOverlay) {
                document.getElementById('fs-cancel-btn').onclick = (e) => {
                    e.stopPropagation();
                    clearInterval(window._autoplayTimer);
                    window._autoplayTimer = null;
                    fsOverlay.remove();
                    // Limpiar agresivamente el botón si se cancela manualmente el pop-up
                    if (nextBtn) {
                        nextBtn.classList.remove('autoplay-loading');
                        const spReset = nextBtn.querySelector('span');
                        if (spReset) spReset.textContent = 'Siguiente';
                    }
                    window._pendingFullscreen = false;
                };
            }
    } else {
        // Pantalla de finalización (película o fin de serie)
        document.querySelectorAll('.autoplay-fs-overlay').forEach(el => el.remove());
        const fsOverlay = document.createElement('div');
        fsOverlay.className = 'autoplay-fs-overlay';
        
        const img = currentEpisode.thumb || currentEpisode.img || SERIE.poster || SERIE.image || '';
        const bgHtml = img ? `<div style="position:absolute; inset:-10%; background-image:url('${img}'); background-size:cover; background-position:center; filter:blur(12px); opacity:0.5; z-index:1; pointer-events:none;"></div><div style="position:absolute; inset:0; background:radial-gradient(circle, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.9) 100%); z-index:1; pointer-events:none;"></div><div style="position:absolute; inset:0; background:#000; z-index:0; opacity:0.85; pointer-events:none;"></div>` : '<div style="position:absolute; inset:0; background:#000; z-index:0; pointer-events:none;"></div>';
        const label = isCurrentMovie ? 'Película finalizada' : 'Serie finalizada';
        
        fsOverlay.innerHTML = `
            ${bgHtml}
            <div style="position:relative; z-index:2; text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; padding:20px; box-sizing:border-box;">
                <div class="fs-ep-img" style="border-radius:12px; overflow:hidden; margin-bottom:20px; box-shadow:0 10px 30px rgba(0,0,0,0.6); background:#111; position:relative; z-index:2;">
                    <img src="${img}" style="width:100%; height:100%; object-fit:cover;">
                    <div style="position:absolute; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                </div>
                <div style="font-size:14px; color:var(--accent); font-weight:800; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:8px;">${label}</div>
                <div style="font-size:28px; font-weight:900; color:#fff; line-height:1.2; margin-bottom:12px; max-width:600px;">${SERIE.title || ''}</div>
                <div style="font-size:15px; color:#aaa; margin-bottom:24px; max-width:500px;">¡Esperamos que la hayas disfrutado!</div>
                <button id="fs-close-final-btn" style="background:var(--accent); color:#000; border:none; padding:12px 32px; border-radius:24px; font-size:15px; font-weight:800; cursor:pointer; transition:transform 0.2s;">Cerrar reproductor</button>
            </div>
        `;
        activeFsElement.appendChild(fsOverlay);
        
        const closeBtn = fsOverlay.querySelector('#fs-close-final-btn');
        if (closeBtn) {
            closeBtn.onmouseenter = () => closeBtn.style.transform = 'scale(1.05)';
            closeBtn.onmouseleave = () => closeBtn.style.transform = 'scale(1)';
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                fsOverlay.remove();
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    if (document.exitFullscreen) document.exitFullscreen();
                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                }
                closePlayer();
            };
        }
    }
}

// ── Intercambio de video en fullscreen (sin reconstruir DOM) ─────
function swapVideoInFullscreen(nextEp, nextSeasonIdx) {
    document.querySelectorAll('.autoplay-fs-overlay').forEach(el => el.remove());
    
    // ACTUALIZAR LA INTERFAZ AQUÍ (cuando ya se confirmó el cambio)
    currentEpisode = nextEp;
    updateInterfaceForEpisode(nextSeasonIdx, nextEp);
    
    // Buscar el <video> existente antes de cualquier cambio
    const playerWrap = document.getElementById('player-wrap');
    const existingVideo = playerWrap ? playerWrap.querySelector('video') : null;

    if (!existingVideo) {
        // No hay video nativo activo (ej: iframe) — flujo normal
        renderPlayer(true);
        return;
    }

    const lang = nextEp.langs[activeLang] || nextEp.langs[0];
    if (!lang || !lang.servers || !lang.servers.length) {
        renderPlayer(true);
        return;
    }
    const server = lang.servers[activeServer] || lang.servers[0];

    // Actualizar poster del video inmediatamente
    const newPoster = nextEp.thumb || nextEp.img || SERIE.poster || SERIE.image || '';
    if (newPoster) existingVideo.setAttribute('poster', newPoster);

    // Mostrar loading encima del video mientras carga (sin destruir nada)
    const fsContainer = document.fullscreenElement || document.webkitFullscreenElement || playerWrap;
    let swapLoader = document.getElementById('swap-loader-overlay');
    if (!swapLoader) {
        swapLoader = document.createElement('div');
        swapLoader.id = 'swap-loader-overlay';
        swapLoader.style.cssText = `
            position:absolute; inset:0; z-index:9999;
            display:flex; align-items:center; justify-content:center;
            overflow:hidden;
            background:transparent;
        `;
        
        const bgHtml = newPoster ? `<div style="position:absolute;inset:0;background:url('${newPoster}') center/cover;filter:blur(20px);opacity:0.5;transform:scale(1.1);z-index:0;"></div>` : '';
        
        swapLoader.innerHTML = `
            ${bgHtml}
            <div style="position:absolute;inset:0;background:rgba(0,0,0,0.6);z-index:1;"></div>
            <div style="text-align:center;position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent,#00E676)" stroke-width="2"
                     style="animation:spin 0.8s linear infinite; display:block; margin:0 auto 12px;">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <polyline points="3 3 3 8 8 8"/>
                </svg>
                <div style="color:#fff; font-size:16px; font-weight:600; text-shadow:0 2px 4px rgba(0,0,0,0.8);">Cargando episodio...</div>
            </div>`;
        fsContainer.appendChild(swapLoader);
    }

    // Usar el mismo resolveUrl que usa renderPlayer
    resolveUrl(server).then(resolved => {
        let finalUrl = typeof resolved === 'object' ? resolved.url : resolved;
        if (!finalUrl) {
            if (swapLoader) swapLoader.remove();
            renderPlayer(true);
            return;
        }

        window._isAutoplay = true;
        const isHLSUrl = isHLS(finalUrl);

        const hideSwapLoader = () => {
            if (swapLoader) { swapLoader.remove(); swapLoader = null; }
        };

        // Reset state so old listeners treat it as a new episode
        existingVideo._resumeChecked = false;
        existingVideo._lastSave = 0;
        resumeToastShown = false;

        if (isHLSUrl && hlsInstance) {
            // Reutilizar instancia HLS — solo cambiar fuente, sin tocar el DOM
            hlsInstance.stopLoad();
            hlsInstance.detachMedia();
            hlsInstance.loadSource(finalUrl);
            hlsInstance.attachMedia(existingVideo);
            hlsInstance.once(window.Hls.Events.MANIFEST_PARSED, () => {
                existingVideo.play().catch(() => {});
            });
            existingVideo.addEventListener('canplay', hideSwapLoader, { once: true });
        } else if (isHLSUrl && window.Hls && window.Hls.isSupported()) {
            if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
            const hls = new window.Hls({ maxBufferLength: 60, maxMaxBufferLength: 120 });
            hls.loadSource(finalUrl);
            hls.attachMedia(existingVideo);
            hls.once(window.Hls.Events.MANIFEST_PARSED, () => {
                existingVideo.play().catch(() => {});
            });
            hlsInstance = hls;
            existingVideo.addEventListener('canplay', hideSwapLoader, { once: true });
        } else {
            // MP4/WebM — cambiar src sin tocar el DOM ni el fullscreen
            existingVideo.pause();
            existingVideo.src = finalUrl;
            existingVideo.load();
            existingVideo.addEventListener('canplay', () => {
                hideSwapLoader();
                existingVideo.play().catch(() => {});
            }, { once: true });
        }

        // Ocultar loader tras timeout de seguridad
        setTimeout(hideSwapLoader, 8000);

        // Re-conectar el evento ended para el nuevo capítulo
        if (existingVideo._onEndedAutoplay) {
            existingVideo.removeEventListener('ended', existingVideo._onEndedAutoplay);
        }
        const onEnded = () => {
            const key = resumeKey();
            if (key) localStorage.removeItem(key);
            handleAutoplayNext();
        };
        existingVideo._onEndedAutoplay = onEnded;
        existingVideo.addEventListener('ended', onEnded);
    });
}

function buildVideoPlayer(wrap, url, poster, videoType, mainLoader, server, requestId) {
    if (requestId && requestId !== renderCount) return;

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) {
        if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy();
        wolfInstance = null;
    }

    wrap.innerHTML = '';
    const prevVideo = document.querySelector('#wolf-player-container video');
    if (prevVideo) { prevVideo.pause(); prevVideo.src = ''; }

    const container = document.createElement('div');
    container.className = 'vp-wolf-wrap';
    container.id = 'wolf-player-container';
    wrap.appendChild(container);

    const vidLoader = createLoadingOverlay(container);
    let loaderHidden = false;
    function hideLoader() {
        if (loaderHidden) return;
        loaderHidden = true;
        vidLoader.hide();
        if (mainLoader) mainLoader.hide();
    }
    setTimeout(hideLoader, 10000);

    if (typeof window.WolfPlayer !== 'undefined') {
        const wolfConfig = {
            src: url,
            poster: poster || '',
            autoplay: window._isAutoplay || false,
            color: '#00E676',
            volume: 0.8
        };

        if (videoType === 'hls' || isHLS(url)) {
            wolfConfig.hlsConfig = {
                maxBufferLength: GLOBAL_IS_MOBILE ? 20 : 60,
                maxMaxBufferLength: GLOBAL_IS_MOBILE ? 40 : 120,
                maxBufferSize: GLOBAL_IS_MOBILE ? 40 * 1000 * 1000 : 80 * 1000 * 1000,
                startLevel: GLOBAL_IS_MOBILE ? 0 : -1,
                capLevelToPlayerSize: true,
                autoStartLoad: true,
                enableWorker: true,
                backBufferLength: GLOBAL_IS_MOBILE ? 15 : 40
            };
        }

        let wolfInitOk = false;
        try {
            wolfInstance = new window.WolfPlayer('#wolf-player-container', wolfConfig);
            wolfInitOk = true;
        } catch (wolfErr) {
            console.error('❌ WolfPlayer falló al inicializar:', wolfErr);
            wolfInstance = null;
        }

        if (!wolfInitOk) {
            // WolfPlayer lanzó excepción — limpiar el container y usar fallback nativo
            console.warn('⚠️ Usando fallback nativo por fallo de WolfPlayer');
            container.innerHTML = '';
            _buildNativePlayer(container, wrap, url, poster, videoType, mainLoader, server, requestId, hideLoader);
            return;
        }

        setTimeout(hideLoader, 2000);

        // Forzar precarga apenas el contenedor genere la etiqueta nativa (evitamos fallos API de WolfPlayer)
        let preloadAttempts = 0;
        const preloadIv = setInterval(() => {
            if (requestId && requestId !== renderCount) return clearInterval(preloadIv);
            const v = container.querySelector('video');
            if (v) {
                clearInterval(preloadIv);

                // Configuración crítica antes del load
                if (url.includes('pixeldrain.com')) {
                    v.setAttribute('referrerpolicy', 'no-referrer');
                }

                v.setAttribute('preload', 'auto');
                if (!url.includes('.m3u8')) v.load();
                
                v.addEventListener('canplay', () => {
                    if (window._pendingFullscreen) {
                        window._pendingFullscreen = false;
                        if (wolfInstance && wolfInstance.fullscreen) {
                            wolfInstance.fullscreen.enter().catch(()=>{});
                        } else if (container.requestFullscreen) {
                            container.requestFullscreen().catch(()=>{});
                        }
                    }
                }, { once: true });
            } else if (++preloadAttempts > 40) {
                clearInterval(preloadIv);
            }
        }, 50);

        setTimeout(() => {
            if (requestId && requestId !== renderCount) return;

            const v = container.querySelector('video');
            if (v) {

                v.addEventListener('error', (e) => {
                    if (requestId && requestId !== renderCount) return;
                    
                    const errCode = v.error ? v.error.code : 0;
                    if (errCode !== 4) {
                        console.warn(`⚠️ Ignorando error transitorio en video (código ${errCode}).`);
                        return;
                    }
                    
                    console.error('❌ Error fatal en video (SRC_NOT_SUPPORTED):', e, v.error);

                    if (server && server.url) {
                        const fallbackUrl = (url !== server.url) ? server.url : url;
                        console.warn('⚠️ Fallback a iframe:', fallbackUrl);
                        wrap.innerHTML = '';
                        const newLoader = createLoadingOverlay(wrap);
                        loadIframe(wrap, fallbackUrl, server, newLoader, requestId);
                        return;
                    }

                    hideLoader();
                    wrap.innerHTML = `<div class="player-placeholder">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      <p>Error al cargar el video</p>
                      <small>El formato no es soportado o el servidor rechazó la conexión. Intenta con otro servidor.</small>
                    </div>`;
                });

                let saveInterval = null;
                v._resumeChecked = false;

                // Función segura para reproducir el video sin conflictos
                const safePlay = () => {
                    const p = v.play();
                    if (p !== undefined) {
                        p.catch(err => {
                            console.warn('Error al reproducir:', err.message);
                        });
                    }
                };

                const checkResume = () => {
                    if (requestId && requestId !== renderCount) return;
                    if (v._resumeChecked) return;
                    const saved = getSavedTime();
                    if (!saved || saved <= 0) {
                        v._resumeChecked = true;
                        return;
                    }

                    const tryShow = () => {
                        if (requestId && requestId !== renderCount) return;
                        if (v._resumeChecked) return;
                        v._resumeChecked = true;

                        const currentTime = v.currentTime || 0;
                        const hasSignificantProgress = saved > 30;
                        const isNearStart = currentTime < 60 || Math.abs(currentTime - saved) > 60;

                        if (hasSignificantProgress && isNearStart) {
                            showResumeToast(saved, () => {
                                const jump = () => { 
                                    v.currentTime = saved; 
                                    safePlay(); 
                                };
                                if (v.readyState >= 1) jump();
                                else {
                                    const h = () => { 
                                        v.currentTime = saved; 
                                        v.removeEventListener('loadedmetadata', h); 
                                    };
                                    v.addEventListener('loadedmetadata', h);
                                    safePlay();
                                }
                            }, () => { safePlay(); });
                        }
                    };

                    tryShow();
                };

                // Llamar inmediatamente para mostrar el toast antes de que cargue el video
                checkResume();

                const doSave = () => {
                    if (requestId && requestId !== renderCount) return;
                    if (v.duration > 0) saveProgress(v.currentTime, v.duration);
                };

                v.addEventListener('loadedmetadata', checkResume);
                v.addEventListener('canplay', checkResume);

                v.addEventListener('play', () => {
                    if (requestId && requestId !== renderCount) return;
                    if (!saveInterval) saveInterval = setInterval(doSave, 3000);
                });

                v.addEventListener('pause', doSave);
                v.addEventListener('seeked', doSave);
                v.addEventListener('timeupdate', () => {
                    if (requestId && requestId !== renderCount) return;
                    if (!v._lastSave || Date.now() - v._lastSave > 5000) {
                        v._lastSave = Date.now();
                        doSave();
                    }
                });

                v.addEventListener('ended', () => {
                    if (requestId && requestId !== renderCount) return;
                    clearInterval(saveInterval);
                    const key = resumeKey();
                    if (key) localStorage.removeItem(key);
                    handleAutoplayNext();
                });

                window.addEventListener('beforeunload', doSave);

                let skipBtn = document.getElementById('vp-skip-intro');
                if (!skipBtn) {
                    skipBtn = document.createElement('button');
                    skipBtn.id = 'vp-skip-intro';
                    skipBtn.textContent = 'Omitir intro';
                    skipBtn.style.cssText = 'position:absolute;bottom:140px;right:20px;padding:8px 16px;background:rgba(0,230,118,0.9);color:#000;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;opacity:0;transition:opacity 0.3s;z-index:9999;pointer-events:none';
                    container.appendChild(skipBtn);
                    console.log('[Skip Intro] Botón creado');
                }

                // Variable para evitar múltiples event listeners
                if (!skipBtn._skipHandlerAttached) {
                    skipBtn._skipHandlerAttached = true;
                    
                    skipBtn.addEventListener('click', (e) => {
                        if (requestId && requestId !== renderCount) return;
                        e.preventDefault();
                        e.stopPropagation();
                        
                        // Obtener introEnd del episodio o usar 90 segundos por defecto
                        let ie = currentEpisode ? currentEpisode.introEnd : 0;
                        
                        // Si no está definido, usar 85 segundos por defecto (típico de intros de anime)
                        if (!ie || ie <= 0) {
                            ie = 85;
                        }
                        
                        console.log('[Skip Intro] Saltando a:', ie);
                        v.currentTime = ie;
                        skipBtn.style.opacity = '0';
                        skipBtn.style.pointerEvents = 'none';
                    });
                }

                const checkIntro = () => {
                    if (requestId && requestId !== renderCount) return;
                    
                    // Obtener introEnd del episodio
                    let ie = currentEpisode ? currentEpisode.introEnd : 0;
                    
                    // Si no está definido, usar 85 segundos por defecto (típico de intros de anime)
                    if (!ie || ie <= 0) {
                        ie = 85;
                    }
                    
                    const ct = v.currentTime;
                    
                    // Debug: Log para verificar valores (solo cada 5 segundos para no saturar)
                    if (Math.floor(ct) % 5 === 0) {
                        console.log('[Skip Intro] introEnd:', ie, 'currentTime:', ct.toFixed(1), 'paused:', v.paused);
                    }
                    
                    // Mostrar botón si:
                    // 1. El tiempo actual está entre 10 y introEnd segundos (para evitar mostrarlo al inicio)
                    // 2. El video NO está pausado
                    if (ct >= 10 && ct < ie && !v.paused) {
                        skipBtn.style.opacity = '1';
                        skipBtn.style.pointerEvents = 'auto';
                        if (Math.floor(ct) % 10 === 0) {
                            console.log('[Skip Intro] Botón VISIBLE');
                        }
                    } else {
                        skipBtn.style.opacity = '0';
                        skipBtn.style.pointerEvents = 'none';
                    }
                };

                // Agregar eventos
                v.addEventListener('play', checkIntro);
                v.addEventListener('playing', checkIntro);
                v.addEventListener('pause', () => {
                    skipBtn.style.opacity = '0';
                    skipBtn.style.pointerEvents = 'none';
                });
                v.addEventListener('timeupdate', checkIntro);
                v.addEventListener('seeked', checkIntro);
                v.addEventListener('ended', () => {
                    skipBtn.style.opacity = '0';
                    skipBtn.style.pointerEvents = 'none';
                });
                
                // Verificar inmediatamente si debe mostrarse
                setTimeout(() => checkIntro(), 100);
                
                console.log('[Skip Intro] Sistema activado. El botón aparecerá entre los segundos 10 y', 
                    (currentEpisode && currentEpisode.introEnd) ? currentEpisode.introEnd : 85);
            }
        }, 1000);
    } else {
        _buildNativePlayer(container, wrap, url, poster, videoType, mainLoader, server, requestId, hideLoader);
    }
}

// ── Reproductor nativo de fallback (usado cuando WolfPlayer no está o falla) ──
function _buildNativePlayer(container, wrap, url, poster, videoType, mainLoader, server, requestId, hideLoader) {
    const video = document.createElement('video');
    video.controls = true;
    video.preload = GLOBAL_IS_MOBILE ? 'metadata' : 'auto';
    video.poster = poster;
    video.autoplay = window._isAutoplay || false;
    video.playsInline = true;
    video.style.cssText = 'width:100%;height:100%;background:#000;object-fit:contain';

    // Configuración crítica de referrer
    if (url.includes('pixeldrain.com')) {
        video.setAttribute('referrerpolicy', 'no-referrer');
    }

    if (videoType === 'hls' || isHLS(url)) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
        } else if (typeof window.Hls !== 'undefined' && window.Hls.isSupported()) {
            const hls = new window.Hls({
                maxBufferLength: GLOBAL_IS_MOBILE ? 15 : 45,
                maxMaxBufferLength: GLOBAL_IS_MOBILE ? 30 : 90,
                startLevel: GLOBAL_IS_MOBILE ? 0 : -1
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            hlsInstance = hls;
        } else {
            video.src = url;
        }
    } else {
        video.src = url;
    }

    container.appendChild(video);
    video.addEventListener('canplay', () => {
        if (hideLoader) hideLoader();
        if (mainLoader) mainLoader.hide();
        video.play().catch(() => { });
        if (window._pendingFullscreen) {
            window._pendingFullscreen = false;
            if (video.requestFullscreen) video.requestFullscreen().catch(()=>{});
        }
    }, { once: true });

    let saveInterval = null;
    video._resumeChecked = false;

    // Función segura para reproducir el video sin conflictos
    const safePlayFallback = () => {
        const p = video.play();
        if (p !== undefined) {
            p.catch(err => {
                console.warn('Error al reproducir (fallback):', err.message);
            });
        }
    };

    const checkResumeFallback = () => {
        if (requestId && requestId !== renderCount) return;
        if (video._resumeChecked) return;
        const saved = getSavedTime();
        if (!saved || saved <= 0) {
            video._resumeChecked = true;
            return;
        }
        video._resumeChecked = true;
        const currentTime = video.currentTime || 0;
        if (saved > 30 && (currentTime < 60 || Math.abs(currentTime - saved) > 60)) {
            showResumeToast(saved, () => {
                const jump = () => { video.currentTime = saved; safePlayFallback(); };
                if (video.readyState >= 1) jump();
                else video.addEventListener('loadedmetadata', jump, { once: true });
            }, () => { safePlayFallback(); });
        }
    };
    video.addEventListener('loadedmetadata', checkResumeFallback);
    video.addEventListener('canplay', checkResumeFallback);
    checkResumeFallback();

    const doSaveFallback = () => {
        if (requestId && requestId !== renderCount) return;
        if (video.duration > 0) saveProgress(video.currentTime, video.duration);
    };

    video.addEventListener('play', () => {
        if (requestId && requestId !== renderCount) return;
        if (!saveInterval) saveInterval = setInterval(doSaveFallback, 3000);
    });
    video.addEventListener('pause', doSaveFallback);
    video.addEventListener('seeked', doSaveFallback);
    video.addEventListener('timeupdate', () => {
        if (requestId && requestId !== renderCount) return;
        if (!video._lastSave || Date.now() - video._lastSave > 5000) {
            video._lastSave = Date.now();
            doSaveFallback();
        }
    });
    video.addEventListener('ended', () => {
        if (requestId && requestId !== renderCount) return;
        clearInterval(saveInterval);
        const key = resumeKey();
        if (key) localStorage.removeItem(key);
        handleAutoplayNext();
    });

    // Fallback de timeout para ocultar loader
    setTimeout(() => { if (hideLoader) hideLoader(); if (mainLoader) mainLoader.hide(); }, 10000);
}

function renderPlayer(animate = false) {
    const wrap = $('player-wrap');
    if (!wrap) return; // El elemento no existe en este contexto (ej: Blogger sin layout de reproductor)
    const myCount = ++renderCount;

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) {
        if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy();
        wolfInstance = null;
    }

    wrap.innerHTML = '';
    wrap.classList.remove('loaded', 'switching');

    // No añadimos 'switching' aún para que el loader sea visible
    const loader = createLoadingOverlay(wrap);

    // Validar que existan los datos necesarios
    if (!currentEpisode || !currentEpisode.langs || !currentEpisode.langs[activeLang]) {
        loader.hide();
        wrap.innerHTML = `<div class="player-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <p>Error: idioma no disponible</p>
        </div>`;
        wrap.classList.add('loaded');
        return;
    }

    if (!currentEpisode.langs[activeLang].servers || !currentEpisode.langs[activeLang].servers[activeServer]) {
        loader.hide();
        wrap.innerHTML = `<div class="player-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <p>Error: servidor no disponible</p>
        </div>`;
        wrap.classList.add('loaded');
        return;
    }

    const server = currentEpisode.langs[activeLang].servers[activeServer];

    resolveUrl(server).then(resolved => {
        if (myCount !== renderCount) return;

        let url = typeof resolved === 'object' ? resolved.url : resolved;
        const poster = typeof resolved === 'object' ? resolved.poster : (currentEpisode.thumb || '');

        updateCast(url);

        if (!url) {
            loader.hide();
            wrap.innerHTML = `<div class="player-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <p>Sin URL — elige otro servidor</p>
            </div>`;
            wrap.classList.add('loaded');
            return;
        }

        if (isDirectVideo(url)) {
            buildVideoPlayer(wrap, url, poster, isHLS(url) ? 'hls' : 'mp4', loader, server, myCount);
        } else if (/^https?:\/\//i.test(url)) {
            detectVideoType(url).then(videoType => {
                if (myCount !== renderCount) return;
                if (videoType === 'hls' || videoType === 'mp4') {
                    buildVideoPlayer(wrap, url, poster, videoType, loader, server, myCount);
                } else {
                    loadIframe(wrap, server.url, server, loader, myCount);
                }
            });
        } else {
            loadIframe(wrap, server.url, server, loader, myCount);
        }

        // Antes de inyectar el contenido real, preparamos la animación
        if (animate) wrap.classList.add('switching');

        requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('loaded')));
    });
}



// ── Eventos del reproductor ───────────────────────────────
const closePlayerBtn = $('btn-close-player');
if (closePlayerBtn) {
    closePlayerBtn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        closePlayer();
    });
}

const langBtn = $('btn-lang');
if (langBtn) {
    langBtn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        openPicker('lang');
    });
}
const srvBtn = $('btn-srv');
if (srvBtn) {
    srvBtn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        openPicker('srv');
    });
}

// Quitar foco de todos los botones después de hacer click
document.addEventListener('click', (e) => {
    if (e.target.closest('.action-btn, .nav-btn')) {
        setTimeout(() => {
            if (document.activeElement) {
                document.activeElement.blur();
            }
        }, 100);
    }
}, true);

// Botón de transmitir (cast)
const castBtn = $('btn-cast');
if (castBtn) {
    castBtn.addEventListener('click', (e) => {
        const btn = e.currentTarget;

        if (!currentEpisode || !currentEpisode.langs || !currentEpisode.langs[activeLang]) {
            return;
        }

        const server = currentEpisode.langs[activeLang].servers[activeServer];
        if (!server || !server.url) {
            return;
        }

        const url = server.url;
        const castUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=${url.startsWith('https') ? 'https' : 'http'};package=com.instantbits.cast.webvideo;end`;

        // Quitar el foco inmediatamente
        setTimeout(() => btn.blur(), 0);

        if (typeof window.openCastModal === 'function') {
            window.openCastModal(castUrl);
        } else {
            window.location.href = castUrl;
        }
    });
}

// ── Inicialización ────────────────────────────────────────
const isInitMovie = SERIE.type === 'movie' || (SERIE.seasons?.[0]?.episodes?.[0]?.type === 'movie');

if (isInitMovie) {
    // Es una película: si hay sección de detalles activa, no autoplay
    if (!window._serieDetailShown) {
        $('player-section').style.display = 'flex';

        const epList = $('episodes-list');
        const seasonsWrap = document.querySelector('.seasons-wrap');
        const resetBtn = $('btn-serie-reset');
        const sHeader = $('serie-header');
        const pHeader = document.getElementById('player-header');
        
        if (epList) epList.style.display = 'none';
        if (seasonsWrap) seasonsWrap.style.display = 'none';
        if (resetBtn) resetBtn.style.display = 'none';
        if (sHeader) sHeader.style.display = 'none';
        if (pHeader) pHeader.style.display = '';

        const firstS = SERIE.seasons && SERIE.seasons[0];
        if (firstS && firstS.episodes && firstS.episodes.length > 0) {
            playEpisode(0, firstS.episodes[0].num, false, false);
        }
    }
} else {
    // Es una serie: comportamiento normal
    renderTabs();
    renderEpisodes(true);

    // Actualizar el label del Smart Play Button con el estado de progreso actual
    // Se llama siempre que la sección de detalles esté en el DOM
    if (document.getElementById('serie-detail-section')) {
        updateSmartPlayLabel();
    }

    // ── Inicialización Auto-Watched (siempre activo para series) ──────────
    if (!window._serieDetailShown) {
    (function () {
        const map = getWatchedMap();
        let highestS = -1;
        let highestE = -1;

        for (let s = SERIE.seasons.length - 1; s >= 0; s--) {
            const eps = SERIE.seasons[s].episodes;
            for (let i = eps.length - 1; i >= 0; i--) {
                if (isWatched(map, s, eps[i].num)) {
                    highestS = s;
                    highestE = eps[i].num;
                    break;
                }
            }
            if (highestS !== -1) break;
        }

        if (highestS !== -1 && highestE !== -1) {
            setTimeout(() => playEpisode(highestS, highestE), 150);
        }
    })();
    } // end if (!window._serieDetailShown)
}


// ── Modal de Reportes ─────────────────────────────────────
(function () {
    const overlay = document.getElementById('report-modal-overlay');
    const box = document.getElementById('report-modal-box');
    const closeBtn = document.getElementById('report-modal-close');
    const sendBtn = document.getElementById('report-send-btn');
    const status = document.getElementById('report-status');
    const comment = document.getElementById('report-comment');
    const typeSelect = document.getElementById('report-type-select');
    const langSelect = document.getElementById('report-lang-select');
    const srvSelect = document.getElementById('report-srv-select');
    const formView = document.getElementById('report-form-view');
    const successView = document.getElementById('report-success-view');
    const successIcon = document.getElementById('report-success-icon');

    function openModal() {
        if (!currentEpisode) return;

        langSelect.innerHTML = '';
        (currentEpisode.langs || []).forEach((l, i) => {
            const o = document.createElement('option');
            o.value = i;
            o.textContent = l.name;
            if (i === activeLang) o.selected = true;
            langSelect.appendChild(o);
        });

        function fillServers(li) {
            srvSelect.innerHTML = '';
            (currentEpisode.langs?.[li]?.servers || []).forEach((s, i) => {
                const o = document.createElement('option');
                o.value = i;
                o.textContent = s.name;
                if (li === activeLang && i === activeServer) o.selected = true;
                srvSelect.appendChild(o);
            });
        }

        fillServers(activeLang);
        if (langSelect) langSelect.addEventListener('change', () => fillServers(+langSelect.value));

        typeSelect.value = '';
        comment.value = '';
        status.textContent = '';
        formView.style.display = '';
        successView.style.display = 'none';
        successIcon.style.transform = 'scale(0.5)';
        successIcon.style.opacity = '0';
        overlay.style.display = 'flex';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            box.style.transform = 'scale(1)';
            box.style.opacity = '1';
        }));
    }

    function closeModal() {
        box.style.transform = 'scale(0.94)';
        box.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 220);
    }

    const reportBtn = $('btn-report');
    if (reportBtn) reportBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeModal();
        });
    }

    sendBtn.addEventListener('click', async () => {
        const cfg = window.REPORT_CONFIG || {};
        if (!cfg.botToken || cfg.botToken === 'TU_BOT_TOKEN_AQUI') {
            status.style.color = '#ff5050';
            status.textContent = 'Bot de Telegram no configurado.';
            return;
        }

        if (!typeSelect.value) {
            status.style.color = '#ff5050';
            status.textContent = 'Selecciona un tipo de problema.';
            return;
        }

        const li = +langSelect.value;
        const si = +srvSelect.value;
        const lang = currentEpisode.langs?.[li]?.name || '-';
        const server = currentEpisode.langs?.[li]?.servers?.[si]?.name || '-';

        const lines = [
            '🚨 *Nuevo reporte*',
            `🆔 *ID Serie:* \`${SERIE.id || '-'}\``,
            `📺 *Serie:* \`${SERIE.title || '-'}\``,
            `🎭 *Tipo:* \`Episodio\``,
            `📅 *Temporada:* \`${activeSeason + 1}\``,
            `🎞 *Episodio:* \`${currentEpisode.num} - ${currentEpisode.title || '-'}\``,
            `🌐 *Idioma:* \`${lang}\``,
            `🖥 *Servidor:* \`${server}\``,
            `⚠️ *Problema:* \`${typeSelect.value}\``,
            comment.value.trim() ? `💬 *Comentario:* \`${comment.value.trim()}\`` : null
        ].filter(Boolean).join('\n');

        sendBtn.disabled = true;
        status.style.color = '#888899';
        status.textContent = 'Enviando...';

        try {
            const body = {
                chat_id: cfg.chatId,
                text: lines,
                parse_mode: 'Markdown'
            };
            if (cfg.topicId) body.message_thread_id = cfg.topicId;

            const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (data.ok) {
                formView.style.display = 'none';
                successView.style.display = '';
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    successIcon.style.transform = 'scale(1)';
                    successIcon.style.opacity = '1';
                }));
                setTimeout(closeModal, 2000);
            } else {
                throw new Error(data.description);
            }
        } catch {
            status.style.color = '#ff5050';
            status.textContent = 'Error al enviar. Intenta de nuevo.';
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    });
})();

// ── Reset de progreso de Serie (Modal Confirmación) ────────
(function() {
    const btnReset = document.getElementById('btn-serie-reset');
    const overlay  = document.getElementById('serie-options-overlay');
    const modal    = document.getElementById('serie-options-modal');
    const btnClose = document.getElementById('serie-options-close');
    const btnConfirm = document.getElementById('btn-reset-progress');

    function openModal() {
        if (!overlay) return;
        overlay.style.display = 'flex';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (modal) { modal.style.opacity = '1'; modal.style.transform = 'scale(1)'; }
        }));
    }

    function closeModal() {
        if (!overlay) return;
        if (modal) { modal.style.opacity = '0'; modal.style.transform = 'scale(0.9)'; }
        setTimeout(() => overlay.style.display = 'none', 200);
    }

    if (btnReset)  btnReset.addEventListener('click', openModal);
    if (btnClose)  btnClose.addEventListener('click', closeModal);
    if (overlay)   overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    if (btnConfirm) {
        btnConfirm.addEventListener('click', async () => {
            // Mostrar spinner en el botón
            btnConfirm.disabled = true;
            btnConfirm.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                     style="animation: spin 0.7s linear infinite;">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <polyline points="3 3 3 8 8 8"/>
                </svg>
                Reseteando...`;

            // Pequeña pausa visual para que se vea el spinner
            await new Promise(r => setTimeout(r, 300));

            // 1. Limpiar localStorage de vistos y progreso
            localStorage.removeItem(WATCHED_KEY);
            const resumePrefix = 'wa_resume_' + SERIE.id + '_';
            const cwExact = 'cw_' + SERIE.id;
            const cwMetaExact = 'wa_cw_meta_' + SERIE.id;
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key) {
                    // Usar strict match (===) para cw_ y cw_meta_ para no borrar series con IDs que empiecen igual (ej: 12 y 123)
                    if (key.startsWith(resumePrefix) || key === cwExact || key === cwMetaExact) {
                        localStorage.removeItem(key);
                    }
                }
            }

            // 2. Animar cada episodio marcado como visto uno por uno
            const switches = Array.from(document.querySelectorAll('.ep-switch input:checked'));
            for (const input of switches) {
                const row = input.closest('.ep-item') || input.closest('.ep-switch');
                if (row) {
                    row.style.transition = 'opacity 0.25s, transform 0.25s';
                    row.style.opacity = '0.3';
                    row.style.transform = 'translateX(6px)';
                }
                input.checked = false;
                // Actualizar etiqueta
                const match = input.id && input.id.match(/switch-(\d+)-(\d+)/);
                if (match) {
                    const lbl = document.getElementById(`lbl-${match[1]}-${match[2]}`);
                    if (lbl) { lbl.textContent = 'Marcar visto'; lbl.classList.remove('on'); }
                }
                await new Promise(r => setTimeout(r, 60));
                if (row) {
                    row.style.opacity = '1';
                    row.style.transform = 'translateX(0)';
                }
            }

            // 3. Cerrar modal y restaurar botón
            closeModal();
            await new Promise(r => setTimeout(r, 220));
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = 'Resetear';
        });
    }
})();

/* Keyframe para el spinner del botón de reset */
(function() {
    if (!document.getElementById('reset-spin-style')) {
        const s = document.createElement('style');
        s.id = 'reset-spin-style';
        s.textContent = '@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }';
        document.head.appendChild(s);
    }
})();

// Escuchar la salida manual de pantalla completa globalmente para resetear el pending
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        window._pendingFullscreen = false;
    }
});
document.addEventListener('webkitfullscreenchange', () => {
    if (!document.webkitFullscreenElement) {
        window._pendingFullscreen = false;
    }
});

// ═══════════════════════════════════════════════════════════
// MODAL DE BRILLO EXTERNO (fuera del player, en #player-wrap)
// ═══════════════════════════════════════════════════════════
(function () {
    const PRESETS = [50, 75, 100, 150, 200];
    let _wolf = null;       // referencia al wolfInstance activo
    let _currentPct = 100;
    let _dialDragging = false;
    let _dialInitAngle = 0;
    let _dialInitVal = 100;

    // ── Inyectar CSS del modal externo ──────────────────────
    if (!document.getElementById('ext-brightness-style')) {
        const s = document.createElement('style');
        s.id = 'ext-brightness-style';
        s.textContent = `
#ext-brightness-overlay {
    position:absolute; inset:0; z-index:500;
    background:rgba(0,0,0,0.72);
    backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
    display:flex; align-items:center; justify-content:center;
    padding:12px; box-sizing:border-box;
    opacity:0; pointer-events:none;
    transition:opacity 0.22s ease;
}
#ext-brightness-overlay.show {
    opacity:1; pointer-events:auto;
}
#ext-brightness-panel {
    background:rgba(8,8,8,0.97);
    border:1.5px solid rgba(255,255,255,0.1);
    border-radius:18px;
    width:min(300px, calc(100% - 16px));
    max-height:calc(100vh - 20px);
    overflow:hidden auto;
    transform:scale(0.88) translateY(8px);
    transition:transform 0.25s cubic-bezier(0.34,1.5,0.64,1);
    box-shadow:0 16px 50px rgba(0,0,0,0.85),0 0 0 1px rgba(0,230,118,0.07),0 0 24px rgba(0,230,118,0.1);
    box-sizing:border-box;
}
#ext-brightness-overlay.show #ext-brightness-panel {
    transform:scale(1) translateY(0);
}
.ext-bri-header {
    display:flex; align-items:center; gap:10px;
    padding:14px 16px 12px;
    border-bottom:1px solid rgba(255,255,255,0.07);
    background:linear-gradient(to bottom,rgba(0,230,118,0.04),transparent);
}
.ext-bri-header svg { width:18px;height:18px;fill:#00E676;flex-shrink:0;filter:drop-shadow(0 0 5px rgba(0,230,118,0.6)); }
.ext-bri-header span { flex:1;font-size:14px;font-weight:800;color:#fff;letter-spacing:0.3px; }
.ext-bri-close {
    background:rgba(255,255,255,0.05);border:none;color:rgba(255,255,255,0.5);
    cursor:pointer;padding:0;border-radius:8px;display:flex;align-items:center;justify-content:center;
    width:30px;height:30px;flex-shrink:0;transition:background 0.2s,transform 0.15s;
}
.ext-bri-close:active { transform:scale(0.9); }
.ext-bri-close svg { width:16px;height:16px;fill:currentColor; }
.ext-bri-body {
    padding:16px 14px 18px;display:flex;flex-direction:column;align-items:center;gap:14px;box-sizing:border-box;
}
.ext-bri-dial-wrap {
    width:60%;max-width:170px;min-width:100px;aspect-ratio:1/1;
    cursor:grab;user-select:none;touch-action:none;position:relative;
}
.ext-bri-dial-wrap:active { cursor:grabbing; }
.ext-bri-dial-wrap svg { width:100%;height:100%;display:block;overflow:visible; }
.ext-bri-dial-wrap text { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
.ext-bri-presets {
    display:flex;gap:5px;flex-wrap:nowrap;justify-content:center;width:100%;box-sizing:border-box;
}
.ext-bri-presets button {
    background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.1);
    border-radius:8px;color:rgba(255,255,255,0.55);cursor:pointer;
    padding:6px 4px;font-size:11px;font-weight:700;font-family:inherit;
    transition:all 0.2s ease;flex:1;min-width:0;white-space:nowrap;box-sizing:border-box;
}
.ext-bri-presets button.active {
    background:rgba(0,230,118,0.15);border-color:#00E676;color:#00E676;
    box-shadow:0 0 10px rgba(0,230,118,0.4);
}
.ext-bri-presets button:active { transform:scale(0.95); }

/* Optimización para landscape en móviles */
@media (orientation: landscape) and (max-height: 600px) {
    #ext-brightness-overlay { padding:8px; }
    #ext-brightness-panel {
        width:min(480px, calc(100% - 16px));
        max-height:calc(100vh - 16px);
        border-radius:14px;
    }
    .ext-bri-header {
        padding:10px 14px 8px;
    }
    .ext-bri-header span {
        font-size:13px;
    }
    .ext-bri-close {
        width:26px;
        height:26px;
    }
    .ext-bri-body {
        padding:12px 14px 14px;
        flex-direction:row;
        flex-wrap:wrap;
        gap:12px;
    }
    .ext-bri-dial-wrap {
        width:45%;
        max-width:130px;
        min-width:90px;
    }
    .ext-bri-presets {
        width:calc(55% - 12px);
        flex-direction:column;
        gap:4px;
    }
    .ext-bri-presets button {
        padding:5px 8px;
        font-size:10px;
    }
}
        `;
        document.head.appendChild(s);
    }

    // ── Helpers del dial ────────────────────────────────────
    function valToArcLen(pct) {
        const R = 78, C = 2 * Math.PI * R;
        const frac = Math.max(0, Math.min(1, (pct - 10) / 190));
        return (frac * 270 / 360 * C).toFixed(2) + ' ' + C.toFixed(2);
    }
    const DASH_OFFSET = -((135 / 360) * 2 * Math.PI * 78).toFixed(2);
    function arcColor(pct) {
        if (pct < 50) return '#ff9800';
        if (pct > 150) return '#fff176';
        return '#00E676';
    }
    function buildDialHTML() {
        const C = (2 * Math.PI * 78).toFixed(2);
        const bgArc = ((270 / 360) * 2 * Math.PI * 78).toFixed(2);
        // Ticks
        let ticks = '';
        for (let i = 0; i <= 19; i++) {
            const val = 10 + i * 10;
            const angle = 135 + ((val - 10) / 190) * 270;
            const rad = angle * Math.PI / 180;
            const major = i % 5 === 0;
            const r1 = major ? 63 : 69, r2 = 76;
            const x1 = (100 + r1 * Math.cos(rad)).toFixed(1);
            const y1 = (100 + r1 * Math.sin(rad)).toFixed(1);
            const x2 = (100 + r2 * Math.cos(rad)).toFixed(1);
            const y2 = (100 + r2 * Math.sin(rad)).toFixed(1);
            ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)'}" stroke-width="${major ? 2 : 1}"/>`;
        }
        return `<svg viewBox="0 0 200 200" touch-action="none">
            <circle cx="100" cy="100" r="78" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14" stroke-linecap="round"
                stroke-dasharray="${bgArc} ${C}" stroke-dashoffset="${DASH_OFFSET}"/>
            <circle id="ext-dial-arc" cx="100" cy="100" r="78" fill="none" stroke="#00E676" stroke-width="14" stroke-linecap="round"
                stroke-dasharray="0 ${C}" stroke-dashoffset="${DASH_OFFSET}"
                style="filter:drop-shadow(0 0 8px rgba(0,230,118,0.6));transition:stroke 0.2s;"/>
            <g>${ticks}</g>
            <text x="100" y="97" text-anchor="middle" dominant-baseline="middle" fill="#00E676" font-size="34" font-weight="900" font-family="inherit" id="ext-dial-text">100</text>
            <text x="100" y="118" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="11" font-weight="600" font-family="inherit">BRILLO %</text>
            <text x="24" y="166" text-anchor="middle" fill="rgba(255,255,255,0.25)" font-size="9" font-family="inherit">10</text>
            <text x="176" y="166" text-anchor="middle" fill="rgba(255,255,255,0.25)" font-size="9" font-family="inherit">200</text>
        </svg>`;
    }
    function updateDialUI(pct) {
        const arc = document.getElementById('ext-dial-arc');
        const txt = document.getElementById('ext-dial-text');
        if (arc) {
            arc.setAttribute('stroke-dasharray', valToArcLen(pct));
            arc.style.stroke = arcColor(pct);
        }
        if (txt) txt.textContent = pct;
        document.querySelectorAll('.ext-bri-presets button').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.val) === pct);
        });
    }

    // ── Crear/mostrar overlay ────────────────────────────────
    function showExternalModal(wolf, initialVal) {
        _wolf = wolf;
        _currentPct = Math.round(initialVal * 100);

        const wrap = document.getElementById('player-wrap');
        if (!wrap) return;

        // Eliminar instancia previa si existía
        const prev = document.getElementById('ext-brightness-overlay');
        if (prev) prev.remove();

        const presetsHTML = PRESETS.map(v =>
            `<button class="ext-bri-preset-btn" data-val="${v}">${v}%</button>`
        ).join('');

        const overlay = document.createElement('div');
        overlay.id = 'ext-brightness-overlay';
        overlay.innerHTML = `
            <div id="ext-brightness-panel" role="dialog" aria-label="Brillo">
                <div class="ext-bri-header">
                    <svg viewBox="0 0 24 24"><path d="M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/></svg>
                    <span>Brillo</span>
                    <button class="ext-bri-close" id="ext-bri-close-btn" aria-label="Cerrar">
                        <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                </div>
                <div class="ext-bri-body">
                    <div class="ext-bri-dial-wrap" id="ext-bri-dial-wrap">${buildDialHTML()}</div>
                    <div class="ext-bri-presets">${presetsHTML}</div>
                </div>
            </div>`;

        wrap.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));
        updateDialUI(_currentPct);

        // Presets
        overlay.querySelectorAll('.ext-bri-preset-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const v = parseInt(btn.dataset.val);
                _currentPct = v;
                if (_wolf) _wolf.setBrightness(v / 100);
                updateDialUI(v);
            });
        });

        // Cerrar
        document.getElementById('ext-bri-close-btn').addEventListener('click', e => {
            e.stopPropagation();
            hideExternalModal();
        });
        overlay.addEventListener('click', e => {
            if (e.target === overlay) hideExternalModal();
        });

        // ── Drag dial ──────────────────────────────────────
        const dialWrap = document.getElementById('ext-bri-dial-wrap');
        function getAngle(e) {
            const rect = dialWrap.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const px = (e.touches ? e.touches[0].clientX : e.clientX) - cx;
            const py = (e.touches ? e.touches[0].clientY : e.clientY) - cy;
            return Math.atan2(py, px) * (180 / Math.PI);
        }
        const onDialStart = e => {
            e.preventDefault(); e.stopPropagation();
            _dialDragging = true;
            _dialInitAngle = getAngle(e);
            _dialInitVal = _currentPct;
        };
        const onDialMove = e => {
            if (!_dialDragging) return;
            e.preventDefault();
            let delta = getAngle(e) - _dialInitAngle;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            const newVal = Math.round(Math.max(10, Math.min(200, _dialInitVal + delta * 1.05)));
            if (newVal !== _currentPct) {
                _currentPct = newVal;
                if (_wolf) _wolf.setBrightness(newVal / 100);
                updateDialUI(newVal);
            }
        };
        const onDialEnd = () => { _dialDragging = false; };

        dialWrap.addEventListener('mousedown', onDialStart);
        dialWrap.addEventListener('touchstart', onDialStart, { passive: false });
        document.addEventListener('mousemove', onDialMove);
        document.addEventListener('touchmove', onDialMove, { passive: false });
        document.addEventListener('mouseup', onDialEnd);
        document.addEventListener('touchend', onDialEnd);

        // Guardar cleanup
        overlay._cleanup = () => {
            document.removeEventListener('mousemove', onDialMove);
            document.removeEventListener('touchmove', onDialMove);
            document.removeEventListener('mouseup', onDialEnd);
            document.removeEventListener('touchend', onDialEnd);
        };
    }

    function hideExternalModal() {
        const overlay = document.getElementById('ext-brightness-overlay');
        if (!overlay) return;
        if (overlay._cleanup) overlay._cleanup();
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 250);
        _wolf = null;
    }

    // ── Escuchar eventos del WolfPlayer ─────────────────────
    // Usamos delegación en document para capturar aunque el container cambie
    document.addEventListener('wolf:brightness:open', e => {
        e.preventDefault(); // Cancela el modal interno
        showExternalModal(e.detail.player, e.detail.value);
    });

    document.addEventListener('wolf:brightness:close', () => {
        hideExternalModal();
    });

    // Al cerrar el player, limpiar el modal si quedó abierto
    const origClosePlayer = window.closePlayer;
    if (typeof origClosePlayer === 'function') {
        window.closePlayer = function (...args) {
            hideExternalModal();
            return origClosePlayer.apply(this, args);
        };
    }
})();
