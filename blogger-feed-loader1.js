// ═══════════════════════════════════════════════════════════
// SISTEMA DE CARGA DE FEED DE BLOGGER PARA WOLF BLAZE
// ═══════════════════════════════════════════════════════════

window.BloggerFeedLoader = (function() {
    'use strict';

    // Configuración del feed de Blogger
    const BLOGGER_CONFIG = {
        blogUrl: 'https://kodamaviewer.blogspot.com/', // Tu URL de Blogger
        maxResults: 500, // Máximo de posts a obtener
        label: '', // Etiqueta específica (vacío = todos los posts)
    };

    // Cache en memoria
    let cachedData = null;
    let lastFetchTime = 0;
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

    /**
     * Construye la URL del feed de Blogger
     */
    function buildFeedUrl() {
        const params = new URLSearchParams({
            'alt': 'json',
            'max-results': BLOGGER_CONFIG.maxResults
        });

        if (BLOGGER_CONFIG.label) {
            params.append('category', BLOGGER_CONFIG.label);
        }

        return `${BLOGGER_CONFIG.blogUrl}/feeds/posts/default?${params.toString()}`;
    }

    /**
     * Extrae los datos desde meta tags en el HTML
     */
    function extractMetaData(htmlContent) {
        const metaData = {};
        
        // Expresión regular para capturar meta tags
        const metaRegex = /<meta\s+name=["']serie:([^"']+)["']\s+content=["']([^"']*)["']\s*\/?>/gi;
        let match;
        
        while ((match = metaRegex.exec(htmlContent)) !== null) {
            const key = match[1];
            const value = match[2];
            metaData[key] = value;
        }
        
        return metaData;
    }

    /**
     * Extrae los datos JSON-LD del contenido
     */
    function extractJSONLD(htmlContent) {
        try {
            const jsonldMatch = htmlContent.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
            if (jsonldMatch) {
                return JSON.parse(jsonldMatch[1]);
            }
        } catch (e) {
            console.warn('Error extrayendo JSON-LD:', e);
        }
        return null;
    }

    /**
     * Extrae los datos SERIE del contenido HTML de un post
     */
    function extractSerieData(htmlContent) {
        try {
            // Buscar el objeto SERIE en el contenido
            const serieMatch = htmlContent.match(/const\s+SERIE\s*=\s*(\{[\s\S]*?\});/);
            if (serieMatch) {
                // Evaluar el objeto de forma segura
                const serieStr = serieMatch[1];
                return eval('(' + serieStr + ')');
            }
        } catch (e) {
            console.warn('Error extrayendo datos SERIE:', e);
        }
        return null;
    }

    /**
     * Procesa una entrada del feed y extrae la información relevante
     */
    function processEntry(entry) {
        try {
            const title = entry.title?.$t || 'Sin título';
            const content = entry.content?.$t || '';
            const url = entry.link?.find(l => l.rel === 'alternate')?.href || '';
            const published = entry.published?.$t || '';
            const updated = entry.updated?.$t || '';
            
            // Extraer thumbnail si existe
            let thumbnail = '';
            if (entry.media$thumbnail?.url) {
                thumbnail = entry.media$thumbnail.url;
            }

            // Extraer categorías/tags (ETIQUETAS DE BLOGGER)
            const categories = entry.category?.map(cat => cat.term) || [];

            // Extraer datos de meta tags
            const metaData = extractMetaData(content);
            
            // Extraer JSON-LD
            const jsonld = extractJSONLD(content);
            
            // Extraer datos SERIE del contenido
            const serieData = extractSerieData(content);

            if (!serieData && !metaData.id) {
                console.warn('No se encontraron datos SERIE ni meta tags en:', title);
                return null;
            }

            // Construir objeto combinando todas las fuentes
            const processedData = {
                // Datos del feed de Blogger
                feedTitle: title,
                feedUrl: url,
                feedCategories: categories,
                feedPublished: published,
                feedUpdated: updated,
                feedThumbnail: thumbnail,
                
                // Datos combinados (prioridad: SERIE > meta > JSON-LD > feed)
                id: serieData?.id || metaData.id || title.toLowerCase().replace(/\s+/g, '-'),
                title: serieData?.title || metaData.title || jsonld?.name || title,
                type: serieData?.type || metaData.type || 'serie',
                description: serieData?.description || jsonld?.description || metaData.description || '',
                
                // Géneros desde etiquetas de Blogger (prioritario) o desde datos SERIE
                tags: categories.length > 0 ? categories : (serieData?.tags || []),
                category: categories.length > 0 ? categories.join(', ') : (serieData?.category || ''),
                genre: categories.length > 0 ? categories.join(', ') : (serieData?.genre || metaData.genre || ''),
                
                // Imágenes
                poster: serieData?.poster || metaData.poster || thumbnail || jsonld?.image || '',
                backdrop: serieData?.backdrop || metaData.backdrop || '',
                image: serieData?.image || metaData.image || 'linear-gradient(135deg,#1a1a2e,#16213e)',
                
                // Ratings y metadatos
                rating: serieData?.rating || metaData.rating || jsonld?.aggregateRating?.ratingValue || '0',
                date: serieData?.date || metaData.date || published.split('T')[0],
                readTime: serieData?.readTime || metaData.readTime || '',
                episodes: serieData?.episodes || parseInt(metaData.episodes) || 1,
                status: serieData?.status || metaData.status || 'En emisión',
                addedDate: serieData?.addedDate || updated.split('T')[0],
                
                // Cast y datos adicionales
                cast: serieData?.cast || [],
                featured: serieData?.featured !== undefined ? serieData.featured : (metaData.featured === 'true'),
                tmdbId: serieData?.tmdbId || metaData.tmdbId || '',
                
                // URLs y navegación
                url: url || serieData?.url,
                urlContinue: serieData?.urlContinue || url,
                backUrl: serieData?.backUrl || '',
                proxyUrl: serieData?.proxyUrl || '',
                
                // Temporadas (solo desde SERIE)
                seasons: serieData?.seasons || [],
            };

            return processedData;

        } catch (e) {
            console.error('Error procesando entrada:', e);
            return null;
        }
    }

    /**
     * Obtiene los datos del feed de Blogger
     */
    async function fetchBloggerFeed() {
        const now = Date.now();
        
        // Retornar cache si está vigente
        if (cachedData && (now - lastFetchTime) < CACHE_DURATION) {
            console.log('📦 Usando datos en cache');
            return cachedData;
        }

        try {
            console.log('🌐 Obteniendo feed de Blogger...');
            const feedUrl = buildFeedUrl();
            const response = await fetch(feedUrl);
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();
            const entries = data.feed?.entry || [];

            console.log(`✅ Feed obtenido: ${entries.length} posts`);

            // Procesar todas las entradas
            const processedData = entries
                .map(processEntry)
                .filter(item => item !== null); // Filtrar items inválidos

            console.log(`📊 Posts procesados: ${processedData.length}`);

            // Actualizar cache
            cachedData = processedData;
            lastFetchTime = now;

            return processedData;

        } catch (error) {
            console.error('❌ Error obteniendo feed:', error);
            
            // Si hay cache antiguo, usarlo como fallback
            if (cachedData) {
                console.warn('⚠️ Usando cache antiguo como fallback');
                return cachedData;
            }
            
            // Fallback a DATA estático si existe
            if (window.DATA) {
                console.warn('⚠️ Usando DATA estático como fallback');
                return window.DATA;
            }

            return [];
        }
    }

    /**
     * Genera configuración de categorías desde las etiquetas del feed
     */
    function generateCategoriesFromTags(data) {
        // Colores y configuraciones por defecto para categorías
        const categoryStyles = {
            "Acción": {color:"linear-gradient(135deg,#e63946,#e63946)",accent:"#e63946",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEhwp0PTMm8dLdkcnLHmxoH0QXrb4wRY2HrHoXfJXPiMOt2FaoXA7ELaSxVLmRWWV1qJ9rf5HIS7Bjkfnz9Kyg7MXx8R8Chh_km6Urf71ymSHG4aY7Ul2ATOdBTK6474glNd-LzlR8TFOyou0o2UAUmgjxZ_CN2sV8isxt4VT3YrqHcriBAXvX2_ksjSASE",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`},
            "Animación": {color:"linear-gradient(135deg,#a29bfe,#a29bfe)",accent:"#a29bfe",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEgbin7G4Op23keroN5_vv4C_Vyyq7j1A-mlZCU5URGyKHMzLCSFs-WRXRDcATQr3hgBN1wgbMRVeVfQTfuoHV3Y65iz_TjV_F1v471GSspntO--5CsGvJ0qgtKDQ5ZmSIpjtkXpLBOqSPlrJnJkeC2k0xbce3wYHvNN3ipn62Pu_KlLBVIbmjOcX6Bau8g",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>`},
            "Comedia": {color:"linear-gradient(135deg,#fdcb6e,#fdcb6e)",accent:"#fdcb6e",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEh_uJYD2pQvdGq8RXvgih_ILsiCUVk3PuAgXZRTkxWMuWVvAk8z4ISnV6DUUcyzGkEJE-jDLsEXxV856Dxy9QfqFPt5M30yhNFwQhBJWYBRMcc4OAYXRojc0dSJxv0p3vEo1HojtorlDx3KGr_Qj97rbyGUAmayAn-41vEI1tnvM1rSfCWPsG0iNzvucAM",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 13s1.5 3 4 3 4-3 4-3"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>`},
            "Drama": {color:"linear-gradient(135deg,#10b981,#10b981)",accent:"#10b981",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEhxdM3QhdygxC5WCdP19Mvc63TaYN9Wbu4k8kaZvTrssSU8OgvHNMo3ohpsLCauvjsCYRzy_PiPpcPNB0F9cXdVxwazWYs3ccfhdtMRcluIttKjSYdG6cSvPvNIfP0OBu35Ro0uXbeIYVv7idH5FRMmQ4zAisWVE_tSzsscqmlQGMMOtQN7_U8G3hsKmqk",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 15s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>`},
            "Terror": {color:"linear-gradient(135deg,#312e81,#312e81)",accent:"#312e81",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEj0qcRzUGNv1PWS7atBhAhCIBkCcaLsEkcXhTnYXXOERWm5yDJP8ARjPh9Ja-0CXq8paTd2BeAq3HXtsBC_DWxEggIYtfKg7rYIN2qykw7aBJH_-HSojAtYwmAWUw-D5W956yhPVCKN0HlJVJL2OkEHhUFQw6LZD-2-wdPSG2uiPvmK0f6AiNs2EkrC2zI",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>`},
            "Sci-Fi": {color:"linear-gradient(135deg,#74b9ff,#74b9ff)",accent:"#74b9ff",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEhuO6vvHCd06srnFP-aoqWzvArt8DLllN3qYI7ESkkqMgoGwr1cRu2e3TlbeLgCTnJvvmvLFjwqcQi8SLuvoUr3OCx0KpyftBwoWMSQORIpNFjM-pLliRk8FMc8RL5PcOVROrncn_ARr_oTqus8aaBWeSvOvhpYInwd0Z--Vpwg057Hhxj3Ed3eZIoS91s",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v4M12 19v4"></path></svg>`},
            "Romance": {color:"linear-gradient(135deg,#fd79a8,#fd79a8)",accent:"#fd79a8",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEiS5tctZ3u0bJUEwKDp3z0jEDLh6tos6iWj8-LBz_cVLjM6nDH4kMN54tNDuwCw52n1HJ1lhyuSaebChLOX8uyAf-yyZlUqoJaPiM7BlR9apg9NWzslcSG1e5U-MpGf--FALrXVo_PoTPquN4iNQvAiHhqECWyTCJE22aLR7qr69hTcU0jI1O3dGk83-bk",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`},
            "Suspenso": {color:"linear-gradient(135deg,#ef4444,#ef4444)",accent:"#ef4444",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEjUXbHM9ORYQB9v1WORa-s8G8xcEc5x8X4H0A7vUiwYnS5z8sdU-5jHWKwCzQ5Y9Fd-TRJtZXPWhgYt80wJCVw2BO5B8O5qx-QXwljqJEuiWZjASxRC2qVOLEtRpx-M4ii5NsHcXzWqIiCdTcMcBptwUHj2Yq_7WirSUYEm9B2kzub05XIJ6c7aXQeHBXQ",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>`},
            "Misterio": {color:"linear-gradient(135deg,#64748b,#64748b)",accent:"#64748b",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEiARD0KJyvi6arR60hqL_p8AtDIp-DInj7dxnK5VPrEo_AcKmKCSlRUJqzW_1oDs9XxxqVLm45Y6rzn-BWZjCyGUetHoYKwyZq32YMsWFHR0xk8PrgaCzgrHMlq4RpjtDfBVahtthDHEcW1XR6TCQv0mrUbUWztfJU7-3OUxqeV0YC4C_cv8SSPgXsRr-g",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`},
            "Crimen": {color:"linear-gradient(135deg,#450a0a,#450a0a)",accent:"#450a0a",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEjJcfkfsC6s1G7btG7v5kU4qioiOIR7xkVQTU1Z2Jbx94aBFiZiyakANom9P8gVt2aTk_LZn6rG39W_hnKK7uUYeyqX6ZgabSdsNdiT3AcwELI6370UI8_kp58yWUWsw7KnKkIMgYOhEwq73gV15SoEbTBWac9Phnjp9pwp7_soWcdbsvFL_VCLM38EVRs",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path></svg>`},
            "Aventura": {color:"linear-gradient(135deg,#00b894,#00b894)",accent:"#00b894",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEhVcuTBwDi7jC_6o94yuMtLwXeSwUyIMsgwccCwSNbX_Iat6lKD7HNeq3T-Z9Pi_t6RzJ4ItXYPfqQ6iIxvqbmWSWVRrCYSpCEI3gKzSUDGjJJIDOLPlrPgdwMyTCgJKGBxGi5H5-Hqk8UhHtcqFR5LSwsivhzAdpBEpRGDvzFWy3Uel2n6DF0YYpc8dSA",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>`},
            "Fantasía": {color:"linear-gradient(135deg,#a855f7,#a855f7)",accent:"#a855f7",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEhitFT6rJ2nk85oo_lKKAXMJytHYBhT6JxBCE-CR4lbry4TGwLjtcOQpI33yu8_jkz2-U0L98CEdMszVb-eab4ZND9EfxpWTrrZ7DqvanFtEjsvTy2Zq4MV7h0EjVfT4dT2Y_oczAcQAvjomt5eJL8yOM74hzy4otZXrCdmL53JhPkH1050OpURoELD4NY",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>`},
            "Documental": {color:"linear-gradient(135deg,#b45309,#b45309)",accent:"#b45309",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEiwd4mH9NFwemKckQr6yiq2tsatjFra4f7whI9voZUCH8aGxy06kIPhfl_7FK67rwXYL5DcyTu0FPuI6BmNhaL5lo-hbYr7fe8MInODMEuevB3th0wf0xjQUwYikrGUFcgK-s8Y2ei7Ijezlfka3UgfJ1QYTwE7aQB8d2GxE03jrFFkQJjpPOERIbbIj94",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>`},
            "Bélica": {color:"linear-gradient(135deg,#71717a,#71717a)",accent:"#71717a",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEipcqr70s8gyWSUeI8a9QC5vYCSMTs2Bt3Dl8Xh5WxDUsDhmVMp3DHdWza7vsZP-DQJX4McbNs-Dxf9iQJy7cXbgCuVbAG0cyb6l8qynaSIU3LqjbaXFWg5X9pzNeaJ-LrhQf1ow3S7zldOUKfLQuZ-E3a420PMDkHEpWHqpbL-7OKgAKavjB3SKLWo4IY",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>`},
            "Familia": {color:"linear-gradient(135deg,#06b6d4,#06b6d4)",accent:"#06b6d4",backdrop:"https://blogger.googleusercontent.com/img/a/AVvXsEiN18XrVW4cS_J1eOusn1mOOCg9KBTTYDgwCc5t46aC1wLMzE_TDy2qr_tfiHoSKQhEOU5pTgL1eJvE_EYSvgEk_v-FNOIIwJzPiud06Ha92CdCvlS0iqnkDBJYvSYcajzXirMZAPrjy3WsG0Ns8fX8t4PiZPEz6-nqi686ebSd5t1ZEm4CZvLIlPVMdxo",icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path></svg>`}
        };

        // Recopilar todas las etiquetas únicas
        const allTags = new Set();
        data.forEach(item => {
            if (item.feedCategories && Array.isArray(item.feedCategories)) {
                item.feedCategories.forEach(tag => allTags.add(tag));
            }
        });

        // Generar configuración de categorías
        const categories = [];
        allTags.forEach(tagName => {
            const style = categoryStyles[tagName] || {
                color: "linear-gradient(135deg,#6366f1,#6366f1)",
                accent: "#6366f1",
                backdrop: "",
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>`
            };

            categories.push({
                name: tagName,
                ...style
            });
        });

        return categories;
    }

    /**
     * Inicializa el sistema y reemplaza window.DATA
     */
    async function initialize() {
        try {
            const data = await fetchBloggerFeed();
            
            // Reemplazar window.DATA con los datos del feed
            window.DATA = data;
            
            // Generar y reemplazar CATEGORIES_CONFIG
            window.CATEGORIES_CONFIG = generateCategoriesFromTags(data);
            
            // Disparar evento personalizado para notificar que los datos están listos
            window.dispatchEvent(new CustomEvent('bloggerDataLoaded', {
                detail: { 
                    data: data, 
                    count: data.length,
                    categories: window.CATEGORIES_CONFIG
                }
            }));

            console.log('✨ Sistema de feed inicializado correctamente');
            console.log(`📊 ${data.length} series cargadas`);
            console.log(`🏷️ ${window.CATEGORIES_CONFIG.length} categorías generadas`);
            return data;

        } catch (error) {
            console.error('Error inicializando sistema de feed:', error);
            return [];
        }
    }

    /**
     * Fuerza una recarga del feed
     */
    function refresh() {
        cachedData = null;
        lastFetchTime = 0;
        return initialize();
    }

    /**
     * Configura una nueva URL de blog
     */
    function setBlogUrl(url) {
        BLOGGER_CONFIG.blogUrl = url;
        return refresh();
    }

    /**
     * Configura un filtro por etiqueta
     */
    function setLabel(label) {
        BLOGGER_CONFIG.label = label;
        return refresh();
    }

    // API pública
    return {
        initialize,
        refresh,
        setBlogUrl,
        setLabel,
        getData: () => cachedData || [],
        isReady: () => cachedData !== null
    };

})();

// Auto-inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        BloggerFeedLoader.initialize();
    });
} else {
    BloggerFeedLoader.initialize();
}
