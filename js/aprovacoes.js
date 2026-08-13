/**
 * aprovacoes.js — Aprovação de reembolso DENTRO do e-CAMP
 *
 * SEGREGAÇÃO DE FUNÇÕES (decisão da Raisa, 2026-07-26): quem APROVA o reembolso
 * é o ADMINISTRADOR — a Logística deixou de aprovar (mantendo todo o resto:
 * extrato geral, saldos, tabela de valores, agenda, campo). Quem PAGA continua
 * sendo o Financeiro. Assim ninguém executa a logística e aprova o próprio
 * gasto, e as duas assinaturas do fluxo ficam em pessoas diferentes.
 *
 * Quem aprova (admin) ou paga (financeiro) vê o sino no topo e a tela de
 * Aprovações. Lê e grava DIRETO nas tabelas do SGP com a conta autenticada da
 * pessoa (mesmo padrão da Agenda) — o banco também barra: um gatilho impede
 * sair de 'aguardando_logistica' sem ser admin (migração 0140), então a trava
 * não é só de tela.
 *
 * Fluxo: aguardando_logistica → aprovar (aguardando_pagamento) / rejeitar
 * (rejeitado) / solicitar correção (correcao). Observação obrigatória ao
 * rejeitar ou pedir correção; ao aprovar acima do orçamento previsto, também.
 * (O nome interno do status continua 'aguardando_logistica' por compatibilidade
 * com os dados já gravados; na tela, o rótulo é "Aguardando aprovação".)
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

  // Itens de valor que a Logística pode ajustar no aprovar, por tipo. Cada um
  // mapeia para a coluna concreta de logistica_solicitacoes; o total é a soma.
  var CAMPOS_ITEM = {
    combustivel: { campo: 'valor_combustivel', rotulo: '⛽ Transporte (combustível)' },
    aluguel:     { campo: 'valor_aluguel',     rotulo: '🚗 Aluguel de veículo' },
    pedagio:     { campo: 'valor_pedagio',     rotulo: '🛣️ Pedágio' },
    hospedagem:  { campo: 'valor_hospedagem',  rotulo: '🏨 Hospedagem' },
    mao_obra:    { campo: 'valor_mao_obra',    rotulo: '👷 Mão de obra' },
    almoco:      { campo: 'valor_almoco',      rotulo: '🍽️ Almoço' },
    jantar:      { campo: 'valor_jantar',      rotulo: '🍽️ Jantar' },
    lanche:      { campo: 'valor_lanche',      rotulo: '🥪 Lanche' },
    pecas:       { campo: 'valor_pecas',       rotulo: '🔩 Compra de peças' },
    manutencao:  { campo: 'valor_manutencao',  rotulo: '🛠️ Manutenção' },
    gerador:     { campo: 'valor_gerador',     rotulo: '🔌 Combustível para gerador' },
    outros:      { campo: 'valor_outros',      rotulo: '💠 Outros gastos' }
  };
  var ITENS_POR_TIPO = {
    viagem:      ['combustivel', 'aluguel', 'pedagio', 'hospedagem', 'mao_obra', 'almoco', 'jantar', 'lanche', 'outros'],
    // Sem hospedagem: como a viagem, mais o combustível do gerador (e sem
    // hospedagem, que é sempre zero neste tipo).
    sem_hosp:    ['combustivel', 'aluguel', 'pedagio', 'mao_obra', 'almoco', 'jantar', 'lanche', 'gerador', 'outros'],
    evento:      ['mao_obra', 'outros'],
    veiculo:     ['combustivel', 'pecas', 'manutencao', 'gerador', 'pedagio', 'outros'],
    complemento: ['outros'],
    // Avulso: mesmos itens ajustáveis do veículo (abastecimento reusa valor_combustivel)
    // + o combustível do gerador, que só existe aqui.
    outros_gastos: ['combustivel', 'pecas', 'manutencao', 'gerador', 'pedagio', 'outros']
  };
  // Item do PEDIDO DE AJUSTE do técnico (logistica_ajustes.item) → coluna(s) da
  // solicitação. Note que são AGREGADOS e não batem 1:1 com CAMPOS_ITEM acima:
  // 'transporte' é o combustível e 'alimentacao' junta almoço+jantar+lanche.
  // TODAS as colunas de valor que compõem o total de uma solicitação. Usada para
  // recalcular o total ao ajustar (ver lerAjuste). Se um campo de valor novo for
  // criado no banco, precisa entrar aqui também.
  var COLUNAS_VALOR = ['valor_combustivel', 'valor_aluguel', 'valor_pedagio', 'valor_hospedagem',
    'valor_mao_obra', 'valor_almoco', 'valor_jantar', 'valor_lanche', 'valor_outros',
    'valor_pecas', 'valor_manutencao', 'valor_gerador'];

  var COLUNAS_DO_AJUSTE = {
    transporte: ['valor_combustivel'],
    aluguel: ['valor_aluguel'],
    pedagio: ['valor_pedagio'],
    hospedagem: ['valor_hospedagem'],
    mao_obra: ['valor_mao_obra'],
    alimentacao: ['valor_almoco', 'valor_jantar', 'valor_lanche']
  };

  /**
   * Valor final de um item ajustado = coluna(s) da solicitação (já com o que a
   * Logística tenha editado agora) + o delta do ajuste do técnico. É a MESMA
   * conta que o extrato usa para exibir a linha, então os dois nunca discordam.
   */
  function valorAprovadoDoAjuste(s, camposEditados, ajuste) {
    var cols = COLUNAS_DO_AJUSTE[ajuste.item] || [];
    var base = 0, superado = false;
    for (var c = 0; c < cols.length; c++) {
      var nome = cols[c];
      var editado = camposEditados && camposEditados[nome] != null ? camposEditados[nome] : null;
      if (editado != null) superado = true;
      base += Number(editado != null ? editado : s[nome]) || 0;
    }
    // A Logística mexeu neste item: o valor dela é o final (não soma o delta do
    // técnico por cima — era isso que fazia o ajuste contar duas vezes).
    if (superado) return Math.round(base * 100) / 100;
    var delta = (Number(ajuste.valor_proposto) || 0) - (Number(ajuste.valor_calculado) || 0);
    return Math.round((base + delta) * 100) / 100;
  }

  /**
   * Fecha os pedidos de ajuste do técnico quando a Logística decide.
   *
   * Eles nasciam 'pendente' e ficavam assim PARA SEMPRE — mesmo com a
   * solicitação paga —, e `valor_aprovado` nunca era preenchido por ninguém.
   * O ajuste era aplicado no total e o registro dele nunca era concluído.
   *
   * `valor_aprovado` = valor final do item = coluna (já com o que a Logística
   * eventualmente editou agora) + o delta do ajuste. É a MESMA conta que o
   * extrato usa para exibir a linha, então os dois nunca discordam.
   *
   * Best-effort: nunca derruba a decisão, que já está gravada.
   */
  async function fecharAjustes(cli, s, acao, camposEditados) {
    if (acao !== 'aguardando_pagamento' && acao !== 'rejeitado') return; // 'correcao' volta ao técnico: segue pendente
    try {
      var q = await cli.from('logistica_ajustes')
        .select('id, item, valor_calculado, valor_proposto, status')
        .eq('solicitacao_id', s.id)
        .eq('status', 'pendente');
      var lista = (q.data || []);
      if (!lista.length) return;
      for (var i = 0; i < lista.length; i++) {
        var a = lista[i];
        var patch = { status: acao === 'rejeitado' ? 'rejeitado' : 'aprovado' };
        if (acao === 'aguardando_pagamento') {
          patch.valor_aprovado = valorAprovadoDoAjuste(s, camposEditados, a);
        }
        await cli.from('logistica_ajustes').update(patch).eq('id', a.id);
      }
    } catch (e) { /* o registro do ajuste não pode derrubar a decisão já gravada */ }
  }

  function rotDeCampo(campo) {
    for (var k in CAMPOS_ITEM) if (CAMPOS_ITEM[k].campo === campo) return CAMPOS_ITEM[k].rotulo;
    return campo;
  }

  var detalheAtual = null, orcAtual = null;

  function $(id) { return document.getElementById(id); }
  function sb() { return EC.auth && EC.auth.cliente ? EC.auth.cliente() : null; }
  function sessao() { return EC.storage.ler('sessao:atual') || {}; }
  function toast(m) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(m); }
  function moeda(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  // Datas puras vão direto; timestamps (created_at) convertem p/ Brasília (UTC−3)
  // antes de extrair o dia (senão pedido feito à noite mostra o dia seguinte).
  function dataBR(iso) {
    if (!iso) return '—';
    var s = String(iso);
    function puro(str) { var p = str.slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : str; }
    if (s.length <= 10 || s.indexOf('T') === -1) return puro(s);
    var t = new Date(s).getTime();
    if (isNaN(t)) return puro(s);
    var br = new Date(t - 3 * 3600000);
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return z(br.getUTCDate()) + '/' + z(br.getUTCMonth() + 1) + '/' + br.getUTCFullYear();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Todas as datas "AAAA-MM-DD" de a até b (inclusive); avaliadas em UTC ao meio-dia.
  function intervaloDatas(a, b) {
    var out = [];
    var ini = String(a || '').slice(0, 10), fim = String(b || '').slice(0, 10);
    if (!ini || !fim) return out;
    var t = new Date(ini + 'T12:00:00Z').getTime(), end = new Date(fim + 'T12:00:00Z').getTime();
    if (isNaN(t) || isNaN(end) || t > end) return out;
    while (t <= end) { out.push(new Date(t).toISOString().slice(0, 10)); t += 86400000; }
    return out;
  }
  function ehFimDeSemana(dataISO) {
    if (!dataISO) return false;
    var dia = new Date(String(dataISO).slice(0, 10) + 'T12:00:00Z').getUTCDay();
    return dia === 0 || dia === 6;
  }
  // Detalhamento do almoço pelos dias REAIS da viagem (útil × Nº; + fds só se houver).
  function almocoDetalhe(s, vu, ehFreela) {
    if (ehFreela) return moeda(vu.almoco) + '/dia';
    var datas = intervaloDatas(s.data_inicio, s.data_retorno);
    var nFds = datas.filter(ehFimDeSemana).length, nUtil = datas.length - nFds;
    var partes = [];
    if (nUtil > 0) partes.push(moeda(vu.almoco_clt_util) + ' × ' + nUtil + (nUtil === 1 ? ' dia útil' : ' dias úteis'));
    if (nFds > 0) partes.push(moeda(vu.almoco) + ' × ' + nFds + (nFds === 1 ? ' fim de semana' : ' fins de semana'));
    return partes.join(' + ') || moeda(vu.almoco_clt_util) + '/dia útil';
  }

  // QUEM APROVA: só o ADMINISTRADOR (a Logística não aprova mais — segregação
  // de funções pedida pela Raisa em 2026-07-26). O banco também barra (0140).
  function ehAprovador() {
    var p = sessao().papeis || [];
    return p.indexOf('admin') !== -1;
  }
  function ehFinanceiro() {
    var p = sessao().papeis || [];
    return p.indexOf('financeiro') !== -1 || p.indexOf('admin') !== -1;
  }
  function podeAlgumaAcao() { return ehAprovador() || ehFinanceiro(); }

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
      if (ehAprovador()) n += await contarStatus('aguardando_logistica');
      if (ehFinanceiro()) n += await contarStatus('aguardando_pagamento');
    }
    EC.app.atualizarSino('aprovacoes', n, mostrar);
  }

  /* ============ Lista de pendentes ============ */

  var COLS_LISTA = 'id, os, cliente, solicitante, designado, valor_total, percentual_solicitado, valor_solicitado, adiantamento_valor, tipo, status, created_at, campanha_numero, nova_viagem';

  function cartao(s) {
    var pct = s.percentual_solicitado != null ? Number(s.percentual_solicitado) : 100;
    var bruto = Number(s.valor_solicitado != null ? s.valor_solicitado : s.valor_total) || 0;
    // Valor mostrado = o LÍQUIDO a pagar (parcela − a fração do adiantamento
    // que cabe a ela, adiant × %) — igual ao card do técnico e ao pagamento.
    var adiant = Number(s.adiantamento_valor) || 0;
    var valor = Math.round(bruto * 100 - adiant * pct) / 100;
    var detalhe = adiant > 0
      ? ' (' + pct + '% de ' + moeda(s.valor_total) + ', já com o adiantamento)'
      : (pct < 100 ? ' (' + pct + '% de ' + moeda(s.valor_total) + ')' : '');
    var chip = s.status === 'aguardando_pagamento'
      ? '<span class="rb-status rb-aprovado">✅ Aguardando pagamento</span>'
      : '<span class="rb-status rb-pendente">⏳ Aguardando aprovação</span>';
    var t = s.tipo || 'viagem';
    var ehAvulso = t === 'outros_gastos';
    var tipoTxt = t === 'evento' ? '<span class="rotulo-apoio">🔊 Evento</span> · '
      : t === 'veiculo' ? '<span class="rotulo-apoio">📦 Outros do Serviço</span> · '
      : t === 'complemento' ? '<span class="rotulo-apoio">➕ Complemento</span> · '
      : t === 'sem_hosp' ? '<span class="rotulo-apoio">🏠 Serviço sem hospedagem</span> · '
      : ehAvulso ? '<span class="rotulo-apoio">💸 Outros gastos</span> · ' : '';
    // Campanha: identifica de qual campanha da OS é a solicitação (o avulso não tem).
    var campTxt = !ehAvulso && s.campanha_numero != null && s.campanha_numero !== ''
      ? '<span class="rotulo-apoio">Campanha ' + esc(s.campanha_numero) + '</span> · ' : '';
    var cabecalho = ehAvulso ? '💸 Outros gastos' : 'OS ' + esc(s.os);
    // Nova viagem (campanha 100% paga): marcado já no cartão da lista.
    var nvTxt = s.nova_viagem ? '<span class="rb-status rb-pendente">🧳 NOVA VIAGEM</span> · ' : '';
    return (
      '<button type="button" class="rb-pedido apr-cartao" data-id="' + s.id + '">' +
      '  <div class="rb-pedido-topo"><span class="os-numero">' + cabecalho + '</span>' + chip + '</div>' +
      '  <div class="rb-pedido-linha">' + nvTxt + tipoTxt + campTxt + '<strong>' + moeda(valor) + '</strong>' + detalhe + '</div>' +
      (s.cliente ? '  <div class="os-resumo">' + esc(s.cliente) + '</div>' : '') +
      '  <div class="os-resumo">' + (ehAvulso ? '' : '👷 ' + esc(s.designado || '—') + ' · ') + '✍️ ' + esc(s.solicitante || '—') + '</div>' +
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
      if (ehAprovador()) itens = itens.concat(await buscarStatus(cli, 'aguardando_logistica'));
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
      if (ehAprovador()) secoes.push({ titulo: '⏳ Aguardando aprovação', itens: await buscarStatus(cli, 'aguardando_logistica') });
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
        .select('designado, valor_solicitado, valor_total, devolucao_valor, status')
        .eq('os', s.os)
        .in('status', ['aguardando_pagamento', 'pago']);
      var porDesignado = {};
      var jaAprovado = 0;
      var devolvido = 0;
      (ap.data || []).forEach(function (r) {
        // O que a campanha realmente consumiu = pago − devolvido. Quando a
        // logística muda depois do pagamento e o técnico devolve parte, essa
        // parte não pode continuar contando contra o orçamento da campanha.
        var dev = Number(r.devolucao_valor) || 0;
        var val = Number(r.valor_solicitado != null ? r.valor_solicitado : (r.valor_total || 0)) - dev;
        var nome = (r.designado || '').trim() || '—';
        porDesignado[nome] = (porDesignado[nome] || 0) + val;
        jaAprovado += val;
        devolvido += dev;
      });
      var esta = Number(s.valor_solicitado != null ? s.valor_solicitado : (s.valor_total || 0));
      return { previsto: previsto, jaAprovado: jaAprovado, esta: esta, devolvido: devolvido,
               porDesignado: porDesignado, designadoAtual: (s.designado || '').trim() };
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
      // Explica por que o "já aprovado" está menor do que o que foi pago.
      (o.devolvido > 0 ? '  <div class="apr-orc-linha">↩️ Já descontado de devolução: ' + moeda(o.devolvido) + '</div>' : '') +
      '  <div class="apr-orc-linha">' + estaLabel + ': ' + moeda(o.esta) + ' · Total após: ' + moeda(totalApos) + '</div>' +
      '  <div class="apr-orc-linha" style="margin-top:8px"><strong>Saldo após aprovar: ' + moeda(saldo) + '</strong></div>' +
      '</div>'
    );
  }

  /* ============ Detalhe / decisão ============ */

  function linhaInfo(rot, val) {
    return '<div><span>' + rot + '</span><strong>' + esc(val) + '</strong></div>';
  }

  // NOVA VIAGEM (campanha 100% paga): destaque com o motivo do técnico e a
  // pergunta ADICIONAL do aprovador ("estamos de acordo?") — além da aprovação
  // normal dos valores. Pedido da Raisa, 2026-08-12.
  function blocoNovaViagem(s) {
    if (!s.nova_viagem) return '';
    var podeDecidir = s.status === 'aguardando_logistica' && ehAprovador();
    return '<div class="alerta alerta-amarelo" style="margin-bottom:10px">' +
      '🧳 <strong>NOVA VIAGEM — proposta 100% paga</strong><br>' +
      'Este designado já teve 100% da logística desta campanha solicitado/pago; o técnico está pedindo por uma <strong>nova viagem</strong> para o mesmo serviço (pagamento único, 100%).' +
      '<br><br><strong>Motivo informado:</strong> ' + esc(s.nova_viagem_motivo || '—') +
      (podeDecidir
        ? '<label class="linha-check check-campo" style="margin-top:10px"><input type="checkbox" id="apr-nv-acordo"><span><strong>Estamos de acordo</strong> com esta solicitação de reembolso para uma proposta 100% paga.</span></label>'
        : (s.nova_viagem_acordo ? '<br><br>✅ A logística registrou o <strong>de acordo</strong> desta nova viagem na aprovação.' : '')) +
      '</div>';
  }

  // Detalhe de EVENTOS, VEÍCULOS e COMPLEMENTO: pagamento único (100%), sem datas
  // de viagem, sem base de cálculo automática e sem resumo orçamentário da campanha.
  function renderDetalheSimples(s, ajustes) {
    var t = s.tipo === 'evento' ? 'evento' : (s.tipo === 'complemento' ? 'complemento' : 'veiculo');
    var ehAvulso = s.tipo === 'outros_gastos';
    var cat = s.solicitante_tipo === 'freelancer' ? 'Freelancer' : (s.solicitante_tipo === 'clt' ? 'CLT' : '—');
    var itens = t === 'complemento'
      ? [['➕', 'Complemento de combustível (km a mais)', s.valor_combustivel], ['💠', 'Outros gastos', s.valor_outros]]
      : t === 'evento'
      ? [['🔊', 'Diárias do evento' + (s.dias_servico != null ? ' (' + s.dias_servico + ' dia(s))' : ''), s.valor_mao_obra]]
      : [
          ['⛽', 'Abastecimento', s.valor_combustivel],
          ['🔩', 'Compra de peças', s.valor_pecas],
          ['🛠️', 'Manutenção', s.valor_manutencao],
          ['🛣️', 'Pedágio', s.valor_pedagio]
        ];
    if (t !== 'complemento') itens.push(['💠', 'Outros gastos', s.valor_outros]);
    var valoresHtml = itens.filter(function (l) { return Number(l[2]) > 0; }).map(function (l) {
      return '<div class="apr-vlinha"><span class="apr-vic">' + l[0] + '</span>' +
        '<div class="apr-vmeio"><div class="apr-vrot">' + l[1] + '</div></div>' +
        '<span class="apr-vval">' + moeda(l[2]) + '</span></div>';
    }).join('');
    valoresHtml += '<div class="apr-vlinha" style="border-top:2px solid var(--cinza-borda);">' +
      '<span class="apr-vic">🧾</span>' +
      '<div class="apr-vmeio"><div class="apr-vrot"><strong>TOTAL</strong></div></div>' +
      '<span class="apr-vval"><strong>' + moeda(s.valor_total) + '</strong></span></div>';

    var kmInfo = '';
    if (t === 'complemento') {
      if (s.km_atual != null && s.km_atual !== '') kmInfo += linhaInfo('Quilometragem inicial', s.km_atual + ' km');
      if (s.km_final != null && s.km_final !== '') kmInfo += linhaInfo('Quilometragem final', s.km_final + ' km');
      if (s.km_atual != null && s.km_final != null && s.km_atual !== '' && s.km_final !== '') {
        kmInfo += linhaInfo('Quilometragem percorrida', (Math.round((Number(s.km_final) - Number(s.km_atual)) * 100) / 100) + ' km');
      }
    }
    var outrosJust = '';
    if (t === 'complemento' && Number(s.valor_combustivel) > 0 && s.combustivel_justificativa) {
      outrosJust += '<div class="apr-just">➕ Cálculo do complemento: ' + esc(s.combustivel_justificativa) + '</div>';
    }
    if (Number(s.valor_outros) > 0 && s.outros_justificativa) {
      outrosJust += '<div class="apr-just">💠 Justificativa dos outros gastos: ' + esc(s.outros_justificativa) + '</div>';
    }
    // Ajuste do valor calculado pedido pelo técnico (hoje: complemento).
    var ajHtml = (ajustes && ajustes.length)
      ? '<p class="dg-secao">Ajuste solicitado pelo técnico</p>' + ajustes.map(function (a) {
          return '<div class="apr-ajuste"><strong>' + esc(ITENS_ROTULO[a.item] || a.item) + '</strong>: calculado ' +
            moeda(a.valor_calculado) + ' → proposto <b>' + moeda(a.valor_proposto) + '</b>' +
            (a.justificativa ? '<br><span class="rotulo-apoio">' + esc(a.justificativa) + '</span>' : '') + '</div>';
        }).join('')
      : '';

    // Pagamento único (100%): o adiantamento desconta por inteiro.
    var adiant = Number(s.adiantamento_valor) || 0;
    var aPagar = Math.round((Number(s.valor_total) - adiant) * 100) / 100;
    var hero = '<div class="apr-hero apr-hero-forte"><div class="apr-hero-icone">👛</div>' +
      '<div class="apr-hero-corpo">' +
        '<div class="apr-hero-cab"><div class="apr-hero-titulo">' + (adiant > 0 ? 'A pagar (após adiantamento)' : 'Valor a pagar') + '</div><span class="apr-hero-tag">⭐ Valor a receber</span></div>' +
        '<div class="apr-hero-valor">' + moeda(aPagar) + '</div>' +
        (adiant > 0 ? '<div class="apr-hero-sub">total ' + moeda(s.valor_total) + ' − adiantamento ' + moeda(adiant) + (s.adiantamento_data ? ' em ' + dataBR(s.adiantamento_data) : '') + '</div>' : '') +
        (s.designado ? '<div class="apr-hero-desig">' + esc(s.designado) + '</div>' : '') +
      '</div></div>';

    return (
      '<div class="apr-cab"><span class="os-numero">' + (ehAvulso ? '💸 Outros gastos' : 'OS ' + esc(s.os)) + '</span>' + (s.cliente ? ' · ' + esc(s.cliente) : '') + '</div>' +
      (s.projeto ? '<div class="os-resumo" style="margin:-2px 0 8px;">📁 ' + esc(s.projeto) + '</div>' : '') +
      '<div class="apr-cat">' + (ehAvulso ? '💸 Outros gastos (avulso, sem OS)' : t === 'complemento' ? '➕ Complemento de gastos (OS paga)' : t === 'evento' ? '🔊 Reembolso de EVENTO' : '📦 Reembolso — Outros do Serviço') + '</div>' +
      '<p class="dg-secao">Quem</p>' +
      '<div class="rb-resumo-auto">' +
        linhaInfo(ehAvulso ? 'Solicitante' : 'Solicitante (preencheu)', s.solicitante || '—') +
        (ehAvulso ? '' : linhaInfo('Designado', (s.designado || '—') + ' · ' + cat)) +
        // Avulso não tem OS nem campanha; nos demais, identifica de qual campanha é.
        (ehAvulso || s.campanha_numero == null || s.campanha_numero === ''
          ? '' : linhaInfo('Campanha', s.campanha_numero)) +
        kmInfo +
      '</div>' +
      '<p class="dg-secao">Valores</p>' +
      '<div class="apr-valores">' + valoresHtml + '</div>' +
      outrosJust +
      ajHtml +
      hero
    );
  }

  function renderDetalhe(s, ajustes) {
    // 'sem_hosp' (Serviço sem hospedagem) usa o detalhe completo da viagem.
    var tDet = s.tipo || 'viagem';
    if (tDet !== 'viagem' && tDet !== 'sem_hosp') return renderDetalheSimples(s, ajustes);
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
      ['🍽️', 'Alimentação', alimentacao, 'alimentacao'],
      ['🔌', 'Combustível para gerador' +
        (Number(s.gerador_litros) > 0
          ? ' (' + String(s.gerador_litros).replace('.', ',') + ' L' +
            (s.gerador_combustivel ? ' de ' + esc(s.gerador_combustivel) : '') + ')'
          : ''), s.valor_gerador, 'gerador'],
      ['💠', 'Outros gastos', s.valor_outros, 'outros']
    ];
    var valoresHtml = linhas.filter(function (l) { return Number(l[2]) > 0 || ajPorItem[l[3]]; }).map(function (l) {
      var aj = ajPorItem[l[3]];
      var valFinal = aj ? aj.valor_proposto : l[2];
      var sub = '';
      if (l[3] === 'alimentacao') {
        // Composição da alimentação (só os itens com valor: almoço/jantar/lanche);
        // se houve ajuste, acrescenta o calculado → proposto ao final.
        var comp = [];
        if (Number(s.valor_almoco) > 0) comp.push('almoço ' + moeda(s.valor_almoco));
        if (Number(s.valor_jantar) > 0) comp.push('jantar ' + moeda(s.valor_jantar));
        if (Number(s.valor_lanche) > 0) comp.push('lanche ' + moeda(s.valor_lanche));
        sub = comp.join(' · ');
        if (aj) sub += (sub ? ' · ' : '') + 'calculado ' + moeda(aj.valor_calculado) + ' → proposto ' + moeda(aj.valor_proposto) + ' (ajuste)';
      } else if (aj) {
        sub = moeda(aj.valor_calculado) + ' → ' + moeda(aj.valor_proposto) + ' (ajuste)';
      }
      return '<div class="apr-vlinha"><span class="apr-vic">' + l[0] + '</span>' +
        '<div class="apr-vmeio"><div class="apr-vrot">' + l[1] + '</div>' +
        (sub ? '<div class="apr-vsub">' + sub + '</div>' : '') + '</div>' +
        '<span class="apr-vval">' + moeda(valFinal) + '</span></div>';
    }).join('');
    // Última linha: TOTAL da logística.
    valoresHtml += '<div class="apr-vlinha" style="border-top:2px solid var(--cinza-borda);">' +
      '<span class="apr-vic">🧾</span>' +
      '<div class="apr-vmeio"><div class="apr-vrot"><strong>TOTAL</strong></div></div>' +
      '<span class="apr-vval"><strong>' + moeda(s.valor_total) + '</strong></span></div>';

    var pct = s.percentual_solicitado != null ? Number(s.percentual_solicitado) : 100;
    var solicitado = s.valor_solicitado != null ? s.valor_solicitado : s.valor_total;
    var comb = s.tipo_combustivel ? (s.tipo_combustivel === 'diesel' ? 'Diesel' : 'Gasolina') : null;
    // Trajeto múltiplo (tipo avião): mostra a corrente completa; senão o par.
    var ehMultiTraj = Array.isArray(s.trechos) && s.trechos.length > 1;
    var trajeto;
    if (ehMultiTraj) {
      var ptsTraj = [esc(s.trechos[0].origem_cidade || '?') + (s.trechos[0].origem_uf ? '/' + esc(s.trechos[0].origem_uf) : '')];
      s.trechos.forEach(function (t) {
        ptsTraj.push(esc(t.destino_cidade || '?') + (t.destino_uf ? '/' + esc(t.destino_uf) : ''));
      });
      trajeto = ptsTraj.join(' → ');
    } else {
      trajeto = (s.origem_cidade || s.destino_cidade)
        ? (esc(s.origem_cidade || '?') + (s.origem_uf ? '/' + esc(s.origem_uf) : '') + ' → ' +
           esc(s.destino_cidade || '?') + (s.destino_uf ? '/' + esc(s.destino_uf) : ''))
        : '—';
    }
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
    // O adiantamento reduz do TOTAL; a parcela é o percentual disso.
    var adiant = Number(s.adiantamento_valor) || 0;
    // parcela − a fração do adiantamento que cabe a ela (adiant × %).
    var aPagarPos = Math.round(Number(solicitado) * 100 - adiant * pct) / 100;
    var heroPagar = adiant > 0
      ? '<div class="apr-hero apr-hero-forte"><div class="apr-hero-icone">👛</div>' +
        '<div class="apr-hero-corpo">' +
          '<div class="apr-hero-cab"><div class="apr-hero-titulo">A pagar (após adiantamento)</div><span class="apr-hero-tag">⭐ Valor a receber</span></div>' +
          '<div class="apr-hero-valor">' + moeda(aPagarPos) + '</div>' +
          '<div class="apr-hero-sub">' + pct + '% de (total ' + moeda(s.valor_total) + ' − adiantamento ' + moeda(adiant) + (s.adiantamento_data ? ' em ' + dataBR(s.adiantamento_data) : '') + ')</div>' +
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
    // Mão de obra/dia = valor ÷ dias totais da viagem (é como a diária é aplicada).
    var diasMaoObra = Number(s.dias_viagem) || 0;
    if (Number(s.valor_mao_obra) > 0 && diasMaoObra > 0) {
      bullets.push('Mão de obra: ' + moeda(Math.round(Number(s.valor_mao_obra) / diasMaoObra * 100) / 100) + '/dia');
    }
    // Aluguel/dia = valor ÷ dias totais da viagem. O R$/dia depende do combustível
    // do carro (diesel ≠ gasolina), por isso o combustível aparece junto.
    if (Number(s.valor_aluguel) > 0 && diasMaoObra > 0) {
      bullets.push('Aluguel do veículo: ' + moeda(Math.round(Number(s.valor_aluguel) / diasMaoObra * 100) / 100) + '/dia' +
        (comb ? ' (carro a ' + comb.toLowerCase() + ')' : ''));
    }
    if (Number(s.valor_hospedagem) > 0 && vu.hospedagem_dia != null) {
      bullets.push('Hospedagem: ' + moeda(vu.hospedagem_dia) + '/diária');
    }
    if (Number(s.valor_almoco) > 0 && vu.almoco != null) {
      bullets.push('Almoço: ' + almocoDetalhe(s, vu, ehFreela));
    }
    if (Number(s.valor_jantar) > 0 && vu.jantar != null) {
      bullets.push('Jantar: ' + moeda(vu.jantar) + '/dia');
    }
    if (Number(s.valor_lanche) > 0 && vu.lanche != null) {
      // Sem hospedagem: são dois por dia (um na ida, um na volta).
      bullets.push(tDet === 'sem_hosp'
        ? 'Lanche: ' + moeda(vu.lanche) + ' × 2 (ida e volta) por dia'
        : 'Lanche: ' + moeda(vu.lanche) + '/dia de deslocamento');
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

    // Título: OS + empresa + projeto (logística e financeiro).
    var titulo =
      '<div class="apr-cab"><span class="os-numero">OS ' + esc(s.os) + '</span>' + (s.cliente ? ' · ' + esc(s.cliente) : '') + '</div>' +
      (s.projeto ? '<div class="os-resumo" style="margin:-2px 0 8px;">📁 ' + esc(s.projeto) + '</div>' : '') +
      (tDet === 'sem_hosp' ? '<div class="apr-cat">🏠 Serviço sem hospedagem (voltou para casa todo dia)</div>' : '');

    // Tela do FINANCEIRO (aguardando pagamento): só título, designado, valores e
    // valor a pagar. O formulário "Registrar pagamento" vem do bloco de ações.
    if (s.status === 'aguardando_pagamento') {
      // O adiantamento reduz do TOTAL; a parcela é o percentual disso
      // (= parcela − a fração do adiantamento que cabe a ela).
      var adiantP = Number(s.adiantamento_valor) || 0;
      var aPagar = Math.round(Number(solicitado) * 100 - adiantP * pct) / 100;
      return (
        titulo +
        '<p class="dg-secao">Designado</p>' +
        '<div class="rb-resumo-auto">' +
          linhaInfo('Designado (viagem)', s.designado || '—') +
          linhaInfo('Categoria', tipo) +
        '</div>' +
        '<p class="dg-secao">Valores</p>' +
        '<div class="apr-valores">' + valoresHtml + '</div>' +
        '<div class="apr-hero apr-hero-forte"><div class="apr-hero-icone">👛</div>' +
          '<div class="apr-hero-corpo">' +
            '<div class="apr-hero-titulo">Valor a pagar (' + pct + '% da logística)</div>' +
            '<div class="apr-hero-valor">' + moeda(aPagar) + '</div>' +
            (adiantP > 0 ? '<div class="apr-hero-sub">' + pct + '% de (total ' + moeda(s.valor_total) + ' − adiantamento ' + moeda(adiantP) + (s.adiantamento_data ? ' em ' + dataBR(s.adiantamento_data) : '') + ')</div>' : '') +
            '<div class="apr-hero-desig">' + esc(s.designado || '') + '</div>' +
          '</div></div>'
      );
    }

    return (
      titulo +
      // Nova viagem em campanha 100% paga: motivo + "de acordo" em destaque.
      blocoNovaViagem(s) +
      // Resumo orçamentário só para a Logística (o Financeiro não vê).
      (ehAprovador() ? renderOrcamento(orcAtual) : '') +
      '<p class="dg-secao">Quem</p>' +
      '<div class="rb-resumo-auto">' +
        linhaInfo('Solicitante (preencheu)', s.solicitante || '—') +
        linhaInfo('Designado (viagem)', s.designado || '—') +
      '</div>' +
      '<div class="apr-cat">' + tipo + '</div>' +
      // Sem hospedagem: data de início + quantos dias de ida e volta.
      '<p class="dg-secao">' + (tDet === 'sem_hosp' ? 'Serviço sem hospedagem' : 'Datas da viagem') + '</p>' +
      '<div class="rb-resumo-auto">' +
        linhaInfo('Campanha', s.campanha_numero != null && s.campanha_numero !== '' ? s.campanha_numero : '—') +
        (tDet === 'sem_hosp'
          ? linhaInfo('Início do serviço', dataBR(s.servico_inicio || s.data_inicio)) +
            linhaInfo('Dias de ida e volta', s.dias_deslocamento != null ? s.dias_deslocamento : '—')
          : linhaInfo('Ida', dataBR(s.data_inicio)) +
            linhaInfo('Início do serviço', dataBR(s.servico_inicio)) +
            linhaInfo('Término do serviço', dataBR(s.servico_fim)) +
            linhaInfo('Chegada', dataBR(s.data_retorno)) +
            linhaInfo('Dias de serviço', s.dias_servico) +
            linhaInfo('Dias de deslocamento', s.dias_deslocamento)) +
      '</div>' +
      '<p class="dg-secao">Transporte</p>' +
      '<div class="rb-resumo-auto">' +
        linhaInfo('Veículo', s.veiculo === 'proprio' ? 'Próprio'
          : s.veiculo === 'engear' ? 'ENGEAR'
          : s.veiculo === 'carona' ? 'Carona (sem transporte a pagar)' : '—') +
        (s.km_atual != null && s.km_atual !== '' ? linhaInfo('Quilometragem atual do carro', s.km_atual + ' km') : '') +
        // Com vários trechos, UMA LINHA POR TRECHO: a corrente inteira numa
        // linha só não cabe na tela do celular.
        (ehMultiTraj
          ? s.trechos.map(function (t, i) {
              return linhaInfo('Trecho ' + (i + 1),
                esc(t.origem_cidade || '?') + (t.origem_uf ? '/' + esc(t.origem_uf) : '') + ' → ' +
                esc(t.destino_cidade || '?') + (t.destino_uf ? '/' + esc(t.destino_uf) : '') +
                (t.km ? ' · ' + t.km + ' km' : ''));
            }).join('')
          : linhaInfo('Origem → Destino', trajeto)) +
        linhaInfo(ehMultiTraj ? 'Distância (soma dos trechos)' : 'Distância (ida e volta)', s.distancia_km ? s.distancia_km + ' km' : '—') +
        linhaInfo('Combustível', combTxt) +
      '</div>' +
      (s.combustivel_justificativa ? '<div class="apr-just">⛽ Justificativa do combustível acima do teto: ' + esc(s.combustivel_justificativa) + '</div>' : '') +
      '<p class="dg-secao">Valores</p>' +
      '<div class="apr-valores">' + valoresHtml + '</div>' +
      (Number(s.valor_outros) > 0 && s.outros_justificativa
        ? '<div class="apr-just">💠 Justificativa dos outros gastos: ' + esc(s.outros_justificativa) + '</div>' : '') +
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
      // Os pedidos de ajuste ficam junto da solicitação: o editor de valores
      // precisa deles para não somar o ajuste duas vezes (ver lerAjuste).
      s.ajustes = (res[0].data) || [];
      area.innerHTML = renderDetalhe(s, s.ajustes);
      // No pagamento (Financeiro) a tela é enxuta: sem evidências do técnico.
      var ehPag = s.status === 'aguardando_pagamento';
      $('apr-evidencias-titulo').classList.toggle('oculto', ehPag);
      $('apr-anexos').classList.toggle('oculto', ehPag);
      if (!ehPag) renderAnexos(cli, (res[1].data) || []);
      mostrarAcoes(s);
    } catch (e) {
      area.innerHTML = '<p class="texto-apoio">⚠️ Não consegui carregar: ' + esc(e.message || 'erro') + '</p>';
    }
  }

  // acao: 'aguardando_pagamento' (aprovar) | 'rejeitado' | 'correcao'
  var EVENTO = { aguardando_pagamento: 'aprovou', rejeitado: 'rejeitou', correcao: 'pediu_correcao' };
  var MSG = { aguardando_pagamento: '✅ Aprovada! Seguiu para pagamento.', rejeitado: '❌ Solicitação rejeitada.', correcao: '✏️ Correção solicitada ao técnico.' };

  // ---- Ajuste de VALORES pela Logística (edição por item) -------------------
  // Monta os campos editáveis (só os itens com valor > 0), guardando o valor
  // original em data-orig. O total recalcula a partir dos deltas (robusto mesmo
  // que o total tenha componentes fora desta lista).
  function montarAjusteEditor(s) {
    var wrap = $('apr-ajuste-itens');
    if (!wrap) return;
    var tipo = s.tipo || 'viagem';
    var chaves = (ITENS_POR_TIPO[tipo] || ITENS_POR_TIPO.viagem).filter(function (k) {
      return Number(s[CAMPOS_ITEM[k].campo]) > 0;
    });
    if (!chaves.length) {
      wrap.innerHTML = '<p class="texto-apoio">Sem itens de valor para ajustar.</p>';
      if ($('apr-ajuste-hint')) $('apr-ajuste-hint').textContent = '';
      return;
    }
    // Aviso quando o técnico pediu ajuste: os campos abaixo mostram o valor
    // CALCULADO, mas o total já embute o que ele pediu. Sem isto, quem edita não
    // entende por que o total não bate com a soma dos campos.
    var pedidos = (s.ajustes || []).filter(function (a) {
      return Math.abs((Number(a.valor_proposto) || 0) - (Number(a.valor_calculado) || 0)) > 0.001;
    });
    var aviso = pedidos.length
      ? '<div class="apr-just" style="margin-bottom:8px;">↺ <strong>O técnico pediu ajuste</strong> — já embutido no total:<br>' +
        pedidos.map(function (a) {
          return esc(ITENS_ROTULO[a.item] || a.item) + ': ' + moeda(a.valor_calculado) + ' → <b>' + moeda(a.valor_proposto) + '</b>';
        }).join('<br>') +
        '<br><span class="rotulo-apoio">Os campos abaixo mostram o valor calculado. Se você editar um item ajustado, o SEU valor passa a valer nele.</span></div>'
      : '';

    wrap.innerHTML = aviso + chaves.map(function (k) {
      var it = CAMPOS_ITEM[k];
      var v = Math.round(Number(s[it.campo]) * 100) / 100;
      return '<label class="apr-ajuste-item"><span>' + it.rotulo + '</span>' +
        '<input type="number" class="apr-ajuste-in" data-campo="' + it.campo + '" data-orig="' + v + '" ' +
        'min="0" step="0.01" inputmode="decimal" value="' + v + '"></label>';
    }).join('');
    wrap.querySelectorAll('.apr-ajuste-in').forEach(function (inp) {
      inp.addEventListener('input', function () { recalcularAjuste(s); });
    });
    recalcularAjuste(s);
  }

  /**
   * Lê os campos editados e recalcula o total.
   *
   * O TOTAL é a soma das colunas (já com as edições) MAIS os ajustes do técnico
   * que continuam valendo. Antes era `valor_total + delta`, e isso contava o
   * ajuste DUAS vezes ao editar justo o item ajustado: o `valor_total` já
   * embutia o ajuste, enquanto os campos da tela partem do valor CALCULADO.
   * Exemplo real (OS 25311): combustível calculado 52,54 com ajuste para 91,00,
   * total 241. Pôr 60 no campo dava 241 + (60 − 52,54) = 248,46 em vez de 210.
   *
   * Quem edita um item MANDA nele: o ajuste do técnico daquele item é superado
   * (não soma mais). Os ajustes dos itens que ela não tocou seguem valendo.
   */
  function lerAjuste(s) {
    var wrap = $('apr-ajuste-itens');
    var inps = wrap ? wrap.querySelectorAll('.apr-ajuste-in') : [];
    var mudou = false, campos = {};
    Array.prototype.forEach.call(inps, function (inp) {
      var orig = Math.round((parseFloat(inp.dataset.orig) || 0) * 100) / 100;
      var bruto = String(inp.value).trim().replace(',', '.');
      var val = bruto === '' ? orig : Math.round(parseFloat(bruto) * 100) / 100;
      if (isNaN(val) || val < 0) val = orig;
      if (Math.abs(val - orig) > 0.001) { mudou = true; campos[inp.dataset.campo] = val; }
    });
    // Sem edição, o total é o que já está gravado — nada de recalcular à toa.
    if (!mudou) {
      return { novoTotal: Math.round((Number(s.valor_total) || 0) * 100) / 100, mudou: false, campos: {}, superados: [] };
    }
    var soma = 0;
    for (var i = 0; i < COLUNAS_VALOR.length; i++) {
      var c = COLUNAS_VALOR[i];
      soma += Number(campos[c] != null ? campos[c] : s[c]) || 0;
    }
    var extra = 0, superados = [];
    (s.ajustes || []).forEach(function (a) {
      var cols = COLUNAS_DO_AJUSTE[a.item] || [];
      var tocou = false;
      for (var j = 0; j < cols.length; j++) if (campos[cols[j]] != null) tocou = true;
      if (tocou) superados.push(a.item);
      else extra += (Number(a.valor_proposto) || 0) - (Number(a.valor_calculado) || 0);
    });
    return { novoTotal: Math.round((soma + extra) * 100) / 100, mudou: true, campos: campos, superados: superados };
  }

  function recalcularAjuste(s) {
    var hint = $('apr-ajuste-hint');
    if (!hint) return;
    var r = lerAjuste(s);
    var totalOrig = Math.round((Number(s.valor_total) || 0) * 100) / 100;
    if (r.mudou) {
      // Editar um item que o técnico pediu ajuste SUBSTITUI o pedido dele nesse
      // item (senão o ajuste contaria duas vezes). Dizer isso na hora evita
      // surpresa no total.
      var trocado = (r.superados || []).length
        ? '<br><span class="rotulo-apoio">↺ O pedido de ajuste do técnico em ' +
          r.superados.map(function (i) { return esc(ITENS_ROTULO[i] || i); }).join(', ') +
          ' foi substituído pelo seu valor.</span>'
        : '';
      hint.innerHTML = 'Novo total: <strong>' + moeda(r.novoTotal) + '</strong> · calculado: ' + moeda(totalOrig) +
        '. Justifique o ajuste na observação abaixo.' + trocado;
    } else {
      hint.textContent = 'Total calculado: ' + moeda(totalOrig) + '. Edite um item acima para pagar mais ou menos (com justificativa).';
    }
  }

  async function decidir(acao) {
    var s = detalheAtual;
    if (!s) return;
    var obs = $('apr-obs').value.trim();
    if ((acao === 'rejeitado' || acao === 'correcao') && !obs) {
      return mostrarErro('Escreva a observação para ' + (acao === 'rejeitado' ? 'rejeitar' : 'pedir correção') + '.');
    }
    // ---- Ajuste da LOGÍSTICA ao aprovar (para MAIS ou para MENOS) ----
    // Se a logística não aceita o valor como está, ela ajusta (nos dois sentidos),
    // justifica e segue direto para o pagamento — não devolve ao técnico.
    var totalAtual = Number(s.valor_total) || 0;
    var aj = lerAjuste(s);   // { novoTotal, mudou, campos }
    var novoTotal = null;
    var temAjuste = false;
    if (acao === 'aguardando_pagamento' && aj.mudou) {
      temAjuste = true;
      novoTotal = aj.novoTotal;
      if (!(novoTotal > 0)) return mostrarErro('O novo total ficou inválido (deve ser maior que zero).');
      if (!obs) return mostrarErro('Você está ajustando valores — escreva a justificativa na observação.');
    }
    // aprovar acima do orçamento previsto → exige justificativa na observação
    if (acao === 'aguardando_pagamento' && orcAtual && orcAtual.previsto > 0 &&
        (orcAtual.jaAprovado + orcAtual.esta) > orcAtual.previsto && !obs) {
      return mostrarErro('Esta aprovação passa do orçamento previsto da campanha — escreva a justificativa na observação.');
    }
    // NOVA VIAGEM (campanha 100% paga): a aprovação exige o "de acordo" explícito
    // — pergunta adicional à aprovação dos valores (caixinha no destaque amarelo).
    if (acao === 'aguardando_pagamento' && s.nova_viagem) {
      var chkNv = $('apr-nv-acordo');
      if (!chkNv || !chkNv.checked) {
        return mostrarErro('Marque o "Estamos de acordo" da NOVA VIAGEM (no destaque amarelo, acima) antes de aprovar.');
      }
    }
    var cli = sb();
    if (!cli) return mostrarErro('Sem conexão — abra com internet para decidir.');
    mostrarErro(null);

    var botoes = ['apr-aprovar', 'apr-correcao', 'apr-rejeitar'];
    botoes.forEach(function (b) { $(b).disabled = true; });
    try {
      var user = (await cli.auth.getUser()).data.user;
      var campos = {
        status: acao,
        observacao_logistica: obs || null,
        decidido_em: new Date().toISOString(),
        decidido_por: user ? user.id : null
      };
      // Registra o "de acordo" da nova viagem junto da aprovação.
      if (acao === 'aguardando_pagamento' && s.nova_viagem) campos.nova_viagem_acordo = true;
      // Aplica o ajuste (para mais ou para menos): grava os itens editados, o novo
      // total e a parcela recalculada pelo percentual. Segue direto p/ pagamento.
      if (temAjuste) {
        var pct = s.percentual_solicitado != null ? Number(s.percentual_solicitado) : 100;
        Object.keys(aj.campos).forEach(function (c) { campos[c] = aj.campos[c]; });
        campos.valor_total = novoTotal;
        campos.valor_solicitado = Math.round(novoTotal * pct) / 100;
      }
      var upd = await cli.from('logistica_solicitacoes')
        .update(campos)
        .eq('id', s.id)
        .eq('status', 'aguardando_logistica')   // só decide se ainda estiver pendente
        .select('id');
      if (upd.error) throw upd.error;
      if (!upd.data || !upd.data.length) {
        toast('Esta solicitação já foi decidida por outra pessoa.');
      } else {
        // Conclui os pedidos de ajuste do técnico junto com a decisão.
        await fecharAjustes(cli, s, acao, campos);
        try {
          var det = temAjuste
            ? 'Logística ajustou (total ' + moeda(totalAtual) + ' → ' + moeda(novoTotal) + '): ' +
              Object.keys(aj.campos).map(function (c) { return rotDeCampo(c) + ' → ' + moeda(aj.campos[c]); }).join(', ') +
              (obs ? ' — ' + obs : '')
            : (obs || null);
          if (acao === 'aguardando_pagamento' && s.nova_viagem) {
            det = (det ? det + ' — ' : '') + 'DE ACORDO com a NOVA VIAGEM (proposta 100% paga)';
          }
          await cli.from('logistica_eventos').insert({
            solicitacao_id: s.id, acao: EVENTO[acao],
            detalhe: det, por_nome: sessao().nome || null
          });
        } catch (e) { /* auditoria é best-effort */ }
        toast(temAjuste ? '✅ Ajustada e aprovada! Seguiu para pagamento.' : MSG[acao]);
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
    if (s.status === 'aguardando_logistica' && ehAprovador()) {
      $('apr-obs').value = '';
      montarAjusteEditor(s);
      bLog.classList.remove('oculto');
    } else if (s.status === 'aguardando_pagamento' && ehFinanceiro()) {
      $('pag-data').value = hojeISO();
      $('pag-forma').value = '';
      $('pag-banco').value = '';
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
    var banco = $('pag-banco').value;
    var comprovantes = pagUploader ? pagUploader.obter() : [];
    if (!data) return mostrarErro('Informe a data do pagamento.');
    if (!forma) return mostrarErro('Escolha a forma de pagamento.');
    if (!banco) return mostrarErro('Escolha o banco de saída.');
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
        .update({ status: 'pago', pago_em: data, forma_pagamento: forma, banco_saida: banco, pago_por: user ? user.id : null })
        .eq('id', s.id).eq('status', 'aguardando_pagamento').select('id');
      if (upd.error) throw upd.error;
      if (!upd.data || !upd.data.length) {
        toast('Este pagamento já foi registrado por outra pessoa.');
      } else {
        try { await cli.from('logistica_eventos').insert({ solicitacao_id: s.id, acao: 'pagou', detalhe: forma + ' (' + banco + ') em ' + data, por_nome: sessao().nome || null }); } catch (e) { /* best-effort */ }
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
