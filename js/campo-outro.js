/**
 * campo-outro.js — Monitoramento em campo: OUTRO (genérico)
 *
 * Tipo genérico (escopo "Outros") conforme `ecamp_especificacao.docx` item 8.6.
 * Sem subtipo. Campos gerais: tipo de monitoramento (texto), objetivo, qtde de
 * pontos. Por ponto: identificação, medição principal + unidade, 2 fotos,
 * condições ambientais (com alerta de vento ≥ 5 m/s) e observações.
 *
 * Interface (EC.campoOutro): renderizar(container, ctx) · itensFaltando(estado) · TIPO_CARIMBO
 * Depende de: EC.gps, EC.foto, EC.paginacao, EC.alertaVento.
 */
window.EC = window.EC || {};

EC.campoOutro = (function () {
  'use strict';

  const TIPO_CARIMBO = 'OUTRO';

  let ctx = null, raiz = null, pontoExibido = 1, temporizadorSalvar = null;

  function $(s) { return raiz.querySelector(s); }
  function campo() { return ctx.estado.campo; }
  function salvar() { ctx.salvar(); }
  function salvarDevagar() { clearTimeout(temporizadorSalvar); temporizadorSalvar = setTimeout(salvar, 400); }

  function vincular(elemento, alvo) {
    elemento.querySelectorAll('[data-campo]').forEach(function (el) {
      const c = el.dataset.campo;
      if (alvo[c] !== undefined && alvo[c] !== null) el.value = alvo[c];
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { alvo[c] = el.value; salvarDevagar(); });
    });
  }

  function montarGps(elemento, alvo) {
    const div = elemento.querySelector('.ou-gps');
    if (!div) return null;
    return EC.gps.criar(div, { dadosIniciais: alvo.gps || null, aoCapturar: function (d) { alvo.gps = d; salvar(); } });
  }
  function montarFoto(elemento, seletor, alvo, chave, rotulo, gps, etiqueta, numeroPonto) {
    const div = elemento.querySelector(seletor);
    if (!div) return;
    EC.foto.criar(div, {
      os: ctx.estado.os.numero, tipo: TIPO_CARIMBO + etiqueta, ponto: 'P' + String(numeroPonto).padStart(2, '0'),
      rotulo: rotulo, fotoInicial: alvo[chave] || null,
      obterUtm: function () { if (gps && gps.textoCarimbo()) return gps.textoCarimbo(); return (alvo.gps && alvo.gps.textoUtm) || ''; },
      aoCapturar: function (f) { alvo[chave] = f; salvar(); }
    });
  }

  /* ===== Campos gerais ===== */

  function renderizarGeral() {
    const area = $('#ou-geral');
    const g = campo().geral;
    area.innerHTML =
      '<label>Tipo de monitoramento<input type="text" data-campo="tipoMonitoramento"></label>' +
      '<label>Objetivo<input type="text" data-campo="objetivo"></label>' +
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
    if (!g.qtdePontos || total < 1) { $('#ou-paginacao').innerHTML = ''; $('#ou-ponto').innerHTML = ''; return; }
    while (campo().pontos.length < total) campo().pontos.push({});
    pontoExibido = Math.min(pontoExibido, total);
    EC.paginacao.criar($('#ou-paginacao'), {
      total: total,
      aoSair: function (numero) {
        const p = campo().pontos[numero - 1] || {};
        if (!EC.foto.tem(p.fotoTela) || !EC.foto.tem(p.fotoPonto)) {
          EC.app.mostrarToast('Tire as fotos do ponto P' + numero + ' antes de sair.');
          return false;
        }
        return true;
      },
      aoMudar: function (n) { pontoExibido = n; renderizarPonto(n); }
    });
    renderizarPonto(pontoExibido);
  }

  function renderizarPonto(n) {
    const area = $('#ou-ponto');
    const ponto = campo().pontos[n - 1];
    if (!ponto) { area.innerHTML = ''; return; }

    area.innerHTML =
      '<div class="cartao-ponto"><h2>Ponto P' + n + '</h2>' +
      '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
      '<div class="ou-gps"></div>' +
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      '<div class="grade-2">' +
      '  <label>Medição principal<input type="number" step="0.01" inputmode="decimal" data-campo="medicaoPrincipal"></label>' +
      '  <label>Unidade da medição<input type="text" data-campo="unidade" placeholder="ex.: dB, mg/m³"></label>' +
      '</div>' +
      '<div class="ou-foto-tela"></div>' +
      '<div class="ou-foto-ponto"></div>' +
      '<p class="grupo-checks-titulo">🌡️ Condições ambientais</p>' +
      '<div class="grade-2">' +
      '  <label>Temperatura<span class="unidade">(°C)</span><input type="number" step="0.1" inputmode="decimal" data-campo="temperatura"></label>' +
      '  <label>Umidade<span class="unidade">(%)</span><input type="number" step="1" min="0" max="100" inputmode="numeric" data-campo="umidade"></label>' +
      '</div>' +
      '<label>Vento<span class="unidade">(m/s)</span><input type="number" step="0.1" min="0" inputmode="decimal" data-campo="vento"></label>' +
      '<div class="alerta alerta-amarelo ou-alerta-vento oculto">⚠️ Esperar o vento abaixar. Não é aceito monitoramento com vento acima de 5 m/s.</div>' +
      '<label>Observações<textarea rows="2" data-campo="observacoes"></textarea></label>' +
      '</div>';

    vincular(area, ponto);
    const gps = montarGps(area, ponto);
    montarFoto(area, '.ou-foto-tela', ponto, 'fotoTela', '📷 Foto da tela do equipamento (obrigatória)', gps, 'TELA', n);
    montarFoto(area, '.ou-foto-ponto', ponto, 'fotoPonto', '📷 Foto do ponto (obrigatória)', gps, 'PONTO', n);

    const ventoInput = area.querySelector('[data-campo="vento"]');
    const ventoAlerta = area.querySelector('.ou-alerta-vento');
    function avaliarVento() {
      const v = ventoInput.value === '' ? null : parseFloat(ventoInput.value.replace(',', '.'));
      ventoAlerta.classList.toggle('oculto', !EC.alertaVento.avaliar(v));
    }
    ventoInput.addEventListener('input', avaliarVento);
    avaliarVento();
  }

  /* ===== Validação ===== */

  function itensFaltandoDoPonto(ponto) {
    ponto = ponto || {};
    const falta = [];
    const reqVal = function (chave, rotulo) {
      const v = ponto[chave];
      if (v === undefined || v === null || String(v).trim() === '') falta.push(rotulo);
    };
    reqVal('nome', 'nome do ponto');
    if (!ponto.gps) falta.push('GPS');
    reqVal('horaInicial', 'hora inicial');
    reqVal('medicaoPrincipal', 'medição principal');
    reqVal('unidade', 'unidade da medição');
    if (!EC.foto.tem(ponto.fotoTela)) falta.push('foto da tela do equipamento');
    if (!EC.foto.tem(ponto.fotoPonto)) falta.push('foto do ponto');
    reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento');
    // Observações são opcionais.
    return falta;
  }

  function itensFaltando(estado) {
    const c = estado && estado.campo;
    if (!c || !c.geral) return ['o monitoramento em campo não foi iniciado'];
    const total = Math.min(20, Math.max(1, parseInt(c.geral.qtdePontos, 10) || 0));
    const out = [];
    if (!c.geral.tipoMonitoramento) out.push('tipo de monitoramento');
    if (!c.geral.objetivo) out.push('objetivo');
    if (!total) { out.push('a quantidade de pontos não foi definida'); return out; }
    for (let i = 0; i < total; i++) {
      itensFaltandoDoPonto((c.pontos || [])[i]).forEach(function (x) { out.push('P' + (i + 1) + ': ' + x); });
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
      '<div id="ou-geral"></div>' +
      '<div id="ou-paginacao" class="cr-paginacao"></div>' +
      '<div id="ou-ponto"></div>';
    renderizarGeral();
  }

  return { renderizar: renderizar, itensFaltando: itensFaltando, TIPO_CARIMBO: TIPO_CARIMBO };
})();
