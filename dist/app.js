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
    if (open) clearExit(panel);
    if (wasOpen && !open) animateExit(panel);
    motionByElement.get(panel)?.cancel();
    panel.hidden = !open;
    if (open && !wasOpen) animateUI(panel, [{ opacity: 0, translate: '0 -8px' }, { opacity: 1, translate: '0 0' }], { duration: motionTime.enter });
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
  $$('form.search, form.large-search').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const query = $('input[name="q"]', form).value.trim();
      location.assign('/search.html?q=' + encodeURIComponent(query));
    });
  });

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
      image.src = next;
      const zoom = image.closest('a[data-lightbox]');
      if (zoom) zoom.href = next;
      animateUI(image, [{ opacity: .65 }, { opacity: 1 }], { duration: motionTime.medium });
    };
    if (image.src !== new URL(next, location.href).href) {
      image.setAttribute('aria-busy', 'true');
      preloader.onload = apply;
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
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Закрыть изображение');
    [...exitLayers.keys()].filter(element => !element.isConnected).forEach(clearExit);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
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

  async function search() {
    const results = $('#search-results');
    if (!results) return;
    const query = (new URLSearchParams(location.search).get('q') || '').trim();
    $('#search-query').value = query;
    const summary = $('#search-summary');
    if (!query) {
      summary.textContent = 'Найдите фурнитуру по названию, артикулу, бренду или отделке.';
      return;
    }
    summary.textContent = 'Ищем в каталоге…';
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<p class="loading-state" role="status">Загружаем товары…</p>';
    try {
      const products = await getProducts();
      const normalize = value => value.toLocaleLowerCase('ru').replace(/[\s\-–хx×]/g, '');
      const words = query.split(/\s+/).filter(Boolean).map(normalize);
      const matches = products.filter(product => words.every(word =>
        normalize([product.name, product.article, product.finish, product.url].join(' ')).includes(word)
      ));
      summary.textContent = `По запросу «${query}» найдено товаров: ${matches.length}`;
      results.innerHTML = matches.length ? matches.map(productCard).join('') :
        '<div class="empty-state"><h2>Ничего не найдено</h2><p>Попробуйте другой артикул или более короткое название.</p><a class="button" href="/catalog.html">Открыть каталог</a></div>';
      animateUI(results, [{ opacity: .6 }, { opacity: 1 }], { duration: motionTime.quick });
    } catch {
      summary.textContent = 'Не удалось выполнить поиск.';
      results.innerHTML = errorState('Проверьте подключение к интернету и повторите поиск.', 'search');
    } finally {
      results.setAttribute('aria-busy', 'false');
    }
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

  $('#copy-inquiry')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inquiryText());
      toast('Список скопирован');
    } catch {
      toast('Не удалось скопировать. Выделите товары на странице и скопируйте вручную.');
    }
  });

  $('#sort-products')?.addEventListener('change', event => {
    const grid = $('.catalog-products');
    if (!grid) return;
    const cards = $$('.product-card', grid);
    const before = capturePositions(cards);
    cards.forEach((card, index) => { if (card.dataset.order === undefined) card.dataset.order = index; });
    const key = event.target.value;
    cards.sort((a, b) => {
      if (key === 'default') return Number(a.dataset.order) - Number(b.dataset.order);
      const selector = key === 'name' ? 'h3' : '.product-article';
      return $(selector, a).textContent.localeCompare($(selector, b).textContent, 'ru', { numeric: true });
    });
    grid.append(...cards);
    animatePositions(before, cards);
  });

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
