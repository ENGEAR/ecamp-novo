/**
 * agenda.js — Agenda do SGP dentro do e-CAMP (mesma base de dados)
 *
 * Lê e grava DIRETO nas tabelas da agenda do SGP (Supabase), com a conta da
 * pessoa logada. As permissões são as MESMAS do SGP, aplicadas pelo próprio
 * banco (RLS):
 *  - ver: qualquer pessoa logada;
 *  - criar/editar: admin ou papéis agenda/comercial/operacional;
 *  - excluir: só admin;
 *  - marcar férias: admin ou quem tem "pode marcar férias" na tela de Usuários.
 *
 * Regras espelhadas do SGP:
 *  - tipos: serviço / deslocamento / férias; status: prog/exec/agua/canc/reag;
 *  - férias sempre no topo do dia;
 *  - conflito: mesmo técnico em 2+ serviços (não cancelados) no mesmo dia;
 *  - bloqueio: férias × campo do mesmo técnico no mesmo dia (não deixa salvar);
 *  - novo agendamento cria uma linha por dia (data de início → término);
 *  - editar altera SÓ o dia aberto e marca manual=true;
 *  - excluir (admin): só o dia ou todos da OS; dias de proposta apagados são
 *    registrados como "dispensados" para o SGP não recolocá-los sozinho.
 *
 * Offline: mostra a última agenda carregada (aviso no topo); salvar exige internet.
 *
 * Expõe EC.agenda = { abrir }
 */
(function () {
  'use strict';

  var CHAVE_CACHE = 'agenda:cache';
  var CHAVE_MEU_TEC = 'agenda:meuTecnico';
  var CHAVE_LEMBRETES_CACHE = 'agenda:lembretes:cache';
  var CHAVE_VISTOS = 'agenda:lembretes:vistos';
  var lembretesAtivos = []; // último cálculo, p/ marcar "Ciente" e abrir o 🔔 sem refazer a consulta

  var STATUS = {
    prog: { label: 'Programado', cor: '#1976d2', fundo: 'rgba(25,118,210,0.10)' },
    exec: { label: 'Executado', cor: '#16a34a', fundo: 'rgba(22,163,74,0.10)' },
    agua: { label: 'Aguardando confirmação', cor: '#d97706', fundo: 'rgba(217,119,6,0.12)' },
    canc: { label: 'Cancelado', cor: '#c0392b', fundo: 'rgba(192,57,43,0.10)' },
    reag: { label: 'Reagendamento pendente', cor: '#8b97a8', fundo: 'rgba(139,151,168,0.14)' }
  };
  var FERIAS_COR = '#6d28d9', FERIAS_FUNDO = '#ede9fe';
  var DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  var UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseISO(s) { var p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function isoParaBR(s) { if (!s) return ''; var p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function dataLonga(s) { var d = parseISO(s); return DOW[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); }
  // Data curta "30 dez 2026" (dia + mês em 3 letras + ano) — cabe no campo e
  // evita o formato longo do seletor nativo do celular ("30 de dez. de 2026").
  function dataCurtaBR(s) {
    if (!s) return '—';
    var p = s.split('-');
    return Number(p[2]) + ' ' + MESES[Number(p[1]) - 1].slice(0, 3).toLowerCase() + ' ' + p[0];
  }
  // Exibição: primeiro e último nome ("Robson Luiz Pimenta" → "Robson Pimenta").
  function nomeCurto(n) { var p = String(n || '').trim().split(/\s+/); return p.length <= 1 ? n : p[0] + ' ' + p[p.length - 1]; }
  function faixaDias(ini, fim) {
    if (!ini) return [];
    if (!fim || fim < ini) return [ini];
    var out = [], d = parseISO(ini), end = parseISO(fim), guarda = 0;
    while (d <= end && guarda < 400) { out.push(iso(d)); d.setDate(d.getDate() + 1); guarda++; }
    return out;
  }

  /* ============ Estado ============ */
  var ref = new Date();          // mês/semana exibidos
  var visao = 'lista';           // 'mes' | 'semana' | 'lista'
  var diaSel = null;             // dia tocado na grade do mês (ISO)
  var eventos = [];              // todos os agendamentos carregados
  var catTecnicos = [];          // catálogo de técnicos ativos
  var oss = [];                  // ordens de serviço (p/ vincular e p/ o alerta)
  var ocultas = [];              // OS dispensadas do alerta (agenda_os_ocultas)
  var perms = null;              // { podeEditar, souAdmin, podeFerias }
  var offline = false;           // mostrando cache?
  var carregando = false;

  function sb() { return EC.auth && EC.auth.cliente ? EC.auth.cliente() : null; }

  /* ============ Permissões (mesmas do SGP, lidas do banco) ============ */
  async function carregarPermissoes() {
    var cli = sb();
    var vazio = { podeEditar: false, souAdmin: false, podeFerias: false };
    if (!cli) return vazio;
    try {
      var s = await cli.auth.getSession();
      var user = s && s.data && s.data.session ? s.data.session.user : null;
      if (!user) return vazio;
      var codigos = [];
      try {
        var q = await cli.from('usuario_papeis').select('papel:papel_id(codigo)').eq('usuario_id', user.id);
        (q.data || []).forEach(function (r) { if (r.papel && r.papel.codigo) codigos.push(r.papel.codigo); });
      } catch (e) { /* sem papéis */ }
      var souAdmin = codigos.indexOf('admin') !== -1;
      var podeEditar = souAdmin || ['agenda', 'comercial', 'operacional', 'logistica'].some(function (c) { return codigos.indexOf(c) !== -1; });
      var podeFerias = souAdmin;
      if (!podeFerias) {
        try {
          var m = await cli.from('usuarios').select('pode_marcar_ferias').eq('id', user.id).single();
          podeFerias = !!(m.data && m.data.pode_marcar_ferias);
        } catch (e) { /* mantém false */ }
      }
      return { podeEditar: podeEditar, souAdmin: souAdmin, podeFerias: podeFerias };
    } catch (e) { return vazio; }
  }

  // Número da OS: da OS vinculada; senão, do codigo_origem da proposta (número
  // real, ex.: 26249). Só cai no ano+seq se não houver codigo_origem.
  // (mesma lógica em toda a Agenda — usada aqui e no lembrete, p/ não divergir)
  function resolverNumeroOS(ordemServico, proposta) {
    if (ordemServico && ordemServico.numero) return ordemServico.numero;
    if (proposta && proposta.codigo_origem) return 'OS ' + String(proposta.codigo_origem).split('_')[1];
    if (proposta && proposta.ano != null && proposta.seq != null) return 'OS ' + proposta.ano + String(proposta.seq).padStart(3, '0');
    return null;
  }

  /* ============ Carga dos dados (mesma consulta do SGP) ============ */
  async function carregarDados() {
    var cli = sb();
    if (!cli) throw new Error('sem cliente');
    var q = await cli.from('agendamentos')
      .select('id, proposta_id, ordem_servico_id, manual, empresa, cidade, uf, servico, projeto, data, status, observacoes, campanha_numero, tipo, tecnicos, proposta:proposta_id(ano, seq, codigo_origem), ordem_servico:ordem_servico_id(numero)')
      .order('data');
    if (q.error) throw new Error(q.error.message);
    eventos = (q.data || []).map(function (a) {
      var os = resolverNumeroOS(a.ordem_servico, a.proposta);
      return {
        id: a.id, proposta_id: a.proposta_id || null, ordem_servico_id: a.ordem_servico_id || null,
        os: os, empresa: a.empresa || '—', cidade: a.cidade || '', uf: a.uf || '',
        servico: a.servico || '', projeto: a.projeto || null, data: a.data,
        status: a.status || 'prog', observacoes: a.observacoes || '',
        campanha_numero: a.campanha_numero || null, tipo: a.tipo || 'servico',
        tecnicos: a.tecnicos || [], manual: !!a.manual
      };
    });
    try {
      var t = await cli.from('tecnicos').select('id, nome, vinculo, ativo').order('nome');
      catTecnicos = (t.data || []).filter(function (x) { return x.ativo; }).map(function (x) {
        return { id: x.id, nome: x.nome, vinculo: x.vinculo || 'CLT', tipo: String(x.vinculo || 'clt').toLowerCase().indexOf('free') !== -1 ? 'freelancer' : 'clt' };
      });
    } catch (e) { catTecnicos = []; }
    // OS (mesma consulta do SGP): para vincular no agendamento e para o alerta.
    try {
      var o = await cli.from('ordens_servico')
        .select('id, numero, proposta_id, cliente_nome, municipio, uf, servico, detalhes')
        .order('numero', { ascending: false });
      // Quais OS contam como "aceitas" — via função no banco (os_aceitas), porque
      // ler propostas exige acesso comercial e quem só tem o papel 'agenda'
      // (ex.: operacional/logística) ficava sem o alerta "OS sem agendamento".
      var idsAceitas = {};
      try {
        var acc = await cli.rpc('os_aceitas');
        (acc.data || []).forEach(function (r) { idsAceitas[r.id] = true; });
      } catch (e) { /* sem a função, nada é considerado aceito */ }
      oss = (o.data || []).map(function (x) {
        var det = x.detalhes || {};
        return {
          id: x.id, numero: x.numero, proposta_id: x.proposta_id || null,
          empresa: x.cliente_nome || '', cidade: x.municipio || '', uf: x.uf || '',
          servico: x.servico || '', projeto: det.projeto || null,
          nCampanhas: Number(det.nCampanhas) || 1,
          // Só OS de proposta ACEITA (ou sem proposta vinculada) contam como pendência.
          aceita: !!idsAceitas[x.id]
        };
      });
    } catch (e) { oss = []; }
    try {
      var oc = await cli.from('agenda_os_ocultas').select('ordem_servico_id');
      ocultas = (oc.data || []).map(function (r) { return r.ordem_servico_id; });
    } catch (e) { ocultas = []; }
    EC.storage.salvar(CHAVE_CACHE, { em: new Date().toISOString(), eventos: eventos, catTecnicos: catTecnicos, oss: oss, ocultas: ocultas });
  }

  /* ============ Regras espelhadas ============ */
  // Conflito: técnico em 2+ eventos não cancelados no mesmo dia → { dia: [nomes] }
  function calcularConflitos(lista) {
    var porDiaTec = {};
    lista.forEach(function (e) {
      if (e.status === 'canc') return;
      (e.tecnicos || []).forEach(function (t) {
        porDiaTec[e.data] = porDiaTec[e.data] || {};
        porDiaTec[e.data][t.nome] = (porDiaTec[e.data][t.nome] || 0) + 1;
      });
    });
    var conf = {};
    Object.keys(porDiaTec).forEach(function (dia) {
      Object.keys(porDiaTec[dia]).forEach(function (nome) {
        if (porDiaTec[dia][nome] > 1) { conf[dia] = conf[dia] || []; conf[dia].push(nome); }
      });
    });
    return conf;
  }

  // Campanhas de cada proposta que JÁ estão na agenda (para avisar duplicidade).
  function campanhasNaAgenda() {
    var m = {};
    eventos.forEach(function (e) {
      if (e.proposta_id && e.campanha_numero) {
        m[e.proposta_id] = m[e.proposta_id] || [];
        if (m[e.proposta_id].indexOf(e.campanha_numero) === -1) m[e.proposta_id].push(e.campanha_numero);
      }
    });
    return m;
  }

  // Pendência: OS (de proposta ACEITA) que ainda não têm NENHUM dia na agenda.
  function osSemAgenda() {
    return oss.filter(function (o) {
      return o.aceita && ocultas.indexOf(o.id) === -1 &&
        !eventos.some(function (e) { return e.ordem_servico_id === o.id || (o.proposta_id && e.proposta_id === o.proposta_id); });
    });
  }

  // Bloqueio (ao salvar): férias × campo do mesmo técnico no mesmo dia.
  function checarBloqueio(ev, dias) {
    var nomes = (ev.tecnicos || []).map(function (t) { return t.nome; });
    if (!nomes.length || !dias.length) return null;
    var relev = eventos.filter(function (x) { return x.id !== ev.id && x.status !== 'canc' && dias.indexOf(x.data) !== -1; });
    var i, x, c;
    if (ev.tipo === 'ferias') {
      for (i = 0; i < relev.length; i++) {
        x = relev[i];
        if (x.tipo === 'ferias') continue;
        c = (x.tecnicos || []).filter(function (t) { return nomes.indexOf(t.nome) !== -1; }).map(function (t) { return nomeCurto(t.nome); });
        if (c.length) return c.join(', ') + ' já tem agendamento de campo em ' + isoParaBR(x.data) + (x.empresa ? ' (' + x.empresa + ')' : '') + '. Libere o dia do funcionário antes de marcar as férias.';
      }
    } else {
      for (i = 0; i < relev.length; i++) {
        x = relev[i];
        if (x.tipo !== 'ferias') continue;
        c = (x.tecnicos || []).filter(function (t) { return nomes.indexOf(t.nome) !== -1; }).map(function (t) { return nomeCurto(t.nome); });
        if (c.length) return c.join(', ') + ' está de férias em ' + isoParaBR(x.data) + '. Não é possível agendar — ajuste as férias antes.';
      }
    }
    return null;
  }

  /* ============ Render da lista ============ */
  function eventosFiltrados() {
    var busca = ($('agd-busca').value || '').trim().toLowerCase();
    var fStatus = $('agd-f-status').value;
    var fTec = $('agd-f-tec').value;
    return eventos.filter(function (e) {
      if (fStatus && e.status !== fStatus) return false;
      if (fTec && !(e.tecnicos || []).some(function (t) { return t.nome === fTec; })) return false;
      if (busca) {
        var alvo = (e.empresa + ' ' + e.cidade + ' ' + e.servico + ' ' + (e.os || '') + ' ' + (e.projeto || '')).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function inicioSemana(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; }

  // agrupa por dia; férias sempre no topo (sort estável)
  function agruparPorDia(lista) {
    var porDia = {};
    lista.forEach(function (e) { (porDia[e.data] = porDia[e.data] || []).push(e); });
    Object.keys(porDia).forEach(function (d) {
      porDia[d].sort(function (a, b) { return (a.tipo === 'ferias' ? 0 : 1) - (b.tipo === 'ferias' ? 0 : 1); });
    });
    return porDia;
  }

  function cartaoEvento(e, conflitos) {
    var st = STATUS[e.status] || STATUS.prog;
    var ferias = e.tipo === 'ferias';
    var conf = !!conflitos[e.data] && (e.tecnicos || []).some(function (t) { return conflitos[e.data].indexOf(t.nome) !== -1; });
    var tecsTxt = (e.tecnicos || []).map(function (t) { return nomeCurto(t.nome); }).join(', ');
    var sub = ferias ? (tecsTxt || '—')
      : [e.cidade, e.tipo === 'deslocamento' ? '🚗 Deslocamento' : e.servico].filter(Boolean).join(' · ') + (tecsTxt ? ' · ' + tecsTxt : '');
    return '<div class="ecagd-evt' + (conf ? ' conflito' : '') + '" data-id="' + esc(e.id) + '" style="border-left-color:' + (ferias ? FERIAS_COR : st.cor) + '">' +
      '<div class="ecagd-evt-linha1">' +
        '<span class="ecagd-evt-emp">' + (ferias ? '🏖 Férias' : esc(e.empresa)) + (conf ? ' ⚠' : '') + '</span>' +
        '<span class="ecagd-chip" style="background:' + (ferias ? FERIAS_FUNDO : st.fundo) + ';color:' + (ferias ? FERIAS_COR : st.cor) + '">' + (ferias ? 'Férias' : esc(st.label)) + '</span>' +
      '</div>' +
      ((e.os || e.campanha_numero) ? '<div class="ecagd-evt-os">' + esc(e.os || '') + (e.campanha_numero ? ' · Camp ' + e.campanha_numero : '') + '</div>' : '') +
      (!ferias && e.projeto ? '<div class="ecagd-evt-sub">📁 ' + esc(e.projeto) + '</div>' : '') +
      '<div class="ecagd-evt-sub">' + esc(sub) + '</div>' +
    '</div>';
  }

  function cabecalhoDia(dia, evs, conflitos) {
    var tecsDia = {};
    evs.forEach(function (e) { if (e.status !== 'canc') (e.tecnicos || []).forEach(function (t) { tecsDia[t.nome] = 1; }); });
    var temConf = !!conflitos[dia];
    return '<div class="ecagd-dia' + (temConf ? ' conflito' : '') + '">' +
      '<span>' + esc(dataLonga(dia)) + '</span>' +
      '<span class="ecagd-dia-meta">' + evs.length + ' serviço(s) · ' + Object.keys(tecsDia).length + ' técnico(s)' + (temConf ? ' · ⚠' : '') + '</span></div>';
  }

  // Lista corrida de dias (usada pelas visões Lista e Semana e pela busca)
  function htmlLista(dias, porDia, conflitos, mostrarVazios) {
    var html = '';
    dias.forEach(function (dia) {
      var evs = porDia[dia] || [];
      if (!evs.length && !mostrarVazios) return;
      html += cabecalhoDia(dia, evs, conflitos);
      if (!evs.length) html += '<div class="ecagd-dia-vazio">— sem agendamentos —</div>';
      evs.forEach(function (e) { html += cartaoEvento(e, conflitos); });
    });
    return html;
  }

  // Grade do mês: cada dia com até 3 bolinhas coloridas; tocar mostra o dia abaixo.
  function htmlMes(porDia, conflitos) {
    var y = ref.getFullYear(), mo = ref.getMonth();
    var ini = inicioSemana(new Date(y, mo, 1));
    var hojeISO = iso(new Date());
    var html = '<div class="ecagd-grade">' + DOW.map(function (d) { return '<div class="ecagd-dow">' + d + '</div>'; }).join('');
    var d = new Date(ini);
    for (var i = 0; i < 42; i++) {
      var dIso = iso(d);
      var evs = porDia[dIso] || [];
      var outroMes = d.getMonth() !== mo;
      var cls = 'ecagd-cel' + (outroMes ? ' outro-mes' : '') + (dIso === hojeISO ? ' hoje' : '') +
        (conflitos[dIso] ? ' conflito' : '') + (dIso === diaSel ? ' sel' : '');
      var pontos = evs.slice(0, 3).map(function (e) {
        var cor = e.tipo === 'ferias' ? FERIAS_COR : (STATUS[e.status] || STATUS.prog).cor;
        return '<i style="background:' + cor + '"></i>';
      }).join('');
      html += '<div class="' + cls + '" data-dia="' + dIso + '"><span>' + d.getDate() + '</span>' +
        '<div class="ecagd-pontos">' + pontos + (evs.length > 3 ? '<b>+' + (evs.length - 3) + '</b>' : '') + '</div></div>';
      d.setDate(d.getDate() + 1);
    }
    html += '</div>';
    // detalhe do dia tocado
    if (diaSel) {
      var evsSel = porDia[diaSel] || [];
      html += cabecalhoDia(diaSel, evsSel, conflitos);
      if (!evsSel.length) html += '<div class="ecagd-dia-vazio">— sem agendamentos —</div>';
      evsSel.forEach(function (e) { html += cartaoEvento(e, conflitos); });
    } else {
      html += '<p class="texto-apoio" style="margin-top:10px">Toque num dia para ver os agendamentos dele.</p>';
    }
    return html;
  }

  function render() {
    var y = ref.getFullYear(), mo = ref.getMonth();
    var buscando = !!(($('agd-busca').value || '').trim() || $('agd-f-status').value || $('agd-f-tec').value);

    // botões de visão
    ['mes', 'semana', 'lista'].forEach(function (v) {
      $('agd-v-' + v).classList.toggle('ativo', visao === v);
    });

    // rótulo do período
    if (visao === 'semana' && !buscando) {
      var s = inicioSemana(ref); var f = new Date(s); f.setDate(s.getDate() + 6);
      $('agd-mes').textContent = s.getDate() + ' ' + MESES[s.getMonth()].slice(0, 3) + ' – ' +
        f.getDate() + ' ' + MESES[f.getMonth()].slice(0, 3) + ' ' + f.getFullYear();
    } else {
      $('agd-mes').textContent = buscando ? 'Resultados da busca' : MESES[mo] + ' ' + y;
    }

    var lista = eventosFiltrados();
    var conflitos = calcularConflitos(lista);
    var porDia = agruparPorDia(lista);

    var html;
    if (buscando) {
      // Busca/filtros ativos: mostra TODOS os resultados em lista, de qualquer
      // período (senão a busca parece "não funcionar" — mesmo cuidado do SGP).
      var diasBusca = Object.keys(porDia).sort();
      html = diasBusca.length ? htmlLista(diasBusca, porDia, conflitos, false)
        : '<div class="ecagd-vazio">🗓️<br><strong>Nada encontrado para essa busca.</strong></div>';
    } else if (visao === 'mes') {
      html = htmlMes(porDia, conflitos);
    } else if (visao === 'semana') {
      var diasSemana = [];
      var ds = inicioSemana(ref);
      for (var i = 0; i < 7; i++) { diasSemana.push(iso(ds)); ds.setDate(ds.getDate() + 1); }
      html = htmlLista(diasSemana, porDia, conflitos, true);
    } else {
      var diasMes = Object.keys(porDia).sort().filter(function (dia) {
        var d = parseISO(dia);
        return d.getFullYear() === y && d.getMonth() === mo;
      });
      html = diasMes.length ? htmlLista(diasMes, porDia, conflitos, false)
        : '<div class="ecagd-vazio">🗓️<br><strong>Nenhum agendamento neste mês.</strong></div>';
    }

    // aviso de conflito (sobre os dias visíveis do período atual)
    var nConf = Object.keys(porDia).filter(function (d) { return conflitos[d]; }).length;
    $('agd-conflito-aviso').innerHTML = nConf
      ? '<div class="ecagd-aviso-conflito">⚠ ' + nConf + ' dia(s) com técnico em mais de um serviço. Veja os destaques em vermelho.</div>' : '';

    $('agd-lista').innerHTML = html;

    // clique no evento → abre o modal (edição ou leitura)
    Array.prototype.forEach.call(document.querySelectorAll('#agd-lista .ecagd-evt'), function (el) {
      el.addEventListener('click', function () {
        var ev = eventos.filter(function (e) { return e.id === el.getAttribute('data-id'); })[0];
        if (ev) abrirModal(ev, false);
      });
    });
    // toque num dia da grade do mês → mostra os agendamentos dele
    Array.prototype.forEach.call(document.querySelectorAll('#agd-lista .ecagd-cel'), function (el) {
      el.addEventListener('click', function () {
        diaSel = el.getAttribute('data-dia');
        render();
      });
    });
  }

  function preencherFiltros() {
    var tecs = {};
    eventos.forEach(function (e) { (e.tecnicos || []).forEach(function (t) { tecs[t.nome] = 1; }); });
    var selT = $('agd-f-tec'), atualT = selT.value;
    selT.innerHTML = '<option value="">Técnico: todos</option>' + Object.keys(tecs).sort().map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(nomeCurto(n)) + '</option>';
    }).join('');
    if (atualT) selT.value = atualT;
    var selS = $('agd-f-status');
    if (!selS.options.length || selS.options.length === 1) {
      selS.innerHTML = '<option value="">Status: todos</option>' + Object.keys(STATUS).map(function (k) {
        return '<option value="' + k + '">' + esc(STATUS[k].label) + '</option>';
      }).join('');
    }
  }

  /* ============ Alerta "OS sem agendamento" (espelho do sino do SGP) ============ */
  function atualizarBannerOS() {
    var area = $('agd-os-pend');
    var pend = (perms && perms.podeEditar && !offline) ? osSemAgenda() : [];
    if (!pend.length) { area.classList.add('oculto'); area.innerHTML = ''; return; }
    area.innerHTML = '<button type="button" class="ecagd-os-pend"><span class="ecagd-sino">🔔</span> ' +
      '<b>' + pend.length + ' OS sem agendamento</b>&nbsp;— toque para resolver</button>';
    area.classList.remove('oculto');
    area.querySelector('button').addEventListener('click', abrirModalOSPend);
  }

  function abrirModalOSPend() {
    var pend = osSemAgenda();
    $('agd-modal').innerHTML =
      '<div class="ecagd-m-fundo"></div>' +
      '<div class="ecagd-m-caixa"><div class="cartao">' +
        '<div class="ecagd-m-topo"><h2>🔔 OS sem agendamento</h2><button type="button" id="agdm-fechar" title="Fechar">✕</button></div>' +
        '<p class="texto-apoio">OS de propostas aceitas que ainda não têm nenhum dia na agenda. Agende, ou dispense para o alerta não voltar.</p>' +
        (pend.length ? pend.map(function (o, i) {
          return '<div class="ecagd-ospend">' +
            '<div><b>' + esc(o.numero) + '</b> — ' + esc(o.empresa) +
            (o.projeto ? '<br><small>📁 ' + esc(o.projeto) + '</small>' : '') +
            '<br><small>' + esc([[o.cidade, o.uf].filter(Boolean).join('/'), o.servico].filter(Boolean).join(' · ')) + '</small></div>' +
            '<div class="ecagd-ospend-acoes">' +
              '<button type="button" class="botao botao-primario botao-mini" data-ag="' + i + '">📅 Agendar</button>' +
              '<button type="button" class="botao botao-secundario botao-mini" data-disp="' + i + '">✕ Dispensar</button>' +
            '</div></div>';
        }).join('') : '<p class="texto-apoio">Nenhuma pendência. 🎉</p>') +
        '<div class="pilha-botoes"><button type="button" class="botao botao-secundario" id="agdm-fechar2">Fechar</button></div>' +
      '</div></div>';
    $('agd-modal').classList.remove('oculto');
    document.body.style.overflow = 'hidden';
    $('agdm-fechar').addEventListener('click', fecharModal);
    $('agdm-fechar2').addEventListener('click', fecharModal);
    Array.prototype.forEach.call(document.querySelectorAll('#agd-modal [data-ag]'), function (b) {
      b.addEventListener('click', function () { agendarOS(pend[Number(b.getAttribute('data-ag'))]); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#agd-modal [data-disp]'), function (b) {
      b.addEventListener('click', function () { dispensarOS(pend[Number(b.getAttribute('data-disp'))]); });
    });
  }

  // Abre o "Novo agendamento" já com a OS pendente vinculada (igual ao SGP).
  function agendarOS(o) {
    abrirModal({
      empresa: o.empresa, cidade: o.cidade, uf: o.uf, servico: o.servico, projeto: o.projeto,
      data: iso(new Date()), status: 'prog', observacoes: '', tipo: 'servico', tecnicos: [], manual: true,
      os: o.numero, ordem_servico_id: o.id, proposta_id: o.proposta_id,
      campanha_numero: o.nCampanhas === 1 ? 1 : null
    }, true);
  }

  // Dispensa a OS do alerta (fica registrado no banco; não volta a aparecer).
  async function dispensarOS(o) {
    if (!confirm('Remover a ' + o.numero + ' da lista de pendências? Ela não voltará a aparecer no alerta.')) return;
    try {
      var r = await sb().from('agenda_os_ocultas').insert({ ordem_servico_id: o.id });
      if (r.error) throw new Error(r.error.message);
      EC.app.mostrarToast('OS dispensada do alerta.');
      fecharModal();
      await recarregar();
    } catch (e) {
      alert('Erro ao dispensar: ' + (e.message || e));
    }
  }

  /* ============ Modal (novo / editar / leitura) ============ */
  var mEv = null, mNovo = false, mTecs = [], mDataFim = '', mBuscaOS = '', mAvisoOS = '';

  function abrirModal(ev, novo) {
    mEv = JSON.parse(JSON.stringify(ev)); // cópia — só grava ao salvar
    mNovo = novo;
    mTecs = (ev.tecnicos || []).slice();
    mDataFim = ev.data;
    mBuscaOS = '';
    mAvisoOS = '';
    renderModal();
    $('agd-modal').classList.remove('oculto');
    document.body.style.overflow = 'hidden';
  }
  function fecharModal() {
    $('agd-modal').classList.add('oculto');
    $('agd-modal').innerHTML = '';
    document.body.style.overflow = '';
    mEv = null;
  }

  function renderModal(mensagemErro, confirmandoExclusao) {
    var soLeitura = !perms.podeEditar;
    var st = mEv.status || 'prog';
    var podeFerias = perms.podeFerias || mEv.tipo === 'ferias';
    var titulo = soLeitura ? 'Agendamento' : (mNovo ? 'Novo agendamento' : 'Editar agendamento');
    var temOS = !!(mEv.proposta_id || mEv.ordem_servico_id);
    var osSel = null;
    oss.forEach(function (o) { if (o.id === mEv.ordem_servico_id) osSel = o; });
    var nCamp = osSel ? osSel.nCampanhas : 0;

    // Vínculo com a OS: no novo, busca e escolhe (igual ao SGP); na edição, só informa.
    var osBloco = '';
    if (mNovo && !soLeitura) {
      osBloco = '<label>Ordem de Serviço ' +
        (mEv.os ? '<b class="ecagd-os-ok">· ' + esc(mEv.os) + ' ✓</b>' : '<small>(opcional)</small>') +
        '<input type="text" id="agdm-os-busca" placeholder="Buscar OS pelo número ou cliente…" value="' + esc(mBuscaOS) + '" autocomplete="off"></label>' +
        '<div id="agdm-os-res"></div>' +
        (mEv.ordem_servico_id ? '<button type="button" class="botao botao-secundario botao-mini" id="agdm-os-desv">✕ Desvincular OS</button>' : '') +
        (mAvisoOS ? '<div class="ecagd-os-aviso">' + esc(mAvisoOS) + '</div>' : '');
    }
    var osInfo = (!mNovo && (mEv.os || mEv.campanha_numero))
      ? '<div class="ecagd-m-os">Ordem de Serviço: <b>' + esc(mEv.os || '—') + '</b>' + (mEv.campanha_numero ? ' · Campanha <b>' + mEv.campanha_numero + '</b>' : '') + '</div>' : '';

    // Campanha (quando vinculado a uma OS)
    var campBloco = '';
    if (temOS) {
      if (nCamp >= 1) {
        var campAg = mEv.proposta_id ? (campanhasNaAgenda()[mEv.proposta_id] || []) : [];
        var opts = '<option value="">— escolha a campanha —</option>';
        for (var n = 1; n <= nCamp; n++) {
          opts += '<option value="' + n + '"' + (mEv.campanha_numero === n ? ' selected' : '') + '>Campanha ' + n + (campAg.indexOf(n) !== -1 ? ' — já na agenda' : '') + '</option>';
        }
        campBloco = '<label>Campanha (a OS tem ' + nCamp + ')<select id="agdm-campanha">' + opts + '</select></label>';
      } else {
        campBloco = '<label>Campanha<input type="number" id="agdm-campanha" min="1" inputmode="numeric" placeholder="Nº da campanha" value="' + (mEv.campanha_numero || '') + '"></label>';
      }
    }

    var tecsHtml = catTecnicos.length === 0
      ? '<p class="texto-apoio">Nenhum técnico cadastrado (a lista é gerida no SGP).</p>'
      : '<div class="ecagd-tecs">' + catTecnicos.map(function (c) {
          var on = mTecs.some(function (t) { return t.nome === c.nome; });
          return '<button type="button" class="ecagd-tec' + (on ? ' on' : '') + '" data-nome="' + esc(c.nome) + '" data-tipo="' + esc(c.tipo) + '">' +
            (on ? '✓ ' : '') + esc(nomeCurto(c.nome)) + ' <small>' + esc(c.vinculo || (c.tipo === 'freelancer' ? 'Freelancer' : 'CLT')) + '</small></button>';
        }).join('') + '</div>';

    var statusOpts = Object.keys(STATUS).map(function (k) {
      return '<option value="' + k + '"' + (k === st ? ' selected' : '') + '>' + esc(STATUS[k].label) + '</option>';
    }).join('');
    var ufOpts = '<option value="">—</option>' + UFS.map(function (u) {
      return '<option' + (u === mEv.uf ? ' selected' : '') + '>' + u + '</option>';
    }).join('');

    // Campo de data: o seletor nativo do celular fica por cima (invisível) e a
    // etiqueta mostra a data curta "30 dez 2026" (o formato nativo é longo e corta).
    function campoData(id, valor) {
      return '<div class="ecagd-datebox">' +
        '<span class="ecagd-datebox-lbl" id="' + id + '-lbl">' + esc(dataCurtaBR(valor)) + '</span>' +
        '<input type="date" id="' + id + '" value="' + esc(valor) + '">' +
      '</div>';
    }
    var datas = mNovo
      ? '<div class="grade-2">' +
          '<label>Data de início' + campoData('agdm-data', mEv.data) + '</label>' +
          '<label>Data de término' + campoData('agdm-fim', mDataFim) + '</label>' +
        '</div>' +
        '<p class="texto-apoio">Preencha a <b>data inicial e final</b> de saída e retorno do laboratório, <b>incluindo as datas de deslocamento</b>. Cadastre tudo como <b>Serviço</b> ou <b>Deslocamento</b> e depois <b>edite manualmente</b> os demais dias.</p>'
      : '<label>Data' + campoData('agdm-data', mEv.data) + '</label>';

    var rodape;
    if (soLeitura) {
      rodape = '<div class="pilha-botoes"><button type="button" class="botao botao-primario" id="agdm-fechar2">Fechar</button></div>';
    } else if (confirmandoExclusao) {
      rodape = '<div class="ecagd-m-excluir"><b>Excluir este agendamento?</b><div class="pilha-botoes">' +
        '<button type="button" class="botao botao-secundario" id="agdm-del-um">Excluir só este dia</button>' +
        ((mEv.proposta_id || mEv.ordem_servico_id) ? '<button type="button" class="botao botao-perigo" id="agdm-del-os">Excluir todos da OS' + (mEv.os ? ' (' + esc(mEv.os) + ')' : '') + '</button>' : '') +
        '<button type="button" class="botao botao-secundario" id="agdm-del-nao">Cancelar</button></div></div>';
    } else {
      rodape = '<div class="pilha-botoes">' +
        '<button type="button" class="botao botao-primario" id="agdm-salvar">Salvar</button>' +
        (!mNovo && mEv.id && perms.souAdmin ? '<button type="button" class="botao botao-perigo" id="agdm-excluir">Excluir</button>' : '') +
        '<button type="button" class="botao botao-secundario" id="agdm-cancelar">Cancelar</button></div>';
    }

    $('agd-modal').innerHTML =
      '<div class="ecagd-m-fundo"></div>' +
      '<div class="ecagd-m-caixa"><div class="cartao">' +
        '<div class="ecagd-m-topo"><h2>' + titulo + '</h2><button type="button" id="agdm-fechar" title="Fechar">✕</button></div>' +
        (soLeitura ? '<p class="texto-apoio">👁 Você tem acesso de <b>visualização</b>. Para criar ou editar, fale com o administrador.</p>' : '') +
        osInfo +
        '<fieldset id="agdm-campos"' + (soLeitura ? ' disabled' : '') + '>' +
          osBloco + campBloco +
          '<label>Empresa / Cliente<input type="text" id="agdm-empresa" value="' + esc(mEv.empresa === '—' ? '' : mEv.empresa) + '"></label>' +
          '<div class="grade-2">' +
            '<label>Cidade<input type="text" id="agdm-cidade" value="' + esc(mEv.cidade) + '"></label>' +
            '<label>UF<select id="agdm-uf">' + ufOpts + '</select></label>' +
          '</div>' +
          '<label>Projeto<input type="text" id="agdm-projeto" value="' + esc(mEv.projeto || '') + '"></label>' +
          '<div class="grade-2">' +
            '<label>Serviço<input type="text" id="agdm-servico" value="' + esc(mEv.servico) + '"></label>' +
            '<label>Tipo<select id="agdm-tipo">' +
              '<option value="servico"' + (mEv.tipo === 'servico' ? ' selected' : '') + '>Serviço</option>' +
              '<option value="deslocamento"' + (mEv.tipo === 'deslocamento' ? ' selected' : '') + '>Deslocamento</option>' +
              (podeFerias ? '<option value="ferias"' + (mEv.tipo === 'ferias' ? ' selected' : '') + '>Férias</option>' : '') +
            '</select></label>' +
          '</div>' +
          datas +
          '<label>Status<select id="agdm-status">' + statusOpts + '</select></label>' +
          '<p class="dg-secao">Técnicos' + (mTecs.length ? ' (' + mTecs.length + ' selecionado' + (mTecs.length === 1 ? '' : 's') + ')' : '') + '</p>' +
          tecsHtml +
          '<label>Observações<textarea id="agdm-obs" rows="2">' + esc(mEv.observacoes) + '</textarea></label>' +
        '</fieldset>' +
        (mensagemErro ? '<div class="alerta alerta-vermelho">⚠ ' + esc(mensagemErro) + '</div>' : '') +
        rodape +
      '</div></div>';

    // eventos do modal
    if ($('agdm-os-busca')) {
      $('agdm-os-busca').addEventListener('input', function () {
        mBuscaOS = this.value;
        atualizarResultadosOS();
      });
      atualizarResultadosOS();
    }
    if ($('agdm-os-desv')) {
      $('agdm-os-desv').addEventListener('click', function () {
        colherCampos();
        mEv.os = null; mEv.ordem_servico_id = null; mEv.proposta_id = null; mEv.campanha_numero = null;
        mAvisoOS = '';
        renderModal();
      });
    }
    // Mantém a etiqueta "30 dez 2026" em dia quando o seletor de data muda.
    function sincLabelData(id) {
      var el = $(id), lbl = $(id + '-lbl');
      if (el && lbl) lbl.textContent = dataCurtaBR(el.value);
    }
    if ($('agdm-data')) $('agdm-data').addEventListener('change', function () { sincLabelData('agdm-data'); });
    if ($('agdm-fim')) $('agdm-fim').addEventListener('change', function () { sincLabelData('agdm-fim'); });
    // Data de término acompanha a de início: ao escolher/alterar o início, se o
    // término estiver vazio ou for ANTES do novo início, puxa para o mesmo dia
    // (não sobrescreve um término posterior já definido de propósito).
    if ($('agdm-data') && $('agdm-fim')) {
      $('agdm-data').addEventListener('change', function () {
        var ini = $('agdm-data').value;
        var fim = $('agdm-fim').value;
        if (ini && (!fim || fim < ini)) { $('agdm-fim').value = ini; mDataFim = ini; sincLabelData('agdm-fim'); }
      });
    }
    $('agdm-fechar').addEventListener('click', fecharModal);
    if ($('agdm-fechar2')) $('agdm-fechar2').addEventListener('click', fecharModal);
    if ($('agdm-cancelar')) $('agdm-cancelar').addEventListener('click', fecharModal);
    Array.prototype.forEach.call(document.querySelectorAll('#agd-modal .ecagd-tec'), function (b) {
      b.addEventListener('click', function () {
        var nome = b.getAttribute('data-nome'), tipo = b.getAttribute('data-tipo');
        var i = -1;
        mTecs.forEach(function (t, j) { if (t.nome === nome) i = j; });
        if (i >= 0) mTecs.splice(i, 1); else mTecs.push({ nome: nome, tipo: tipo });
        colherCampos();
        renderModal();
      });
    });
    if ($('agdm-salvar')) $('agdm-salvar').addEventListener('click', salvarModal);
    if ($('agdm-excluir')) $('agdm-excluir').addEventListener('click', function () { colherCampos(); renderModal('', true); });
    if ($('agdm-del-nao')) $('agdm-del-nao').addEventListener('click', function () { renderModal(); });
    if ($('agdm-del-um')) $('agdm-del-um').addEventListener('click', function () { excluirModal('um'); });
    if ($('agdm-del-os')) $('agdm-del-os').addEventListener('click', function () { excluirModal('os'); });
  }

  function colherCampos() {
    if (!$('agdm-empresa')) return;
    mEv.empresa = $('agdm-empresa').value;
    mEv.cidade = $('agdm-cidade').value;
    mEv.uf = $('agdm-uf').value;
    mEv.projeto = $('agdm-projeto').value;
    mEv.servico = $('agdm-servico').value;
    mEv.tipo = $('agdm-tipo').value;
    mEv.data = $('agdm-data').value || mEv.data;
    if ($('agdm-fim')) mDataFim = $('agdm-fim').value || mDataFim;
    mEv.status = $('agdm-status').value;
    mEv.observacoes = $('agdm-obs').value;
    if ($('agdm-os-busca')) mBuscaOS = $('agdm-os-busca').value;
    if ($('agdm-campanha')) mEv.campanha_numero = $('agdm-campanha').value ? Number($('agdm-campanha').value) : null;
  }

  // Busca de OS dentro do modal (atualiza SÓ a lista de resultados, sem
  // redesenhar o modal — para o campo não perder o foco enquanto digita).
  function atualizarResultadosOS() {
    var res = $('agdm-os-res');
    if (!res) return;
    var q = mBuscaOS.trim().toLowerCase();
    if (!q) { res.innerHTML = ''; return; }
    var achadas = oss.filter(function (o) {
      return (o.numero + ' ' + o.empresa).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 6);
    res.innerHTML = achadas.length
      ? achadas.map(function (o, i) {
          return '<div class="ecagd-os-item" data-i="' + i + '"><b>' + esc(o.numero) + '</b> ' + esc(o.empresa) + '</div>';
        }).join('')
      : '<div class="ecagd-os-item vazio">Nenhuma OS encontrada.</div>';
    Array.prototype.forEach.call(res.querySelectorAll('.ecagd-os-item[data-i]'), function (el) {
      el.addEventListener('click', function () { escolherOS(achadas[Number(el.getAttribute('data-i'))]); });
    });
  }

  // Vincula a OS escolhida e preenche os campos a partir dela (igual ao SGP),
  // avisando se a OS já tem dias na agenda (para não duplicar o serviço).
  function escolherOS(o) {
    colherCampos();
    mEv.os = o.numero; mEv.ordem_servico_id = o.id; mEv.proposta_id = o.proposta_id;
    mEv.empresa = o.empresa || mEv.empresa;
    mEv.cidade = o.cidade || mEv.cidade;
    mEv.uf = o.uf || mEv.uf;
    mEv.servico = o.servico || mEv.servico;
    mEv.projeto = o.projeto || mEv.projeto;
    mEv.campanha_numero = o.nCampanhas === 1 ? 1 : (mEv.campanha_numero || null);
    var camps = o.proposta_id ? (campanhasNaAgenda()[o.proposta_id] || []) : [];
    mAvisoOS = camps.length
      ? '⚠ Esta OS já tem dias na agenda (campanha' + (camps.length > 1 ? 's' : '') + ' ' + camps.slice().sort(function (a, b) { return a - b; }).join(', ') + '). Verifique para não duplicar o mesmo serviço.'
      : '';
    mBuscaOS = '';
    renderModal();
  }

  async function salvarModal() {
    colherCampos();
    if (mEv.tipo !== 'ferias' && !String(mEv.empresa || '').trim()) { renderModal('Preencha a empresa/cliente.'); return; }
    if (mEv.tipo === 'ferias' && mTecs.length === 0) { renderModal('Férias precisam de pelo menos um técnico selecionado.'); return; }
    var dias = mNovo ? faixaDias(mEv.data, mDataFim) : [mEv.data];
    var bloq = checarBloqueio({ id: mEv.id, tipo: mEv.tipo, tecnicos: mTecs }, dias);
    if (bloq) { renderModal(bloq); return; }

    var cli = sb();
    var botao = $('agdm-salvar');
    botao.disabled = true; botao.textContent = 'Salvando…';
    try {
      var base = {
        empresa: mEv.empresa, cidade: mEv.cidade || null, uf: mEv.uf || null,
        servico: mEv.servico || null, projeto: mEv.projeto || null,
        status: mEv.status, observacoes: mEv.observacoes || null, tipo: mEv.tipo,
        tecnicos: mTecs, manual: true, campanha_numero: mEv.campanha_numero || null,
        proposta_id: mEv.proposta_id || null, ordem_servico_id: mEv.ordem_servico_id || null
      };
      var r;
      if (mNovo) {
        var linhas = dias.map(function (d) { var l = Object.assign({}, base); l.data = d; return l; });
        r = await cli.from('agendamentos').insert(linhas);
      } else {
        var payload = Object.assign({}, base, { data: mEv.data });
        r = await cli.from('agendamentos').update(payload).eq('id', mEv.id);
      }
      if (r.error) throw new Error(r.error.message);
      fecharModal();
      EC.app.mostrarToast('✅ Agendamento salvo.');
      await recarregar();
    } catch (e) {
      var msg = String(e.message || '');
      if (msg.indexOf('security policy') !== -1 || msg.indexOf('policy') !== -1) msg = 'Sem permissão para salvar na agenda. Fale com o administrador.';
      else if (msg.indexOf('Failed to fetch') !== -1) msg = 'Sem conexão. Para salvar na agenda é preciso internet.';
      renderModal(msg);
    }
  }

  async function excluirModal(escopo) {
    var cli = sb();
    try {
      // Registra como "dispensados" os dias de proposta que serão apagados
      // (para o SGP não recolocá-los sozinho) — mesma regra do SGP.
      var apagados = escopo === 'os' && mEv.proposta_id
        ? eventos.filter(function (x) { return x.proposta_id === mEv.proposta_id; })
        : escopo === 'os' && mEv.ordem_servico_id
          ? eventos.filter(function (x) { return x.ordem_servico_id === mEv.ordem_servico_id; })
          : [mEv];
      var disp = apagados.filter(function (x) { return x.proposta_id; }).map(function (x) {
        return { proposta_id: x.proposta_id, campanha_numero: x.campanha_numero || null, data: x.data, tipo: x.tipo || 'servico' };
      });
      if (disp.length) {
        await cli.from('agenda_dispensados').upsert(disp, { onConflict: 'proposta_id,campanha_numero,data,tipo', ignoreDuplicates: true });
      }
      var r;
      if (escopo === 'os' && mEv.proposta_id) r = await cli.from('agendamentos').delete().eq('proposta_id', mEv.proposta_id);
      else if (escopo === 'os' && mEv.ordem_servico_id) r = await cli.from('agendamentos').delete().eq('ordem_servico_id', mEv.ordem_servico_id);
      else r = await cli.from('agendamentos').delete().eq('id', mEv.id);
      if (r.error) throw new Error(r.error.message);
      fecharModal();
      EC.app.mostrarToast('🗑️ Agendamento excluído.');
      await recarregar();
    } catch (e) {
      var msg = String(e.message || '');
      if (msg.indexOf('policy') !== -1) msg = 'Só o administrador pode excluir agendamentos.';
      renderModal(msg, false);
    }
  }

  /* ============ Lembrete de serviço agendado (tela inicial) ============ */
  // Descobre qual técnico da Agenda corresponde à conta logada — automático,
  // pelo e-mail (usuarios.email = rh_colaboradores.email → tecnico_id). Não
  // exige nenhum passo manual do admin; função no banco: meu_tecnico_nome().
  async function obterMeuTecnico() {
    var cli = sb();
    if (!cli) return EC.storage.ler(CHAVE_MEU_TEC) || null;
    try {
      var q = await cli.rpc('meu_tecnico_nome');
      var nome = q.data || null;
      EC.storage.salvar(CHAVE_MEU_TEC, nome);
      return nome;
    } catch (e) {
      return EC.storage.ler(CHAVE_MEU_TEC) || null;
    }
  }

  function diffDias(aISO, bISO) { return Math.round((parseISO(bISO) - parseISO(aISO)) / 86400000); }

  // Agrupa os dias de um mesmo "serviço": pela OS ou proposta+campanha quando
  // existe; sem vínculo (agendamento manual), agrupa por empresa+serviço+tipo
  // em dias consecutivos — evita juntar 2 idas diferentes à mesma empresa.
  function agruparEmTrabalhos(lista) {
    var porChave = {}, semChave = [];
    lista.forEach(function (e) {
      var chave = e.ordem_servico_id ? ('os:' + e.ordem_servico_id)
        : (e.proposta_id && e.campanha_numero != null) ? ('camp:' + e.proposta_id + ':' + e.campanha_numero)
        : null;
      if (chave) { (porChave[chave] = porChave[chave] || []).push(e); }
      else semChave.push(e);
    });
    // "id" estável por grupo — usado p/ lembrar quais já foram marcados "Ciente".
    var grupos = Object.keys(porChave).map(function (k) {
      var evs = porChave[k], datas = evs.map(function (e) { return e.data; }).sort();
      return { id: k, empresa: evs[0].empresa, cidade: evs[0].cidade, servico: evs[0].servico, tipo: evs[0].tipo, os: evs[0].os, min: datas[0], max: datas[datas.length - 1] };
    });
    var porGrupoSemChave = {};
    semChave.forEach(function (e) {
      var k2 = e.empresa + '|' + e.servico + '|' + e.tipo;
      (porGrupoSemChave[k2] = porGrupoSemChave[k2] || []).push(e);
    });
    Object.keys(porGrupoSemChave).forEach(function (k2) {
      var evs = porGrupoSemChave[k2].slice().sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
      var atual = null;
      evs.forEach(function (e) {
        if (atual && diffDias(atual.max, e.data) <= 1) { atual.max = e.data; }
        else { atual = { id: 'manual:' + k2 + ':' + e.data, empresa: e.empresa, cidade: e.cidade, servico: e.servico, tipo: e.tipo, os: e.os, min: e.data, max: e.data }; grupos.push(atual); }
      });
    });
    return grupos;
  }

  /* ============ "Ciente" — move o lembrete p/ o 🔔 no topo ============ */
  function lerVistos() {
    var v = EC.storage.ler(CHAVE_VISTOS);
    return Array.isArray(v) ? v : [];
  }
  function salvarVistos(lista) { EC.storage.salvar(CHAVE_VISTOS, lista); }
  // Descarta "vistos" de grupos que não existem mais (expiraram/foram cancelados)
  // — evita a lista crescer pra sempre. Devolve os ids ainda válidos.
  function podarVistos(grupos) {
    var idsAtuais = {};
    grupos.forEach(function (g) { idsAtuais[g.id] = true; });
    var vistos = lerVistos().filter(function (id) { return idsAtuais[id]; });
    salvarVistos(vistos);
    return vistos;
  }

  // Sino ÚNICO (compartilhado com Aprovações, app.js): só reporta a própria
  // contagem — quem desenha/mostra o botão é o app.js.
  function atualizarBotaoLembretes(vistosGrupos) {
    if (EC.app && EC.app.atualizarSino) EC.app.atualizarSino('lembretes', vistosGrupos.length);
  }

  // Reparte lembretesAtivos em "novos" (tela inicial) e "cientes" (🔔), e redesenha
  // os dois — sem precisar buscar de novo no banco.
  function aplicarParticaoLembretes(offline) {
    var vistosIds = podarVistos(lembretesAtivos);
    var naoVistos = lembretesAtivos.filter(function (g) { return vistosIds.indexOf(g.id) === -1; });
    var vistosGrupos = lembretesAtivos.filter(function (g) { return vistosIds.indexOf(g.id) !== -1; });
    renderLembretes(naoVistos, !!offline);
    atualizarBotaoLembretes(vistosGrupos);
  }

  function marcarCiente(id) {
    var vistos = lerVistos();
    if (vistos.indexOf(id) === -1) { vistos.push(id); salvarVistos(vistos); }
    aplicarParticaoLembretes(false);
    if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast('✅ Ciente — foi para 🔔 no topo.');
  }

  // HTML dos lembretes já marcados "Ciente" — usado tanto na tela dedicada
  // (abrirVistos) quanto embutido no sino combinado (app.js, quando há mais de
  // uma fonte de pendência ao mesmo tempo). Cada item é clicável e leva à Agenda.
  function htmlVistos() {
    var vistosIds = lerVistos();
    var vistosGrupos = lembretesAtivos.filter(function (g) { return vistosIds.indexOf(g.id) !== -1; });
    return vistosGrupos.length
      ? vistosGrupos.map(function (g) {
          var ferias = g.tipo === 'ferias';
          return '<div class="overlay-item overlay-item-clicavel lembrete-ir-agenda">' +
            '<b>' + (ferias ? '🏖 Férias' : esc(g.empresa)) + '</b> — ' + periodoCurto(g.min, g.max) +
            (!ferias ? '<br><small>' + esc([g.cidade, g.tipo === 'deslocamento' ? '🚗 Deslocamento' : g.servico].filter(Boolean).join(' · ')) + (g.os ? ' · ' + esc(g.os) : '') + '</small>' : '') +
          '</div>';
        }).join('')
      : '<p class="overlay-vazio">Nada por aqui.</p>';
  }

  // Abre a lista dos lembretes já marcados "Ciente" (tocando no 🔔 do topo).
  // Tocar num item fecha a lista e leva direto à Agenda.
  function abrirVistos() {
    EC.app.abrirOverlay('🔔 Lembretes (ciente)',
      '<p class="texto-apoio"><b>Você tem os seguintes serviços agendados:</b></p>' + htmlVistos() +
      '<p class="texto-apoio" style="margin-top:8px">Some sozinho no dia seguinte ao fim do serviço.</p>');
    ligarCliqueVaiAgenda();
  }

  // Tocar em qualquer item de lembrete (na lista dedicada ou dentro do sino
  // combinado) fecha o que estiver aberto e leva direto à Agenda.
  function ligarCliqueVaiAgenda() {
    document.querySelectorAll('.lembrete-ir-agenda').forEach(function (el) {
      el.addEventListener('click', function () { EC.app.fecharOverlay(); abrir(); });
    });
  }

  function periodoCurto(min, max) {
    if (min === max) return isoParaBR(min);
    var a = isoParaBR(min).split('/'), b = isoParaBR(max).split('/');
    if (a[1] === b[1] && a[2] === b[2]) return a[0] + ' a ' + b[0] + '/' + b[1]; // mesmo mês
    return isoParaBR(min) + ' a ' + isoParaBR(max);
  }

  function renderLembretes(grupos, offline) {
    var area = $('lembrete-area');
    if (!area) return;
    if (!grupos.length) { area.innerHTML = ''; return; }
    var html = grupos.map(function (g) {
      var ferias = g.tipo === 'ferias';
      return '<div class="ecagd-lembrete-item">' +
        '<div class="ecagd-lembrete-linha1"><b>' + (ferias ? '🏖 Férias' : esc(g.empresa)) + '</b><span>' + periodoCurto(g.min, g.max) + '</span></div>' +
        (!ferias ? '<div class="ecagd-lembrete-sub">' + esc([g.cidade, g.tipo === 'deslocamento' ? '🚗 Deslocamento' : g.servico].filter(Boolean).join(' · ')) + (g.os ? ' · ' + esc(g.os) : '') + '</div>' : '') +
        '<button type="button" class="ecagd-lembrete-ciente" data-id="' + esc(g.id) + '">✓ Ciente</button>' +
      '</div>';
    }).join('');
    area.innerHTML = '<div class="ecagd-lembrete">' +
      '<div class="ecagd-lembrete-topo">📅 <b>Você tem serviço agendado</b></div>' +
      html +
      (offline ? '<div class="ecagd-lembrete-offline">📡 Sem conexão — mostrando o último carregado.</div>' : '') +
      '<button type="button" class="link-discreto" id="lembrete-ver-agenda">Ver na Agenda →</button>' +
    '</div>';
    var btn = $('lembrete-ver-agenda');
    if (btn) btn.addEventListener('click', abrir);
    Array.prototype.forEach.call(area.querySelectorAll('.ecagd-lembrete-ciente'), function (b) {
      b.addEventListener('click', function () { marcarCiente(b.getAttribute('data-id')); });
    });
  }

  async function carregarLembretes() {
    var nome = await obterMeuTecnico();
    if (!nome) {
      var area = $('lembrete-area'); if (area) area.innerHTML = '';
      if (EC.app && EC.app.atualizarSino) EC.app.atualizarSino('lembretes', 0);
      return;
    }
    var hoje = iso(new Date());
    var cli = sb();
    if (!cli) {
      var cache = EC.storage.ler(CHAVE_LEMBRETES_CACHE);
      lembretesAtivos = cache ? cache.grupos.filter(function (g) { return g.max >= hoje; }) : [];
      aplicarParticaoLembretes(true);
      return;
    }
    try {
      // NÃO usar .contains('tecnicos', [{nome:...}]) aqui: o PostgREST quebra
      // ("invalid input syntax for type json") quando o nome tem apóstrofo
      // (ex.: "Sant'Ana") — descoberto 12/07/2026. Filtra em JS, igual ao
      // resto da Agenda (carregarDados), que nunca usou containment por isso.
      var q = await cli.from('agendamentos')
        .select('empresa, cidade, servico, data, tipo, status, tecnicos, campanha_numero, proposta_id, ordem_servico_id, proposta:proposta_id(ano, seq, codigo_origem), ordem_servico:ordem_servico_id(numero)')
        .neq('status', 'canc')
        .order('data');
      if (q.error) throw new Error(q.error.message);
      var eventosLembrete = (q.data || [])
        .filter(function (a) { return (a.tecnicos || []).some(function (t) { return t.nome === nome; }); })
        .map(function (a) {
          return {
            empresa: a.empresa || '—', cidade: a.cidade || '', servico: a.servico || '', data: a.data, tipo: a.tipo || 'servico',
            campanha_numero: a.campanha_numero || null, proposta_id: a.proposta_id || null, ordem_servico_id: a.ordem_servico_id || null,
            os: resolverNumeroOS(a.ordem_servico, a.proposta)
          };
        });
      var grupos = agruparEmTrabalhos(eventosLembrete);
      grupos.sort(function (a, b) { return a.min < b.min ? -1 : a.min > b.min ? 1 : 0; });
      EC.storage.salvar(CHAVE_LEMBRETES_CACHE, { em: new Date().toISOString(), grupos: grupos });
      lembretesAtivos = grupos.filter(function (g) { return g.max >= hoje; });
      aplicarParticaoLembretes(false);
    } catch (e) {
      var cache2 = EC.storage.ler(CHAVE_LEMBRETES_CACHE);
      lembretesAtivos = cache2 ? cache2.grupos.filter(function (g) { return g.max >= hoje; }) : [];
      aplicarParticaoLembretes(true);
    }
  }

  /* ============ Abertura / recarga ============ */
  async function recarregar() {
    if (carregando) return;
    carregando = true;
    $('agd-aviso').innerHTML = '<p class="texto-apoio">⏳ Carregando a agenda…</p>';
    try {
      if (!perms) perms = await carregarPermissoes();
      await carregarDados();
      offline = false;
      $('agd-aviso').innerHTML = perms.podeEditar ? '' :
        '<div class="ecagd-so-leitura">👁 Você tem acesso de <b>visualização</b> da agenda.</div>';
    } catch (e) {
      // Sem internet (ou sessão expirada): usa a última agenda carregada.
      var cache = EC.storage.ler(CHAVE_CACHE);
      if (cache && cache.eventos) {
        eventos = cache.eventos;
        catTecnicos = cache.catTecnicos || [];
        oss = cache.oss || [];
        ocultas = cache.ocultas || [];
        offline = true;
        if (!perms) perms = { podeEditar: false, souAdmin: false, podeFerias: false };
        $('agd-aviso').innerHTML = '<div class="ecagd-offline">📡 Sem conexão — mostrando a agenda carregada em ' +
          new Date(cache.em).toLocaleString('pt-BR') + '. Para atualizar ou salvar, conecte-se.</div>';
      } else {
        eventos = [];
        if (!perms) perms = { podeEditar: false, souAdmin: false, podeFerias: false };
        $('agd-aviso').innerHTML = '<div class="ecagd-offline">📡 Não foi possível carregar a agenda. Verifique a internet e toque em 🔄.</div>';
      }
    }
    $('agd-novo').classList.toggle('oculto', !(perms && perms.podeEditar) || offline);
    preencherFiltros();
    atualizarBannerOS();
    render();
    carregando = false;
  }

  function abrir() {
    EC.app.mostrarTela('tela-agenda');
    ref = new Date();
    diaSel = iso(new Date());
    visao = 'mes'; // ao abrir a agenda, começa sempre na visão por MÊS
    recarregar();
  }

  /* ============ Ligações da tela ============ */
  function ligar() {
    function mover(passo) {
      if (visao === 'semana') ref.setDate(ref.getDate() + passo * 7);
      else ref.setMonth(ref.getMonth() + passo);
      diaSel = null;
      render();
    }
    $('agd-prev').addEventListener('click', function () { mover(-1); });
    $('agd-next').addEventListener('click', function () { mover(1); });
    $('agd-hoje').addEventListener('click', function () { ref = new Date(); diaSel = iso(new Date()); render(); });
    ['mes', 'semana', 'lista'].forEach(function (v) {
      $('agd-v-' + v).addEventListener('click', function () { visao = v; render(); });
    });
    $('agd-atualizar').addEventListener('click', function () { perms = null; recarregar(); });
    $('agd-busca').addEventListener('input', render);
    $('agd-f-status').addEventListener('change', render);
    $('agd-f-tec').addEventListener('change', render);
    $('agd-voltar').addEventListener('click', function () { EC.app.mostrarTela('tela-acao'); carregarLembretes(); });
    $('agd-novo').addEventListener('click', function () {
      // Usa o dia que a pessoa tocou na grade (diaSel); se não houver, cai em hoje.
      var diaInicial = diaSel || iso(new Date());
      abrirModal({
        empresa: '', cidade: '', uf: '', servico: '', projeto: null,
        data: diaInicial, status: 'prog', observacoes: '', tipo: 'servico',
        tecnicos: [], manual: true, proposta_id: null, ordem_servico_id: null, campanha_numero: null, os: null
      }, true);
    });
    // fechar tocando no fundo escuro
    $('agd-modal').addEventListener('click', function (ev) {
      if (ev.target.classList && ev.target.classList.contains('ecagd-m-fundo')) fecharModal();
    });
  }

  window.EC = window.EC || {};
  EC.agenda = { abrir: abrir, _ligar: ligar, carregarLembretes: carregarLembretes, abrirVistos: abrirVistos, obterVistosParaSino: htmlVistos, ligarCliqueVaiAgenda: ligarCliqueVaiAgenda };
})();
