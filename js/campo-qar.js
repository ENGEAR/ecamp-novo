/**
 * campo-qar.js — Monitoramento em campo: QAR EXTERNO — Particulados
 *
 * Subtipo Particulados (escopos PTS, PM10, PM2,5). Conforme
 * `ecamp_especificacao.docx` item 8.3.1. Os demais subtipos do QAR (gases/
 * trigás, poeira sedimentável) entram depois.
 *
 * Estrutura por ponto:
 *   identificação → calibração (6 passos, com cronômetro no teste de vazamento
 *   e grade de 5 cartas) → coletas (quantidade variável, cada uma com dados
 *   iniciais e finais) → hora final.
 *
 * Interface (namespace global EC.campoQar):
 *   EC.campoQar.renderizar(container, ctx)
 *   EC.campoQar.itensFaltando(estado) → ['P1: ...', ...]
 *   EC.campoQar.TIPO_CARIMBO
 *
 * Depende de: EC.gps, EC.paginacao.
 */
window.EC = window.EC || {};

EC.campoQar = (function () {
  'use strict';

  const TIPO_CARIMBO = 'QARPARTICULADO';
  const CARTAS = ['18', '13', '10', '09', '08'];

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

  function lblNum(rotulo, campoNome) {
    return '<label>' + rotulo + '<input type="number" step="0.01" inputmode="decimal" data-campo="' + campoNome + '"></label>';
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
    const div = elemento.querySelector('.cq-gps');
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

  // Cronômetro de auxílio (não é salvo) — para cronometrar o teste de vazamento.
  function montarCronometro(div) {
    div.innerHTML =
      '<div class="cq-cronometro"><button type="button" class="botao botao-mini cq-go">▶ Iniciar</button>' +
      '<button type="button" class="botao botao-mini cq-zero">Zerar</button><span class="cq-disp">00:00</span></div>';
    const go = div.querySelector('.cq-go');
    const zero = div.querySelector('.cq-zero');
    const disp = div.querySelector('.cq-disp');
    let acc = 0, inicio = null, timer = null;
    function fmt(ms) { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
    function mostrar() {
      if (!document.body.contains(disp)) { clearInterval(timer); return; } // tela trocada
      disp.textContent = fmt(acc + (inicio ? Date.now() - inicio : 0));
    }
    go.addEventListener('click', function () {
      if (inicio) { acc += Date.now() - inicio; inicio = null; clearInterval(timer); timer = null; go.textContent = '▶ Iniciar'; }
      else { inicio = Date.now(); timer = setInterval(mostrar, 250); go.textContent = '⏸ Pausar'; }
    });
    zero.addEventListener('click', function () { acc = 0; inicio = null; clearInterval(timer); timer = null; go.textContent = '▶ Iniciar'; mostrar(); });
  }

  /* ===== Campos gerais ===== */

  function renderizarGeral() {
    const area = $('#cq-geral');
    const g = campo().geral;
    area.innerHTML =
      '<label>Objetivo<select data-campo="objetivo">' +
      '<option value="">Selecione…</option><option>Operações da Empresa</option><option>Background</option>' +
      '</select></label>' +
      '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>';
    if (g.qtdePontos === undefined) g.qtdePontos = ctx.estado.dadosGerais.qtdePontos;
    vincular(area, g);
    area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', renderizarPontos);
    renderizarPontos();
  }

  /* ===== Pontos paginados ===== */

  function renderizarPontos() {
    const g = campo().geral;
    const total = Math.min(20, Math.max(1, parseInt(g.qtdePontos, 10) || 0));
    if (!g.qtdePontos || total < 1) { $('#cq-paginacao').innerHTML = ''; $('#cq-ponto').innerHTML = ''; return; }
    while (campo().pontos.length < total) campo().pontos.push({});
    pontoExibido = Math.min(pontoExibido, total);
    EC.paginacao.criar($('#cq-paginacao'), {
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

  // Coluna 800mm + Coluna 00mm (↑/↓) de uma carta de calibração.
  function htmlCarta(prefixo) {
    return '<p class="cq-sub">Coluna 800 mm (cmH₂O)</p><div class="grade-2">' +
      lblNum('↑ Para cima', prefixo + '_800sobe') + lblNum('↓ Para baixo', prefixo + '_800desce') + '</div>' +
      '<p class="cq-sub">Coluna 00 mm (cmH₂O)</p><div class="grade-2">' +
      lblNum('↑ Para cima', prefixo + '_00sobe') + lblNum('↓ Para baixo', prefixo + '_00desce') + '</div>';
  }

  function htmlBlocoColeta(sufixo) {
    return '<label>Data<input type="date" data-campo="data_' + sufixo + '"></label>' +
      '<label>Hora<input type="time" data-campo="hora_' + sufixo + '"></label>' +
      lblNum('Horímetro', 'horimetro_' + sufixo) +
      '<div class="grade-2">' + lblNum('Temperatura (°C)', 'temp_' + sufixo) + lblNum('Umidade (%)', 'umid_' + sufixo) + '</div>' +
      lblNum('Pressão (mmHg)', 'pressao_' + sufixo) +
      '<p class="cq-sub">Coluna 800 mm (cmH₂O)</p><div class="grade-2">' +
      lblNum('↑ Para cima', 'col800sobe_' + sufixo) + lblNum('↓ Para baixo', 'col800desce_' + sufixo) + '</div>';
  }

  function renderColetas(area, ponto) {
    const div = area.querySelector('#cq-coletas');
    const n = Math.min(20, Math.max(0, parseInt(ponto.qtdeColetas, 10) || 0));
    ponto.coletas = ponto.coletas || [];
    while (ponto.coletas.length < n) ponto.coletas.push({});
    let html = '';
    for (let k = 0; k < n; k++) {
      html += '<div class="cartao-coleta"><h3>' + (k + 1) + 'ª coleta</h3>' +
        '<p class="grupo-checks-titulo">Dados iniciais</p>' + htmlBlocoColeta('ini') +
        '<p class="grupo-checks-titulo">Dados finais</p>' + htmlBlocoColeta('fim') + '</div>';
    }
    div.innerHTML = html;
    div.querySelectorAll('.cartao-coleta').forEach(function (card, k) { vincular(card, ponto.coletas[k]); });
  }

  function renderizarPonto(n) {
    const area = $('#cq-ponto');
    const ponto = campo().pontos[n - 1];
    if (!ponto) { area.innerHTML = ''; return; }
    const equipSelecionados = ctx.estado.equipamentos || [];

    const html =
      '<div class="cartao-ponto"><h2>Ponto P' + n + '</h2>' +
      // Identificação
      '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      (equipSelecionados.length
        ? '<label>Tipo de equipamento<select data-campo="tipoEquip"><option value="">Selecione…</option>' +
          equipSelecionados.map(function (c) { return '<option>' + c + '</option>'; }).join('') +
          '</select></label>'
        : '<p class="texto-apoio">⚠️ Nenhum equipamento selecionado no pré-campo. Volte à seleção de equipamentos e marque os amostradores que vão para o campo.</p>') +
      '<div class="cq-gps"></div>' +
      '<div class="cq-foto-ponto"></div>' +
      // Calibração
      '<p class="grupo-checks-titulo">🔧 Calibração</p>' +
      '<p class="cq-passo">1º passo — Aquecimento do motor</p>' + htmlChecks(['Motor aquecido'], 'aquec') +
      '<p class="cq-passo">2º passo — Zerar manômetro</p>' + htmlChecks(['Manômetro zerado', 'Válvulas fechadas'], 'zerar') +
      '<p class="cq-passo">3º passo — Teste de vazamento</p>' +
      '<label class="linha-check check-campo"><input type="checkbox" data-check="vaz0"><span>Manômetro 800 mm — vazamento OK</span></label>' +
      '<div class="cq-crono" data-crono="800"></div>' +
      '<label class="linha-check check-campo"><input type="checkbox" data-check="vaz1"><span>Manômetro 400 mm — vazamento OK</span></label>' +
      '<div class="cq-crono" data-crono="400"></div>' +
      '<p class="cq-passo">4º passo — Porta filtro e porta motor</p>' + htmlChecks(['Nenhuma fuga de ar detectada'], 'porta') +
      '<p class="cq-passo">5º passo — Condições ambientais</p>' +
      lblNum('Temperatura (°C)', 'temperatura') + lblNum('Pressão (mmHg)', 'pressao') + lblNum('Umidade (%)', 'umidade') +
      '<p class="cq-passo">6º passo — Calibração (cartas)</p>' +
      CARTAS.map(function (c) { return '<p class="grupo-checks-titulo">Carta ' + c + '</p>' + htmlCarta('carta' + c); }).join('') +
      '<p class="grupo-checks-titulo">Leitura com filtro no lugar</p>' +
      '<div class="grade-2">' + lblNum('Coluna 800 mm ↑', 'filtro_800sobe') + lblNum('Coluna 800 mm ↓', 'filtro_800desce') + '</div>' +
      htmlChecks(['Calibração aprovada'], 'calib') +
      '<label>Validade da calibração<input type="text" data-campo="validadeCalib"></label>' +
      // Coletas
      '<label>Quantas coletas neste ponto?<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdeColetas"></label>' +
      '<div id="cq-coletas"></div>' +
      // Finalização
      '<label>Hora final<input type="time" data-campo="horaFinal"></label>' +
      '</div>';
    area.innerHTML = html;

    vincular(area, ponto);
    const gpsInstancia = montarGps(area, ponto);
    montarFoto(area, '.cq-foto-ponto', ponto, 'fotoPonto', '📷 Foto do ponto (obrigatória)', gpsInstancia, n);
    area.querySelectorAll('.cq-crono').forEach(montarCronometro);
    renderColetas(area, ponto);
    area.querySelector('[data-campo="qtdeColetas"]').addEventListener('input', function () { renderColetas(area, ponto); });
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
      let nn = 0;
      for (let i = 0; i < qtde; i++) if (!checks[prefixo + i]) nn++;
      if (nn) falta.push(nn + ' confirmação(ões) de ' + rotulo);
    };

    reqVal('nome', 'nome do ponto');
    reqVal('horaInicial', 'hora inicial');
    reqVal('tipoEquip', 'tipo de equipamento');
    if (!ponto.gps) falta.push('GPS');
    if (!EC.foto.tem(ponto.fotoPonto)) falta.push('foto do ponto');
    grupoChecks('aquec', 1, 'aquecimento do motor');
    grupoChecks('zerar', 2, 'zerar manômetro');
    grupoChecks('vaz', 2, 'teste de vazamento');
    grupoChecks('porta', 1, 'porta filtro');
    reqVal('temperatura', 'temperatura'); reqVal('pressao', 'pressão'); reqVal('umidade', 'umidade');
    grupoChecks('calib', 1, 'calibração aprovada');
    reqVal('validadeCalib', 'validade da calibração');

    const nColetas = Math.min(20, Math.max(0, parseInt(ponto.qtdeColetas, 10) || 0));
    if (!nColetas) { falta.push('quantidade de coletas'); return falta; }
    (ponto.coletas || []).slice(0, nColetas).forEach(function (col, k) {
      col = col || {};
      ['ini', 'fim'].forEach(function (suf) {
        const rotPer = (suf === 'ini' ? 'inicial' : 'final');
        [['data_' + suf, 'data'], ['hora_' + suf, 'hora'], ['horimetro_' + suf, 'horímetro'],
         ['temp_' + suf, 'temperatura'], ['umid_' + suf, 'umidade'], ['pressao_' + suf, 'pressão']
        ].forEach(function (par) {
          const v = col[par[0]];
          if (v === undefined || v === null || String(v).trim() === '') falta.push((k + 1) + 'ª coleta: ' + par[1] + ' ' + rotPer);
        });
      });
    });
    // As leituras de manômetro (cartas e colunas) e a hora final são opcionais.
    return falta;
  }

  function itensFaltando(estado) {
    const c = estado && estado.campo;
    if (!c || !c.geral) return ['o monitoramento em campo não foi iniciado'];
    const total = Math.min(20, Math.max(1, parseInt(c.geral.qtdePontos, 10) || 0));
    const out = [];
    if (!c.geral.objetivo) out.push('objetivo do monitoramento');
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
      '<div id="cq-geral"></div>' +
      '<div id="cq-paginacao" class="cr-paginacao"></div>' +
      '<div id="cq-ponto"></div>';
    renderizarGeral();
  }

  return {
    renderizar: renderizar,
    itensFaltando: itensFaltando,
    TIPO_CARIMBO: TIPO_CARIMBO
  };
})();
