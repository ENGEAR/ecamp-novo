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

  // Sessões antigas podem não ter os papéis gravados — busca uma vez.
  async function garantirPapeis() {
    var s = sessao();
    if (Array.isArray(s.papeis)) return;
    if (!EC.auth || !EC.auth.meusPapeis) return;
    try { s.papeis = await EC.auth.meusPapeis(); EC.storage.salvar('sessao:atual', s); } catch (e) { /* offline */ }
  }

  /* ============ Sino / badge no topo ============ */

  async function contarPendentes() {
    var cli = sb();
    if (!cli) return 0;
    try {
      var q = await cli.from('logistica_solicitacoes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'aguardando_logistica');
      return q.count || 0;
    } catch (e) { return 0; }
  }

  async function atualizarBadge() {
    var botao = $('btn-aprovacoes');
    if (!botao) return;
    await garantirPapeis();
    botao.classList.toggle('oculto', !ehLogistica());
    if (!ehLogistica()) return;
    var n = await contarPendentes();
    var badge = $('sino-badge');
    if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.classList.remove('oculto'); }
    else badge.classList.add('oculto');
  }

  /* ============ Lista de pendentes ============ */

  function cartao(s) {
    var pct = s.percentual_solicitado != null ? Number(s.percentual_solicitado) : 100;
    var valor = s.valor_solicitado != null ? s.valor_solicitado : s.valor_total;
    return (
      '<button type="button" class="rb-pedido apr-cartao" data-id="' + s.id + '">' +
      '  <div class="rb-pedido-topo"><span class="os-numero">OS ' + esc(s.os) + '</span>' +
      '    <span class="rb-status rb-pendente">⏳ Aguardando</span></div>' +
      '  <div class="rb-pedido-linha"><strong>' + moeda(valor) + '</strong>' + (pct < 100 ? ' (' + pct + '% de ' + moeda(s.valor_total) + ')' : '') + '</div>' +
      (s.cliente ? '  <div class="os-resumo">' + esc(s.cliente) + '</div>' : '') +
      '  <div class="os-resumo">👷 ' + esc(s.designado || '—') + ' · ✍️ ' + esc(s.solicitante || '—') + '</div>' +
      '</button>'
    );
  }

  async function pintarLista() {
    var area = $('apr-lista');
    area.innerHTML = '<p class="texto-apoio">Carregando…</p>';
    var cli = sb();
    if (!cli) { area.innerHTML = '<p class="texto-apoio">📡 Sem conexão. Abra com internet para ver e aprovar.</p>'; return; }
    try {
      var q = await cli.from('logistica_solicitacoes')
        .select('id, os, cliente, solicitante, designado, valor_total, percentual_solicitado, valor_solicitado, created_at')
        .eq('status', 'aguardando_logistica')
        .order('created_at', { ascending: true });
      if (q.error) throw q.error;
      var lista = q.data || [];
      if (!lista.length) { area.innerHTML = '<p class="texto-apoio">🎉 Nenhuma solicitação aguardando aprovação.</p>'; return; }
      area.innerHTML = lista.map(cartao).join('');
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
      // já aprovado/pago nesta OS (não conta a própria solicitação)
      var ap = await cli.from('logistica_solicitacoes')
        .select('valor_solicitado, valor_total, status')
        .eq('os', s.os)
        .in('status', ['aguardando_pagamento', 'pago']);
      var jaAprovado = (ap.data || []).reduce(function (t, r) {
        return t + Number(r.valor_solicitado != null ? r.valor_solicitado : (r.valor_total || 0));
      }, 0);
      var esta = Number(s.valor_solicitado != null ? s.valor_solicitado : (s.valor_total || 0));
      return { previsto: previsto, jaAprovado: jaAprovado, esta: esta };
    } catch (e) { return null; }
  }

  function renderOrcamento(o) {
    if (!o || !(o.previsto > 0)) {
      return '<div class="apr-orc apr-orc-cinza">💰 Logística prevista da campanha: não informada na OS.<br>Já aprovado nesta OS: ' + moeda(o ? o.jaAprovado : 0) + '.</div>';
    }
    var totalApos = o.jaAprovado + o.esta;
    var pct = Math.round((totalApos / o.previsto) * 100);
    var saldo = o.previsto - totalApos;
    var cls = pct <= 80 ? 'apr-orc-verde' : (pct <= 100 ? 'apr-orc-amarelo' : 'apr-orc-vermelho');
    var situacao = pct <= 80 ? 'Dentro do orçamento' : (pct <= 100 ? 'Atenção: perto do limite' : '⚠️ Orçamento excedido');
    return (
      '<div class="apr-orc ' + cls + '">' +
      '  <div class="apr-orc-topo"><strong>' + situacao + '</strong><span>' + pct + '%</span></div>' +
      '  <div class="apr-orc-linha">Prevista: ' + moeda(o.previsto) + ' · Já aprovado: ' + moeda(o.jaAprovado) + '</div>' +
      '  <div class="apr-orc-linha">Esta solicitação: ' + moeda(o.esta) + ' · Total após: ' + moeda(totalApos) + '</div>' +
      '  <div class="apr-orc-linha">Saldo após aprovar: ' + moeda(saldo) + '</div>' +
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
    var linhas = [
      ['⛽ Transporte (combustível)', s.valor_combustivel],
      ['🚗 Aluguel de veículo', s.valor_aluguel],
      ['🛣️ Pedágio', s.valor_pedagio],
      ['🏨 Hospedagem', s.valor_hospedagem],
      ['👷 Mão de obra', s.valor_mao_obra],
      ['🍽️ Alimentação', alimentacao]
    ];
    var valoresHtml = linhas.filter(function (l) { return Number(l[1]) > 0; }).map(function (l) {
      return '<div class="apr-linha"><span>' + l[0] + '</span><strong>' + moeda(l[1]) + '</strong></div>';
    }).join('');

    var ajHtml = ajustes.length
      ? '<p class="dg-secao">Ajustes solicitados pelo técnico</p>' + ajustes.map(function (a) {
          return '<div class="apr-ajuste"><strong>' + esc(ITENS_ROTULO[a.item] || a.item) + '</strong>' +
            '<div class="os-resumo">Calculado: ' + moeda(a.valor_calculado) + ' → Proposto: <b>' + moeda(a.valor_proposto) + '</b></div>' +
            '<div class="apr-just">' + esc(a.justificativa) + '</div></div>';
        }).join('')
      : '';

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

    return (
      '<div class="apr-cab"><span class="os-numero">OS ' + esc(s.os) + '</span>' + (s.cliente ? ' · ' + esc(s.cliente) : '') + '</div>' +
      renderOrcamento(orcAtual) +
      '<p class="dg-secao">Quem</p>' +
      '<div class="rb-resumo-auto">' +
        linhaInfo('Solicitante (preencheu)', s.solicitante || '—') +
        linhaInfo('Designado (viagem)', (s.designado || '—') + ' · ' + tipo) +
      '</div>' +
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
      '<p class="dg-secao">Valores</p>' + valoresHtml +
      '<div class="rb-total" style="margin-top:10px;">Total da logística: <strong>' + moeda(s.valor_total) + '</strong>' +
      '<span class="rb-total-sub">Solicitado: ' + pct + '% = ' + moeda(solicitado) + '</span></div>' +
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
    mostrarErro(null);
    detalheAtual = null; orcAtual = null;
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
  }

  function abrir() {
    iniciar();
    EC.app.mostrarTela('tela-aprovacoes');
    pintarLista();
    atualizarBadge();
  }

  return { abrir: abrir, atualizarBadge: atualizarBadge };
})();
