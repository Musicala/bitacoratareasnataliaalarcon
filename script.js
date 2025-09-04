/* script.js — Musicala · Tareas académicas + Bitácora
   - Lee config.json (o ?config=otra.json)
   - Pinta TODAS las columnas de la hoja
   - Filtros: Responsable / Estado / Urgencia + buscador (auto-ocultables)
   - Contadores: Pendientes / En curso / Cumplidas
   - Bitácora: modal con lista de logs + POST para agregar registro
*/

const $  = (s, ctx=document)=>ctx.querySelector(s);
const $$ = (s, ctx=document)=>Array.from(ctx.querySelectorAll(s));
const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const esc  = v => String(v ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
function setStatus(m, isErr=false){ const el=$('#status'); if(el){ el.textContent=m; el.className=isErr?'status err':'status'; } }
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

const DEFAULT_CONFIG_FILE = 'config.json';
let CONFIG=null, RAW_HEADERS=[], RAW_ROWS=[];
let IDX = {}; // nombre normalizado -> índice

/* ================= Config & Fetch ================= */

async function loadConfig(){
  const url = new URL(location.href);
  const confFile = url.searchParams.get('config') || DEFAULT_CONFIG_FILE;

  setStatus('Cargando configuración…');
  const res = await fetch(confFile, { cache:'no-store' });
  if(!res.ok) throw new Error(`No pude cargar ${confFile} (${res.status})`);
  const json = await res.json();

  if (!json?.api?.baseUrl) throw new Error('config.api.baseUrl es requerido');
  if (!json?.dataset)      throw new Error('config.dataset es requerido');
  CONFIG = json;

  // Branding opcional
  if (CONFIG?.branding?.logo)     { const el=$('#site-logo');     if(el) el.src = CONFIG.branding.logo; }
  if (CONFIG?.branding?.title)    { const el=$('#site-title');    if(el) el.textContent = CONFIG.branding.title; }
  if (CONFIG?.branding?.subtitle) { const el=$('#site-subtitle'); if(el) el.textContent = CONFIG.branding.subtitle; }

  setStatus('Configuración lista.');
}

async function fetchData(){
  if(!CONFIG) await loadConfig();

  setStatus('Cargando datos…');
  const base    = CONFIG.api.baseUrl.replace(/\?+$/, '');
  const keyName = (CONFIG.api.paramName || 'consulta').trim();
  const dataset = encodeURIComponent(CONFIG.dataset);
  const extraQS = CONFIG.api.queryString ? `&${CONFIG.api.queryString.replace(/^\&/, '')}` : '';
  const url     = `${base}?${encodeURIComponent(keyName)}=${dataset}${extraQS}`;

  const res  = await fetch(url, { cache:'no-store' });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error('Respuesta no-JSON del Web App: ' + text.slice(0, 200)); }
  if (payload.ok === false) throw new Error(payload.error || 'Error backend');

  RAW_HEADERS = payload.headers || [];
  RAW_ROWS    = payload.rows    || [];

  IDX = {};
  RAW_HEADERS.forEach((h,i)=>{ IDX[norm(h)] = i; });

  setStatus(`${RAW_ROWS.length} fila${RAW_ROWS.length===1?'':'s'} cargada${RAW_ROWS.length===1?'':'s'}.`);
}

/* ================== Pintado de tabla ================== */

function renderTable(rows){
  const thead = $('#tbl thead');
  const tbody = $('#tbl tbody');
  const iId   = IDX[norm('id')];

  thead.innerHTML = '<tr>' +
    RAW_HEADERS.map(h => `<th>${esc(h)}</th>`).join('') +
    '<th>Acciones</th></tr>';

  const safe = rows || [];
  tbody.innerHTML = safe.map(r => {
    const id = iId!=null ? r[iId] : '';
    const tds = RAW_HEADERS.map((h,i)=>`<td class="wrap" data-th="${esc(h)}">${esc(r[i])}</td>`).join('');
    const acc = `<td data-th="Acciones">
      <button class="btn btn-primary btn-detail" data-id="${esc(id)}" title="Abrir registro de bitácora">
        <span class="btn-ico">📝</span><span>Registro</span>
      </button>
    </td>`;
    return `<tr data-id="${esc(id)}">${tds}${acc}</tr>`;
  }).join('');
}

/* ================== Filtros ================== */

function uniqueSorted(values){
  const s = new Set(values.map(v => String(v||'').trim()).filter(Boolean));
  return Array.from(s).sort((a,b)=>a.localeCompare(b, 'es', { sensitivity:'base' }));
}

function fillSelect(sel, options, placeholder){
  if(!sel) return;
  if (!options.length){
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    sel.parentElement?.classList?.add('is-hidden');
    sel.style.display = 'none';
    return;
  }
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  sel.style.display = '';
  sel.parentElement?.classList?.remove('is-hidden');
}

function fillFilters(){
  const iP = IDX[norm('persona encargada')] ?? IDX[norm('responsable')]; // soporta "Responsable"
  const iE = IDX[norm('estado')];
  const iU = IDX[norm('urgencia')];

  const personas = (iP!=null) ? uniqueSorted(RAW_ROWS.map(r => r[iP])) : [];
  const estados  = (iE!=null) ? uniqueSorted(RAW_ROWS.map(r => r[iE])) : [];
  const urg      = (iU!=null) ? uniqueSorted(RAW_ROWS.map(r => r[iU])) : [];

  fillSelect($('#fPersona'),  personas, 'Responsable: todos');
  fillSelect($('#fEstado'),   estados,  'Estado: todos');
  fillSelect($('#fUrgencia'), urg,      'Urgencia: todas');
}

function applyFilters(){
  const selP = $('#fPersona')?.value || '';
  const selE = $('#fEstado')?.value  || '';
  const selU = $('#fUrgencia')?.value|| '';
  const qn   = norm( ($('#q')?.value || '').trim() );

  const iP = IDX[norm('persona encargada')] ?? IDX[norm('responsable')];
  const iE = IDX[norm('estado')];
  const iU = IDX[norm('urgencia')];

  const filtered = RAW_ROWS.filter(row => {
    if (selP && iP!=null && String(row[iP]||'') !== selP) return false;
    if (selE && iE!=null && String(row[iE]||'') !== selE) return false;
    if (selU && iU!=null && String(row[iU]||'') !== selU) return false;
    if (qn && !row.some(c => norm(c).includes(qn))) return false;
    return true;
  });

  renderTable(filtered);
  updateBadges(filtered);
}

function updateBadges(rows){
  const pendEl = $('#badgePend');
  const cursoEl= $('#badgeCurso');
  const compEl = $('#badgeComp');

  const iE = IDX[norm('estado')];
  let pend=0, curso=0, comp=0;

  rows.forEach(r=>{
    const s = (iE!=null) ? norm(r[iE]) : '';
    if (!s) { pend++; return; }
    if (s.startsWith('pend') || s.includes('por hacer')) pend++;
    else if (s.includes('curso') || s.includes('progreso')) curso++;
    else if (s.startsWith('cumpl') || s.includes('hecha') || s.includes('termin')) comp++;
    else pend++;
  });

  if (pendEl)  pendEl.textContent  = `Pendientes: ${pend}`;
  if (cursoEl) cursoEl.textContent = `En curso: ${curso}`;
  if (compEl)  compEl.textContent  = `Cumplidas: ${comp}`;
  setStatus(`Mostrando ${rows.length} fila${rows.length===1?'':'s'}.`);
}

/* ================== Bitácora ================== */

function showModal(){ $('#modalLog')?.classList.add('show'); }
function hideModal(){ $('#modalLog')?.classList.remove('show'); $('#logStatus').textContent=''; }

async function openDetailById(id){
  const iId   = IDX[norm('id')];
  const iName = IDX[norm('tarea')];
  const iPers = IDX[norm('persona encargada')] ?? IDX[norm('responsable')];

  const row = RAW_ROWS.find(r => String(r[iId]) === String(id));
  $('#logTaskId').value           = id || '';
  $('#logTaskIdTxt').textContent  = id || '—';
  $('#logTaskName').textContent   = row ? (row[iName] || '—') : '—';
  $('#logAssignee').textContent   = row && iPers!=null ? (row[iPers] || '—') : '—';
  $('#logPersona').value          = row && iPers!=null ? (row[iPers] || '')  : '';

  await loadLogs(id);
  showModal();
}

async function loadLogs(id){
  try{
    const base    = CONFIG.api.baseUrl.replace(/\?+$/, '');
    const keyName = (CONFIG.api.paramName || 'consulta').trim();
    const url     = `${base}?${encodeURIComponent(keyName)}=logs_tarea&id=${encodeURIComponent(id)}`;

    const res  = await fetch(url, { cache:'no-store' });
    const text = await res.text();
    let payload; try{ payload = JSON.parse(text); }catch{ throw new Error('Respuesta no-JSON del Web App (logs)'); }
    if (payload.ok === false) throw new Error(payload.error || 'Error backend (logs)');

    const headers = payload.headers || [];
    const rows    = payload.rows || [];

    $('#tblLogs thead').innerHTML = '<tr>' + headers.map(h=>`<th>${esc(h)}</th>`).join('') + '</tr>';
    $('#tblLogs tbody').innerHTML = rows.map(r => `<tr>${
      headers.map((h,i)=>`<td class="wrap" data-th="${esc(h)}">${esc(r[i])}</td>`).join('')
    }</tr>`).join('');

    $('#logStatus').textContent = `${rows.length} registro${rows.length===1?'':'s'}`;
  }catch(err){
    console.error(err);
    $('#logStatus').textContent = 'Error: ' + err.message;
  }
}

async function submitLog(e){
  e.preventDefault();
  const id     = $('#logTaskId').value.trim();
  const perso  = $('#logPersona').value.trim();   // opcional
  const inicio = $('#logInicio').value;
  const fin    = $('#logFin').value;
  const tarea  = ($('#logTaskName')?.textContent || '').trim();
  const estado = $('#logEstado').value;

  // Campos nuevos
  const avanzo  = $('#logAvanzo').value.trim();
  const falta   = $('#logFalta').value.trim();
  const mejorar = $('#logMejorar').value.trim();

  if (!id){ $('#logStatus').textContent = 'Falta el ID de la tarea.'; return; }

  try{
    $('#logStatus').textContent = 'Guardando…';
    const body = new URLSearchParams({
      action:'add_log',
      id,
      tarea,
      persona: perso, // si el backend no tiene columna, la ignora
      inicio, fin,
      avanzo, falta, mejorar,
      estado
    });

    const res  = await fetch(CONFIG.api.baseUrl.replace(/\?+$/, ''), { method:'POST', body });
    const text = await res.text();
    const payload = JSON.parse(text);
    if (payload.ok === false) throw new Error(payload.error || 'Error backend (POST)');

    // limpiar y recargar lista
    $('#logInicio').value=''; $('#logFin').value='';
    $('#logAvanzo').value=''; $('#logFalta').value=''; $('#logMejorar').value='';
    $('#logEstado').value='';
    await loadLogs(id);
    $('#logStatus').textContent = 'Guardado ✔';
  }catch(err){
    console.error(err); $('#logStatus').textContent = 'Error: ' + err.message;
  }
}

/* ================== Init ================== */

async function init(){
  try{
    await loadConfig();
    await fetchData();
    renderTable(RAW_ROWS);
    fillFilters();
    updateBadges(RAW_ROWS);

    // Ocultar selects vacíos si corresponde (por si el CSS no se cargó aún)
    ['#fPersona','#fEstado','#fUrgencia'].forEach(id=>{
      const el=$(id);
      if (el && (!el.options || el.options.length<=1)) el.style.display='none';
    });
  }catch(err){
    console.error(err);
    setStatus('Error: ' + err.message, true);
  }

  $('#btnReload')?.addEventListener('click', async ()=>{
    try{ await fetchData(); renderTable(RAW_ROWS); fillFilters(); applyFilters(); }
    catch(err){ console.error(err); setStatus('Error: ' + err.message, true); }
  });
  $('#fPersona')?.addEventListener('change', applyFilters);
  $('#fEstado')?.addEventListener('change', applyFilters);
  $('#fUrgencia')?.addEventListener('change', applyFilters);
  $('#q')?.addEventListener('input', debounce(applyFilters, 250));

  $('#tbl')?.addEventListener('click', ev=>{
    const btn = ev.target.closest('.btn-detail');
    if (btn) openDetailById(btn.dataset.id);
  });

  $('#modalLog')?.addEventListener('click', ev=>{ if (ev.target.dataset.close) hideModal(); });
  $$('.modal__close')?.forEach(b => b.addEventListener('click', hideModal));
  $('#logForm')?.addEventListener('submit', submitLog);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideModal(); });
}

document.addEventListener('DOMContentLoaded', init);
