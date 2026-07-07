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

  // Categoria de cada equipamento (da lista do SGP p/ a variante 'qar'). Serve
  // para separar os selecionados em duas listas: Amostrador de Grande Volume e
  // Separador Inercial.
  function listaEquipQar() {
    return (EC.equip && EC.equip.porVariante) ? (EC.equip.porVariante('qar') || []) : [];
  }
  function categoriaDoEquip(codigo) {
    var e = listaEquipQar().filter(function (x) { return x.codigo === codigo; })[0];
    return e ? (e.categoria || '') : '';
  }
  // Códigos SELECIONADOS no pré-campo cuja categoria casa com o padrão.
  function selecionadosPorCategoria(regex) {
    return (ctx.estado.equipamentos || []).filter(function (c) {
      return regex.test((categoriaDoEquip(c) || '').toLowerCase());
    });
  }
  // Uma lista suspensa (só aparece se houver equipamento selecionado da categoria).
  function selectEquip(campoNome, rotulo, codigos) {
    if (!codigos.length) return '';
    return '<label>' + rotulo + '<select data-campo="' + campoNome + '"><option value="">Selecione…</option>' +
      codigos.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label>';
  }
  // Bloco de equipamentos do ponto: dois dropdowns (AGV + Separador). Se as
  // categorias não vierem (ex.: 1º uso offline), cai num dropdown único.
  function htmlEquipamentosQar() {
    var selecionados = ctx.estado.equipamentos || [];
    if (!selecionados.length) {
      return '<p class="texto-apoio">⚠️ Nenhum equipamento selecionado no pré-campo. Volte à seleção de equipamentos e marque os amostradores que vão para o campo.</p>';
    }
    var agvs = selecionadosPorCategoria(/amostrador|grande volume|agv/);
    var seps = selecionadosPorCategoria(/separador/);
    if (!agvs.length && !seps.length) {
      // sem categoria conhecida: dropdown único (compatibilidade)
      return '<label>Tipo de equipamento<select data-campo="tipoEquip"><option value="">Selecione…</option>' +
        selecionados.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label>';
    }
    return selectEquip('equipAGV', 'Amostrador de Grande Volume', agvs) +
      selectEquip('equipSeparador', 'Separador inercial', seps);
  }

  // Aviso do carvão do AGV escolhido: mostra a capacidade restante e alerta se as
  // coletas planejadas (somadas por AGV, em todos os pontos) passam do restante.
  // O restante vem do SGP na lista de equipamentos (carvaoRestante). Se o dado não
  // vier (offline/versão antiga do servidor), não mostra nada.
  function atualizarAvisoCarvao(area) {
    var div = area.querySelector('.cq-carvao-aviso');
    if (!div) return;
    var ponto = campo().pontos[pontoExibido - 1] || {};
    var cod = ponto.equipAGV;
    var item = cod ? listaEquipQar().filter(function (x) { return x.codigo === cod; })[0] : null;
    if (!item || typeof item.carvaoRestante !== 'number') { div.innerHTML = ''; return; }
    var restante = item.carvaoRestante;
    // total de coletas planejadas para ESTE AGV, somando todos os pontos.
    var planejado = 0;
    (campo().pontos || []).forEach(function (p) {
      if (p && p.equipAGV === cod) planejado += parseInt(p.qtdeColetas, 10) || 0;
    });
    var carv = item.carvaoCodigo ? ('Carvão ' + item.carvaoCodigo + ' · ') : '';
    if (restante <= 0) {
      div.innerHTML = '<div class="alerta alerta-vermelho">🔴 ' + carv + 'carvão esgotado — troque o carvão no SGP antes de usar este AGV.</div>';
    } else if (planejado > restante) {
      div.innerHTML = '<div class="alerta alerta-amarelo">⚠️ ' + carv + 'restam <strong>' + restante + '</strong> amostragem(ns), mas as coletas planejadas para este AGV somam <strong>' + planejado + '</strong>. Troque o carvão ou reduza as coletas.</div>';
    } else {
      div.innerHTML = '<div class="alerta alerta-info">🪨 ' + carv + '<strong>' + restante + '</strong> amostragem(ns) restante(s) no carvão.</div>';
    }
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

  // Coluna 800mm + Coluna 400mm (↑/↓) de uma placa de retenção. A chave interna
  // do 2º manômetro continua "_00sobe/_00desce" (não afeta rascunhos existentes
  // nem a leitura no servidor) — só o texto exibido mudou de 00 para 400 mm.
  function htmlCarta(prefixo) {
    return '<p class="cq-sub">Coluna 800 mm (cmH₂O)</p><div class="grade-2">' +
      lblNum('↑ Para cima', prefixo + '_800sobe') + lblNum('↓ Para baixo', prefixo + '_800desce') + '</div>' +
      '<p class="cq-sub">Coluna 400 mm (cmH₂O)</p><div class="grade-2">' +
      lblNum('↑ Para cima', prefixo + '_00sobe') + lblNum('↓ Para baixo', prefixo + '_00desce') + '</div>';
  }

  function htmlBlocoColeta(sufixo, extraAposHora) {
    return '<label>Data<input type="date" data-campo="data_' + sufixo + '"></label>' +
      '<label>Hora<input type="time" data-campo="hora_' + sufixo + '"></label>' +
      (extraAposHora || '') +
      lblNum('Horímetro', 'horimetro_' + sufixo) +
      '<div class="grade-2">' + lblNum('Temperatura (°C)', 'temp_' + sufixo) + lblNum('Umidade (%)', 'umid_' + sufixo) + '</div>' +
      '<div class="grade-2">' + lblNum('Pressão (mmHg)', 'pressao_' + sufixo) + lblNum('Velocidade do vento (m/s)', 'vento_' + sufixo) + '</div>' +
      '<label>Como está o tempo?<input type="text" placeholder="ex.: sol, nublado" data-campo="tempo_' + sufixo + '"></label>' +
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
        '<p class="grupo-checks-titulo">Dados iniciais</p>' +
        htmlBlocoColeta('ini', '<label>Código do filtro<input type="text" data-campo="codigoFiltro"></label>') +
        '<p class="grupo-checks-titulo">Dados finais</p>' + htmlBlocoColeta('fim') + '</div>';
    }
    div.innerHTML = html;
    div.querySelectorAll('.cartao-coleta').forEach(function (card, k) { vincular(card, ponto.coletas[k]); });
  }

  function renderizarPonto(n) {
    const area = $('#cq-ponto');
    const ponto = campo().pontos[n - 1];
    if (!ponto) { area.innerHTML = ''; return; }

    const html =
      '<div class="cartao-ponto"><h2>Ponto P' + n + '</h2>' +
      // Identificação
      '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      htmlEquipamentosQar() +
      '<div class="cq-carvao-aviso"></div>' +
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
      lblNum('Velocidade do vento (m/s)', 'vento') +
      '<label>Como está o tempo?<input type="text" placeholder="ex.: sol, nublado" data-campo="tempo"></label>' +
      '<p class="cq-passo">6º passo — Calibração (placas de retenção)</p>' +
      CARTAS.map(function (c) { return '<p class="grupo-checks-titulo">Placa de retenção ' + c + '</p>' + htmlCarta('carta' + c); }).join('') +
      '<p class="grupo-checks-titulo">Leitura com filtro no lugar</p>' +
      '<div class="grade-2">' + lblNum('Coluna 800 mm ↑', 'filtro_800sobe') + lblNum('Coluna 800 mm ↓', 'filtro_800desce') + '</div>' +
      htmlChecks(['Calibração aprovada'], 'calib') +
      '<label>Validade da calibração (em meses)<input type="number" min="0" step="1" inputmode="numeric" data-campo="validadeCalib"></label>' +
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
    area.querySelector('[data-campo="qtdeColetas"]').addEventListener('input', function () {
      renderColetas(area, ponto);
      atualizarAvisoCarvao(area);
    });
    // Aviso do carvão: atualiza ao render e quando trocam o AGV.
    atualizarAvisoCarvao(area);
    var selAgv = area.querySelector('[data-campo="equipAGV"]');
    if (selAgv) selAgv.addEventListener('change', function () { atualizarAvisoCarvao(area); });
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
    // Amostrador de Grande Volume é obrigatório; o Separador inercial é opcional
    // (PTS não usa separador). Aceita o campo antigo tipoEquip por compatibilidade.
    if (!(String(ponto.equipAGV || '').trim() || String(ponto.tipoEquip || '').trim())) falta.push('amostrador de grande volume');
    if (!ponto.gps) falta.push('GPS');
    if (!EC.foto.tem(ponto.fotoPonto)) falta.push('foto do ponto');
    grupoChecks('aquec', 1, 'aquecimento do motor');
    grupoChecks('zerar', 2, 'zerar manômetro');
    grupoChecks('vaz', 2, 'teste de vazamento');
    grupoChecks('porta', 1, 'porta filtro');
    reqVal('temperatura', 'temperatura'); reqVal('pressao', 'pressão'); reqVal('umidade', 'umidade');
    reqVal('vento', 'velocidade do vento'); reqVal('tempo', 'como está o tempo');
    grupoChecks('calib', 1, 'calibração aprovada');
    reqVal('validadeCalib', 'validade da calibração (em meses)');

    const nColetas = Math.min(20, Math.max(0, parseInt(ponto.qtdeColetas, 10) || 0));
    if (!nColetas) { falta.push('quantidade de coletas'); return falta; }
    (ponto.coletas || []).slice(0, nColetas).forEach(function (col, k) {
      col = col || {};
      ['ini', 'fim'].forEach(function (suf) {
        const rotPer = (suf === 'ini' ? 'inicial' : 'final');
        [['data_' + suf, 'data'], ['hora_' + suf, 'hora'], ['horimetro_' + suf, 'horímetro'],
         ['temp_' + suf, 'temperatura'], ['umid_' + suf, 'umidade'], ['pressao_' + suf, 'pressão'],
         ['vento_' + suf, 'velocidade do vento'], ['tempo_' + suf, 'como está o tempo']
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
