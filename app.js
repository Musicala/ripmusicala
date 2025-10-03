/* Rip Musicala 2025 — TSV Sheets → JSON en cliente
   - Filtros dependientes del nombre
   - Servicios en dropdown con checkboxes
   - Paginación (200 por defecto)
   - Botón "Actualizar datos"
   - Conexión a Apps Script (abrir diálogo y enviar pago rápido)
*/
'use strict';

/* ====== CONFIG ====== */
// URL de tu Web App (Apps Script)
const APPSCRIPT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzH73gIcQH4WM3CNOalvDqGL-whJkjtwBIrjqr0nl8V76nQw2UxicfwM5Jym9_uqruPzA/exec";

// Modo de fuente: "tsv" (Sheets) o "json" (archivos estáticos opcionales)
const SOURCE_MODE = "tsv";

// TSV publicados
const TSV_CLASES = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRv5znuM6DUG7m6DOQBCbjzJiYpZJiuMK23GW__RfMCcOi1kAcMT_7YH7CzBgmtDEJ-HeiJ5bgCKryw/pub?gid=1810443337&single=true&output=tsv";
const TSV_ESTUDIANTES = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRv5znuM6DUG7m6DOQBCbjzJiYpZJiuMK23GW__RfMCcOi1kAcMT_7YH7CzBgmtDEJ-HeiJ5bgCKryw/pub?gid=745458333&single=true&output=tsv";

// JSON estáticos (solo si cambias SOURCE_MODE a "json")
const JSON_CLASES = "./clases.json";
const JSON_ESTUDIANTES = "./estudiantes.json";

// Cache TTL (min)
const CACHE_TTL_MIN = 20;

/* ====== ESTADO ====== */
let CLASES = [];
let NOMBRES = [];
let FILTROS = { estudiante:'', servicios:new Set(), profesor:'', ciclo:'', tipo:'', fechaDesde:'', fechaHasta:'' };

let PAGE_SIZE = 200;
let CURRENT_PAGE = 1;

/* ====== DOM ====== */
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), tableBody = $('tableBody');
const estudianteInput = $('estudianteFilter'), datalistNombres = $('nombresLista');
const profesorSelect = $('profesorFilter'), cicloSelect = $('cicloFilter'), tipoSelect = $('tipoFilter');
const fechaDesde = $('fechaDesde'), fechaHasta = $('fechaHasta');
const btnPDF = $('btnPDF'), btnRefresh = $('btnRefresh');
const servicioToggle = $('servicioToggle'), servicioMenu = $('servicioMenu'), srvCount = $('srvCount');
const prevPageBtn = $('prevPage'), nextPageBtn = $('nextPage'), pageInfoEl = $('pageInfo'), pageSizeSel = $('pageSize');

/* ====== INIT ====== */
(async function init(){
  try{
    const t0 = performance.now();
    status('Cargando datos…');

    const [clasesRaw, nombresRaw] = await Promise.all([ loadClases(), loadEstudiantes() ]);
    CLASES = normalizeClases(clasesRaw).sort((a,b)=> (b.fecha||'').localeCompare(a.fecha||''));
    NOMBRES = (nombresRaw || []).filter(Boolean).sort((a,b)=>a.localeCompare(b,'es'));
    hydrateDatalist(datalistNombres, NOMBRES);

    bindEvents();
    refreshFilterOptionsByName();
    render();

    const t1 = performance.now();
    status(`Listo. ${CLASES.length} registros. (${Math.round(t1 - t0)} ms)`);
  }catch(e){
    console.error(e);
    status('Error cargando datos.');
  }
})();

/* ====== LOADERS ====== */
async function loadClases(){
  if (SOURCE_MODE === "json") return fetchNoCache(JSON_CLASES).then(r=>r.json());
  return fetchTSVasJSON(TSV_CLASES, 'cache_clases_v5', mapClasesRow);
}
async function loadEstudiantes(){
  if (SOURCE_MODE === "json") {
    const e = await fetchNoCache(JSON_ESTUDIANTES).then(r=>r.json());
    return e.map(x => typeof x === 'string' ? x.trim() : String(x?.nombre||'').trim());
  }
  return fetchTSVestudiantes(TSV_ESTUDIANTES, 'cache_estudiantes_v5');
}
async function fetchNoCache(url){ return fetch(url, {cache:'no-store'}); }
async function fetchTSVasJSON(url, cacheKey, rowMapper){
  const cached = readCache(cacheKey); if (cached) return cached;
  const txt = await (await fetchNoCache(url)).text();
  const rows = parseTSV(txt);
  const json = rows.slice(1).map(rowMapper).filter(Boolean);
  writeCache(cacheKey, json);
  return json;
}
async function fetchTSVestudiantes(url, cacheKey){
  const cached = readCache(cacheKey); if (cached) return cached;
  const txt = await (await fetchNoCache(url)).text();
  const rows = parseTSV(txt);
  const nombres = rows.slice(1).map(r => (r[0] || '').trim()).filter(Boolean);
  writeCache(cacheKey, nombres);
  return nombres;
}

/* ====== PARSERS ====== */
function parseTSV(text){
  return text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n')
             .filter(line => line.length>0).map(line=>line.split('\t'));
}
function mapClasesRow(row){
  // 0 estudiante | 2 tipo | 4 fecha | 8 hora | 5 servicio | 6 #clase | 7 ciclo | 9 profesor | 10 pago | 11 comentario
  if (!row || row.length === 0) return null;
  return {
    estudiante: row[0]  || "",
    tipo:       row[2]  || "",
    fecha:      row[4]  ? row[4].trim() : "",
    hora:       row[8]  || "",
    servicio:   row[5]  || "",
    numClase:   row[6]  || "",
    ciclo:      row[7]  || "",
    profesor:   row[9]  || "",
    pago:       row[10] || "",
    comentario: row[11] || ""
  };
}
function normalizeClases(clases){
  return (clases||[]).map(row => ({
    estudiante: row.estudiante || '',
    tipo:       row.tipo || '',
    fecha:      normalizeDate(row.fecha),
    hora:       row.hora || '',
    servicio:   row.servicio || '',
    numClase:   row.numClase || '',
    ciclo:      row.ciclo || '',
    profesor:   row.profesor || '',
    pago:       row.pago || '',
    comentario: row.comentario || ''
  }));
}
function normalizeDate(s){
  if (!s) return '';
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1){ const [,d,m,y]=m1; return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
  const dt = new Date(str);
  if (!isNaN(dt)){ const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,'0'), d=String(dt.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
  return '';
}

/* ====== CACHE ====== */
function readCache(key){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, ttl, data } = JSON.parse(raw);
    if (!t || !ttl) return null;
    if (Date.now() - t > ttl){ localStorage.removeItem(key); return null; }
    return data;
  }catch{ return null; }
}
function writeCache(key, data){
  try{
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), ttl: CACHE_TTL_MIN*60*1000, data }));
  }catch{}
}
function clearAllCache(){
  Object.keys(localStorage).forEach(k=>{
    if (k.startsWith('cache_clases_') || k.startsWith('cache_estudiantes_')) localStorage.removeItem(k);
  });
}

/* ====== UI HELPERS ====== */
function status(msg){ statusEl.textContent = msg || ''; }
function uniqueSorted(arr){ return [...new Set(arr.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')); }
function hydrateSelect(select, values, {keepAllOption=true}={}){
  const hadAll = keepAllOption && (select.querySelector('option[value=""]') !== null);
  select.innerHTML = hadAll ? '<option value="">Todos</option>' : '';
  const frag = document.createDocumentFragment();
  values.forEach(v=>{ const opt=document.createElement('option'); opt.value=v; opt.textContent=v; frag.appendChild(opt); });
  select.appendChild(frag);
}
function hydrateDatalist(datalist, nombres){
  datalist.innerHTML = '';
  const frag = document.createDocumentFragment();
  nombres.forEach(n=>{ const opt=document.createElement('option'); opt.value=n; frag.appendChild(opt); });
  datalist.appendChild(frag);
}
function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

/* ====== LÓGICA: universo por nombre ====== */
function rowsByName(){
  const qName = (FILTROS.estudiante||'').toLowerCase();
  if (!qName) return CLASES;
  return CLASES.filter(c => String(c.estudiante).toLowerCase().includes(qName));
}
function refreshFilterOptionsByName(){
  const universe = rowsByName();

  const prevServicios = new Set(FILTROS.servicios);
  const prevProfesor  = FILTROS.profesor;
  const prevCiclo     = FILTROS.ciclo;
  const prevTipo      = FILTROS.tipo;

  const servicios = uniqueSorted(universe.map(x=>x.servicio));
  const profesores= uniqueSorted(universe.map(x=>x.profesor));
  const ciclos    = uniqueSorted(universe.map(x=>x.ciclo));
  const tipos     = uniqueSorted(universe.map(x=>x.tipo));

  hydrateServiceDropdown(servicioMenu, servicios, prevServicios);
  hydrateSelect(profesorSelect, profesores);
  hydrateSelect(cicloSelect, ciclos);
  hydrateSelect(tipoSelect, tipos);

  // Restaurar selecciones válidas
  FILTROS.servicios = getCheckedServicesLower();
  if (profesores.includes(prevProfesor))  { profesorSelect.value = prevProfesor; FILTROS.profesor = prevProfesor; } else { profesorSelect.value=''; FILTROS.profesor=''; }
  if (ciclos.includes(prevCiclo))         { cicloSelect.value    = prevCiclo;    FILTROS.ciclo    = prevCiclo;    } else { cicloSelect.value='';    FILTROS.ciclo='';    }
  if (tipos.includes(prevTipo))           { tipoSelect.value     = prevTipo;     FILTROS.tipo     = prevTipo;     } else { tipoSelect.value='';     FILTROS.tipo='';     }

  CURRENT_PAGE = 1;
  updateServiceBadge();
}

/* ====== Servicios: dropdown con checkboxes ====== */
function hydrateServiceDropdown(menu, services, prevSelectedLowerSet){
  menu.innerHTML = '';
  const frag = document.createDocumentFragment();
  services.forEach(srv=>{
    const id = 'srv_' + btoa(unescape(encodeURIComponent(srv))).replace(/=+$/,'');
    const label = document.createElement('label'); label.className='check'; label.htmlFor=id;

    const input = document.createElement('input'); input.type='checkbox'; input.id=id; input.value=srv;
    if (prevSelectedLowerSet && prevSelectedLowerSet.has(srv.toLowerCase())) input.checked = true;

    const text = document.createElement('span'); text.className='tag'; text.textContent = srv;

    label.appendChild(input); label.appendChild(text); frag.appendChild(label);
  });
  menu.appendChild(frag);
}
function getCheckedServicesLower(){
  return new Set(Array.from(servicioMenu.querySelectorAll('input[type="checkbox"]:checked')).map(i=>i.value.toLowerCase()));
}
function updateServiceBadge(){
  srvCount.textContent = String(getCheckedServicesLower().size);
}

/* ====== EVENTOS ====== */
function bindEvents(){
  const debounce = (fn, ms=200)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

  // Estudiante
  estudianteInput.addEventListener('input', debounce(()=>{
    FILTROS.estudiante = estudianteInput.value.trim();
    refreshFilterOptionsByName();
    render();
  }));

  // Dropdown toggle + outside click
  servicioToggle.addEventListener('click', ()=>{ servicioMenu.classList.toggle('open'); });
  document.addEventListener('click', (e)=>{ if (!e.target.closest('#servicioGroup')) servicioMenu.classList.remove('open'); });

  // Cambios en checkboxes
  servicioMenu.addEventListener('change', ()=>{
    FILTROS.servicios = getCheckedServicesLower();
    CURRENT_PAGE = 1;
    updateServiceBadge();
    render();
  });

  profesorSelect.addEventListener('change', ()=>{ FILTROS.profesor = profesorSelect.value; CURRENT_PAGE=1; render(); });
  cicloSelect.addEventListener('change',    ()=>{ FILTROS.ciclo    = cicloSelect.value;    CURRENT_PAGE=1; render(); });
  tipoSelect.addEventListener('change',     ()=>{ FILTROS.tipo     = tipoSelect.value;     CURRENT_PAGE=1; render(); });
  fechaDesde.addEventListener('change',     ()=>{ FILTROS.fechaDesde = fechaDesde.value;   CURRENT_PAGE=1; render(); });
  fechaHasta.addEventListener('change',     ()=>{ FILTROS.fechaHasta = fechaHasta.value;   CURRENT_PAGE=1; render(); });

  // Paginación
  prevPageBtn.addEventListener('click', ()=>{ if (CURRENT_PAGE>1){ CURRENT_PAGE--; render(); }});
  nextPageBtn.addEventListener('click', ()=>{ CURRENT_PAGE++; render(); });
  pageSizeSel.addEventListener('change', ()=>{
    PAGE_SIZE = parseInt(pageSizeSel.value,10) || 200;
    CURRENT_PAGE = 1;
    render();
  });

  // PDF
  btnPDF.addEventListener('click', descargarPDF);

  // Refresh de TSV/JSON
  btnRefresh.addEventListener('click', async ()=>{
    clearAllCache();
    status('Actualizando…');
    try{
      const [clasesRaw, nombresRaw] = await Promise.all([ loadClases(), loadEstudiantes() ]);
      CLASES = normalizeClases(clasesRaw).sort((a,b)=> (b.fecha||'').localeCompare(a.fecha||''));
      NOMBRES = (nombresRaw || []).filter(Boolean).sort((a,b)=>a.localeCompare(b,'es'));
      hydrateDatalist(datalistNombres, NOMBRES);
      refreshFilterOptionsByName();
      render();
      status('Datos actualizados.');
    }catch(e){ console.error(e); status('Error actualizando.'); }
  });

  // Apps Script: abrir diálogo
  $('btnOpenDialog').addEventListener('click', ()=>{
    window.open(`${APPSCRIPT_WEBAPP_URL}?page=dialog`, '_blank', 'width=420,height=800');
  });

  // Apps Script: enviar pago rápido
  $('btnSendQuick').addEventListener('click', async ()=>{
    try{
      const payload = {
        fechaPago: new Date().toISOString().slice(0,10),
        usuario1: (estudianteInput.value || "").trim(),
        usuarionoregistrado: "",
        servicio1: Array.from(getCheckedServicesLower()).values().next()?.value || "",
        ciclo1: cicloSelect.value || "",
        precioServicio1: "",

        usuario2: "", servicio2: "", ciclo2: "", precioServicio2: "",
        usuario3: "", servicio3: "", ciclo3: "", precioServicio3: "",

        medioPago: "", recargo: "", descuento: "", FEVM: "", comentario: ""
      };

      const res = await fetch(APPSCRIPT_WEBAPP_URL, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      });
      const json = await res.json();
      alert(json.ok ? 'Pago enviado correctamente ✅' : ('Error al guardar ❌: ' + (json.error || '')));
    }catch(e){
      console.error(e);
      alert('Error de red o CORS al enviar.');
    }
  });
}

/* ====== RENDER con paginación ====== */
function render(){
  const base = rowsByName();
  const rows = base.filter(c=>{
    if (FILTROS.profesor && c.profesor !== FILTROS.profesor) return false;
    if (FILTROS.ciclo    && c.ciclo    !== FILTROS.ciclo)    return false;
    if (FILTROS.tipo     && c.tipo     !== FILTROS.tipo)     return false;

    if (FILTROS.servicios.size && !FILTROS.servicios.has(String(c.servicio).toLowerCase())) return false;

    if ((FILTROS.fechaDesde || FILTROS.fechaHasta) && c.fecha){
      const cf = new Date(c.fecha);
      if (FILTROS.fechaDesde && cf < new Date(FILTROS.fechaDesde)) return false;
      if (FILTROS.fechaHasta && cf > new Date(FILTROS.fechaHasta)) return false;
    }
    return true;
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;
  const startIdx = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const endIdx   = Math.min(startIdx + PAGE_SIZE, total);
  const slice = rows.slice(startIdx, endIdx);

  let html = '';
  for (const c of slice){
    html += `<tr>
      <td>${esc(c.estudiante)}</td>
      <td>${esc(c.tipo)}</td>
      <td>${esc(c.fecha)}</td>
      <td>${esc(c.hora)}</td>
      <td>${esc(c.servicio)}</td>
      <td>${esc(c.numClase)}</td>
      <td>${esc(c.ciclo)}</td>
      <td>${esc(c.profesor)}</td>
      <td>${esc(c.pago)}</td>
      <td>${esc(c.comentario)}</td>
    </tr>`;
  }
  tableBody.innerHTML = html;

  prevPageBtn.disabled = CURRENT_PAGE <= 1;
  nextPageBtn.disabled = CURRENT_PAGE >= totalPages;
  pageInfoEl.textContent = `Mostrando ${total ? (startIdx+1) : 0}–${endIdx} de ${total} • Página ${CURRENT_PAGE}/${totalPages}`;

  status(`${slice.length} de ${base.length} registros (filtrados por nombre)`);
}

/* ====== PDF ====== */
function descargarPDF(){
  if (typeof html2pdf === 'undefined') return alert('html2pdf no está cargado.');
  const tabla = document.getElementById('tablaContainer');
  const opciones = {
    margin: 10, filename: 'reporte_clases.pdf',
    image: { type: 'jpeg', quality: 1 },
    html2canvas: { scale: 3, dpi: 300, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };
  html2pdf().set(opciones).from(tabla).save();
}
