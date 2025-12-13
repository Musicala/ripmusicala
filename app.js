/* Rip Musicala 2025 — TSV Sheets → JSON en cliente
   - Filtros dependientes del nombre
   - Servicios en dropdown con checkboxes
   - Paginación (200 por defecto)
   - Botón "Actualizar datos"
   - Conexión a Apps Script (abrir diálogo, enviar pago rápido, editar/duplicar/eliminar clase)
*/
'use strict';

/* ====== CONFIG ====== */
// URL de tu Web App (Apps Script) RIP 2025
const APPSCRIPT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzVCHfSnhRzT6YqbnNz-k3yy9OkkDREMcCXj11z-5U8xImvFB8-OoZk7HDEYQPUyMoA/exec";

// Nombre de hoja en Apps Script (por si quieres mandarlo explícito)
const RIP_SHEET_NAME = 'Registro 2025';

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
let FILTROS = {
  estudiante: '',
  servicios: new Set(),
  profesor: '',
  ciclo: '',
  tipo: '',
  fechaDesde: '',
  fechaHasta: ''
};

let PAGE_SIZE = 200;
let CURRENT_PAGE = 1;

/* ====== DOM ====== */
const $ = (id) => document.getElementById(id);

const statusEl        = $('status');
const tableBody       = $('tableBody');
const estudianteInput = $('estudianteFilter');
const datalistNombres = $('nombresLista');

const profesorSelect  = $('profesorFilter');
const cicloSelect     = $('cicloFilter');
const tipoSelect      = $('tipoFilter');

const fechaDesde      = $('fechaDesde');
const fechaHasta      = $('fechaHasta');

const btnPDF          = $('btnPDF');
const btnRefresh      = $('btnRefresh');

const servicioToggle  = $('servicioToggle');
const servicioMenu    = $('servicioMenu');
const srvCount        = $('srvCount');

const prevPageBtn     = $('prevPage');
const nextPageBtn     = $('nextPage');
const pageInfoEl      = $('pageInfo');
const pageSizeSel     = $('pageSize');

const btnOpenDialog   = $('btnOpenDialog');
const btnSendQuick    = $('btnSendQuick');

const toastWrap       = $('toastWrap');

/* ====== INIT ====== */
(async function init(){
  try{
    const t0 = performance.now();
    status('Cargando datos…');

    const [clasesRaw, nombresRaw] = await Promise.all([
      loadClases(),
      loadEstudiantes()
    ]);

    CLASES = normalizeClases(clasesRaw)
      .sort((a,b)=> (b.fecha || '').localeCompare(a.fecha || ''));

    NOMBRES = (nombresRaw || [])
      .filter(Boolean)
      .sort((a,b)=> a.localeCompare(b,'es'));

    hydrateDatalist(datalistNombres, NOMBRES);

    bindEvents();
    refreshFilterOptionsByName();
    render();

    const t1 = performance.now();
    status(`Listo. ${CLASES.length} registros. (${Math.round(t1 - t0)} ms)`);
  }catch(e){
    console.error(e);
    status('Error cargando datos.');
    showToast('warn', 'Error cargando datos.');
  }
})();

/* ====== LOADERS ====== */
async function loadClases(){
  if (SOURCE_MODE === "json") {
    return fetchNoCache(JSON_CLASES).then(r => r.json());
  }
  return fetchTSVasJSON(TSV_CLASES, 'cache_clases_v5', mapClasesRow);
}

async function loadEstudiantes(){
  if (SOURCE_MODE === "json") {
    const e = await fetchNoCache(JSON_ESTUDIANTES).then(r => r.json());
    return e.map(x => typeof x === 'string'
      ? x.trim()
      : String(x?.nombre || '').trim()
    );
  }
  return fetchTSVestudiantes(TSV_ESTUDIANTES, 'cache_estudiantes_v5');
}

async function fetchNoCache(url){
  return fetch(url, { cache:'no-store' });
}

async function fetchTSVasJSON(url, cacheKey, rowMapper){
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const txt  = await (await fetchNoCache(url)).text();
  const rows = parseTSV(txt);
  const json = rows.slice(1)
    .map(rowMapper)
    .filter(Boolean);

  writeCache(cacheKey, json);
  return json;
}

async function fetchTSVestudiantes(url, cacheKey){
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const txt   = await (await fetchNoCache(url)).text();
  const rows  = parseTSV(txt);
  const nombres = rows
    .slice(1)
    .map(r => (r[0] || '').trim())
    .filter(Boolean);

  writeCache(cacheKey, nombres);
  return nombres;
}

/* ====== PARSERS ====== */
function parseTSV(text){
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => line.split('\t'));
}

// 0 estudiante | 2 tipo | 4 fecha | 8 hora | 5 servicio | 6 #clase | 7 ciclo | 9 profesor | 10 pago | 11 comentario
function mapClasesRow(row){
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
  return (clases || []).map(row => ({
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

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // dd/mm/yyyy
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1){
    const [, d, m, y] = m1;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const dt = new Date(str);
  if (!isNaN(dt)){
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

/* ====== CACHE ====== */
function readCache(key){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, ttl, data } = JSON.parse(raw);
    if (!t || !ttl) return null;
    if (Date.now() - t > ttl){
      localStorage.removeItem(key);
      return null;
    }
    return data;
  }catch{
    return null;
  }
}

function writeCache(key, data){
  try{
    localStorage.setItem(
      key,
      JSON.stringify({
        t: Date.now(),
        ttl: CACHE_TTL_MIN * 60 * 1000,
        data
      })
    );
  }catch{}
}

function clearAllCache(){
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('cache_clases_') || k.startsWith('cache_estudiantes_')) {
      localStorage.removeItem(k);
    }
  });
}

/* ====== UI HELPERS ====== */
function status(msg){
  statusEl.textContent = msg || '';
}

function uniqueSorted(arr){
  return [...new Set(arr.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
}

function hydrateSelect(select, values, {keepAllOption=true}={}){
  const hadAll = keepAllOption && (select.querySelector('option[value=""]') !== null);
  select.innerHTML = hadAll ? '<option value="">Todos</option>' : '';

  const frag = document.createDocumentFragment();
  values.forEach(v=>{
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    frag.appendChild(opt);
  });
  select.appendChild(frag);
}

function hydrateDatalist(datalist, nombres){
  datalist.innerHTML = '';
  const frag = document.createDocumentFragment();
  nombres.forEach(n=>{
    const opt = document.createElement('option');
    opt.value = n;
    frag.appendChild(opt);
  });
  datalist.appendChild(frag);
}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":"&#39;"
  }[m]));
}

function escAttr(s){
  return String(s ?? '').replace(/"/g, '&quot;');
}

/* Toasts */
function showToast(type, message){
  if (!toastWrap) {
    alert(message);
    return;
  }
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.innerHTML = `
    <div class="icon">
      ${type === 'ok' ? '✅' : type === 'warn' ? '⚠️' : 'ℹ️'}
    </div>
    <div class="msg">${esc(message)}</div>
    <div class="bar"><span></span></div>
  `;
  toastWrap.appendChild(t);
  setTimeout(() => { t.remove(); }, 3200);
}

/* ====== LÓGICA: universo por nombre ====== */
function rowsByName(){
  const qName = (FILTROS.estudiante || '').toLowerCase();
  if (!qName) return CLASES;
  return CLASES.filter(c =>
    String(c.estudiante).toLowerCase().includes(qName)
  );
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

  if (profesores.includes(prevProfesor)) {
    profesorSelect.value = prevProfesor;
    FILTROS.profesor = prevProfesor;
  } else {
    profesorSelect.value = '';
    FILTROS.profesor = '';
  }

  if (ciclos.includes(prevCiclo)) {
    cicloSelect.value = prevCiclo;
    FILTROS.ciclo = prevCiclo;
  } else {
    cicloSelect.value = '';
    FILTROS.ciclo = '';
  }

  if (tipos.includes(prevTipo)) {
    tipoSelect.value = prevTipo;
    FILTROS.tipo = prevTipo;
  } else {
    tipoSelect.value = '';
    FILTROS.tipo = '';
  }

  CURRENT_PAGE = 1;
  updateServiceBadge();
}

/* ====== Servicios: dropdown con checkboxes ====== */
function hydrateServiceDropdown(menu, services, prevSelectedLowerSet){
  menu.innerHTML = '';
  const frag = document.createDocumentFragment();

  services.forEach(srv =>{
    const id = 'srv_' + btoa(unescape(encodeURIComponent(srv))).replace(/=+$/,'');
    const label = document.createElement('label');
    label.className = 'check';
    label.htmlFor   = id;

    const input = document.createElement('input');
    input.type  = 'checkbox';
    input.id    = id;
    input.value = srv;

    if (prevSelectedLowerSet && prevSelectedLowerSet.has(srv.toLowerCase())) {
      input.checked = true;
    }

    const text = document.createElement('span');
    text.className = 'tag';
    text.textContent = srv;

    label.appendChild(input);
    label.appendChild(text);
    frag.appendChild(label);
  });

  menu.appendChild(frag);
}

function getCheckedServicesLower(){
  return new Set(
    Array.from(servicioMenu.querySelectorAll('input[type="checkbox"]:checked'))
      .map(i => i.value.toLowerCase())
  );
}

function updateServiceBadge(){
  srvCount.textContent = String(getCheckedServicesLower().size);
}

/* ====== EVENTOS ====== */
function bindEvents(){
  const debounce = (fn, ms=200)=>{
    let t;
    return (...a)=>{
      clearTimeout(t);
      t = setTimeout(()=>fn(...a), ms);
    };
  };

  // Estudiante
  estudianteInput.addEventListener('input', debounce(()=>{
    FILTROS.estudiante = estudianteInput.value.trim();
    refreshFilterOptionsByName();
    render();
  }));

  // Dropdown toggle + outside click
  servicioToggle.addEventListener('click', ()=>{
    servicioMenu.classList.toggle('open');
  });

  document.addEventListener('click', (e)=>{
    if (!e.target.closest('#servicioGroup')) {
      servicioMenu.classList.remove('open');
    }
  });

  // Cambios en checkboxes de servicios
  servicioMenu.addEventListener('change', ()=>{
    FILTROS.servicios = getCheckedServicesLower();
    CURRENT_PAGE = 1;
    updateServiceBadge();
    render();
  });

  profesorSelect.addEventListener('change', ()=>{
    FILTROS.profesor = profesorSelect.value;
    CURRENT_PAGE = 1;
    render();
  });

  cicloSelect.addEventListener('change', ()=>{
    FILTROS.ciclo = cicloSelect.value;
    CURRENT_PAGE = 1;
    render();
  });

  tipoSelect.addEventListener('change', ()=>{
    FILTROS.tipo = tipoSelect.value;
    CURRENT_PAGE = 1;
    render();
  });

  fechaDesde.addEventListener('change', ()=>{
    FILTROS.fechaDesde = fechaDesde.value;
    CURRENT_PAGE = 1;
    render();
  });

  fechaHasta.addEventListener('change', ()=>{
    FILTROS.fechaHasta = fechaHasta.value;
    CURRENT_PAGE = 1;
    render();
  });

  // Paginación
  prevPageBtn.addEventListener('click', ()=>{
    if (CURRENT_PAGE > 1){
      CURRENT_PAGE--;
      render();
    }
  });

  nextPageBtn.addEventListener('click', ()=>{
    CURRENT_PAGE++;
    render();
  });

  pageSizeSel.addEventListener('change', ()=>{
    PAGE_SIZE   = parseInt(pageSizeSel.value, 10) || 200;
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
      const [clasesRaw, nombresRaw] = await Promise.all([
        loadClases(),
        loadEstudiantes()
      ]);

      CLASES = normalizeClases(clasesRaw)
        .sort((a,b)=> (b.fecha || '').localeCompare(a.fecha || ''));

      NOMBRES = (nombresRaw || [])
        .filter(Boolean)
        .sort((a,b)=>a.localeCompare(b,'es'));

      hydrateDatalist(datalistNombres, NOMBRES);
      refreshFilterOptionsByName();
      render();
      status('Datos actualizados.');
      showToast('ok', 'Datos actualizados.');
    }catch(e){
      console.error(e);
      status('Error actualizando.');
      showToast('warn', 'Error actualizando datos.');
    }
  });

  // Apps Script: abrir diálogo (si usas dialogoPago.html)
  if (btnOpenDialog) {
    btnOpenDialog.addEventListener('click', ()=>{
      window.open(
        `${APPSCRIPT_WEBAPP_URL}?page=dialog`,
        '_blank',
        'width=420,height=800'
      );
    });
  }

  // Apps Script: enviar pago rápido
  if (btnSendQuick) {
    btnSendQuick.addEventListener('click', async ()=>{
      try{
        const payload = {
          action: 'pagoRapido', // anotado, aunque el GAS actual no lo use
          fechaPago: new Date().toISOString().slice(0,10),

          usuario1: (estudianteInput.value || "").trim(),
          usuarionoregistrado: "",

          servicio1: Array.from(getCheckedServicesLower()).values().next()?.value || "",
          ciclo1: cicloSelect.value || "",
          precioServicio1: "",

          usuario2: "", servicio2: "", ciclo2: "", precioServicio2: "",
          usuario3: "", servicio3: "", ciclo3: "", precioServicio3: "",

          medioPago: "",
          recargo: "",
          descuento: "",
          FEVM: "",
          comentario: ""
        };

        const body = new URLSearchParams();
        body.append('payload', JSON.stringify(payload));

        const res = await fetch(APPSCRIPT_WEBAPP_URL, {
          method:'POST',
          headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
          body
        });

        const json = await res.json().catch(()=>null);
        if (json && json.ok) {
          showToast('ok','Pago enviado correctamente ✅');
        } else {
          showToast('warn','Error al guardar pago: ' + (json?.error || 'Desconocido'));
        }
      }catch(e){
        console.error(e);
        showToast('warn','Error de red al enviar pago.');
      }
    });
  }

  // Clicks en la tabla: editar / duplicar / eliminar
  tableBody.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const tr = btn.closest('tr');
    if (!tr) return;

    const id       = tr.dataset.id || '';
    const fecha    = tr.dataset.fecha || '';
    const numClase = tr.dataset.numclase || '';
    const ciclo    = tr.dataset.ciclo || '';
    const hora     = tr.dataset.hora || '';
    const profesor = tr.dataset.profesor || '';

    const action = btn.dataset.action;

    if (action === 'edit') {
      openEditModal({ id, fecha, numClase, ciclo, hora, profesor });

    } else if (action === 'duplicate') {
      duplicateClase(id);

    } else if (action === 'delete') {
      deleteClase(id);
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

    if (FILTROS.servicios.size &&
        !FILTROS.servicios.has(String(c.servicio).toLowerCase())) {
      return false;
    }

    if ((FILTROS.fechaDesde || FILTROS.fechaHasta) && c.fecha){
      const cf = new Date(c.fecha);
      if (FILTROS.fechaDesde && cf < new Date(FILTROS.fechaDesde)) return false;
      if (FILTROS.fechaHasta && cf > new Date(FILTROS.fechaHasta)) return false;
    }

    return true;
  });

  const total      = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;

  const startIdx = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const endIdx   = Math.min(startIdx + PAGE_SIZE, total);
  const slice    = rows.slice(startIdx, endIdx);

  let html = '';
  for (const c of slice){
    html += `
      <tr
        data-id="${escAttr(c.estudiante)}"
        data-fecha="${escAttr(c.fecha)}"
        data-numclase="${escAttr(c.numClase)}"
        data-ciclo="${escAttr(c.ciclo)}"
        data-hora="${escAttr(c.hora)}"
        data-profesor="${escAttr(c.profesor)}"
      >
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
        <td>
          <button class="page-btn" data-action="edit">✏️ Editar</button>
          <button class="page-btn" data-action="duplicate">⧉ Duplicar</button>
          <button class="page-btn" data-action="delete">🗑️ Eliminar</button>
        </td>
      </tr>`;
  }

  tableBody.innerHTML = html;

  prevPageBtn.disabled = CURRENT_PAGE <= 1;
  nextPageBtn.disabled = CURRENT_PAGE >= totalPages;

  pageInfoEl.textContent =
    `Mostrando ${total ? (startIdx+1) : 0}–${endIdx} de ${total} • Página ${CURRENT_PAGE}/${totalPages}`;

  status(`${slice.length} de ${base.length} registros (filtrados por nombre)`);
}

/* ====== Modal de edición ====== */
function openEditModal({ id, fecha, numClase, ciclo, hora, profesor }) {
  if (!id) {
    showToast('warn','Esta fila no tiene ID (Estudiantes1), no se puede editar.');
    return;
  }

  // Overlay
  const overlay = document.createElement('div');
  overlay.style.position   = 'fixed';
  overlay.style.inset      = '0';
  overlay.style.background = 'rgba(15,23,42,.55)';
  overlay.style.display    = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex     = '9999';

  const card = document.createElement('div');
  card.style.background   = '#fff';
  card.style.borderRadius = '16px';
  card.style.padding      = '20px';
  card.style.maxWidth     = '420px';
  card.style.width        = '95%';
  card.style.boxShadow    = '0 20px 60px rgba(12,65,196,.35)';
  card.style.fontFamily   = 'system-ui, -apple-system, Segoe UI, sans-serif';

  card.innerHTML = `
    <h2 style="margin-top:0; margin-bottom:8px; font-size:20px;">Editar clase</h2>
    <p style="margin-top:0; margin-bottom:16px; color:#6b7280; font-size:13px;">ID: ${esc(id)}</p>

    <label style="display:block; font-size:13px; margin-bottom:4px;">📅 Fecha</label>
    <input type="date" id="ripFecha" value="${escAttr(fecha)}"
      style="width:100%;padding:8px 10px;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:10px;">

    <label style="display:block; font-size:13px; margin-bottom:4px;"># Clase</label>
    <input type="number" id="ripNumClase" value="${escAttr(numClase)}"
      style="width:100%;padding:8px 10px;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:10px;">

    <label style="display:block; font-size:13px; margin-bottom:4px;">🔁 Ciclo</label>
    <input type="number" id="ripCiclo" value="${escAttr(ciclo)}"
      style="width:100%;padding:8px 10px;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:10px;">

    <label style="display:block; font-size:13px; margin-bottom:4px;">⏰ Hora</label>
    <input type="text" id="ripHora" value="${escAttr(hora)}" placeholder="4:00 pm"
      style="width:100%;padding:8px 10px;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:10px;">

    <label style="display:block; font-size:13px; margin-bottom:4px;">👩‍🏫 Profesor</label>
    <input type="text" id="ripProfesor" value="${escAttr(profesor)}"
      style="width:100%;padding:8px 10px;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:16px;">

    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
      <button id="ripCancel" class="page-btn"
        style="background:#fff;border:1px solid #e5e7eb;">Cancelar</button>
      <button id="ripSave" class="page-btn"
        style="background:linear-gradient(90deg,#0C41C4,#680DBF);color:#fff;border:0;">Guardar</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  card.querySelector('#ripCancel').addEventListener('click', close);

  card.querySelector('#ripSave').addEventListener('click', async ()=>{
    try{
      const nuevaFecha    = card.querySelector('#ripFecha').value || '';
      const nuevoNumClase = card.querySelector('#ripNumClase').value || '';
      const nuevoCiclo    = card.querySelector('#ripCiclo').value || '';
      const nuevaHora     = card.querySelector('#ripHora').value || '';
      const nuevoProfesor = card.querySelector('#ripProfesor').value || '';

      const updates = {};
      if (nuevaFecha)    updates['Fecha']   = nuevaFecha;
      if (nuevoNumClase) updates['# Clase'] = String(nuevoNumClase);
      if (nuevoCiclo)    updates['Ciclo']   = String(nuevoCiclo);
      if (nuevaHora)     updates['Hora']    = nuevaHora;
      if (nuevoProfesor) updates['Profesor']= nuevoProfesor;

      const payload = {
        action: 'updateClase',
        sheetName: RIP_SHEET_NAME,
        id,
        updates
      };

      const body = new URLSearchParams();
      body.append('payload', JSON.stringify(payload));

      const res = await fetch(APPSCRIPT_WEBAPP_URL, {
        method: 'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
        body
      });

      const json = await res.json().catch(()=>null);
      if (!json || !json.ok) {
        console.error('Respuesta Apps Script:', json);
        showToast('warn','Error al guardar: ' + (json?.error || 'Desconocido.'));
        return;
      }

      showToast('ok','Clase actualizada ✓');

      // Actualizar datos en memoria (solo esta fila visible)
      CLASES = CLASES.map(c=>{
        if (String(c.estudiante).trim() !== id) return c; // si Estudiantes1 no es único, ojo
        return {
          ...c,
          fecha:    nuevaFecha    || c.fecha,
          numClase: nuevoNumClase || c.numClase,
          ciclo:    nuevoCiclo    || c.ciclo,
          hora:     nuevaHora     || c.hora,
          profesor: nuevoProfesor || c.profesor
        };
      });

      render();
      close();
    }catch(e){
      console.error(e);
      showToast('warn','Error de red al guardar.');
    }
  });

  overlay.addEventListener('click', (e)=>{
    if (e.target === overlay) close();
  });
}

/* ====== Duplicar clase ====== */
async function duplicateClase(id){
  if (!id) {
    showToast('warn','Esta fila no tiene ID (Estudiantes1), no se puede duplicar.');
    return;
  }
  if (!confirm('¿Duplicar esta fila en la hoja de cálculo?')) return;

  try{
    const payload = {
      action: 'duplicateClase',
      sheetName: RIP_SHEET_NAME,
      id
    };

    const body = new URLSearchParams();
    body.append('payload', JSON.stringify(payload));

    const res = await fetch(APPSCRIPT_WEBAPP_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body
    });

    const json = await res.json().catch(()=>null);
    if (!json || !json.ok) {
      console.error('Respuesta Apps Script:', json);
      showToast('warn','Error al duplicar: ' + (json?.error || 'Desconocido.'));
      return;
    }

    showToast('ok','Fila duplicada ✓ (recarga para verla al final de la hoja)');
  }catch(e){
    console.error(e);
    showToast('warn','Error de red al duplicar.');
  }
}

/* ====== Eliminar clase ====== */
async function deleteClase(id){
  if (!id) {
    showToast('warn','Esta fila no tiene ID (Estudiantes1), no se puede eliminar.');
    return;
  }
  if (!confirm('¿Eliminar definitivamente esta fila en la hoja de cálculo?')) return;

  try{
    const payload = {
      action: 'deleteClase',
      sheetName: RIP_SHEET_NAME,
      id
    };

    const body = new URLSearchParams();
    body.append('payload', JSON.stringify(payload));

    const res = await fetch(APPSCRIPT_WEBAPP_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body
    });

    const json = await res.json().catch(()=>null);
    if (!json || !json.ok) {
      console.error('Respuesta Apps Script:', json);
      showToast('warn','Error al eliminar: ' + (json?.error || 'Desconocido.'));
      return;
    }

    // Actualizar CLASES en memoria (quitamos ese ID)
    CLASES = CLASES.filter(c => String(c.estudiante).trim() !== id);

    showToast('ok','Fila eliminada ✓');
    render();
  }catch(e){
    console.error(e);
    showToast('warn','Error de red al eliminar.');
  }
}

/* ====== PDF ====== */
function descargarPDF(){
  if (typeof html2pdf === 'undefined') {
    alert('html2pdf no está cargado.');
    return;
  }

  const tabla = document.getElementById('tablaContainer');
  const opciones = {
    margin: 10,
    filename: 'reporte_clases.pdf',
    image: { type: 'jpeg', quality: 1 },
    html2canvas: { scale: 3, dpi: 300, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };

  html2pdf().set(opciones).from(tabla).save();
}
