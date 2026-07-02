/**
 * reembolso.js — Solicitação de reembolso (tela + envio + meus pedidos)
 *
 * O técnico preenche a despesa (OS obrigatória, data, valor, categoria,
 * descrição) e tira a foto do comprovante (componente EC.foto). O pedido vai
 * para o SGP (/api/reembolso/*), que grava no banco com status 'pendente' —
 * a aprovação e o pagamento acontecem no módulo Financeiro do SGP.
 *
 * Offline-first: sem internet, o pedido (com as fotos) fica guardado no
 * IndexedDB (loja 'pendingReembolso') e é reenviado sozinho quando a conexão
 * volta ou quando a tela é aberta de novo. O envio é em 2 etapas (dados leves
 * primeiro, fotos uma a uma) e idempotente: reenviar não duplica no servidor.
 *
 * Interface (EC.reembolso):
 *   abrir() → mostra a tela "Meus pedidos" (chamada pelo botão da tela inicial).
 */
window.EC = window.EC || {};

EC.reembolso = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/reembolso';
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';

  var CH_LISTA = 'reembolso:lista';        // cache local dos meus pedidos (p/ abrir offline)
  var LOJA_PENDENTES = 'pendingReembolso'; // fila offline (IndexedDB — aguenta as fotos)

  var CATEGORIAS = ['Combustível', 'Pedágio', 'Estacionamento', 'Alimentação',
    'Hospedagem', 'Material', 'Transporte (app/táxi)', 'Outros'];

  var osEscolhida = null;   // OS selecionada no formulário
  var compFoto = null;      // instância do componente de foto
  var opcoesFoto = null;    // opções do componente (mutadas quando a OS muda)
  var iniciado = false;

  function $(id) { return document.getElementById(id); }
  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }

  function solicitante() {
    var s = EC.storage.ler('sessao:atual');
    return (s && s.nome) ? s.nome.trim() : '';
  }

  function moedaBR(v) {
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // 'AAAA-MM-DD…' → 'DD/MM/AAAA' (padrão do app)
  function dataBR(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }

  function hojeISO() {
    var d = new Date();
    function dois(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
  }

  /* ============ Envio ao servidor (2 etapas, como o sync.js) ============ */

  async function postJson(url, dados) {
    var resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN },
      body: JSON.stringify(dados)
    });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* corpo vazio */ }
    if (!resposta.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    return corpo;
  }

  // 1) dados leves (sem fotos) → devolve o id; 2) cada foto separada.
  // Idempotente: reenviar devolve o mesmo id e as fotos repetidas são ignoradas.
  async function enviarPedido(pedido) {
    var resp = await postJson(BASE + '/enviar', {
      codigo: pedido.codigo,
      os: pedido.os,
      ordemServicoId: pedido.ordemServicoId || null,
      projeto: pedido.projeto || '',
      cliente: pedido.cliente || '',
      solicitante: pedido.solicitante,
      dataDespesa: pedido.dataDespesa,
      valor: pedido.valor,
      categoria: pedido.categoria,
      descricao: pedido.descricao || ''
    });
    var fotos = pedido.fotos || [];
    for (var i = 0; i < fotos.length; i++) {
      await postJson(BASE + '/foto', {
        reembolso_id: resp.reembolso_id,
        nomeArquivo: fotos[i].nomeArquivo,
        base64: fotos[i].base64
      });
    }
    return resp;
  }

  /* ============ Fila offline ============ */

  async function pedidosPendentes() {
    try { return (await EC.db.getAll(LOJA_PENDENTES)) || []; } catch (e) { return []; }
  }

  // Reenvia a fila. silencioso=true não avisa quando não há nada para enviar.
  async function enviarPendentes(silencioso) {
    var chaves = [];
    try { chaves = await EC.db.keys(LOJA_PENDENTES); } catch (e) { /* ok */ }
    if (!chaves.length) return;
    var ok = 0, falha = 0;
    for (var i = 0; i < chaves.length; i++) {
      var pedido = null;
      try { pedido = await EC.db.get(LOJA_PENDENTES, chaves[i]); } catch (e) { pedido = null; }
      if (!pedido || !pedido.codigo) {
        try { await EC.db.remove(LOJA_PENDENTES, chaves[i]); } catch (e) { /* ok */ }
        continue;
      }
      try {
        await enviarPedido(pedido);
        try { await EC.db.remove(LOJA_PENDENTES, chaves[i]); } catch (e) { /* ok */ }
        ok++;
      } catch (e) { falha++; }
    }
    if (ok) {
      toast('✅ ' + ok + ' pedido(s) de reembolso enviado(s) ao servidor.');
      atualizarListaDoServidor();
      pintarLista();
    } else if (falha && !silencioso) {
      toast('📴 Ainda sem conexão — o pedido segue guardado no aparelho.');
    }
  }

  /* ============ Meus pedidos (lista) ============ */

  function chipStatus(status) {
    if (status === 'aprovado') return '<span class="rb-status rb-aprovado">✅ Aprovado</span>';
    if (status === 'recusado') return '<span class="rb-status rb-recusado">❌ Recusado</span>';
    if (status === 'pago') return '<span class="rb-status rb-pago">💰 Pago</span>';
    return '<span class="rb-status rb-pendente">⏳ Aguardando aprovação</span>';
  }

  function cartaoPedido(p, aguardandoEnvio) {
    var chip = aguardandoEnvio
      ? '<span class="rb-status rb-aguardando">📴 Aguardando envio</span>'
      : chipStatus(p.status);
    var data = dataBR(p.data_despesa || p.dataDespesa);
    return (
      '<div class="rb-pedido">' +
      '  <div class="rb-pedido-topo"><span class="os-numero">OS ' + (p.os || '?') + '</span>' + chip + '</div>' +
      '  <div class="rb-pedido-linha"><strong>' + moedaBR(p.valor) + '</strong> · ' + (p.categoria || '') +
      (data ? ' · ' + data : '') + '</div>' +
      (p.projeto ? '<div class="os-resumo">📁 ' + p.projeto + '</div>' : '') +
      (p.descricao ? '<div class="os-resumo">' + p.descricao + '</div>' : '') +
      (p.status === 'recusado' && p.motivo_recusa
        ? '<div class="rb-motivo">Motivo da recusa: ' + p.motivo_recusa + '</div>' : '') +
      '</div>'
    );
  }

  function listaEmCache() {
    var cache = EC.storage.ler(CH_LISTA);
    if (cache && cache.solicitante === solicitante() && Array.isArray(cache.pedidos)) return cache.pedidos;
    return [];
  }

  async function pintarLista() {
    var area = $('rb-lista');
    if (!area) return;
    var aguardando = await pedidosPendentes();
    var enviados = listaEmCache();
    // não repete na lista o pedido que ainda está na fila deste aparelho
    var codigosFila = aguardando.map(function (p) { return p.codigo; });
    enviados = enviados.filter(function (p) { return codigosFila.indexOf(p.codigo) === -1; });

    if (!aguardando.length && !enviados.length) {
      area.innerHTML = '<p class="texto-apoio">Nenhum pedido de reembolso ainda. Toque em "Novo pedido" para começar.</p>';
      return;
    }
    area.innerHTML =
      aguardando.map(function (p) { return cartaoPedido(p, true); }).join('') +
      enviados.map(function (p) { return cartaoPedido(p, false); }).join('');
  }

  // Busca os meus pedidos no servidor e atualiza o cache. Best-effort (offline: ignora).
  async function atualizarListaDoServidor() {
    var nome = solicitante();
    if (!nome) return;
    try {
      var resp = await fetch(BASE + '/lista?solicitante=' + encodeURIComponent(nome),
        { headers: { 'x-ecamp-token': TOKEN } });
      var corpo = await resp.json();
      if (resp.ok && corpo.ok && Array.isArray(corpo.pedidos)) {
        EC.storage.salvar(CH_LISTA, { solicitante: nome, pedidos: corpo.pedidos });
        pintarLista();
      }
    } catch (e) { /* offline/erro: fica com o cache */ }
  }

  /* ============ Formulário — escolha da OS ============ */

  function cartaoOsBusca(os) {
    return (
      '<button type="button" class="os-item" data-numero="' + os.numero + '">' +
      '  <span class="os-numero">OS ' + os.numero + '</span>' +
      '  <span class="os-cliente">' + os.cliente + '</span>' +
      (os.projeto ? '  <span class="os-projeto">📁 ' + os.projeto + '</span>' : '') +
      '</button>'
    );
  }

  function pintarResultadosOs(termo) {
    var alvo = $('rb-os-resultados');
    if (!termo.trim()) { alvo.innerHTML = ''; return; }
    var achadas = EC.os.buscar(termo).slice(0, 8);
    alvo.innerHTML = achadas.length
      ? achadas.map(cartaoOsBusca).join('')
      : '<p class="texto-apoio">Nenhuma OS encontrada.</p>';
    alvo.querySelectorAll('.os-item[data-numero]').forEach(function (item) {
      item.addEventListener('click', function () {
        var os = EC.os.osPorNumero(item.dataset.numero);
        if (os) escolherOs(os);
      });
    });
  }

  function escolherOs(os) {
    osEscolhida = os;
    // atualiza o carimbo/nome de arquivo das PRÓXIMAS fotos (o componente lê na captura)
    if (opcoesFoto) opcoesFoto.os = os.numero;
    $('rb-os-picker').classList.add('oculto');
    var chip = $('rb-os-escolhida');
    chip.innerHTML =
      '<div class="rb-os-chip">' +
      '  <div><span class="os-numero">OS ' + os.numero + '</span><br>' +
      '  <span class="os-cliente">' + os.cliente + '</span>' +
      (os.projeto ? '<br><span class="os-projeto">📁 ' + os.projeto + '</span>' : '') + '</div>' +
      '  <button type="button" class="botao botao-mini" id="rb-os-trocar">Trocar</button>' +
      '</div>';
    chip.classList.remove('oculto');
    $('rb-os-trocar').addEventListener('click', function () {
      osEscolhida = null;
      if (opcoesFoto) opcoesFoto.os = '';
      chip.classList.add('oculto');
      chip.innerHTML = '';
      $('rb-os-picker').classList.remove('oculto');
      $('rb-os-busca').focus();
    });
  }

  /* ============ Formulário — novo pedido ============ */

  function mostrarErro(msg) {
    var erro = $('rb-erro');
    if (!msg) { erro.classList.add('oculto'); erro.textContent = ''; return; }
    erro.textContent = '🛑 ' + msg;
    erro.classList.remove('oculto');
  }

  function abrirNovo() {
    osEscolhida = null;
    $('rb-os-busca').value = '';
    $('rb-os-resultados').innerHTML = '';
    $('rb-os-picker').classList.remove('oculto');
    $('rb-os-escolhida').classList.add('oculto');
    $('rb-os-escolhida').innerHTML = '';
    $('rb-data').value = hojeISO();
    $('rb-valor').value = '';
    $('rb-categoria').value = '';
    $('rb-descricao').value = '';
    mostrarErro(null);

    // recria o componente de foto zerado a cada pedido
    opcoesFoto = {
      os: '',
      tipo: 'REEMBOLSO',
      ponto: 'COMPROVANTE',
      rotulo: '📷 Foto do comprovante',
      obterUtm: function () { return 'não se aplica'; }
    };
    compFoto = EC.foto.criar($('rb-foto'), opcoesFoto);

    EC.app.mostrarTela('tela-reembolso-novo');
    // atualiza a lista de OS em segundo plano (para a busca achar as novas)
    EC.os.carregar();
  }

  async function enviarFormulario() {
    var valor = parseFloat($('rb-valor').value);
    var fotos = compFoto ? compFoto.obterFotos() : [];

    if (!osEscolhida) return mostrarErro('Escolha a OS do serviço (obrigatória).');
    if (!$('rb-data').value) return mostrarErro('Informe a data da despesa.');
    if (!(valor > 0)) return mostrarErro('Informe o valor da despesa (maior que zero).');
    if (!$('rb-categoria').value) return mostrarErro('Escolha a categoria da despesa.');
    if (!EC.foto.tem(fotos)) return mostrarErro('Tire a foto do comprovante (obrigatória).');
    mostrarErro(null);

    var agora = new Date();
    var pedido = {
      codigo: 'RB_' + osEscolhida.numero + '_' + agora.getTime() + '_' +
        Math.random().toString(36).slice(2, 8),
      os: osEscolhida.numero,
      ordemServicoId: osEscolhida.osId || null,
      projeto: osEscolhida.projeto || '',
      cliente: osEscolhida.cliente || '',
      solicitante: solicitante(),
      dataDespesa: $('rb-data').value,
      valor: valor,
      categoria: $('rb-categoria').value,
      descricao: $('rb-descricao').value.trim(),
      fotos: fotos.map(function (f) { return { nomeArquivo: f.nomeArquivo, base64: f.base64 }; }),
      criadoEm: agora.toISOString()
    };

    var botao = $('rb-enviar');
    botao.disabled = true;
    botao.textContent = '⏳ Enviando…';
    try {
      await enviarPedido(pedido);
      toast('✅ Pedido de reembolso enviado! Agora é aguardar a aprovação.');
      atualizarListaDoServidor();
    } catch (e) {
      // Offline/erro: guarda na fila (IndexedDB aguenta as fotos) p/ enviar depois.
      try { await EC.db.set(LOJA_PENDENTES, pedido.codigo, pedido); } catch (e2) { /* ok */ }
      toast('📴 Sem conexão. Pedido guardado — será enviado quando a internet voltar.');
    }
    botao.disabled = false;
    botao.textContent = 'Enviar pedido ✓';
    EC.app.mostrarTela('tela-reembolso');
    pintarLista();
  }

  /* ============ Inicialização / navegação ============ */

  function iniciar() {
    if (iniciado) return;
    iniciado = true;

    var select = $('rb-categoria');
    select.innerHTML = '<option value="">Selecione…</option>' +
      CATEGORIAS.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');

    $('rb-novo').addEventListener('click', abrirNovo);
    $('rb-voltar').addEventListener('click', function () { EC.app.mostrarTela('tela-acao'); });
    $('rb-cancelar').addEventListener('click', function () { EC.app.mostrarTela('tela-reembolso'); pintarLista(); });
    $('rb-enviar').addEventListener('click', enviarFormulario);
    $('rb-os-busca').addEventListener('input', function () { pintarResultadosOs(this.value); });
  }

  function abrir() {
    iniciar();
    EC.app.mostrarTela('tela-reembolso');
    pintarLista();
    enviarPendentes(true);          // tenta mandar o que ficou preso
    atualizarListaDoServidor();     // e busca os status mais novos
  }

  // Quando a conexão volta, tenta reenviar a fila em silêncio.
  window.addEventListener('online', function () { enviarPendentes(true); });

  return { abrir: abrir };
})();
