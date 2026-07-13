/**
 * aprovacoes.js — Aprovação de logística DENTRO do e-CAMP
 *
 * Quem tem papel 'logistica' (ou admin) no SGP vê um sino no topo e uma tela
 * de Aprovações. Lê e grava DIRETO nas tabelas do SGP com a conta autenticada
 * da pessoa (mesmo padrão da Agenda) — o próprio banco (RLS) garante que só
 * logística/financeiro/admin enxerga e decide.
 *
 * Fluxo: aguardando_logistica → aprovar (aguardando_pagamento) / rejeitar
 * (rejeitado) / solicitar correção (correcao). Observação obrigatória ao
 * rejeitar ou pedir correção; ao aprovar acima do orçamento previsto, também.
 *
 * Precisa de internet (fala com o Supabase na hora). Expõe EC.aprovacoes.
 */
window.EC = window.EC || {};

EC.aprovacoes = (function () {
  'use strict';

  var ITENS_ROTULO = {
    transporte: '⛽ Transporte (combustível)', aluguel: '🚗 Aluguel de veículo',
    pedagio: '🛣️ Pedágio', hospedagem: '🏨 Hospedagem',
    mao_obra: '👷 Mão de obra', alimentacao: '🍽️ Alimentação'
  };

  var detalheAtual = null, orcAtual = null;

  function $(id) { return document.getElementById(id); }
  function sb() { return EC.auth && EC.auth.cliente ? EC.auth.cliente() : null; }
  function sessao() { return EC.storage.ler('sessao:atual') || {}; }
  function toast(m) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(m); }
  function moeda(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function dataBR(iso) { if (!iso) return '—'; var p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function ehLogistica() {
    var p = sessao().papeis || [];
    return p.indexOf('logistica') !== -1 || p.indexOf('admin') !== -1;
  }
  function ehFinanceiro() {
    var p = sessao().papeis || [];
    return p.indexOf('financeiro') !== -1 || p.indexOf('admin') !== -1;
  }
  function podeAlgumaAcao() { return ehLogistica() || ehFinanceiro(); }

  // Sessões antigas podem não ter os papéis gravados — busca uma vez.
  async function garantirPapeis() {
    var s = sessao();
    if (Array.isArray(s.papeis)) return;
    if (!EC.auth || !EC.auth.meusPapeis) return;
    try { s.papeis = await EC.auth.meusPapeis(); EC.storage.salvar('sessao:atual', s); } catch (e) { /* offline */ }
  }

  /* ============ Sino / badge no topo ============ */

  async function contarStatus(status) {
    var cli = sb();
    if (!cli) return 0;
    try {
      var q = await cli.from('logistica_solicitacoes')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      return q.count || 0;
    } catch (e) { return 0; }
  }

  // Sino ÚNICO (compartilhado com Lembretes de serviço, agenda.js): cada
  // módulo só reporta a própria contagem; quem desenha/mostra o botão é o app.js.
  async function atualizarBadge() {
    if (!(EC.app && EC.app.atualizarSino)) return;
    await garantirPapeis();
    // O sino aparece p/ quem aprova (Logística) OU quem paga (Financeiro),
    // mesmo com 0 pendências — é o convite pra checar.
    var mostrar = podeAlgumaAcao();
    var n = 0;
    if (mostrar) {
      if (ehLogistica()) n += await contarStatus('aguardando_logistica');
      if (ehFinanceiro()) n += await contarStatus('aguardando_pagamento');
    }
    EC.app.atualizarSino('aprovacoes', n, mostrar);
  }

  /* ============ Lista de pendentes ============ */

  var COLS_LISTA = 'id, os, cliente, solicitante, designado, valor_total, percentual_solicitado, valor_solicitado, status, created_at';

  function cartao(s) {
    var pct = s.percentual_solicitado != null ? Number(s.percentual_solicitado) : 100;
    var valor = s.valor_solicitado != null ? s.valor_solicitado : s.valor_total;
    var chip = s.status === 'aguardando_pagamento'
      ? '<span class="rb-status rb-aprovado">✅ Aguardando pagamento</span>'
      : '<span class="rb-status rb-pendente">⏳ Aguardando aprovação</span>';
    return (
      '<button type="button" class="rb-pedido apr-cartao" data-id="' + s.id + '">' +
      '  <div class="rb-pedido-topo"><span class="os-numero">OS ' + esc(s.os) + '</span>' + chip + '</div>' +
      '  <div class="rb-pedido-linha"><strong>' + moeda(valor) + '</strong>' + (pct < 100 ? ' (' + pct + '% de ' + moeda(s.valor_total) + ')' : '') + '</div>' +
      (s.cliente ? '  <div class="os-resumo">' + esc(s.cliente) + '</div>' : '') +
      '  <div class="os-resumo">👷 ' + esc(s.designado || '—') + ' · ✍️ ' + esc(s.solicitante || '—') + '</div>' +
      '</button>'
    );
  }

  async function buscarStatus(cli, status) {
    var q = await cli.from('logistica_solicitacoes').select(COLS_LISTA)
      .eq('status', status).order('created_at', { ascending: true });
    if (q.error) throw q.error;
    return q.data || [];
  }

  // Itens pendentes p/ o sino ÚNICO (app.js) mostrar a lista já aberta quando
  // há mais de uma fonte de pendência (Aprovações + Lembretes) ao mesmo tempo.
  async function obterPendentesParaSino() {
    var cli = sb();
    if (!cli) return [];
    try {
      var itens = [];
      if (ehLogistica()) itens = itens.concat(await buscarStatus(cli, 'aguardando_logistica'));
      if (ehFinanceiro()) itens = itens.concat(await buscarStatus(cli, 'aguardando_pagamento'));
      return itens;
    } catch (e) { return []; }
  }

  // Pula direto pro detalhe (usado quando se chega a partir do sino combinado,
  // sem passar pela tela de lista antes).
  function abrirItemDireto(id) { iniciar(); abrirDetalhe(id); }

  async function pintarLista() {
    var area = $('apr-lista');
    area.innerHTML = '<p class="texto-apoio">Carregando…</p>';
    var cli = sb();
    if (!cli) { area.innerHTML = '<p class="texto-apoio">📡 Sem conexão. Abra com internet para ver e decidir.</p>'; return; }
    try {
      var secoes = [];
      if (ehLogistica()) secoes.push({ titulo: '⏳ Aguardando aprovação da Logística', itens: await buscarStatus(cli, 'aguardando_logistica') });
      if (ehFinanceiro()) secoes.push({ titulo: '💰 Aguardando pagamento (Financeiro)', itens: await buscarStatus(cli, 'aguardando_pagamento') });

      var totalItens = secoes.reduce(function (t, s) { return t + s.itens.length; }, 0);
      if (!totalItens) { area.innerHTML = '<p class="texto-apoio">🎉 Nada pendente por aqui.</p>'; return; }

      area.innerHTML = secoes.map(function (sec) {
        return '<p class="dg-secao">' + sec.titulo + ' (' + sec.itens.length + ')</p>' +
          (sec.itens.length ? sec.itens.map(cartao).join('') : '<p class="texto-apoio">Nada pendente.</p>');
      }).join('');
      area.querySelectorAll('.apr-cartao[data-id]').forEach(function (el) {
        el.addEventListener('click', function () { abrirDetalhe(el.dataset.id); });
      });
    } catch (e) {
      area.innerHTML = '<p class="texto-apoio">⚠️ Não consegui carregar: ' + esc(e.message || 'erro') + '</p>';
    }
  }

  /* ============ Resumo orçamentário da campanha ============ */

  async function resumoOrcamento(cli, s) {
    try {
      var previsto = 0;
      if (s.ordem_servico_id) {
        var os = await cli.from('ordens_servico').select('detalhes').eq('id', s.ordem_servico_id).maybeSingle();
        var camps = (os.data && os.data.detalhes && os.data.detalhes.campanhas) || [];
        var c = camps.filter(function (x) { return Number(x.numero) === Number(s.campanha_numero); })[0] || camps[Number(s.campanha_numero) - 1];
        previsto = (c && Number(c.logistica)) || 0;
      }
      // já aprovado/pago nesta OS — SOMA todos os designados da mesma OS,
      // quebrando o total por técnico (não conta a própria solicitação, que
      // ainda está 'aguardando_logistica').
      var ap = await cli.from('logistica_solicitacoes')
        .select('designado, valor_solicitado, valor_total, status')
        .eq('os', s.os)
        .in('status', ['aguardando_pagamento', 'pago']);
      var porDesignado = {};
      var jaAprovado = 0;
      (ap.data || []).forEach(function (r) {
        var val = Number(r.valor_solicitado != null ? r.valor_solicitado : (r.valor_total || 0));
        var nome = (r.designado || '').trim() || '—';
        porDesignado[nome] = (porDesignado[nome] || 0) + val;
        jaAprovado += val;
      });
      var esta = Number(s.valor_solicitado != null ? s.valor_solicitado : (s.valor_total || 0));
      return { previsto: previsto, jaAprovado: jaAprovado, esta: esta, porDesignado: porDesignado, designadoAtual: (s.designado || '').trim() };
    } catch (e) { return null; }
  }

  // Linhas "Já aprovado para <técnico>: R$" — uma por designado da OS.
  function linhasPorDesignado(o) {
    var porD = o.porDesignado || {};
    var nomes = Object.keys(porD).sort();
    if (!nomes.length) return '  <div class="apr-orc-linha">Já aprovado nesta OS: ' + moeda(0) + ' (nada aprovado ainda).</div>';
    return nomes.map(function (n) {
      return '  <div class="apr-orc-linha">Já aprovado para ' + esc(n) + ': ' + moeda(porD[n]) + '</div>';
    }).join('');
  }

  function renderOrcamento(o) {
    if (!o || !(o.previsto > 0)) {
      return '<div class="apr-orc apr-orc-cinza">💰 Logística prevista da campanha: não informada na OS.' +
        linhasPorDesignado(o || {}) + '</div>';
    }
    var totalApos = o.jaAprovado + o.esta;
    var pct = Math.round((totalApos / o.previsto) * 100);
    var saldo = o.previsto - totalApos;
    var cls = pct <= 80 ? 'apr-orc-verde' : (pct <= 100 ? 'apr-orc-amarelo' : 'apr-orc-vermelho');
    var situacao = pct <= 80 ? 'Dentro do orçamento' : (pct <= 100 ? 'Atenção: perto do limite' : '⚠️ Orçamento excedido');
    var estaLabel = o.designadoAtual ? 'Esta solicitação (' + esc(o.designadoAtual) + ')' : 'Esta solicitação';
    return (
      '<div class="apr-orc ' + cls + '">' +
      '  <div class="apr-orc-topo"><strong>' + situacao + '</strong><span>' + pct + '%</span></div>' +
      '  <div class="apr-orc-linha">Prevista: ' + moeda(o.previsto) + '</div>' +
      linhasPorDesignado(o) +
      '  <div class="apr-orc-linha">' + estaLabel + ': ' + moeda(o.esta) + ' · Total após: ' + moeda(totalApos) + '</div>' +
      '  <div class="apr-orc-linha" style="margin-top:8px"><strong>Saldo após aprovar: ' + moeda(saldo) + '</strong></div>' +
      '</div>'
    );
  }

  /* ============ Detalhe / decisão ============ */

  function linhaInfo(rot, val) {
    return '<div><span>' + rot + '</span><strong>' + esc(val) + '</strong></div>';
  }

  function renderDetalhe(s, ajustes) {
    var tipo = s.solicitante_tipo === 'freelancer' ? 'Freelancer' : (s.solicitante_tipo === 'clt' ? 'CLT' : '—');
    var alimentacao = Number(s.valor_almoco || 0) + Number(s.valor_jantar || 0) + Number(s.valor_lanche || 0);
    // ajuste por item (traz o valor calculado e o proposto)
    var ajPorItem = {};
    ajustes.forEach(function (a) { ajPorItem[a.item] = a; });

    // Cada linha de valor mostra o valor final; se houve ajuste, mostra
    // "calculado → novo" (riscado o antigo). Item-chave casa com os ajustes.
    // Linhas de Valores (card com ícone). Se houve ajuste, mostra o valor final
    // e uma sub-linha "calculado → proposto (ajuste)".
    var linhas = [
      ['⛽', 'Transporte (combustível)', s.valor_combustivel, 'transporte'],
      ['🚗', 'Aluguel de veículo', s.valor_aluguel, 'aluguel'],
      ['🛣️', 'Pedágio', s.valor_pedagio, 'pedagio'],
      ['🏨', 'Hospedagem', s.valor_hospedagem, 'hospedagem'],
      ['👷', 'Mão de obra', s.valor_mao_obra, 'mao_obra'],
      ['🍽️', 'Alimentação', alimentacao, 'alimentacao']
    ];
    var valoresHtml = linhas.filter(function (l) { return Number(l[2]) > 0 || ajPorItem[l[3]]; }).map(function (l) {
      var aj = ajPorItem[l[3]];
      var valFinal = aj ? aj.valor_proposto : l[2];
      var sub = '';
      if (aj) sub = moeda(aj.valor_calculado) + ' → ' + moeda(aj.valor_proposto) + ' (ajuste)';
      else if (l[3] === 'alimentacao') sub = 'almoço ' + moeda(s.valor_almoco) + ' · jantar ' + moeda(s.valor_jantar) + ' · lanche ' + moeda(s.valor_lanche);
      return '<div class="apr-vlinha"><span class="apr-vic">' + l[0] + '</span>' +
        '<div class="apr-vmeio"><div class="apr-vrot">' + l[1] + '</div>' +
        (sub ? '<div class="apr-vsub">' + sub + '</div>' : '') + '</div>' +
        '<span class="apr-vval">' + moeda(valFinal) + '</span></div>';
    }).join('');

    var pct = s.percentual_solicitado != null ? Number(s.percentual_solicitado) : 100;
    var solicitado = s.valor_solicitado != null ? s.valor_solicitado : s.valor_total;
    var comb = s.tipo_combustivel ? (s.tipo_combustivel === 'diesel' ? 'Diesel' : 'Gasolina') : null;
    var trajeto = (s.origem_cidade || s.destino_cidade)
      ? (esc(s.origem_cidade || '?') + (s.origem_uf ? '/' + esc(s.origem_uf) : '') + ' → ' +
         esc(s.destino_cidade || '?') + (s.destino_uf ? '/' + esc(s.destino_uf) : ''))
      : '—';
    var combTxt = comb
      ? comb + (s.preco_litro ? ' · ' + moeda(s.preco_litro) + '/L' : '')
      : 'não informado';

    // Caixa verde: valor final solicitado.
    var heroSolic = '<div class="apr-hero apr-hero-claro"><div class="apr-hero-icone">💰</div>' +
      '<div class="apr-hero-corpo">' +
        '<div class="apr-hero-titulo">Valor final solicitado (' + pct + '%' + (ajustes.length ? ', já com os ajustes' : '') + ')</div>' +
        '<div class="apr-hero-valor">' + moeda(solicitado) + '</div>' +
        '<div class="apr-hero-sub">Total da logística: ' + moeda(s.valor_total) + (ajustes.length ? ' · inclui os ajustes solicitados pelo técnico' : '') + '</div>' +
      '</div></div>';

    // Caixa verde forte: a pagar após adiantamento (só quando houve adiantamento).
    var adiant = Number(s.adiantamento_valor) || 0;
    var heroPagar = adiant > 0
      ? '<div class="apr-hero apr-hero-forte"><div class="apr-hero-icone">👛</div>' +
        '<div class="apr-hero-corpo">' +
          '<div class="apr-hero-cab"><div class="apr-hero-titulo">A pagar (após adiantamento)</div><span class="apr-hero-tag">⭐ Valor a receber</span></div>' +
          '<div class="apr-hero-valor">' + moeda(Math.round((solicitado - adiant) * 100) / 100) + '</div>' +
          '<div class="apr-hero-sub">Solicitado ' + moeda(solicitado) + ' − adiantamento ' + moeda(adiant) + (s.adiantamento_data ? ' (' + dataBR(s.adiantamento_data) + ')' : '') + '</div>' +
          (s.designado ? '<div class="apr-hero-desig">' + esc(s.designado) + '</div>' : '') +
        '</div></div>'
      : '';

    // Card "Detalhamento do cálculo": base, transporte (com +5 km/dia) e consumo.
    var distKm = Number(s.distancia_km) || 0;
    var diasServ = Number(s.dias_servico) || 0;
    var kmServico = 5 * diasServ;
    var distEfetiva = distKm + kmServico;
    var bullets = [];
    bullets.push('Base: ' + (s.dias_servico != null ? s.dias_servico + ' dia(s) de serviço' : '') +
      (s.dias_deslocamento != null ? ' · ' + s.dias_deslocamento + ' de deslocamento' : ''));
    if (distKm) {
      bullets.push('Transporte: ' + distKm + ' km' +
        (kmServico ? ' + 5 km/dia × ' + diasServ + ' dia(s) de serviço = <b>' + distEfetiva + ' km</b>' : ''));
    }
    if (s.consumo_kml || s.preco_litro) {
      bullets.push('Consumo: ' + (s.consumo_kml ? s.consumo_kml + ' km/L' : '—') +
        (comb ? ' · ' + comb : '') + (s.preco_litro ? ' ' + moeda(s.preco_litro) + '/L' : ''));
    }
    // Preços unitários usados (do snapshot valores_usados) — só dos itens cobrados.
    var vu = s.valores_usados || {};
    var ehFreela = s.solicitante_tipo === 'freelancer';
    // Mão de obra/dia = valor ÷ dias de viagem (dias distintos totais) — é o
    // mesmo multiplicador que o servidor usa na diária (reflete a exceção do
    // técnico). dias_servico gravado == dias_viagem; somar deslocamento inflava.
    var diasMaoObra = Number(s.dias_viagem) || Number(s.dias_servico) || 0;
    if (Number(s.valor_mao_obra) > 0 && diasMaoObra > 0) {
      bullets.push('Mão de obra: ' + moeda(Math.round(Number(s.valor_mao_obra) / diasMaoObra * 100) / 100) + '/dia');
    }
    if (Number(s.valor_hospedagem) > 0 && vu.hospedagem_dia != null) {
      bullets.push('Hospedagem: ' + moeda(vu.hospedagem_dia) + '/diária');
    }
    if (Number(s.valor_almoco) > 0 && vu.almoco != null) {
      bullets.push('Almoço: ' + (ehFreela
        ? moeda(vu.almoco) + '/dia'
        : moeda(vu.almoco_clt_util) + '/dia útil · ' + moeda(vu.almoco) + '/dia no fim de semana'));
    }
    if (Number(s.valor_jantar) > 0 && vu.jantar != null) {
      bullets.push('Jantar: ' + moeda(vu.jantar) + '/dia');
    }
    if (Number(s.valor_lanche) > 0 && vu.lanche != null) {
      bullets.push('Lanche: ' + moeda(vu.lanche) + '/dia de deslocamento');
    }
    var detalheHtml = '<div class="apr-detalhe"><div class="apr-detalhe-icone">🧮</div>' +
      '<div class="apr-detalhe-corpo"><div class="apr-detalhe-titulo">Detalhamento do cálculo</div>' +
      '<ul>' + bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul></div></div>';

    var ajHtml = ajustes.length
      ? '<p class="dg-secao">Justificativas dos ajustes</p>' + ajustes.map(function (a) {
          return '<div class="apr-ajuste"><strong>' + esc(ITENS_ROTULO[a.item] || a.item) + '</strong>: ' +
            moeda(a.valor_calculado) + ' → <b>' + moeda(a.valor_proposto) + '</b>' +
            '<div class="apr-just">' + esc(a.justificativa) + '</div></div>';
        }).join('')
      : '';

    return (
      '<div class="apr-cab"><span class="os-numero">OS ' + esc(s.os) + '</span>' + (s.cliente ? ' · ' + esc(s.cliente) : '') + '</div>' +
      // Resumo orçamentário só para a Logística (o Financeiro não vê).
      (ehLogistica() ? renderOrcamento(orcAtual) : '') +
      '<p class="dg-secao">Quem</p>' +
      '<div class="rb-resumo-auto">' +
        linhaInfo('Solicitante (preencheu)', s.solicitante || '—') +
        linhaInfo('Designado (viagem)', s.designado || '—') +
      '</div>' +
      '<div class="apr-cat">' + tipo + '</div>' +
      '<p class="dg-secao">Datas da viagem</p>' +
      '<div class="rb-resumo-auto">' +
        linhaInfo('Ida', dataBR(s.data_inicio)) +
        linhaInfo('Início do serviço', dataBR(s.servico_inicio)) +
        linhaInfo('Término do serviço', dataBR(s.servico_fim)) +
        linhaInfo('Chegada', dataBR(s.data_retorno)) +
        linhaInfo('Dias de serviço', s.dias_servico) +
        linhaInfo('Dias de deslocamento', s.dias_deslocamento) +
      '</div>' +
      '<p class="dg-secao">Transporte</p>' +
      '<div class="rb-resumo-auto">' +
        linhaInfo('Veículo', s.veiculo === 'proprio' ? 'Próprio' : (s.veiculo === 'engear' ? 'ENGEAR' : '—')) +
        linhaInfo('Origem → Destino', trajeto) +
        linhaInfo('Distância (ida e volta)', s.distancia_km ? s.distancia_km + ' km' : '—') +
        linhaInfo('Combustível', combTxt) +
      '</div>' +
      (s.combustivel_justificativa ? '<div class="apr-just">⛽ Justificativa do combustível acima do teto: ' + esc(s.combustivel_justificativa) + '</div>' : '') +
      '<p class="dg-secao">Valores</p>' +
      '<div class="apr-valores">' + valoresHtml + '</div>' +
      heroSolic +
      heroPagar +
      detalheHtml +
      ajHtml
    );
  }

  function abrirLightboxUrl(url) {
    var ov = document.createElement('div');
    ov.className = 'foto-lightbox';
    ov.innerHTML = '<img src="' + url + '" alt="Evidência ampliada">' +
      '<button type="button" class="foto-lightbox-fechar" aria-label="Fechar">✕</button>';
    ov.addEventListener('click', function () { ov.remove(); });
    document.body.appendChild(ov);
  }

  async function renderAnexos(cli, anexos) {
    var cont = $('apr-anexos');
    if (!anexos.length) { cont.innerHTML = '<p class="texto-apoio">Sem evidências anexadas.</p>'; return; }
    cont.innerHTML = '<div class="apr-anexos-lista"></div>';
    var lista = cont.querySelector('.apr-anexos-lista');
    for (var i = 0; i < anexos.length; i++) {
      var a = anexos[i];
      var url = null;
      try {
        var r = await cli.storage.from('logistica').createSignedUrl(a.url, 3600);
        if (r && r.data) url = r.data.signedUrl;
      } catch (e) { /* segue sem a URL */ }
      var div = document.createElement('div');
      div.className = 'apr-anexo';
      if (a.mime === 'application/pdf') {
        div.innerHTML = url
          ? '<a class="apr-anexo-pdf" href="' + url + '" target="_blank" rel="noopener">📄 ' + esc(a.arquivo) + '</a>'
          : '<span class="apr-anexo-pdf">📄 ' + esc(a.arquivo) + ' (indisponível)</span>';
      } else {
        div.innerHTML = url
          ? '<img src="' + url + '" alt="evidência" data-full="' + url + '" title="Toque para ampliar">'
          : '<span class="texto-apoio">' + esc(a.arquivo) + '</span>';
      }
      lista.appendChild(div);
    }
    lista.querySelectorAll('img[data-full]').forEach(function (img) {
      img.addEventListener('click', function () { abrirLightboxUrl(img.dataset.full); });
    });
  }

  function mostrarErro(msg) {
    var erro = $('apr-erro');
    if (!msg) { erro.classList.add('oculto'); return; }
    erro.textContent = '🛑 ' + msg;
    erro.classList.remove('oculto');
    erro.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function abrirDetalhe(id) {
    EC.app.mostrarTela('tela-aprovacao-detalhe');
    window.scrollTo(0, 0);
    $('apr-obs').value = '';
    $('apr-acao-logistica').classList.add('oculto');
    $('apr-acao-pagamento').classList.add('oculto');
    mostrarErro(null);
    detalheAtual = null; orcAtual = null; pagUploader = null;
    var area = $('apr-detalhe');
    area.innerHTML = '<p class="texto-apoio">Carregando…</p>';
    $('apr-anexos').innerHTML = '';
    var cli = sb();
    if (!cli) { area.innerHTML = '<p class="texto-apoio">📡 Sem conexão.</p>'; return; }
    try {
      var q = await cli.from('logistica_solicitacoes').select('*').eq('id', id).single();
      if (q.error) throw q.error;
      var s = q.data;
      detalheAtual = s;
      var res = await Promise.all([
        cli.from('logistica_ajustes').select('*').eq('solicitacao_id', id),
        cli.from('logistica_anexos').select('*').eq('solicitacao_id', id),
        resumoOrcamento(cli, s)
      ]);
      orcAtual = res[2];
      area.innerHTML = renderDetalhe(s, (res[0].data) || []);
      renderAnexos(cli, (res[1].data) || []);
      mostrarAcoes(s);
    } catch (e) {
      area.innerHTML = '<p class="texto-apoio">⚠️ Não consegui carregar: ' + esc(e.message || 'erro') + '</p>';
    }
  }

  // acao: 'aguardando_pagamento' (aprovar) | 'rejeitado' | 'correcao'
  var EVENTO = { aguardando_pagamento: 'aprovou', rejeitado: 'rejeitou', correcao: 'pediu_correcao' };
  var MSG = { aguardando_pagamento: '✅ Aprovada! Seguiu para pagamento.', rejeitado: '❌ Solicitação rejeitada.', correcao: '✏️ Correção solicitada ao técnico.' };

  async function decidir(acao) {
    var s = detalheAtual;
    if (!s) return;
    var obs = $('apr-obs').value.trim();
    if ((acao === 'rejeitado' || acao === 'correcao') && !obs) {
      return mostrarErro('Escreva a observação para ' + (acao === 'rejeitado' ? 'rejeitar' : 'pedir correção') + '.');
    }
    // aprovar acima do orçamento previsto → exige justificativa na observação
    if (acao === 'aguardando_pagamento' && orcAtual && orcAtual.previsto > 0 &&
        (orcAtual.jaAprovado + orcAtual.esta) > orcAtual.previsto && !obs) {
      return mostrarErro('Esta aprovação passa do orçamento previsto da campanha — escreva a justificativa na observação.');
    }
    var cli = sb();
    if (!cli) return mostrarErro('Sem conexão — abra com internet para decidir.');
    mostrarErro(null);

    var botoes = ['apr-aprovar', 'apr-correcao', 'apr-rejeitar'];
    botoes.forEach(function (b) { $(b).disabled = true; });
    try {
      var user = (await cli.auth.getUser()).data.user;
      var upd = await cli.from('logistica_solicitacoes')
        .update({
          status: acao,
          observacao_logistica: obs || null,
          decidido_em: new Date().toISOString(),
          decidido_por: user ? user.id : null
        })
        .eq('id', s.id)
        .eq('status', 'aguardando_logistica')   // só decide se ainda estiver pendente
        .select('id');
      if (upd.error) throw upd.error;
      if (!upd.data || !upd.data.length) {
        toast('Esta solicitação já foi decidida por outra pessoa.');
      } else {
        try {
          await cli.from('logistica_eventos').insert({
            solicitacao_id: s.id, acao: EVENTO[acao],
            detalhe: obs || null, por_nome: sessao().nome || null
          });
        } catch (e) { /* auditoria é best-effort */ }
        toast(MSG[acao]);
      }
      EC.app.mostrarTela('tela-aprovacoes');
      pintarLista();
      atualizarBadge();
    } catch (e) {
      mostrarErro('Não consegui salvar: ' + (e.message || 'erro'));
    }
    botoes.forEach(function (b) { $(b).disabled = false; });
  }

  /* ============ Ações: mostra o bloco certo por status × papel ============ */

  var pagUploader = null;

  function mostrarAcoes(s) {
    var bLog = $('apr-acao-logistica'), bPag = $('apr-acao-pagamento');
    bLog.classList.add('oculto'); bPag.classList.add('oculto');
    if (s.status === 'aguardando_logistica' && ehLogistica()) {
      $('apr-obs').value = '';
      bLog.classList.remove('oculto');
    } else if (s.status === 'aguardando_pagamento' && ehFinanceiro()) {
      $('pag-data').value = hojeISO();
      $('pag-forma').value = '';
      pagUploader = criarUploadComprovante($('pag-anexos'));
      bPag.classList.remove('oculto');
    }
  }

  function hojeISO() {
    var d = new Date();
    function dois(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
  }

  /* ============ Comprovante do pagamento (foto/galeria/PDF) ============ */

  var LADO_MAXIMO = 1600, PDF_MAX_MB = 3.5;

  function criarUploadComprovante(container) {
    var arquivos = [];
    container.innerHTML =
      '<div class="anx">' +
      '  <div class="anx-lista"></div>' +
      '  <div class="anx-botoes">' +
      '    <button type="button" class="botao botao-secundario pg-foto">📷 Foto</button>' +
      '    <button type="button" class="botao botao-secundario pg-galeria">🖼️ Galeria</button>' +
      '    <button type="button" class="botao botao-secundario pg-pdf">📎 PDF</button>' +
      '  </div>' +
      '  <input type="file" accept="image/*" capture="environment" class="pg-e-foto" hidden>' +
      '  <input type="file" accept="image/*" class="pg-e-galeria" hidden>' +
      '  <input type="file" accept="application/pdf" class="pg-e-pdf" hidden>' +
      '  <div class="anx-status"></div>' +
      '</div>';
    var lista = container.querySelector('.anx-lista');
    var status = container.querySelector('.anx-status');

    function render() {
      lista.innerHTML = arquivos.map(function (a, i) {
        var v = a.mime === 'application/pdf'
          ? '<span class="anx-pdf-icone">📄</span>'
          : '<img src="data:image/jpeg;base64,' + a.base64 + '" alt="comprovante" data-ver="' + i + '">';
        return '<div class="anx-item">' + v + '<span class="anx-nome">' + esc(a.nomeArquivo) + '</span>' +
          '<button type="button" class="anx-remover" data-i="' + i + '">✕</button></div>';
      }).join('');
      lista.querySelectorAll('.anx-remover').forEach(function (b) {
        b.addEventListener('click', function () { arquivos.splice(parseInt(b.dataset.i, 10), 1); render(); });
      });
      lista.querySelectorAll('img[data-ver]').forEach(function (img) {
        img.addEventListener('click', function () { abrirLightboxUrl('data:image/jpeg;base64,' + arquivos[parseInt(img.dataset.ver, 10)].base64); });
      });
    }
    function carimbo() { var d = new Date(); function z(n) { return n < 10 ? '0' + n : '' + n; } return '' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()); }
    function processarImagem(arq, pronto) {
      var leitor = new FileReader();
      leitor.onload = function () {
        var img = new Image();
        img.onload = function () {
          var escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * escala); canvas.height = Math.round(img.height * escala);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          arquivos.push({ nomeArquivo: 'COMPROVANTE_' + carimbo() + '.jpg', base64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg' });
          pronto(true);
        };
        img.onerror = function () { pronto(false); };
        img.src = leitor.result;
      };
      leitor.onerror = function () { pronto(false); };
      leitor.readAsDataURL(arq);
    }
    function ligarImagem(input) {
      input.addEventListener('change', function () {
        var arq = input.files && input.files[0];
        if (!arq) return;
        status.textContent = '⏳ Processando…';
        processarImagem(arq, function (ok) { render(); status.textContent = ok ? '✅ Comprovante adicionado.' : '⚠️ Não consegui ler a imagem.'; input.value = ''; });
      });
    }
    ligarImagem(container.querySelector('.pg-e-foto'));
    ligarImagem(container.querySelector('.pg-e-galeria'));
    container.querySelector('.pg-e-pdf').addEventListener('change', function () {
      var arq = this.files && this.files[0];
      if (!arq) return;
      if (arq.size > PDF_MAX_MB * 1024 * 1024) { status.textContent = '⚠️ PDF muito grande (máx. ' + PDF_MAX_MB + ' MB).'; this.value = ''; return; }
      var leitor = new FileReader();
      leitor.onload = function () {
        arquivos.push({ nomeArquivo: (arq.name || ('comprovante_' + carimbo() + '.pdf')).replace(/[^\w.\-()À-ſ ]+/g, '_'), base64: String(leitor.result).split(',')[1], mime: 'application/pdf' });
        render(); status.textContent = '✅ PDF anexado.';
      };
      leitor.readAsDataURL(arq);
    });
    container.querySelector('.pg-foto').addEventListener('click', function () { container.querySelector('.pg-e-foto').click(); });
    container.querySelector('.pg-galeria').addEventListener('click', function () { container.querySelector('.pg-e-galeria').click(); });
    container.querySelector('.pg-pdf').addEventListener('click', function () { container.querySelector('.pg-e-pdf').click(); });
    render();
    return { obter: function () { return arquivos.slice(); } };
  }

  function b64ParaBytes(b64) {
    var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function registrarPagamento() {
    var s = detalheAtual;
    if (!s) return;
    var data = $('pag-data').value;
    var forma = $('pag-forma').value;
    var comprovantes = pagUploader ? pagUploader.obter() : [];
    if (!data) return mostrarErro('Informe a data do pagamento.');
    if (!forma) return mostrarErro('Escolha a forma de pagamento.');
    if (!comprovantes.length) return mostrarErro('Anexe o comprovante do pagamento (foto ou PDF).');
    var cli = sb();
    if (!cli) return mostrarErro('Sem conexão — abra com internet para registrar o pagamento.');
    mostrarErro(null);

    var botao = $('pag-registrar');
    botao.disabled = true; botao.textContent = '⏳ Registrando…';
    try {
      var user = (await cli.auth.getUser()).data.user;
      // 1) sobe os comprovantes no bucket (bloco 'pagamento')
      for (var i = 0; i < comprovantes.length; i++) {
        var c = comprovantes[i];
        var caminho = s.os + '/' + s.codigo + '/pagamento/' + c.nomeArquivo;
        var up = await cli.storage.from('logistica').upload(caminho, b64ParaBytes(c.base64), { contentType: c.mime, upsert: true });
        if (up.error) throw up.error;
        await cli.from('logistica_anexos').insert({ solicitacao_id: s.id, bloco: 'pagamento', arquivo: c.nomeArquivo, url: caminho, mime: c.mime });
      }
      // 2) marca como pago (só se ainda estiver aguardando pagamento)
      var upd = await cli.from('logistica_solicitacoes')
        .update({ status: 'pago', pago_em: data, forma_pagamento: forma, pago_por: user ? user.id : null })
        .eq('id', s.id).eq('status', 'aguardando_pagamento').select('id');
      if (upd.error) throw upd.error;
      if (!upd.data || !upd.data.length) {
        toast('Este pagamento já foi registrado por outra pessoa.');
      } else {
        try { await cli.from('logistica_eventos').insert({ solicitacao_id: s.id, acao: 'pagou', detalhe: forma + ' em ' + data, por_nome: sessao().nome || null }); } catch (e) { /* best-effort */ }
        toast('💰 Pagamento registrado! Solicitação concluída.');
      }
      EC.app.mostrarTela('tela-aprovacoes');
      pintarLista(); atualizarBadge();
    } catch (e) {
      mostrarErro('Não consegui registrar: ' + (e.message || 'erro'));
    }
    botao.disabled = false; botao.textContent = '💰 Registrar pagamento';
  }

  /* ============ Navegação ============ */

  var iniciado = false;
  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    $('apr-voltar').addEventListener('click', function () { EC.app.mostrarTela('tela-acao'); });
    $('apr-detalhe-voltar').addEventListener('click', function () { EC.app.mostrarTela('tela-aprovacoes'); });
    $('apr-aprovar').addEventListener('click', function () { decidir('aguardando_pagamento'); });
    $('apr-correcao').addEventListener('click', function () { decidir('correcao'); });
    $('apr-rejeitar').addEventListener('click', function () { decidir('rejeitado'); });
    $('pag-registrar').addEventListener('click', registrarPagamento);
  }

  function abrir() {
    iniciar();
    EC.app.mostrarTela('tela-aprovacoes');
    pintarLista();
    atualizarBadge();
  }

  return {
    abrir: abrir, atualizarBadge: atualizarBadge,
    obterPendentesParaSino: obterPendentesParaSino, cartaoHtml: cartao, abrirItemDireto: abrirItemDireto
  };
})();
