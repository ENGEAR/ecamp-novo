/**
 * campo-vibracao.js — Monitoramento em campo: VIBRAÇÃO (Sismografia)
 *
 * Usado nos escopos de Vibração (Sismografia – NBR 9653, Patrimônio
 * Espeleológico – CECAV, Áreas Habitadas – CETESB DD 215/2007). Não há subtipo;
 * os métodos Usual/Online usam o mesmo formulário por enquanto.
 *
 * Conteúdo conforme `ecamp_especificacao.docx` item 8.2:
 *   Campos gerais: Objetivo + Quantidade de pontos.
 *   Por ponto (paginado): identificação, escolha do local, instalação do
 *   geofone (solo / solo rígido), instalação do microfone, fonte de vibração,
 *   auto verificação, foto, durante o monitoramento, intercorrências, hora final.
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

  function renderizarGeral() {
    const area = $('#cv-geral');
    const g = campo().geral;
    area.innerHTML =
      '<label>Objetivo<select data-campo="objetivo">' +
      '<option value="">Selecione…</option><option>Vibrações da Empresa</option><option>Vibrações do Ambiente</option>' +
      '</select></label>' +
      '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>' +
      '<p class="grupo-checks-titulo">⚙️ Configuração do aparelho</p>' +
      htmlChecks(['Configuração do aparelho em sismograma (trigger) e histograma'], 'cfg');
    if (g.qtdePontos === undefined) g.qtdePontos = ctx.estado.dadosGerais.qtdePontos;
    vincular(area, g);
    area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', renderizarPontos);
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
      aoSair: function (numero) {
        if (!EC.foto.tem(campo().pontos[numero - 1].fotoPonto)) {
          EC.app.mostrarToast('Tire a foto do ponto P' + numero + ' antes de sair.');
          return false;
        }
        return true;
      },
      aoMudar: function (n) { pontoExibido = n; renderizarPonto(n); }
    });
    renderizarPonto(pontoExibido);
  }

  function renderizarPonto(n) {
    const area = $('#cv-ponto');
    const ponto = campo().pontos[n - 1];
    if (!ponto) { area.innerHTML = ''; return; }

    const html =
      '<div class="cartao-ponto"><h2>Ponto P' + n + '</h2>' +
      // 1. Identificação
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      '<label>Nome do ponto<input type="text" data-campo="nome"></label>' +
      '<label>Tipo de equipamento<select data-campo="tipoEquip"><option value="">Selecione…</option>' +
      TIPOS_EQUIP.map(function (o) { return '<option>' + o + '</option>'; }).join('') +
      '</select></label>' +
      '<label>Nº do equipamento<input type="text" data-campo="numeroEquip"></label>' +
      '<div class="cv-gps"></div>' +
      // 2. Escolha do local
      '<p class="grupo-checks-titulo">📍 Escolha do local</p>' + htmlChecks(CHECKS_LOCAL, 'local') +
      // 3. Instalação do geofone — preencher UMA das três opções
      '<label>Instalação do geofone (preencher uma opção)<select data-campo="instalGeofone"><option value="">Selecione…</option>' +
      '<option>Solo</option><option>Superfície rígida</option><option>Alternativa</option></select></label>' +
      '<div id="cv-instal-geofone"></div>' +
      // 5. Instalação do microfone
      '<p class="grupo-checks-titulo">🎙️ Instalação do microfone</p>' + htmlChecks(CHECKS_MICROFONE, 'mic') +
      // 6. Fonte de vibração
      '<label>Fonte de vibração<input type="text" data-campo="fonteVibracao"></label>' +
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
      '</div>';
    area.innerHTML = html;

    vincular(area, ponto);
    const gpsInstancia = montarGps(area, ponto);
    montarFoto(area, '.cv-foto-ponto', ponto, 'fotoPonto', '📷 Foto do ponto (obrigatória)', gpsInstancia, n);

    // instalação do geofone: mostra os checks da opção escolhida (uma das três)
    const selGeo = area.querySelector('[data-campo="instalGeofone"]');
    const divGeo = area.querySelector('#cv-instal-geofone');
    function renderGeofone() {
      const cfg = INSTAL_GEOFONE[selGeo.value];
      if (cfg) {
        divGeo.innerHTML = '<p class="grupo-checks-titulo">⚙️ Instalação do geofone — ' + selGeo.value.toLowerCase() + '</p>' + htmlChecks(cfg.checks, cfg.prefixo);
        vincular(divGeo, ponto);
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
        vincular(divDesc, ponto);
      } else {
        divDesc.innerHTML = '';
      }
    }
    seletor.addEventListener('change', descricao);
    descricao();
  }

  /* ===== Validação ===== */

  function itensFaltandoDoPonto(ponto, indice) {
    ponto = ponto || {};
    const falta = [];
    const reqVal = function (chave, rotulo) {
      const v = ponto[chave];
      if (v === undefined || v === null || String(v).trim() === '') falta.push(rotulo);
    };
    const checks = ponto.checks || {};
    const grupoChecks = function (prefixo, qtde, rotulo) {
      let n = 0;
      for (let i = 0; i < qtde; i++) if (!checks[prefixo + i]) n++;
      if (n) falta.push(n + ' confirmação(ões) de ' + rotulo);
    };

    reqVal('horaInicial', 'hora inicial');
    reqVal('nome', 'nome do ponto');
    reqVal('tipoEquip', 'tipo de equipamento');
    reqVal('numeroEquip', 'nº do equipamento');
    if (!ponto.gps) falta.push('GPS');
    reqVal('fonteVibracao', 'fonte de vibração');
    reqVal('instalGeofone', 'instalação do geofone');
    const cfgGeo = INSTAL_GEOFONE[ponto.instalGeofone];
    if (cfgGeo) grupoChecks(cfgGeo.prefixo, cfgGeo.checks.length, 'instalação do geofone (' + ponto.instalGeofone.toLowerCase() + ')');
    grupoChecks('autoverif', 1, 'auto verificação');
    if (!EC.foto.tem(ponto.fotoPonto)) falta.push('foto do ponto');
    grupoChecks('monit', CHECKS_MONITORAMENTO.length, 'durante o monitoramento');
    reqVal('intercorrencia', 'intercorrências');
    if (ponto.intercorrencia === 'Sim') reqVal('intercorrenciaDesc', 'descrição da intercorrência');
    // Hora final é opcional (como a hora de término no ruído).
    // Checks de local/geofone/microfone são situacionais → não bloqueiam.
    return falta;
  }

  function itensFaltando(estado) {
    const c = estado && estado.campo;
    if (!c || !c.geral) return ['o monitoramento em campo não foi iniciado'];
    const total = Math.min(20, Math.max(1, parseInt(c.geral.qtdePontos, 10) || 0));
    const out = [];
    if (!c.geral.objetivo) out.push('objetivo do monitoramento');
    if (!(c.geral.checks && c.geral.checks.cfg0)) out.push('configuração do aparelho (sismograma/histograma)');
    if (!total) { out.push('a quantidade de pontos do campo não foi definida'); return out; }
    for (let i = 0; i < total; i++) {
      itensFaltandoDoPonto(c.pontos[i], i).forEach(function (x) { out.push('P' + (i + 1) + ': ' + x); });
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
    pontoExibido = 1;

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
