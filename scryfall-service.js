'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   STEP 0: SCRYFALL LIVE API SERVICE, NULL-SAFE IMAGE HELPER & DEBUG PANEL (D)
════════════════════════════════════════════════════════════════════════════ */
const ScryfallService = (() => {
  const API_BASE = 'https://api.scryfall.com';
  const CDN_BASE = 'https://cards.scryfall.io/';

  // Embedded SVG fallback card-back so it never 404s or gets blocked by CORS
  const FALLBACK_CARD_BACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350">
      <rect width="250" height="350" rx="14" fill="#0d0918" stroke="#c8922a" stroke-width="4"/>
      <rect x="14" y="14" width="222" height="322" rx="10" fill="#17102a" stroke="#6b4c1b" stroke-width="2"/>
      <ellipse cx="125" cy="175" rx="72" ry="98" fill="#0b0714" stroke="#c8922a" stroke-width="3"/>
      <circle cx="125" cy="175" r="28" fill="none" stroke="#e8b84b" stroke-width="2"/>
      <text x="125" y="180" text-anchor="middle" fill="#e8b84b" font-family="serif" font-size="16" font-weight="bold">MAGIC</text>
    </svg>
  `);

  // In-memory resolved card cache by normalized name
  const memoryCache = new Map();

  // Debug telemetry state (toggled with 'D' key)
  const debugStats = {
    requested: 0,
    resolved: 0,
    failed: 0,
    failedNames: [],
    firstImageUrl: 'None yet',
    lastBatchStatus: 'Idle',
    panelVisible: false,
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fixes any relative/shorthand Scryfall path (preventing the /normal/front/normal/front/ bug)
   */
  function normalizeScryfallUrl(rawPath, defaultFolder = 'normal/front/') {
    if (!rawPath || typeof rawPath !== 'string') return '';
    const trimmed = rawPath.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      // Repair any legacy duplicated path segments if present
      return trimmed
        .replace('/normal/front/normal/front/', '/normal/front/')
        .replace('/art_crop/front/art_crop/front/', '/art_crop/front/')
        .replace('/normal/front/art_crop/front/', '/art_crop/front/');
    }

    // If the shorthand already starts with 'normal/' or 'art_crop/' or 'large/', prepend only domain
    if (
      trimmed.startsWith('normal/') ||
      trimmed.startsWith('art_crop/') ||
      trimmed.startsWith('large/') ||
      trimmed.startsWith('small/') ||
      trimmed.startsWith('png/')
    ) {
      return CDN_BASE + trimmed;
    }

    // Otherwise it's a bare '<dir1>/<dir2>/<uuid>.jpg' path
    return CDN_BASE + defaultFolder + trimmed.replace(/^\/+/, '');
  }

  /**
   * STEP 0.2: Null-safe helper getCardImage(card, faceIndex) used EVERYWHERE.
   * Supports:
   * - Standard Scryfall API single-faced cards: card.image_uris.normal
   * - Double-faced Scryfall API cards (transform, modal_dfc, reversible_card):
   *   card.card_faces[faceIndex].image_uris.normal
   * - Normalized local commander/pool cards (card.image / card.back_image / card.i / card.bi)
   * - Fallback card-back image if anything is missing.
   */
  function getCardImage(card, faceIndex = 0) {
    if (!card) return FALLBACK_CARD_BACK;

    let url = '';

    // 1. Check standard Scryfall card_faces first if faceIndex > 0 or if top-level image_uris is absent
    if (Array.isArray(card.card_faces) && card.card_faces.length > 0) {
      const targetFace = card.card_faces[faceIndex] || card.card_faces[0];
      if (targetFace && targetFace.image_uris && targetFace.image_uris.normal) {
        url = targetFace.image_uris.normal;
      }
    }

    // 2. Check top-level Scryfall image_uris (single-faced cards)
    if (!url && faceIndex === 0 && card.image_uris && card.image_uris.normal) {
      url = card.image_uris.normal;
    }

    // 3. Check normalized app properties (face 1 = back_image / bi, face 0 = image / i)
    if (!url) {
      if (faceIndex === 1) {
        url = normalizeScryfallUrl(card.back_image || card.bi || '');
      }
      if (!url) {
        url = normalizeScryfallUrl(card.image || card.i || '');
      }
    }

    const finalUrl = normalizeScryfallUrl(url);
    if (finalUrl && debugStats.firstImageUrl === 'None yet') {
      debugStats.firstImageUrl = finalUrl;
      updateDebugPanel();
    }

    return finalUrl || FALLBACK_CARD_BACK;
  }

  /**
   * Null-safe helper to check if a card has 2 faces (transform, modal_dfc, reversible_card)
   */
  function isDoubleFaced(card) {
    if (!card) return false;
    if (Array.isArray(card.card_faces) && card.card_faces.length > 1) {
      return Boolean(card.card_faces[1]?.image_uris?.normal);
    }
    return Boolean(card.back_image || card.bi);
  }

  /**
   * Normalizes a raw Scryfall API card object into our unified tabletop card schema
   */
  function normalizeApiCard(apiCard) {
    if (!apiCard) return null;
    const face0 = Array.isArray(apiCard.card_faces) ? apiCard.card_faces[0] : null;
    const face1 = Array.isArray(apiCard.card_faces) && apiCard.card_faces.length > 1 ? apiCard.card_faces[1] : null;

    const frontImg = apiCard.image_uris?.normal || face0?.image_uris?.normal || '';
    const backImg  = face1?.image_uris?.normal || '';
    const artCrop  = apiCard.image_uris?.art_crop || face0?.image_uris?.art_crop || frontImg;

    const oracleText = apiCard.oracle_text ||
      (Array.isArray(apiCard.card_faces)
        ? apiCard.card_faces.map(f => `${f.name}: ${f.oracle_text || ''}`).join('\n//\n')
        : '');

    const typeLine = apiCard.type_line || face0?.type_line || '';
    const manaCost = apiCard.mana_cost || face0?.mana_cost || '';
    const pt = apiCard.power !== undefined && apiCard.toughness !== undefined
      ? `${apiCard.power}/${apiCard.toughness}`
      : (face0?.power !== undefined && face0?.toughness !== undefined ? `${face0.power}/${face0.toughness}` : '');

    const tokens = [];
    if (Array.isArray(apiCard.all_parts)) {
      apiCard.all_parts.forEach(p => {
        if (p.component === 'token' && p.id) {
          tokens.push({
            name: (p.name || 'Token').replace(/ Token$/i, ''),
            type_line: p.type_line || 'Token',
            image: `https://cards.scryfall.io/normal/front/${p.id[0]}/${p.id[1]}/${p.id}.jpg`,
          });
        }
      });
    }

    const normalized = {
      id: apiCard.id || apiCard.name,
      name: apiCard.name,
      type_line: typeLine,
      mana_cost: manaCost,
      cmc: apiCard.cmc ?? 0,
      color_identity: apiCard.color_identity || [],
      oracle_text: oracleText,
      power_toughness: pt,
      image_uris: apiCard.image_uris || null,
      card_faces: apiCard.card_faces || null,
      image: frontImg,
      back_image: backImg || null,
      art_crop: artCrop,
      isLand: typeLine.includes('Land'),
      tokens,
    };

    const frontResolved = getCardImage(normalized, 0);
    if (frontResolved && frontResolved !== FALLBACK_CARD_BACK) {
      debugStats.resolved++;
    }
    return normalized;
  }

  /**
   * STEP 0.1: Live Scryfall API batch resolver:
   * - POST https://api.scryfall.com/cards/collection with {"identifiers":[{"name":"Sol Ring"}, ...]}
   *   in batches of 75
   * - Sends Accept: application/json header
   * - Waits 100 ms between requests
   * - Uses GET /cards/named?fuzzy= as fallback for any unresolved names
   */
  async function resolveCardNames(cardNames) {
    const cleanNames = (cardNames || [])
      .map(n => String(n || '').trim())
      .filter(Boolean);

    if (!cleanNames.length) return [];

    debugStats.requested += cleanNames.length;
    debugStats.lastBatchStatus = `Resolving ${cleanNames.length} cards...`;
    updateDebugPanel();

    const uniqueToFetch = [];
    const seen = new Set();

    for (const rawName of cleanNames) {
      const key = rawName.toLowerCase();
      if (!memoryCache.has(key) && !seen.has(key)) {
        seen.add(key);
        uniqueToFetch.push(rawName);
      } else if (memoryCache.has(key)) {
        debugStats.resolved++;
      }
    }

    // Process in batches of 75 via POST /cards/collection
    const BATCH_SIZE = 75;
    const unresolvedNames = [];

    for (let i = 0; i < uniqueToFetch.length; i += BATCH_SIZE) {
      const batch = uniqueToFetch.slice(i, i + BATCH_SIZE);
      const payload = {
        identifiers: batch.map(name => ({ name: name.split(' // ')[0].trim() })),
      };

      try {
        const res = await fetch(`${API_BASE}/cards/collection`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          console.error(`[ScryfallService] POST /cards/collection failed with HTTP ${res.status}`);
          unresolvedNames.push(...batch);
        } else {
          const json = await res.json();
          const foundCards = json.data || [];
          const notFound   = json.not_found || [];

          foundCards.forEach(apiCard => {
            const norm = normalizeApiCard(apiCard);
            if (norm) {
              memoryCache.set(norm.name.toLowerCase(), norm);
              const frontHalf = norm.name.split(' // ')[0].toLowerCase().trim();
              memoryCache.set(frontHalf, norm);
            }
          });

          notFound.forEach(nf => {
            if (nf && nf.name) unresolvedNames.push(nf.name);
          });
        }
      } catch (err) {
        console.error('[ScryfallService] Network error in POST /cards/collection:', err);
        unresolvedNames.push(...batch);
      }

      // Wait 100 ms between requests per Scryfall rate-limit policy
      await sleep(100);
    }

    // Fallback: GET /cards/named?fuzzy= for any unresolved names
    for (const missingName of unresolvedNames) {
      try {
        const res = await fetch(`${API_BASE}/cards/named?fuzzy=${encodeURIComponent(missingName)}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) {
          recordFailure(missingName, `GET /cards/named?fuzzy=${missingName} -> HTTP ${res.status}`);
        } else {
          const apiCard = await res.json();
          const norm = normalizeApiCard(apiCard);
          if (norm) {
            memoryCache.set(missingName.toLowerCase(), norm);
            memoryCache.set(norm.name.toLowerCase(), norm);
          } else {
            recordFailure(missingName, 'Empty card object in fuzzy fallback');
          }
        }
      } catch (err) {
        recordFailure(missingName, err.message || 'Fetch error in fuzzy fallback');
      }
      await sleep(100);
    }

    debugStats.lastBatchStatus = 'Complete';
    updateDebugPanel();

    // Return resolved cards in the exact order requested
    return cleanNames.map((name, idx) => {
      const key = name.toLowerCase();
      const frontKey = key.split(' // ')[0].trim();
      const cached = memoryCache.get(key) || memoryCache.get(frontKey);
      if (cached) {
        return {
          ...cached,
          uid: `card_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          faceIndex: 0,
          tapped: false,
          counters: 0,
        };
      }
      // Return safe fallback card object with name so it renders an error placeholder
      return {
        uid: `missing_${Date.now()}_${idx}`,
        id: name,
        name,
        type_line: 'Unknown Card',
        oracle_text: 'Card could not be resolved from Scryfall.',
        image: '',
        isLand: /land|plains|island|swamp|mountain|forest|wastes/i.test(name),
        faceIndex: 0,
        tapped: false,
        counters: 0,
      };
    });
  }

  function recordFailure(cardName, reason) {
    debugStats.failed++;
    if (debugStats.failedNames.length < 15 && !debugStats.failedNames.includes(cardName)) {
      debugStats.failedNames.push(cardName);
    }
    console.error(`[ScryfallService] Failed to resolve card "${cardName}": ${reason}`);
    updateDebugPanel();
  }

  /**
   * STEP 0.3 & 0.6: Creates a 5:7 card image wrapper with:
   * - Loading skeleton while the image loads
   * - Error placeholder displaying the card's name if the image fails
   * - Console error logging on every image failure
   */
  function createCardMediaElement(card, faceIndex = 0) {
    const container = document.createElement('div');
    container.className = 'pg-card-media is-loading';

    const imgUrl = getCardImage(card, faceIndex);
    const img = document.createElement('img');
    img.className = 'pg-card-img';
    img.alt = card?.name || 'Magic Card';
    img.decoding = 'async';

    img.addEventListener('load', () => {
      container.classList.remove('is-loading');
    });

    img.addEventListener('error', () => {
      container.classList.remove('is-loading');
      container.classList.add('is-error');
      const failedName = card?.name || 'Unknown Card';
      recordFailure(failedName, `Image failed to load: ${img.src}`);
      container.innerHTML = `
        <div class="pg-card-error-fallback">
          <span class="pg-err-icon">⚠️</span>
          <span class="pg-err-name">${escapeHtml(failedName)}</span>
        </div>
      `;
    });

    img.src = imgUrl;
    container.appendChild(img);
    return container;
  }

  /**
   * Registers local preloaded cards into the normalised format (fixing the duplicate normal/front/ bug)
   */
  function registerLocalCard(raw) {
    if (!raw) return null;
    const frontUrl = normalizeScryfallUrl(raw.image || raw.i || '', 'normal/front/');
    const backUrl  = normalizeScryfallUrl(raw.back_image || raw.bi || '', 'normal/front/');
    const cropUrl  = normalizeScryfallUrl(raw.art_crop || raw.a || frontUrl, 'art_crop/front/');

    const card = {
      id: raw.id || raw.n || raw.name,
      name: raw.n || raw.name || 'Unknown',
      type_line: raw.t || raw.type_line || '',
      mana_cost: raw.m || raw.mana_cost || '',
      cmc: raw.cmc ?? 0,
      color_identity: raw.ci || raw.color_identity || [],
      oracle_text: raw.o || raw.oracle_text || '',
      power_toughness: raw.pt || raw.power_toughness || '',
      edhrec_rank: raw.r ?? raw.edhrec_rank ?? 9999,
      partnerType: raw.p || raw.partnerType || null,
      image_uris: frontUrl ? { normal: frontUrl, art_crop: cropUrl } : null,
      card_faces: backUrl
        ? [
            { name: (raw.n || raw.name || '').split(' // ')[0], image_uris: { normal: frontUrl } },
            { name: (raw.n || raw.name || '').split(' // ')[1] || 'Back', image_uris: { normal: backUrl } },
          ]
        : null,
      image: frontUrl,
      back_image: backUrl || null,
      art_crop: cropUrl,
      isLand: (raw.t || raw.type_line || '').includes('Land'),
      tokens: (raw.tk || raw.tokens || []).map(t => ({
        name: t.n || t.name || 'Token',
        type_line: t.t || t.type_line || 'Token',
        image: normalizeScryfallUrl(t.i || t.image || '', 'normal/front/'),
      })),
    };

    debugStats.requested++;
    if (frontUrl) {
      debugStats.resolved++;
      if (debugStats.firstImageUrl === 'None yet') {
        debugStats.firstImageUrl = frontUrl;
      }
      memoryCache.set(card.name.toLowerCase(), card);
    } else {
      recordFailure(card.name, 'Missing local image path');
    }
    return card;
  }

  /**
   * STEP 0.5: Visible Debug Panel (toggle with the 'D' key)
   */
  function initDebugPanel() {
    if (document.getElementById('scryfallDebugPanel')) return;
    const panel = document.createElement('div');
    panel.id = 'scryfallDebugPanel';
    panel.className = 'sf-debug-panel';
    panel.style.display = 'none';
    document.body.appendChild(panel);

    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === 'd' || e.key === 'D') {
        debugStats.panelVisible = !debugStats.panelVisible;
        panel.style.display = debugStats.panelVisible ? 'block' : 'none';
        updateDebugPanel();
      }
    });

    updateDebugPanel();
  }

  function toggleDebugPanel() {
    const panel = document.getElementById('scryfallDebugPanel');
    if (!panel) return;
    debugStats.panelVisible = !debugStats.panelVisible;
    panel.style.display = debugStats.panelVisible ? 'block' : 'none';
    updateDebugPanel();
  }

  function updateDebugPanel() {
    const panel = document.getElementById('scryfallDebugPanel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="sf-dbg-head">
        <span>🐞 SCRYFALL DEBUG PANEL (Touche D)</span>
        <button id="sfDbgCloseBtn" class="sf-dbg-close">✕</button>
      </div>
      <div class="sf-dbg-body">
        <div><b>Status :</b> <span>${escapeHtml(debugStats.lastBatchStatus)}</span></div>
        <div><b>Cards Requested :</b> <span style="color:#93c5fd">${debugStats.requested}</span></div>
        <div><b>Cards Resolved :</b> <span style="color:#34d399">${debugStats.resolved}</span></div>
        <div><b>Cards Failed :</b> <span style="color:${debugStats.failed > 0 ? '#f87171' : '#a7f3d0'}">${debugStats.failed}</span></div>
        <div><b>First Failed Names :</b> <span style="color:#fca5a5">${debugStats.failedNames.length ? escapeHtml(debugStats.failedNames.join(', ')) : 'None (0 failed)'}</span></div>
        <div style="word-break:break-all"><b>First Image URL Used :</b><br/><a href="${escapeHtml(debugStats.firstImageUrl)}" target="_blank" rel="noopener" style="color:#fde047;font-size:.66rem">${escapeHtml(debugStats.firstImageUrl)}</a></div>
        <div style="margin-top:.45rem;display:flex;gap:.4rem">
          <button id="sfDbgTestApiBtn" class="sf-dbg-btn">⚡ Test Live POST /cards/collection</button>
        </div>
      </div>
    `;
    panel.querySelector('#sfDbgCloseBtn')?.addEventListener('click', toggleDebugPanel);
    panel.querySelector('#sfDbgTestApiBtn')?.addEventListener('click', async () => {
      await resolveCardNames(['Sol Ring', 'Delver of Secrets', 'Command Tower', 'Arcane Signet']);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    FALLBACK_CARD_BACK,
    getCardImage,
    isDoubleFaced,
    normalizeScryfallUrl,
    resolveCardNames,
    registerLocalCard,
    createCardMediaElement,
    initDebugPanel,
    toggleDebugPanel,
    getStats: () => ({ ...debugStats }),
  };
})();
window.ScryfallService = ScryfallService;
