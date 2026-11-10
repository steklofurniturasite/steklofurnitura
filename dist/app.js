/* Shared catalogue, enquiry and accessibility interactions. No server-side submission. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))
    .filter(element => !element.closest('.motion-exit, .motion-lightbox-exit'));
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const CART_KEY = 'steklofurnitura-inquiry';
  const MAX_QUANTITY = 99999;
  const MENU_IDS = ['catalog-menu', 'mobile-nav'];
  const productMap = new Map();
  const menuOpeners = new Map();
  // The same source works at a domain root and below a GitHub Pages project path.
  const scriptPath = new URL(document.currentScript.src, location.href).pathname;
  const siteBase = scriptPath.slice(0, scriptPath.lastIndexOf(String.fromCharCode(47)));
  let productsPromise;
  let toastTimer;
  let cartRender = 0;

  // Motion is progressive enhancement: state, focus and navigation never await it.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionByElement = new WeakMap();
  const runningMotion = new Set();
  const exitLayers = new Map();
  const addedTimers = new WeakMap();
  const buttonLabels = new WeakMap();
  const motionTheme = getComputedStyle(document.documentElement);
  const token = (name, fallback) => parseFloat(motionTheme.getPropertyValue(name)) || fallback;
  const motionTime = {
    exit: token('--motion-exit', 160), feedback: token('--motion-feedback', 180),
    quick: token('--motion-quick', 200), state: token('--motion-state', 220),
    enter: token('--motion-enter', 240), dialog: token('--motion-dialog', 260),
    medium: token('--motion-medium', 280), reorder: token('--motion-reorder', 300),
    reveal: token('--motion-reveal', 480)
  };
  const motionEase = motionTheme.getPropertyValue('--ease').trim() || 'cubic-bezier(.22, .72, .24, 1)';

  function animateUI(element, frames, { duration = motionTime.state, delay = 0 } = {}) {
    if (!element) return null;
    motionByElement.get(element)?.cancel();
    if (reducedMotion.matches || typeof element.animate !== 'function') return null;
    const animation = element.animate(frames, { duration, delay, easing: motionEase, fill: 'backwards' });
    motionByElement.set(element, animation);
    runningMotion.add(animation);
    const finish = () => {
      runningMotion.delete(animation);
      if (motionByElement.get(element) === animation) motionByElement.delete(element);
    };
    animation.finished.then(finish, finish); // cancel() rejects finished; it is expected.
    return animation;
  }

  function clearExit(element) {
    const layer = exitLayers.get(element);
    if (layer) {
      motionByElement.get(layer)?.cancel();
      layer.remove();
      exitLayers.delete(element);
    }
  }

  function animateExit(element, { lightbox = false } = {}) {
    clearExit(element);
    if (reducedMotion.matches || typeof element?.animate !== 'function') return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const style = lightbox ? getComputedStyle(element, '::backdrop') : getComputedStyle(element);
    const opacity = Number(style.opacity);
    let layer;
    if (lightbox) {
      layer = document.createElement('div');
      layer.className = 'motion-lightbox-exit';
      const image = $('img', element);
      if (image) {
        const box = image.getBoundingClientRect();
        const copy = image.cloneNode();
        copy.alt = '';
        Object.assign(copy.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        layer.append(copy);
      }
    } else {
      layer = element.cloneNode(true);
      layer.hidden = false;
      layer.classList.add('motion-exit');
      Object.assign(layer.style, { position: 'fixed', margin: '0', left: `${rect.left}px`, top: `${rect.top}px`, right: 'auto', bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px`, maxHeight: 'none', transform: 'none' });
    }
    // The exiting picture is never another interactive or accessible control.
    layer.inert = true;
    layer.setAttribute('aria-hidden', 'true');
    layer.removeAttribute('role');
    layer.removeAttribute('aria-live');
    [layer, ...Array.from(layer.querySelectorAll('*'))].forEach(node => {
      node.removeAttribute('id');
      if (node.matches('a, button, input, select, textarea, [tabindex]')) node.setAttribute('tabindex', '-1');
      [...node.attributes].filter(attribute => attribute.name.startsWith('data-')).forEach(attribute => node.removeAttribute(attribute.name));
    });
    document.body.append(layer);
    exitLayers.set(element, layer);
    const animation = animateUI(layer, [{ opacity: Number.isFinite(opacity) ? opacity : 1, translate: '0 0' }, { opacity: 0, translate: lightbox ? '0 0' : '0 -5px' }], { duration: motionTime.exit });
    const remove = () => {
      layer.remove();
      if (exitLayers.get(element) === layer) exitLayers.delete(element);
    };
    if (animation) animation.finished.then(remove, remove);
    else remove();
  }

  function capturePositions(elements, key = element => element) {
    return new Map(elements.map(element => [key(element), element.getBoundingClientRect()]));
  }

  function animatePositions(before, elements, key = element => element) {
    elements.forEach(element => motionByElement.get(element)?.cancel());
    const positions = elements.map(element => ({ element, old: before.get(key(element)), next: element.getBoundingClientRect() }));
    positions.filter(({ old, next }) => old && next.bottom > 0 && next.top < innerHeight).slice(0, 24).forEach(({ element, old, next }) => {
      const x = old.left - next.left, y = old.top - next.top;
      if (Math.abs(x) + Math.abs(y) <= 1) return;
      if (old.bottom <= 0 || old.top >= innerHeight || Math.abs(y) > 240 || Math.abs(x) > innerWidth * .6) {
        animateUI(element, [{ opacity: .6, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: motionTime.quick });
      } else {
        animateUI(element, [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: motionTime.reorder });
      }
    });
  }

  let revealObserver;
  const revealed = new WeakSet();
  function observeMotion() {
    revealObserver?.disconnect();
    if (reducedMotion.matches || typeof window.IntersectionObserver !== 'function') return;
    revealObserver = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach((entry, index) => {
        revealObserver.unobserve(entry.target);
        if (revealed.has(entry.target)) return;
        revealed.add(entry.target);
        // No hidden pending class: failed JS, disabled JS and fast scroll retain content.
        animateUI(entry.target, [{ opacity: .55, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: motionTime.reveal, delay: Math.min(index, 3) * 40 });
      });
    }, { threshold: 0, rootMargin: '0px 0px -20px 0px' });
    $$('.section-heading, .category-card, .project-card, .resource-card, .all-categories > section, .contact-person, .full-project, .about-band > .wrap, .footer-lead').slice(0, 96).forEach(element => {
      if (!revealed.has(element)) revealObserver.observe(element);
    });
  }
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      runningMotion.forEach(animation => animation.cancel());
      [...exitLayers.keys()].forEach(clearExit);
    }
    observeMotion();
  });

  async function getProducts() {
    if (!productsPromise) {
      productsPromise = fetch('/products.json', { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error('Каталог недоступен');
          return response.json();
        })
        .then(products => {
          if (!Array.isArray(products)) throw new Error('Неверный формат каталога');
          productMap.clear();
          products.forEach(product => productMap.set(product.url, product));
          return products;
        })
        .catch(error => {
          // Let a subsequent click retry after a temporary network error.
          productsPromise = undefined;
          throw error;
        });
    }
    return productsPromise;
  }

  function getCart() {
    try {
      const cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(cart) ? cart
        .filter(item => item && typeof item.url === 'string' && Number.isFinite(item.qty) && item.qty > 0)
        .map(item => ({ ...item, qty: Math.min(MAX_QUANTITY, item.qty) })) : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      toast('Браузер не разрешает сохранять заявку. Включите локальное хранение.');
      return false;
    }
    updateCount();
    return true;
  }

  function updateCount() {
    const quantity = getCart().reduce((total, item) => total + item.qty, 0);
    $$('.cart-count').forEach(element => {
      const changed = element.textContent !== String(quantity);
      element.textContent = quantity;
      if (changed) animateUI(element, [{ transform: 'scale(.85)' }, { transform: 'scale(1.12)', offset: .5 }, { transform: 'scale(1)' }], { duration: motionTime.medium });
    });
    $$('.cart-link').forEach(element => {
      element.setAttribute('aria-label', `Ваша заявка. Количество: ${quantity}`);
    });
  }

  function toast(message, withCartLink = false) {
    const element = $('.toast');
    if (!element) return;
    const wasVisible = !element.hidden;
    const currentStyle = getComputedStyle(element);
    const fromOpacity = wasVisible ? Number(currentStyle.opacity) : 0;
    const fromTranslate = wasVisible ? currentStyle.translate : '0 8px';
    clearTimeout(toastTimer);
    clearExit(element);
    motionByElement.get(element)?.cancel();
    element.replaceChildren(document.createTextNode(message));
    if (withCartLink) {
      const link = document.createElement('a');
      link.href = '/system/cart.html';
      link.textContent = 'Открыть заявку';
      element.append(document.createTextNode(' '), link);
    }
    element.hidden = false;
    animateUI(element, [{ opacity: fromOpacity, translate: fromTranslate }, { opacity: 1, translate: '0 0' }], { duration: motionTime.state });
    const dismiss = () => {
      if (element.contains(document.activeElement) || element.matches(':hover')) {
        toastTimer = setTimeout(dismiss, 1500);
      } else {
        animateExit(element);
        element.hidden = true;
      }
    };
    toastTimer = setTimeout(dismiss, withCartLink ? 6000 : 4500);
  }

  function showMenu(id, open, { trigger, moveFocus = false, restoreFocus = false } = {}) {
    const panel = document.getElementById(id);
    if (!panel) return;
    const wasOpen = !panel.hidden;
    if (open && trigger && !panel.contains(trigger)) menuOpeners.set(id, trigger);
    const departing = exitLayers.get(panel);
    const resume = departing ? getComputedStyle(departing).opacity : 0;
    if (open) clearExit(panel);
    if (wasOpen && !open) animateExit(panel);
    motionByElement.get(panel)?.cancel();
    panel.hidden = !open;
    if (open && !wasOpen) animateUI(panel, [{ opacity: Number(resume), translate: '0 -6px' }, { opacity: 1, translate: '0 0' }], { duration: motionTime.enter });
    $$(`[data-toggle="${id}"]`).forEach(button => {
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-controls', id);
      if (button.classList.contains('mobile-menu')) {
        button.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      }
    });
    if (open && moveFocus) $('a[href], button:not([disabled])', panel)?.focus();
    if (!open && wasOpen && restoreFocus) menuOpeners.get(id)?.focus();
  }

  MENU_IDS.forEach(id => showMenu(id, false));

  // Native details stay open as a desktop sidebar and become disclosures on phones.
  // Change only when crossing the breakpoint, so a mobile visitor can toggle freely.
  const compactCatalogue = window.matchMedia('(max-width: 960px)');
  function syncCatalogueNavigation() {
    $$('details.catalog-nav').forEach(panel => { panel.open = !compactCatalogue.matches; });
  }
  compactCatalogue.addEventListener('change', syncCatalogueNavigation);
  syncCatalogueNavigation();
  let searchEnginePromise;
  function getSearchEngine() {
    if (!searchEnginePromise) searchEnginePromise=Promise.all([
      getProducts(), fetch('/search-categories.json').then(response=>{if(!response.ok) throw new Error('Search metadata unavailable');return response.json();})
    ]).then(([products,categories])=>SFSearch.create(products,categories)).catch(error=>{searchEnginePromise=undefined;throw error;});
    return searchEnginePromise;
  }
  function highlight(element,query,isArticle=false) {
    const value=element.textContent;
    element.replaceChildren();
    if(isArticle && SFSearch.article(query) && SFSearch.article(value).startsWith(SFSearch.article(query))) {
      const mark=document.createElement('mark');mark.textContent=value;element.append(mark);return;
    }
    const terms=SFSearch.words(query);
    for(const part of value.split(/([\p{L}\p{N}]+)/u)) {
      const matched=terms.some(t=>SFSearch.term(part).startsWith(t));
      const node=matched?document.createElement('mark'):document.createTextNode(part);
      if(matched) node.textContent=part;
      element.append(node);
    }
  }
  const closeSearchSuggestions=[];
  $$('form.search, form.large-search').forEach((form,index) => {
    const input=$('input[name="q"]',form),isResults=form.classList.contains('large-search');
    input.autocomplete='off';input.maxLength=200;
    const clear=document.createElement('button');clear.type='button';clear.className='search-clear';clear.textContent='×';clear.setAttribute('aria-label','Очистить поиск');clear.hidden=!input.value;
    input.after(clear);
    const list=document.createElement('div');list.id=`search-options-${index}`;list.className='search-suggestions';list.setAttribute('role','listbox');list.setAttribute('aria-label','Подсказки товаров');list.hidden=true;
    const status=document.createElement('span');status.className='search-sr-status';status.setAttribute('role','status');
    if(!isResults){form.append(list,status);input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');}
    let timer,revision=0,active=-1,options=[];
    const close=()=>{revision++;list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
    closeSearchSuggestions.push(close);
    function select(index){active=index;$$('[role="option"]',list).forEach((option,i)=>{option.setAttribute('aria-selected',String(i===active));if(i===active){input.setAttribute('aria-activedescendant',option.id);if(option.offsetTop<list.scrollTop)list.scrollTop=option.offsetTop;else if(option.offsetTop+option.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=option.offsetTop+option.offsetHeight-list.clientHeight;}});}
    async function suggest(){
      const current=++revision,query=input.value.trim();
      if(!SFSearch.words(query).length){close();return;}
      status.textContent='Ищем…';
      try{
        const engine=await getSearchEngine();
        if(current!==revision||document.activeElement!==input)return;
        options=engine.find(query).slice(0,6);active=-1;input.removeAttribute('aria-activedescendant');list.replaceChildren();
        options.forEach((entry,i)=>{
          const option=document.createElement('a');option.href=entry.product.url;option.id=`${list.id}-${i}`;option.tabIndex=-1;option.setAttribute('role','option');option.setAttribute('aria-selected','false');
          const article=document.createElement('strong');article.textContent=entry.product.article;highlight(article,query,true);
          const name=document.createElement('span');name.textContent=entry.product.name;highlight(name,query);option.append(article,name);list.append(option);
        });
        if(!options.length){const empty=document.createElement('p');empty.textContent='Ничего не найдено. Попробуйте другой артикул.';list.append(empty);}
        list.hidden=false;input.setAttribute('aria-expanded','true');status.textContent=`Подсказок: ${options.length}`;
      }catch{if(current===revision){close();status.textContent='Каталог недоступен. Нажмите «Найти», чтобы повторить поиск.';}}
    }
    input.addEventListener('input',()=>{
      clear.hidden=!input.value;clearTimeout(timer);close();
      timer=setTimeout(()=>{if(isResults){history.replaceState(null,'',location.pathname+'?q='+encodeURIComponent(input.value.trim()));search();}else suggest();},180);
    });
    input.addEventListener('focus',()=>{if(!isResults&&input.value.trim())suggest();});
    clear.addEventListener('click',()=>{input.value='';input.dispatchEvent(new Event('input'));input.focus();});
    input.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();clearTimeout(timer);close();}
      if(!list.hidden&&options.length&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();select(active<0?(event.key==='ArrowDown'?0:options.length-1):(active+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);}
      if(event.key==='Enter'&&!list.hidden&&active>=0){event.preventDefault();location.assign(options[active].product.url);}
    });
    form.addEventListener('focusout',()=>{requestAnimationFrame(()=>{if(!form.contains(document.activeElement))close();});});
    form.addEventListener('submit',event=>{
      event.preventDefault();close();clearTimeout(timer);
      const query=input.value.trim();
      if(isResults){history.replaceState(null,'',location.pathname+'?q='+encodeURIComponent(query));search();}
      else location.assign('/search.html?q='+encodeURIComponent(query));
    });
  });
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('form.search'))closeSearchSuggestions.forEach(close=>close());});
  $$('[data-toggle]').forEach(button=>button.addEventListener('click',()=>closeSearchSuggestions.forEach(close=>close())));

  function quantityValue(value) {
    return Math.min(MAX_QUANTITY, Math.max(1, Math.round(Number(value) || 1)));
  }

  function updateRow(url, value) {
    const cart = getCart();
    const item = cart.find(entry => entry.url === url);
    if (item) {
      item.qty = quantityValue(value);
      if (saveCart(cart)) {
        const row = $$('.cart-row').find(element => element.dataset.cartUrl === url);
        const price = row && $('.cart-price', row);
        if (price) price.textContent = itemPriceText(productMap.get(url), item.qty);
        const total = $('.cart-total');
        if (total) total.textContent = inquiryTotal();
      }
    }
  }

  // Keep the outgoing photograph over the decoded next frame: no white fade dip.
  const imageOverlays = new WeakMap();
  function replacePhoto(image, source) {
    const previous = imageOverlays.get(image);
    if (previous) { motionByElement.get(previous)?.cancel(); previous.remove(); }
    let overlay;
    if (!reducedMotion.matches && image.complete && image.naturalWidth && image.parentElement.classList.contains('product-main-image')) {
      overlay = image.cloneNode();
      overlay.removeAttribute('id'); overlay.alt = ''; overlay.setAttribute('aria-hidden', 'true');
      overlay.className = 'gallery-previous';
      Object.assign(overlay.style, {position:'absolute', left:`${image.offsetLeft}px`, top:`${image.offsetTop}px`, width:`${image.clientWidth}px`, height:`${image.clientHeight}px`});
      image.parentElement.append(overlay); imageOverlays.set(image, overlay);
    }
    image.src = source;
    if (overlay) {
      const animation = animateUI(overlay, [{opacity:1},{opacity:0}], {duration:motionTime.medium});
      const remove = () => { overlay.remove(); if (imageOverlays.get(image) === overlay) imageOverlays.delete(image); };
      if (animation) animation.finished.then(remove,remove); else remove();
    }
  }

  let imageRevision = 0;
  function selectProductImage(thumbnail) {
    const image = $('#detail-photo');
    if (!image || !thumbnail) return;
    image.removeAttribute('aria-busy');
    const revision = ++imageRevision;
    const next = thumbnail.dataset.image;
    const preloader = new Image();
    const apply = () => {
      if (revision !== imageRevision) return;
      image.removeAttribute('aria-busy');
      replacePhoto(image, next);
      const zoom = image.closest('a[data-lightbox]');
      if (zoom) zoom.href = next;

    };
    if (image.src !== new URL(next, location.href).href) {
      image.setAttribute('aria-busy', 'true');
      preloader.onload = () => {
        const decoded = typeof preloader.decode === 'function' ? preloader.decode() : Promise.resolve();
        decoded.catch(() => {}).then(apply);
      };
      preloader.onerror = () => {
        if (revision !== imageRevision) return;
        image.removeAttribute('aria-busy');
        $$('.product-thumb[data-image]').forEach(button => {
          const selected = new URL(button.dataset.image, location.href).href === image.src;
          button.classList.toggle('is-active', selected);
          button.setAttribute('aria-pressed', String(selected));
        });
        toast('Не удалось загрузить фотографию. Повторите выбор.');
      };
      preloader.src = next;
    }
    // The zoom URL changes only together with the successfully loaded image.
    $$('.product-thumb[data-image]').forEach(button => {
      const selected = button === thumbnail;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  selectProductImage($('.product-thumb[data-image]'));

  function openLightbox(link) {
    const dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.setAttribute('aria-label', 'Просмотр изображения');
    const image = document.createElement('img');
    image.src = link.href;
    image.alt = $('img', link)?.alt || 'Изображение';
    const close = document.createElement('button');
    close.className = 'lightbox-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Закрыть изображение');
    [...exitLayers.keys()].filter(element => !element.isConnected).forEach(clearExit);
    const group = link.closest('.product-gallery, .full-project');
    const sources = group?.classList.contains('product-gallery')
      ? $$('.product-thumb[data-image]', group).map(button => new URL(button.dataset.image, location.href).href)
      : group ? $$('a[data-lightbox]', group).map(anchor => anchor.href) : [link.href];
    let selected = Math.max(0, sources.indexOf(link.href)), revision = 0;
    const count = document.createElement('span'); count.className = 'lightbox-count';
    count.setAttribute('aria-live', 'polite'); count.textContent = `${selected + 1} / ${sources.length}`;
    async function navigate(step) {
      selected = (selected + step + sources.length) % sources.length;
      const current = ++revision, target = selected, next = new Image();
      image.setAttribute('aria-busy','true');
      next.onload = async () => {
        try { await next.decode(); } catch {}
        if (current !== revision || !dialog.open) return;
        image.src = sources[target]; image.removeAttribute('aria-busy');
        count.textContent = `${target + 1} / ${sources.length}`;
        animateUI(image, [{opacity:.8},{opacity:1}], {duration:motionTime.quick});
      };
      next.onerror = () => {
        if (current !== revision || !dialog.open) return;
        image.removeAttribute('aria-busy'); selected = Math.max(0,sources.indexOf(image.src));
        count.textContent = 'Фото недоступно. Повторите выбор.';
      };
      next.src = sources[target];
    }
    if (sources.length > 1) {
      for (const [step, label, className, symbol] of [[-1,'Предыдущее изображение','lightbox-prev','←'],[1,'Следующее изображение','lightbox-next','→']]) {
        const control = document.createElement('button'); control.type='button';
        control.className=`lightbox-nav ${className}`; control.textContent=symbol; control.setAttribute('aria-label',label);
        control.addEventListener('click',() => navigate(step)); dialog.append(control);
      }
      // Horizontal one-finger swipes; vertical scrolling and pinch zoom stay native.
      let swipeStart = null;
      image.addEventListener('touchstart', event => {
        swipeStart = event.touches.length === 1 ? { x:event.touches[0].clientX, y:event.touches[0].clientY } : null;
      }, {passive:true});
      image.addEventListener('touchmove', event => { if (event.touches.length !== 1) swipeStart = null; }, {passive:true});
      image.addEventListener('touchcancel', () => { swipeStart = null; });
      image.addEventListener('touchend', event => {
        if (!swipeStart || event.touches.length || !event.changedTouches.length) return;
        const dx=event.changedTouches[0].clientX-swipeStart.x, dy=event.changedTouches[0].clientY-swipeStart.y;
        swipeStart=null;
        if (Math.abs(dx)>=55 && Math.abs(dx)>Math.abs(dy)*1.5) navigate(dx<0 ? 1 : -1);
      }, {passive:true});
      dialog.append(count);
      dialog.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1); }
      });
    }
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true; revision++;
      dialog.remove();
      if (link.isConnected) link.focus({ preventScroll: true });
    };
    const dismiss = () => { animateExit(dialog, { lightbox: true }); dialog.close(); cleanup(); };
    close.addEventListener('click', dismiss);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.append(image, close);
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dismiss();
    });
    dialog.addEventListener('close', cleanup, { once: true });
    dialog.showModal();
    const revealImage = () => {
      if (dialog.open && image.isConnected) animateUI(image,
        [{ opacity: .5, transform: 'translateY(8px) scale(.97)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: motionTime.dialog });
    };
    if (image.complete && image.naturalWidth) revealImage();
    else image.addEventListener('load', revealImage, { once: true });
    close.focus();
  }

  async function addProduct(button) {
    if (button.disabled) return;
    clearTimeout(addedTimers.get(button));
    button.classList.remove('is-added', 'is-error');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (!buttonLabels.has(button)) buttonLabels.set(button, button.innerHTML);
    const originalLabel = buttonLabels.get(button);
    button.textContent = 'Добавляем…';
    let success = false;
    try {
      await getProducts();
      const product = productMap.get(button.dataset.product);
      if (!product) throw new Error('Товар не найден');
      // Card buttons always add one; the product detail button uses its quantity.
      const input = button.closest('.order-actions') ? $('#quantity') : null;
      const quantity = Math.min(MAX_QUANTITY, Math.max(1, Number(input?.value) || 1));
      if (!Number.isInteger(quantity)) {
        toast('Укажите целое количество');
        input?.focus();
        return;
      }
      const cart = getCart();
      const existing = cart.find(item => item.url === product.url);
      if (existing) existing.qty = Math.min(MAX_QUANTITY, existing.qty + quantity);
      else cart.push({ url: product.url, qty: quantity });
      if (saveCart(cart)) {
        success = true;
        button.textContent = 'Добавлено ✓';
        clearTimeout(addedTimers.get(button));
        button.classList.add('is-added');
        animateUI(button, [{ transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: motionTime.feedback });
        addedTimers.set(button, setTimeout(() => { button.classList.remove('is-added'); button.innerHTML = originalLabel; }, 1600));
        toast('Товар добавлен в заявку.', true);
      }
    } catch {
      button.classList.add('is-error');
      button.textContent = 'Повторить';
      addedTimers.set(button, setTimeout(() => { button.classList.remove('is-error'); button.innerHTML = originalLabel; }, 1600));
      toast('Не удалось загрузить товар. Нажмите кнопку ещё раз.');
    } finally {
      if (!success && !button.classList.contains('is-error')) button.innerHTML = originalLabel;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  document.addEventListener('click', async event => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.dataset.toggle;
      const panel = document.getElementById(id);
      if (!panel) return;
      const open = panel.hidden;
      MENU_IDS.filter(other => other !== id).forEach(other => showMenu(other, false));
      showMenu(id, open, {
        trigger: toggle,
        moveFocus: open && event.detail === 0,
        restoreFocus: !open && panel.contains(toggle)
      });
      return;
    }
    if (!event.target.closest('header')) MENU_IDS.forEach(id => showMenu(id, false));

    const retry = event.target.closest('[data-retry]');
    if (retry) {
      if (retry.dataset.retry === 'search') search();
      else renderCart();
      return;
    }
    const add = event.target.closest('[data-product]');
    if (add) {
      await addProduct(add);
      return;
    }
    const quantityButton = event.target.closest('[data-qty]');
    if (quantityButton) {
      const input = $('input', quantityButton.parentElement);
      input.value = quantityValue((Number(input.value) || 1) + Number(quantityButton.dataset.qty));
      const row = quantityButton.closest('[data-cart-url]');
      if (row) updateRow(row.dataset.cartUrl, input.value);
      return;
    }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      const rows = $$('.cart-row');
      const before = capturePositions(rows, row => row.dataset.cartUrl);
      const index = rows.indexOf(remove.closest('.cart-row'));
      if (saveCart(getCart().filter(item => item.url !== remove.dataset.remove))) {
        animateExit(remove.closest('.cart-row'));
        await renderCart();
        animatePositions(before, $$('.cart-row'), row => row.dataset.cartUrl);
        const remaining = $$('.cart-remove');
        (remaining[Math.min(index, remaining.length - 1)] || $('#cart-content .button'))?.focus();
        toast('Товар удалён из заявки');
      }
      return;
    }
    const thumbnail = event.target.closest('[data-image]');
    if (thumbnail) {
      selectProductImage(thumbnail);
      return;
    }
    const lightboxLink = event.target.closest('a[data-lightbox]');
    if (lightboxLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      openLightbox(lightboxLink);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    MENU_IDS.forEach(id => showMenu(id, false, { restoreFocus: true }));
  });
  document.addEventListener('focusin', event => {
    if (!event.target.closest('header')) MENU_IDS.forEach(id => showMenu(id, false));
  });
  document.addEventListener('change', event => {
    if (!event.target.matches('[data-cart-url] input, #quantity')) return;
    event.target.value = quantityValue(event.target.value);
    const row = event.target.closest('[data-cart-url]');
    if (row) updateRow(row.dataset.cartUrl, event.target.value);
  });

  function productCard(product) {
    const p = Object.fromEntries(Object.entries(product).map(([key, value]) => [key, escapeHTML(value)]));
    return `<article class="product-card">
      <a class="product-photo" href="${p.url}"><img src="${p.image}" alt="${p.name}" loading="lazy">
        </a>
      <div class="product-content"><span class="product-article">${p.article}</span>
        <h3><a href="${p.url}">${p.name}</a></h3><p class="finish">${p.finish}</p>
        <div class="product-stock">Наличие уточняется</div>
        <div class="product-bottom"><span class="product-price">${p.price || 'Цену уточняйте'}</span><small class="price-note">Стоимость подтвердит менеджер</small>
          <button class="add-product" type="button" data-product="${p.url}" aria-label="Добавить ${p.article} в заявку">
            <span>В заявку</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button></div>
      </div></article>`;
  }

  function errorState(message, target) {
    return `<div class="empty-state"><h2>Не удалось загрузить каталог</h2><p>${escapeHTML(message)}</p>
      <button class="button" type="button" data-retry="${target}">Попробовать ещё раз</button></div>`;
  }

  let searchRevision=0,searchMatches=[],searchShown=0,currentSearchQuery='';
  function renderSearchPage(append=false) {
    const results=$('#search-results');
    if(!append){results.replaceChildren();searchShown=0;}
    const next=searchMatches.slice(searchShown,searchShown+30);
    const container=document.createElement('div');container.innerHTML=next.map(entry=>productCard(entry.product)).join('');
    $$('.product-article',container).forEach(node=>highlight(node,currentSearchQuery,true));
    $$('h3 a',container).forEach(node=>highlight(node,currentSearchQuery));
    const first=container.firstElementChild;
    results.append(...container.children);searchShown+=next.length;
    $('#search-more').hidden=searchShown>=searchMatches.length;
    if(append&&first){$('h3 a',first)?.focus({preventScroll:true});}
    if(!searchMatches.length)results.innerHTML='<div class="empty-state"><h2>Ничего не найдено</h2><p>Попробуйте другой артикул, название или сбросьте фильтры.</p><a class="button" href="/catalog.html">Открыть каталог</a></div>';
    $('#search-summary').textContent=`По запросу «${currentSearchQuery}» найдено товаров: ${searchMatches.length}. Показано: ${searchShown}`;
  }
  $('#search-more')?.addEventListener('click',()=>renderSearchPage(true));
  async function search() {
    const results=$('#search-results');if(!results)return;
    const revision=++searchRevision,query=(new URLSearchParams(location.search).get('q')||'').trim().slice(0,200);
    $('#search-query').value=query;
    const clear=$('.large-search .search-clear');if(clear)clear.hidden=!query;
    const summary=$('#search-summary'),filters=$('#search-filters');filters.hidden=true;filters.replaceChildren();$('#search-more').hidden=true;
    if(!SFSearch.words(query).length){summary.textContent='Найдите фурнитуру по названию, артикулу, бренду или отделке.';results.replaceChildren();results.setAttribute('aria-busy','false');return;}
    summary.textContent='Ищем в каталоге…';results.setAttribute('aria-busy','true');results.innerHTML='<p class="loading-state" role="status">Загружаем товары…</p>';
    try{
      const engine=await getSearchEngine();if(revision!==searchRevision)return;
      const matches=engine.find(query);currentSearchQuery=query;searchMatches=matches;
      for(const [key,label] of [['brand','Бренд'],['category','Категория']]){
        const values=[...new Set(matches.map(entry=>entry[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
        if(values.length<2)continue;
        const wrapper=document.createElement('label');wrapper.append(document.createTextNode(label+' '));const select=document.createElement('select');select.dataset.searchFilter=key;
        const all=document.createElement('option');all.value='';all.textContent='Все';select.append(all);
        values.forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);});wrapper.append(select);filters.append(wrapper);
      }
      filters.hidden=!filters.children.length;
      filters.onchange=()=>{const selected=Object.fromEntries($$('select',filters).map(select=>[select.dataset.searchFilter,select.value]));searchMatches=engine.find(query,selected);renderSearchPage();};
      renderSearchPage();
    }catch{
      if(revision!==searchRevision)return;
      summary.textContent='Не удалось выполнить поиск.';results.innerHTML=errorState('Проверьте подключение к интернету и повторите поиск.','search');
    }finally{if(revision===searchRevision)results.setAttribute('aria-busy','false');}
  }

  // Integer kopecks avoid rounding drift; unknown prices never become zero.
  function priceMinor(product) {
    return product?.priceStatus === 'verified' && Number.isSafeInteger(product.priceAmountMinor) && product.priceAmountMinor > 0
      ? BigInt(product.priceAmountMinor) : null;
  }
  function formatPrice(minor) {
    return `${minor / 100n},${String(minor % 100n).padStart(2, '0')} BYN`;
  }
  function itemPriceText(product, quantity) {
    const minor = priceMinor(product);
    return minor === null ? 'Цену уточняйте'
      : `${formatPrice(minor)} × ${quantity} = ${formatPrice(minor * BigInt(quantity))} (с НДС)`;
  }
  function inquiryTotal() {
    let total = 0n, unknown = false;
    getCart().forEach(item => {
      const minor = priceMinor(productMap.get(item.url));
      if (minor === null) unknown = true;
      else total += minor * BigInt(item.qty);
    });
    return unknown ? `Итого: Цену уточняйте${total > 0n ? `. Сумма позиций с подтверждённой ценой: ${formatPrice(total)}` : ''}`
      : `Итого: ${formatPrice(total)} (с НДС)`;
  }

  async function renderCart() {
    const root = $('#cart-content');
    if (!root) return;
    const request = ++cartRender;
    const cart = getCart();
    const form = $('#inquiry-form');
    form.hidden = true;
    if (!cart.length) {
      root.innerHTML = '<div class="empty-state"><h2>Ваша заявка пока пуста</h2><p>Добавьте товары из каталога, чтобы подготовить запрос менеджеру.</p><a class="button" href="/catalog.html">Перейти в каталог →</a></div>';
      root.setAttribute('aria-busy', 'false');
      return;
    }
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '<p class="loading-state" role="status">Загружаем вашу заявку…</p>';
    try {
      await getProducts();
      if (request !== cartRender) return;
      root.innerHTML = cart.map(item => {
        const product = productMap.get(item.url);
        if (!product) return '';
        const p = Object.fromEntries(Object.entries(product).map(([key, value]) => [key, escapeHTML(value)]));
        return `<div class="cart-row" data-cart-url="${p.url}"><img src="${p.image}" alt="${p.name}">
          <div><h3><a href="${p.url}">${p.name}</a></h3><p>${p.article} · ${p.finish}</p><p class="cart-price">${itemPriceText(product, item.qty)}</p></div>
          <div class="qty"><button type="button" data-qty="-1" aria-label="Уменьшить количество ${p.article}">−</button>
            <input type="number" min="1" max="99999" value="${item.qty}" inputmode="numeric" aria-label="Количество ${p.article}">
            <button type="button" data-qty="1" aria-label="Увеличить количество ${p.article}">+</button></div>
          <button type="button" class="cart-remove" data-remove="${p.url}" aria-label="Убрать ${p.article} из заявки">×</button></div>`;
      }).join('') + `<p class="muted cart-total">${inquiryTotal()}</p>`;
      form.hidden = false;
    } catch {
      if (request === cartRender) root.innerHTML = errorState('Ваша заявка сохранена в браузере. Повторите загрузку товаров.', 'cart');
    } finally {
      if (request === cartRender) root.setAttribute('aria-busy', 'false');
    }
  }

  function publicProductURL(product) {
    // route is canonical catalogue data; url is the deployment-specific navigation path.
    const route = product.route || (siteBase && product.url.startsWith(`${siteBase}/`)
      ? product.url.slice(siteBase.length) : product.url);
    return new URL(`${siteBase}${route}`, location.origin).href;
  }

  function inquiryText() {
    const fields = new FormData($('#inquiry'));
    return ['Здравствуйте! Прошу уточнить стоимость и наличие фурнитуры.', '',
      ...getCart().map((item, index) => {
        const product = productMap.get(item.url);
        return product ? `${index + 1}. ${product.name}\nАрт.: ${product.article}\nОтделка: ${product.finish}\nКоличество: ${item.qty} ${product.unit || 'шт.'}\nЦена: ${priceMinor(product) === null ? 'Цену уточняйте' : `${formatPrice(priceMinor(product))} (с НДС)`}\nСумма: ${priceMinor(product) === null ? 'Цену уточняйте' : formatPrice(priceMinor(product) * BigInt(item.qty))}\nСсылка: ${publicProductURL(product)}` : '';
      }), '', inquiryTotal(), '', `Имя: ${fields.get('name')}`, `Телефон: ${fields.get('phone')}`,
      `Комментарий: ${fields.get('comment') || ''}`].join('\n');
  }

  $('#inquiry')?.addEventListener('submit', event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const url = `mailto:${encodeURIComponent(fields.get('manager'))}?subject=${encodeURIComponent('Заявка на подбор фурнитуры')}&body=${encodeURIComponent(inquiryText())}`;
    if (url.length > 7500) {
      toast('Заявка слишком большая для почтовой ссылки. Скопируйте список и отправьте его менеджеру.');
      return;
    }
    location.href = url;
    toast('Заявка подготовлена. Отправьте письмо в почтовой программе.');
  });

  $('#copy-inquiry')?.addEventListener('click', async event => {
    const button=event.currentTarget;
    if (button.disabled) return;
    clearTimeout(addedTimers.get(button));
    if (!buttonLabels.has(button)) buttonLabels.set(button,button.innerHTML);
    button.disabled=true; button.setAttribute('aria-busy','true'); button.textContent='Копируем…';
    try {
      await navigator.clipboard.writeText(inquiryText());
      button.textContent='Скопировано ✓';
      toast('Список скопирован');
    } catch {
      button.textContent='Повторить копирование';
      toast('Не удалось скопировать. Выделите товары на странице и скопируйте вручную.');
    } finally {
      button.disabled=false; button.removeAttribute('aria-busy');
      addedTimers.set(button,setTimeout(() => { button.innerHTML=buttonLabels.get(button); },2200));
    }
  });

  $('[data-copy-article]')?.addEventListener('click', async event => {
    const button=event.currentTarget;
    if (button.disabled) return;
    button.disabled=true;
    try {
      await navigator.clipboard.writeText(button.dataset.copyArticle);
      toast('Артикул скопирован: '+button.dataset.copyArticle);
    } catch { toast('Не удалось скопировать. Выделите артикул и скопируйте вручную.'); }
    finally { button.disabled=false; }
  });
  $('#print-inquiry')?.addEventListener('click', () => window.print());
  // Self-contained PDF export: canvas embeds Cyrillic without external fonts or libraries.
  $('#save-inquiry-pdf')?.addEventListener('click', async event => {
    const button=event.currentTarget;
    button.disabled=true; button.setAttribute('aria-busy','true');
    try {
      await document.fonts.ready;
      const pages=[]; let canvas,ctx,y;
      const newPage=()=>{canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1240,1754);ctx.fillStyle='#202521';ctx.font='24px Arial';y=90;};
      const finish=()=>pages.push(canvas.toDataURL('image/jpeg',.92).split(',')[1]);
      newPage();
      const text='Стеклофурнитура — заявка\n'+new Date().toLocaleDateString('ru-RU')+'\n\n'+inquiryText();
      for(const paragraph of text.split('\n')) {
        let line='';
        for(const word of paragraph.split(' ')) {
          // Split long URLs and articles too, keeping every character.
          for(const char of (line ? ' ' : '')+word) {
            if(ctx.measureText(line+char).width>1060) { if(y>1650){finish();newPage();} ctx.fillText(line,90,y);y+=34;line=''; }
            line+=char;
          }
        }
        if(y>1650){finish();newPage();} ctx.fillText(line,90,y);y+=34;
      }
      finish();
      const encoder=new TextEncoder(),parts=[],offsets=[0];let length=0;
      const append=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;parts.push(bytes);length+=bytes.length;};
      const object=(id,body)=>{offsets[id]=length;append(id+' 0 obj\n');body();append('\nendobj\n');};
      append('%PDF-1.4\n');
      object(1,()=>append('<< /Type /Catalog /Pages 2 0 R >>'));
      object(2,()=>append('<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>'));
      pages.forEach((base64,i)=>{
        const id=3+i*3,raw=atob(base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
        object(id,()=>append('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Photo '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>'));
        object(id+1,()=>{append('<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+bytes.length+' >>\nstream\n');append(bytes);append('\nendstream');});
        const commands='q 595.28 0 0 841.89 0 0 cm /Photo Do Q';
        object(id+2,()=>append('<< /Length '+commands.length+' >>\nstream\n'+commands+'\nendstream'));
      });
      const start=length;append('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
      offsets.slice(1).forEach(offset=>append(String(offset).padStart(10,'0')+' 00000 n \n'));
      append('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF');
      const url=URL.createObjectURL(new Blob(parts,{type:'application/pdf'})),link=document.createElement('a');
      link.href=url;link.download='steklofurnitura-zayavka.pdf';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      toast('PDF заявки сохранён');
    } catch {toast('Не удалось создать PDF. Воспользуйтесь печатью заявки.');}
    finally {button.disabled=false;button.removeAttribute('aria-busy');}
  });


  const sortControl = $('#sort-products');
  sortControl?.addEventListener('change', event => {
    const grid = $('.catalog-products');
    if (!grid) return;
    const cards = $$('.product-card', grid);
    const before = capturePositions(cards);
    cards.forEach((card, index) => { if (card.dataset.order === undefined) card.dataset.order = index; });
    const key = event.target.value;
    try { sessionStorage.setItem('steklofurnitura-sort', key); } catch {}
    cards.sort((a, b) => {
      if (key === 'default') return Number(a.dataset.order) - Number(b.dataset.order);
      const selector = key === 'name' ? 'h3' : '.product-article';
      return $(selector, a).textContent.localeCompare($(selector, b).textContent, 'ru', { numeric: true });
    });
    grid.append(...cards);
    animatePositions(before, cards);
  });

  if (sortControl) {
    try {
      const saved=sessionStorage.getItem('steklofurnitura-sort');
      if (['name','article'].includes(saved)) {
        sortControl.value=saved;
        sortControl.dispatchEvent(new Event('change'));
      }
    } catch {}
  }

  window.addEventListener('storage', event => {
    if (event.key === CART_KEY || event.key === null) {
      updateCount();
      renderCart();
    }
  });
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (!details.matches?.('details.company-details, details.catalog-nav') || !details.open) return;
    const content = $('.prose, .sidebar', details);
    animateUI(content, [{ opacity: .6, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: motionTime.state });
  }, true);
  updateCount();
  search();
  renderCart();
  observeMotion();
  // Transform-only entrance keeps the hero text visible and avoids an opacity gate on LCP.
  $$('.hero-heading, .product-heading, .page-title').forEach(element => animateUI(element,
    [{ transform: 'translateY(8px)' }, { transform: 'translateY(0)' }], { duration: motionTime.reveal }));
})();
