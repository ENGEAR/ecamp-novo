/**
 * campo-vibracao.js — Monitoramento em campo: VIBRAÇÃO (Sismografia)
 *
 * Usado nos escopos de Vibração (Sismografia – NBR 9653, Patrimônio
 * Espeleológico – CECAV, Áreas Habitadas – CETESB DD 215/2007). Os métodos
 * Usual/Online usam o mesmo formulário por enquanto.
 *
 * Dois formulários, decididos pelo ESCOPO da OS (cecav.docx, 2026-07):
 *   NBR 9653 (padrão) — Campos gerais: Objetivo + Quantidade de pontos.
 *     Por ponto (paginado): identificação, escolha do local, instalação do
 *     geofone (solo / solo rígido), instalação do microfone, fonte de vibração,
 *     auto verificação, foto, durante o monitoramento, intercorrências, hora final.
 *   CECAV (escopo com "CECAV"/"Espeleológico") — acrescenta nos campos gerais a
 *     Fonte de vibração (seleção, com avisos por opção) + 2 confirmações de
 *     configuração (histograma ≥ 15 min, solo contínuo). Por ponto, os checks de
 *     local variam pela fonte (com/sem os 2 de caverna) e, em Construção Civil e
 *     Ferrovia ou Rodovia, são 3 MEDIÇÕES por ponto: a 1ª é o formulário
 *     completo; a 2ª e a 3ª repetem só identificação (herdada da 1ª quando em
 *     branco), auto verificação, intercorrências e hora final.
 *
 * Interface (namespace global EC.campoVibracao):
 *   EC.campoVibracao.renderizar(container, ctx)
 *   EC.campoVibracao.itensFaltando(estado) → ['P1: ...', ...]
 *   EC.campoVibracao.TIPO_CARIMBO → texto do tipo p/ carimbo de foto
 *
 * Depende de: EC.gps, EC.foto, EC.paginacao.
 */
window.EC = window.EC || {};

EC.campoVibracao = (function () {
  'use strict';

  const TIPO_CARIMBO = 'VIBRACAO';
  const TIPOS_EQUIP = ['S100', 'S200', 'S220', 'Outro'];

  // Checks por ponto (item 8.2). Os de instalação são situacionais (solo OU
  // solo rígido; microfone só quando há medição de pressão acústica) — por isso
  // NÃO bloqueiam o salvamento. Os de auto verificação e durante o monitoramento
  // bloqueiam (são confirmações críticas da medição).
  const CHECKS_LOCAL = [
    'Ponto representa adequadamente o cenário',
    'Solo preferencialmente natural ou aterro consolidado',
    'Evitado solo desagregado',
    'Evitado piso pavimentado / calçada / passarela',
    'Sem interferências excessivas próximas',
    'Sem obstáculos relevantes entre fonte e sensor',
    'Distante de alta tensão (> 7 m)',
    'Sem movimentação excessiva de pessoas',
    'Sem interferência de rádio transmissor'
  ];
  const CHECKS_GEOFONE_SOLO = [
    'Geofone nivelado',
    'Cravos totalmente enterrados',
    'Profundidade entre 10 e 30 cm',
    'Fixação firme no solo'
  ];
  const CHECKS_GEOFONE_RIGIDO = [
    'Uso de gesso / grampos / parafusos',
    'Furos protegidos com fita adesiva',
    'Fixação conferida após secagem',
    'Equipamento sem folgas'
  ];
  const CHECKS_GEOFONE_ALT = [
    'Quando o solo permitir uma boa fixação, o sensor pode ser simplesmente cravado na superfície limpa do terreno'
  ];
  // Instalação do geofone: o técnico preenche UMA das três opções.
  const INSTAL_GEOFONE = {
    'Solo': { prefixo: 'geosolo', checks: CHECKS_GEOFONE_SOLO },
    'Superfície rígida': { prefixo: 'georigido', checks: CHECKS_GEOFONE_RIGIDO },
    'Alternativa': { prefixo: 'geoalt', checks: CHECKS_GEOFONE_ALT }
  };
  const CHECKS_MICROFONE = [
    'Instalado externamente à edificação',
    'Distância máxima de 3 m da estrutura monitorada',
    'Distante pelo menos 3 m de outras paredes',
    'Sem obstáculos entre fonte e microfone',
    'Protetor de vento instalado',
    'Altura do tripé ajustada adequadamente'
  ];
  const CHECKS_MONITORAMENTO = [
    'Conferida checagem automática do equipamento',
    'Equipamento orientado para a fonte',
    'Técnico, favor se afastar um passo atrás do equipamento',
    'Evento captado',
    'Registro sísmico conferido após evento'
  ];

  /* ===== CECAV (Patrimônio Espeleológico) ===== */

  const CFG_APARELHO = 'Configuração do aparelho em sismograma (trigger) e histograma';
  const CFG_HISTOGRAMA = 'Configurar o tempo do histograma para, no mínimo, 15 minutos. Esse tempo é o suficiente para avaliar as situações previstas na norma de referência.';
  const CFG_SOLO_CONTINUO = 'Deve ser escolhido pontos de medição em um local onde o solo entre a fonte e o ponto seja contínuo, sem interferências que possam alterar a propagação da vibração.';
  // Substituem o "Ponto representa adequadamente o cenário" nas fontes com caverna.
  const CHECKS_LOCAL_CAVERNA = [
    'Ponto representa adequadamente o cenário das áreas de cavernas existentes no entorno',
    'Os pontos de medição deverão estar situados ao longo de uma trajetória em linha reta entre a fonte emissora e a caverna mais próxima, posicionando-se o ponto o mais próximo possível da cavidade'
  ];
  // Fonte de vibração (campo geral do CECAV). medicoes=3 → cada ponto tem 3
  // medições; caverna → os 2 checks de caverna entram na escolha do local;
  // checksFonte → confirmações extras da medição (bloqueiam o salvamento).
  const FONTES_CECAV = {
    'Construção Civil': {
      medicoes: 3, caverna: true,
      aviso: 'Se Construção Civil: é necessário, no mínimo, 3 monitoramentos por ponto.',
      checksFonte: ['Tráfego de veículos de carga em vias internas: o período de medição deverá contemplar, no mínimo, 3 (três) passagens de veículos de carga pela via monitorada.']
    },
    'Desmonte Mineração': {
      medicoes: 1, caverna: false,
      aviso: 'Se Desmonte Mineração: a definição dos pontos de monitoramento deverá ser formalmente indicada pelo contratante.',
      checksFonte: []
    },
    'Atividades Diversas': {
      medicoes: 1, caverna: false,
      aviso: 'Se Atividades Diversas: a definição dos pontos de monitoramento deverá ser formalmente indicada pelo contratante.',
      checksFonte: []
    },
    'Ferrovia ou Rodovia': {
      medicoes: 3, caverna: true,
      aviso: '',
      checksFonte: [
        'Trens e afins: cada medição deverá contemplar a passagem completa de um comboio ferroviário.',
        'Veículos: cada medição deverá ter duração mínima de 15 (quinze) minutos, devendo ser realizada em dia útil e em horário de maior fluxo de veículos de carga na via monitorada.'
      ]
    }
  };

  // CECAV é decidido pelo ESCOPO da OS (como o tipo de monitoramento). Recebe o
  // estado por parâmetro porque a validação roda também sem o módulo renderizado.
  function ehCecav(estado) {
    const e = ((estado && estado.servico && estado.servico.escopo) || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    return /cecav|espeleologic/.test(e);
  }
  function cfgFonte(estado) {
    if (!ehCecav(estado)) return null;
    const c = estado.campo || {};
    return FONTES_CECAV[(c.geral || {}).fonteVibracaoGeral] || null;
  }
  function checksLocal(estado) {
    if (!ehCecav(estado)) return CHECKS_LOCAL;
    const base = CHECKS_LOCAL.slice(1); // sem o "representa o cenário" da NBR
    const f = cfgFonte(estado);
    return (f && f.caverna) ? CHECKS_LOCAL_CAVERNA.concat(base) : base;
  }

  let ctx = null;
  let raiz = null;
  let pontoExibido = 1;
  let temporizadorSalvar = null;

  function $(seletor) { return raiz.querySelector(seletor); }
  function campo() { return ctx.estado.campo; }
  function salvar() { ctx.salvar(); }
  function salvarDevagar() {
    clearTimeout(temporizadorSalvar);
    temporizadorSalvar = setTimeout(salvar, 400);
  }

  // ===== PERÍODO (diurno/noturno) — SÓ no CECAV =====
  // Cada ponto tem uma medição COMPLETA por período (mesma ideia do Ruído).
  // Estrutura: ponto.periodos[periodo] = { todos os campos da medição }. Registro
  // antigo (campos no topo do ponto) migra para o 1º período ao abrir. Fora do
  // CECAV o ponto continua PLANO (sem períodos).
  const PERIODOS = [
    { id: 'diurno', icone: '☀️', nome: 'Diurno' },
    { id: 'noturno', icone: '🌙', nome: 'Noturno' }
  ];
  let periodoExibido = 'diurno';
  function rotuloPeriodo(id) { const p = PERIODOS.filter(function (x) { return x.id === id; })[0]; return p ? p.nome : id; }
  function ehCecavAtivo() { return !!(ctx && ehCecav(ctx.estado)); }
  function periodosAtivos(geral) {
    const g = geral || (ctx && campo().geral) || {};
    const marcados = Array.isArray(g.periodos) ? g.periodos : [];
    const lista = PERIODOS.filter(function (x) { return marcados.indexOf(x.id) !== -1; }).map(function (x) { return x.id; });
    return lista.length ? lista : ['diurno'];
  }
  function garantirPeriodos(ponto, p0) {
    if (!ponto.periodos) {
      ponto.periodos = {};
      const chaves = Object.keys(ponto).filter(function (k) { return k !== 'periodos'; });
      if (chaves.length) { // migra o formato antigo (campos no topo) para o 1º período
        const alvo = p0 || periodosAtivos()[0];
        const m = ponto.periodos[alvo] = {};
        chaves.forEach(function (k) { m[k] = ponto[k]; delete ponto[k]; });
      }
    }
    return ponto.periodos;
  }
  function medPer(ponto, periodo, p0) {
    garantirPeriodos(ponto, p0 || periodo);
    return (ponto.periodos[periodo] = ponto.periodos[periodo] || {});
  }
  // Objeto de medição "ativo": no CECAV é o do período exibido; senão o ponto (plano).
  function alvoPonto(ponto) { return ehCecavAtivo() ? medPer(ponto, periodoExibido) : ponto; }
  function medComDados(ponto, periodo) {
    const m = (ponto.periodos || {})[periodo];
    if (!m) return false;
    return Object.keys(m).some(function (k) {
      const v = m[k];
      if (v == null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return !!v;
    });
  }

  function htmlChecks(itens, prefixo) {
    return itens.map(function (texto, i) {
      return '<label class="linha-check check-campo"><input type="checkbox" data-check="' + prefixo + i + '"><span>' + texto + '</span></label>';
    }).join('');
  }

  function vincular(elemento, alvo) {
    elemento.querySelectorAll('[data-campo]').forEach(function (el) {
      const c = el.dataset.campo;
      if (alvo[c] !== undefined && alvo[c] !== null) el.value = alvo[c];
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        alvo[c] = el.value;
        salvarDevagar();
      });
    });
    elemento.querySelectorAll('[data-check]').forEach(function (el) {
      const c = el.dataset.check;
      alvo.checks = alvo.checks || {};
      el.checked = !!alvo.checks[c];
      el.addEventListener('change', function () {
        alvo.checks[c] = el.checked;
        salvarDevagar();
      });
    });
  }

  function montarGps(elemento, alvo) {
    const div = elemento.querySelector('.cv-gps');
    if (!div) return null;
    return EC.gps.criar(div, {
      dadosIniciais: alvo.gps || null,
      aoCapturar: function (dados) { alvo.gps = dados; salvar(); }
    });
  }

  function montarFoto(elemento, seletor, alvo, chave, rotulo, instanciaGps, numeroPonto) {
    const div = elemento.querySelector(seletor);
    if (!div) return;
    EC.foto.criar(div, {
      os: ctx.estado.os.numero,
      projeto: ctx.estado.os.projeto,
      tipo: TIPO_CARIMBO,
      ponto: 'P' + String(numeroPonto).padStart(2, '0'),
      rotulo: rotulo,
      fotoInicial: alvo[chave] || null,
      obterUtm: function () {
        if (instanciaGps && instanciaGps.textoCarimbo()) return instanciaGps.textoCarimbo();
        return (alvo.gps && alvo.gps.textoUtm) || '';
      },
      aoCapturar: function (foto) { alvo[chave] = foto; salvar(); }
    });
  }

  /* ===== Campos gerais ===== */

  // Seletor de PERÍODOS do CECAV (diurno/noturno). Campanha nova = ambos por
  // padrão; registro antigo (dados no topo do ponto) = só diurno (não força noturno).
  function renderizarPeriodos() {
    const div = $('#cv-periodos');
    if (!div) return;
    const g = campo().geral;
    if (!Array.isArray(g.periodos) || !g.periodos.length) {
      const temAntigo = (campo().pontos || []).some(function (p) { return p && !p.periodos && Object.keys(p).length; });
      g.periodos = temAntigo ? ['diurno'] : ['diurno', 'noturno'];
    }
    div.innerHTML =
      '<p class="grupo-checks-titulo">🕒 Período de monitoramento</p>' +
      '<div style="display:flex;gap:18px;align-items:center">' + PERIODOS.map(function (p) {
        const on = g.periodos.indexOf(p.id) !== -1;
        return '<label class="check-campo" style="display:inline-flex;align-items:center;gap:6px;margin:0"><input type="checkbox" data-periodo-sel="' + p.id + '"' + (on ? ' checked' : '') + '><span>' + p.nome + '</span></label>';
      }).join('') + '</div>' +
      '<p class="texto-apoio">Cada ponto terá uma medição completa em cada período marcado.</p>';
    div.querySelectorAll('[data-periodo-sel]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const id = cb.dataset.periodoSel;
        let lista = (campo().geral.periodos || []).slice();
        if (cb.checked) { if (lista.indexOf(id) === -1) lista.push(id); }
        else { lista = lista.filter(function (x) { return x !== id; }); }
        if (!lista.length) { lista = [id]; cb.checked = true; if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast('Marque ao menos um período.'); }
        campo().geral.periodos = lista;
        if (periodosAtivos().indexOf(periodoExibido) === -1) periodoExibido = periodosAtivos()[0];
        salvar();
        renderizarPeriodos();
        renderizarPonto(pontoExibido);
      });
    });
  }

  function renderizarGeral() {
    const area = $('#cv-geral');
    const g = campo().geral;
    const previstoPontos = ctx.estado.dadosGerais.qtdePontos;
    const cecav = ehCecav(ctx.estado);
    area.innerHTML =
      '<label>Objetivo<select data-campo="objetivo">' +
      '<option value="">Selecione…</option><option>Vibrações da Empresa</option><option>Vibrações do Ambiente</option>' +
      '</select></label>' +
      (cecav
        ? '<label>Fonte de vibração<select data-campo="fonteVibracaoGeral"><option value="">Selecione…</option>' +
          Object.keys(FONTES_CECAV).map(function (n) { return '<option>' + n + '</option>'; }).join('') +
          '</select></label><div id="cv-aviso-fonte"></div><div id="cv-periodos"></div>'
        : '') +
      '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>' +
      (previstoPontos != null && previstoPontos !== '' ? '<p class="texto-apoio">Previsto na OS: ' + previstoPontos + ' ponto(s).</p>' : '') +
      '<div id="cv-just-pontos"></div>' +
      '<p class="grupo-checks-titulo">⚙️ Configuração do aparelho</p>' +
      htmlChecks(cecav ? [CFG_APARELHO, CFG_HISTOGRAMA] : [CFG_APARELHO], 'cfg') +
      (cecav ? htmlChecks([CFG_SOLO_CONTINUO], 'solocont') : '');
    if (g.qtdePontos === undefined) g.qtdePontos = previstoPontos;
    vincular(area, g);
    renderizarPeriodos();

    // CECAV: aviso conforme a fonte escolhida; trocar a fonte muda a estrutura
    // dos pontos (checks de caverna, condições da medição, 3 medições).
    const selFonte = area.querySelector('[data-campo="fonteVibracaoGeral"]');
    if (selFonte) {
      const avisoFonte = function () {
        const f = FONTES_CECAV[selFonte.value];
        area.querySelector('#cv-aviso-fonte').innerHTML =
          (f && f.aviso) ? '<div class="alerta alerta-amarelo">⚠️ ' + f.aviso + '</div>' : '';
      };
      selFonte.addEventListener('change', function () { avisoFonte(); renderizarPontos(); });
      avisoFonte();
    }

    // Justificativa obrigatória quando a qtd de pontos difere da prevista na OS.
    function atualizarJustPontos() {
      const div = area.querySelector('#cv-just-pontos');
      if (!div) return;
      const difere = previstoPontos != null && previstoPontos !== '' && String(g.qtdePontos) !== String(previstoPontos);
      if (difere) {
        if (!div.dataset.montado) {
          div.innerHTML = '<label>Justificativa da variação de pontos (obrigatória)' +
            '<textarea rows="2" data-campo="justificativaPontos" placeholder="Por que o número de pontos mudou em relação ao previsto na OS?"></textarea></label>';
          vincular(div, g);
          div.dataset.montado = '1';
        }
      } else {
        div.innerHTML = ''; div.dataset.montado = ''; delete g.justificativaPontos;
      }
    }
    atualizarJustPontos();

    area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', function () {
      renderizarPontos();
      atualizarJustPontos();
    });
    renderizarPontos();
  }

  /* ===== Pontos paginados ===== */

  function renderizarPontos() {
    const g = campo().geral;
    const total = Math.min(20, Math.max(1, parseInt(g.qtdePontos, 10) || 0));
    if (!g.qtdePontos || total < 1) { $('#cv-paginacao').innerHTML = ''; $('#cv-ponto').innerHTML = ''; return; }

    while (campo().pontos.length < total) campo().pontos.push({});
    pontoExibido = Math.min(pontoExibido, total);

    EC.paginacao.criar($('#cv-paginacao'), {
      total: total,
      // Navegação livre entre pontos (começar em qualquer ponto). A validação das
      // fotos/dados obrigatórios continua na finalização (itensFaltando).
      aoMudar: function (n) { pontoExibido = n; renderizarPonto(n); }
    });
    renderizarPonto(pontoExibido);
  }

  // Escolha do equipamento usado no ponto, entre os PRÉ-SELECIONADOS no pré-campo.
  function htmlEquipamentoPonto() {
    const eqs = ctx.estado.equipamentos || [];
    if (!eqs.length) {
      return '<p class="texto-apoio">Nenhum equipamento pré-selecionado — volte ao pré-campo para escolher.</p>';
    }
    return '<label>Equipamento utilizado<select data-campo="equipamento"><option value="">Selecione…</option>' +
      eqs.map(function (c) { return '<option>' + c + '</option>'; }).join('') +
      '</select></label>';
  }

  function renderizarPonto(n) {
    const area = $('#cv-ponto');
    const ponto = campo().pontos[n - 1];
    if (!ponto) { area.innerHTML = ''; return; }

    const cecav = ehCecavAtivo();
    const periodos = periodosAtivos();
    if (cecav && periodos.indexOf(periodoExibido) === -1) periodoExibido = periodos[0];
    const alvo = alvoPonto(ponto); // no CECAV = a medição do período; senão o próprio ponto

    // Abas de PERÍODO (CECAV, só se houver mais de um período marcado).
    let abasPeriodo = '';
    if (cecav && periodos.length > 1) {
      abasPeriodo = '<p class="grupo-checks-titulo">Período</p><div class="grade-tipos cv-periodo-abas">' + periodos.map(function (pid) {
        const P = PERIODOS.filter(function (x) { return x.id === pid; })[0] || { icone: '', nome: pid };
        const cheio = medComDados(ponto, pid) ? ' ✓' : '';
        return '<button type="button" class="card-tipo cv-periodo-aba' + (periodoExibido === pid ? ' card-tipo-ativo' : '') +
          '" data-periodo="' + pid + '"><span class="card-tipo-icone">' + P.icone + '</span><span>' + P.nome + cheio + '</span></button>';
      }).join('') + '</div>';
    }

    const fonte = cfgFonte(ctx.estado);
    const tresMedicoes = !!(fonte && fonte.medicoes === 3);
    const html =
      '<div class="cartao-ponto"><h2>Ponto P' + n + '</h2>' + abasPeriodo +
      (tresMedicoes ? '<p class="texto-apoio">⚠️ Esta fonte exige <strong>3 medições</strong> neste ponto: preencha a 1ª medição completa abaixo — a 2ª e a 3ª estão no fim da página.</p><p class="grupo-checks-titulo">1ª medição</p>' : '') +
      // 1. Identificação
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      '<label>Nome do ponto<input type="text" data-campo="nome"></label>' +
      htmlEquipamentoPonto() +
      '<div class="cv-gps"></div>' +
      // 2. Escolha do local (checks variam: NBR / CECAV com ou sem caverna)
      '<p class="grupo-checks-titulo">📍 Escolha do local</p>' + htmlChecks(checksLocal(ctx.estado), 'local') +
      // 3. Instalação do geofone — preencher UMA das três opções
      '<label>Instalação do geofone (preencher uma opção)<select data-campo="instalGeofone"><option value="">Selecione…</option>' +
      '<option>Solo</option><option>Superfície rígida</option><option>Alternativa</option></select></label>' +
      '<div id="cv-instal-geofone"></div>' +
      // 5. Instalação do microfone
      '<p class="grupo-checks-titulo">🎙️ Instalação do microfone</p>' + htmlChecks(CHECKS_MICROFONE, 'mic') +
      // 6. Fonte de vibração
      '<label>Fonte de vibração<input type="text" data-campo="fonteVibracao"></label>' +
      // 6b. CECAV: condições da medição conforme a fonte geral escolhida
      (fonte && fonte.checksFonte.length
        ? '<p class="grupo-checks-titulo">📋 Condições da medição</p>' + htmlChecks(fonte.checksFonte, 'fonteChk')
        : '') +
      // 7. Auto verificação
      '<p class="grupo-checks-titulo">🔎 Auto verificação</p>' + htmlChecks(['Auto verificação realizada'], 'autoverif') +
      '<p class="texto-apoio">⚠️ Se não conseguir auto verificação, checar os cabos; se persistir, contatar a ENGEAR.</p>' +
      // 8. Foto do ponto
      '<div class="cv-foto-ponto"></div>' +
      // 9. Durante o monitoramento
      '<p class="grupo-checks-titulo">📈 Durante o monitoramento</p>' + htmlChecks(CHECKS_MONITORAMENTO, 'monit') +
      // 10. Intercorrências
      '<label>Intercorrências<select data-campo="intercorrencia"><option value="">Selecione…</option><option>Nenhuma</option><option>Sim</option></select></label>' +
      '<div id="cv-intercorrencia-desc"></div>' +
      // 11. Finalização
      '<label>Hora final<input type="time" data-campo="horaFinal"></label>' +
      // CECAV com 3 medições: 2ª e 3ª entram aqui (montadas DEPOIS do vincular
      // do ponto, para os campos delas serem vinculados só à medição)
      '<div id="cv-medicoes"></div>' +
      '</div>';
    area.innerHTML = html;

    // Abas de período (CECAV): trocar redesenha o ponto na medição daquele período.
    area.querySelectorAll('.cv-periodo-aba').forEach(function (b) {
      b.addEventListener('click', function () {
        if (periodoExibido === b.dataset.periodo) return;
        periodoExibido = b.dataset.periodo;
        renderizarPonto(n);
      });
    });

    vincular(area, alvo);
    renderMedicoes(area, alvo);
    const gpsInstancia = montarGps(area, alvo);
    montarFoto(area, '.cv-foto-ponto', alvo, 'fotoPonto', '📷 Foto do ponto (obrigatória)', gpsInstancia, n);

    // instalação do geofone: mostra os checks da opção escolhida (uma das três)
    const selGeo = area.querySelector('[data-campo="instalGeofone"]');
    const divGeo = area.querySelector('#cv-instal-geofone');
    function renderGeofone() {
      const cfg = INSTAL_GEOFONE[selGeo.value];
      if (cfg) {
        divGeo.innerHTML = '<p class="grupo-checks-titulo">⚙️ Instalação do geofone — ' + selGeo.value.toLowerCase() + '</p>' + htmlChecks(cfg.checks, cfg.prefixo);
        vincular(divGeo, alvo);
      } else {
        divGeo.innerHTML = '';
      }
    }
    selGeo.addEventListener('change', renderGeofone);
    renderGeofone();

    // descrição da intercorrência (quando "Sim")
    const seletor = area.querySelector('[data-campo="intercorrencia"]');
    const divDesc = area.querySelector('#cv-intercorrencia-desc');
    function descricao() {
      if (seletor.value === 'Sim') {
        divDesc.innerHTML = '<label>Descreva a intercorrência<textarea rows="2" data-campo="intercorrenciaDesc"></textarea></label>';
        vincular(divDesc, alvo);
      } else {
        divDesc.innerHTML = '';
      }
    }
    seletor.addEventListener('change', descricao);
    descricao();
  }

  // 2ª e 3ª medições (CECAV: Construção Civil e Ferrovia ou Rodovia). A 1ª
  // medição é o próprio formulário do ponto; estas repetem só identificação,
  // auto verificação, intercorrências e hora final. Nome e equipamento são
  // espelhos (só leitura) da 1ª medição — preenchem sozinhos e acompanham o que
  // for digitado lá em cima; o GPS vale o da 1ª.
  function renderMedicoes(area, ponto) {
    const divTodas = area.querySelector('#cv-medicoes');
    if (!divTodas) return;
    const f = cfgFonte(ctx.estado);
    if (!f || f.medicoes !== 3) { divTodas.innerHTML = ''; return; }
    ponto.medicoes = ponto.medicoes || [];
    while (ponto.medicoes.length < 2) ponto.medicoes.push({});
    const eqs = ctx.estado.equipamentos || [];
    divTodas.innerHTML = [2, 3].map(function (k) {
      return '<div class="cartao-coleta cv-medicao"><h3>' + k + 'ª medição</h3>' +
        '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
        '<label>Nome do ponto<input type="text" class="cv-med-nome" readonly title="Igual à 1ª medição"></label>' +
        (eqs.length
          ? '<label>Equipamento utilizado<input type="text" class="cv-med-equip" readonly title="Igual à 1ª medição"></label>'
          : '') +
        '<p class="texto-apoio">📍 GPS: valem as coordenadas capturadas na 1ª medição.</p>' +
        '<p class="grupo-checks-titulo">🔎 Auto verificação</p>' + htmlChecks(['Auto verificação realizada'], 'autoverif') +
        '<p class="texto-apoio">⚠️ Se não conseguir auto verificação, checar os cabos; se persistir, contatar a ENGEAR.</p>' +
        '<label>Intercorrências<select data-campo="intercorrencia"><option value="">Selecione…</option><option>Nenhuma</option><option>Sim</option></select></label>' +
        '<div class="cv-med-desc"></div>' +
        '<label>Hora final<input type="time" data-campo="horaFinal"></label>' +
        '</div>';
    }).join('');
    divTodas.querySelectorAll('.cv-medicao').forEach(function (card, i) {
      const med = ponto.medicoes[i];
      vincular(card, med);
      const sel = card.querySelector('[data-campo="intercorrencia"]');
      const divDesc = card.querySelector('.cv-med-desc');
      function descricao() {
        if (sel.value === 'Sim') {
          divDesc.innerHTML = '<label>Descreva a intercorrência<textarea rows="2" data-campo="intercorrenciaDesc"></textarea></label>';
          vincular(divDesc, med);
        } else {
          divDesc.innerHTML = '';
        }
      }
      sel.addEventListener('change', descricao);
      descricao();
    });

    // Espelha nome/equipamento da 1ª medição nas 2ª/3ª e grava no registro, para
    // acompanhar em tempo real o que o técnico digita na identificação do ponto.
    function sincronizarIdentidade() {
      divTodas.querySelectorAll('.cv-medicao').forEach(function (card, i) {
        const med = ponto.medicoes[i];
        const inpNome = card.querySelector('.cv-med-nome');
        if (inpNome) { inpNome.value = ponto.nome || ''; med.nome = ponto.nome || ''; }
        const inpEquip = card.querySelector('.cv-med-equip');
        if (inpEquip) { inpEquip.value = ponto.equipamento || ''; med.equipamento = ponto.equipamento || ''; }
      });
    }
    sincronizarIdentidade();
    // Dentro de `area`, os únicos [data-campo="nome"/"equipamento"] são os da 1ª
    // medição (nas 2ª/3ª viraram espelhos só leitura, sem data-campo).
    const inpNomePonto = area.querySelector('[data-campo="nome"]');
    const selEquipPonto = area.querySelector('[data-campo="equipamento"]');
    if (inpNomePonto) inpNomePonto.addEventListener('input', function () { sincronizarIdentidade(); salvarDevagar(); });
    if (selEquipPonto) selEquipPonto.addEventListener('change', function () { sincronizarIdentidade(); salvarDevagar(); });
  }

  /* ===== Validação ===== */

  // Faltas de UMA medição (o ponto plano, ou a medição de um período no CECAV).
  function faltasMedicao(med, estado) {
    med = med || {};
    const falta = [];
    const reqVal = function (chave, rotulo) {
      const v = med[chave];
      if (v === undefined || v === null || String(v).trim() === '') falta.push(rotulo);
    };
    const checks = med.checks || {};
    const grupoChecks = function (prefixo, qtde, rotulo) {
      let n = 0;
      for (let i = 0; i < qtde; i++) if (!checks[prefixo + i]) n++;
      if (n) falta.push(n + ' confirmação(ões) de ' + rotulo);
    };

    reqVal('horaInicial', 'hora inicial');
    reqVal('nome', 'nome do ponto');
    if (((estado && estado.equipamentos) || []).length) reqVal('equipamento', 'equipamento utilizado');
    if (!med.gps) falta.push('GPS');
    reqVal('fonteVibracao', 'fonte de vibração');
    reqVal('instalGeofone', 'instalação do geofone');
    const cfgGeo = INSTAL_GEOFONE[med.instalGeofone];
    if (cfgGeo) grupoChecks(cfgGeo.prefixo, cfgGeo.checks.length, 'instalação do geofone (' + med.instalGeofone.toLowerCase() + ')');
    grupoChecks('autoverif', 1, 'auto verificação');
    if (!EC.foto.tem(med.fotoPonto)) falta.push('foto do ponto');
    grupoChecks('monit', CHECKS_MONITORAMENTO.length, 'durante o monitoramento');
    reqVal('intercorrencia', 'intercorrências');
    if (med.intercorrencia === 'Sim') reqVal('intercorrenciaDesc', 'descrição da intercorrência');
    // CECAV: condições da medição (bloqueiam) + 2ª/3ª medições quando a fonte exige.
    const f = cfgFonte(estado);
    if (f && f.checksFonte.length) grupoChecks('fonteChk', f.checksFonte.length, 'condições da medição');
    if (f && f.medicoes === 3) {
      for (let k = 2; k <= 3; k++) {
        const m2 = (med.medicoes || [])[k - 2] || {};
        const mch = m2.checks || {};
        if (!String(m2.horaInicial || '').trim()) falta.push(k + 'ª medição: hora inicial');
        if (!mch.autoverif0) falta.push(k + 'ª medição: auto verificação');
        if (!String(m2.intercorrencia || '').trim()) falta.push(k + 'ª medição: intercorrências');
        if (m2.intercorrencia === 'Sim' && !String(m2.intercorrenciaDesc || '').trim()) falta.push(k + 'ª medição: descrição da intercorrência');
      }
    }
    // Hora final é opcional (como a hora de término no ruído).
    // Checks de local/geofone/microfone são situacionais → não bloqueiam.
    return falta;
  }

  // No CECAV valida cada PERÍODO ativo (prefixando o rótulo quando há mais de um);
  // fora do CECAV valida o ponto plano.
  function itensFaltandoDoPonto(ponto, estado) {
    ponto = ponto || {};
    if (ehCecav(estado)) {
      const falta = [];
      const periodos = periodosAtivos((estado.campo || {}).geral);
      const p0 = periodos[0];
      const varios = periodos.length > 1;
      periodos.forEach(function (pid) {
        const med = medPer(ponto, pid, p0);
        const pref = varios ? (rotuloPeriodo(pid) + ' · ') : '';
        faltasMedicao(med, estado).forEach(function (x) { falta.push(pref + x); });
      });
      return falta;
    }
    return faltasMedicao(ponto, estado);
  }

  function itensFaltando(estado) {
    const c = estado && estado.campo;
    if (!c || !c.geral) return ['o monitoramento em campo não foi iniciado'];
    const total = Math.min(20, Math.max(1, parseInt(c.geral.qtdePontos, 10) || 0));
    const out = [];
    if (!c.geral.objetivo) out.push('objetivo do monitoramento');
    if (!(c.geral.checks && c.geral.checks.cfg0)) out.push('configuração do aparelho (sismograma/histograma)');
    if (ehCecav(estado)) {
      if (!c.geral.fonteVibracaoGeral) out.push('fonte de vibração');
      if (!(c.geral.checks && c.geral.checks.cfg1)) out.push('configuração do histograma (mínimo 15 minutos)');
      if (!(c.geral.checks && c.geral.checks.solocont0)) out.push('confirmação do solo contínuo entre a fonte e o ponto');
    }
    // Variação no nº de pontos vs. previsto na OS → exige justificativa.
    const previsto = (estado.dadosGerais || {}).qtdePontos;
    if (previsto != null && previsto !== '' && String(c.geral.qtdePontos) !== String(previsto) &&
        !String(c.geral.justificativaPontos || '').trim()) {
      out.push('justificativa da variação no número de pontos');
    }
    if (!total) { out.push('a quantidade de pontos do campo não foi definida'); return out; }
    for (let i = 0; i < total; i++) {
      itensFaltandoDoPonto(c.pontos[i], estado).forEach(function (x) { out.push('P' + (i + 1) + ': ' + x); });
    }
    return out;
  }

  /* ===== Entrada ===== */

  function renderizar(container, contexto) {
    ctx = contexto;
    raiz = container;
    if (!ctx.estado.campo) ctx.estado.campo = { geral: {}, pontos: [] };
    if (!ctx.estado.campo.geral) ctx.estado.campo.geral = {};
    if (!ctx.estado.campo.pontos) ctx.estado.campo.pontos = [];
    // Marca o subtipo no registro (o SGP distingue CECAV da NBR 9653 por aqui).
    if (ehCecav(ctx.estado)) ctx.estado.campo.subtipo = 'cecav';
    pontoExibido = 1;
    periodoExibido = periodosAtivos()[0];

    container.innerHTML =
      '<div id="cv-geral"></div>' +
      '<div id="cv-paginacao" class="cr-paginacao"></div>' +
      '<div id="cv-ponto"></div>';

    renderizarGeral();
  }

  return {
    renderizar: renderizar,
    itensFaltando: itensFaltando,
    TIPO_CARIMBO: TIPO_CARIMBO
  };
})();
