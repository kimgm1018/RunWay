(function(){
var H='<!doctype html><html lang="ko"><head><meta charset="utf-8">'
+'<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="anonymous">'
+'<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin="anonymous"><\/script>'
+'<style>html,body,#m{margin:0;height:100%;background:#e9e9ea}'
+'.leaflet-tile-pane{filter:grayscale(1) contrast(.85) brightness(1.08)}'
+'#tint{position:absolute;inset:0;z-index:401;pointer-events:none;background:#5980a6;mix-blend-mode:color;opacity:.55}'
+'.leaflet-control-attribution{font:9px/1.2 system-ui,sans-serif;background:rgba(242,242,243,.85)!important}'
+'.me{width:16px;height:16px;border-radius:50%;background:#416180;border:3px solid #f2f2f3;box-shadow:0 0 0 1px #416180}'
+'.ring{position:absolute;inset:-14px;border-radius:50%;border:1px solid #416180;opacity:.5}'
+'.dim #m{filter:grayscale(1) opacity(.35)}'
+'.rw .leaflet-tile-pane{filter:grayscale(1) contrast(.9) brightness(1.04)}'
+'.rw #tint{background:#4FD0BF;opacity:.18}'
+'.rw .me{background:#191C27;border-color:#fff;box-shadow:0 0 0 1px #191C27}'
+'.rw .ring{border-color:#4FD0BF;opacity:.9;inset:-16px;border-width:2px;background:rgba(164,221,210,.25)}'
+'.rw .leaflet-control-attribution{background:rgba(255,255,255,.85)!important}</style></head>'
+'<body><div id="m"></div><div id="tint"></div><script>'
+'var q=new URLSearchParams(window.__Q||"");'
+'var lat=+(q.get("lat")||37.5283),lng=+(q.get("lng")||126.9326),z=+(q.get("z")||15);'
+'if(q.get("theme")==="rw")document.body.classList.add("rw");'
+'if(q.get("dim"))document.body.classList.add("dim");'
+'var map=L.map("m",{zoomControl:false,attributionControl:true,dragging:!q.get("static"),scrollWheelZoom:false}).setView([lat,lng],z);'
+'L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap · © CARTO",subdomains:"abcd",maxZoom:19}).addTo(map);'
+'map.attributionControl.setPrefix(false);'
+'if(!q.get("dim")&&!q.get("nome")&&!q.get("route"))L.marker([lat,lng],{icon:L.divIcon({className:"",html:\'<div class="me"><div class="ring"></div></div>\',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map);'
+'if(q.get("pins")){var pts=q.get("pins").split(";").map(function(s){return s.split(",").map(Number)});'
+'pts.forEach(function(p,i){L.marker(p,{icon:L.divIcon({className:"",html:\'<div style="width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:700 12px/1 system-ui;\'+(i===0?"background:#191C27;color:#A7F6EC;":"background:#fff;color:#191C27;")+\'box-shadow:0 2px 6px rgba(25,28,39,.3)">\'+(i+1)+"</div>",iconSize:[26,26],iconAnchor:[13,13]})}).addTo(map)});'
+'if(q.get("fit"))map.fitBounds(L.latLngBounds(pts.concat([[lat,lng]])),{padding:[36,36]});}'
+'if(q.get("route")){var r=q.get("route").split(";").map(function(s){return s.split(",").map(Number)});'
+'L.polyline(r,{color:"#fff",weight:8,opacity:.9,lineJoin:"round",lineCap:"round"}).addTo(map);'
+'L.polyline(r,{color:"#191C27",weight:4,lineJoin:"round",lineCap:"round"}).addTo(map);'
+'var dot=function(p,bg,fg,t){L.marker(p,{icon:L.divIcon({className:"",html:\'<div style="width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font:700 9px/1 system-ui;background:\'+bg+";color:"+fg+\';border:2px solid #fff;box-shadow:0 2px 5px rgba(25,28,39,.3)">\'+t+"</div>",iconSize:[20,20],iconAnchor:[10,10]})}).addTo(map)};'
+'dot(r[r.length-1],"#191C27","#A7F6EC","F");dot(r[0],"#A7F6EC","#191C27","S");'
+'map.fitBounds(L.latLngBounds(r),{padding:[16,16]});}'
+'<\/script></body></html>';
function fix(f){var p=f.getAttribute('data-map');if(p==null||f.__rwMap===p)return;f.__rwMap=p;
f.setAttribute('srcdoc',H.replace('<body>','<body><script>window.__Q='+JSON.stringify(p)+'<\/script>'));}
function scan(){document.querySelectorAll('iframe[data-map]').forEach(fix);}
new MutationObserver(scan).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-map']});
document.addEventListener('DOMContentLoaded',scan);scan();
})();
