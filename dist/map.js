/* Official Yandex Maps widget; office coordinates retained. */
(() => {
 'use strict';
 const element=document.getElementById('office-map');
 if(!element)return;
 const status=element.closest('.map-panel').querySelector('.map-status');
 const frame=document.createElement('iframe');
 frame.title='Яндекс Карты — СтеклоФурнитура, проспект Независимости, 177';
 frame.src='https://yandex.by/map-widget/v1/?ll=27.682951%2C53.945793&z=16&pt=27.682951%2C53.945793%2Cpm2rdm';
 frame.loading='lazy';
 frame.allowFullscreen=true;
 frame.style.cssText='width:100%;height:100%;min-height:420px;border:0;display:block';
 frame.addEventListener('load',()=>{element.dataset.state='ready';status.textContent='Яндекс Карты. Адрес и построение маршрута доступны.';});
 element.append(frame);
 element.dataset.initialized='true';
 status.textContent='Яндекс Карты · офис в БЦ «ПОРТ». Адрес и маршрут доступны.';
})();
