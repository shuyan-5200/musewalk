// ============================================================
//  UI 层：所有 DOM 界面（落地页 / HUD / 面板 / 字幕）
//  文案由 setLanding(gallery) 在配置装载完成后注入
// ============================================================

const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  // DOM 中所有功能按钮都是纯交互控件，不应在未来嵌入 form 时触发提交/刷新。
  if (tag === 'button') e.type = 'button';
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function htmlEl(tag, cls, html) {
  const e = el(tag, cls);
  e.innerHTML = html;
  return e;
}

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[c]));
const formatTitle = (title) => {
  const safe = escapeHtml(title);
  return CJK_RE.test(String(title ?? '')) ? `《${safe}》` : `<i>${safe}</i>`;
};

const DEFAULT_LABELS = {
  lobbyCrumbLabel: 'LOBBY',
  mobileFootnote: 'Tap the floor to travel · Drag to look around · Headphones recommended',
  mobileNote: 'Mobile runs at reduced resolution — visit on a computer for the full experience',
  soundLabel: 'Sound',
  soundTip: 'Ambient sound on/off',
  soundOnLabel: 'Ambient sound on',
  soundOffLabel: 'Ambient sound off',
  homeLabel: 'Lobby',
  homeTip: 'Back to the central hall',
  futureIntroGoText: '— tap to continue —',
  hallIntroGoText: '— click anywhere to enter —',
  galleryLoadingLine: 'Hanging the paintings · lighting the lamps',
  panelSwipeHint: 'Swipe up / tap to read',
  panelArtistLabel: 'ARTIST',
  panelEnterLabel: 'Step Into the Painting',
  panelCloseLabel: 'Back',
  dreamStarLabel: 'Become Stardust',
  dreamExitLabel: 'Step Back Out',
  dreamModeFlat: 'The Original',
  dreamModeSolid: 'In Relief',
  immersionBackLabel: 'Return to the Painting',
  immersionExitLabel: 'Back to the Gallery',
  reservedTitle: 'Reserved',
  reservedOriginal: 'Awaiting its next painting',
};

export function createUI(cb) {
  const root = document.getElementById('ui');
  let labels = { ...DEFAULT_LABELS };

  // 暗角
  const vignette = el('div', 'vignette');
  root.appendChild(vignette);

  // 幕布
  const veilEl = el('div', 'veil');
  root.appendChild(veilEl);

  // ---------- 落地页 ----------
  const landing = el('div', 'landing');
  const lKicker = landing.appendChild(el('div', 'l-kicker'));
  const lTitle = landing.appendChild(el('div', 'l-title'));
  const lSub = landing.appendChild(el('div', 'l-sub'));
  const lTagline = landing.appendChild(el('div', 'l-tagline'));
  const enterBtn = el('button', 'l-enter');
  enterBtn.disabled = true;
  landing.appendChild(enterBtn);
  const lFoot = landing.appendChild(el('div', 'l-foot'));
  const lNote = landing.appendChild(el('div', 'l-note')); // 仅触摸端：移动端降级说明
  const loader = htmlEl('div', 'loader', `<div class="bar"><i></i></div><div class="lab">${escapeHtml(labels.galleryLoadingLine)}</div>`);
  landing.appendChild(loader);
  root.appendChild(landing);
  enterBtn.addEventListener('click', () => cb.onEnter?.());

  // ---------- HUD ----------
  const crumb = htmlEl('div', 'hud-crumb',
    `<span class="c-logo">MUSEWALK</span><span class="c-sep">◆</span><span class="c-here"></span>`);
  root.appendChild(crumb);

  const tools = el('div', 'hud-tools');
  const btnSound = el('button', 'tool-btn sound-btn');
  const btnHome = el('button', 'tool-btn');
  const homeLabel = document.createTextNode(labels.homeLabel);
  const homeTip = el('span', 'tip', labels.homeTip);
  btnHome.append(homeLabel, homeTip);
  tools.append(btnSound, btnHome);
  root.appendChild(tools);
  btnSound.addEventListener('click', (event) => {
    // 工具按钮不向画布/落地页继续传播，也不触发任何默认导航行为。
    event.preventDefault();
    event.stopPropagation();
    cb.onToggleSound?.();
  });
  btnHome.addEventListener('click', () => cb.onHome?.());

  // ---------- 提示 / 题签 ----------
  const hintEl = el('div', 'hint');
  root.appendChild(hintEl);
  let hintTimer = null;

  const caption = htmlEl('div', 'caption', `<div class="cap-t"></div><div class="cap-s"></div>`);
  root.appendChild(caption);

  // ---------- 展馆引言 ----------
  const hallIntroEl = el('div', 'hall-intro');
  root.appendChild(hallIntroEl);

  // ---------- 信息面板 ----------
  const panelEl = el('div', 'panel');
  root.appendChild(panelEl);

  // ---------- 画境 UI ----------
  const immEl = el('div', 'imm-ui');
  root.appendChild(immEl);

  // ---------- 入画（立体画境）UI：一句缓现的诗 + 画外功能按钮 ----------
  // The stardust action is a pure function button, placed outside the painting.
  const dreamEl = el('div', 'dream-ui');
  const dreamPoem = el('div', 'dream-poem');
  const dreamActions = el('div', 'dream-actions');
  const dreamStar = el('button', 'dream-star', labels.dreamStarLabel);
  const dreamExit = el('button', 'dream-exit', labels.dreamExitLabel);
  const dreamModeBtn = el('button', 'dream-mode', labels.dreamModeFlat);
  dreamActions.append(dreamModeBtn, dreamStar, dreamExit);
  dreamEl.append(dreamPoem, dreamActions);
  root.appendChild(dreamEl);
  dreamStar.addEventListener('click', () => cb.onStardust?.());
  dreamExit.addEventListener('click', () => cb.onExitDream?.());
  dreamModeBtn.addEventListener('click', () => cb.onDreamMode?.());

  // ---------- 底部抽屉（仅触摸端）：收起只露抓手，上拉看说明，下拉收起，不挡画作 ----------
  const SHEET_PEEK = 104;       // 收起态露出的高度（醒目抓手条：grip + 题名 + 上滑提示）
  let sheetExpanded = false;
  const sheetCollapsedY = () => Math.max(panelEl.offsetHeight - SHEET_PEEK, 0);
  function setSheet(expanded) {
    sheetExpanded = expanded;
    panelEl.classList.remove('dragging');
    panelEl.classList.toggle('expanded', expanded);
    panelEl.style.transform = `translateY(${expanded ? 0 : sheetCollapsedY()}px)`;
  }
  function mountSheet(handle) {
    // 进入聚焦默认"收起"：从屏幕外滑上来停在抓手处
    requestAnimationFrame(() => setSheet(false));
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, base: sheetExpanded ? 0 : sheetCollapsedY(), moved: 0 };
      panelEl.classList.add('dragging');
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.abs(dy));
      const y = Math.min(Math.max(drag.base + dy, 0), sheetCollapsedY());
      panelEl.style.transform = `translateY(${y}px)`;
    });
    const end = (e) => {
      if (!drag) return;
      const collapsed = sheetCollapsedY();
      if (drag.moved < 14) setSheet(!sheetExpanded);         // 点按抓手 = 切换收起/展开（放宽阈值，点按更易触发）
      else {
        const y = Math.min(Math.max(drag.base + (e.clientY - drag.y), 0), collapsed);
        setSheet(y < collapsed * 0.5);                        // 拉过半 → 展开，否则收起
      }
      drag = null;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // ============ API ============
  let soundMuted = true;
  const renderSoundButton = () => {
    btnSound.classList.toggle('on', !soundMuted);
    btnSound.setAttribute('aria-pressed', String(!soundMuted));
    const stateLabel = soundMuted ? labels.soundOffLabel : labels.soundOnLabel;
    btnSound.setAttribute('aria-label', `${labels.soundLabel} · ${stateLabel}`);
    btnSound.title = stateLabel;
    btnSound.replaceChildren(
      document.createTextNode(labels.soundLabel),
      el('span', 'tip', `${labels.soundTip} · ${stateLabel}`),
    );
  };

  const api = {
    /** 配置装载完成后注入全部落地页文案 */
    setLanding(g) {
      labels = { ...labels, ...(g.ui || {}) };
      lKicker.textContent = g.kicker;
      lTitle.textContent = g.title;
      lSub.textContent = g.subtitle;
      lTagline.textContent = g.tagline;
      enterBtn.textContent = g.enterLabel;
      lFoot.textContent = IS_TOUCH ? labels.mobileFootnote : g.footnote;
      if (IS_TOUCH) lNote.textContent = labels.mobileNote;
      loader.querySelector('.lab').textContent = g.loadingLine;
      crumb.querySelector('.c-logo').textContent = g.title;
      renderSoundButton();
      homeLabel.textContent = labels.homeLabel;
      homeTip.textContent = labels.homeTip;
      dreamStar.textContent = labels.dreamStarLabel;
      dreamExit.textContent = labels.dreamExitLabel;
      dreamModeBtn.textContent = labels.dreamModeFlat;
      // 中英切换由 config.altLang 驱动。
      if (g.altLang?.label) {
        const lang = el('button', 'l-lang', g.altLang.label);
        lang.addEventListener('click', (e) => {
          e.stopPropagation();
          const u = new URL(location.href);
          // 总是写明 ?config：手动选过语言后，不再按浏览器语言自动切回去。
          u.searchParams.set('config', g.altLang.config || 'gallery.config.json');
          location.href = u.toString();
        });
        landing.appendChild(lang);
      }
      landing.classList.add('ready');
    },

    /** 启动失败时在落地页给出原因 */
    bootError(text) {
      landing.classList.add('ready');
      loader.querySelector('.lab').textContent = text;
      loader.querySelector('i').style.width = '0%';
    },

    setLoad(p) {
      loader.querySelector('i').style.width = `${Math.round(p * 100)}%`;
      if (p >= 1) {
        loader.classList.add('hidden');
        enterBtn.disabled = false;
      }
    },

    hideLanding() {
      landing.classList.add('hidden');
      // opacity=0 不代表不可点。设为 inert 才能确保隐身的语言按钮不再截胡右上角音乐按钮。
      landing.inert = true;
      landing.setAttribute('aria-hidden', 'true');
    },

    /** 幕布：show=true 盖上；white=米白色（入画闪光） */
    veil(show, { white = false, dur = 1000 } = {}) {
      veilEl.classList.toggle('white', white);
      veilEl.style.transitionDuration = `${dur}ms`;
      veilEl.classList.toggle('hidden', !show);
      return new Promise((r) => setTimeout(r, dur + 30));
    },

    hud(show, { soundOnly = false, landingMode = false, keepHome = false } = {}) {
      crumb.classList.toggle('show', show);
      tools.classList.toggle('show', show || soundOnly);
      tools.classList.toggle('sound-only', soundOnly);
      tools.classList.toggle('keep-home', soundOnly && keepHome); // 画境 / 星尘：音乐键 + 回展廊键
      tools.classList.toggle('landing-mode', landingMode);
    },

    crumb(text) { crumb.querySelector('.c-here').textContent = text; },

    hint(text, sticky = false) {
      clearTimeout(hintTimer);
      if (!text) { hintEl.classList.remove('show'); return; }
      hintEl.textContent = text;
      hintEl.classList.add('show');
      if (!sticky) hintTimer = setTimeout(() => hintEl.classList.remove('show'), 6000);
    },

    caption(data, x, y) {
      if (!data) { caption.classList.remove('show'); return; }
      caption.querySelector('.cap-t').innerHTML = formatTitle(data.title);
      caption.querySelector('.cap-s').textContent = data.original;
      const flip = x > window.innerWidth - 340;
      caption.style.left = `${x}px`;
      caption.style.top = `${y}px`;
      caption.style.transform = flip ? 'translate(calc(-100% - 18px), -50%)' : 'translate(18px, -50%)';
      caption.classList.add('show');
    },

    /** 展馆引言卡，点击消失；goText 可自定义底部提示（未来馆用"轻点继续"） */
    hallIntro(hall, goText = labels.hallIntroGoText) {
      hallIntroEl.innerHTML = '';
      const card = el('div', 'hi-card');
      card.appendChild(el('div', 'hi-no', hall.no));
      card.appendChild(el('div', 'hi-name', hall.name));
      card.appendChild(el('div', 'hi-latin', hall.latin));
      card.appendChild(el('div', 'hi-rule'));
      card.appendChild(el('div', 'hi-text', hall.intro));
      card.appendChild(el('div', 'hi-go', goText));
      hallIntroEl.appendChild(card);
      hallIntroEl.classList.add('show');
      return new Promise((res) => {
        const close = () => {
          hallIntroEl.classList.remove('show');
          hallIntroEl.removeEventListener('click', close);
          res();
        };
        hallIntroEl.addEventListener('click', close);
      });
    },

    /** 进展廊自适应引言卡：随粒子过场淡入，给可读的馆名/画家简介；
     *  加载慢时（grace 后仍未就绪）显示 LOADING，贴图就绪后切「点击入内」。
     *  返回控制器：setLoaded()/enableEnter()/wait()/close()。 */
    galleryIntro(hall) {
      hallIntroEl.innerHTML = '';
      const card = el('div', 'hi-card');
      card.appendChild(el('div', 'hi-no', hall.no));
      card.appendChild(el('div', 'hi-name', hall.name));
      card.appendChild(el('div', 'hi-latin', hall.latin));
      card.appendChild(el('div', 'hi-rule'));
      card.appendChild(el('p', 'hi-text', hall.intro));
      const foot = el('div', 'gi-foot');
      const loadEl = htmlEl('div', 'gi-load',
        '<span class="gi-dots"><i></i><i></i><i></i></span>'
        + `<span class="gi-load-cn">${escapeHtml(labels.galleryLoadingLine)}</span>`
        + '<span class="gi-load-en">CURATING THE GALLERY</span>');
      const goEl = el('div', 'gi-go', labels.hallIntroGoText);
      foot.append(loadEl, goEl);
      card.appendChild(foot);
      hallIntroEl.appendChild(card);
      hallIntroEl.classList.add('show');

      let loaded = false;
      let entered = false;
      let resolveClick;
      const clickP = new Promise((r) => { resolveClick = r; });
      const onClick = () => {
        if (!entered) return;
        hallIntroEl.removeEventListener('click', onClick);
        resolveClick();
      };
      hallIntroEl.addEventListener('click', onClick);
      // 仅当加载确实慢（grace 后仍未就绪）才显示 LOADING，避免快/缓存时一闪而过
      const graceTimer = setTimeout(() => { if (!loaded) loadEl.classList.add('show'); }, 700);

      return {
        setLoaded() { loaded = true; clearTimeout(graceTimer); loadEl.classList.remove('show'); },
        enableEnter() { entered = true; goEl.classList.add('show'); },
        wait() { return clickP; },
        close() { hallIntroEl.classList.remove('show'); },
      };
    },

    /** 画作信息面板；entry=null 收起 */
    panel(entry) {
      if (!entry) {
        panelEl.classList.remove('show', 'expanded', 'dragging');
        if (IS_TOUCH) panelEl.style.transform = '';   // 交还给 CSS，向下滑出屏幕
        return;
      }
      const { work, artist, hall } = entry;
      panelEl.innerHTML = '';
      panelEl.classList.remove('expanded', 'dragging');
      // 触摸端：顶部抓手 + 题名预览（收起态只露出这一条）
      let handle = null;
      if (IS_TOUCH) {
        handle = htmlEl('div', 'p-handle',
          `<span class="p-grip"></span><span class="p-peek">${formatTitle(work.title)}<span class="p-peek-go">${escapeHtml(labels.panelSwipeHint)}</span></span>`);
        panelEl.appendChild(handle);
      }
      const scroll = el('div', 'p-scroll');
      panelEl.appendChild(scroll);
      let i = 0;
      const add = (node) => {
        node.classList.add('reveal');
        node.style.setProperty('--i', i++);
        scroll.appendChild(node);
        return node;
      };
      add(el('div', 'p-hall', `${hall.no} · ${hall.name}`));
      add(el('h1', 'p-title', `${work.title}`));
      if (work.original) add(el('div', 'p-orig', work.original));
      const meta = [work.year, work.medium].filter(Boolean).join(' · ');
      const metaEl = el('div', 'p-meta', meta);
      if (work.museum) metaEl.append(document.createElement('br'), document.createTextNode(work.museum));
      add(metaEl);
      add(el('div', 'p-rule'));
      add(el('p', 'p-desc', work.desc));
      add(el('div', 'p-artist-label', labels.panelArtistLabel));
      add(el('div', 'p-artist-name', artist.name));
      const sub = [artist.original, artist.dates].filter(Boolean).join(' · ');
      if (sub) add(el('div', 'p-artist-dates', sub));
      if (artist.epithet) add(el('div', 'p-epithet', `「 ${artist.epithet} 」`));
      add(el('p', 'p-bio', artist.bio));
      const actions = el('div', 'p-actions');
      const enter = el('button', 'p-enter', labels.panelEnterLabel);
      // 英文标签（Step Into the Painting）收紧字距，保持一行；中文保留宽字距。
      if (!/[\u3400-\u9fff]/u.test(labels.panelEnterLabel)) enter.classList.add('latin');
      const close = el('button', 'p-close', labels.panelCloseLabel);
      actions.append(enter, close);
      panelEl.appendChild(actions);
      enter.addEventListener('click', () => cb.onEnterPainting?.(entry));
      close.addEventListener('click', () => cb.onClosePanel?.());
      panelEl.appendChild(el('div', 'p-poem', work.line));
      // 强制重排以重放动画
      void panelEl.offsetWidth;
      panelEl.classList.add('show');
      scroll.scrollTop = 0;
      if (IS_TOUCH && handle) mountSheet(handle);
    },

    /** 入画（立体画境）UI；work=null 收起。poem 为要缓现的诗句 */
    dream(work, poem) {
      if (!work) { dreamEl.classList.remove('show'); dreamPoem.classList.remove('once'); return; }
      dreamPoem.textContent = poem || '';
      dreamEl.classList.add('show');
      dreamPoem.classList.remove('once');
      void dreamPoem.offsetWidth;   // 强制重排以重放缓现动画
      dreamPoem.classList.add('once');
    },

    /** 画境「原作 / 立体」切换钮：mode=当前模式（按钮显示将切去的那个）；canToggle=false 隐藏 */
    dreamMode(mode, canToggle = true) {
      dreamModeBtn.style.display = canToggle ? '' : 'none';
      dreamModeBtn.textContent = mode === 'solid' ? labels.dreamModeFlat : labels.dreamModeSolid;
    },

    /** 画境字幕；work=null 收起。右下功能钮与入画同位成列：回到画境（上）/ 返回展厅（下） */
    immersion(work) {
      if (!work) { immEl.classList.remove('show'); return; }
      immEl.innerHTML = '';
      const immTitle = el('div', 'imm-title');
      immTitle.append(
        el('div', 'it-cn', work.title),
        el('div', 'it-en', [work.original, work.year].filter(Boolean).join(' · ')),
      );
      immEl.appendChild(immTitle);
      immEl.appendChild(el('div', 'imm-line', work.line));
      const actions = el('div', 'imm-actions');
      const back = el('button', 'imm-back', labels.immersionBackLabel);
      const exit = el('button', 'imm-exit', labels.immersionExitLabel);
      actions.append(back, exit);
      immEl.appendChild(actions);
      back.addEventListener('click', () => cb.onBackToDream?.());
      exit.addEventListener('click', () => cb.onExitImmersion?.());
      void immEl.offsetWidth;
      immEl.classList.add('show');
    },

    setSoundButton(muted) {
      soundMuted = !!muted;
      renderSoundButton();
    },
    vignette(deep) { vignette.classList.toggle('deep', deep); },
    showHome(show) { btnHome.style.display = show ? 'flex' : 'none'; },
    homeButton(label, tip) {
      homeLabel.textContent = label;
      homeTip.textContent = tip;
    },
  };

  renderSoundButton();
  return api;
}
