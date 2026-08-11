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
  let coletaExibida = 1; // coleta aberta DENTRO do ponto (paginada; lembrada por ponto)
  let temporizadorSalvar = null;

  function $(seletor) { return raiz.querySelector(seletor); }
  function campo() { return ctx.estado.campo; }
  function salvar() { ctx.salvar(); }
  // Guarda/recupera o último ponto aberto, para CONTINUAR de onde parou (ex.:
  // retomar o serviço no dia seguinte) em vez de voltar sempre ao ponto 1.
  function lembrarPonto(n) { campo().pontoAtual = n; ((ctx && ctx.salvarSemMarcar) || salvar)(); } // navegação: não acende o aviso de "não enviado"
  function pontoInicial() {
    var n = parseInt(campo().pontoAtual, 10);
    return (n && n > 0) ? n : 1; // renderizarPontos limita ao total depois
  }
  // Salvar rascunho COMPLETO (aparelho + servidor) — usado pelos botões entre as
  // coletas. Cai no salvar local se o fluxo não passou o salvarRascunho.
  function salvarRascunho() { (ctx.salvarRascunho || ctx.salvar)(); }
  // Linha de ações entre as coletas (resguarda serviços longos de QAR): "Salvar"
  // e "PDF" lado a lado, com textos curtos para caber na mesma linha no celular.
  // O botão de PDF só aparece se o fluxo passou o gerarPdf.
  function htmlAcoesColeta() {
    var pdf = ctx.gerarPdf
      ? '<button type="button" class="botao botao-secundario cq-gerar-pdf-coleta" style="flex:1" title="Gerar PDF do que já foi preenchido (parcial)">📄 PDF</button>'
      : '';
    return '<div class="cq-acoes-coleta" style="display:flex;gap:8px;margin:8px 0">' +
      '<button type="button" class="botao botao-secundario cq-salvar-coleta" style="flex:1" title="Salvar rascunho (aparelho + servidor)">💾 Salvar</button>' +
      pdf + '</div>';
  }
  // Gera o PDF (mesmo do fim do serviço) COM O QUE JÁ ESTÁ PREENCHIDO — para
  // resguardar por partes num QAR que dura dias.
  function gerarPdfParcial(btn) {
    if (!ctx.gerarPdf) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ PDF…'; }
    Promise.resolve(ctx.gerarPdf()).catch(function () {
      if (EC.app) EC.app.mostrarToast('Não consegui gerar o PDF agora — tente de novo.');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '📄 PDF'; }
    });
  }
  function salvarDevagar() {
    clearTimeout(temporizadorSalvar);
    temporizadorSalvar = setTimeout(salvar, 400);
  }

  function lblNum(rotulo, campoNome) {
    return '<label>' + rotulo + '<input type="number" step="0.01" inputmode="decimal" data-campo="' + campoNome + '"></label>';
  }

  function lblSelect(rotulo, campoNome, opcoes) {
    return '<label>' + rotulo + '<select data-campo="' + campoNome + '"><option value="">Selecione…</option>' +
      opcoes.map(function (o) { return '<option>' + o + '</option>'; }).join('') + '</select></label>';
  }
  const OPCOES_VENTO = ['Fraco', 'Médio', 'Forte'];

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
    // O kit vem primeiro no teste: a categoria dele ("Kit de Calibração de AGV")
    // também contém "agv", então o amostrador exclui o que for kit.
    var kits = kitsDisponiveis();
    var agvs = selecionadosPorCategoria(/amostrador|grande volume|agv/).filter(function (c) {
      return kits.indexOf(c) === -1;
    });
    var seps = selecionadosPorCategoria(/separador/);
    if (!agvs.length && !seps.length && !kits.length) {
      // sem categoria conhecida: dropdown único (compatibilidade)
      return '<label>Tipo de equipamento<select data-campo="tipoEquip"><option value="">Selecione…</option>' +
        selecionados.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label>';
    }
    return selectEquip('equipAGV', 'Amostrador de Grande Volume', agvs) +
      selectEquip('equipSeparador', 'Separador inercial', seps) +
      selectEquip('equipKit', 'Kit de calibração (CPV)', kits);
  }

  // Kits de calibração DISPONÍVEIS para o dropdown do ponto: os selecionados no
  // pré-campo + todos os kits VÁLIDOS (não vencidos) da lista do SGP. Assim um
  // rascunho antigo — de antes do kit entrar na seleção de equipamentos — também
  // ganha o dropdown, sem refazer o pré-campo.
  function kitsDisponiveis() {
    var lista = selecionadosPorCategoria(/kit|calibra/);
    var hoje = new Date().toISOString().slice(0, 10);
    listaEquipQar().forEach(function (e) {
      if (!/kit|calibra/.test((e.categoria || '').toLowerCase())) return;
      if (e.proximaCal && e.proximaCal < hoje) return; // vencido não entra
      if (lista.indexOf(e.codigo) === -1) lista.push(e.codigo);
    });
    return lista;
  }

  // Kit de calibração escolhido → preenche a1/b1 com os coeficientes do
  // certificado que vieram do SGP (menu Certificado de calibração). Ao TROCAR o
  // kit sobrescreve; ao reabrir o ponto só completa se estiver vazio (não passa
  // por cima de valor digitado à mão).
  function aplicarKit(area, ponto, sobrescrever) {
    var item = ponto.equipKit ? listaEquipQar().filter(function (x) {
      return x.codigo === ponto.equipKit;
    })[0] : null;
    if (!item) return;
    if (item.a1 == null || item.b1 == null) {
      // Kit sem coeficiente no SGP: avisa na troca explícita, em vez de falhar mudo.
      if (sobrescrever && EC.app) EC.app.mostrarToast('O certificado deste kit não tem a1/b1 no SGP — registre no menu Certificado de calibração ou digite à mão.');
      return;
    }
    if (!sobrescrever && (String(ponto.calibA1 || '').trim() !== '' || String(ponto.calibB1 || '').trim() !== '')) return;
    ponto.calibA1 = String(item.a1);
    ponto.calibB1 = String(item.b1);
    var elA = area.querySelector('[data-campo="calibA1"]');
    var elB = area.querySelector('[data-campo="calibB1"]');
    if (elA) elA.value = ponto.calibA1;
    if (elB) elB.value = ponto.calibB1;
    atualizarCurva(area, ponto);
    salvarDevagar();
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
    // Navegação LIVRE entre os pontos — a foto obrigatória segue cobrada só na
    // validação final (itensFaltando), não na troca de página.
    EC.paginacao.criar($('#cq-paginacao'), {
      total: total,
      atual: pontoExibido,
      aoMudar: function (n) { pontoExibido = n; lembrarPonto(n); renderizarPonto(n); }
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
      '<div class="grade-2">' + lblNum('Pressão (hPa)', 'pressao_' + sufixo) + lblSelect('Vento', 'vento_' + sufixo, OPCOES_VENTO) + '</div>' +
      '<label>Como está o tempo?<input type="text" placeholder="ex.: sol, nublado" data-campo="tempo_' + sufixo + '"></label>' +
      '<p class="cq-sub">Coluna 800 mm (cmH₂O)</p><div class="grade-2">' +
      lblNum('↑ Para cima', 'col800sobe_' + sufixo) + lblNum('↓ Para baixo', 'col800desce_' + sufixo) + '</div>' +
      '<div class="cq-vazao-coleta" data-sufixo="' + sufixo + '"></div>';
  }

  // Vazão da coleta (equação da coluna BT da planilha QR_AGV): usa a2/b2 da
  // curva do PONTO com a temperatura, a pressão e a coluna 800 (↑+↓) do próprio
  // bloco (inicial e final). Mostra o Qr em m³/min e o veredito pela mesma
  // faixa da fração: MP10/MP2,5 1,02–1,24; PTS 1,10–1,70.
  function atualizarVazaoColeta(area, ponto) {
    var card = area.querySelector('#cq-coleta-card');
    if (!card) return;
    var coleta = (ponto.coletas || [])[coletaExibida - 1] || {};
    var escopo = (ctx.estado.servico && ctx.estado.servico.escopo) || '';
    var c = calcularCurva(ponto, escopo);
    var fracao = fracaoDoEscopo(escopo);
    var faixa = (fracao === 'PTS') ? [1.10, 1.70] : [1.02, 1.24];
    ['ini', 'fim'].forEach(function (suf) {
      var div = card.querySelector('.cq-vazao-coleta[data-sufixo="' + suf + '"]');
      if (!div) return;
      var t = numDe(coleta['temp_' + suf]), pb = pressaoEmMmHg(numDe(coleta['pressao_' + suf]));
      var sobe = numDe(coleta['col800sobe_' + suf]), desce = numDe(coleta['col800desce_' + suf]);
      if (t === null || pb === null || pb <= 0 || sobe === null || desce === null) { div.innerHTML = ''; return; }
      if (c.falta) {
        div.innerHTML = '<div class="alerta alerta-info">A vazão desta coleta aparece quando a curva de calibração do ponto estiver completa (falta ' + c.falta + ').</div>';
        return;
      }
      var T = t + 273;
      var y = (((sobe + desce) / 1.361) - pb) / -pb;
      var qr = (1 / c.a2) * (y - c.b2) * Math.sqrt(T);
      var ok = qr >= faixa[0] && qr <= faixa[1];
      div.innerHTML = '<div class="alerta ' + (ok ? 'alerta-verde' : 'alerta-vermelho') + '">' +
        (ok ? '✅ Vazão da coleta APROVADA' : '❌ Vazão da coleta REPROVADA') + ' — Qr = ' + fmtBr(qr) +
        ' m³/min, ' + (ok ? 'dentro' : 'fora') + ' da tolerância normativa de ' + fmtBr(faixa[0], 2) + ' a ' + fmtBr(faixa[1], 2) + ' m³/min (' + fracao + ').</div>';
    });
  }

  // Nº da 1ª coleta DESTE registro (padrão 1). Revezamento em serviço longo:
  // se outro técnico já fez as coletas 1–3 deste ponto (registro dele), quem
  // assume começa na 4 — a numeração segue no app, no PDF e na planilha, sem
  // duplicar números no mesmo ponto.
  function primeiraColetaDe(ponto) {
    return Math.max(1, parseInt(ponto.primeiraColeta, 10) || 1);
  }

  // As coletas ficam PAGINADAS (uma por página), como os pontos — em serviços com
  // muitas coletas a rolagem ficava enorme (pedido da Raisa, 2026-07-29). As ações
  // (Salvar + PDF) ficam no topo, fixas; a paginação respeita a numeração do
  // revezamento (ex.: começa na 4ª). Trocar de coleta não perde dados — cada cartão
  // grava direto em ponto.coletas[k].
  function renderColetas(area, ponto) {
    const div = area.querySelector('#cq-coletas');
    const n = Math.min(20, Math.max(0, parseInt(ponto.qtdeColetas, 10) || 0));
    const ini = primeiraColetaDe(ponto);
    ponto.coletas = ponto.coletas || [];
    while (ponto.coletas.length < n) ponto.coletas.push({});
    if (n === 0) { div.innerHTML = ''; return; }
    // Cada ponto lembra a coleta aberta (ponto.coletaAtual) — voltar do atalho 📄
    // reabre exatamente na mesma coleta; abrir um ponto novo começa na 1ª.
    coletaExibida = Math.min(Math.max(1, parseInt(ponto.coletaAtual, 10) || 1), n);
    div.innerHTML = htmlAcoesColeta() +
      '<div id="cq-coleta-pag" class="cr-paginacao"></div>' +
      '<div id="cq-coleta-card"></div>';
    div.querySelector('.cq-salvar-coleta').addEventListener('click', function () { salvarRascunho(); });
    const btnPdf = div.querySelector('.cq-gerar-pdf-coleta');
    if (btnPdf) btnPdf.addEventListener('click', function () { gerarPdfParcial(btnPdf); });
    EC.paginacao.criar(div.querySelector('#cq-coleta-pag'), {
      total: n,
      atual: coletaExibida,
      rotuloFn: function (i) { return (i - 1 + ini) + 'ª'; }, // "1ª", "2ª"… (ou "4ª"… no revezamento)
      aoMudar: function (k) {
        coletaExibida = k;
        ponto.coletaAtual = k; // lembra a coleta deste ponto (navegação: não acende o aviso)
        ((ctx && ctx.salvarSemMarcar) || salvar)();
        renderUmaColeta(div, ponto, ini);
      }
    });
  }

  // Renderiza SÓ a coleta ativa (a paginação chama isto na criação e na troca).
  function renderUmaColeta(div, ponto, ini) {
    const card = div.querySelector('#cq-coleta-card');
    const k = coletaExibida - 1;
    ponto.coletas[k] = ponto.coletas[k] || {};
    card.innerHTML = '<div class="cartao-coleta"><h3>' + (k + ini) + 'ª coleta</h3>' +
      '<p class="grupo-checks-titulo">Dados iniciais</p>' +
      htmlBlocoColeta('ini', '<label>Código do filtro<input type="text" data-campo="codigoFiltro"></label>') +
      '<p class="grupo-checks-titulo">Dados finais</p>' + htmlBlocoColeta('fim') + '</div>';
    vincular(card.querySelector('.cartao-coleta'), ponto.coletas[k]);
    atualizarVazaoColeta(div, ponto); // mostra a vazão já ao abrir a coleta
  }


  /* ===== Curva de calibração automática (mesma matemática da planilha QR_AGV) ===== */

  // Fração do particulado pelo ESCOPO da OS (mesma regra do SGP) — decide a
  // faixa aceitável do Qr operacional.
  function fracaoDoEscopo(escopo) {
    var e = String(escopo || '').toLowerCase().replace(/\s+/g, '');
    function pos(re) { var m = e.match(re); return m ? m.index : Infinity; }
    var p25 = pos(/pm2[.,]?5|mp2[.,]?5/), p10 = pos(/pm10|mp10/), pPts = pos(/pts/);
    var min = Math.min(p25, p10, pPts);
    if (min === Infinity) return 'PTS';
    return (min === p25) ? 'MP2,5' : (min === p10 ? 'MP10' : 'PTS');
  }
  function numDe(v) { v = parseFloat(v); return isNaN(v) ? null : v; }
  // O campo agora pede a pressão em hPa (como o barômetro mostra), mas as
  // fórmulas — iguais às da planilha QR_AGV — trabalham em mmHg. Rascunho
  // antigo guardou mmHg; as faixas físicas não se cruzam (mmHg fica abaixo de
  // ~780 e hPa acima de ~850), então > 800 = hPa e converte.
  function pressaoEmMmHg(v) { return v === null ? null : (v > 800 ? v / 1.33322 : v); }
  // Leitura total de um manômetro em U = ↑ + ↓. Convenção: coluna 800 mm = CVV
  // (motor); coluna 400 mm (chaves _00…) = PTV (orifício calibrador).
  function leituraTotal(ponto, prefixo) {
    var a = numDe(ponto[prefixo + 'sobe']), b = numDe(ponto[prefixo + 'desce']);
    return (a === null || b === null) ? null : a + b;
  }
  // Devolve {falta: '…'} enquanto o preenchimento não dá para calcular; senão
  // {pontos, a2, b2, r, curvaOk} e, com a leitura do filtro, {qr, faixa, vazaoOk}.
  // É pura (ponto + texto do escopo) para o PDF reaproveitar via EC.campoQar.calcular.
  function calcularCurva(ponto, escopo) {
    ponto = ponto || {};
    var tempC = numDe(ponto.temperatura), pb = pressaoEmMmHg(numDe(ponto.pressao));
    if (tempC === null || pb === null || pb <= 0) return { falta: 'a temperatura e a pressão do 5º passo' };
    var a1 = numDe(ponto.calibA1), b1 = numDe(ponto.calibB1);
    if (a1 === null || b1 === null || a1 === 0) return { falta: 'a inclinação a1 e o intercepto b1 do certificado do CPV' };
    var T = tempC + 273; // a planilha trabalha em Kelvin
    var pontosCurva = [];
    for (var i = 0; i < CARTAS.length; i++) {
      var c = CARTAS[i];
      var cvv = leituraTotal(ponto, 'carta' + c + '_800');
      var ptv = leituraTotal(ponto, 'carta' + c + '_00');
      if (cvv === null || ptv === null) return { falta: 'as 4 leituras da placa ' + c };
      if (ptv <= 0) return { falta: 'leituras maiores que zero na placa ' + c };
      var y = ((cvv / 1.361) - pb) / -pb;                     // leitura corrigida do CVV
      var qref = (1 / a1) * (Math.sqrt(ptv * (T / pb)) - b1); // vazão de referência do padrão
      pontosCurva.push({ placa: c, x: qref / Math.sqrt(T), y: y });
    }
    var n = pontosCurva.length, mx = 0, my = 0;
    pontosCurva.forEach(function (p) { mx += p.x; my += p.y; });
    mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0;
    pontosCurva.forEach(function (p) {
      sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); syy += (p.y - my) * (p.y - my);
    });
    if (!sxx || !syy) return { falta: 'leituras diferentes entre as placas (estão todas iguais)' };
    var a2 = sxy / sxx;
    var res = { pontos: pontosCurva, a2: a2, b2: my - a2 * mx, r: sxy / Math.sqrt(sxx * syy) };
    res.curvaOk = res.r >= 0.99;
    // Resíduo de cada placa (distância vertical até a reta) — base do diagnóstico.
    pontosCurva.forEach(function (p) { p.res = p.y - (res.a2 * p.x + res.b2); });
    var filtro = leituraTotal(ponto, 'filtro_800');
    if (filtro !== null) {
      res.qr = (1 / res.a2) * ((((filtro / 1.361) - pb)) / -pb - res.b2) * Math.sqrt(T);
      res.fracao = fracaoDoEscopo(escopo);
      res.faixa = (res.fracao === 'PTS') ? [1.10, 1.70] : [1.02, 1.24];
      res.vazaoOk = res.qr >= res.faixa[0] && res.qr <= res.faixa[1];
    }
    return res;
  }

  // Diagnóstico INTERNO de manutenção (app + Excel do SGP; NUNCA vai no PDF do
  // cliente). Olha o padrão dos resíduos e a margem do Qr. Limiares calibrados
  // com o teste ID 31 da planilha QR_AGV (curva sadia: resíduo da placa 08 fica
  // em ~-5% da faixa; motor "engasgando" passa de -8%).
  function diagnosticoCurva(c) {
    var avisos = [];
    if (!c || c.falta || !c.pontos) return avisos;
    var ys = c.pontos.map(function (p) { return p.y; });
    var faixaY = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    if (!faixaY) return avisos;
    var res09 = c.pontos[3].res / faixaY, res08 = c.pontos[4].res / faixaY;
    if (!c.curvaOk) {
      // 1º passo SEMPRE que a curva reprova: repetir os pontos fora da reta —
      // erro de leitura/estabilização é a causa mais comum e a mais barata de
      // eliminar. Lista no máximo os 2 piores (resíduo ≥ 50% do maior), para a
      // instrução ser acionável em vez de "repita quase tudo".
      var ordenados = c.pontos.slice()
        .sort(function (a, b) { return Math.abs(b.res) - Math.abs(a.res); });
      var corte = Math.abs(ordenados[0].res) * 0.5;
      var fora = ordenados.filter(function (p) { return Math.abs(p.res) >= corte; }).slice(0, 2);
      var nomes = fora.map(function (p) { return p.placa; });
      avisos.push('Primeiro, repita a leitura da' + (nomes.length > 1 ? 's placas ' + nomes.join(' e ') : ' placa ' + nomes[0]) +
        ' — ' + (nomes.length > 1 ? 'são os pontos' : 'é o ponto') + ' mais fora da reta. Aguarde 1–2 min de estabilização após trocar a placa e leia o manômetro na altura dos olhos.');
      // Com 5 pontos e a reta reajustada, o padrão dos resíduos não separa com
      // segurança vazamento de motor — a 2ª instrução dá a ordem de investigação.
      avisos.push('Se repetir e continuar reprovando: confira vazamento de ar falso (borrachas e borboletas do porta-filtro apertadas em "X") e a rede elétrica/gerador; se as placas 09 e 08 seguirem caindo abaixo da reta, verifique as escovas/carvão do motor.');
    } else if (res08 < -0.06 && res09 < 0) {
      avisos.push('Placas restritivas (09 e 08) caindo abaixo da reta — desgaste inicial do motor (escovas); acompanhe nas próximas calibrações.');
    }
    if (c.qr !== undefined && c.faixa) {
      if (!c.vazaoOk && c.qr < c.faixa[0] && c.curvaOk) {
        avisos.push('Curva linear com vazão baixa — motor sem força: verifique escovas/carvão, tensão da rede (extensões longas) e a vedação do porta-filtro.');
      } else if (!c.vazaoOk && c.qr > c.faixa[1]) {
        avisos.push('Vazão acima da faixa — confira as leituras com filtro no lugar e o ajuste do motor.');
      } else if (c.vazaoOk && (c.qr - c.faixa[0]) < 0.05 * (c.faixa[1] - c.faixa[0])) {
        avisos.push('Qr aprovado, mas a menos de 5% do limite inferior da faixa — programe manutenção preventiva (escovas) antes da próxima campanha.');
      }
    }
    return avisos;
  }
  function fmtBr(v, casas) { return v.toFixed(casas === undefined ? 4 : casas).replace('.', ','); }
  function num4(v) { return Math.round(v * 10000) / 10000; }

  // Gráfico compacto da curva (reta de regressão + 5 pontos rotulados).
  function svgCurva(c) {
    var W = 320, H = 190, m = { t: 14, r: 12, b: 20, l: 16 };
    var xs = c.pontos.map(function (p) { return p.x; });
    var ys = c.pontos.map(function (p) { return p.y; });
    var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    var fx = (xMax - xMin) * 0.14 || 0.001; xMin -= fx; xMax += fx;
    var yR = [c.a2 * xMin + c.b2, c.a2 * xMax + c.b2];
    var yMin = Math.min(Math.min.apply(null, ys), Math.min.apply(null, yR));
    var yMax = Math.max(Math.max.apply(null, ys), Math.max.apply(null, yR));
    var fy = (yMax - yMin) * 0.14 || 0.001; yMin -= fy; yMax += fy;
    function X(v) { return m.l + (v - xMin) / (xMax - xMin) * (W - m.l - m.r); }
    function Y(v) { return H - m.b - (v - yMin) / (yMax - yMin) * (H - m.t - m.b); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Curva de calibração">';
    s += '<line x1="' + m.l + '" y1="' + (H - m.b) + '" x2="' + (W - m.r) + '" y2="' + (H - m.b) + '" stroke="#c9d4df" stroke-width="1"/>';
    s += '<line x1="' + m.l + '" y1="' + m.t + '" x2="' + m.l + '" y2="' + (H - m.b) + '" stroke="#c9d4df" stroke-width="1"/>';
    s += '<line x1="' + X(xMin) + '" y1="' + Y(yR[0]) + '" x2="' + X(xMax) + '" y2="' + Y(yR[1]) + '" stroke="#1657ae" stroke-width="2"/>';
    c.pontos.forEach(function (p) {
      s += '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="4.5" fill="#2f80e0" stroke="#fff" stroke-width="1.5"/>';
      s += '<text x="' + (X(p.x) + 7) + '" y="' + (Y(p.y) - 6) + '" font-size="10" fill="#5b6b7b">' + p.placa + '</text>';
    });
    s += '<text x="' + ((m.l + W - m.r) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="#5b6b7b">Qref ÷ √T</text>';
    s += '</svg>';
    return s;
  }

  // Preenche o bloco .cq-curva do ponto — chamado a cada digitação no cartão.
  // Também guarda o resultado em ponto.curvaAuto (números + diagnóstico), que
  // sobe com o registro e vira colunas no Excel de Monitoramento do SGP.
  function atualizarCurva(area, ponto) {
    var div = area.querySelector('.cq-curva');
    if (!div) return;
    var c = calcularCurva(ponto, (ctx.estado.servico && ctx.estado.servico.escopo) || '');
    if (c.falta) {
      ponto.curvaAuto = null;
      div.innerHTML = '<div class="alerta alerta-info">📈 A curva aparece aqui sozinha quando você preencher ' + c.falta + '.</div>';
      return;
    }
    var diagnostico = diagnosticoCurva(c);
    ponto.curvaAuto = {
      a2: num4(c.a2), b2: num4(c.b2), r: num4(c.r),
      curvaOk: c.curvaOk,
      qr: (c.qr === undefined) ? null : num4(c.qr),
      fracao: c.fracao || null,
      vazaoOk: (c.vazaoOk === undefined) ? null : c.vazaoOk,
      diagnostico: diagnostico
    };
    var html = '<div class="cq-curva-resumo">a2 <strong>' + fmtBr(c.a2) + '</strong> · b2 <strong>' + fmtBr(c.b2) + '</strong> · r <strong>' + fmtBr(c.r) + '</strong></div>';
    html += c.curvaOk
      ? '<div class="alerta alerta-verde">✅ Curva APROVADA — r = ' + fmtBr(c.r) + ' (critério: r ≥ 0,990).</div>'
      : '<div class="alerta alerta-vermelho">❌ Curva REPROVADA — r = ' + fmtBr(c.r) + ' &lt; 0,990: desvio de linearidade. Confira vedação, estabilização das placas e leituras, e refaça a calibração.</div>';
    if (c.qr === undefined) {
      html += '<div class="alerta alerta-info">Preencha a leitura com filtro no lugar para calcular o Qr operacional.</div>';
    } else if (c.vazaoOk) {
      html += '<div class="alerta alerta-verde">✅ Vazão APROVADA — Qr = ' + fmtBr(c.qr) + ' m³/min, dentro da faixa de ' + fmtBr(c.faixa[0], 2) + ' a ' + fmtBr(c.faixa[1], 2) + ' m³/min (' + c.fracao + ').</div>';
    } else {
      html += '<div class="alerta alerta-vermelho">❌ Vazão REPROVADA — Qr = ' + fmtBr(c.qr) + ' m³/min, fora da faixa de ' + fmtBr(c.faixa[0], 2) + ' a ' + fmtBr(c.faixa[1], 2) + ' m³/min (' + c.fracao + ').</div>';
    }
    // Diagnóstico interno (manutenção): só na tela e no Excel do SGP — o PDF do
    // cliente leva apenas a curva e os vereditos.
    if (diagnostico.length) {
      html += '<div class="alerta alerta-amarelo">🔧 <strong>Diagnóstico interno</strong> (não sai no PDF):<br>• ' + diagnostico.join('<br>• ') + '</div>';
    }
    html += svgCurva(c);
    div.innerHTML = html;
  }

  // Contato do dono da casa deste ponto (preenchido pelo laboratório nos Dados
  // gerais). Vem vazio quando não há nada informado para o ponto.
  function contatoDoPonto(n) {
    return (EC.fluxo && EC.fluxo.contatoPontoHtml) ? EC.fluxo.contatoPontoHtml(ctx && ctx.estado, n) : '';
  }
  function renderizarPonto(n) {
    const area = $('#cq-ponto');
    const ponto = campo().pontos[n - 1];
    if (!ponto) { area.innerHTML = ''; return; }

    const html =
      '<div class="cartao-ponto"><h2>Ponto P' + n + '</h2>' +
      contatoDoPonto(n) +
      // Identificação
      '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
      '<label>Característica do ambiente<input type="text" placeholder="ex.: fluxo intenso de veículos, próximo estrada não pavimentada" data-campo="caracteristicaAmbiente"></label>' +
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
      lblNum('Temperatura (°C)', 'temperatura') + lblNum('Pressão (hPa)', 'pressao') + lblNum('Umidade (%)', 'umidade') +
      lblSelect('Vento', 'vento', OPCOES_VENTO) +
      '<label>Como está o tempo?<input type="text" placeholder="ex.: sol, nublado" data-campo="tempo"></label>' +
      '<p class="cq-passo">6º passo — Calibração (placas de retenção)</p>' +
      CARTAS.map(function (c) { return '<p class="grupo-checks-titulo">Placa de retenção ' + c + '</p>' + htmlCarta('carta' + c); }).join('') +
      '<p class="grupo-checks-titulo">Leitura com filtro no lugar</p>' +
      '<div class="grade-2">' + lblNum('Coluna 800 mm ↑', 'filtro_800sobe') + lblNum('Coluna 800 mm ↓', 'filtro_800desce') + '</div>' +
      '<p class="grupo-checks-titulo">📈 Curva de calibração (automática)</p>' +
      // a1/b1 vêm do certificado com 4 casas (step any) e o b1 costuma ser
      // NEGATIVO — o teclado numérico do celular não tem "−", daí o botão ±.
      '<div class="grade-2">' +
      '<label>Inclinação a1 (certificado do CPV)<input type="number" step="any" inputmode="decimal" data-campo="calibA1"></label>' +
      '<label>Intercepto b1 (certificado do CPV)<span class="cq-neg-linha">' +
      '<button type="button" class="botao botao-mini cq-neg" title="Trocar o sinal (positivo ↔ negativo)">±</button>' +
      '<input type="number" step="any" inputmode="decimal" data-campo="calibB1"></span></label>' +
      '</div>' +
      '<div class="cq-curva"></div>' +
      htmlChecks(['Calibração aprovada'], 'calib') +
      '<label>Validade da calibração (em meses)<input type="number" min="0" step="1" inputmode="numeric" data-campo="validadeCalib"></label>' +
      // Coletas
      '<label>Quantas coletas neste ponto?<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdeColetas"></label>' +
      '<label>Nº da primeira coleta*<input type="number" min="1" max="99" inputmode="numeric" placeholder="1" data-campo="primeiraColeta"></label>' +
      '<p class="texto-apoio">Revezamento: se outro técnico já fez as primeiras coletas deste ponto (no registro dele), continue a numeração — ex.: ele fez 1 a 3, você começa na 4. Preencha o número 4 em “Nº da primeira coleta”. Se o serviço é todo seu, deixe em branco (começa na 1).</p>' +
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
    // Mudou o nº da 1ª coleta → renumera os cartões (4ª, 5ª, …).
    area.querySelector('[data-campo="primeiraColeta"]').addEventListener('input', function () {
      renderColetas(area, ponto);
    });
    // Aviso do carvão: atualiza ao render e quando trocam o AGV.
    atualizarAvisoCarvao(area);
    var selAgv = area.querySelector('[data-campo="equipAGV"]');
    if (selAgv) selAgv.addEventListener('change', function () { atualizarAvisoCarvao(area); });
    // Kit de calibração: escolher/trocar preenche a1/b1 do certificado (SGP);
    // reabrir o ponto só completa se os campos estiverem vazios.
    var selKit = area.querySelector('[data-campo="equipKit"]');
    if (selKit) selKit.addEventListener('change', function () { aplicarKit(area, ponto, true); });
    // Sem kit escolhido ainda: se há UM único candidato (o do pré-campo, ou o
    // único válido da lista), já seleciona e preenche sozinho — o técnico não
    // precisa de um toque a mais para os a1/b1 aparecerem.
    if (selKit && !ponto.equipKit) {
      var doPreCampo = selecionadosPorCategoria(/kit|calibra/);
      var unico = (doPreCampo.length === 1) ? doPreCampo[0]
        : (selKit.options.length === 2 ? selKit.options[1].value : '');
      if (unico) {
        ponto.equipKit = unico;
        selKit.value = unico;
        salvarDevagar();
      }
    }
    aplicarKit(area, ponto, false);
    // Botão ± do b1: inverte o sinal do valor digitado e dispara o input para
    // salvar e recalcular a curva (o teclado do celular não tem "−").
    var btnNeg = area.querySelector('.cq-neg');
    if (btnNeg) btnNeg.addEventListener('click', function () {
      var el = area.querySelector('[data-campo="calibB1"]');
      var v = String(el.value || '').trim();
      if (!v) { el.focus(); return; }
      el.value = v.charAt(0) === '-' ? v.slice(1) : '-' + v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Curva de calibração e vazão da coleta ao vivo: recalculam a cada digitação
    // no cartão (os campos ficam fora dos blocos redesenhados — não rouba o foco).
    atualizarCurva(area, ponto);
    area.addEventListener('input', function () { atualizarCurva(area, ponto); atualizarVazaoColeta(area, ponto); });
    area.addEventListener('change', function () { atualizarCurva(area, ponto); atualizarVazaoColeta(area, ponto); });
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
    reqVal('vento', 'vento'); reqVal('tempo', 'como está o tempo');
    grupoChecks('calib', 1, 'calibração aprovada');
    reqVal('validadeCalib', 'validade da calibração (em meses)');

    const nColetas = Math.min(20, Math.max(0, parseInt(ponto.qtdeColetas, 10) || 0));
    if (!nColetas) { falta.push('quantidade de coletas'); return falta; }
    const iniColeta = primeiraColetaDe(ponto); // numeração contínua no revezamento
    (ponto.coletas || []).slice(0, nColetas).forEach(function (col, k) {
      col = col || {};
      ['ini', 'fim'].forEach(function (suf) {
        const rotPer = (suf === 'ini' ? 'inicial' : 'final');
        [['data_' + suf, 'data'], ['hora_' + suf, 'hora'], ['horimetro_' + suf, 'horímetro'],
         ['temp_' + suf, 'temperatura'], ['umid_' + suf, 'umidade'], ['pressao_' + suf, 'pressão'],
         ['vento_' + suf, 'vento'], ['tempo_' + suf, 'como está o tempo']
        ].forEach(function (par) {
          const v = col[par[0]];
          if (v === undefined || v === null || String(v).trim() === '') falta.push((k + iniColeta) + 'ª coleta: ' + par[1] + ' ' + rotPer);
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
    pontoExibido = pontoInicial(); // continua do último ponto aberto (não força 1)
    container.innerHTML =
      '<div id="cq-geral"></div>' +
      '<div id="cq-paginacao" class="cr-paginacao"></div>' +
      '<div id="cq-ponto"></div>';
    renderizarGeral();
    // A lista de equipamentos chega do SGP em segundo plano — quando atualizar,
    // re-renderiza o ponto para o dropdown do kit aparecer com os a1/b1 frescos
    // (sem isso, quem abria o campo com o cache antigo ficava sem o kit).
    if (EC.equip && EC.equip.carregar) EC.equip.carregar(function () {
      if (raiz && document.body.contains(raiz) && ctx && ctx.estado && ctx.estado.campo) renderizarPontos();
    });
  }

  return {
    renderizar: renderizar,
    itensFaltando: itensFaltando,
    calcular: calcularCurva, // usado pelo PDF p/ desenhar a curva do ponto
    TIPO_CARIMBO: TIPO_CARIMBO
  };
})();
