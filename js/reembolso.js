/**
 * reembolso.js — Solicitação de Reembolso de viagem (módulo Logística)
 *
 * Fluxo: busca a OS (todas as OS aparecem), campanha e datas vêm da Agenda
 * quando existem (senão o técnico informa as 4 datas: ida, início/término do
 * serviço e chegada — os dias saem sozinhos das datas). O solicitante é o
 * usuário logado; quem tem papel Logística/admin no SGP pode preencher em nome
 * de outro técnico. O app calcula os valores com as diárias vigentes do SGP:
 *   • hospedagem  = R$/diária × nº de diárias (chegada − saída);
 *   • alimentação = almoço/jantar × dias de serviço + lanche × deslocamento;
 *   • mão de obra = freelancer (desloc+serviço) ou CLT (viagem ≥ 2 dias);
 *   • combustível/aluguel/pedágio no bloco Transporte.
 * Em cada valor: "Concordo" ou "Solicitar ajuste" (justificativa + NOVO VALOR,
 * que substitui o calculado no total). O total é o VALOR TOTAL DA LOGÍSTICA e
 * o técnico informa o PERCENTUAL que está solicitando (padrão 100%).
 *
 * O servidor recalcula tudo no envio (o app nunca manda valor pronto).
 * Rascunho: o preenchimento é salvo sozinho no aparelho (IndexedDB) — dá para
 * sair e continuar depois. Envio offline: fica na fila e sobe sozinho.
 *
 * Interface (EC.reembolso): abrir() — chamada pelo botão da tela inicial.
 */
window.EC = window.EC || {};

EC.reembolso = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/logistica';
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';

  var CH_CONTEXTO = 'logistica:contexto';   // cache do contexto (OS + valores)
  var CH_LISTA = 'logistica:lista';         // cache das minhas solicitações
  var LOJA_PENDENTES = 'pendingReembolso';  // fila offline (IndexedDB)
  var LOJA_RASCUNHO = 'rascunhos';          // rascunho do formulário (IndexedDB)
  var MAX_ANEXOS = 20;                      // por bloco
  var LADO_MAXIMO = 1600;                   // resolução máxima das fotos
  var PDF_MAX_MB = 3.5;                     // limite por PDF (corpo da Vercel)

  var ITENS = [
    { chave: 'transporte',  rotulo: '⛽ Transporte (combustível)' },
    { chave: 'aluguel',     rotulo: '🚗 Aluguel de veículo' },
    { chave: 'hospedagem',  rotulo: '🏨 Hospedagem' },
    { chave: 'mao_obra',    rotulo: '👷 Mão de obra' },
    { chave: 'alimentacao', rotulo: '🍽️ Alimentação' }
  ];

  var ctx = null;          // contexto do servidor: { valores, os: [...] }
  var osSel = null, campSel = null, tecSel = null;
  var anexos = {};
  var iniciado = false;
  var restaurando = false; // evita salvar rascunho no meio da restauração

  function $(id) { return document.getElementById(id); }
  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }
  function sessao() { return EC.storage.ler('sessao:atual') || {}; }
  function sessionNome() { return (sessao().nome || '').trim(); }

  function moedaBR(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function dataBR(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }
  function opcao(valor, texto) { return '<option value="' + valor + '">' + texto + '</option>'; }

  // Dias da viagem lidos dos campos (preenchidos pela Agenda ou pelas datas)
  function diasServicoVal() { return Math.max(0, parseInt($('rb-dias-servico').value, 10) || 0); }
  function diasDeslocVal() { return Math.max(0, parseInt($('rb-dias-desloc').value, 10) || 0); }
  function diasViagemVal() { return diasServicoVal() + diasDeslocVal(); }

  // Nº de diárias de hospedagem = noites fora = data da chegada − data da saída
  function diariasVal() {
    var d = diffDias($('rb-ida').value, $('rb-volta').value);
    return d == null ? 0 : Math.max(0, d);
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

  /* ============ Componente de anexos (câmera + galeria + PDF) ============ */

  // Foto ampliada para conferência (toque em qualquer lugar fecha)
  function abrirLightbox(base64) {
    var ov = document.createElement('div');
    ov.className = 'foto-lightbox';
    ov.innerHTML = '<img src="data:image/jpeg;base64,' + base64 + '" alt="Evidência ampliada">' +
      '<button type="button" class="foto-lightbox-fechar" aria-label="Fechar">✕</button>';
    ov.addEventListener('click', function () { ov.remove(); });
    document.body.appendChild(ov);
  }

  function criarAnexos(container, opcoes) {
    opcoes = opcoes || {};
    var arquivos = Array.isArray(opcoes.iniciais) ? opcoes.iniciais.slice() : [];
    container.innerHTML =
      '<div class="anx">' +
      '  <div class="anx-lista"></div>' +
      '  <div class="anx-botoes">' +
      '    <button type="button" class="botao botao-secundario anx-foto">📷 Tirar foto</button>' +
      '    <button type="button" class="botao botao-secundario anx-galeria">🖼️ Da galeria</button>' +
      '    <button type="button" class="botao botao-secundario anx-pdf">📎 PDF</button>' +
      '  </div>' +
      '  <input type="file" accept="image/*" capture="environment" class="anx-entrada-foto" hidden>' +
      '  <input type="file" accept="image/*" multiple class="anx-entrada-galeria" hidden>' +
      '  <input type="file" accept="application/pdf" class="anx-entrada-pdf" hidden>' +
      '  <div class="anx-status"></div>' +
      '</div>';

    var lista = container.querySelector('.anx-lista');
    var status = container.querySelector('.anx-status');
    var btnFoto = container.querySelector('.anx-foto');
    var btnGaleria = container.querySelector('.anx-galeria');
    var btnPdf = container.querySelector('.anx-pdf');
    var inFoto = container.querySelector('.anx-entrada-foto');
    var inGaleria = container.querySelector('.anx-entrada-galeria');
    var inPdf = container.querySelector('.anx-entrada-pdf');

    function notificar() { if (typeof opcoes.aoMudar === 'function') opcoes.aoMudar(); }

    function render() {
      lista.innerHTML = arquivos.map(function (a, i) {
        var visual = a.mime === 'application/pdf'
          ? '<span class="anx-pdf-icone">📄</span>'
          : '<img src="data:image/jpeg;base64,' + a.base64 + '" alt="anexo" data-ver="' + i + '" title="Toque para ampliar">';
        return '<div class="anx-item">' + visual +
          '<span class="anx-nome">' + a.nomeArquivo + '</span>' +
          '<button type="button" class="anx-remover" data-i="' + i + '" title="Remover">✕</button></div>';
      }).join('');
      lista.querySelectorAll('.anx-remover').forEach(function (b) {
        b.addEventListener('click', function () { arquivos.splice(parseInt(b.dataset.i, 10), 1); render(); notificar(); });
      });
      // toque na miniatura abre a foto ampliada para conferência
      lista.querySelectorAll('img[data-ver]').forEach(function (img) {
        img.addEventListener('click', function () { abrirLightbox(arquivos[parseInt(img.dataset.ver, 10)].base64); });
      });
      var cheio = arquivos.length >= MAX_ANEXOS;
      btnFoto.disabled = cheio; btnGaleria.disabled = cheio; btnPdf.disabled = cheio;
    }

    function carimbo() {
      var d = new Date();
      function dois(n) { return n < 10 ? '0' + n : '' + n; }
      return '' + d.getFullYear() + dois(d.getMonth() + 1) + dois(d.getDate()) +
        '_' + dois(d.getHours()) + dois(d.getMinutes()) + dois(d.getSeconds());
    }

    // Reduz a imagem e guarda como JPEG base64. Chama pronto() ao terminar.
    function processarImagem(arq, pronto) {
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
          pronto(true);
        };
        img.onerror = function () { pronto(false); };
        img.src = leitor.result;
      };
      leitor.onerror = function () { pronto(false); };
      leitor.readAsDataURL(arq);
    }

    btnFoto.addEventListener('click', function () { inFoto.click(); });
    btnGaleria.addEventListener('click', function () { inGaleria.click(); });
    btnPdf.addEventListener('click', function () { inPdf.click(); });

    inFoto.addEventListener('change', function () {
      var arq = inFoto.files && inFoto.files[0];
      if (!arq) return;
      status.textContent = '⏳ Processando a foto…';
      processarImagem(arq, function (ok) {
        render();
        status.textContent = ok ? '✅ Foto adicionada (' + arquivos.length + '/' + MAX_ANEXOS + ').' : '⚠️ Não foi possível ler a imagem.';
        inFoto.value = '';
        if (ok) notificar();
      });
    });

    // Galeria: fotos já salvas no celular (permite escolher várias)
    inGaleria.addEventListener('change', function () {
      var fila = Array.prototype.slice.call(inGaleria.files || []);
      fila = fila.slice(0, MAX_ANEXOS - arquivos.length);
      if (!fila.length) return;
      status.textContent = '⏳ Adicionando ' + fila.length + ' foto(s) da galeria…';
      var restantes = fila.length, falhas = 0;
      fila.forEach(function (arq) {
        processarImagem(arq, function (ok) {
          if (!ok) falhas++;
          restantes--;
          if (restantes === 0) {
            render();
            status.textContent = (falhas ? '⚠️ ' + falhas + ' foto(s) não puderam ser lidas. ' : '') +
              '✅ Anexos: ' + arquivos.length + '/' + MAX_ANEXOS + '.';
            inGaleria.value = '';
            notificar();
          }
        });
      });
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
        notificar();
      };
      leitor.readAsDataURL(arq);
    });

    render();
    return { obter: function () { return arquivos.slice(); } };
  }

  /* ============ Dados do solicitante / distância ============ */

  function distanciaDaOs() { return osSel && osSel.distanciaKm ? Number(osSel.distanciaKm) : 0; }

  function distanciaAtual() {
    if (distanciaDaOs() > 0) return distanciaDaOs();
    var v = parseFloat(String($('rb-distancia').value).replace(/[^\d.,]/g, '').replace(',', '.'));
    return v > 0 ? v : 0;
  }

  var UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
    'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  function fillUFselect(id) { $(id).innerHTML = opcao('', 'UF') + UFS.map(function (u) { return opcao(u, u); }).join(''); }
  function setUF(id, uf) { $(id).value = String(uf || '').toUpperCase(); }

  function pintarDistancia() {
    var inp = $('rb-distancia'), hint = $('rb-distancia-hint'), cidades = $('rb-dist-cidades');
    if (distanciaDaOs() > 0) {
      cidades.classList.add('oculto');
      inp.value = String(osSel.distanciaKm) + ' km';
      inp.readOnly = true;
      hint.textContent = '(vem da OS)';
      $('rb-dist-status').textContent = '';
      return;
    }
    // sem distância na OS: pede origem/destino e calcula (ida e volta).
    // Origem: a última usada; na 1ª vez, a base da ENGEAR (Mateus Leme/MG).
    cidades.classList.remove('oculto');
    var ori = EC.storage.ler('logistica:origem') || { cidade: 'Mateus Leme', uf: 'MG' };
    $('rb-origem-cidade').value = ori.cidade || '';
    setUF('rb-origem-uf', ori.uf || '');
    $('rb-destino-cidade').value = (osSel && osSel.municipio) || '';
    setUF('rb-destino-uf', (osSel && osSel.uf) || '');
    inp.value = '';
    inp.readOnly = true;   // vem do cálculo; vira editável se offline/erro
    hint.textContent = '(calculada pelo trajeto)';
    calcularDistancia();
  }

  var distTimer = null;
  function agendarCalculo() { clearTimeout(distTimer); distTimer = setTimeout(calcularDistancia, 800); }

  async function calcularDistancia() {
    clearTimeout(distTimer); // cancela um debounce pendente (evita chamada dupla)
    if (!osSel || distanciaDaOs() > 0) return;
    var oc = $('rb-origem-cidade').value.trim(), ou = $('rb-origem-uf').value;
    var dc = $('rb-destino-cidade').value.trim(), du = $('rb-destino-uf').value;
    var status = $('rb-dist-status'), inp = $('rb-distancia');
    if (!oc || !ou || !dc || !du) {
      status.textContent = 'Preencha origem e destino (cidade e UF) para calcular a distância.';
      return;
    }
    if (!navigator.onLine) {
      status.textContent = '📴 Sem internet — digite a distância (ida e volta) manualmente.';
      inp.readOnly = false;
      return;
    }
    status.textContent = '🔄 Calculando a distância…';
    inp.readOnly = true;
    try {
      var corpo = await getJson(BASE + '/distancia?origem=' + encodeURIComponent(oc) + '&ufOrigem=' + encodeURIComponent(ou) +
        '&destino=' + encodeURIComponent(dc) + '&ufDestino=' + encodeURIComponent(du));
      inp.value = corpo.totalKm + ' km';
      inp.readOnly = true;
      status.textContent = '✅ ' + corpo.totalKm + ' km no total (ida ' + corpo.idaKm + ' + volta ' + corpo.idaKm + '), calculado pelo mapa.';
      EC.storage.salvar('logistica:origem', { cidade: oc, uf: ou });
      pintarValores();
    } catch (e) {
      status.textContent = '⚠️ ' + e.message + '. Digite a distância (ida e volta) manualmente.';
      inp.value = '';
      inp.readOnly = false;
      pintarValores();
    }
  }

  /* ============ Cálculo (espelho das regras do servidor) ============ */

  function veiculo() {
    var m = document.querySelector('input[name="rb-veiculo"]:checked');
    return m ? m.value : '';
  }

  function calcular() {
    if (!ctx || !osSel || !tecSel) return null;
    var v = ctx.valores;
    var diasServico = diasServicoVal(), diasDeslocamento = diasDeslocVal(), diasViagem = diasViagemVal();
    var diarias = diariasVal();
    var preco = parseFloat($('rb-preco-litro').value) || 0;
    var consumo = consumoAtual();
    var dist = distanciaAtual();
    var r2 = function (x) { return Math.round(x * 100) / 100; };

    var combustivel = (preco > 0 && dist > 0 && consumo > 0) ? r2((dist / consumo) * preco) : 0;
    var aluguel = veiculo() === 'proprio' ? r2(Number(v.aluguel_veiculo_dia) * diasViagem) : 0;
    // Hospedagem: R$/diária × noites fora (chegada − saída). Mesmo dia → 0.
    var hospedagem = r2(Number(v.hospedagem_dia) * diarias);
    var maoObra = tecSel.tipo === 'freelancer'
      ? r2(Number(v.diaria_freelancer) * (diasDeslocamento + diasServico))
      : (diasViagem >= 2 ? r2(Number(v.diaria_clt) * diasViagem) : 0);
    var almoco = r2(Number(v.almoco) * diasServico);
    var jantar = r2(Number(v.jantar) * diasServico);
    var lanche = r2(Number(v.lanche) * diasDeslocamento);
    var pedagio = r2(parseFloat($('rb-pedagio').value) || 0);
    var alimentacao = r2(almoco + jantar + lanche);

    return {
      transporte: combustivel, aluguel: aluguel, pedagio: pedagio, hospedagem: hospedagem,
      mao_obra: maoObra, alimentacao: alimentacao, almoco: almoco, jantar: jantar, lanche: lanche,
      diarias: diarias,
      total: r2(combustivel + aluguel + pedagio + hospedagem + maoObra + alimentacao)
    };
  }

  // Decisão de um item: 'concordo' | 'ajuste'
  function decisao(chave) {
    var m = document.querySelector('input[name="rb-dec-' + chave + '"]:checked');
    return m ? m.value : 'concordo';
  }

  // Novo valor proposto no ajuste (ou null se não é ajuste / vazio)
  function valorProposto(chave) {
    if (decisao(chave) !== 'ajuste') return null;
    var v = parseFloat($('rb-novoval-' + chave).value);
    return v >= 0 && !isNaN(v) ? Math.round(v * 100) / 100 : null;
  }

  // Total da logística: calculado, substituindo pelos novos valores propostos
  function totalComAjustes(calc) {
    var total = calc.total;
    ITENS.forEach(function (it) {
      if ($('rb-item-' + it.chave).classList.contains('oculto')) return;
      var novo = valorProposto(it.chave);
      if (novo != null) total += novo - calc[it.chave];
    });
    return Math.round(total * 100) / 100;
  }

  function percentualVal() {
    var p = parseFloat($('rb-percentual').value);
    if (!(p > 0)) return 100;
    return Math.min(100, p);
  }

  function tetoDoCombustivel() {
    if (!ctx) return 0;
    return $('rb-combustivel').value === 'diesel'
      ? Number(ctx.valores.teto_diesel) : Number(ctx.valores.teto_gasolina);
  }

  // Consumo (km/L) do combustível ESCOLHIDO: gasolina 12 / diesel 10 (da tela
  // de valores do SGP). Contexto antigo em cache (consumo único) ainda funciona.
  function consumoAtual() {
    if (!ctx) return 0;
    var v = ctx.valores;
    var porTipo = $('rb-combustivel').value === 'diesel' ? v.consumo_diesel_kml : v.consumo_gasolina_kml;
    return Number(porTipo || v.consumo_padrao_kml) || 0;
  }

  /* ============ Contexto ============ */

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

  /* ============ Busca / escolha da OS ============ */

  function cartaoOsBusca(o) {
    return (
      '<button type="button" class="os-item" data-id="' + o.osId + '">' +
      '  <span class="os-numero">OS ' + o.numero + '</span>' +
      '  <span class="os-cliente">' + o.cliente + '</span>' +
      '</button>'
    );
  }

  function pintarResultadosOs(termo) {
    var alvo = $('rb-os-resultados');
    var lista = (ctx && ctx.os) || [];
    var t = (termo || '').toLowerCase().trim();
    var achadas = t
      ? lista.filter(function (o) { return (o.numero + ' ' + o.cliente).toLowerCase().indexOf(t) !== -1; })
      : lista;
    achadas = achadas.slice(0, 12);
    alvo.innerHTML = achadas.length
      ? achadas.map(cartaoOsBusca).join('')
      : '<p class="texto-apoio">Nenhuma OS encontrada.</p>';
    alvo.querySelectorAll('.os-item[data-id]').forEach(function (item) {
      item.addEventListener('click', function () {
        var o = lista.filter(function (x) { return x.osId === item.dataset.id; })[0];
        if (o) { escolherOs(o); salvarRascunhoLogo(); }
      });
    });
  }

  function escolherOs(o) {
    osSel = o; campSel = null; tecSel = null;
    $('rb-os-picker').classList.add('oculto');
    var chip = $('rb-os-escolhida');
    chip.innerHTML =
      '<div class="rb-os-chip">' +
      '  <div><span class="os-numero">OS ' + o.numero + '</span><br>' +
      '  <span class="os-cliente">' + o.cliente + '</span></div>' +
      '  <button type="button" class="botao botao-mini" id="rb-os-trocar">Trocar</button>' +
      '</div>';
    chip.classList.remove('oculto');
    $('rb-os-trocar').addEventListener('click', function () {
      chip.classList.add('oculto'); chip.innerHTML = '';
      $('rb-os-picker').classList.remove('oculto');
      $('rb-os-busca').value = ''; pintarResultadosOs(''); $('rb-os-busca').focus();
    });

    $('rb-cliente').value = o.cliente || '';
    pintarDistancia();

    var bloco = $('rb-campanha-bloco'), sel = $('rb-campanha');
    if (o.campanhas.length > 1) {
      sel.innerHTML = o.campanhas.map(function (c) {
        return opcao(c.numero, 'Campanha ' + c.numero + ' — ' + dataBR(c.dataInicio) + ' a ' + dataBR(c.dataRetorno));
      }).join('');
      bloco.classList.remove('oculto');
    } else {
      sel.innerHTML = o.campanhas.length ? opcao(o.campanhas[0].numero, '1') : '';
      bloco.classList.add('oculto');
    }
    aoEscolherCampanha();
  }

  function aoEscolherCampanha() {
    campSel = null;
    var n = parseInt($('rb-campanha').value, 10);
    if (osSel) campSel = (osSel.campanhas || []).filter(function (c) { return c.numero === n; })[0] || null;

    // solicitante é SEMPRE o usuário logado (só informativo, não muda)
    $('rb-solicitante').value = sessionNome();

    // Designado: técnico da viagem, escolhido entre os vinculados na Agenda
    var semAgenda = $('rb-sem-agenda'), blocoDesig = $('rb-designado-bloco'), sel = $('rb-designado');
    if (!osSel) {
      semAgenda.classList.add('oculto');
      blocoDesig.classList.add('oculto');
    } else if (!campSel) {
      // OS sem NENHUM serviço na Agenda → orienta a incluir primeiro
      semAgenda.textContent = '📅 Esta OS ainda não tem o serviço na Agenda. Peça para incluir a programação (dias e técnicos) na Agenda primeiro — depois é só voltar aqui.';
      semAgenda.classList.remove('oculto');
      blocoDesig.classList.add('oculto');
      $('rb-viagem').classList.add('oculto');
    } else if (campSel.tecnicos.length === 0) {
      // tem dias na Agenda, mas sem técnicos → também precisa completar lá
      semAgenda.textContent = '👷 Esta OS está na Agenda, mas sem técnicos vinculados nos dias. Peça para incluir os técnicos na Agenda primeiro — depois é só voltar aqui.';
      semAgenda.classList.remove('oculto');
      blocoDesig.classList.add('oculto');
    } else {
      semAgenda.classList.add('oculto');
      var nomeSessao = sessionNome().toLowerCase();
      sel.innerHTML = opcao('', 'Selecione…') + campSel.tecnicos.map(function (t) {
        return opcao(t.nome, t.nome + (t.tipo === 'freelancer' ? ' (Freelancer)' : ' (CLT)'));
      }).join('');
      // pré-seleciona o usuário logado, se ele estiver entre os técnicos da OS
      var meu = campSel.tecnicos.filter(function (t) { return t.nome.trim().toLowerCase() === nomeSessao; })[0];
      if (meu) sel.value = meu.nome;
      blocoDesig.classList.remove('oculto');
    }

    atualizarTecSel();
    if (campSel) fillViagem(campSel);
    pintarResumoAuto();
    aoMudarVeiculo();
  }

  // tecSel = DESIGNADO escolhido (a categoria dele entra no cálculo)
  function atualizarTecSel() {
    tecSel = null;
    if (!campSel) return;
    var nome = $('rb-designado').value;
    var t = campSel.tecnicos.filter(function (x) { return x.nome === nome; })[0];
    if (t) tecSel = { nome: t.nome, tipo: t.tipo };
  }

  /* ============ Dados da viagem (sempre da Agenda) ============ */

  function fillViagem(campanha) {
    $('rb-ida').value = (campanha.dataInicio || '').slice(0, 10);
    $('rb-volta').value = (campanha.dataRetorno || '').slice(0, 10);
    $('rb-servico-inicio').value = (campanha.servicoInicio || '').slice(0, 10);
    $('rb-servico-fim').value = (campanha.servicoFim || '').slice(0, 10);
    $('rb-dias-servico').value = campanha.diasServico;
    $('rb-dias-desloc').value = campanha.diasDeslocamento;
    $('rb-viagem-fonte').textContent = '📅 Datas e dias preenchidos pela Agenda.';
    ['rb-ida', 'rb-servico-inicio', 'rb-servico-fim', 'rb-volta', 'rb-dias-servico', 'rb-dias-desloc']
      .forEach(function (id) { $(id).readOnly = true; });
    $('rb-viagem').classList.remove('oculto');
  }

  // Dias inteiros entre duas datas ISO (b − a); null se faltar/for inválida.
  function diffDias(a, b) {
    if (!a || !b) return null;
    var d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
    return Math.round((d2 - d1) / 86400000);
  }

  function pintarResumoAuto() {
    var alvo = $('rb-auto');
    if (!osSel || !tecSel) { alvo.classList.add('oculto'); return; }
    var tipo = tecSel.tipo === 'freelancer' ? 'Freelancer' : 'CLT';
    alvo.innerHTML =
      '<div><span>Dias em viagem (total)</span><strong>' + diasViagemVal() + '</strong></div>' +
      '<div><span>Categoria do designado</span><strong>' + tipo + '</strong></div>';
    alvo.classList.remove('oculto');
  }

  /* ============ Valores calculados ============ */

  function montarValores(anexosIniciais) {
    anexosIniciais = anexosIniciais || {};
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
        '    <label>Novo valor proposto (R$)<input type="number" id="rb-novoval-' + it.chave + '" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></label>' +
        '    <label>Justificativa do ajuste<textarea id="rb-just-' + it.chave + '" rows="2" placeholder="Explique o que precisa ser ajustado"></textarea></label>' +
        '    <p class="rb-sub">Evidências do ajuste <span class="rotulo-apoio">(fotos ou PDF)</span></p>' +
        '    <div id="rb-anexos-ajuste_' + it.chave + '"></div>' +
        '  </div>' +
        '</div>'
      );
    }).join('');

    anexos = {
      combustivel: criarAnexos($('rb-anexos-combustivel'), { iniciais: anexosIniciais.combustivel, aoMudar: salvarRascunhoLogo }),
      pedagio: criarAnexos($('rb-anexos-pedagio'), { iniciais: anexosIniciais.pedagio, aoMudar: salvarRascunhoLogo })
    };
    ITENS.forEach(function (it) {
      anexos['ajuste_' + it.chave] = criarAnexos($('rb-anexos-ajuste_' + it.chave),
        { iniciais: anexosIniciais['ajuste_' + it.chave], aoMudar: salvarRascunhoLogo });
      document.querySelectorAll('input[name="rb-dec-' + it.chave + '"]').forEach(function (r) {
        r.addEventListener('change', function () {
          $('rb-ajuste-' + it.chave).classList.toggle('oculto', r.value !== 'ajuste' || !r.checked);
          pintarValores();
        });
      });
      $('rb-novoval-' + it.chave).addEventListener('input', pintarValores);
    });
  }

  function pintarValores() {
    var calc = calcular();
    var pronto = !!calc;
    $('rb-total').classList.toggle('oculto', !pronto);
    $('rb-pct-bloco').classList.toggle('oculto', !pronto);
    if (!pronto) return;

    var v = ctx.valores;
    var dServico = diasServicoVal(), dDesloc = diasDeslocVal(), dViagem = diasViagemVal();
    var sub = {
      transporte: (distanciaAtual() > 0
        ? distanciaAtual() + ' km ÷ ' + consumoAtual() + ' km/L (' +
          ($('rb-combustivel').value === 'diesel' ? 'diesel' : 'gasolina') + ') × preço do litro'
        : 'informe a distância e o preço do litro'),
      aluguel: moedaBR(v.aluguel_veiculo_dia) + '/dia × ' + dViagem + ' dia(s) de viagem',
      hospedagem: moedaBR(v.hospedagem_dia) + '/diária × ' + calc.diarias + ' diária(s) — da saída à chegada' +
        (calc.diarias === 0 ? ' (foi e voltou no mesmo dia: sem hospedagem)' : ''),
      mao_obra: tecSel.tipo === 'freelancer'
        ? moedaBR(v.diaria_freelancer) + '/dia × ' + (dDesloc + dServico) + ' dia(s) (deslocamento + serviço)'
        : (dViagem >= 2
            ? moedaBR(v.diaria_clt) + '/dia × ' + dViagem + ' dia(s) de viagem'
            : 'CLT com 1 dia de viagem não recebe diária'),
      alimentacao:
        'Almoço: ' + moedaBR(v.almoco) + '/dia × ' + dServico + ' dia(s) de serviço = ' + moedaBR(calc.almoco) + '<br>' +
        'Jantar: ' + moedaBR(v.jantar) + '/dia × ' + dServico + ' dia(s) de serviço = ' + moedaBR(calc.jantar) + '<br>' +
        'Lanche: ' + moedaBR(v.lanche) + '/dia × ' + dDesloc + ' dia(s) de deslocamento = ' + moedaBR(calc.lanche)
    };

    ITENS.forEach(function (it) {
      $('rb-val-' + it.chave).textContent = moedaBR(calc[it.chave]);
      $('rb-sub-' + it.chave).innerHTML = sub[it.chave] || '';
      var esconder = (it.chave === 'aluguel' && veiculo() !== 'proprio') ||
                     (it.chave === 'transporte' && calc.transporte <= 0);
      $('rb-item-' + it.chave).classList.toggle('oculto', esconder);
    });

    var totalFinal = totalComAjustes(calc);
    $('rb-total').innerHTML = 'Valor total da logística: <strong>' + moedaBR(totalFinal) + '</strong>' +
      '<span class="rb-total-sub">inclui pedágio de ' + moedaBR(calc.pedagio) +
      (totalFinal !== calc.total ? ' · com os valores propostos nos ajustes' : '') + '</span>';

    var pct = percentualVal();
    var solicitado = Math.round(totalFinal * pct) / 100;
    $('rb-solicitado').innerHTML = 'Você está solicitando <strong>' + pct + '% = ' + moedaBR(solicitado) + '</strong>';
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
    if (v === 'proprio' && osSel && ctx) {
      info.textContent = '🚗 Veículo próprio: o aluguel entra sozinho — ' +
        moedaBR(ctx.valores.aluguel_veiculo_dia) + '/dia × ' + diasViagemVal() + ' dia(s) de viagem.';
      info.classList.remove('oculto');
    } else {
      info.classList.add('oculto');
    }
    pintarValores();
  }

  /* ============ Rascunho (salva o preenchimento no aparelho) ============ */

  function chaveRascunho() { return 'logistica:' + ((sessao().email || sessionNome() || 'anon').toLowerCase()); }

  function coletarRascunho() {
    if (!osSel) return null;
    var decisoes = {}, justs = {}, novos = {};
    ITENS.forEach(function (it) {
      decisoes[it.chave] = decisao(it.chave);
      justs[it.chave] = $('rb-just-' + it.chave) ? $('rb-just-' + it.chave).value : '';
      novos[it.chave] = $('rb-novoval-' + it.chave) ? $('rb-novoval-' + it.chave).value : '';
    });
    var anx = {};
    Object.keys(anexos).forEach(function (b) { anx[b] = anexos[b].obter(); });
    return {
      osId: osSel.osId,
      campanha: $('rb-campanha').value,
      designado: $('rb-designado').value,
      veiculo: veiculo(),
      origemCidade: $('rb-origem-cidade').value, origemUf: $('rb-origem-uf').value,
      destinoCidade: $('rb-destino-cidade').value, destinoUf: $('rb-destino-uf').value,
      distancia: $('rb-distancia').value,
      tipoCombustivel: $('rb-combustivel').value,
      precoLitro: $('rb-preco-litro').value,
      combJustificativa: $('rb-comb-justificativa').value,
      pedagio: $('rb-pedagio').value,
      decisoes: decisoes, justificativas: justs, novosValores: novos,
      percentual: $('rb-percentual').value,
      anexos: anx,
      salvoEm: new Date().toISOString()
    };
  }

  var rascunhoTimer = null;
  function salvarRascunhoLogo() {
    if (restaurando) return;
    clearTimeout(rascunhoTimer);
    rascunhoTimer = setTimeout(async function () {
      var r = coletarRascunho();
      if (!r) return;
      try { await EC.db.set(LOJA_RASCUNHO, chaveRascunho(), r); } catch (e) { /* ok */ }
    }, 800);
  }

  async function lerRascunho() {
    try { return await EC.db.get(LOJA_RASCUNHO, chaveRascunho()); } catch (e) { return null; }
  }

  async function limparRascunho() {
    clearTimeout(rascunhoTimer);
    try { await EC.db.remove(LOJA_RASCUNHO, chaveRascunho()); } catch (e) { /* ok */ }
    $('rb-rascunho-aviso').classList.add('oculto');
  }

  function aplicarRascunho(r) {
    restaurando = true;
    try {
      var o = (ctx.os || []).filter(function (x) { return x.osId === r.osId; })[0];
      if (!o) return false;
      escolherOs(o);
      if (r.campanha && $('rb-campanha').value !== r.campanha) {
        $('rb-campanha').value = r.campanha;
        aoEscolherCampanha();
      }
      if (r.designado) {
        $('rb-designado').value = r.designado;
        atualizarTecSel();
      }
      if (r.veiculo) {
        var radio = document.querySelector('input[name="rb-veiculo"][value="' + r.veiculo + '"]');
        if (radio) { radio.checked = true; }
      }
      if (r.origemCidade) $('rb-origem-cidade').value = r.origemCidade;
      if (r.origemUf) setUF('rb-origem-uf', r.origemUf);
      if (r.destinoCidade) $('rb-destino-cidade').value = r.destinoCidade;
      if (r.destinoUf) setUF('rb-destino-uf', r.destinoUf);
      if (r.distancia && !$('rb-distancia').readOnly) $('rb-distancia').value = r.distancia;
      $('rb-combustivel').value = r.tipoCombustivel || '';
      $('rb-preco-litro').value = r.precoLitro || '';
      $('rb-comb-justificativa').value = r.combJustificativa || '';
      $('rb-pedagio').value = r.pedagio || '';
      $('rb-percentual').value = r.percentual || '100';

      montarValores(r.anexos || {}); // recria os itens + anexos com as evidências salvas
      ITENS.forEach(function (it) {
        var dec = (r.decisoes || {})[it.chave] || 'concordo';
        var radio = document.querySelector('input[name="rb-dec-' + it.chave + '"][value="' + dec + '"]');
        if (radio) radio.checked = true;
        $('rb-ajuste-' + it.chave).classList.toggle('oculto', dec !== 'ajuste');
        $('rb-just-' + it.chave).value = (r.justificativas || {})[it.chave] || '';
        $('rb-novoval-' + it.chave).value = (r.novosValores || {})[it.chave] || '';
      });

      pintarTeto();
      aoMudarVeiculo();
      pintarResumoAuto();
      pintarValores();
      return true;
    } finally {
      restaurando = false;
    }
  }

  /* ============ Nova solicitação ============ */

  async function abrirNovo(ignorarRascunho) {
    EC.app.mostrarTela('tela-reembolso-novo');
    $('rb-erro').classList.add('oculto');
    $('rb-rascunho-aviso').classList.add('oculto');

    var temCtx = await atualizarContexto();
    $('rb-offline').classList.toggle('oculto', temCtx);
    $('rb-form').classList.toggle('oculto', !temCtx);
    if (!temCtx) return;

    osSel = null; campSel = null; tecSel = null;
    $('rb-os-escolhida').classList.add('oculto');
    $('rb-os-escolhida').innerHTML = '';
    $('rb-os-picker').classList.remove('oculto');
    $('rb-os-busca').value = '';
    pintarResultadosOs('');
    $('rb-cliente').value = '';
    $('rb-distancia').value = '';
    $('rb-distancia-hint').textContent = '';
    $('rb-campanha-bloco').classList.add('oculto');
    $('rb-solicitante').value = sessionNome();
    $('rb-sem-agenda').classList.add('oculto');
    $('rb-designado-bloco').classList.add('oculto');
    $('rb-designado').innerHTML = '';
    $('rb-viagem').classList.add('oculto');
    $('rb-auto').classList.add('oculto');
    $('rb-ida').value = ''; $('rb-servico-inicio').value = ''; $('rb-servico-fim').value = ''; $('rb-volta').value = '';
    $('rb-dias-servico').value = ''; $('rb-dias-desloc').value = '';
    document.querySelectorAll('input[name="rb-veiculo"]').forEach(function (r) { r.checked = false; });
    $('rb-transporte-campos').classList.add('oculto');
    $('rb-combustivel').value = '';
    $('rb-preco-litro').value = '';
    $('rb-comb-justificativa').value = '';
    $('rb-teto-alerta').classList.add('oculto');
    $('rb-teto-just').classList.add('oculto');
    $('rb-pedagio').value = '';
    $('rb-percentual').value = '100';
    montarValores();
    pintarResumoAuto();
    pintarValores();

    // rascunho: retoma de onde parou (a menos que a pessoa peça "do zero")
    if (!ignorarRascunho) {
      var r = await lerRascunho();
      if (r && r.osId && aplicarRascunho(r)) {
        $('rb-rascunho-aviso').classList.remove('oculto');
      }
    }
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
      solicitante: pedido.solicitante, designado: pedido.designado, veiculo: pedido.veiculo,
      tipoCombustivel: pedido.tipoCombustivel, precoLitro: pedido.precoLitro,
      combustivelJustificativa: pedido.combustivelJustificativa,
      valorPedagio: pedido.valorPedagio, distanciaManual: pedido.distanciaManual,
      dataInicio: pedido.dataInicio, dataRetorno: pedido.dataRetorno,
      servicoInicio: pedido.servicoInicio, servicoFim: pedido.servicoFim,
      diasServico: pedido.diasServico, diasDeslocamento: pedido.diasDeslocamento,
      origemCidade: pedido.origemCidade, origemUf: pedido.origemUf,
      destinoCidade: pedido.destinoCidade, destinoUf: pedido.destinoUf,
      percentualSolicitado: pedido.percentualSolicitado,
      ajustes: pedido.ajustes
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
    if (!osSel) return mostrarErro('Busque e escolha a Ordem de Serviço.');
    if (osSel.campanhas.length === 0) {
      return mostrarErro('Esta OS ainda não tem o serviço na Agenda — peça para incluir a programação (dias e técnicos) primeiro.');
    }
    if (!campSel) return mostrarErro('Escolha a campanha.');
    if (campSel.tecnicos.length === 0) {
      return mostrarErro('Esta OS está na Agenda sem técnicos vinculados — peça para incluir os técnicos nos dias primeiro.');
    }
    if (!tecSel) return mostrarErro('Escolha o designado (o técnico da viagem).');
    var solicitante = sessionNome();
    if (!solicitante) return mostrarErro('Sua sessão expirou — entre de novo no app.');
    if (!veiculo()) return mostrarErro('Responda: o veículo é da ENGEAR ou do colaborador?');

    var preco = parseFloat($('rb-preco-litro').value) || 0;
    var tipoComb = $('rb-combustivel').value;
    if (preco > 0 && !tipoComb) return mostrarErro('Escolha o tipo de combustível (gasolina ou diesel).');
    if (tipoComb && !(preco > 0)) return mostrarErro('Informe o preço por litro do combustível.');
    if (tipoComb && preco > 0 && distanciaAtual() <= 0) {
      return mostrarErro('Informe a distância percorrida (km) para calcular o combustível.');
    }
    if (preco > tetoDoCombustivel() && tipoComb) {
      if (!$('rb-comb-justificativa').value.trim()) {
        return mostrarErro('O preço por litro passou do teto — a justificativa é obrigatória.');
      }
      if (anexos.combustivel.obter().length === 0) {
        return mostrarErro('O preço por litro passou do teto — anexe uma evidência (foto da bomba ou nota).');
      }
    }

    var calc = calcular();
    var ajustes = [];
    for (var i = 0; i < ITENS.length; i++) {
      var it = ITENS[i];
      if ($('rb-item-' + it.chave).classList.contains('oculto')) continue;
      if (decisao(it.chave) === 'ajuste') {
        var rotulo = it.rotulo.replace(/^\S+\s/, '');
        var just = $('rb-just-' + it.chave).value.trim();
        var novo = valorProposto(it.chave);
        if (novo == null) return mostrarErro('Você pediu ajuste em "' + rotulo + '" — informe o novo valor proposto (R$).');
        if (!just) return mostrarErro('Você pediu ajuste em "' + rotulo + '" — escreva a justificativa.');
        ajustes.push({ item: it.chave, justificativa: just, valorProposto: novo });
      }
    }
    var pct = percentualVal();
    if (!(pct > 0 && pct <= 100)) return mostrarErro('O percentual solicitado precisa ficar entre 1% e 100%.');
    mostrarErro(null);

    var todosAnexos = [];
    Object.keys(anexos).forEach(function (bloco) {
      anexos[bloco].obter().forEach(function (a) {
        todosAnexos.push({ bloco: bloco, nomeArquivo: a.nomeArquivo, base64: a.base64, mime: a.mime });
      });
    });

    var totalFinal = calc ? totalComAjustes(calc) : 0;
    var pedido = {
      codigo: 'LG_' + osSel.numero + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      osId: osSel.osId,
      os: osSel.numero,
      campanha: campSel ? campSel.numero : null,
      solicitante: solicitante,
      designado: tecSel.nome,
      veiculo: veiculo(),
      tipoCombustivel: tipoComb || null,
      precoLitro: preco > 0 ? preco : null,
      combustivelJustificativa: $('rb-comb-justificativa').value.trim(),
      valorPedagio: parseFloat($('rb-pedagio').value) || 0,
      distanciaManual: distanciaDaOs() > 0 ? null : distanciaAtual(),
      // trajeto (só quando a distância veio das cidades, não da OS)
      origemCidade: distanciaDaOs() > 0 ? null : ($('rb-origem-cidade').value.trim() || null),
      origemUf: distanciaDaOs() > 0 ? null : ($('rb-origem-uf').value || null),
      destinoCidade: distanciaDaOs() > 0 ? null : ($('rb-destino-cidade').value.trim() || null),
      destinoUf: distanciaDaOs() > 0 ? null : ($('rb-destino-uf').value || null),
      // dias/datas informados (o servidor usa só quando a OS não tem viagem na Agenda)
      dataInicio: $('rb-ida').value || null,
      dataRetorno: $('rb-volta').value || null,
      servicoInicio: $('rb-servico-inicio').value || null,
      servicoFim: $('rb-servico-fim').value || null,
      diasServico: diasServicoVal(),
      diasDeslocamento: diasDeslocVal(),
      percentualSolicitado: pct,
      ajustes: ajustes,
      anexos: todosAnexos,
      // só para exibir na fila offline:
      valorTotal: totalFinal,
      valorSolicitado: Math.round(totalFinal * pct) / 100,
      percentual: pct,
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
      limparRascunho();
    } catch (e) {
      if (e.rejeitado) {
        botao.disabled = false;
        botao.textContent = 'Enviar solicitação ✓';
        return mostrarErro(e.message);
      }
      try { await EC.db.set(LOJA_PENDENTES, pedido.codigo, pedido); } catch (e2) { /* ok */ }
      toast('📴 Sem conexão. Solicitação guardada — será enviada quando a internet voltar.');
      limparRascunho();
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
    var total = p.valor_total != null ? p.valor_total : p.valorTotal;
    var pct = p.percentual_solicitado != null ? Number(p.percentual_solicitado) : (p.percentual || 100);
    var solicitado = p.valor_solicitado != null ? p.valor_solicitado : p.valorSolicitado;
    var linhaValor = pct < 100 && solicitado != null
      ? '<strong>' + moedaBR(solicitado) + '</strong> (' + pct + '% de ' + moedaBR(total) + ')'
      : '<strong>' + moedaBR(total) + '</strong>';
    var obs = (p.status === 'rejeitado' || p.status === 'correcao') && p.observacao_logistica
      ? '<div class="rb-motivo">Observação da Logística: ' + p.observacao_logistica + '</div>' : '';
    var pagoInfo = p.status === 'pago' && p.pago_em
      ? '<div class="os-resumo">Pago em ' + dataBR(p.pago_em) + (p.forma_pagamento ? ' · ' + p.forma_pagamento : '') + '</div>' : '';
    return (
      '<div class="rb-pedido">' +
      '  <div class="rb-pedido-topo"><span class="os-numero">OS ' + (p.os || '?') + '</span>' +
      '    <span class="rb-status ' + st.cls + '">' + st.txt + '</span></div>' +
      '  <div class="rb-pedido-linha">' + linhaValor +
      (retorno !== '—' ? ' · retorno ' + retorno : '') + '</div>' +
      (p.designado ? '<div class="os-resumo">👷 Designado: ' + p.designado + '</div>' : '') +
      (p.cliente ? '<div class="os-resumo">' + p.cliente + '</div>' : '') +
      obs + pagoInfo +
      '</div>'
    );
  }

  function listaEmCache() {
    var nome = sessionNome();
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
    var nome = sessionNome();
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

    fillUFselect('rb-origem-uf');
    fillUFselect('rb-destino-uf');
    $('rb-novo').addEventListener('click', function () { abrirNovo(false); });
    $('rb-voltar').addEventListener('click', function () { EC.app.mostrarTela('tela-acao'); });
    $('rb-cancelar').addEventListener('click', function () { EC.app.mostrarTela('tela-reembolso'); pintarLista(); });
    $('rb-enviar').addEventListener('click', enviarFormulario);
    $('rb-rascunho-descartar').addEventListener('click', async function () {
      await limparRascunho();
      abrirNovo(true);
      toast('🧹 Rascunho descartado — formulário zerado.');
    });

    $('rb-os-busca').addEventListener('input', function () { pintarResultadosOs(this.value); });
    $('rb-campanha').addEventListener('change', aoEscolherCampanha);
    $('rb-designado').addEventListener('change', function () {
      atualizarTecSel();
      pintarResumoAuto();
      pintarValores();
    });
    document.querySelectorAll('input[name="rb-veiculo"]').forEach(function (r) {
      r.addEventListener('change', aoMudarVeiculo);
    });
    $('rb-combustivel').addEventListener('change', function () { pintarTeto(); pintarValores(); });
    $('rb-preco-litro').addEventListener('input', function () { pintarTeto(); pintarValores(); });
    $('rb-distancia').addEventListener('input', pintarValores);
    $('rb-origem-cidade').addEventListener('input', agendarCalculo);
    $('rb-destino-cidade').addEventListener('input', agendarCalculo);
    $('rb-origem-uf').addEventListener('change', calcularDistancia);
    $('rb-destino-uf').addEventListener('change', calcularDistancia);
    $('rb-pedagio').addEventListener('input', pintarValores);
    $('rb-percentual').addEventListener('input', pintarValores);

    // qualquer mudança no formulário salva o rascunho (com pausa de digitação)
    $('rb-form').addEventListener('input', salvarRascunhoLogo);
    $('rb-form').addEventListener('change', salvarRascunhoLogo);
  }

  function abrir() {
    iniciar();
    EC.app.mostrarTela('tela-reembolso');
    pintarLista();
    enviarPendentes(true);
    atualizarListaDoServidor();
    atualizarContexto();
  }

  window.addEventListener('online', function () { enviarPendentes(true); });

  return { abrir: abrir };
})();
