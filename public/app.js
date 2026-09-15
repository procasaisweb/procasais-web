/* =========================================================
   Procasais Web
   Frontend do módulo Cadastros, conectado ao Supabase
   (Postgres + Auth + Row Level Security = isolamento automático por usuário)
   ========================================================= */

const supa = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

let currentUser = null;
let expandedModule = 'cadastros';
let activeItem = 'diocese';
let formState = {};
let editingId = null;      // id do registro em edição (null = novo registro)
let pendingSave = null;
let pendingDelete = null;

const ENCONTRO_OPTS = Array.from({length:101}, (_,i)=>String(i));
const EQUIPES_LIST = ['Geral','Sala','Liturgia','Círculos','Coordenador de Círculos','Cafezinho','Cozinha','Ordem','Visitação','Secretaria','Compras','Acolhida'];
const ETAPAS = ['1ª','2ª','3ª'];
const PAGE_SIZE = 50;

/* --- módulo Buscas --- */
const BUSCA_IDS = ['buscaCasal', 'historicoCasal', 'casais1', 'casais2', 'casais3'];
const FUNC_IDS = ['funcEquipes', 'funcDirigentes', 'funcPalestras', 'funcTestemunhos', 'funcHabilidades', 'funcMontagem'];
const DATAS_IDS = ['aniversEsposo', 'aniversEsposa', 'aniversCasamento'];
const UTIL_IDS = ['recibo', 'agenda', 'caixa', 'subsidios', 'painel'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
let agendaState = { year: new Date().getFullYear(), month: new Date().getMonth(), popupDate: null, view: 'list', editing: null };
let caixaState = { dataIni: '', dataFim: '' };
let painelEditType = null;
let searchState = {};       // filtros/página de cada tela de busca
let editReturnItem = null;  // tela de busca para onde "Cancelar" volta ao editar um Casal
let funcPopup = null;       // { kind, id, row } quando o pop-up de edição genérico está aberto
let montagemState = { equipe: '', left: [] };

/* ---------- API helper ----------
   Mesma assinatura da versão local (api(path, {method, body})), mas por
   baixo dos panos conversa com o Supabase. O isolamento por usuário é
   automático: o Postgres (via RLS) já devolve/aceita só as linhas do
   usuário logado, então aqui não precisamos filtrar por user_id nunca. */
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const [rawPath, queryString] = path.split('?');
  const parts = rawPath.split('/').filter(Boolean);

  // /catalogo/palestras?etapa=1ª  |  /catalogo/testemunhos?etapa=1ª
  if (parts[0] === 'catalogo') {
    const tabela = parts[1] === 'palestras' ? 'palestras_catalogo' : 'testemunhos_catalogo';
    let q = supa.from(tabela).select('*').order('id');
    const etapa = new URLSearchParams(queryString || '').get('etapa');
    if (etapa) q = q.eq('etapa', etapa);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data.map(r => ({ ...r, titulo: r.titulo }));
  }

  const tabela = parts[0];
  const id = parts[1];

  if (method === 'GET' && !id) {
    const { data, error } = await supa.from(tabela).select('*').order('id', { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  }
  if (method === 'GET' && id) {
    const { data, error } = await supa.from(tabela).select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data;
  }
  if (method === 'POST') {
    const body = JSON.parse(opts.body || '{}');
    const { data, error } = await supa.from(tabela).insert(body).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
  if (method === 'PUT') {
    const body = JSON.parse(opts.body || '{}');
    const { data, error } = await supa.from(tabela).update(body).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
  if (method === 'DELETE') {
    const { error } = await supa.from(tabela).delete().eq('id', id);
    if (error) throw new Error(error.message);
    return null;
  }
  throw new Error('Método não suportado: ' + method);
}

/* ---------- LOGIN ---------- */
function showLogin() {
  document.getElementById('loginScreen').classList.remove('app-hidden');
  document.getElementById('appRoot').classList.add('app-hidden');
  document.getElementById('topbar').classList.add('app-hidden');
}
async function enterApp() {
  document.getElementById('loginScreen').classList.add('app-hidden');
  document.getElementById('appRoot').classList.remove('app-hidden');
  document.getElementById('topbar').classList.remove('app-hidden');
  const nome = currentUser.user_metadata?.nome || currentUser.email;
  document.getElementById('topbarUser').textContent = nome;
  await atualizarDiocesePar();
  await fullRender();
}

/* Mantém currentUser.diocese / currentUser.paroquia atualizados — usados
   no cabeçalho dos PDFs gerados a partir das telas de Buscas/Utilidades. */
async function atualizarDiocesePar() {
  try {
    const [dioceses, paroquias] = await Promise.all([api('/diocese'), api('/paroquia')]);
    currentUser.diocese = dioceses[0]?.nome || '';
    currentUser.cidadeSede = dioceses[0]?.cidade || '';
    currentUser.paroquia = paroquias[0]?.nome || '';
  } catch (err) { /* segue sem cabeçalho, não trava a tela */ }
}

/* --- entrar --- */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('banned') || msg.includes('blocked') || error.status === 403) {
      errEl.textContent = 'Usuário bloqueado. Contate administrador.';
    } else if (error.message === 'Invalid login credentials') {
      errEl.textContent = 'E-mail ou senha inválidos.';
    } else {
      errEl.textContent = error.message;
    }
    return;
  }
  currentUser = data.user;
  enterApp();
});

/* --- esqueci minha senha --- */
document.getElementById('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('resetEmail').value;
  const errEl = document.getElementById('resetError');
  const okEl = document.getElementById('resetOk');
  errEl.textContent = ''; okEl.textContent = '';
  const { error } = await supa.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset.html'
  });
  if (error) { errEl.textContent = error.message; return; }
  okEl.textContent = 'Se este e-mail estiver cadastrado, um link de redefinição foi enviado.';
  document.getElementById('resetForm').reset();
});

/* --- alternar entre telas de login / esqueci minha senha --- */
document.getElementById('linkToReset').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('loginForm').classList.add('app-hidden');
  document.getElementById('resetForm').classList.remove('app-hidden');
  document.getElementById('linkToReset').classList.add('app-hidden');
  document.getElementById('linkToLogin').classList.remove('app-hidden');
});
document.getElementById('linkToLogin').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('resetForm').classList.add('app-hidden');
  document.getElementById('loginForm').classList.remove('app-hidden');
  document.getElementById('linkToLogin').classList.add('app-hidden');
  document.getElementById('linkToReset').classList.remove('app-hidden');
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  await supa.auth.signOut();
  location.reload();
});

(async function checkSession() {
  const { data } = await supa.auth.getSession();
  if (data.session) { currentUser = data.session.user; enterApp(); }
  else showLogin();
})();

/* ---------- MENU ---------- */
const MODULES = [
  { id: 'cadastros', label: 'Cadastros', active: true, items: [
      { id: 'diocese', label: 'Diocese' }, { id: 'paroquia', label: 'Paróquia' }, { id: 'casais', label: 'Casais' },
      { id: 'funcoes', label: 'Funções' }, { id: 'sacerdotes', label: 'Sacerdotes' }, { id: 'jovens', label: 'Jovens' },
      { id: 'viuvos', label: 'Viúvos' }, { id: 'palestras', label: 'Palestras' }, { id: 'testemunhos', label: 'Testemunhos' },
      { id: 'dirigentes', label: 'Dirigentes' }, { id: 'circulos', label: 'Círculos' }, { id: 'habilidades', label: 'Habilidades' }
  ]},
  { id: 'buscas', label: 'Buscas', active: true, items: [
      { id: 'buscaCasal', label: 'Busca Casal' }, { id: 'historicoCasal', label: 'Histórico do Casal' },
      { id: 'casais1', label: 'Casais 1ª Etapa' }, { id: 'casais2', label: 'Casais 2ª Etapa' }, { id: 'casais3', label: 'Casais 3ª Etapa' }
  ]},
  { id: 'funcoesmod', label: 'Funções', active: true, items: [
      { id: 'funcEquipes', label: 'Equipes' }, { id: 'funcDirigentes', label: 'Dirigentes' }, { id: 'funcPalestras', label: 'Palestras' },
      { id: 'funcTestemunhos', label: 'Testemunhos' }, { id: 'funcHabilidades', label: 'Habilidades' }, { id: 'funcMontagem', label: 'Montagem' }
  ]},
  { id: 'datas', label: 'Datas', active: true, items: [
      { id: 'aniversEsposo', label: 'Aniversário Esposo' }, { id: 'aniversEsposa', label: 'Aniversário Esposa' }, { id: 'aniversCasamento', label: 'Aniversário Casamento' }
  ]},
  { id: 'utilidades', label: 'Utilidades', active: true, items: [
      { id: 'recibo', label: 'Recibo' }, { id: 'agenda', label: 'Agenda' }, { id: 'caixa', label: 'Caixa' },
      { id: 'subsidios', label: 'Subsídios' }, { id: 'painel', label: 'Painel' }
  ]}
];

function renderSidebar() {
  let html = `<div class="brand"><div class="rosette"></div><div><h1>Procasais<br>Web</h1><span>Módulo Cadastros</span></div></div><div class="chain">`;
  MODULES.forEach(mod => {
    const isExpanded = expandedModule === mod.id;
    html += `<div class="module">
      <button class="module-btn ${isExpanded && mod.active ? 'active' : ''}" data-mod="${mod.id}" ${!mod.active ? 'data-locked="1"' : ''}>
        <span class="node"></span>${mod.label}
        ${!mod.active ? '<span class="lock">em breve</span>' : ''}
      </button>`;
    if (mod.active && isExpanded) {
      html += `<ul class="submenu">`;
      mod.items.forEach(it => {
        html += `<li><button class="${activeItem === it.id ? 'active' : ''}" data-item="${it.id}">${it.label}</button></li>`;
      });
      html += `</ul>`;
    }
    html += `</div>`;
  });
  html += `</div>`;
  return html;
}

/* ---------- helpers de campo ---------- */
function fieldText(key, label, opts = {}) {
  const val = formState[key] ?? opts.value ?? '';
  return `<div class="field ${opts.full ? 'full' : ''}">
    <label>${label}${opts.required ? ' <span class="req-star" title="Campo obrigatório">*</span>' : ''}</label>
    <input type="${opts.type || 'text'}" name="${key}" value="${val ?? ''}" ${opts.readonly ? 'readonly' : ''} ${opts.disabled ? 'disabled' : ''} ${opts.required ? 'required' : ''}>
    ${opts.hint ? `<span class="hint">${opts.hint}</span>` : ''}
  </div>`;
}
function fieldSelect(key, label, options, opts = {}) {
  const val = formState[key] ?? '';
  const optsHtml = options.map(o => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`;
  }).join('');
  return `<div class="field ${opts.full ? 'full' : ''}" >
    <label>${label}${opts.required ? ' <span class="req-star" title="Campo obrigatório">*</span>' : ''}</label>
    <select name="${key}" ${opts.disabled ? 'disabled' : ''} ${opts.required ? 'required' : ''}>
      <option value="">Selecione...</option>${optsHtml}
    </select>
    ${opts.hint ? `<span class="hint">${opts.hint}</span>` : ''}
  </div>`;
}
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

function calcAnosCasados(dataStr) {
  if (!dataStr) return '';
  const d = new Date(dataStr + 'T00:00:00');
  if (isNaN(d)) return '';
  const hoje = new Date();
  let anos = hoje.getFullYear() - d.getFullYear();
  const aindaNao = (hoje.getMonth() < d.getMonth()) || (hoje.getMonth() === d.getMonth() && hoje.getDate() < d.getDate());
  if (aindaNao) anos--;
  return anos < 0 ? '' : anos + (anos === 1 ? ' ano' : ' anos');
}

/* ---------- config das telas simples (Sacerdotes, Jovens, Viúvos, Círculos, Habilidades) ---------- */
const SIMPLE_CONFIG = {
  sacerdotes: { title: 'Cadastro de Sacerdotes',
    fields: [['nome','Nome',true,true],['endereco','Endereço',true,false],['telefone','Telefone',false,false],['email','E-mail',false,false]],
    columns: [['nome','Nome'],['endereco','Endereço'],['telefone','Telefone'],['email','E-mail']] },
  jovens: { title: 'Cadastro de Jovens',
    fields: [['nome','Nome',true,true],['endereco','Endereço',true,false],['telefone','Telefone',false,false],['email','E-mail',false,false]],
    columns: [['nome','Nome'],['endereco','Endereço'],['telefone','Telefone'],['email','E-mail']] },
  viuvos: { title: 'Cadastro de Viúvos',
    fields: [['nome','Nome',true,true],['endereco','Endereço',true,false],['telefone','Telefone',false,false],['email','E-mail',false,false]],
    columns: [['nome','Nome'],['endereco','Endereço'],['telefone','Telefone'],['email','E-mail']] },
  circulos: { title: 'Cadastro Cor do Círculo',
    fields: [['cor','Digite a Cor do Círculo',true,true]],
    columns: [['cor','Cor']] },
  habilidades: { title: 'Cadastro de Habilidades',
    fields: [['nome','Digite a Habilidade',true,true]],
    columns: [['nome','Habilidade']] }
};

/* ---------- render principal ---------- */
async function renderMain() {
  const main = document.getElementById('main');
  main.innerHTML = `<p class="loading-note">Carregando…</p>`;
  try {
    let html = '';
    if (BUSCA_IDS.includes(activeItem)) html = await renderBuscaPage();
    else if (FUNC_IDS.includes(activeItem)) html = await renderFuncPage();
    else if (DATAS_IDS.includes(activeItem)) html = await renderDatasPage();
    else if (UTIL_IDS.includes(activeItem)) html = await renderUtilPage();
    else if (SIMPLE_CONFIG[activeItem]) html = await renderSimpleScreen(activeItem);
    else if (activeItem === 'diocese') html = await renderDioceseParoquia('diocese');
    else if (activeItem === 'paroquia') html = await renderDioceseParoquia('paroquia');
    else if (activeItem === 'casais') html = await renderCasais();
    else if (activeItem === 'funcoes') html = await renderFuncoes();
    else if (activeItem === 'dirigentes') html = await renderDirigentes();
    else if (activeItem === 'palestras') html = await renderPalestras();
    else if (activeItem === 'testemunhos') html = await renderTestemunhos();
    main.innerHTML = `<div class="page-wrap">${html}</div>`;
    if (BUSCA_IDS.includes(activeItem) || DATAS_IDS.includes(activeItem)) bindBuscaEvents();
    else if (FUNC_IDS.includes(activeItem)) bindFuncEvents();
    else if (UTIL_IDS.includes(activeItem)) bindUtilEvents();
    else bindMainEvents();
  } catch (err) {
    main.innerHTML = `<div class="page-wrap"><p class="loading-note">Erro ao carregar: ${err.message}</p></div>`;
  }
}

async function fullRender() {
  document.getElementById('sidebar').innerHTML = renderSidebar();
  bindSidebarEvents();
  await renderMain();
}

function bindSidebarEvents() {
  document.querySelectorAll('.module-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.locked) { showToast('Este módulo ainda está em construção.'); return; }
      const modId = btn.dataset.mod;
      const jaEstavaAberto = expandedModule === modId;
      expandedModule = jaEstavaAberto ? null : modId;
      // Ao abrir um módulo diferente, já mostra a primeira tela dele —
      // sem isso, a área principal ficava presa na última tela vista.
      if (!jaEstavaAberto) {
        const mod = MODULES.find(m => m.id === modId);
        if (mod && mod.items.length) {
          activeItem = mod.items[0].id;
          formState = {};
          editingId = null;
        }
      }
      fullRender();
    });
  });
  document.querySelectorAll('.submenu button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeItem = btn.dataset.item;
      formState = {};
      editingId = null;
      fullRender();
    });
  });
}

/* ---------- telas simples (genérico) ---------- */
async function renderSimpleScreen(tabela) {
  const cfg = SIMPLE_CONFIG[tabela];
  const registros = await api(`/${tabela}`);
  const fieldsHtml = cfg.fields.map(([key, label, full, required]) => fieldText(key, label, { full, required })).join('');
  return `
    <p class="eyebrow">Cadastros</p>
    <h2 class="page-title">${cfg.title}${editingId ? ' <span style="font-size:14px;color:var(--teal);">— editando registro</span>' : ''}</h2>
    <form id="mainForm" class="card" data-tabela="${tabela}" autocomplete="off">
      <div class="grid">${fieldsHtml}</div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btnSave">${editingId ? 'Salvar' : 'Salvar / Incluir'}</button>
        <button type="button" class="btn btn-ghost" id="btnClear">${editingId ? 'Cancelar' : 'Limpar Formulário'}</button>
      </div>
    </form>
    <div class="card">
      <div class="section-title" style="border:none;">Registros <span class="count-pill">${registros.length}</span></div>
      ${renderTable(cfg.columns, registros, tabela)}
    </div>`;
}

/* ---------- Diocese / Paróquia ---------- */
async function renderDioceseParoquia(tabela) {
  const registros = await api(`/${tabela}`);
  const isDiocese = tabela === 'diocese';

  // Só pode existir 1 registro de Diocese / Paróquia no sistema.
  // Se já existe, a tela abre direto em modo de edição dele (sem opção de criar outro).
  if (registros.length > 0 && editingId === null) {
    editingId = registros[0].id;
    formState = { ...registros[0] };
  }

  const fieldsHtml = isDiocese ? `
      ${fieldText('nome','Nome da Diocese', { full:true, required:true })}
      ${fieldText('bispo','Bispo Atual', { required:true })}
      ${fieldText('endereco','Endereço',{full:true, required:true})}
      ${fieldText('cidade','Cidade', { required:true })}
      ${fieldText('estado','Estado', { required:true })}
      ${fieldText('telefone','Telefone')}
      ${fieldText('email','E-mail')}
    ` : `
      ${fieldText('nome','Nome da Paróquia', { required:true })}
      ${fieldText('diocese','Nome da Diocese', { required:true })}
      ${fieldText('endereco','Endereço',{full:true, required:true})}
      ${fieldText('cidade','Cidade', { required:true })}
      ${fieldText('estado','Estado', { required:true })}
      ${fieldText('paroco','Pároco Atual', { required:true })}
      ${fieldText('telefone','Telefone')}
      ${fieldText('email','E-mail')}
    `;
  const cols = isDiocese
    ? [['nome','Diocese'],['bispo','Bispo'],['endereco','Endereço'],['cidade','Cidade'],['estado','Estado'],['telefone','Telefone'],['email','E-mail']]
    : [['nome','Paróquia'],['diocese','Diocese'],['endereco','Endereço'],['cidade','Cidade'],['estado','Estado'],['paroco','Padre'],['telefone','Telefone'],['email','E-mail']];
  const jaExiste = registros.length > 0;
  return `
    <p class="eyebrow">Cadastros</p>
    <h2 class="page-title">Cadastro d${isDiocese?'a Diocese':'a Paróquia'}</h2>
    ${jaExiste ? `<p class="locked-note" style="margin-bottom:12px;">Só pode existir um registro d${isDiocese?'a Diocese':'a Paróquia'} — você está editando o registro já cadastrado.</p>` : ''}
    <form id="mainForm" class="card" data-tabela="${tabela}" autocomplete="off">
      <div class="grid">${fieldsHtml}</div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btnSave">${editingId ? 'Salvar' : 'Salvar / Incluir'}</button>
        ${jaExiste ? '' : `<button type="button" class="btn btn-ghost" id="btnClear">Limpar Formulário</button>`}
      </div>
    </form>
    <div class="card">
      <div class="section-title" style="border:none;">Registros <span class="count-pill">${registros.length}</span></div>
      ${renderTable(cols, registros, tabela)}
    </div>`;
}

/* ---------- Funções ---------- */
async function renderFuncoes() {
  const [registros, casais] = await Promise.all([api('/funcoes'), api('/casais')]);
  const apelidoEle = formState.apelido_ele;
  formState.apelido_ela = (casais.find(c => c.apelido_esposo === apelidoEle) || {}).apelido_esposa || '';
  return `
    <p class="eyebrow">Cadastros</p>
    <h2 class="page-title">Cadastro de Funções${editingId ? ' <span style="font-size:14px;color:var(--teal);">— editando registro</span>' : ''}</h2>
    <form id="mainForm" class="card" data-tabela="funcoes" autocomplete="off">
      <div class="grid">
        ${fieldSelect('apelido_ele','Apelido Ele', casais.map(c => c.apelido_esposo).filter(Boolean), { required:true })}
        ${fieldText('apelido_ela','Apelido Ela', { readonly: true, hint: 'Autopreenchido conforme "Apelido Ele"', required:true })}
        ${fieldSelect('equipe','Equipe', EQUIPES_LIST, { required:true })}
        ${fieldSelect('encontro','Encontro', ENCONTRO_OPTS, { required:true })}
        ${fieldSelect('etapa','Etapa', ETAPAS, { required:true })}
        ${fieldSelect('coordenou','Coordenou?', ['Sim','Não'], { required:true })}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btnSave">${editingId ? 'Salvar' : 'Salvar / Incluir'}</button>
        <button type="button" class="btn btn-ghost" id="btnClear">${editingId ? 'Cancelar' : 'Limpar Formulário'}</button>
      </div>
    </form>
    <div class="card">
      <div class="section-title" style="border:none;">Registros <span class="count-pill">${registros.length}</span></div>
      ${renderTable([['apelido_ele','Ele'],['apelido_ela','Ela'],['equipe','Equipe'],['encontro','Encontro'],['etapa','Etapa'],['coordenou','Coordenou']], registros, 'funcoes')}
    </div>`;
}

/* ---------- Dirigentes ---------- */
async function renderDirigentes() {
  const [registros, casais] = await Promise.all([api('/dirigentes'), api('/casais')]);
  const apelidoEle = formState.apelido_ele;
  formState.apelido_ela = (casais.find(c => c.apelido_esposo === apelidoEle) || {}).apelido_esposa || '';
  const funcoesOpts = ['Pós Encontro','Finanças','Palestras','Fichas','Montagem'];
  return `
    <p class="eyebrow">Cadastros</p>
    <h2 class="page-title">Cadastro de Dirigentes${editingId ? ' <span style="font-size:14px;color:var(--teal);">— editando registro</span>' : ''}</h2>
    <form id="mainForm" class="card" data-tabela="dirigentes" autocomplete="off">
      <div class="grid">
        ${fieldSelect('apelido_ele','Apelido Ele', casais.map(c => c.apelido_esposo).filter(Boolean), { required:true })}
        ${fieldText('apelido_ela','Apelido Ela', { readonly: true, hint: 'Autopreenchido conforme "Apelido Ele"', required:true })}
        ${fieldSelect('funcao_dirigente','Função Dirigente', funcoesOpts, { required:true })}
        ${fieldText('periodo','Período')}
        ${fieldSelect('etapa','Etapa', ETAPAS, { required:true })}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btnSave">${editingId ? 'Salvar' : 'Salvar / Incluir'}</button>
        <button type="button" class="btn btn-ghost" id="btnClear">${editingId ? 'Cancelar' : 'Limpar Formulário'}</button>
      </div>
    </form>
    <div class="card">
      <div class="section-title" style="border:none;">Registros <span class="count-pill">${registros.length}</span></div>
      ${renderTable([['apelido_ele','Ele'],['apelido_ela','Ela'],['funcao_dirigente','Função Dirigente'],['periodo','Período'],['etapa','Etapa']], registros, 'dirigentes')}
    </div>`;
}

/* ---------- Palestras ---------- */
async function renderPalestras() {
  const tipo = formState.tipo || 'Casal';
  formState.tipo = tipo;
  const etapaAtual = formState.etapa || '';
  const [registros, casais, sacerdotes, catalogo] = await Promise.all([
    api('/palestras'), api('/casais'), api('/sacerdotes'),
    api('/catalogo/palestras' + (etapaAtual ? `?etapa=${encodeURIComponent(etapaAtual)}` : ''))
  ]);
  formState.apelido_ela = (casais.find(c => c.apelido_esposo === formState.apelido_ele) || {}).apelido_esposa || '';
  return `
    <p class="eyebrow">Cadastros</p>
    <h2 class="page-title">Cadastro de Palestras${editingId ? ' <span style="font-size:14px;color:var(--teal);">— editando registro</span>' : ''}</h2>
    <form id="mainForm" class="card" data-tabela="palestras" autocomplete="off">
      <div class="toggle-row" data-togglegroup="tipo">
        <button type="button" class="${tipo === 'Casal' ? 'active' : ''}" data-toggleval="Casal">Casal</button>
        <button type="button" class="${tipo === 'Sacerdote' ? 'active' : ''}" data-toggleval="Sacerdote">Sacerdote</button>
      </div>
      <div class="grid">
        ${fieldSelect('sacerdote','Nome do Sacerdote', sacerdotes.map(s => s.nome), { disabled: tipo !== 'Sacerdote', required: tipo === 'Sacerdote' })}
        ${fieldSelect('apelido_ele','Apelido Ele', casais.map(c => c.apelido_esposo).filter(Boolean), { disabled: tipo !== 'Casal', required: tipo === 'Casal' })}
        ${fieldText('apelido_ela','Apelido Ela', { readonly: true, disabled: tipo !== 'Casal', hint: 'Autopreenchido conforme "Apelido Ele"', required: tipo === 'Casal' })}
        ${fieldSelect('encontro','Encontro', ENCONTRO_OPTS, { required:true })}
        ${fieldSelect('etapa','Etapa', ETAPAS, { required:true })}
        ${fieldSelect('palestra','Palestra Proferida', catalogo.map(p => p.titulo), { hint: 'Lista filtrada pela Etapa · catálogo fixo (admin)', required:true })}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btnSave">${editingId ? 'Salvar' : 'Salvar / Incluir'}</button>
        <button type="button" class="btn btn-ghost" id="btnClear">${editingId ? 'Cancelar' : 'Limpar Formulário'}</button>
      </div>
    </form>
    <div class="card">
      <div class="section-title" style="border:none;">Registros <span class="count-pill">${registros.length}</span></div>
      ${renderTable([['sacerdote','Sacerdote'],['apelido_ele','Ele'],['apelido_ela','Ela'],['encontro','Encontro'],['etapa','Etapa'],['palestra','Palestra']], registros, 'palestras')}
    </div>`;
}

/* ---------- Testemunhos ---------- */
async function renderTestemunhos() {
  const tipo = formState.tipo || 'Casal';
  formState.tipo = tipo;
  const etapaAtual = formState.etapa || '';
  const [registros, casais, jovens, viuvos, catalogo] = await Promise.all([
    api('/testemunhos'), api('/casais'), api('/jovens'), api('/viuvos'),
    api('/catalogo/testemunhos' + (etapaAtual ? `?etapa=${encodeURIComponent(etapaAtual)}` : ''))
  ]);
  formState.apelido_ela = (casais.find(c => c.apelido_esposo === formState.apelido_ele) || {}).apelido_esposa || '';
  return `
    <p class="eyebrow">Cadastros</p>
    <h2 class="page-title">Cadastro de Testemunhos${editingId ? ' <span style="font-size:14px;color:var(--teal);">— editando registro</span>' : ''}</h2>
    <form id="mainForm" class="card" data-tabela="testemunhos" autocomplete="off">
      <div class="toggle-row" data-togglegroup="tipo">
        <button type="button" class="${tipo === 'Casal' ? 'active' : ''}" data-toggleval="Casal">Casal</button>
        <button type="button" class="${tipo === 'Jovem' ? 'active' : ''}" data-toggleval="Jovem">Jovem</button>
        <button type="button" class="${tipo === 'Viuvo' ? 'active' : ''}" data-toggleval="Viuvo">Viúvo</button>
      </div>
      <div class="grid">
        ${fieldSelect('jovem','Nome do Jovem', jovens.map(j => j.nome), { disabled: tipo !== 'Jovem', required: tipo === 'Jovem' })}
        ${fieldSelect('viuvo','Nome do Viúvo(a)', viuvos.map(v => v.nome), { disabled: tipo !== 'Viuvo', required: tipo === 'Viuvo' })}
        ${fieldSelect('apelido_ele','Apelido Ele', casais.map(c => c.apelido_esposo).filter(Boolean), { disabled: tipo !== 'Casal', required: tipo === 'Casal' })}
        ${fieldText('apelido_ela','Apelido Ela', { readonly: true, disabled: tipo !== 'Casal', hint: 'Autopreenchido conforme "Apelido Ele"', required: tipo === 'Casal' })}
        ${fieldSelect('encontro','Encontro', ENCONTRO_OPTS, { required:true })}
        ${fieldSelect('etapa','Etapa', ETAPAS, { required:true })}
        ${fieldSelect('testemunho','Testemunho Proferido', catalogo.map(t => t.titulo), { hint: 'Lista filtrada pela Etapa · catálogo fixo (admin)', required:true })}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btnSave">${editingId ? 'Salvar' : 'Salvar / Incluir'}</button>
        <button type="button" class="btn btn-ghost" id="btnClear">${editingId ? 'Cancelar' : 'Limpar Formulário'}</button>
      </div>
    </form>
    <div class="card">
      <div class="section-title" style="border:none;">Registros <span class="count-pill">${registros.length}</span></div>
      ${renderTable([['jovem','Jovem'],['viuvo','Viúvo'],['apelido_ele','Ele'],['apelido_ela','Ela'],['encontro','Encontro'],['etapa','Etapa'],['testemunho','Testemunho']], registros, 'testemunhos')}
    </div>`;
}

/* ---------- Casais ---------- */
function vivenciaBlock(n, circulos) {
  const etapaLabel = n === 1 ? '1ª' : n === 2 ? '2ª' : '3ª';
  const req = n === 1; // só a Vivência da 1ª Etapa tem Encontro/Data/Local obrigatórios
  return `<div class="vivencia-block">
    <div class="vb-title">Vivência — ${etapaLabel} Etapa</div>
    <div class="grid">
      ${fieldSelect('encontro' + n, 'Encontro (nº)', ENCONTRO_OPTS, { required: req })}
      ${fieldText('data' + n, 'Data', { type: 'date', required: req })}
      ${fieldText('local' + n, 'Local', { required: req })}
      ${fieldSelect('circulo' + n, 'Cor do Círculo', circulos.map(c => c.cor))}
      ${fieldText('coordenadores' + n, 'Coordenadores', { full: true })}
    </div>
  </div>`;
}
async function renderCasais() {
  const [registros, circulos, habilidades, diocesesCad, paroquiasCad] = await Promise.all([
    api('/casais'), api('/circulos'), api('/habilidades'), api('/diocese'), api('/paroquia')
  ]);
  const dioceseAtual = diocesesCad[0] || {};
  const paroquiaAtual = paroquiasCad[0] || {};
  formState.diocese = dioceseAtual.nome || '';
  formState.cidade_sede = dioceseAtual.cidade || '';
  formState.paroquia = paroquiaAtual.nome || '';
  formState.casados_a = calcAnosCasados(formState.casamento_data);
  return `
    <p class="eyebrow">Cadastros</p>
    <h2 class="page-title">Cadastro de Casais${editingId ? ' <span style="font-size:14px;color:var(--teal);">— editando registro</span>' : ''}</h2>
    <form id="mainForm" class="card" data-tabela="casais" autocomplete="off">
      <div class="section-title">Dados Pessoais</div>
      <div class="grid">
        ${fieldText('diocese','Diocese', { readonly: true, hint: 'Vem do Cadastro de Diocese' })}
        ${fieldText('cidade_sede','Cidade Sede', { readonly: true, hint: 'Vem do Cadastro de Diocese' })}
        ${fieldText('paroquia','Paróquia', { readonly: true, hint: 'Vem do Cadastro de Paróquia' })}
        ${fieldText('nome_esposo','Nome do Esposo', { required:true })}
        ${fieldText('apelido_esposo','Apelido do Esposo', { required:true })}
        ${fieldText('nasc_esposo','Data de Nascimento', { type: 'date', required:true })}
        ${fieldText('celular_esposo','Celular', { required:true })}
        ${fieldText('profissao_esposo','Profissão')}
        ${fieldText('email_esposo','E-mail')}
        ${fieldText('nome_esposa','Nome da Esposa', { required:true })}
        ${fieldText('apelido_esposa','Apelido da Esposa', { required:true })}
        ${fieldText('nasc_esposa','Data de Nascimento', { type: 'date', required:true })}
        ${fieldText('celular_esposa','Celular', { required:true })}
        ${fieldText('profissao_esposa','Profissão')}
        ${fieldText('email_esposa','E-mail')}
        ${fieldText('tel_proximo','Telefone de Contato Próximo')}
        ${fieldText('casamento_data','Aniversário de Casamento', { type: 'date', required:true })}
        ${fieldText('casados_a','Casados a', { readonly: true, hint: 'Calculado automaticamente' })}
        ${fieldSelect('situacao','Situação', ['Casados','Separados','Viúvo(a)','Outra Paróquia','Desistentes','Mudaram-se'])}
        ${fieldSelect('habilidade','Habilidades', habilidades.map(h => h.nome))}
      </div>
      <div class="section-title" style="margin-top:22px;">Endereço</div>
      <div class="grid">
        ${fieldText('cep','CEP', { hint: 'Busca automática do endereço via API ao sair do campo' })}
        ${fieldText('endereco_residencial','Endereço Residencial', { required:true })}
        ${fieldText('bairro','Bairro', { required:true })}
        ${fieldText('cidade','Cidade', { required:true })}
        ${fieldText('estado','Estado', { required:true })}
      </div>
      <div class="section-title" style="margin-top:22px;">Vivência</div>
      ${vivenciaBlock(1, circulos)}
      ${vivenciaBlock(2, circulos)}
      ${vivenciaBlock(3, circulos)}
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btnSave">${editingId ? 'Salvar' : 'Salvar / Incluir'}</button>
        <button type="button" class="btn btn-ghost" id="btnClear">${editingId ? 'Cancelar' : 'Limpar Formulário'}</button>
      </div>
    </form>
    <div class="card">
      <div class="section-title" style="border:none;">Registros <span class="count-pill">${registros.length}</span></div>
      ${renderTable([['nome_esposo','Esposo'],['nome_esposa','Esposa'],['apelido_esposo','Apelido Ele'],['apelido_esposa','Apelido Ela'],['paroquia','Paróquia'],['situacao','Situação'],['casados_a','Casados a']], registros, 'casais')}
    </div>`;
}

/* =========================================================
   MÓDULO BUSCAS
   ========================================================= */
function ensureSearchState(id, defaults) {
  if (!searchState[id]) searchState[id] = { ...defaults, page: 1, searched: false };
  return searchState[id];
}
function paginate(id, rows) {
  const st = searchState[id];
  const start = (st.page - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
}
function renderPagination(id, total) {
  const st = searchState[id];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (st.page > pages) st.page = pages;
  return `<div class="pagination" data-pagination="${id}">
    <button type="button" class="btn btn-ghost" data-page="prev" ${st.page <= 1 ? 'disabled' : ''}>◀ Anterior</button>
    <span class="page-info">Página ${st.page} de ${pages} · ${total} registro(s)</span>
    <button type="button" class="btn btn-ghost" data-page="next" ${st.page >= pages ? 'disabled' : ''}>Próxima ▶</button>
  </div>`;
}
function renderResultsTable(cols, rows, showEdit, editKind) {
  const extraTh = showEdit ? '<th>Ações</th>' : '';
  let html = `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}${extraTh}</tr></thead><tbody>`;
  if (rows.length === 0) {
    html += `<tr class="empty-row"><td colspan="${cols.length + (showEdit ? 1 : 0)}">Nenhum registro encontrado.</td></tr>`;
  } else {
    rows.forEach(r => {
      const editTd = showEdit ? `<td><button type="button" class="icon-btn" data-searchedit="${r.id}" data-editkind="${editKind}">✎ Editar</button></td>` : '';
      html += '<tr>' + cols.map(c => `<td>${r[c[0]] ?? '—'}</td>`).join('') + editTd + '</tr>';
    });
  }
  html += `</tbody></table></div>`;
  return html;
}
const LAST_RESULTS = {}; // guarda o conjunto completo filtrado (todas as páginas) para exportação em PDF

async function renderBuscaCasal() {
  const st = ensureSearchState('buscaCasal', { apelido_ele: '' });
  const casais = await api('/casais');
  const canSearch = !!st.apelido_ele;
  let rows = (st.searched && st.apelido_ele) ? casais.filter(c => c.apelido_esposo === st.apelido_ele) : casais;
  const cols = [['apelido_esposo','Apelido Esposo'],['apelido_esposa','Apelido Esposa'],['celular_esposo','Celular'],['tel_proximo','Telefone de Contato'],['situacao','Situação']];
  return `
    <p class="eyebrow">Buscas</p>
    <h2 class="page-title">Busca Casal</h2>
    <div class="card">
      <div class="grid">
        <div class="field">
          <label>Escolha o Apelido do Casal</label>
          <select name="apelido_ele">
            <option value="">Selecione...</option>
            ${casais.map(c => `<option value="${c.apelido_esposo}" ${st.apelido_ele === c.apelido_esposo ? 'selected' : ''}>${c.apelido_esposo}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Apelido Ela</label><input type="text" readonly value="${(casais.find(c => c.apelido_esposo === st.apelido_ele) || {}).apelido_esposa || ''}"></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Casais <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate('buscaCasal', rows), true, 'casal')}
      ${renderPagination('buscaCasal', rows.length)}
    </div>`;
}

async function renderHistoricoCasal() {
  const st = ensureSearchState('historicoCasal', { apelido_ele: '', etapa: '' });
  const [casais, funcoes] = await Promise.all([api('/casais'), api('/funcoes')]);
  const canSearch = !!st.apelido_ele && !!st.etapa;
  let rows = (st.searched && canSearch) ? funcoes.filter(f => f.apelido_ele === st.apelido_ele && f.etapa === st.etapa) : funcoes;
  const cols = [['apelido_ele','Apelido Esposo'],['apelido_ela','Apelido Esposa'],['equipe','Equipe'],['encontro','Encontro'],['etapa','Etapa']];
  return `
    <p class="eyebrow">Buscas</p>
    <h2 class="page-title">Histórico do Casal</h2>
    <div class="card">
      <div class="grid">
        <div class="field">
          <label>Escolha o Apelido do Casal</label>
          <select name="apelido_ele">
            <option value="">Selecione...</option>
            ${casais.map(c => `<option value="${c.apelido_esposo}" ${st.apelido_ele === c.apelido_esposo ? 'selected' : ''}>${c.apelido_esposo}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Apelido Ela</label><input type="text" readonly value="${(casais.find(c => c.apelido_esposo === st.apelido_ele) || {}).apelido_esposa || ''}"></div>
        <div class="field">
          <label>Escolha a Etapa</label>
          <select name="etapa">
            <option value="">Selecione...</option>
            ${ETAPAS.map(e => `<option value="${e}" ${st.etapa === e ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Resultados <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate('historicoCasal', rows), true, 'funcao')}
      ${renderPagination('historicoCasal', rows.length)}
    </div>`;
}

async function renderCasaisEtapa(n) {
  const id = 'casais' + n;
  const etapaLabel = n === 1 ? '1ª' : n === 2 ? '2ª' : '3ª';
  const st = ensureSearchState(id, { encontro: '' });
  const canSearch = !!st.encontro;
  const casais = await api('/casais');
  const encontroField = 'encontro' + n, dataField = 'data' + n, localField = 'local' + n;
  const base = casais.filter(c => c[encontroField]);
  let filtrados = (st.searched && st.encontro) ? base.filter(c => c[encontroField] === st.encontro) : base;
  const rows = filtrados.map(c => (
    { id: c.id, apelido_esposo: c.apelido_esposo, apelido_esposa: c.apelido_esposa, encontro: c[encontroField], etapa: etapaLabel, data: c[dataField], local: c[localField] }
  ));
  const encontroOpts = [...new Set(base.map(c => c[encontroField]))];
  const cols = [['apelido_esposo','Apelido Esposo'],['apelido_esposa','Apelido Esposa'],['encontro','Encontro'],['etapa','Etapa'],['data','Data'],['local','Local']];
  LAST_RESULTS[id] = { title: `Casais ${etapaLabel} Etapa`, cols, rows };
  return `
    <p class="eyebrow">Buscas</p>
    <h2 class="page-title">Casais ${etapaLabel} Etapa</h2>
    <div class="card">
      <div class="grid">
        <div class="field">
          <label>Escolha o número do Encontro</label>
          <select name="encontro">
            <option value="">Selecione...</option>
            ${encontroOpts.map(v => `<option value="${v}" ${st.encontro === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
        <button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Casais da ${etapaLabel} Etapa <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate(id, rows), false)}
      ${renderPagination(id, rows.length)}
    </div>`;
}

async function renderBuscaPage() {
  if (activeItem === 'buscaCasal') return renderBuscaCasal();
  if (activeItem === 'historicoCasal') return renderHistoricoCasal();
  if (activeItem === 'casais1') return renderCasaisEtapa(1);
  if (activeItem === 'casais2') return renderCasaisEtapa(2);
  if (activeItem === 'casais3') return renderCasaisEtapa(3);
}

function bindBuscaEvents() {
  const st = searchState[activeItem];

  document.querySelectorAll('#main select[name]').forEach(el => {
    el.addEventListener('change', () => {
      st[el.name] = el.value;
      st.searched = false;
      st.page = 1;
      renderMain();
    });
  });

  const btnBuscar = document.getElementById('btnBuscar');
  if (btnBuscar) btnBuscar.addEventListener('click', () => {
    st.searched = true;
    st.page = 1;
    renderMain();
  });

  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.page === 'prev') st.page = Math.max(1, st.page - 1);
      if (btn.dataset.page === 'next') st.page = st.page + 1;
      renderMain();
    });
  });

  const btnPdf = document.getElementById('btnPdf');
  if (btnPdf) btnPdf.addEventListener('click', () => {
    const data = LAST_RESULTS[activeItem];
    if (data) gerarPdfLista(data.title, data.cols, data.rows);
  });

  document.querySelectorAll('[data-searchedit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.searchedit;
      const kind = btn.dataset.editkind;
      if (kind === 'casal') {
        const registro = await api(`/casais/${id}`);
        editingId = registro.id;
        formState = { ...registro };
        editReturnItem = activeItem;
        expandedModule = 'cadastros';
        activeItem = 'casais';
        fullRender();
        showToast('Editando registro do casal selecionado.');
      } else {
        const tabela = { funcao: 'funcoes', dirigente: 'dirigentes', palestra: 'palestras', testemunho: 'testemunhos' }[kind];
        const registro = await api(`/${tabela}/${id}`);
        funcPopup = { kind, id: registro.id, row: registro };
        abrirFuncPopup();
      }
    });
  });
}

/* ---------- pop-up de edição genérico (Funções / Dirigentes / Palestras / Testemunhos) ---------- */
function camposEditPopup(kind, r) {
  if (kind === 'funcao') {
    return `<div class="grid">
      <div class="field"><label>Ele</label><input type="text" value="${r.apelido_ele || ''}" readonly></div>
      <div class="field"><label>Ela</label><input type="text" value="${r.apelido_ela || ''}" readonly></div>
      <div class="field"><label>Equipe</label><select id="fpEquipe">${EQUIPES_LIST.map(e => `<option ${e === r.equipe ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field"><label>Encontro</label><select id="fpEncontro">${ENCONTRO_OPTS.map(e => `<option ${e === r.encontro ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field"><label>Etapa</label><select id="fpEtapa">${ETAPAS.map(e => `<option ${e === r.etapa ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field"><label>Coordenou?</label><select id="fpCoordenou">${['Sim','Não'].map(e => `<option ${e === r.coordenou ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
    </div>`;
  }
  if (kind === 'dirigente') {
    const funcoesOpts = ['Pós Encontro','Finanças','Palestras','Fichas','Montagem'];
    return `<div class="grid">
      <div class="field"><label>Ele</label><input type="text" value="${r.apelido_ele || ''}" readonly></div>
      <div class="field"><label>Ela</label><input type="text" value="${r.apelido_ela || ''}" readonly></div>
      <div class="field"><label>Função Dirigente</label><select id="fpFuncao">${funcoesOpts.map(e => `<option ${e === r.funcao_dirigente ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field"><label>Período</label><input id="fpPeriodo" type="text" value="${r.periodo || ''}"></div>
      <div class="field"><label>Etapa</label><select id="fpEtapa">${ETAPAS.map(e => `<option ${e === r.etapa ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
    </div>`;
  }
  if (kind === 'palestra') {
    return `<div class="grid">
      <div class="field"><label>Sacerdote</label><input id="fpSacerdote" type="text" value="${r.sacerdote || ''}"></div>
      <div class="field"><label>Ele</label><input type="text" value="${r.apelido_ele || ''}" readonly></div>
      <div class="field"><label>Ela</label><input type="text" value="${r.apelido_ela || ''}" readonly></div>
      <div class="field"><label>Encontro</label><select id="fpEncontro">${ENCONTRO_OPTS.map(e => `<option ${e === r.encontro ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field"><label>Etapa</label><select id="fpEtapa">${ETAPAS.map(e => `<option ${e === r.etapa ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field full"><label>Palestra</label><input id="fpTitulo" type="text" value="${r.palestra || ''}"></div>
    </div>`;
  }
  if (kind === 'testemunho') {
    return `<div class="grid">
      <div class="field"><label>Jovem</label><input id="fpJovem" type="text" value="${r.jovem || ''}"></div>
      <div class="field"><label>Viúvo</label><input id="fpViuvo" type="text" value="${r.viuvo || ''}"></div>
      <div class="field"><label>Ele</label><input type="text" value="${r.apelido_ele || ''}" readonly></div>
      <div class="field"><label>Ela</label><input type="text" value="${r.apelido_ela || ''}" readonly></div>
      <div class="field"><label>Encontro</label><select id="fpEncontro">${ENCONTRO_OPTS.map(e => `<option ${e === r.encontro ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field"><label>Etapa</label><select id="fpEtapa">${ETAPAS.map(e => `<option ${e === r.etapa ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field full"><label>Testemunho</label><input id="fpTitulo" type="text" value="${r.testemunho || ''}"></div>
    </div>`;
  }
  return '';
}
function lerEditPopup(kind) {
  if (kind === 'funcao') return { equipe: val('fpEquipe'), encontro: val('fpEncontro'), etapa: val('fpEtapa'), coordenou: val('fpCoordenou') };
  if (kind === 'dirigente') return { funcao_dirigente: val('fpFuncao'), periodo: val('fpPeriodo'), etapa: val('fpEtapa') };
  if (kind === 'palestra') return { sacerdote: val('fpSacerdote'), encontro: val('fpEncontro'), etapa: val('fpEtapa'), palestra: val('fpTitulo') };
  if (kind === 'testemunho') return { jovem: val('fpJovem'), viuvo: val('fpViuvo'), encontro: val('fpEncontro'), etapa: val('fpEtapa'), testemunho: val('fpTitulo') };
}
function tabelaDoKind(kind) {
  return { funcao: 'funcoes', dirigente: 'dirigentes', palestra: 'palestras', testemunho: 'testemunhos' }[kind];
}
function abrirFuncPopup() {
  document.getElementById('funcPopupBody').innerHTML = camposEditPopup(funcPopup.kind, funcPopup.row);
  document.getElementById('funcPopupOverlay').classList.add('open');
}
document.getElementById('funcPopupCancel').addEventListener('click', () => {
  funcPopup = null;
  document.getElementById('funcPopupOverlay').classList.remove('open');
});
document.getElementById('funcPopupSalvar').addEventListener('click', async () => {
  if (funcPopup) {
    try {
      const dados = { ...funcPopup.row, ...lerEditPopup(funcPopup.kind) };
      await api(`/${tabelaDoKind(funcPopup.kind)}/${funcPopup.id}`, { method: 'PUT', body: JSON.stringify(dados) });
      showToast('Alterações salvas.');
      await renderMain();
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message);
    }
  }
  funcPopup = null;
  document.getElementById('funcPopupOverlay').classList.remove('open');
});

/* ---------- PDF de uma lista de resultados (Casais por Etapa) ---------- */
function gerarPdfLista(titulo, cols, rows) {
  const win = window.open('', '_blank');
  const hoje = new Date().toLocaleString('pt-BR');
  const corpo = rows.map(r => `<tr>${cols.map(c => `<td>${r[c[0]] ?? '—'}</td>`).join('')}</tr>`).join('');
  win.document.write(`
    <html><head><title>${titulo}</title>
    <style>
      body{ font-family: Arial, sans-serif; padding:30px; color:#241E2C; }
      h1{ font-size:18px; margin-bottom:2px; } p{ font-size:11px; color:#666; margin-top:0; }
      table{ width:100%; border-collapse:collapse; margin-top:16px; font-size:12px; }
      th,td{ border:1px solid #ccc; padding:6px 8px; text-align:left; }
      th{ background:#F6F1E6; }
    </style></head><body>
    <h1>${currentUser.diocese || ''} — ${currentUser.paroquia || ''}</h1>
    <p>${titulo} · Gerado em ${hoje}</p>
    <table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table>
    </body></html>`);
  win.document.close();
  win.print();
}

/* =========================================================
   MÓDULO FUNÇÕES
   ========================================================= */
async function renderFuncEquipes() {
  const st = ensureSearchState('funcEquipes', { etapa: '', equipe: '' });
  const canSearch = !!st.etapa && !!st.equipe;
  const funcoes = await api('/funcoes');
  const rows = (st.searched && canSearch) ? funcoes.filter(f => f.etapa === st.etapa && f.equipe === st.equipe) : funcoes;
  const cols = [['apelido_ele','Apelido Esposo'],['apelido_ela','Apelido Esposa'],['equipe','Equipe'],['encontro','Encontro'],['etapa','Etapa'],['coordenou','Coordenou?']];
  LAST_RESULTS.funcEquipes = { title: 'Histórico de Equipes', cols, rows };
  return `
    <p class="eyebrow">Funções</p>
    <h2 class="page-title">Histórico de Equipes</h2>
    <div class="card">
      <div class="grid">
        <div class="field"><label>Etapa</label><select name="etapa"><option value="">Selecione...</option>${ETAPAS.map(e => `<option value="${e}" ${st.etapa === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div class="field"><label>Equipe</label><select name="equipe"><option value="">Selecione...</option>${EQUIPES_LIST.map(e => `<option value="${e}" ${st.equipe === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
        <button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Resultados <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate('funcEquipes', rows), true, 'funcao')}
      ${renderPagination('funcEquipes', rows.length)}
    </div>`;
}

async function renderFuncDirigentes() {
  const st = ensureSearchState('funcDirigentes', { funcao: '', etapa: '' });
  const canSearch = !!st.funcao && !!st.etapa;
  const dirigentes = await api('/dirigentes');
  const rows = (st.searched && canSearch) ? dirigentes.filter(d => d.funcao_dirigente === st.funcao && d.etapa === st.etapa) : dirigentes;
  const cols = [['apelido_ele','Apelido Esposo'],['apelido_ela','Apelido Esposa'],['funcao_dirigente','Função'],['etapa','Etapa'],['periodo','Período']];
  const funcoesOpts = ['Pós Encontro','Finanças','Palestras','Fichas','Montagem'];
  LAST_RESULTS.funcDirigentes = { title: 'Histórico de Dirigentes', cols, rows };
  return `
    <p class="eyebrow">Funções</p>
    <h2 class="page-title">Histórico de Dirigentes</h2>
    <div class="card">
      <div class="grid">
        <div class="field"><label>Função</label><select name="funcao"><option value="">Selecione...</option>${funcoesOpts.map(e => `<option value="${e}" ${st.funcao === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div class="field"><label>Etapa</label><select name="etapa"><option value="">Selecione...</option>${ETAPAS.map(e => `<option value="${e}" ${st.etapa === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
        <button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Resultados <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate('funcDirigentes', rows), true, 'dirigente')}
      ${renderPagination('funcDirigentes', rows.length)}
    </div>`;
}

async function renderFuncPalestras() {
  const st = ensureSearchState('funcPalestras', { etapa: '', palestra: '' });
  const canSearch = !!st.etapa && !!st.palestra;
  const [palestras, catalogo] = await Promise.all([
    api('/palestras'), api('/catalogo/palestras' + (st.etapa ? `?etapa=${encodeURIComponent(st.etapa)}` : ''))
  ]);
  const rows = (st.searched && canSearch) ? palestras.filter(p => p.etapa === st.etapa && p.palestra === st.palestra) : palestras;
  const cols = [['apelido_ele','Apelido Esposo'],['apelido_ela','Apelido Esposa'],['palestra','Palestra'],['encontro','Encontro'],['etapa','Etapa']];
  LAST_RESULTS.funcPalestras = { title: 'Histórico de Palestras', cols, rows };
  return `
    <p class="eyebrow">Funções</p>
    <h2 class="page-title">Histórico de Palestras</h2>
    <div class="card">
      <div class="grid">
        <div class="field"><label>Etapa</label><select name="etapa"><option value="">Selecione...</option>${ETAPAS.map(e => `<option value="${e}" ${st.etapa === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div class="field"><label>Palestra</label><select name="palestra"><option value="">Selecione...</option>${catalogo.map(p => `<option value="${p.titulo}" ${st.palestra === p.titulo ? 'selected' : ''}>${p.titulo}</option>`).join('')}</select>
          <span class="hint">Lista filtrada pela Etapa · catálogo fixo (admin)</span></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
        <button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Resultados <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate('funcPalestras', rows), true, 'palestra')}
      ${renderPagination('funcPalestras', rows.length)}
    </div>`;
}

async function renderFuncTestemunhos() {
  const st = ensureSearchState('funcTestemunhos', { etapa: '', testemunho: '' });
  const canSearch = !!st.etapa && !!st.testemunho;
  const [testemunhos, catalogo] = await Promise.all([
    api('/testemunhos'), api('/catalogo/testemunhos' + (st.etapa ? `?etapa=${encodeURIComponent(st.etapa)}` : ''))
  ]);
  const rows = (st.searched && canSearch) ? testemunhos.filter(t => t.etapa === st.etapa && t.testemunho === st.testemunho) : testemunhos;
  const cols = [['apelido_ele','Apelido Esposo'],['apelido_ela','Apelido Esposa'],['testemunho','Testemunho'],['encontro','Encontro'],['etapa','Etapa']];
  LAST_RESULTS.funcTestemunhos = { title: 'Histórico de Testemunhos', cols, rows };
  return `
    <p class="eyebrow">Funções</p>
    <h2 class="page-title">Histórico de Testemunhos</h2>
    <div class="card">
      <div class="grid">
        <div class="field"><label>Etapa</label><select name="etapa"><option value="">Selecione...</option>${ETAPAS.map(e => `<option value="${e}" ${st.etapa === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div class="field"><label>Testemunho</label><select name="testemunho"><option value="">Selecione...</option>${catalogo.map(t => `<option value="${t.titulo}" ${st.testemunho === t.titulo ? 'selected' : ''}>${t.titulo}</option>`).join('')}</select>
          <span class="hint">Lista filtrada pela Etapa · catálogo fixo (admin)</span></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
        <button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Resultados <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate('funcTestemunhos', rows), true, 'testemunho')}
      ${renderPagination('funcTestemunhos', rows.length)}
    </div>`;
}

async function renderFuncHabilidades() {
  const st = ensureSearchState('funcHabilidades', { term: '' });
  const [casais, habilidadesCad] = await Promise.all([api('/casais'), api('/habilidades')]);
  const term = (st.term || '').toLowerCase();
  const rows = casais
    .filter(c => !term || (c.habilidade || '').toLowerCase().includes(term))
    .map(c => ({ apelido_esposo: c.apelido_esposo, apelido_esposa: c.apelido_esposa, habilidade: c.habilidade }));
  const cols = [['apelido_esposo','Apelido Esposo'],['apelido_esposa','Apelido Esposa'],['habilidade','Habilidades do Casal']];
  LAST_RESULTS.funcHabilidades = { title: 'Histórico de Habilidades', cols, rows };
  return `
    <p class="eyebrow">Funções</p>
    <h2 class="page-title">Histórico de Habilidades</h2>
    <div class="card" style="display:flex; gap:26px; flex-wrap:wrap;">
      <div style="flex:1; min-width:220px;">
        <div class="field"><label>Habilidade Procurada</label><input type="text" id="habInput" value="${st.term || ''}" placeholder="Digite para filtrar..."></div>
        <span class="hint">Filtra a cada caractere digitado</span>
      </div>
      <div style="width:230px;">
        <div class="section-title sub" style="margin-top:0;">Habilidades cadastradas</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">${habilidadesCad.map(h => `<span class="count-pill">${h.nome}</span>`).join('') || '<span class="hint">Nenhuma cadastrada ainda</span>'}</div>
      </div>
    </div>
    <div class="card">
      <div class="btn-row" style="margin-top:0; margin-bottom:14px;"><button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button></div>
      <div class="section-title" style="border:none;">Resultados <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate('funcHabilidades', rows), false)}
      ${renderPagination('funcHabilidades', rows.length)}
    </div>`;
}

async function renderFuncMontagem() {
  const funcoes = await api('/funcoes');
  const rightSource = funcoes.filter(f => f.etapa === '1ª' && (!montagemState.equipe || f.equipe === montagemState.equipe));
  LAST_RESULTS.funcMontagemLeft = { title: 'Montagem — Selecionados', cols: [['apelido_ele','Apelido Esposo'],['apelido_ela','Apelido Esposa'],['equipe','Equipe'],['encontro','Encontro'],['coordenou','Coordenou?']], rows: montagemState.left };
  return `
    <p class="eyebrow">Funções</p>
    <h2 class="page-title">Montagem</h2>
    <div class="card">
      <div class="grid">
        <div class="field"><label>Equipe</label><select id="montEquipe"><option value="">Todas</option>${EQUIPES_LIST.map(e => `<option value="${e}" ${montagemState.equipe === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      </div>
      <span class="hint">Lista da coluna direita filtrada pela 1ª Etapa</span>
    </div>
    <div class="card" style="display:flex; gap:20px; flex-wrap:wrap;">
      <div style="flex:1; min-width:280px;">
        <div class="section-title sub">Disponíveis (clique para adicionar)</div>
        <div style="max-height:340px; overflow-y:auto; border:1px solid var(--line); border-radius:8px;">
          ${rightSource.length === 0
            ? `<div style="padding:16px; text-align:center; color:#A79A82; font-style:italic;">Nenhum registro para esse filtro.</div>`
            : rightSource.map((r, i) => `
              <div class="mont-item" data-montadd="${i}">
                <strong>${r.apelido_ele}</strong> &amp; ${r.apelido_ela} — ${r.equipe} · Encontro ${r.encontro}${r.coordenou === 'Sim' ? ' · Coordenou' : ''}
              </div>`).join('')}
        </div>
      </div>
      <div style="flex:1; min-width:280px;">
        <div class="section-title sub" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Selecionados</span> <button type="button" class="icon-btn" id="btnPdfMontagem">⭳ PDF</button>
        </div>
        <div style="max-height:340px; overflow-y:auto; border:1px solid var(--line); border-radius:8px;">
          ${montagemState.left.length === 0
            ? `<div style="padding:16px; text-align:center; color:#A79A82; font-style:italic;">Nenhum item selecionado ainda.</div>`
            : montagemState.left.map((r, i) => `
              <div class="mont-item">
                <strong>${r.apelido_ele}</strong> &amp; ${r.apelido_ela} — ${r.equipe} · Encontro ${r.encontro}
                <button type="button" class="icon-btn" data-montremove="${i}" style="float:right;">✕</button>
              </div>`).join('')}
        </div>
      </div>
    </div>`;
}

async function renderFuncPage() {
  if (activeItem === 'funcEquipes') return renderFuncEquipes();
  if (activeItem === 'funcDirigentes') return renderFuncDirigentes();
  if (activeItem === 'funcPalestras') return renderFuncPalestras();
  if (activeItem === 'funcTestemunhos') return renderFuncTestemunhos();
  if (activeItem === 'funcHabilidades') return renderFuncHabilidades();
  if (activeItem === 'funcMontagem') return renderFuncMontagem();
}

/* =========================================================
   MÓDULO DATAS
   ========================================================= */
function dayMonthFromISO(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  return { dia: String(d.getDate()).padStart(2, '0'), mesIdx: d.getMonth(), mes: MESES[d.getMonth()], ano: d.getFullYear() };
}

async function renderAniversario(who) {
  const id = who === 'esposo' ? 'aniversEsposo' : 'aniversEsposa';
  const st = ensureSearchState(id, { mes: '' });
  const canSearch = !!st.mes;
  const casais = await api('/casais');
  const dateField = who === 'esposo' ? 'nasc_esposo' : 'nasc_esposa';
  let all = casais.map(c => {
    const dm = dayMonthFromISO(c[dateField]);
    return dm ? { apelido_esposo: c.apelido_esposo, apelido_esposa: c.apelido_esposa, dia: dm.dia, mes: dm.mes } : null;
  }).filter(Boolean);
  const rows = (st.searched && st.mes) ? all.filter(r => r.mes === st.mes) : all;
  const cols = who === 'esposo'
    ? [['apelido_esposo','Apelido Esposo'],['apelido_esposa','Esposo de'],['dia','Dia'],['mes','Mês']]
    : [['apelido_esposa','Apelido Esposa'],['apelido_esposo','Esposa de'],['dia','Dia'],['mes','Mês']];
  const titulo = who === 'esposo' ? 'Aniversário Esposo' : 'Aniversário Esposa';
  LAST_RESULTS[id] = { title: titulo, cols, rows };
  return `
    <p class="eyebrow">Datas</p>
    <h2 class="page-title">${titulo}</h2>
    <div class="card">
      <div class="grid">
        <div class="field"><label>Mês</label><select name="mes"><option value="">Selecione...</option>${MESES.map(m => `<option value="${m}" ${st.mes === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
        <button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Aniversariantes <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate(id, rows), false)}
      ${renderPagination(id, rows.length)}
    </div>`;
}

async function renderAniversarioCasamento() {
  const id = 'aniversCasamento';
  const st = ensureSearchState(id, { mes: '' });
  const canSearch = !!st.mes;
  const casais = await api('/casais');
  let all = casais.map(c => {
    const dm = dayMonthFromISO(c.casamento_data);
    if (!dm) return null;
    return { apelido_esposo: c.apelido_esposo, apelido_esposa: c.apelido_esposa, dia: dm.dia, mes: dm.mes, ano: dm.ano, anosCasados: calcAnosCasados(c.casamento_data) };
  }).filter(Boolean);
  const rows = (st.searched && st.mes) ? all.filter(r => r.mes === st.mes) : all;
  const cols = [['apelido_esposo','Apelido Esposo'],['apelido_esposa','Apelido Esposa'],['dia','Dia'],['mes','Mês'],['ano','Ano'],['anosCasados','Anos de Casados']];
  LAST_RESULTS[id] = { title: 'Aniversário Casamento', cols, rows };
  return `
    <p class="eyebrow">Datas</p>
    <h2 class="page-title">Aniversário Casamento</h2>
    <div class="card">
      <div class="grid">
        <div class="field"><label>Mês</label><select name="mes"><option value="">Selecione...</option>${MESES.map(m => `<option value="${m}" ${st.mes === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary ${canSearch ? '' : 'field-hidden'}" id="btnBuscar">Buscar</button>
        <button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="border:none;">Aniversários de Casamento <span class="count-pill">${rows.length}</span></div>
      ${renderResultsTable(cols, paginate(id, rows), false)}
      ${renderPagination(id, rows.length)}
    </div>`;
}

async function renderDatasPage() {
  if (activeItem === 'aniversEsposo') return renderAniversario('esposo');
  if (activeItem === 'aniversEsposa') return renderAniversario('esposa');
  if (activeItem === 'aniversCasamento') return renderAniversarioCasamento();
}

/* =========================================================
   MÓDULO UTILIDADES
   ========================================================= */

/* ---------- helpers de formatação ---------- */
function formatCurrencyBRL(valor) {
  const n = Number(valor) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function maskDateBR(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += '/' + digits.slice(2, 4);
  if (digits.length > 4) out += '/' + digits.slice(4, 8);
  return out;
}
function brToIso(br) {
  const m = (br || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function isoToBr(iso) {
  const partes = (iso || '').split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : '';
}
function formatCpfCnpj(digits) {
  digits = digits.slice(0, 14);
  if (digits.length <= 11) {
    let out = digits.slice(0, 3);
    if (digits.length > 3) out += '.' + digits.slice(3, 6);
    if (digits.length > 6) out += '.' + digits.slice(6, 9);
    if (digits.length > 9) out += '-' + digits.slice(9, 11);
    return out;
  }
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += '.' + digits.slice(2, 5);
  if (digits.length > 5) out += '.' + digits.slice(5, 8);
  if (digits.length > 8) out += '/' + digits.slice(8, 12);
  if (digits.length > 12) out += '-' + digits.slice(12, 14);
  return out;
}
const _UNID = ['','um','dois','três','quatro','cinco','seis','sete','oito','nove'];
const _DEZ10_19 = ['dez','onze','doze','treze','catorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
const _DEZENAS = ['','dez','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
const _CENTENAS = ['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
function _grupoExtenso(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  let out = [];
  if (c > 0) out.push(_CENTENAS[c]);
  if (r > 0) {
    if (r < 10) out.push(_UNID[r]);
    else if (r < 20) out.push(_DEZ10_19[r - 10]);
    else { const d = Math.floor(r / 10), u = r % 10; out.push(_DEZENAS[d] + (u > 0 ? ' e ' + _UNID[u] : '')); }
  }
  return out.join(' e ');
}
function _inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1000000);
  const milhares = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  let partes = [];
  if (milhoes > 0) partes.push(_grupoExtenso(milhoes) + (milhoes === 1 ? ' milhão' : ' milhões'));
  if (milhares > 0) partes.push(milhares === 1 ? 'mil' : _grupoExtenso(milhares) + ' mil');
  if (resto > 0) partes.push(_grupoExtenso(resto));
  return partes.join(' e ');
}
function valorPorExtenso(valor) {
  const reais = Math.floor(valor);
  const centavos = Math.round((valor - reais) * 100);
  let out = _inteiroExtenso(reais) + (reais === 1 ? ' real' : ' reais');
  if (centavos > 0) out += ' e ' + _inteiroExtenso(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
  return out;
}

/* ---------- Recibo ---------- */
function renderRecibo() {
  const hoje = new Date().toLocaleDateString('pt-BR');
  const recebedorNomeVal = formState.recRecebedorNome ?? currentUser.paroquia ?? '';
  return `
    <p class="eyebrow">Utilidades</p>
    <h2 class="page-title">Recibo de Pagamento</h2>
    <form id="reciboForm" class="card" autocomplete="off">
      <div class="grid">
        <div class="field"><label>Valor R$ <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="recValor" value="${formState.recValor || ''}" placeholder="R$ 0,00" required></div>
        <div class="field"><label>Valor por Extenso</label><input type="text" id="recExtenso" value="${formState.recExtenso || ''}" readonly></div>
        <div class="field"><label>Pagador (CPF/CNPJ) <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="recPagador" value="${formState.recPagador || ''}" placeholder="000.000.000-00" required></div>
        <div class="field"><label>Recebedor (CPF/CNPJ) <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="recRecebedor" value="${formState.recRecebedor || ''}" placeholder="000.000.000-00" required></div>
        <div class="field"><label>Nome <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="recPagadorNome" value="${formState.recPagadorNome || ''}" placeholder="Nome do pagador" required></div>
        <div class="field"><label>Nome <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="recRecebedorNome" value="${recebedorNomeVal}" placeholder="Nome do recebedor" required></div>
        <div class="field full"><label>Referente a <span class="req-star" title="Campo obrigatório">*</span></label><textarea id="recReferente" rows="3" required>${formState.recReferente || ''}</textarea></div>
        <div class="field"><label>Data</label><input type="text" value="${hoje}" readonly></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" id="btnLimparRecibo">Limpar</button>
        <button type="button" class="btn btn-primary" id="btnGerarReciboPdf">⭳ Gerar PDF</button>
      </div>
    </form>`;
}
function bindReciboEvents() {
  const valorEl = document.getElementById('recValor');
  valorEl.addEventListener('input', () => {
    const digits = valorEl.value.replace(/\D/g, '');
    const cents = digits ? parseInt(digits, 10) : 0;
    const reais = cents / 100;
    valorEl.value = digits ? formatCurrencyBRL(reais) : '';
    formState.recValor = valorEl.value;
    formState.recExtenso = digits ? valorPorExtenso(reais) : '';
    document.getElementById('recExtenso').value = formState.recExtenso;
  });
  ['recPagador', 'recRecebedor'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      const digits = el.value.replace(/\D/g, '');
      el.value = formatCpfCnpj(digits);
      formState[id] = el.value;
    });
  });
  ['recPagadorNome', 'recRecebedorNome'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { formState[id] = el.value; });
  });
  document.getElementById('recReferente').addEventListener('input', (e) => { formState.recReferente = e.target.value; });
  document.getElementById('btnLimparRecibo').addEventListener('click', () => { formState = {}; renderMain(); showToast('Formulário limpo.'); });
  document.getElementById('btnGerarReciboPdf').addEventListener('click', () => {
    const reciboForm = document.getElementById('reciboForm');
    if (reciboForm && !reciboForm.reportValidity()) {
      showToast('Preencha os campos obrigatórios (marcados com *) antes de gerar o recibo.');
      return;
    }
    const win = window.open('', '_blank');
    const hoje = new Date().toLocaleDateString('pt-BR');
    const pagadorNome = formState.recPagadorNome || '____________________';
    const recebedorNome = formState.recRecebedorNome || currentUser.paroquia || '';
    win.document.write(`<html><head><title>Recibo</title>
      <style>body{font-family:Georgia,serif; padding:50px; color:#241E2C;} h1{text-align:center; font-size:20px;}
      .linha{margin:22px 0; font-size:14px; line-height:1.8;} .assinatura{margin-top:70px; text-align:center;}
      .campo{border-bottom:1px solid #333; display:inline-block; min-width:240px;}</style></head><body>
      <h1>${currentUser.paroquia || ''}</h1>
      <h1>RECIBO</h1>
      <p class="linha">Recebi de <b>${pagadorNome}</b>${formState.recPagador ? ` (CPF/CNPJ: ${formState.recPagador})` : ''} a quantia de <b>${formState.recValor || '____________'}</b> (${formState.recExtenso || ''}).</p>
      <p class="linha">Referente a: ${(formState.recReferente || '').replace(/\n/g, '<br>')}</p>
      <p class="linha">${currentUser.cidadeSede || ''}, ${hoje}.</p>
      <div class="assinatura"><div class="campo">&nbsp;</div><br>${recebedorNome}${formState.recRecebedor ? `<br><span style="font-size:11px;">CPF/CNPJ: ${formState.recRecebedor}</span>` : ''}</div>
      </body></html>`);
    win.document.close();
    win.print();
  });
}

/* ---------- Agenda ---------- */
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
function isoDate(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function eventsOnDate(agendaList, iso) { return agendaList.filter(e => e.data_inicial <= iso && e.data_final >= iso); }

function renderAgendaCalendar(agendaList) {
  const { year, month } = agendaState;
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  let grid = `<div class="cal-grid">`;
  DIAS_SEMANA.forEach(d => grid += `<div class="cal-head">${d}</div>`);
  cells.forEach(d => {
    if (d === null) { grid += `<div class="cal-cell empty"></div>`; return; }
    const iso = isoDate(year, month, d);
    const evs = eventsOnDate(agendaList, iso);
    grid += `<div class="cal-cell" data-caldate="${iso}"><span class="cal-day">${d}</span>${evs.length ? `<span class="cal-count" title="${evs.length} evento(s)">${evs.length}</span>` : ''}</div>`;
  });
  grid += `</div>`;
  return `<div class="card">
    <div class="btn-row" style="margin-top:0; justify-content:space-between;">
      <button type="button" class="btn btn-ghost" id="calPrev">◀</button>
      <div class="section-title" style="border:none; margin:0;">${MESES[month]} ${year}</div>
      <button type="button" class="btn btn-ghost" id="calNext">▶</button>
    </div>
    ${grid}
  </div>`;
}
function renderAgendaListHtml(agendaList) {
  const rows = agendaList.slice()
    .sort((a, b) => a.data_inicial.localeCompare(b.data_inicial))
    .map(e => ({ ...e, data_inicial: isoToBr(e.data_inicial), data_final: isoToBr(e.data_final) }));
  const cols = [['nome','Evento'],['data_inicial','Data Inicial'],['hora_inicial','Hora Inicial'],['data_final','Data Final'],['hora_final','Hora Final']];
  LAST_RESULTS.agenda = { title: 'Agenda de Compromissos', cols, rows };
  const corpo = rows.length
    ? rows.map(r => `<tr>
        <td>${r.nome ?? '—'}</td><td>${r.data_inicial ?? '—'}</td><td>${r.hora_inicial || '—'}</td><td>${r.data_final ?? '—'}</td><td>${r.hora_final || '—'}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="icon-btn" data-agendarowedit="${r.id}">✎ Editar</button>
          <button type="button" class="icon-btn" data-agendarowdel="${r.id}" style="color:#B8462F;">🗑 Excluir</button>
        </td>
      </tr>`).join('')
    : `<tr class="empty-row"><td colspan="6">Nenhum evento cadastrado.</td></tr>`;
  return `<div class="card">
    <div class="btn-row" style="margin-top:0; margin-bottom:14px;"><button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button></div>
    <div class="section-title" style="border:none;">Eventos Cadastrados <span class="count-pill">${rows.length}</span></div>
    <div class="table-wrap"><table><thead><tr><th>Evento</th><th>Data Inicial</th><th>Hora Inicial</th><th>Data Final</th><th>Hora Final</th><th>Ações</th></tr></thead>
    <tbody>${corpo}</tbody></table></div>
  </div>`;
}
async function renderAgenda() {
  const agendaList = await api('/agenda');
  return `<p class="eyebrow">Utilidades</p><h2 class="page-title">Agenda de Compromissos</h2>${renderAgendaCalendar(agendaList)}${renderAgendaListHtml(agendaList)}`;
}
async function openAgendaPopup(iso) {
  agendaState.popupDate = iso;
  agendaState.view = 'list';
  agendaState.editing = null;
  document.getElementById('agendaPopupOverlay').classList.add('open');
  await renderAgendaPopupBody();
}
async function renderAgendaPopupBody() {
  const body = document.getElementById('agendaPopupBody');
  const iso = agendaState.popupDate;
  const agendaList = await api('/agenda');
  if (agendaState.view === 'list') {
    const evs = eventsOnDate(agendaList, iso);
    body.innerHTML = `
      <p style="font-size:12.5px; color:#5A4E3F; margin-top:0;">${iso.split('-').reverse().join('/')}</p>
      ${evs.length === 0 ? `<p style="font-style:italic; color:#A79A82;">Nenhum evento nesta data.</p>` :
        evs.map(e => `<div class="mont-item" data-agendaedit="${e.id}"><strong>${e.nome}</strong><br><span style="font-size:11px;color:#8A7C64;">${e.hora_inicial || ''} — ${e.hora_final || ''}</span></div>`).join('')}
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" id="agendaClose">Fechar</button>
        <button type="button" class="btn btn-primary" id="agendaNovo">+ Novo Evento</button>
      </div>`;
    document.getElementById('agendaClose').addEventListener('click', () => document.getElementById('agendaPopupOverlay').classList.remove('open'));
    document.getElementById('agendaNovo').addEventListener('click', () => { agendaState.view = 'form'; agendaState.editing = null; renderAgendaPopupBody(); });
    body.querySelectorAll('[data-agendaedit]').forEach(el => {
      el.addEventListener('click', () => {
        agendaState.editing = evs.find(e => String(e.id) === el.dataset.agendaedit);
        agendaState.view = 'form';
        renderAgendaPopupBody();
      });
    });
  } else {
    const e = agendaState.editing || { nome: '', descricao: '', data_inicial: iso, hora_inicial: '', data_final: iso, hora_final: '' };
    body.innerHTML = `
      <form id="agendaForm" autocomplete="off">
        <div class="field full"><label>Nome do Evento <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="agNome" value="${e.nome || ''}" required></div>
        <div class="field full"><label>Descrição do Evento <span class="req-star" title="Campo obrigatório">*</span></label><textarea id="agDesc" rows="2" required>${e.descricao || ''}</textarea></div>
        <div class="grid">
          <div class="field"><label>Data Inicial <span class="req-star" title="Campo obrigatório">*</span></label><input type="date" id="agDataIni" value="${e.data_inicial || ''}" required></div>
          <div class="field"><label>Hora Inicial <span class="req-star" title="Campo obrigatório">*</span></label><input type="time" id="agHoraIni" value="${e.hora_inicial || ''}" required></div>
          <div class="field"><label>Data Final <span class="req-star" title="Campo obrigatório">*</span></label><input type="date" id="agDataFim" value="${e.data_final || ''}" required></div>
          <div class="field"><label>Hora Final <span class="req-star" title="Campo obrigatório">*</span></label><input type="time" id="agHoraFim" value="${e.hora_final || ''}" required></div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-ghost" id="agendaCancelForm">Cancelar</button>
          <button type="button" class="btn btn-primary" id="agendaSalvar">${agendaState.editing ? 'Salvar' : 'Criar Evento'}</button>
        </div>
      </form>`;
    document.getElementById('agendaCancelForm').addEventListener('click', () => { agendaState.view = 'list'; renderAgendaPopupBody(); });
    document.getElementById('agendaSalvar').addEventListener('click', async () => {
      const agendaForm = document.getElementById('agendaForm');
      if (agendaForm && !agendaForm.reportValidity()) {
        showToast('Preencha os campos obrigatórios (marcados com *) antes de salvar.');
        return;
      }
      const dados = { nome: val('agNome'), descricao: val('agDesc'), data_inicial: val('agDataIni'), hora_inicial: val('agHoraIni'), data_final: val('agDataFim'), hora_final: val('agHoraFim') };
      try {
        if (agendaState.editing) await api(`/agenda/${agendaState.editing.id}`, { method: 'PUT', body: JSON.stringify(dados) });
        else await api('/agenda', { method: 'POST', body: JSON.stringify(dados) });
        showToast(agendaState.editing ? 'Evento atualizado.' : 'Evento criado.');
        agendaState.editing = null;
        agendaState.view = 'list';
        await renderMain();
        await renderAgendaPopupBody();
      } catch (err) {
        showToast('Erro ao salvar: ' + err.message);
      }
    });
  }
}
function bindAgendaEvents() {
  const prev = document.getElementById('calPrev'), next = document.getElementById('calNext');
  if (prev) prev.addEventListener('click', () => { agendaState.month--; if (agendaState.month < 0) { agendaState.month = 11; agendaState.year--; } renderMain(); });
  if (next) next.addEventListener('click', () => { agendaState.month++; if (agendaState.month > 11) { agendaState.month = 0; agendaState.year++; } renderMain(); });
  document.querySelectorAll('[data-caldate]').forEach(cell => { cell.addEventListener('click', () => openAgendaPopup(cell.dataset.caldate)); });
  const btnPdf = document.getElementById('btnPdf');
  if (btnPdf) btnPdf.addEventListener('click', () => { const data = LAST_RESULTS.agenda; if (data) gerarPdfLista(data.title, data.cols, data.rows); });
  document.querySelectorAll('[data-agendarowedit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const list = await api('/agenda');
      const ev = list.find(x => String(x.id) === btn.dataset.agendarowedit);
      if (!ev) return;
      agendaState.editing = ev;
      agendaState.view = 'form';
      agendaState.popupDate = ev.data_inicial;
      document.getElementById('agendaPopupOverlay').classList.add('open');
      await renderAgendaPopupBody();
    });
  });
  document.querySelectorAll('[data-agendarowdel]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingDelete = { tabela: 'agenda', id: btn.dataset.agendarowdel };
      document.getElementById('confirmDeleteOverlay').classList.add('open');
    });
  });
}

/* ---------- Caixa ---------- */
async function renderCaixa() {
  let rows = await api('/caixa');
  if (caixaState.dataIni) rows = rows.filter(r => r.data >= caixaState.dataIni);
  if (caixaState.dataFim) rows = rows.filter(r => r.data <= caixaState.dataFim);
  rows = rows.slice().sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  const totalEntradas = rows.filter(r => r.tipo === 'Entrada').reduce((s, r) => s + Number(r.valor), 0);
  const totalSaidas = rows.filter(r => r.tipo === 'Saída').reduce((s, r) => s + Number(r.valor), 0);
  const saldo = totalEntradas - totalSaidas;
  LAST_RESULTS.caixa = { title: 'Controle de Caixa', cols: [['tipo','Tipo'],['data','Data'],['descricao','Descriminação'],['valorFmt','Valor']], rows: rows.map(r => ({ ...r, valorFmt: formatCurrencyBRL(r.valor) })) };
  let tableHtml = `<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Data</th><th>Descriminação</th><th>Valor</th><th>Edita</th><th>Exclui</th></tr></thead><tbody>`;
  if (rows.length === 0) {
    tableHtml += `<tr class="empty-row"><td colspan="6">Nenhum lançamento no período.</td></tr>`;
  } else {
    rows.forEach(r => {
      const cor = r.tipo === 'Entrada' ? 'var(--teal)' : '#B8462F';
      tableHtml += `<tr>
        <td>${r.tipo}</td><td>${(r.data || '').split('-').reverse().join('/')}</td><td>${r.descricao || ''}</td>
        <td style="color:${cor}; font-weight:600;">${formatCurrencyBRL(r.valor)}</td>
        <td><button type="button" class="icon-btn" data-caixaeditar="${r.id}">✎</button></td>
        <td><button type="button" class="icon-btn" data-caixaexcluir="${r.id}">🗑</button></td>
      </tr>`;
    });
  }
  tableHtml += `</tbody></table></div>`;
  return `
    <p class="eyebrow">Utilidades</p>
    <h2 class="page-title">Controle de Caixa</h2>
    <div class="card">
      <div class="btn-row" style="margin-top:0;">
        <button type="button" class="btn btn-primary" id="btnNovoLancamento">+ Novo Lançamento</button>
        <button type="button" class="btn btn-ghost" id="btnPdf">⭳ Gerar PDF</button>
      </div>
      <div class="section-title sub" style="margin-top:18px;">Busca por Intervalo</div>
      <div class="grid">
        <div class="field"><label>Data Inicial</label><input type="text" id="caixaDataIni" value="${isoToBr(caixaState.dataIni)}" placeholder="dd/mm/aaaa" maxlength="10"></div>
        <div class="field"><label>Data Final</label><input type="text" id="caixaDataFim" value="${isoToBr(caixaState.dataFim)}" placeholder="dd/mm/aaaa" maxlength="10"></div>
      </div>
    </div>
    <div class="card">
      ${tableHtml}
      <div class="grid" style="margin-top:18px;">
        <div class="field"><label>Entradas</label><input type="text" value="${formatCurrencyBRL(totalEntradas)}" readonly style="color:var(--teal); font-weight:700;"></div>
        <div class="field"><label>Saídas</label><input type="text" value="${formatCurrencyBRL(totalSaidas)}" readonly style="color:#B8462F; font-weight:700;"></div>
        <div class="field"><label>Saldo</label><input type="text" value="${formatCurrencyBRL(saldo)}" readonly style="font-weight:700;"></div>
      </div>
    </div>`;
}
async function openCaixaPopup(editingId2) {
  const r = editingId2 != null ? await api(`/caixa/${editingId2}`) : { tipo: 'Entrada', data: '', descricao: '', valor: '' };
  document.getElementById('caixaPopupTitle').textContent = editingId2 != null ? 'Editar Lançamento' : 'Novo Lançamento';
  document.getElementById('caixaPopupBody').innerHTML = `
    <form id="caixaForm" autocomplete="off">
      <div class="grid">
        <div class="field"><label>Tipo <span class="req-star" title="Campo obrigatório">*</span></label><select id="cxTipo" required><option ${r.tipo === 'Entrada' ? 'selected' : ''}>Entrada</option><option ${r.tipo === 'Saída' ? 'selected' : ''}>Saída</option></select></div>
        <div class="field"><label>Data <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="cxData" value="${isoToBr(r.data)}" placeholder="dd/mm/aaaa" maxlength="10" required></div>
        <div class="field full"><label>Descrição <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="cxDescricao" value="${r.descricao || ''}" required></div>
        <div class="field"><label>Valor R$ <span class="req-star" title="Campo obrigatório">*</span></label><input type="text" id="cxValor" value="${r.valor || ''}" required></div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" id="cxCancelar">${editingId2 != null ? 'Cancelar' : 'Limpar'}</button>
        <button type="button" class="btn btn-primary" id="cxSalvar">Salvar</button>
      </div>
    </form>`;
  document.getElementById('caixaPopupOverlay').classList.add('open');
  document.getElementById('caixaPopupFechar').onclick = () => {
    document.getElementById('caixaPopupOverlay').classList.remove('open');
  };
  document.getElementById('cxData').addEventListener('input', (e) => { e.target.value = maskDateBR(e.target.value); });
  document.getElementById('cxCancelar').addEventListener('click', () => {
    if (editingId2 != null) document.getElementById('caixaPopupOverlay').classList.remove('open');
    else openCaixaPopup(null);
  });
  document.getElementById('cxSalvar').addEventListener('click', async () => {
    const caixaForm = document.getElementById('caixaForm');
    if (caixaForm && !caixaForm.reportValidity()) {
      showToast('Preencha os campos obrigatórios (marcados com *) antes de salvar.');
      return;
    }
    const dados = { tipo: val('cxTipo'), data: brToIso(val('cxData')), descricao: val('cxDescricao'), valor: parseFloat(val('cxValor').toString().replace(',', '.')) || 0 };
    try {
      if (editingId2 != null) await api(`/caixa/${editingId2}`, { method: 'PUT', body: JSON.stringify(dados) });
      else await api('/caixa', { method: 'POST', body: JSON.stringify(dados) });
      document.getElementById('caixaPopupOverlay').classList.remove('open');
      await renderMain();
      showToast('Lançamento salvo.');
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message);
    }
  });
}
function bindCaixaEvents() {
  const dIni = document.getElementById('caixaDataIni');
  const dFim = document.getElementById('caixaDataFim');
  dIni.addEventListener('input', () => { dIni.value = maskDateBR(dIni.value); });
  dFim.addEventListener('input', () => { dFim.value = maskDateBR(dFim.value); });
  dIni.addEventListener('change', () => { caixaState.dataIni = brToIso(dIni.value); renderMain(); });
  dFim.addEventListener('change', () => { caixaState.dataFim = brToIso(dFim.value); renderMain(); });
  document.getElementById('btnNovoLancamento').addEventListener('click', () => openCaixaPopup(null));
  document.querySelectorAll('[data-caixaeditar]').forEach(btn => { btn.addEventListener('click', () => openCaixaPopup(btn.dataset.caixaeditar)); });
  document.querySelectorAll('[data-caixaexcluir]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingDelete = { tabela: 'caixa', id: btn.dataset.caixaexcluir };
      document.getElementById('confirmDeleteOverlay').classList.add('open');
    });
  });
  const btnPdf = document.getElementById('btnPdf');
  if (btnPdf) btnPdf.addEventListener('click', () => { const data = LAST_RESULTS.caixa; if (data) gerarPdfLista(data.title, data.cols, data.rows); });
}

/* ---------- Subsídios ---------- */
const SUBSIDIOS = {
  '1ª Etapa': [
    ['Palestra Plano de Deus','palestra-plano-de-deus.pdf'],
    ['Testemunho Plano de Deus','testemunho-plano-de-deus.pdf'],
    ['Palestra Harmonia Conjugal','palestra-harmonia-conjugal.pdf'],
    ['Palestra Diálogo com os Filhos','palestra-dialogo-com-os-filhos.pdf'],
    ['Palestra Penitência','palestra-penitencia.pdf'],
    ['Testemunho Jovem Vocacionado','testemunho-jovem-vocacionado.pdf'],
    ['Palestra Nossa Senhora na Vida da Família','palestra-nossa-senhora-na-vida-da-familia.pdf'],
    ['Palestra Ceia Eucarística','palestra-ceia-eucaristica.pdf'],
    ['Testemunho Ceia Eucarística','testemunho-ceia-eucaristica.pdf'],
    ['Palestra Fé nos Revezes da Vida','palestra-fe-nos-revezes-da-vida.pdf'],
    ['Palestra Sentido da Vida','palestra-sentido-da-vida.pdf'],
    ['Palestra Oração','palestra-oracao.pdf'],
    ['Palestra Corresponsabilidade','palestra-corresponsabilidade-1a-etapa.pdf'],
    ['Palestra A Vivência do Sacramento do Matrimônio','palestra-vivencia-sacramento-matrimonio.pdf'],
    ['Palestra O Casal Cristão no Mundo de Hoje','palestra-o-casal-cristao-no-mundo-de-hoje.pdf']
  ],
  '2ª Etapa': [
    ['Palestra Missão de Jesus Cristo','palestra-missao-de-jesus-cristo.pdf'],
    ['Palestra Igreja Comunidade de Salvação','palestra-igreja-comunidade-de-salvacao.pdf'],
    ['Palestra Família Formadora da Igreja','palestra-familia-formadora-da-igreja.pdf'],
    ['Palestra Magistério da Igreja','palestra-magisterio-da-igreja.pdf'],
    ['Palestra Diretrizes Pastorais do Episcopado Nacional','palestra-diretrizes-pastorais-episcopado-nacional.pdf'],
    ['Palestra Oração e Meditação','palestra-oracao-e-meditacao.pdf'],
    ['Palestra Sacramentos da Iniciação Cristã','palestra-sacramentos-iniciacao-crista.pdf'],
    ['Palestra Pecado e Inferno','palestra-pecado-e-inferno.pdf'],
    ['Palestra Corresponsabilidade','palestra-corresponsabilidade-2a-etapa.pdf'],
    ['Palestra Painel Sobre as Pastorais','palestra-painel-sobre-as-pastorais.pdf'],
    ['Palestra Fé e Esperança','palestra-fe-e-esperanca.pdf'],
    ['Testemunho Sobre Viuvez','testemunho-sobre-viuvez.pdf'],
    ['Palestra A Família na Construção do Mundo','palestra-familia-na-construcao-do-mundo.pdf']
  ],
  '3ª Etapa': [
    ['Palestra A Realidade do Mundo à Luz dos Documentos da Igreja','palestra-realidade-do-mundo-luz-documentos-igreja.pdf'],
    ['Palestra A Dignidade da Pessoa Humana','palestra-dignidade-da-pessoa-humana.pdf'],
    ['Palestra A Doutrina Social da Igreja','palestra-doutrina-social-da-igreja.pdf'],
    ['Palestra Justiça Social, Responsabilidade do Cristão','palestra-justica-social-responsabilidade-cristao.pdf'],
    ['Palestra A Família Renovadora do Mundo','palestra-familia-renovadora-do-mundo.pdf'],
    ['Penitência e Reconciliação','penitencia-e-reconciliacao.pdf'],
    ['Testemunho Pessoas Engajadas na Justiça Social','testemunho-pessoas-engajadas-justica-social.pdf'],
    ['Palestra Jesus Cristo e o Projeto do Reino Consumado na Eucaristia','palestra-jesus-cristo-projeto-reino-eucaristia.pdf']
  ]
};
function renderSubsidios() {
  let html = `<p class="eyebrow">Utilidades</p><h2 class="page-title">Subsídios</h2>`;
  Object.keys(SUBSIDIOS).forEach(secao => {
    html += `<div class="card">
      <div class="section-title">${secao}</div>
      <div style="display:flex; flex-direction:column;">
        ${SUBSIDIOS[secao].map(([titulo, arquivo]) => `<button type="button" class="subsidio-link" data-subsidio="${arquivo}">📄 ${titulo}</button>`).join('')}
      </div>
    </div>`;
  });
  html += `<p class="locked-note">Upload e substituição desses arquivos é restrito ao administrador do sistema — usuários comuns apenas visualizam e baixam.</p>`;
  return html;
}
function bindSubsidiosEvents() {
  document.querySelectorAll('[data-subsidio]').forEach(btn => { btn.addEventListener('click', () => window.open('/subsidios/' + btn.dataset.subsidio, '_blank')); });
}

/* ---------- Painel ---------- */
function statCard(titulo, itens) {
  return `<div class="card">
    <div class="section-title" style="border:none; margin-bottom:12px;">${titulo}</div>
    <div class="grid">${itens.map(([l, v]) => `<div class="field"><label>${l}</label><input type="text" value="${v}" readonly></div>`).join('')}</div>
  </div>`;
}
async function renderPainel() {
  const [diocesesCad, paroquiasCad, casais, funcoes, palestras, testemunhos] = await Promise.all([
    api('/diocese'), api('/paroquia'), api('/casais'), api('/funcoes'), api('/palestras'), api('/testemunhos')
  ]);
  const dio = diocesesCad[0] || {};
  const par = paroquiasCad[0] || {};
  const vivenc1 = casais.length;
  const vivenc2 = casais.filter(c => c.encontro2).length;
  const vivenc3 = casais.filter(c => c.encontro3).length;
  const eq1 = funcoes.filter(r => r.etapa === '1ª').length, eq2 = funcoes.filter(r => r.etapa === '2ª').length, eq3 = funcoes.filter(r => r.etapa === '3ª').length;
  const pal2 = palestras.filter(r => r.etapa === '2ª').length, pal3 = palestras.filter(r => r.etapa === '3ª').length;
  const test2 = testemunhos.filter(r => r.etapa === '2ª').length, test3 = testemunhos.filter(r => r.etapa === '3ª').length;
  return `
    <p class="eyebrow">Utilidades</p>
    <h2 class="page-title">Painel</h2>
    <div class="card">
      <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; border:none;">
        Dados da Diocese
        <span><button type="button" class="icon-btn" id="painelDiocesePdf">⭳ PDF</button> <button type="button" class="icon-btn" id="painelDioceseEdit">✎ Editar</button></span>
      </div>
      <div class="grid">
        <div class="field"><label>Diocese</label><input type="text" value="${dio.nome || ''}" readonly></div>
        <div class="field"><label>Bispo</label><input type="text" value="${dio.bispo || ''}" readonly></div>
        <div class="field full"><label>Endereço</label><input type="text" value="${dio.endereco || ''}" readonly></div>
        <div class="field"><label>Cidade</label><input type="text" value="${dio.cidade || ''}" readonly></div>
        <div class="field"><label>Estado</label><input type="text" value="${dio.estado || ''}" readonly></div>
        <div class="field"><label>Telefone</label><input type="text" value="${dio.telefone || ''}" readonly></div>
        <div class="field"><label>E-mail</label><input type="text" value="${dio.email || ''}" readonly></div>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; border:none;">
        Dados da Paróquia
        <span><button type="button" class="icon-btn" id="painelParoquiaPdf">⭳ PDF</button> <button type="button" class="icon-btn" id="painelParoquiaEdit">✎ Editar</button></span>
      </div>
      <div class="grid">
        <div class="field"><label>Paróquia</label><input type="text" value="${par.nome || ''}" readonly></div>
        <div class="field"><label>Diocese</label><input type="text" value="${par.diocese || ''}" readonly></div>
        <div class="field full"><label>Endereço</label><input type="text" value="${par.endereco || ''}" readonly></div>
        <div class="field"><label>Cidade</label><input type="text" value="${par.cidade || ''}" readonly></div>
        <div class="field"><label>Estado</label><input type="text" value="${par.estado || ''}" readonly></div>
        <div class="field"><label>Pároco</label><input type="text" value="${par.paroco || ''}" readonly></div>
        <div class="field"><label>Telefone</label><input type="text" value="${par.telefone || ''}" readonly></div>
        <div class="field"><label>E-mail</label><input type="text" value="${par.email || ''}" readonly></div>
      </div>
    </div>
    ${statCard('Participações (Vivência) nos Encontros', [['1ª Etapa', vivenc1], ['2ª Etapa', vivenc2], ['3ª Etapa', vivenc3]])}
    ${statCard('Participações em Equipes de Trabalho', [['1ª Etapa', eq1], ['2ª Etapa', eq2], ['3ª Etapa', eq3]])}
    ${statCard('Palestras Proferidas', [['2ª Etapa', pal2], ['3ª Etapa', pal3]])}
    ${statCard('Testemunhos', [['2ª Etapa', test2], ['3ª Etapa', test3]])}
  `;
}
async function openPainelEdit(tipo) {
  painelEditType = tipo;
  const lista = await api(`/${tipo}`);
  const r = lista[0] || {};
  document.getElementById('painelEditTitle').textContent = tipo === 'diocese' ? 'Editar Dados da Diocese' : 'Editar Dados da Paróquia';
  document.getElementById('painelEditBody').innerHTML = tipo === 'diocese' ? `
      <input type="hidden" id="peId" value="${r.id || ''}">
      <div class="grid">
        <div class="field full"><label>Diocese</label><input id="peNome" type="text" value="${r.nome || ''}"></div>
        <div class="field"><label>Bispo</label><input id="peBispo" type="text" value="${r.bispo || ''}"></div>
        <div class="field full"><label>Endereço</label><input id="peEndereco" type="text" value="${r.endereco || ''}"></div>
        <div class="field"><label>Cidade</label><input id="peCidade" type="text" value="${r.cidade || ''}"></div>
        <div class="field"><label>Estado</label><input id="peEstado" type="text" value="${r.estado || ''}"></div>
        <div class="field"><label>Telefone</label><input id="peTelefone" type="text" value="${r.telefone || ''}"></div>
        <div class="field"><label>E-mail</label><input id="peEmail" type="text" value="${r.email || ''}"></div>
      </div>` : `
      <input type="hidden" id="peId" value="${r.id || ''}">
      <div class="grid">
        <div class="field full"><label>Paróquia</label><input id="peNome" type="text" value="${r.nome || ''}"></div>
        <div class="field full"><label>Endereço</label><input id="peEndereco" type="text" value="${r.endereco || ''}"></div>
        <div class="field"><label>Cidade</label><input id="peCidade" type="text" value="${r.cidade || ''}"></div>
        <div class="field"><label>Estado</label><input id="peEstado" type="text" value="${r.estado || ''}"></div>
        <div class="field"><label>Pároco</label><input id="pePadre" type="text" value="${r.paroco || ''}"></div>
        <div class="field"><label>Telefone</label><input id="peTelefone" type="text" value="${r.telefone || ''}"></div>
        <div class="field"><label>E-mail</label><input id="peEmail" type="text" value="${r.email || ''}"></div>
      </div>`;
  document.getElementById('painelEditOverlay').classList.add('open');
}
document.getElementById('painelEditCancel').addEventListener('click', () => { document.getElementById('painelEditOverlay').classList.remove('open'); });
document.getElementById('painelEditSalvar').addEventListener('click', async () => {
  try {
    const id = val('peId');
    const dados = { nome: val('peNome'), endereco: val('peEndereco'), cidade: val('peCidade'), estado: val('peEstado'), telefone: val('peTelefone'), email: val('peEmail') };
    if (painelEditType === 'diocese') dados.bispo = val('peBispo'); else { dados.paroco = val('pePadre'); dados.diocese = currentUser.diocese; }
    if (id) await api(`/${painelEditType}/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
    else await api(`/${painelEditType}`, { method: 'POST', body: JSON.stringify(dados) });
    document.getElementById('painelEditOverlay').classList.remove('open');
    await renderMain();
    showToast('Dados atualizados.');
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  }
});
function bindPainelEvents() {
  document.getElementById('painelDioceseEdit').addEventListener('click', () => openPainelEdit('diocese'));
  document.getElementById('painelParoquiaEdit').addEventListener('click', () => openPainelEdit('paroquia'));
  document.getElementById('painelDiocesePdf').addEventListener('click', async () => {
    const d = (await api('/diocese'))[0] || {};
    gerarPdfLista('Dados da Diocese', [['nome','Diocese'],['bispo','Bispo'],['endereco','Endereço'],['cidade','Cidade'],['estado','Estado'],['telefone','Telefone'],['email','E-mail']], [d]);
  });
  document.getElementById('painelParoquiaPdf').addEventListener('click', async () => {
    const p = (await api('/paroquia'))[0] || {};
    gerarPdfLista('Dados da Paróquia', [['nome','Paróquia'],['diocese','Diocese'],['endereco','Endereço'],['cidade','Cidade'],['estado','Estado'],['paroco','Padre'],['telefone','Telefone'],['email','E-mail']], [p]);
  });
}

async function renderUtilPage() {
  if (activeItem === 'recibo') return renderRecibo();
  if (activeItem === 'agenda') return renderAgenda();
  if (activeItem === 'caixa') return renderCaixa();
  if (activeItem === 'subsidios') return renderSubsidios();
  if (activeItem === 'painel') return renderPainel();
}
function bindUtilEvents() {
  if (activeItem === 'recibo') bindReciboEvents();
  else if (activeItem === 'agenda') bindAgendaEvents();
  else if (activeItem === 'caixa') bindCaixaEvents();
  else if (activeItem === 'subsidios') bindSubsidiosEvents();
  else if (activeItem === 'painel') bindPainelEvents();
}

function bindHabilidadesEvents() {
  const st = searchState.funcHabilidades;
  const input = document.getElementById('habInput');
  if (input) input.addEventListener('input', async () => {
    st.term = input.value;
    st.page = 1;
    const pos = input.selectionStart;
    document.getElementById('main').innerHTML = `<div class="page-wrap">${await renderFuncHabilidades()}</div>`;
    bindFuncEvents();
    const el = document.getElementById('habInput');
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  });
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.page === 'prev') st.page = Math.max(1, st.page - 1);
      if (btn.dataset.page === 'next') st.page = st.page + 1;
      renderMain();
    });
  });
  const btnPdf = document.getElementById('btnPdf');
  if (btnPdf) btnPdf.addEventListener('click', () => {
    const data = LAST_RESULTS.funcHabilidades;
    if (data) gerarPdfLista(data.title, data.cols, data.rows);
  });
}

function bindMontagemEvents() {
  const sel = document.getElementById('montEquipe');
  if (sel) sel.addEventListener('change', () => { montagemState.equipe = sel.value; renderMain(); });

  document.querySelectorAll('[data-montadd]').forEach(el => {
    el.addEventListener('click', async () => {
      const funcoes = await api('/funcoes');
      const rightSource = funcoes.filter(f => f.etapa === '1ª' && (!montagemState.equipe || f.equipe === montagemState.equipe));
      const item = rightSource[Number(el.dataset.montadd)];
      if (item) montagemState.left.push({ ...item });
      renderMain();
      showToast('Item adicionado à coluna esquerda.');
    });
  });
  document.querySelectorAll('[data-montremove]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      montagemState.left.splice(Number(btn.dataset.montremove), 1);
      renderMain();
    });
  });
  const btnPdfM = document.getElementById('btnPdfMontagem');
  if (btnPdfM) btnPdfM.addEventListener('click', () => {
    const data = LAST_RESULTS.funcMontagemLeft;
    if (data) gerarPdfLista(data.title, data.cols, data.rows);
  });
}

function bindFuncEvents() {
  if (activeItem === 'funcHabilidades') { bindHabilidadesEvents(); return; }
  if (activeItem === 'funcMontagem') { bindMontagemEvents(); return; }
  bindBuscaEvents(); // Equipes / Dirigentes / Palestras / Testemunhos seguem o mesmo padrão de filtro+paginação+PDF+editpopup
}

/* ---------- tabela de listagem + ações ---------- */
function renderTable(cols, rows, tabela) {
  let html = `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th>Ações</th></tr></thead><tbody>`;
  if (rows.length === 0) {
    html += `<tr class="empty-row"><td colspan="${cols.length + 1}">Nenhum registro cadastrado ainda.</td></tr>`;
  } else {
    rows.forEach(r => {
      const pdfBtn = tabela === 'casais' ? `<button type="button" class="icon-btn" data-pdfrow="${r.id}" title="Gerar PDF do casal">⭳ PDF</button>` : '';
      html += '<tr>' + cols.map(c => `<td>${r[c[0]] ?? '—'}</td>`).join('') +
        `<td>
          <button type="button" class="icon-btn" data-editrow="${r.id}" data-tabela="${tabela}">✎ Editar</button>
          ${pdfBtn}
          <button type="button" class="icon-btn" data-delrow="${r.id}" data-tabela="${tabela}">🗑</button>
        </td></tr>`;
    });
  }
  html += `</tbody></table></div>`;
  return html;
}

/* ---------- eventos da tela principal ---------- */
function bindMainEvents() {
  const form = document.getElementById('mainForm');
  if (form) {
    form.querySelectorAll('[data-togglegroup]').forEach(group => {
      group.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          syncFormValues();
          formState[group.dataset.togglegroup] = b.dataset.toggleval;
          renderMain();
        });
      });
    });
    form.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('change', () => {
        syncFormValues();
        if (['apelido_ele', 'etapa'].includes(el.name)) renderMain();
        if (el.name === 'casamento_data') {
          const casadosEl = form.querySelector('input[name=casados_a]');
          if (casadosEl) casadosEl.value = calcAnosCasados(el.value);
        }
        if (el.name === 'cep') tryFetchCep(el.value);
      });
    });
    document.getElementById('btnSave').addEventListener('click', () => {
      syncFormValues();
      // Bloqueia o salvamento se algum campo obrigatório (marcado com *)
      // estiver vazio — mostra o aviso nativo do navegador no campo em questão.
      if (!form.reportValidity()) {
        showToast('Preencha os campos obrigatórios (marcados com *) antes de salvar.');
        return;
      }
      pendingSave = { tabela: form.dataset.tabela, data: { ...formState } };
      document.getElementById('modalOverlay').classList.add('open');
    });
    const btnClear = document.getElementById('btnClear');
    if (btnClear) btnClear.addEventListener('click', () => {
      const estavaEditando = !!editingId;
      formState = {};
      editingId = null;
      if (editReturnItem) {
        activeItem = editReturnItem;
        expandedModule = 'buscas';
        editReturnItem = null;
        fullRender();
      } else {
        renderMain();
      }
      showToast(estavaEditando ? 'Edição cancelada.' : 'Formulário limpo.');
    });
  }
  document.querySelectorAll('[data-editrow]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabela = btn.dataset.tabela;
      const registro = await api(`/${tabela}/${btn.dataset.editrow}`);
      editingId = registro.id;
      formState = { ...registro };
      renderMain();
      showToast('Editando registro selecionado.');
    });
  });
  document.querySelectorAll('[data-delrow]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingDelete = { tabela: btn.dataset.tabela, id: btn.dataset.delrow };
      document.getElementById('confirmDeleteOverlay').classList.add('open');
    });
  });
  document.querySelectorAll('[data-pdfrow]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const casal = await api(`/casais/${btn.dataset.pdfrow}`);
        gerarPdfCasal(casal);
      } catch (err) {
        showToast('Erro ao gerar PDF: ' + err.message);
      }
    });
  });
}

/* ---------- PDF completo de um casal (Dados Pessoais + Endereço + Vivência) ---------- */
function gerarPdfCasal(c) {
  const linha = (label, valor) => `<tr><td class="lbl">${label}</td><td>${valor || '—'}</td></tr>`;
  const hoje = new Date().toLocaleString('pt-BR');

  const dadosPessoais = `
    <table class="ficha">
      ${linha('Diocese', c.diocese)}
      ${linha('Cidade Sede', c.cidade_sede)}
      ${linha('Paróquia', c.paroquia)}
      ${linha('Nome do Esposo', c.nome_esposo)}
      ${linha('Apelido do Esposo', c.apelido_esposo)}
      ${linha('Data de Nascimento (Esposo)', c.nasc_esposo)}
      ${linha('Celular (Esposo)', c.celular_esposo)}
      ${linha('Profissão (Esposo)', c.profissao_esposo)}
      ${linha('E-mail (Esposo)', c.email_esposo)}
      ${linha('Nome da Esposa', c.nome_esposa)}
      ${linha('Apelido da Esposa', c.apelido_esposa)}
      ${linha('Data de Nascimento (Esposa)', c.nasc_esposa)}
      ${linha('Celular (Esposa)', c.celular_esposa)}
      ${linha('Profissão (Esposa)', c.profissao_esposa)}
      ${linha('E-mail (Esposa)', c.email_esposa)}
      ${linha('Telefone de Contato Próximo', c.tel_proximo)}
      ${linha('Aniversário de Casamento', c.casamento_data)}
      ${linha('Casados a', c.casados_a != null ? c.casados_a : calcAnosCasados(c.casamento_data))}
      ${linha('Situação', c.situacao)}
      ${linha('Habilidades', c.habilidade)}
    </table>`;

  const endereco = `
    <table class="ficha">
      ${linha('CEP', c.cep)}
      ${linha('Endereço Residencial', c.endereco_residencial)}
      ${linha('Bairro', c.bairro)}
      ${linha('Cidade', c.cidade)}
      ${linha('Estado', c.estado)}
    </table>`;

  const bloco = (n, etapaLabel) => `
    <h3>${etapaLabel} Etapa</h3>
    <table class="ficha">
      ${linha('Encontro (nº)', c['encontro' + n])}
      ${linha('Data', c['data' + n])}
      ${linha('Local', c['local' + n])}
      ${linha('Cor do Círculo', c['circulo' + n])}
      ${linha('Coordenadores', c['coordenadores' + n])}
    </table>`;

  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Ficha do Casal — ${c.apelido_esposo || ''} & ${c.apelido_esposa || ''}</title>
    <style>
      body{ font-family: Arial, sans-serif; padding:34px; color:#241E2C; }
      h1{ font-size:19px; margin:0 0 2px 0; }
      h2{ font-size:15px; margin:26px 0 8px 0; border-bottom:2px solid #6E2142; padding-bottom:4px; color:#6E2142; }
      h3{ font-size:12.5px; margin:14px 0 4px 0; color:#1F6F63; text-transform:uppercase; letter-spacing:0.5px; }
      p.sub{ font-size:11px; color:#666; margin:0 0 6px 0; }
      table.ficha{ width:100%; border-collapse:collapse; font-size:12.5px; margin-bottom:6px; }
      table.ficha td{ border:1px solid #ddd; padding:6px 9px; }
      table.ficha td.lbl{ background:#F6F1E6; font-weight:600; width:230px; }
    </style></head><body>
    <h1>Ficha do Casal — ${c.apelido_esposo || '—'} &amp; ${c.apelido_esposa || '—'}</h1>
    <p class="sub">Gerado em ${hoje}</p>
    <h2>Dados Pessoais</h2>
    ${dadosPessoais}
    <h2>Endereço</h2>
    ${endereco}
    <h2>Vivência</h2>
    ${bloco(1, '1ª')}
    ${bloco(2, '2ª')}
    ${bloco(3, '3ª')}
    </body></html>`);
  win.document.close();
  win.print();
}

function syncFormValues() {
  const form = document.getElementById('mainForm');
  if (!form) return;
  form.querySelectorAll('input, select').forEach(el => { formState[el.name] = el.value; });
}

async function tryFetchCep(cep) {
  const clean = (cep || '').replace(/\D/g, '');
  if (clean.length !== 8) return;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    const data = await res.json();
    if (!data.erro) {
      formState.endereco_residencial = data.logradouro || formState.endereco_residencial;
      formState.bairro = data.bairro || formState.bairro;
      formState.cidade = data.localidade || formState.cidade;
      formState.estado = data.uf || formState.estado;
      renderMain();
      showToast('Endereço preenchido automaticamente pelo CEP.');
    }
  } catch (e) { /* silencioso */ }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- modais globais ---------- */
document.getElementById('modalCancel').addEventListener('click', () => {
  pendingSave = null;
  document.getElementById('modalOverlay').classList.remove('open');
});
document.getElementById('modalConfirm').addEventListener('click', async () => {
  if (pendingSave) {
    try {
      const { tabela, data } = pendingSave;
      delete data.casados_a; // campo derivado, nunca enviado ao servidor
      if (editingId) {
        await api(`/${tabela}/${editingId}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Alterações salvas com sucesso.');
      } else {
        await api(`/${tabela}`, { method: 'POST', body: JSON.stringify(data) });
        showToast('Registro salvo com sucesso.');
      }
      if (tabela === 'diocese' || tabela === 'paroquia') await atualizarDiocesePar();
      formState = {};
      editingId = null;
      if (editReturnItem) {
        activeItem = editReturnItem;
        expandedModule = 'buscas';
        editReturnItem = null;
        await fullRender();
      } else {
        await renderMain();
      }
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message);
    }
  }
  pendingSave = null;
  document.getElementById('modalOverlay').classList.remove('open');
});

document.getElementById('deleteCancel').addEventListener('click', () => {
  pendingDelete = null;
  document.getElementById('confirmDeleteOverlay').classList.remove('open');
});
document.getElementById('deleteConfirm').addEventListener('click', async () => {
  if (pendingDelete) {
    try {
      await api(`/${pendingDelete.tabela}/${pendingDelete.id}`, { method: 'DELETE' });
      showToast('Registro excluído.');
      await renderMain();
    } catch (err) {
      showToast('Erro ao excluir: ' + err.message);
    }
  }
  pendingDelete = null;
  document.getElementById('confirmDeleteOverlay').classList.remove('open');
});

/* ---------- ESC fecha qualquer pop-up aberto ----------
   Reaproveita o botão "Cancelar/Fechar" de cada modal (quando existe), para
   manter o mesmo comportamento e estado de quem clicaria nele manualmente. */
const ESC_OVERLAYS = [
  { overlay: 'modalOverlay', cancel: 'modalCancel' },
  { overlay: 'confirmDeleteOverlay', cancel: 'deleteCancel' },
  { overlay: 'funcPopupOverlay', cancel: 'funcPopupCancel' },
  { overlay: 'caixaPopupOverlay', cancel: 'caixaPopupFechar' },
  { overlay: 'painelEditOverlay', cancel: 'painelEditCancel' },
  { overlay: 'agendaPopupOverlay', cancel: null, onClose: () => { agendaState.editing = null; agendaState.view = 'list'; } }
];
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  ESC_OVERLAYS.forEach(({ overlay, cancel, onClose }) => {
    const ov = document.getElementById(overlay);
    if (!ov || !ov.classList.contains('open')) return;
    const cancelBtn = cancel && document.getElementById(cancel);
    if (cancelBtn) { cancelBtn.click(); return; }
    if (onClose) onClose();
    ov.classList.remove('open');
  });
});

