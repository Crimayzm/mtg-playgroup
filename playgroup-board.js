'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PHASE A: MODULAR PLAYGROUP LIVE BOARD ENGINE
   Components: Board, PlayerArea, Zone, Card, Stack, PlayerPanel, PreviewPanel
════════════════════════════════════════════════════════════════════════════ */
const PlaygroupBoard = (() => {
  const AVATAR_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899'];
  const PHASES = ['Untap', 'Upkeep', 'Draw', 'Main 1', 'Combat', 'Main 2', 'End'];

  let stateRef = null; // Reference to global S state
  let onStateChangeCallback = null;
  let hoveredCard = null;
  let previewFaceIdx = 0;
  let zoomedSeatIdx = null;
  let currentPhaseIdx = 3; // 'Main 1'

  /**
   * Component 1: Card
   * Renders a 5:7 card using ScryfallService.createCardMediaElement(card, faceIndex)
   * with hover preview binding and optional attached cards shelf.
   */
  function createCardComponent(card, options = {}) {
    const faceIdx = card.faceIndex || 0;
    const cardEl = document.createElement('div');
    cardEl.className = 'pg-card' + (card.tapped ? ' is-tapped' : '');
    cardEl.dataset.uid = card.uid || card.id || '';

    const mediaEl = ScryfallService.createCardMediaElement(card, faceIdx);
    cardEl.appendChild(mediaEl);

    // Hover -> show in Fixed Side Preview Panel
    if (!options.isFaceDown) {
      cardEl.addEventListener('pointerenter', () => {
        setPreviewCard(card);
      });
    }

    if (typeof options.onClick === 'function') {
      cardEl.addEventListener('click', e => {
        e.stopPropagation();
        options.onClick(card, e);
      });
    }

    // If card has attached cards (Auras / Equipment), wrap with shelf next to permanent
    if (Array.isArray(card.attachments) && card.attachments.length > 0) {
      const wrapper = document.createElement('div');
      wrapper.className = 'pg-card-with-attachments';
      wrapper.appendChild(cardEl);

      const shelf = document.createElement('div');
      shelf.className = 'pg-attached-shelf';
      card.attachments.forEach(att => {
        shelf.appendChild(createCardComponent(att, { onClick: options.onAttachmentClick }));
      });
      wrapper.appendChild(shelf);
      return wrapper;
    }

    return cardEl;
  }

  /**
   * Component 2: PreviewPanel
   * Fixed side panel showing large card image, oracle text, and flip toggle for DFCs.
   */
  function setPreviewCard(card) {
    if (!card) return;
    if (hoveredCard !== card) {
      hoveredCard = card;
      previewFaceIdx = card.faceIndex || 0;
    }
    renderPreviewPanel();
  }

  function renderPreviewPanel() {
    const container = document.getElementById('pgPreviewPanel');
    if (!container) return;

    if (!hoveredCard) {
      container.innerHTML = `
        <div style="margin:auto;text-align:center;color:#64748b;font-size:.66rem">
          Survolez n'importe quelle carte visible pour l'inspecter ici.
        </div>
      `;
      return;
    }

    const hasBack = ScryfallService.isDoubleFaced(hoveredCard);
    const typeLine = hoveredCard.type_line || '';
    const oracle = hoveredCard.oracle_text || 'Aucun texte Oracle.';
    const pt = hoveredCard.power_toughness ? ` · ${hoveredCard.power_toughness}` : '';

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.4rem">
        <div style="font-size:.7rem;font-weight:700;color:#fde047;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escapeHtml(hoveredCard.name)}
        </div>
        ${hasBack ? `<button id="pgBtnFlipPreview" class="btn-s" style="padding:.18rem .48rem;font-size:.54rem">🔄 Flip Face</button>` : ''}
      </div>
      <div class="pg-preview-card-stage" id="pgPreviewStage"></div>
      <div style="font-size:.58rem;color:#94a3b8">${escapeHtml(typeLine)}${escapeHtml(pt)}</div>
      <div class="pg-preview-oracle">${escapeHtml(oracle)}</div>
    `;

    const stage = container.querySelector('#pgPreviewStage');
    if (stage) {
      stage.appendChild(ScryfallService.createCardMediaElement(hoveredCard, previewFaceIdx));
    }

    const flipBtn = container.querySelector('#pgBtnFlipPreview');
    if (flipBtn) {
      flipBtn.addEventListener('click', () => {
        previewFaceIdx = previewFaceIdx === 0 ? 1 : 0;
        renderPreviewPanel();
      });
    }
  }

  /**
   * Component 3: PlayerPanel
   * Displays player name, avatar color, voice indicator, life total, poison, rad,
   * energy, experience, commander tax, and commander damage from each opponent.
   */
  function createPlayerPanelComponent(seat, seatIdx, allSeats, isMe) {
    const panel = document.createElement('div');
    panel.className = 'pg-player-panel';
    const avatarColor = AVATAR_COLORS[seatIdx % AVATAR_COLORS.length];

    const cmdDmgSummary = allSeats
      .map((opp, oIdx) => {
        const dmg = (seat.cmdDmg && seat.cmdDmg[oIdx]) || 0;
        return `<span title="Dégâts de Commandant de ${escapeHtml(opp.player)}">C${oIdx + 1}:${dmg}</span>`;
      })
      .join(' · ');

    panel.innerHTML = `
      <div class="pg-player-id">
        <span class="pg-avatar-dot" style="background:${avatarColor}"></span>
        <span class="pg-voice-dot" title="Audio/Réseau Connecté"></span>
        <strong style="color:#f8fafc;font-size:.7rem">${escapeHtml(seat.player)}</strong>
        ${isMe ? '<span style="font-size:.52rem;color:#fde047">(Vous)</span>' : ''}
        <span style="font-size:.56rem;color:#94a3b8">✋ Main: <b>${seat.hand?.length || 0}</b></span>
      </div>

      <div class="pg-counters-bar">
        <span class="pg-stat-chip life" title="Points de Vie">❤️ ${seat.hp ?? 40}</span>
        <span class="pg-stat-chip" title="Poison (10 = Létal)">☣️ ${seat.poison ?? 0}</span>
        <span class="pg-stat-chip" title="Radiation">☢️ ${seat.rad ?? 0}</span>
        <span class="pg-stat-chip" title="Énergie">⚡ ${seat.energy ?? 0}</span>
        <span class="pg-stat-chip" title="Expérience">🌟 ${seat.exp ?? 0}</span>
        <span class="pg-stat-chip" title="Taxe de Commandant">👑 +${seat.cmdTax ?? 0}</span>
        <span class="pg-stat-chip" title="Dégâts de Commandant par adversaire">⚔️ ${cmdDmgSummary}</span>
        ${!isMe ? `<button class="btn-s pg-btn-zoom-opp" style="padding:.12rem .4rem;font-size:.52rem">${zoomedSeatIdx === seatIdx ? '🗕 Réduire' : '🔍 Zoom'}</button>` : ''}
      </div>
    `;

    const zoomBtn = panel.querySelector('.pg-btn-zoom-opp');
    if (zoomBtn) {
      zoomBtn.addEventListener('click', e => {
        e.stopPropagation();
        zoomedSeatIdx = zoomedSeatIdx === seatIdx ? null : seatIdx;
        renderBoard();
      });
    }

    return panel;
  }

  /**
   * Component 4: Zone (Command Zone, Library, Graveyard, Exile)
   */
  function createSideZonesComponent(seat, isMe) {
    const sideWrap = document.createElement('div');
    sideWrap.className = 'pg-side-zones';

    // 4A. Command Zone (with Commander Tax)
    const cmdSlot = document.createElement('div');
    cmdSlot.className = 'pg-zone-slot';
    cmdSlot.innerHTML = `<div class="pg-zone-title">Command (+${seat.cmdTax ?? 0})</div>`;
    const cmdPile = document.createElement('div');
    cmdPile.className = 'pg-zone-pile';

    if (seat.commander && seat.cmdInZone !== false) {
      const cmdCardEl = createCardComponent(seat.commander, {
        onClick: () => {
          if (!isMe) return;
          // Phase A: Click Commander in Command Zone to put onto Battlefield
          seat.cmdInZone = false;
          seat.battlefield.push({
            ...seat.commander,
            uid: `bf_cmd_${Date.now()}`,
            isCommander: true,
            tapped: false,
            counters: 0,
          });
          notifyStateChanged();
        },
      });
      cmdPile.appendChild(cmdCardEl);
    }
    const taxBadge = document.createElement('div');
    taxBadge.className = 'pg-zone-count-badge';
    taxBadge.textContent = `+${seat.cmdTax ?? 0}`;
    cmdPile.appendChild(taxBadge);
    cmdSlot.appendChild(cmdPile);
    sideWrap.appendChild(cmdSlot);

    // 4B. Library (Card Back + Count)
    const libSlot = document.createElement('div');
    libSlot.className = 'pg-zone-slot';
    libSlot.innerHTML = `<div class="pg-zone-title">Library</div>`;
    const libPile = document.createElement('div');
    libPile.className = 'pg-zone-pile';
    libPile.title = isMe ? 'Cliquez pour piocher 1 carte' : 'Bibliothèque adverse';

    const backCard = {
      name: 'Library Card Back',
      image: ScryfallService.FALLBACK_CARD_BACK,
    };
    const libCardEl = createCardComponent(backCard, {
      isFaceDown: true,
      onClick: () => {
        if (!isMe || !seat.library || !seat.library.length) return;
        seat.hand.push(seat.library.shift());
        notifyStateChanged();
      },
    });
    libPile.appendChild(libCardEl);

    const libCount = document.createElement('div');
    libCount.className = 'pg-zone-count-badge';
    libCount.textContent = String(seat.library?.length ?? seat.libraryCount ?? 0);
    libPile.appendChild(libCount);
    libSlot.appendChild(libPile);
    sideWrap.appendChild(libSlot);

    // 4C. Graveyard (Top card visible + Count)
    const gySlot = document.createElement('div');
    gySlot.className = 'pg-zone-slot';
    gySlot.innerHTML = `<div class="pg-zone-title">Graveyard</div>`;
    const gyPile = document.createElement('div');
    gyPile.className = 'pg-zone-pile';
    const gyList = seat.graveyard || [];
    if (gyList.length > 0) {
      gyPile.appendChild(createCardComponent(gyList[gyList.length - 1]));
    }
    const gyCount = document.createElement('div');
    gyCount.className = 'pg-zone-count-badge';
    gyCount.textContent = String(gyList.length);
    gyPile.appendChild(gyCount);
    gySlot.appendChild(gyPile);
    sideWrap.appendChild(gySlot);

    // 4D. Exile (Top card visible + Count)
    const exSlot = document.createElement('div');
    exSlot.className = 'pg-zone-slot';
    exSlot.innerHTML = `<div class="pg-zone-title">Exile</div>`;
    const exPile = document.createElement('div');
    exPile.className = 'pg-zone-pile';
    const exList = seat.exile || [];
    if (exList.length > 0) {
      exPile.appendChild(createCardComponent(exList[exList.length - 1]));
    }
    const exCount = document.createElement('div');
    exCount.className = 'pg-zone-count-badge';
    exCount.textContent = String(exList.length);
    exPile.appendChild(exCount);
    exSlot.appendChild(exPile);
    sideWrap.appendChild(exSlot);

    return sideWrap;
  }

  /**
   * Component 5: Battlefield (Organized into 3 Non-Overlapping Rows:
   * Row 1: Creatures | Row 2: Other Permanents | Row 3: Lands)
   */
  function createBattlefieldComponent(seat, isMe) {
    const bfWrap = document.createElement('div');
    bfWrap.className = 'pg-battlefield-rows';

    const permanents = seat.battlefield || [];
    const creatures = [];
    const otherPerms = [];
    const lands = [];

    permanents.forEach(card => {
      const tl = card.type_line || '';
      if (card.isLand || tl.includes('Land')) {
        lands.push(card);
      } else if (tl.includes('Creature')) {
        creatures.push(card);
      } else {
        otherPerms.push(card);
      }
    });

    const rowsConfig = [
      { label: 'Creatures', items: creatures },
      { label: 'Other Permanents', items: otherPerms },
      { label: 'Lands', items: lands },
    ];

    rowsConfig.forEach(rowCfg => {
      const rowEl = document.createElement('div');
      rowEl.className = 'pg-bf-row';
      rowEl.innerHTML = `<span class="pg-bf-row-label">${rowCfg.label} (${rowCfg.items.length})</span>`;

      rowCfg.items.forEach(card => {
        const cardComp = createCardComponent(card, {
          onClick: clickedCard => {
            if (!isMe) return;
            clickedCard.tapped = !clickedCard.tapped;
            notifyStateChanged();
          },
        });
        rowEl.appendChild(cardComp);
      });

      bfWrap.appendChild(rowEl);
    });

    return bfWrap;
  }

  /**
   * Component 6: PlayerArea
   * Combines PlayerPanel, SideZones (Command, Library, Graveyard, Exile),
   * Battlefield (3 rows), and Hand Fan (for local player only).
   */
  function createPlayerAreaComponent(seat, seatIdx, allSeats, isMe) {
    const area = document.createElement('div');
    area.className = 'pg-player-area' +
      (isMe ? ' is-me' : '') +
      (zoomedSeatIdx === seatIdx ? ' is-zoomed' : '');

    // 1. PlayerPanel Header
    area.appendChild(createPlayerPanelComponent(seat, seatIdx, allSeats, isMe));

    // 2. Body: SideZones + 3-Row Battlefield
    const body = document.createElement('div');
    body.className = 'pg-area-body';
    body.appendChild(createSideZonesComponent(seat, isMe));
    body.appendChild(createBattlefieldComponent(seat, isMe));
    area.appendChild(body);

    // 3. Hand Fan at the bottom (ONLY for local/active player; opponents show count only)
    if (isMe) {
      const handBar = document.createElement('div');
      handBar.className = 'pg-my-hand-bar';
      const handCards = seat.hand || [];

      if (handCards.length === 0) {
        handBar.innerHTML = `<span style="font-size:.62rem;color:#64748b">Main vide — Cliquez sur votre Bibliothèque (Library) pour piocher.</span>`;
      } else {
        handCards.forEach((hCard, hIdx) => {
          const cardEl = createCardComponent(hCard, {
            onClick: () => {
              // Phase A: Click a card in your hand to play it to the appropriate Battlefield row
              const played = seat.hand.splice(hIdx, 1)[0];
              played.tapped = false;
              seat.battlefield.push(played);
              notifyStateChanged();
            },
          });
          handBar.appendChild(cardEl);
        });
      }
      area.appendChild(handBar);
    }

    return area;
  }

  /**
   * Component 7: Stack
   * Central shared Stack panel showing spells and abilities in order
   */
  function renderStackPanel() {
    const stackEl = document.getElementById('pgStackPanel');
    if (!stackEl || !stateRef) return;
    const stackItems = stateRef.stack || [];

    stackEl.innerHTML = `
      <div class="pg-stack-header">
        <span>⚡ Shared Stack (${stackItems.length})</span>
        ${stackItems.length > 0 ? `<button id="pgResolveTopBtn" class="btn-s" style="padding:.15rem .45rem;font-size:.52rem">Resolve Top</button>` : ''}
      </div>
      <div class="pg-stack-list" id="pgStackList"></div>
    `;

    const listEl = stackEl.querySelector('#pgStackList');
    if (!stackItems.length) {
      listEl.innerHTML = `<div class="pg-stack-empty">Stack is empty</div>`;
    } else {
      stackItems.forEach((item, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:.4rem;padding:.3rem .45rem;background:rgba(255,255,255,.04);border:1px solid rgba(167,139,250,.3);border-radius:4px;font-size:.6rem';
        row.innerHTML = `
          <span>#${idx + 1} <b>${escapeHtml(item.name)}</b> (${escapeHtml(item.controller || '')})</span>
        `;
        listEl.appendChild(row);
      });
    }

    stackEl.querySelector('#pgResolveTopBtn')?.addEventListener('click', () => {
      if (stateRef.stack && stateRef.stack.length) {
        stateRef.stack.pop();
        notifyStateChanged();
      }
    });
  }

  /**
   * Component 8: Board (Root Tabletop Layout)
   */
  function init(appState, onStateChange) {
    stateRef = appState;
    onStateChangeCallback = onStateChange;
  }

  function renderBoard() {
    if (!stateRef || !stateRef.arenaOpen) return;
    const arena = document.getElementById('tabletopArena');
    if (!arena) return;

    const seats = stateRef.results || [];
    if (!seats.length) return;

    const myIdx = Math.max(0, Math.min(stateRef.activeSeat || 0, seats.length - 1));
    const mySeat = seats[myIdx];
    const opponents = seats
      .map((s, idx) => ({ seat: s, idx }))
      .filter(item => item.idx !== myIdx);

    // Ensure hoveredCard defaults to my Commander so PreviewPanel is populated immediately
    if (!hoveredCard && mySeat?.commander) {
      hoveredCard = mySeat.commander;
    }

    arena.innerHTML = `
      <!-- Top Bar -->
      <div class="pg-topbar">
        <div class="pg-topbar-left">
          <span style="font-family:'Cinzel Decorative',serif;font-weight:900;color:#fde047;font-size:.82rem">⚔ PLAYGROUP LIVE</span>
          <span class="pg-stat-chip">Turn ${stateRef.turn || 1}</span>
          <div class="pg-phase-strip">
            ${PHASES.map((ph, idx) => `
              <span class="pg-phase-pill ${idx === currentPhaseIdx ? 'active' : ''}" data-ph="${idx}" style="cursor:pointer">${ph}</span>
            `).join('')}
          </div>
        </div>

        <div class="pg-topbar-center" id="pgSeatSwitcher"></div>

        <div class="pg-topbar-right">
          <button class="btn-s" id="pgBtnToggleDebug" style="padding:.25rem .55rem;font-size:.56rem">🐞 Debug (D)</button>
          <button class="btn-s" id="pgBtnCloseArena" style="padding:.25rem .6rem;font-size:.56rem">✕ Lobby</button>
        </div>
      </div>

      <!-- Main Workspace: Table Surface (Left) + Preview & Stack Sidebar (Right) -->
      <div class="pg-main-layout">
        <div class="pg-table-surface">
          ${opponents.length > 0 ? `<div class="pg-opponents-grid opp-count-${Math.min(5, opponents.length)}" id="pgOpponentsGrid"></div>` : ''}
          <div class="pg-my-board-wrap" id="pgMyBoardWrap"></div>
        </div>

        <div class="pg-right-sidebar">
          <div class="pg-preview-panel" id="pgPreviewPanel"></div>
          <div class="pg-stack-panel" id="pgStackPanel"></div>
        </div>
      </div>
    `;

    // Wire Phase Pills
    arena.querySelectorAll('.pg-phase-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        currentPhaseIdx = parseInt(pill.dataset.ph, 10);
        renderBoard();
      });
    });

    // Seat Switcher Tabs (so user can inspect/test any player's perspective)
    const seatSwitcher = arena.querySelector('#pgSeatSwitcher');
    seats.forEach((s, idx) => {
      const btn = document.createElement('button');
      btn.className = 'tt-seat-tab' + (idx === myIdx ? ' active' : '');
      btn.textContent = `View J${idx + 1}: ${s.player}`;
      btn.addEventListener('click', () => {
        stateRef.activeSeat = idx;
        renderBoard();
      });
      seatSwitcher.appendChild(btn);
    });

    // Debug & Close Buttons
    arena.querySelector('#pgBtnToggleDebug')?.addEventListener('click', () => {
      ScryfallService.toggleDebugPanel();
    });
    arena.querySelector('#pgBtnCloseArena')?.addEventListener('click', () => {
      stateRef.arenaOpen = false;
      arena.classList.remove('show');
    });

    // Render Opponent Boards
    const oppGrid = arena.querySelector('#pgOpponentsGrid');
    if (oppGrid) {
      opponents.forEach(({ seat, idx }) => {
        oppGrid.appendChild(createPlayerAreaComponent(seat, idx, seats, false));
      });
    }

    // Render My Large Bottom Board
    const myBoardWrap = arena.querySelector('#pgMyBoardWrap');
    if (myBoardWrap && mySeat) {
      myBoardWrap.appendChild(createPlayerAreaComponent(mySeat, myIdx, seats, true));
    }

    renderPreviewPanel();
    renderStackPanel();
  }

  function notifyStateChanged() {
    renderBoard();
    if (typeof onStateChangeCallback === 'function') {
      onStateChangeCallback();
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    init,
    renderBoard,
    createCardComponent,
    setPreviewCard,
  };
})();
window.PlaygroupBoard = PlaygroupBoard;
