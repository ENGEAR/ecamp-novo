/**
 * campo-qarint.js — Monitoramento em campo: QAR INTERNO (Ar Interno – MQAI)
 *
 * Conforme `ecamp_especificacao.docx` item 8.5. Estrutura ANINHADA:
 *   Quantidade de ambientes → (por ambiente) área → "calcular pontos" →
 *   (por ponto dentro do ambiente) o formulário; o último ponto é sempre o
 *   ponto EXTERNO de referência.
 *
 * Decisões da Raisa (28/06/2026): travam o salvamento só o essencial
 * (identificação, posicionamento, vazão, medições, conformidade, 3 fotos);
 * as sub-listas de coleta de fungos/filtro/transporte são orientação (não
 * travam).
 *
 * Interface (EC.campoQarInterno):
 *   renderizar(container, ctx) · itensFaltando(estado) · TIPO_CARIMBO
 *
 * Depende de: EC.gps, EC.foto, EC.paginacao.
 */
window.EC = window.EC || {};

EC.campoQarInterno = (function () {
  'use strict';

  const TIPO_CARIMBO = 'QARINTERNO';

  const CHECKS_POSICIONAMENTO = [
    'Sistema de climatização ligado',
    'Análise da qualidade do ar com taxa de ocupação típica do ambiente',
    'Ponto localizado em área de maior ocupação',
    'Equipamentos calibrados',
    'Pontos posicionados corretamente (1,5 m do piso, afastado de paredes, longe de insuflamento direto, distante do operador, no tripé, distribuído uniformemente)',
    'Medições realizadas longe de fontes poluentes externas (resíduos, automóveis, jardins, obras, combustão)',
    'Vazão entre 25,5 e 31,1 L/min',
    'Evitar medição diretamente na saída do ar'
  ];
  const CHECKS_CONFORMIDADE = ['Critérios de conformidade verificados', 'Amostras armazenadas'];

  const FUNGOS = [
    { sub: 'Antes da coleta:', texto: 'Verificar vazão da bomba' },
    { sub: null, texto: 'Vazão entre 25,5 e 31,1 L/min' },
    { sub: null, texto: 'Registrar verificação da vazão' },
    { sub: 'Durante a coleta:', texto: 'Inserir placa corretamente' },
    { sub: null, texto: 'Retirar tampa da placa somente no momento da coleta' },
    { sub: null, texto: 'Programar tempo de coleta' },
    { sub: null, texto: 'Registrar horário inicial' },
    { sub: null, texto: 'Registrar horário final' },
    { sub: null, texto: 'Registrar volume amostrado' },
    { sub: 'Após a coleta:', texto: 'Tampar placa imediatamente' },
    { sub: null, texto: 'Vedação com fita' },
    { sub: null, texto: 'Identificar placa' },
    { sub: null, texto: 'Acondicionar em caixa isotérmica' },
    { sub: null, texto: 'Higienizar impactador com álcool 70%' }
  ];
  const FILTRO = [
    { sub: 'Antes da coleta:', texto: 'Registrar código do filtro' },
    { sub: null, texto: 'Verificar integridade do porta-filtro' },
    { sub: null, texto: 'Realizar calibração inicial' },
    { sub: null, texto: 'Ajustar vazão para 3 L/min' },
    { sub: 'Durante a coleta:', texto: 'Posicionar entrada de ar corretamente' },
    { sub: null, texto: 'Registrar horário inicial' },
    { sub: null, texto: 'Registrar horário final' },
    { sub: null, texto: 'Registrar volume coletado' },
    { sub: 'Após a coleta:', texto: 'Fechar porta-filtro com plugues' },
    { sub: null, texto: 'Armazenar corretamente' },
    { sub: null, texto: 'Evitar movimentação brusca' },
    { sub: null, texto: 'Realizar calibração final' },
    { sub: null, texto: 'Verificar variação máxima de 5%' }
  ];
  const TRANSPORTE = [
    'Amostras acondicionadas corretamente', 'Caixa isotérmica fechada', 'Gelo reciclável presente',
    'Amostras identificadas com risco biológico', 'Cadeia de custódia preenchida', 'Envio ao laboratório realizado rapidamente'
  ];
  const MEDICOES = [
    ['co2', 'CO₂ (ppm)'], ['temp', 'Temperatura (°C)'], ['ur', 'Umidade relativa (%)'], ['velar', 'Velocidade do ar (m/s)'],
    ['pm25', 'PM2,5 (μg/m³)'], ['pm10', 'PM10 (μg/m³)'], ['particulas', 'Partículas (per/L)']
  ];

  let ctx = null, raiz = null, ambienteExibido = 1, pontoExibido = 1, temporizadorSalvar = null;

  function $(s) { return raiz.querySelector(s); }
  function campo() { return ctx.estado.campo; }
  function salvar() { ctx.salvar(); }
  function salvarDevagar() { clearTimeout(temporizadorSalvar); temporizadorSalvar = setTimeout(salvar, 400); }

  function lblNum(rotulo, c) { return '<label>' + rotulo + '<input type="number" step="0.01" inputmode="decimal" data-campo="' + c + '"></label>'; }
  function htmlChecks(itens, prefixo) {
    return itens.map(function (t, i) { return '<label class="linha-check check-campo"><input type="checkbox" data-check="' + prefixo + i + '"><span>' + t + '</span></label>'; }).join('');
  }
  function htmlChecksSub(lista, prefixo) {
    return lista.map(function (it, i) {
      return (it.sub ? '<p class="subgrupo-titulo">' + it.sub + '</p>' : '') +
        '<label class="linha-check check-campo"><input type="checkbox" data-check="' + prefixo + i + '"><span>' + it.texto + '</span></label>';
    }).join('');
  }

  function vincular(elemento, alvo) {
    elemento.querySelectorAll('[data-campo]').forEach(function (el) {
      const c = el.dataset.campo;
      if (alvo[c] !== undefined && alvo[c] !== null) el.value = alvo[c];
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { alvo[c] = el.value; salvarDevagar(); });
    });
    elemento.querySelectorAll('[data-check]').forEach(function (el) {
      const c = el.dataset.check;
      alvo.checks = alvo.checks || {};
      el.checked = !!alvo.checks[c];
      el.addEventListener('change', function () { alvo.checks[c] = el.checked; salvarDevagar(); });
    });
  }

  function montarGps(elemento, alvo) {
    const div = elemento.querySelector('.qi-gps');
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

  // Pontos de amostragem pela área (m²); o ponto externo de referência é somado à parte.
  function pontosPorArea(area) {
    const a = parseFloat(String(area || '').replace(',', '.')) || 0;
    if (a <= 0) return 0;
    if (a <= 1000) return 1;
    if (a <= 2000) return 3;
    if (a <= 3000) return 5;
    if (a <= 5000) return 8;
    if (a <= 10000) return 12;
    if (a <= 15000) return 15;
    if (a <= 20000) return 18;
    if (a <= 30000) return 21;
    return 25;
  }

  /* ===== Geral + ambientes (1º nível de paginação) ===== */

  function renderizarGeral() {
    const area = $('#qi-geral');
    const g = campo().geral;
    area.innerHTML = '<label>Quantidade de ambientes (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdeAmbientes"></label>';
    if (g.qtdeAmbientes === undefined) g.qtdeAmbientes = 1;
    vincular(area, g);
    area.querySelector('[data-campo="qtdeAmbientes"]').addEventListener('input', renderizarAmbientes);
    renderizarAmbientes();
  }

  function renderizarAmbientes() {
    const g = campo().geral;
    const total = Math.min(20, Math.max(1, parseInt(g.qtdeAmbientes, 10) || 0));
    if (!g.qtdeAmbientes || total < 1) { $('#qi-amb-paginacao').innerHTML = ''; $('#qi-ambiente').innerHTML = ''; return; }
    while (campo().ambientes.length < total) campo().ambientes.push({ pontos: [] });
    ambienteExibido = Math.min(ambienteExibido, total);
    EC.paginacao.criar($('#qi-amb-paginacao'), {
      total: total, rotulo: 'Amb ',
      aoMudar: function (a) { ambienteExibido = a; pontoExibido = 1; renderizarAmbiente(a); }
    });
    renderizarAmbiente(ambienteExibido);
  }

  function renderizarAmbiente(a) {
    const area = $('#qi-ambiente');
    const amb = campo().ambientes[a - 1];
    if (!amb) { area.innerHTML = ''; return; }
    if (!amb.pontos) amb.pontos = [];
    area.innerHTML =
      '<div class="cartao-coleta"><h3>Ambiente ' + a + '</h3>' +
      '<label>Nome do ambiente<input type="text" data-campo="nome"></label>' +
      '<label>Área climatizada (m²)<input type="number" min="1" step="0.1" inputmode="decimal" data-campo="area"></label>' +
      '<button type="button" class="botao botao-secundario" id="qi-calcular">Calcular pontos necessários</button>' +
      '<div id="qi-pontos"></div></div>';
    vincular(area, amb);
    area.querySelector('#qi-calcular').addEventListener('click', function () {
      const n = pontosPorArea(amb.area);
      if (!n) { EC.app.mostrarToast('Informe a área do ambiente primeiro.'); return; }
      amb.pontosCalculados = n;
      salvar();
      renderPontos(amb);
    });
    if (amb.pontosCalculados) renderPontos(amb);
  }

  /* ===== Pontos dentro do ambiente (2º nível de paginação) ===== */

  function renderPontos(amb) {
    const div = $('#qi-pontos');
    const total = amb.pontosCalculados + 1; // +1 ponto externo de referência
    while (amb.pontos.length < total) amb.pontos.push({});
    pontoExibido = Math.min(pontoExibido, total);
    div.innerHTML =
      '<div class="alerta alerta-info">📐 ' + amb.pontosCalculados + ' ponto(s) de amostragem + 1 ponto externo (referência) = <strong>' + total + '</strong> pontos.</div>' +
      '<div id="qi-pt-paginacao" class="cr-paginacao"></div><div id="qi-ponto"></div>';
    EC.paginacao.criar($('#qi-pt-paginacao'), {
      total: total, rotulo: 'P',
      aoSair: function (numero) {
        const p = amb.pontos[numero - 1] || {};
        if (!p.fotoPonto || !p.fotoTela || !p.fotoAmbiente) {
          EC.app.mostrarToast('Tire as 3 fotos do ponto P' + numero + ' antes de sair.');
          return false;
        }
        return true;
      },
      aoMudar: function (p) { pontoExibido = p; renderizarPonto(amb, p); }
    });
    renderizarPonto(amb, pontoExibido);
  }

  function renderizarPonto(amb, p) {
    const area = $('#qi-ponto');
    const ponto = amb.pontos[p - 1];
    if (!ponto) { area.innerHTML = ''; return; }
    const total = amb.pontosCalculados + 1;
    const ehExterno = (p === total);

    const html =
      '<div class="cartao-ponto"><h2>Ponto P' + p + (ehExterno ? ' — Externo (referência)' : '') + '</h2>' +
      '<label>Nome do ponto<input type="text" data-campo="nome"></label>' +
      '<div class="qi-gps"></div>' +
      '<label>Endereço completo (rua, número, cidade, estado)<input type="text" data-campo="endereco"></label>' +
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      '<label>Quantidade aproximada de pessoas<input type="number" min="0" inputmode="numeric" data-campo="pessoas"></label>' +
      '<label>Janela<select data-campo="janela"><option value="">Selecione…</option><option>Aberta</option><option>Fechada</option></select></label>' +
      '<p class="grupo-checks-titulo">📍 Posicionamento e verificações</p>' + htmlChecks(CHECKS_POSICIONAMENTO, 'pos') +
      '<label>Valor da vazão (L/min)<input type="number" step="0.01" inputmode="decimal" data-campo="valorVazao"></label>' +
      '<p class="grupo-checks-titulo">🌬️ Coleta de fungos (orientação)</p>' + htmlChecksSub(FUNGOS, 'fung') +
      '<p class="grupo-checks-titulo">📊 Medições</p>' + MEDICOES.map(function (m) { return lblNum(m[1], m[0]); }).join('') +
      htmlChecks(CHECKS_CONFORMIDADE, 'conf') +
      '<p class="grupo-checks-titulo">🧫 Coleta de filtro (orientação)</p>' + htmlChecksSub(FILTRO, 'filt') +
      '<p class="grupo-checks-titulo">🚚 Transporte das amostras (orientação)</p>' + htmlChecks(TRANSPORTE, 'transp') +
      '<p class="grupo-checks-titulo">📷 Fotos (obrigatórias)</p>' +
      '<div class="qi-foto-ponto"></div><div class="qi-foto-tela"></div><div class="qi-foto-amb"></div>' +
      '<label>Hora final<input type="time" data-campo="horaFinal"></label>' +
      '<label>Observações<textarea rows="2" data-campo="observacoes"></textarea></label>' +
      '</div>';
    area.innerHTML = html;

    vincular(area, ponto);
    const gps = montarGps(area, ponto);
    montarFoto(area, '.qi-foto-ponto', ponto, 'fotoPonto', '📷 Foto do ponto (obrigatória)', gps, 'PONTO', p);
    montarFoto(area, '.qi-foto-tela', ponto, 'fotoTela', '📷 Foto da tela dos equipamentos (obrigatória)', gps, 'TELA', p);
    montarFoto(area, '.qi-foto-amb', ponto, 'fotoAmbiente', '📷 Foto do ambiente geral (obrigatória)', gps, 'AMBIENTE', p);
  }

  /* ===== Validação (só o essencial trava) ===== */

  function itensFaltandoDoPonto(ponto) {
    ponto = ponto || {};
    const falta = [];
    const reqVal = function (chave, rotulo) {
      const v = ponto[chave];
      if (v === undefined || v === null || String(v).trim() === '') falta.push(rotulo);
    };
    const checks = ponto.checks || {};
    const grupoChecks = function (prefixo, qtde, rotulo) {
      let n = 0; for (let i = 0; i < qtde; i++) if (!checks[prefixo + i]) n++;
      if (n) falta.push(n + ' confirmação(ões) de ' + rotulo);
    };
    reqVal('nome', 'nome do ponto');
    if (!ponto.gps) falta.push('GPS');
    reqVal('endereco', 'endereço completo');
    reqVal('horaInicial', 'hora inicial');
    reqVal('pessoas', 'quantidade de pessoas');
    reqVal('janela', 'janela (aberta/fechada)');
    grupoChecks('pos', CHECKS_POSICIONAMENTO.length, 'posicionamento');
    reqVal('valorVazao', 'valor da vazão');
    MEDICOES.forEach(function (m) { reqVal(m[0], m[1]); });
    grupoChecks('conf', CHECKS_CONFORMIDADE.length, 'conformidade');
    if (!ponto.fotoPonto) falta.push('foto do ponto');
    if (!ponto.fotoTela) falta.push('foto da tela dos equipamentos');
    if (!ponto.fotoAmbiente) falta.push('foto do ambiente geral');
    // fungos / filtro / transporte e a hora final NÃO travam (orientação).
    return falta;
  }

  function itensFaltando(estado) {
    const c = estado && estado.campo;
    if (!c || !c.geral) return ['o monitoramento em campo não foi iniciado'];
    const totalAmb = Math.min(20, Math.max(1, parseInt(c.geral.qtdeAmbientes, 10) || 0));
    const out = [];
    if (!totalAmb) { out.push('a quantidade de ambientes não foi definida'); return out; }
    for (let a = 0; a < totalAmb; a++) {
      const amb = (c.ambientes || [])[a] || {};
      const rotAmb = 'A' + (a + 1);
      if (!amb.nome) out.push(rotAmb + ': nome do ambiente');
      if (amb.area === undefined || String(amb.area).trim() === '') out.push(rotAmb + ': área climatizada');
      if (!amb.pontosCalculados) { out.push(rotAmb + ': calcular os pontos (informe a área e toque em Calcular)'); continue; }
      const totalPt = amb.pontosCalculados + 1;
      for (let p = 0; p < totalPt; p++) {
        itensFaltandoDoPonto((amb.pontos || [])[p]).forEach(function (x) { out.push(rotAmb + ' P' + (p + 1) + ': ' + x); });
      }
    }
    return out;
  }

  /* ===== Entrada ===== */

  function renderizar(container, contexto) {
    ctx = contexto;
    raiz = container;
    if (!ctx.estado.campo) ctx.estado.campo = { geral: {}, ambientes: [] };
    if (!ctx.estado.campo.geral) ctx.estado.campo.geral = {};
    if (!ctx.estado.campo.ambientes) ctx.estado.campo.ambientes = [];
    ambienteExibido = 1;
    pontoExibido = 1;
    container.innerHTML =
      '<div id="qi-geral"></div>' +
      '<div id="qi-amb-paginacao" class="cr-paginacao"></div>' +
      '<div id="qi-ambiente"></div>';
    renderizarGeral();
  }

  return { renderizar: renderizar, itensFaltando: itensFaltando, TIPO_CARIMBO: TIPO_CARIMBO };
})();
