/* Leaflet 1.9.4; coordinates retained from the original company map. */
(() => {
 'use strict';
 const element=document.getElementById('office-map');
 if(!element)return;
 const panel=element.closest('.map-panel');
 const status=panel.querySelector('.map-status');
 const reset=panel.querySelector('.map-reset');
 function start(){
  if(!window.L){status.textContent='Карта недоступна. Используйте адрес и кнопку построения маршрута.';element.dataset.state='error';return;}
  const center=[Number(element.dataset.lat),Number(element.dataset.lng)];
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const map=L.map(element,{scrollWheelZoom:false,zoomControl:false,fadeAnimation:!reduced,zoomAnimation:!reduced}).setView(center,16);
  L.control.zoom({position:'topright',zoomInTitle:'Приблизить',zoomOutTitle:'Отдалить'}).addTo(map);
  const tiles=L.tileLayer(element.dataset.tiles,{maxZoom:19,keepBuffer:0,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  let loaded=0;
  tiles.on('tileload',()=>{loaded++;element.dataset.state='ready';status.textContent='Перемещайте карту. Масштаб — кнопками + и −. Клавиатура: стрелки, + и −.';});
  tiles.on('tileerror',()=>{if(!loaded){element.dataset.state='error';status.textContent='Не удалось загрузить подложку карты. Адрес и построение маршрута доступны.';}});
  const icon=L.divIcon({className:'office-marker',html:'<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 21V5l7-3 7 3v16M9 9h6M9 13h6M9 17h6"/></svg></span>',iconSize:[46,52],iconAnchor:[23,48]});
  L.marker(center,{icon,title:'Офис СтеклоФурнитура, Независимости, 177',alt:'Офис СтеклоФурнитура'}).addTo(map).bindPopup('<strong>СтеклоФурнитура</strong><br>БЦ «ПОРТ», офис 30');
  reset.hidden=false;reset.addEventListener('click',()=>map.setView(center,16,{animate:!reduced}));
  element.dataset.initialized='true';
 }
 if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();start();}},{rootMargin:'0px'});observer.observe(element);}else start();
})();
