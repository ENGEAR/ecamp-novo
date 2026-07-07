/**
 * reembolso.js — Solicitação de Reembolso de viagem (módulo Logística)
 *
 * Fluxo da especificação: o técnico escolhe a OS (só com programação
 * CONCLUÍDA), a campanha e o solicitante (técnicos vinculados na Agenda);
 * os dias (viagem/serviço/deslocamento), a categoria (CLT/freelancer), a
 * data de retorno e a distância vêm SOZINHOS do servidor. O app calcula os
 * valores (combustível, aluguel, hospedagem, mão de obra, alimentação) com
 * os valores/diárias vigentes e pergunta "Você concorda com este valor?" —
 * discordou, pede ajuste com justificativa. O servidor recalcula tudo no
 * envio (o app nunca manda valor pronto) e a solicitação entra como
 * "Aguardando aprovação da Logística".
 *
 * Offline: a CRIAÇÃO precisa de internet (os dados vêm da Agenda), mas o
 * ENVIO não — se a conexão cair na hora de enviar, o pedido (com anexos)
 * fica na fila (IndexedDB 'pendingReembolso') e sobe sozinho depois.
 *
 * Interface (EC.reembolso): abrir() — chamada pelo botão da tela inicial.
 */
window.EC = window.EC || {};

EC.reembolso = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/logistica';
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';

  var CH_CONTEXTO = 'logistica:contexto';   // cache do contexto (OS elegíveis + valores)
  var CH_LISTA = 'logistica:lista';         // cache das minhas solicitações
  var LOJA_PENDENTES = 'pendingReembolso';  // fila offline (IndexedDB)
  var MAX_ANEXOS = 20;                      // por bloco (combustível, pedágio, ajuste…)
  var LADO_MAXIMO = 1600;                   // resolução máxima das fotos
  var PDF_MAX_MB = 3.5;                     // limite por PDF (limite de corpo da Vercel)

  // Itens dos valores automáticos ("Você concorda com este valor?")
  var ITENS = [
    { chave: 'transporte',  rotulo: '⛽ Transporte (combustível)' },
    { chave: 'aluguel',     rotulo: '🚗 Aluguel de veículo' },
    { chave: 'hospedagem',  rotulo: '🏨 Hospedagem' },
    { chave: 'mao_obra',    rotulo: '👷 Mão de obra' },
    { chave: 'alimentacao', rotulo: '🍽️ Alimentação' }
  ];

  var ctx = null;          // contexto do servidor: { valores, os: [...] }
  var osSel = null, campSel = null, tecSel = null;
  var anexos = {};         // instâncias do componente de anexos, por bloco
  var iniciado = false;

  function $(id) { return document.getElementById(id); }
  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }

  function moedaBR(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function dataBR(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }

  /* ============ HTTP ============ */

  async function postJson(url, dados) {
    var resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN },
      body: JSON.stringify(dados)
    });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* corpo vazio */ }
    if (!resposta.ok || !corpo.ok) {
      var err = new Error(corpo.erro || ('HTTP ' + resposta.status));
      err.rejeitado = (resposta.status === 400 || resposta.status === 404 || resposta.status === 422);
      throw err;
    }
    return corpo;
  }

  async function getJson(url) {
    var resposta = await fetch(url, { headers: { 'x-ecamp-token': TOKEN } });
    var corpo = await resposta.json();
    if (!resposta.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    return corpo;
  }

  /* ============ Componente de anexos (fotos + PDF) ============ */

  function criarAnexos(container) {
    var arquivos = [];
    container.innerHTML =
      '<div class="anx">' +
      '  <div class="anx-lista"></div>' +
      '  <div class="anx-botoes">' +
      '    <button type="button" class="botao botao-secundario anx-foto">📷 Tirar foto</button>' +
      '    <button type="button" class="botao botao-secundario anx-pdf">📎 Anexar PDF</button>' +
      '  </div>' +
      '  <input type="file" accept="image/*" capture="environment" class="anx-entrada-foto" hidden>' +
      '  <input type="file" accept="application/pdf" class="anx-entrada-pdf" hidden>' +
      '  <div class="anx-status"></div>' +
      '</div>';

    var lista = container.querySelector('.anx-lista');
    var status = container.querySelector('.anx-status');
    var btnFoto = container.querySelector('.anx-foto');
    var btnPdf = container.querySelector('.anx-pdf');
    var inFoto = container.querySelector('.anx-entrada-foto');
    var inPdf = container.querySelector('.anx-entrada-pdf');

    function render() {
      lista.innerHTML = arquivos.map(function (a, i) {
        var visual = a.mime === 'application/pdf'
          ? '<span class="anx-pdf-icone">📄</span>'
          : '<img src="data:image/jpeg;base64,' + a.base64 + '" alt="anexo">';
        return '<div class="anx-item">' + visual +
          '<span class="anx-nome">' + a.nomeArquivo + '</span>' +
          '<button type="button" class="anx-remover" data-i="' + i + '" title="Remover">✕</button></div>';
      }).join('');
      lista.querySelectorAll('.anx-remover').forEach(function (b) {
        b.addEventListener('click', function () { arquivos.splice(parseInt(b.dataset.i, 10), 1); render(); });
      });
      var cheio = arquivos.length >= MAX_ANEXOS;
      btnFoto.disabled = cheio; btnPdf.disabled = cheio;
    }

    function carimbo() {
      var d = new Date();
      function dois(n) { return n < 10 ? '0' + n : '' + n; }
      return '' + d.getFullYear() + dois(d.getMonth() + 1) + dois(d.getDate()) +
        '_' + dois(d.getHours()) + dois(d.getMinutes()) + dois(d.getSeconds());
    }

    btnFoto.addEventListener('click', function () { inFoto.click(); });
    btnPdf.addEventListener('click', function () { inPdf.click(); });

    inFoto.addEventListener('change', function () {
      var arq = inFoto.files && inFoto.files[0];
      if (!arq) return;
      status.textContent = '⏳ Processando a foto…';
      var leitor = new FileReader();
      leitor.onload = function () {
        var img = new Image();
        img.onload = function () {
          var escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * escala);
          canvas.height = Math.round(img.height * escala);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          arquivos.push({
            nomeArquivo: 'EVIDENCIA_' + carimbo() + '_F' + (arquivos.length + 1) + '.jpg',
            base64: dataUrl.split(',')[1],
            mime: 'image/jpeg'
          });
          render();
          status.textContent = '✅ Foto adicionada (' + arquivos.length + '/' + MAX_ANEXOS + ').';
          inFoto.value = '';
        };
        img.onerror = function () { status.textContent = '⚠️ Não foi possível ler a imagem.'; };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arq);
    });

    inPdf.addEventListener('change', function () {
      var arq = inPdf.files && inPdf.files[0];
      if (!arq) return;
      if (arq.size > PDF_MAX_MB * 1024 * 1024) {
        status.textContent = '⚠️ PDF muito grande (máx. ' + PDF_MAX_MB + ' MB).';
        inPdf.value = '';
        return;
      }
      var leitor = new FileReader();
      leitor.onload = function () {
        arquivos.push({
          nomeArquivo: (arq.name || ('documento_' + carimbo() + '.pdf')).replace(/[^\w.\-()À-ſ ]+/g, '_'),
          base64: String(leitor.result).split(',')[1],
          mime: 'application/pdf'
        });
        render();
        status.textContent = '✅ PDF anexado (' + arquivos.length + '/' + MAX_ANEXOS + ').';
        inPdf.value = '';
      };
      leitor.readAsDataURL(arq);
    });

    render();
    return { obter: function () { return arquivos.slice(); } };
  }

  /* ============ Cálculo (espelho das regras do servidor) ============ */

  function veiculo() {
    var m = document.querySelector('input[name="rb-veiculo"]:checked');
    return m ? m.value : '';
  }

  function calcular() {
    if (!ctx || !campSel || !tecSel) return null;
    var v = ctx.valores, c = campSel;
    var preco = parseFloat($('rb-preco-litro').value) || 0;
    var consumo = Number(v.consumo_padrao_kml) || 0;
    var dist = Number(osSel && osSel.distanciaKm) || 0;
    var r2 = function (x) { return Math.round(x * 100) / 100; };

    var combustivel = (preco > 0 && dist > 0 && consumo > 0) ? r2((dist / consumo) * preco) : 0;
    var aluguel = veiculo() === 'proprio' ? r2(Number(v.aluguel_veiculo_dia) * c.diasViagem) : 0;
    var hospedagem = r2(Number(v.hospedagem_dia) * c.diasServico);
    var maoObra = tecSel.tipo === 'freelancer'
      ? r2(Number(v.diaria_freelancer) * (c.diasDeslocamento + c.diasServico))
      : (c.diasViagem >= 2 ? r2(Number(v.diaria_clt) * c.diasViagem) : 0);
    var almoco = r2(Number(v.almoco) * c.diasServico);
    var jantar = r2(Number(v.jantar) * c.diasServico);
    var lanche = r2(Number(v.lanche) * c.diasDeslocamento);
    var pedagio = r2(parseFloat($('rb-pedagio').value) || 0);
    var alimentacao = r2(almoco + jantar + lanche);

    return {
      transporte: combustivel, aluguel: aluguel, pedagio: pedagio, hospedagem: hospedagem,
      mao_obra: maoObra, alimentacao: alimentacao, almoco: almoco, jantar: jantar, lanche: lanche,
      total: r2(combustivel + aluguel + pedagio + hospedagem + maoObra + alimentacao)
    };
  }

  function tetoDoCombustivel() {
    if (!ctx) return 0;
    return $('rb-combustivel').value === 'diesel'
      ? Number(ctx.valores.teto_diesel) : Number(ctx.valores.teto_gasolina);
  }

  /* ============ Contexto (OS elegíveis + valores) ============ */

  async function atualizarContexto() {
    try {
      var corpo = await getJson(BASE + '/contexto');
      ctx = { valores: corpo.valores, os: corpo.os || [] };
      EC.storage.salvar(CH_CONTEXTO, ctx);
      return true;
    } catch (e) {
      ctx = EC.storage.ler(CH_CONTEXTO) || null; // offline: usa o último baixado
      return !!ctx;
    }
  }

  /* ============ Formulário — montagem e cascata ============ */

  function opcao(valor, texto) { return '<option value="' + valor + '">' + texto + '</option>'; }

  function montarValores() {
    // estrutura FIXA (montada 1x por solicitação) — os números são atualizados em spans
    $('rb-valores').innerHTML = ITENS.map(function (it) {
      return (
        '<div class="rb-item" id="rb-item-' + it.chave + '">' +
        '  <div class="rb-item-topo"><span>' + it.rotulo + '</span><strong id="rb-val-' + it.chave + '">R$ 0,00</strong></div>' +
        '  <div class="rb-item-sub" id="rb-sub-' + it.chave + '"></div>' +
        '  <div class="rb-radios">' +
        '    <label class="linha-check"><input type="radio" name="rb-dec-' + it.chave + '" value="concordo" checked><span>Concordo com o valor</span></label>' +
        '    <label class="linha-check"><input type="radio" name="rb-dec-' + it.chave + '" value="ajuste"><span>Solicitar ajuste</span></label>' +
        '  </div>' +
        '  <div class="rb-ajuste oculto" id="rb-ajuste-' + it.chave + '">' +
        '    <label>Justificativa do ajuste<textarea id="rb-just-' + it.chave + '" rows="2" placeholder="Explique o que precisa ser ajustado"></textarea></label>' +
        '    <p class="rb-sub">Evidências do ajuste <span class="rotulo-apoio">(fotos ou PDF)</span></p>' +
        '    <div id="rb-anexos-ajuste_' + it.chave + '"></div>' +
        '  </div>' +
        '</div>'
      );
    }).join('');

    anexos = {
      combustivel: criarAnexos($('rb-anexos-combustivel')),
      pedagio: criarAnexos($('rb-anexos-pedagio'))
    };
    ITENS.forEach(function (it) {
      anexos['ajuste_' + it.chave] = criarAnexos($('rb-anexos-ajuste_' + it.chave));
      document.querySelectorAll('input[name="rb-dec-' + it.chave + '"]').forEach(function (r) {
        r.addEventListener('change', function () {
          $('rb-ajuste-' + it.chave).classList.toggle('oculto', r.value !== 'ajuste' || !r.checked);
        });
      });
    });
  }

  function pintarValores() {
    var calc = calcular();
    var pronto = !!calc;
    $('rb-total').classList.toggle('oculto', !pronto);
    if (!pronto) return;

    var c = campSel, v = ctx.valores;
    var sub = {
      transporte: (osSel.distanciaKm ? osSel.distanciaKm + ' km ÷ ' + v.consumo_padrao_kml + ' km/L × preço do litro' : 'sem distância cadastrada na OS'),
      aluguel: moedaBR(v.aluguel_veiculo_dia) + '/dia × ' + c.diasViagem + ' dia(s) de viagem',
      hospedagem: moedaBR(v.hospedagem_dia) + '/dia × ' + c.diasServico + ' dia(s) de serviço',
      mao_obra: tecSel.tipo === 'freelancer'
        ? moedaBR(v.diaria_freelancer) + '/dia × ' + (c.diasDeslocamento + c.diasServico) + ' dia(s) (deslocamento + serviço)'
        : (c.diasViagem >= 2
            ? moedaBR(v.diaria_clt) + '/dia × ' + c.diasViagem + ' dia(s) de viagem'
            : 'CLT com 1 dia de viagem não recebe diária'),
      alimentacao: 'Almoço ' + moedaBR(calc.almoco) + ' · Jantar ' + moedaBR(calc.jantar) + ' · Lanche ' + moedaBR(calc.lanche)
    };

    ITENS.forEach(function (it) {
      $('rb-val-' + it.chave).textContent = moedaBR(calc[it.chave]);
      $('rb-sub-' + it.chave).textContent = sub[it.chave] || '';
      // aluguel só aparece para veículo próprio; transporte some sem combustível informado
      var esconder = (it.chave === 'aluguel' && veiculo() !== 'proprio') ||
                     (it.chave === 'transporte' && calc.transporte <= 0);
      $('rb-item-' + it.chave).classList.toggle('oculto', esconder);
    });

    $('rb-total').innerHTML = 'Valor total da solicitação: <strong>' + moedaBR(calc.total) + '</strong>' +
      '<span class="rb-total-sub">inclui pedágio de ' + moedaBR(calc.pedagio) + '</span>';
  }

  function pintarTeto() {
    var preco = parseFloat($('rb-preco-litro').value) || 0;
    var teto = tetoDoCombustivel();
    var estourou = preco > 0 && $('rb-combustivel').value && preco > teto;
    $('rb-teto-alerta').classList.toggle('oculto', !estourou);
    $('rb-teto-just').classList.toggle('oculto', !estourou);
    if (estourou) {
      $('rb-teto-alerta').textContent = '⚠️ O preço informado passa do teto (' + moedaBR(teto) +
        '/L). Explique o motivo e anexe uma evidência (foto da bomba ou nota).';
    }
  }

  function aoMudarVeiculo() {
    var v = veiculo();
    $('rb-transporte-campos').classList.toggle('oculto', !v);
    var info = $('rb-aluguel-info');
    if (v === 'proprio' && campSel && ctx) {
      info.textContent = '🚗 Veículo próprio: o aluguel entra sozinho — ' +
        moedaBR(ctx.valores.aluguel_veiculo_dia) + '/dia × ' + campSel.diasViagem + ' dia(s) de viagem.';
      info.classList.remove('oculto');
    } else {
      info.classList.add('oculto');
    }
    pintarValores();
  }

  function pintarResumoAuto() {
    var alvo = $('rb-auto');
    if (!campSel || !tecSel) { alvo.classList.add('oculto'); return; }
    alvo.innerHTML =
      '<div><span>Categoria de contratação</span><strong>' + (tecSel.tipo === 'freelancer' ? 'Freelancer' : 'CLT') + '</strong></div>' +
      '<div><span>Data de retorno da viagem</span><strong>' + dataBR(campSel.dataRetorno) + '</strong></div>' +
      '<div><span>Dias em viagem</span><strong>' + campSel.diasViagem + '</strong></div>' +
      '<div><span>Dias de serviço</span><strong>' + campSel.diasServico + '</strong></div>' +
      '<div><span>Dias de deslocamento</span><strong>' + campSel.diasDeslocamento + '</strong></div>';
    alvo.classList.remove('oculto');
  }

  function aoEscolherCampanha() {
    campSel = null; tecSel = null;
    var n = parseInt($('rb-campanha').value, 10);
    if (osSel) campSel = (osSel.campanhas || []).filter(function (c) { return c.numero === n; })[0] || null;

    var sel = $('rb-solicitante');
    var nomeSessao = ((EC.storage.ler('sessao:atual') || {}).nome || '').trim().toLowerCase();
    if (campSel && campSel.tecnicos.length === 0) {
      // dias puxados do Resumo entram sem técnicos — precisam ser incluídos na Agenda
      sel.innerHTML = opcao('', 'Nenhum técnico vinculado na Agenda');
      mostrarErro('Esta OS não tem técnicos vinculados nos dias da Agenda. Peça para incluir os técnicos nos dias (na Agenda) e tente de novo.');
    } else if (campSel) {
      mostrarErro(null);
      sel.innerHTML = opcao('', 'Selecione…') + campSel.tecnicos.map(function (t) {
        return opcao(t.nome, t.nome + (t.tipo === 'freelancer' ? ' (Freelancer)' : ' (CLT)'));
      }).join('');
      // pré-seleciona quem está logado, se estiver na lista
      var meu = campSel.tecnicos.filter(function (t) { return t.nome.trim().toLowerCase() === nomeSessao; })[0];
      if (meu) { sel.value = meu.nome; }
    } else {
      sel.innerHTML = opcao('', 'Escolha a OS primeiro');
    }
    aoEscolherSolicitante();
  }

  function aoEscolherSolicitante() {
    tecSel = null;
    if (campSel) {
      var nome = $('rb-solicitante').value;
      tecSel = campSel.tecnicos.filter(function (t) { return t.nome === nome; })[0] || null;
    }
    pintarResumoAuto();
    aoMudarVeiculo(); // re-renderiza aluguel + valores
  }

  function aoEscolherOs() {
    osSel = null; campSel = null; tecSel = null;
    var id = $('rb-os').value;
    osSel = (ctx && ctx.os || []).filter(function (o) { return o.osId === id; })[0] || null;

    $('rb-cliente').value = osSel ? osSel.cliente : '';
    $('rb-distancia').value = osSel && osSel.distanciaKm ? String(osSel.distanciaKm) + ' km' : 'não cadastrada';

    var bloco = $('rb-campanha-bloco');
    var sel = $('rb-campanha');
    if (osSel && osSel.campanhas.length > 1) {
      sel.innerHTML = osSel.campanhas.map(function (c) {
        return opcao(c.numero, 'Campanha ' + c.numero + ' — retorno ' + dataBR(c.dataRetorno));
      }).join('');
      bloco.classList.remove('oculto');
    } else {
      sel.innerHTML = osSel && osSel.campanhas.length ? opcao(osSel.campanhas[0].numero, '1') : '';
      bloco.classList.add('oculto');
    }
    aoEscolherCampanha();
  }

  /* ============ Nova solicitação ============ */

  async function abrirNovo() {
    EC.app.mostrarTela('tela-reembolso-novo');
    $('rb-erro').classList.add('oculto');

    var temCtx = await atualizarContexto();
    $('rb-offline').classList.toggle('oculto', temCtx);
    $('rb-form').classList.toggle('oculto', !temCtx);
    if (!temCtx) return;

    // zera o formulário
    osSel = null; campSel = null; tecSel = null;
    $('rb-os').innerHTML = opcao('', ctx.os.length ? 'Selecione…' : 'Nenhuma OS com programação concluída') +
      ctx.os.map(function (o) { return opcao(o.osId, 'OS ' + o.numero + ' — ' + o.cliente); }).join('');
    $('rb-cliente').value = '';
    $('rb-distancia').value = '';
    $('rb-campanha-bloco').classList.add('oculto');
    $('rb-solicitante').innerHTML = opcao('', 'Escolha a OS primeiro');
    document.querySelectorAll('input[name="rb-veiculo"]').forEach(function (r) { r.checked = false; });
    $('rb-transporte-campos').classList.add('oculto');
    $('rb-combustivel').value = '';
    $('rb-preco-litro').value = '';
    $('rb-comb-justificativa').value = '';
    $('rb-teto-alerta').classList.add('oculto');
    $('rb-teto-just').classList.add('oculto');
    $('rb-pedagio').value = '';
    montarValores();       // recria itens + anexos zerados
    pintarResumoAuto();
    pintarValores();
  }

  function mostrarErro(msg) {
    var erro = $('rb-erro');
    if (!msg) { erro.classList.add('oculto'); return; }
    erro.textContent = '🛑 ' + msg;
    erro.classList.remove('oculto');
    erro.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ============ Envio (2 etapas: dados → anexos) ============ */

  async function enviarPedido(pedido) {
    var resp = await postJson(BASE + '/enviar', {
      codigo: pedido.codigo, osId: pedido.osId, campanha: pedido.campanha,
      solicitante: pedido.solicitante, veiculo: pedido.veiculo,
      tipoCombustivel: pedido.tipoCombustivel, precoLitro: pedido.precoLitro,
      combustivelJustificativa: pedido.combustivelJustificativa,
      valorPedagio: pedido.valorPedagio, ajustes: pedido.ajustes
    });
    var lista = pedido.anexos || [];
    for (var i = 0; i < lista.length; i++) {
      var a = lista[i];
      await postJson(BASE + '/anexo', {
        solicitacao_id: resp.solicitacao_id, bloco: a.bloco,
        nomeArquivo: a.nomeArquivo, base64: a.base64, mime: a.mime
      });
    }
    return resp;
  }

  async function enviarFormulario() {
    if (!osSel) return mostrarErro('Escolha a Ordem de Serviço.');
    if (!campSel) return mostrarErro('Escolha a campanha.');
    if (!tecSel) return mostrarErro('Escolha o solicitante (técnico vinculado à OS na Agenda).');
    if (!veiculo()) return mostrarErro('Responda: o veículo é da ENGEAR ou do colaborador?');

    var preco = parseFloat($('rb-preco-litro').value) || 0;
    var tipoComb = $('rb-combustivel').value;
    if (preco > 0 && !tipoComb) return mostrarErro('Escolha o tipo de combustível (gasolina ou diesel).');
    if (tipoComb && !(preco > 0)) return mostrarErro('Informe o preço por litro do combustível.');
    if (preco > tetoDoCombustivel() && tipoComb) {
      if (!$('rb-comb-justificativa').value.trim()) {
        return mostrarErro('O preço por litro passou do teto — a justificativa é obrigatória.');
      }
      if (anexos.combustivel.obter().length === 0) {
        return mostrarErro('O preço por litro passou do teto — anexe uma evidência (foto da bomba ou nota).');
      }
    }

    // decisões dos valores automáticos
    var calc = calcular();
    var ajustes = [];
    for (var i = 0; i < ITENS.length; i++) {
      var it = ITENS[i];
      if ($('rb-item-' + it.chave).classList.contains('oculto')) continue;
      var dec = document.querySelector('input[name="rb-dec-' + it.chave + '"]:checked');
      if (dec && dec.value === 'ajuste') {
        var just = $('rb-just-' + it.chave).value.trim();
        if (!just) return mostrarErro('Você pediu ajuste em "' + it.rotulo.replace(/^\S+\s/, '') + '" — escreva a justificativa.');
        ajustes.push({ item: it.chave, justificativa: just });
      }
    }
    mostrarErro(null);

    // junta os anexos de todos os blocos
    var todosAnexos = [];
    Object.keys(anexos).forEach(function (bloco) {
      anexos[bloco].obter().forEach(function (a) {
        todosAnexos.push({ bloco: bloco, nomeArquivo: a.nomeArquivo, base64: a.base64, mime: a.mime });
      });
    });

    var pedido = {
      codigo: 'LG_' + osSel.numero + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      osId: osSel.osId,
      os: osSel.numero,
      campanha: campSel.numero,
      solicitante: tecSel.nome,
      veiculo: veiculo(),
      tipoCombustivel: tipoComb || null,
      precoLitro: preco > 0 ? preco : null,
      combustivelJustificativa: $('rb-comb-justificativa').value.trim(),
      valorPedagio: parseFloat($('rb-pedagio').value) || 0,
      ajustes: ajustes,
      anexos: todosAnexos,
      // só para exibir na fila offline:
      valorTotal: calc ? calc.total : 0,
      dataRetorno: campSel.dataRetorno,
      cliente: osSel.cliente,
      criadoEm: new Date().toISOString()
    };

    var botao = $('rb-enviar');
    botao.disabled = true;
    botao.textContent = '⏳ Enviando…';
    try {
      await enviarPedido(pedido);
      toast('✅ Solicitação enviada! Agora é aguardar a análise da Logística.');
      atualizarListaDoServidor();
    } catch (e) {
      if (e.rejeitado) {
        // o servidor recusou de verdade (dados inválidos) — não adianta guardar
        botao.disabled = false;
        botao.textContent = 'Enviar solicitação ✓';
        return mostrarErro(e.message);
      }
      try { await EC.db.set(LOJA_PENDENTES, pedido.codigo, pedido); } catch (e2) { /* ok */ }
      toast('📴 Sem conexão. Solicitação guardada — será enviada quando a internet voltar.');
    }
    botao.disabled = false;
    botao.textContent = 'Enviar solicitação ✓';
    EC.app.mostrarTela('tela-reembolso');
    pintarLista();
  }

  /* ============ Fila offline ============ */

  async function pedidosPendentes() {
    try { return (await EC.db.getAll(LOJA_PENDENTES)) || []; } catch (e) { return []; }
  }

  async function enviarPendentes(silencioso) {
    var chaves = [];
    try { chaves = await EC.db.keys(LOJA_PENDENTES); } catch (e) { /* ok */ }
    if (!chaves.length) return;
    var ok = 0;
    for (var i = 0; i < chaves.length; i++) {
      var pedido = null;
      try { pedido = await EC.db.get(LOJA_PENDENTES, chaves[i]); } catch (e) { pedido = null; }
      if (!pedido || !pedido.codigo || !pedido.osId) {
        try { await EC.db.remove(LOJA_PENDENTES, chaves[i]); } catch (e) { /* ok */ }
        continue;
      }
      try {
        await enviarPedido(pedido);
        try { await EC.db.remove(LOJA_PENDENTES, chaves[i]); } catch (e) { /* ok */ }
        ok++;
      } catch (e) {
        if (e.rejeitado) {
          // inválido no servidor: tira da fila e avisa (não fica preso para sempre)
          try { await EC.db.remove(LOJA_PENDENTES, chaves[i]); } catch (e2) { /* ok */ }
          toast('⚠️ Uma solicitação guardada foi recusada pelo servidor: ' + e.message);
        }
      }
    }
    if (ok) {
      toast('✅ ' + ok + ' solicitação(ões) de reembolso enviada(s) ao servidor.');
      atualizarListaDoServidor();
      pintarLista();
    } else if (!silencioso) {
      toast('📴 Ainda sem conexão — a solicitação segue guardada no aparelho.');
    }
  }

  /* ============ Minhas solicitações ============ */

  var STATUS = {
    elaboracao:            { txt: '📝 Em elaboração',                       cls: 'rb-aguardando' },
    aguardando_logistica:  { txt: '⏳ Aguardando aprovação da Logística',    cls: 'rb-pendente' },
    correcao:              { txt: '✏️ Correção solicitada',                 cls: 'rb-pendente' },
    rejeitado:             { txt: '❌ Rejeitado',                           cls: 'rb-recusado' },
    aguardando_pagamento:  { txt: '✅ Aguardando pagamento',                cls: 'rb-aprovado' },
    pago:                  { txt: '💰 Pago',                                cls: 'rb-pago' }
  };

  function cartaoPedido(p, aguardandoEnvio) {
    var st = aguardandoEnvio
      ? { txt: '📴 Aguardando envio', cls: 'rb-aguardando' }
      : (STATUS[p.status] || { txt: p.status, cls: 'rb-aguardando' });
    var retorno = dataBR(p.data_retorno || p.dataRetorno);
    var obs = (p.status === 'rejeitado' || p.status === 'correcao') && p.observacao_logistica
      ? '<div class="rb-motivo">Observação da Logística: ' + p.observacao_logistica + '</div>' : '';
    var pagoInfo = p.status === 'pago' && p.pago_em
      ? '<div class="os-resumo">Pago em ' + dataBR(p.pago_em) + (p.forma_pagamento ? ' · ' + p.forma_pagamento : '') + '</div>' : '';
    return (
      '<div class="rb-pedido">' +
      '  <div class="rb-pedido-topo"><span class="os-numero">OS ' + (p.os || '?') + '</span>' +
      '    <span class="rb-status ' + st.cls + '">' + st.txt + '</span></div>' +
      '  <div class="rb-pedido-linha"><strong>' + moedaBR(p.valor_total != null ? p.valor_total : p.valorTotal) + '</strong>' +
      (retorno ? ' · retorno ' + retorno : '') + '</div>' +
      (p.cliente ? '<div class="os-resumo">' + p.cliente + '</div>' : '') +
      obs + pagoInfo +
      '</div>'
    );
  }

  function listaEmCache() {
    var nome = ((EC.storage.ler('sessao:atual') || {}).nome || '').trim();
    var cache = EC.storage.ler(CH_LISTA);
    if (cache && cache.solicitante === nome && Array.isArray(cache.pedidos)) return cache.pedidos;
    return [];
  }

  async function pintarLista() {
    var area = $('rb-lista');
    if (!area) return;
    var fila = await pedidosPendentes();
    var enviados = listaEmCache();
    var codigosFila = fila.map(function (p) { return p.codigo; });
    enviados = enviados.filter(function (p) { return codigosFila.indexOf(p.codigo) === -1; });

    if (!fila.length && !enviados.length) {
      area.innerHTML = '<p class="texto-apoio">Nenhuma solicitação ainda. Toque em "Nova solicitação" para começar.</p>';
      return;
    }
    area.innerHTML =
      fila.map(function (p) { return cartaoPedido(p, true); }).join('') +
      enviados.map(function (p) { return cartaoPedido(p, false); }).join('');
  }

  async function atualizarListaDoServidor() {
    var nome = ((EC.storage.ler('sessao:atual') || {}).nome || '').trim();
    if (!nome) return;
    try {
      var corpo = await getJson(BASE + '/lista?solicitante=' + encodeURIComponent(nome));
      EC.storage.salvar(CH_LISTA, { solicitante: nome, pedidos: corpo.pedidos || [] });
      pintarLista();
    } catch (e) { /* offline/erro: fica com o cache */ }
  }

  /* ============ Inicialização / navegação ============ */

  function iniciar() {
    if (iniciado) return;
    iniciado = true;

    $('rb-novo').addEventListener('click', abrirNovo);
    $('rb-voltar').addEventListener('click', function () { EC.app.mostrarTela('tela-acao'); });
    $('rb-cancelar').addEventListener('click', function () { EC.app.mostrarTela('tela-reembolso'); pintarLista(); });
    $('rb-enviar').addEventListener('click', enviarFormulario);

    $('rb-os').addEventListener('change', aoEscolherOs);
    $('rb-campanha').addEventListener('change', aoEscolherCampanha);
    $('rb-solicitante').addEventListener('change', aoEscolherSolicitante);
    document.querySelectorAll('input[name="rb-veiculo"]').forEach(function (r) {
      r.addEventListener('change', aoMudarVeiculo);
    });
    $('rb-combustivel').addEventListener('change', function () { pintarTeto(); pintarValores(); });
    $('rb-preco-litro').addEventListener('input', function () { pintarTeto(); pintarValores(); });
    $('rb-pedagio').addEventListener('input', pintarValores);
  }

  function abrir() {
    iniciar();
    EC.app.mostrarTela('tela-reembolso');
    pintarLista();
    enviarPendentes(true);
    atualizarListaDoServidor();
    atualizarContexto(); // deixa o contexto fresquinho para a "Nova solicitação"
  }

  window.addEventListener('online', function () { enviarPendentes(true); });

  return { abrir: abrir };
})();
