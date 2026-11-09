/* Shared catalogue, enquiry and accessibility interactions. No server-side submission. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
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
  let toastExitAnimation;
  const menuExitAnimations = new WeakMap();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cartRender = 0;

  async function getProducts() {
    if (!productsPromise) {
      productsPromise = fetch('/products.json')
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
    $$('.cart-count').forEach(element => { element.textContent = quantity; });
    $$('.cart-link').forEach(element => {
      element.setAttribute('aria-label', `Ваша заявка. Количество: ${quantity}`);
    });
  }

  function toast(message, withCartLink = false) {
    const element = $('.toast');
    if (!element) return;
    clearTimeout(toastTimer);
    if (toastExitAnimation) {
      toastExitAnimation.cancel();
      toastExitAnimation = undefined;
    }
    element.replaceChildren(document.createTextNode(message));
    if (withCartLink) {
      const link = document.createElement('a');
      link.href = '/system/cart.html';
      link.textContent = 'Открыть заявку';
      element.append(document.createTextNode(' '), link);
    }
    element.hidden = false;
    const dismiss = () => {
      if (element.contains(document.activeElement) || element.matches(':hover')) {
        toastTimer = setTimeout(dismiss, 1500);
      } else if (!reducedMotion.matches && element.animate) {
        const exiting = element.animate(
          [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 8px' }],
          { duration: 180, easing: 'ease-in', fill: 'forwards' }
        );
        toastExitAnimation = exiting;
        exiting.onfinish = () => {
          if (toastExitAnimation !== exiting) return;
          element.hidden = true;
          toastExitAnimation = undefined;
        };
      } else {
        element.hidden = true;
      }
    };
    toastTimer = setTimeout(dismiss, withCartLink ? 6000 : 4500);
  }

  function showMenu(id, open, { trigger, moveFocus = false, restoreFocus = false } = {}) {
    const panel = document.getElementById(id);
    if (!panel) return;
    const wasOpen = !panel.hidden && panel.dataset.closing !== 'true';
    if (open && trigger && !panel.contains(trigger)) menuOpeners.set(id, trigger);
    const previousExit = menuExitAnimations.get(panel);
    if (previousExit) {
      previousExit.cancel();
      menuExitAnimations.delete(panel);
    }
    if (open) {
      panel.hidden = false;
      panel.removeAttribute('data-closing');
      panel.style.pointerEvents = '';
    } else if (!panel.hidden && !reducedMotion.matches && panel.animate) {
      // Keep the panel rendered briefly for a smooth exit; prevent interaction.
      panel.dataset.closing = 'true';
      panel.style.pointerEvents = 'none';
      const exiting = panel.animate(
        [{ opacity: 1, transform: 'translateY(0)' },
         { opacity: 0, transform: 'translateY(-7px)' }],
        { duration: 160, easing: 'ease-in', fill: 'forwards' }
      );
      menuExitAnimations.set(panel, exiting);
      exiting.onfinish = () => {
        if (menuExitAnimations.get(panel) !== exiting) return;
        panel.hidden = true;
        panel.removeAttribute('data-closing');
        panel.style.pointerEvents = '';
        menuExitAnimations.delete(panel);
      };
    } else {
      panel.hidden = true;
      panel.removeAttribute('data-closing');
      panel.style.pointerEvents = '';
    }
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
      saveCart(cart);
    }
  }

  function selectProductImage(thumbnail) {
    const image = $('#detail-photo');
    if (!image || !thumbnail) return;
    if (image.src !== new URL(thumbnail.dataset.image, location.href).href) {
      image.src = thumbnail.dataset.image;
      if (!reducedMotion.matches && image.animate) {
        image.animate(
          [{ opacity: 0.65 }, { opacity: 1 }],
          { duration: 230, easing: 'ease-out' }
        );
      }
    }
    const zoom = image.closest('a[data-lightbox]');
    if (zoom) zoom.href = thumbnail.dataset.image;
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
    close.addEventListener('click', () => dialog.close());
    dialog.append(image, close);
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (link.isConnected) link.focus({ preventScroll: true });
    }, { once: true });
    dialog.showModal();
    close.focus();
  }

  async function addProduct(button) {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
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
        button.classList.add('is-added');
        setTimeout(() => button.classList.remove('is-added'), 1600);
        toast('Товар добавлен в заявку.', true);
      }
    } catch {
      toast('Не удалось загрузить товар. Нажмите кнопку ещё раз.');
    } finally {
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
      const open = panel.hidden || panel.dataset.closing === 'true';
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
      const index = rows.indexOf(remove.closest('.cart-row'));
      if (saveCart(getCart().filter(item => item.url !== remove.dataset.remove))) {
        await renderCart();
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
    } catch {
      summary.textContent = 'Не удалось выполнить поиск.';
      results.innerHTML = errorState('Проверьте подключение к интернету и повторите поиск.', 'search');
    } finally {
      results.setAttribute('aria-busy', 'false');
    }
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
          <div><h3><a href="${p.url}">${p.name}</a></h3><p>${p.article} · ${p.finish}</p></div>
          <div class="qty"><button type="button" data-qty="-1" aria-label="Уменьшить количество ${p.article}">−</button>
            <input type="number" min="1" max="99999" value="${item.qty}" inputmode="numeric" aria-label="Количество ${p.article}">
            <button type="button" data-qty="1" aria-label="Увеличить количество ${p.article}">+</button></div>
          <button type="button" class="cart-remove" data-remove="${p.url}" aria-label="Убрать ${p.article} из заявки">×</button></div>`;
      }).join('');
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
        return product ? `${index + 1}. ${product.name}\nАрт.: ${product.article}\nОтделка: ${product.finish}\nКоличество: ${item.qty} ${product.unit || 'шт.'}\nСсылка: ${publicProductURL(product)}` : '';
      }), '', `Имя: ${fields.get('name')}`, `Телефон: ${fields.get('phone')}`,
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
    cards.forEach((card, index) => { if (card.dataset.order === undefined) card.dataset.order = index; });
    const key = event.target.value;
    cards.sort((a, b) => {
      if (key === 'default') return Number(a.dataset.order) - Number(b.dataset.order);
      const selector = key === 'name' ? 'h3' : '.product-article';
      return $(selector, a).textContent.localeCompare($(selector, b).textContent, 'ru', { numeric: true });
    });
    grid.append(...cards);
  });

  window.addEventListener('storage', event => {
    if (event.key === CART_KEY || event.key === null) {
      updateCount();
      renderCart();
    }
  });
  updateCount();
  search();
  renderCart();
})();
