/**
 * reembolso.js — Solicitação de Reembolso de viagem (módulo Logística)
 *
 * Fluxo: busca a OS (todas as OS aparecem), campanha e datas vêm da Agenda
 * quando existem (senão o técnico informa as 4 datas: ida, início/término do
 * serviço e chegada — os dias saem sozinhos das datas). O solicitante é o
 * usuário logado; quem tem papel Logística/admin no SGP pode preencher em nome
 * de outro técnico. O app calcula os valores com as diárias vigentes do SGP:
 *   • hospedagem  = R$/diária × nº de diárias (chegada − saída);
 *   • alimentação = almoço/jantar × dias de serviço + lanche × deslocamento
 *     (exceção 1 serviço/0 deslocamento: 1 almoço fixo + jantar só se chegou
 *     em casa depois das 18h);
 *   • combustível usa ida+volta + 5 km por dia de serviço (entre os pontos);
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

  // Explicação de cada tipo de reembolso (mostrada em destaque ao escolher).
  var TIPO_DESC = {
    viagem: '🧳 Viagem: opção para solicitar a previsão de despesas de viagens destinadas à execução de serviços de monitoramento.',
    complemento: '➕ Complemento: opção para solicitar um valor complementar referente a despesas não previstas na solicitação inicial da viagem.',
    evento: '🔊 Eventos: opção para solicitar o pagamento do valor acordado para a realização de monitoramentos em eventos, como shows, partidas esportivas, feiras, entre outros.',
    veiculo: '🚗 Veículos: opção para solicitar o reembolso ou pagamento de despesas relacionadas exclusivamente ao uso de veículos, como abastecimento, manutenção, pedágios e outros custos associados.'
  };

  var ctx = null;          // contexto do servidor: { valores, os: [...] }
  var osSel = null, campSel = null, tecSel = null;
  var tipoSel = null;      // tipo do reembolso: 'viagem' | 'evento' | 'veiculo' | 'complemento'
  var compViagem = null;   // viagem PAGA do designado nesta OS (base do complemento por km)
  var dispCampanha = 100; // % da logística ainda disponível na campanha (100 − já solicitado)
  var anexos = {};
  var iniciado = false;
  var restaurando = false; // evita salvar rascunho no meio da restauração
  var editando = null;     // código da solicitação sendo substituída (modo edição)

  function $(id) { return document.getElementById(id); }
  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }
  function sessao() { return EC.storage.ler('sessao:atual') || {}; }
  function sessionNome() { return (sessao().nome || '').trim(); }

  function moedaBR(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  // Formata "AAAA-MM-DD" ou um TIMESTAMP (ex.: created_at) em DD/MM/AAAA. Datas
  // puras (sem hora) vão direto; timestamps são convertidos para o horário de
  // Brasília (UTC−3) antes de extrair o dia — senão um pedido feito à noite (ex.:
  // 21h de 15/07 = 00h UTC de 16/07) apareceria com a data do dia seguinte.
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
  function opcao(valor, texto) { return '<option value="' + valor + '">' + texto + '</option>'; }

  // Todas as datas "AAAA-MM-DD" de a até b (inclusive); vazio se a>b/inválida.
  function intervaloDatas(a, b) {
    var out = [];
    var ini = String(a || '').slice(0, 10), fim = String(b || '').slice(0, 10);
    if (!ini || !fim) return out;
    var t = new Date(ini + 'T12:00:00Z').getTime(), end = new Date(fim + 'T12:00:00Z').getTime();
    if (isNaN(t) || isNaN(end) || t > end) return out;
    while (t <= end) { out.push(new Date(t).toISOString().slice(0, 10)); t += 86400000; }
    return out;
  }

  // Dias da viagem derivados das 4 DATAS editáveis (ou null se incoerentes):
  //   total       = dias de serviço mostrado (ida→chegada, inclui deslocamento)
  //   servicoPuro = só do início ao término do serviço (usado no combustível)
  //   desloc      = dias da viagem que não são de serviço
  function diasInfo() {
    var ida = $('rb-ida').value, sI = $('rb-servico-inicio').value,
        sF = $('rb-servico-fim').value, volta = $('rb-volta').value;
    if (!ida || !sI || !sF || !volta) return null;
    if (!(ida <= sI && sI <= sF && sF <= volta)) return null; // ISO compara direto
    var servico = intervaloDatas(sI, sF), total = intervaloDatas(ida, volta);
    var setS = {}; servico.forEach(function (d) { setS[d] = 1; });
    var deslocRaw = total.filter(function (d) { return !setS[d]; }).length;
    // Deslocamento sempre PAR (ida e volta): nunca 1. Serviço 2 dias ou mais e
    // deu 1 (volta no último dia de serviço) → vira 2 (sempre lanche de ida e de
    // volta). Afeta o lanche e a mão de obra (diária × (deslocamento + serviço)).
    var desloc = (servico.length >= 2 && deslocRaw === 1) ? 2 : deslocRaw;
    return {
      total: total.length, servicoPuro: servico.length, desloc: desloc,
      noites: diffDias(ida, volta), datasTotal: total
    };
  }
  function diasServicoVal() { var d = diasInfo(); return d ? d.total : 0; }   // TOTAL (campo)
  function diasDeslocVal() { var d = diasInfo(); return d ? d.desloc : 0; }
  function diasViagemVal() { var d = diasInfo(); return d ? d.total : 0; }    // = total
  function servicoPuroVal() { var d = diasInfo(); return d ? d.servicoPuro : 0; }

  // Caso especial de alimentação: vai e volta no mesmo dia (1 dia total, 0
  // deslocamento) — 1 almoço, jantar só se chegou a partir das 23h, e lanche só
  // se a distância do dia (ida+volta) passar de 200 km.
  function casoDiaUnico() { var d = diasInfo(); return !!d && d.total === 1 && d.desloc === 0; }
  function chegouAPartirDas23() {
    var el = $('rb-chegada-casa');
    var m = /^(\d{1,2}):(\d{2})$/.exec(((el && el.value) || '').trim());
    return m ? (Number(m[1]) * 60 + Number(m[2])) >= 23 * 60 : false;
  }
  // Sábado/domingo? Data "AAAA-MM-DD" avaliada em UTC ao meio-dia (sem fuso).
  function ehFimDeSemana(dataISO) {
    if (!dataISO) return false;
    var d = new Date(String(dataISO).slice(0, 10) + 'T12:00:00Z');
    var dia = d.getUTCDay();
    return dia === 0 || dia === 6;
  }
  // Datas de refeição = todas as datas da viagem (cada dia tem almoço/jantar).
  function datasRefeicao() { var d = diasInfo(); return d ? d.datasTotal : []; }

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
        var ehPdf = a.mime === 'application/pdf';
        var visual = ehPdf
          ? '<span class="anx-pdf-icone">📄</span>'
          : '<img src="data:image/jpeg;base64,' + a.base64 + '" alt="anexo" data-ver="' + i + '" title="Toque para ampliar">';
        // Botão explícito de ampliar (só imagem) — a miniatura sozinha é um
        // alvo pequeno no celular; o 🔍 é fácil de acertar.
        var verBtn = ehPdf ? '' : '<button type="button" class="anx-ver" data-ver="' + i + '" title="Ver a foto">🔍</button>';
        return '<div class="anx-item">' + visual +
          '<span class="anx-nome">' + a.nomeArquivo + '</span>' + verBtn +
          '<button type="button" class="anx-remover" data-i="' + i + '" title="Remover">✕</button></div>';
      }).join('');
      lista.querySelectorAll('.anx-remover').forEach(function (b) {
        b.addEventListener('click', function () { arquivos.splice(parseInt(b.dataset.i, 10), 1); render(); notificar(); });
      });
      // toque na miniatura OU no botão 🔍 abre a foto ampliada para conferência
      lista.querySelectorAll('[data-ver]').forEach(function (el) {
        el.addEventListener('click', function () { abrirLightbox(arquivos[parseInt(el.dataset.ver, 10)].base64); });
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

  // Distância (ida+volta) vem SEMPRE do trajeto origem→destino (cálculo pelo
  // mapa), nunca da OS. Lê o valor do campo (do cálculo ou digitado à mão).
  function distanciaAtual() {
    var v = parseFloat(String($('rb-distancia').value).replace(/[^\d.,]/g, '').replace(',', '.'));
    return v > 0 ? v : 0;
  }

  // Distância do combustível = ida+volta + 5 km por dia de serviço (deslocamento
  // entre os pontos durante o serviço).
  function distanciaCombustivel() { return distanciaAtual() + 5 * servicoPuroVal(); }

  var UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
    'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  function fillUFselect(id) { $(id).innerHTML = opcao('', 'UF') + UFS.map(function (u) { return opcao(u, u); }).join(''); }
  function setUF(id, uf) { $(id).value = String(uf || '').toUpperCase(); }

  function pintarDistancia() {
    var inp = $('rb-distancia'), hint = $('rb-distancia-hint'), cidades = $('rb-dist-cidades');
    // A distância SEMPRE vem do trajeto origem→destino (calculada pelo mapa),
    // nunca da OS. Origem pré-preenchida com a base da ENGEAR (Mateus Leme/MG);
    // destino vem da OS (município/UF do cliente). Ambos ficam editáveis.
    cidades.classList.remove('oculto');
    $('rb-origem-cidade').value = 'Mateus Leme';
    setUF('rb-origem-uf', 'MG');
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
    if (!osSel) return;
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
    // diasServico (campo) = TOTAL da viagem (ida→chegada); diasDeslocamento =
    // dias que não são de serviço; servicoPuro = só os dias de serviço (usado no
    // combustível). Tudo derivado das 4 datas (editáveis).
    var diasViagem = diasViagemVal();       // = total
    var diasDeslocamento = diasDeslocVal();
    var servicoPuro = servicoPuroVal();
    var diarias = diariasVal();
    var preco = parseFloat($('rb-preco-litro').value) || 0;
    var consumo = consumoAtual();
    var dist = distanciaAtual();
    var r2 = function (x) { return Math.round(x * 100) / 100; };

    // Combustível: (ida+volta + 5 km/dia PURO de serviço) ÷ consumo × preço/L.
    var distComb = dist + 5 * servicoPuro;
    var combustivel = (preco > 0 && distComb > 0 && consumo > 0) ? r2((distComb / consumo) * preco) : 0;
    var aluguel = veiculo() === 'proprio' ? r2(Number(v.aluguel_veiculo_dia) * diasViagem) : 0;
    // Hospedagem: R$/diária × noites fora (chegada − saída). Mesmo dia → 0.
    var hospedagem = r2(Number(v.hospedagem_dia) * diarias);
    // Mão de obra (CLT e freelancer) = diária × dias TOTAIS da viagem (cada dia
    // uma vez). CLT só recebe quando a viagem tem ≥ 2 dias; freelancer sempre.
    // Diária de exceção do designado (tecSel.diaria) substitui a padrão do vínculo.
    var diariaExc = (tecSel && Number(tecSel.diaria) > 0) ? Number(tecSel.diaria) : 0;
    var diariaFree = diariaExc || Number(v.diaria_freelancer);
    var diariaClt = diariaExc || Number(v.diaria_clt);
    var maoObra = (tecSel.tipo === 'freelancer' || diasViagem >= 2)
      ? r2((tecSel.tipo === 'freelancer' ? diariaFree : diariaClt) * diasViagem)
      : 0;
    // Alimentação (espelho do servidor). Jantar por dia (freela e CLT). Almoço:
    // freelancer sempre padrão; CLT = dia útil (13) / fim de semana (padrão).
    // Lanche por dia de deslocamento. EXCEÇÃO (1 serviço / 0 deslocamento): 1
    // almoço, jantar só se chegada ≥ 23h, lanche só se ida+volta > 200 km.
    var ehFreela = tecSel.tipo === 'freelancer';
    var almocoPadrao = Number(v.almoco);
    var almocoCltUtil = Number(v.almoco_clt_util) || 13;
    var almocoDoDia = function (dataISO) {
      return (ehFreela || ehFimDeSemana(dataISO)) ? almocoPadrao : almocoCltUtil;
    };
    var diasRef = datasRefeicao(); // todas as datas da viagem (ida→chegada)
    var almoco = 0, jantar = 0, lanche = 0;
    if (casoDiaUnico()) {
      almoco = r2(almocoDoDia(diasRef[0] || $('rb-ida').value));
      jantar = chegouAPartirDas23() ? r2(Number(v.jantar)) : 0;
      lanche = dist > 200 ? r2(Number(v.lanche)) : 0;
    } else if (diasRef.length) {
      almoco = r2(diasRef.reduce(function (s, d) { return s + almocoDoDia(d); }, 0));
      jantar = r2(Number(v.jantar) * diasRef.length);
      lanche = r2(Number(v.lanche) * diasDeslocamento);
    }
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

  // Data de hoje AAAA-MM-DD (local = Brasil).
  function hojeISO() {
    var d = new Date(); function pz(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + pz(d.getMonth() + 1) + '-' + pz(d.getDate());
  }
  // Serviço terminou (ou termina HOJE)? Usa a data de TÉRMINO preenchida no
  // formulário (pré-vem da Agenda, editável). O restante libera já no último
  // dia do serviço — quem finaliza hoje pode pedir os 100% hoje mesmo.
  function servicoTerminou() {
    var campo = $('rb-servico-fim');
    var sf = String((campo && campo.value) || (campSel && campSel.servicoFim) || '').slice(0, 10);
    return !sf || sf <= hojeISO();
  }
  // Teto do percentual: 50% antes do último dia do serviço; 100% a partir dele.
  function tetoPercentual() { return servicoTerminou() ? 100 : 50; }

  // Adiantamento de pagamento (opcional): descontado do valor solicitado.
  function adiantamentoAtivo() {
    var m = document.querySelector('input[name="rb-adiant"]:checked');
    return !!m && m.value === 'sim';
  }
  function adiantamentoVal() {
    if (!adiantamentoAtivo()) return 0;
    var v = parseFloat($('rb-adiant-valor').value);
    return v > 0 ? Math.round(v * 100) / 100 : 0;
  }

  // Valor monetário de um campo (0 se vazio/inválido).
  function valMon(id) {
    var v = parseFloat($(id).value);
    return v > 0 ? Math.round(v * 100) / 100 : 0;
  }
  // "Outros gastos" (existe nos três tipos; soma no total).
  function outrosVal() { return valMon('rb-outros-valor'); }

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
        var rotulo = t.vinculo || (t.tipo === 'freelancer' ? 'Freelancer' : 'CLT');
        return opcao(t.nome, t.nome + ' (' + rotulo + ')');
      }).join('');
      // pré-seleciona o usuário logado, se ele estiver entre os técnicos da OS
      var meu = campSel.tecnicos.filter(function (t) { return t.nome.trim().toLowerCase() === nomeSessao; })[0];
      if (meu) sel.value = meu.nome;
      blocoDesig.classList.remove('oculto');
    }

    atualizarTecSel();
    if (campSel) fillViagem(campSel); // preenche as datas ANTES do teto (o término define 50%/100%)
    atualizarDisponivel();
    pintarResumoAuto();
    atualizarBotaoComplemento();
    atualizarTipoUI();
    aoMudarVeiculo();
  }

  /* ============ Tipo do reembolso (Viagem / Eventos / Veículos) ============ */

  function escolherTipo(t) {
    tipoSel = t || null;
    document.querySelectorAll('.rb-tipo-btn').forEach(function (b) {
      b.classList.toggle('ativo', !!t && b.dataset.tipo === t);
    });
    atualizarTipoUI();
    pintarValores();
  }

  // A OS+campanha desta seleção já está 100% PAGA? (habilita o Complemento.)
  // Fully paga = tem parcela paga, nada pendente, e — se houver viagem — o
  // total pago de viagem fecha 100%. Eventos/veículos pagos também contam.
  // `rows` = solicitações do designado (cache do próprio usuário OU baixadas
  // do servidor quando a logística preenche para outro técnico).
  function calcGrupoPago(rows) {
    if (!osSel) return false;
    var camp = campSel ? campSel.numero : null;
    var g = (rows || []).filter(function (x) {
      return String(x.os) === String(osSel.numero) && Number(x.campanha_numero) === Number(camp);
    });
    if (!g.length) return false;
    if (g.some(function (x) { return x.status === 'aguardando_logistica' || x.status === 'aguardando_pagamento'; })) return false;
    if (!g.some(function (x) { return x.status === 'pago'; })) return false;
    var viagens = g.filter(function (x) { return (x.tipo || 'viagem') === 'viagem'; });
    if (viagens.length) {
      var pagoPct = viagens.filter(function (x) { return x.status === 'pago'; })
        .reduce(function (s, x) { return s + Number(x.percentual_solicitado || 0); }, 0);
      if (pagoPct < 99.99) return false;
    }
    return true;
  }

  // Solicitações de um DESIGNADO específico (para a logística conferir a OS de
  // outro técnico). Usa a lista já em cache quando é o próprio usuário; senão
  // baixa do servidor e guarda (a rota /lista filtra por designado).
  var cacheDesignado = {};
  async function listaDoDesignado(nome) {
    var chave = String(nome || '').trim().toLowerCase();
    if (!chave) return [];
    if (chave === sessionNome().trim().toLowerCase()) return listaEmCache();
    if (cacheDesignado[chave]) return cacheDesignado[chave];
    try {
      var corpo = await getJson(BASE + '/lista?solicitante=' + encodeURIComponent(nome));
      cacheDesignado[chave] = corpo.pedidos || [];
      return cacheDesignado[chave];
    } catch (e) { return []; } // offline: não libera o complemento p/ outro técnico
  }

  // A solicitação de VIAGEM paga do designado nesta OS+campanha (base do
  // complemento por km — traz a quilometragem inicial, distância, consumo e preço).
  function viagemDoGrupo(rows) {
    if (!osSel) return null;
    var camp = campSel ? campSel.numero : null;
    var vs = (rows || []).filter(function (x) {
      return String(x.os) === String(osSel.numero) && Number(x.campanha_numero) === Number(camp) &&
        (x.tipo || 'viagem') === 'viagem';
    });
    return vs.filter(function (x) { return x.status === 'pago' && x.km_atual != null; })[0]
        || vs.filter(function (x) { return x.km_atual != null; })[0]
        || vs.filter(function (x) { return x.status === 'pago'; })[0]
        || vs[0] || null;
  }

  // Cálculo do COMPLEMENTO por quilometragem (espelho do servidor):
  //   percorrida = km final − km inicial (inicial = quilometragem atual da viagem)
  //   efetiva    = distância ida+volta + 5 km/dia de serviço (a que pagou combustível)
  //   se percorrida > efetiva → valor = (km extra ÷ consumo) × preço do litro da viagem
  //   se percorrida ≤ efetiva → não há complemento (pagamos o suficiente ou mais).
  function calcularComplemento() {
    var v = compViagem;
    var finalTxt = String($('rb-comp-kmfinal').value).trim();
    var finalKm = finalTxt === '' ? null : parseFloat(finalTxt.replace(',', '.'));
    var out = { inicial: null, final: finalKm, percorrida: null, efetiva: null, extra: null, valor: 0, ok: false, msg: '' };
    if (!v || v.km_atual == null) { out.msg = 'A viagem desta OS não tem a quilometragem inicial registrada — não dá para calcular o complemento.'; return out; }
    var consumo = Number(v.consumo_kml) || 0, preco = Number(v.preco_litro) || 0;
    if (!(consumo > 0) || !(preco > 0)) { out.msg = 'A viagem não teve combustível reembolsado — não há como calcular o complemento por km.'; return out; }
    out.inicial = Number(v.km_atual);
    out.efetiva = Math.round(((Number(v.distancia_km) || 0) + 5 * (Number(v.dias_servico) || 0)) * 100) / 100;
    if (finalKm == null || !(finalKm >= 0)) return out; // ainda não digitou o final
    out.percorrida = Math.round((finalKm - out.inicial) * 100) / 100;
    if (!(out.percorrida > 0)) { out.msg = 'A quilometragem final deve ser maior que a inicial (' + out.inicial + ' km).'; return out; }
    out.extra = Math.round((out.percorrida - out.efetiva) * 100) / 100;
    if (!(out.extra > 0)) { out.msg = 'A quilometragem percorrida (' + out.percorrida + ' km) não passou da já paga na viagem (' + out.efetiva + ' km) — não há complemento a pagar.'; return out; }
    out.valor = Math.round((out.extra / consumo) * preco * 100) / 100;
    out.ok = out.valor > 0;
    return out;
  }

  // Mostra o botão "Complemento" só quando a OS do designado está 100% paga.
  // Guarda a viagem paga do grupo (base do cálculo por km).
  async function atualizarBotaoComplemento() {
    var btn = $('rb-tipo-complemento');
    if (!btn) return;
    var rows = tecSel ? await listaDoDesignado(tecSel.nome) : [];
    var libera = !!tecSel && calcGrupoPago(rows);
    compViagem = libera ? viagemDoGrupo(rows) : null;
    btn.classList.toggle('oculto', !libera);
    if (!libera && tipoSel === 'complemento') escolherTipo(null);
    if (tipoSel === 'complemento') pintarValores(); // já reflete os dados da viagem baixados
  }

  // Mostra/esconde os blocos do formulário conforme o tipo escolhido.
  function atualizarTipoUI() {
    $('rb-tipo-bloco').classList.toggle('oculto', !osSel);
    // Explicação em destaque do tipo escolhido (some quando nenhum está ativo).
    var desc = $('rb-tipo-desc');
    if (desc) {
      desc.textContent = (tipoSel && TIPO_DESC[tipoSel]) || '';
      desc.classList.toggle('oculto', !(tipoSel && TIPO_DESC[tipoSel]));
    }
    var ehViagem = tipoSel === 'viagem', ehEvento = tipoSel === 'evento',
        ehVeic = tipoSel === 'veiculo', ehComp = tipoSel === 'complemento';
    $('rb-viagem').classList.toggle('oculto', !(ehViagem && campSel));
    $('rb-sec-transporte').classList.toggle('oculto', !ehViagem);
    $('rb-sec-valores').classList.toggle('oculto', !ehViagem);
    $('rb-pct-viagem').classList.toggle('oculto', !ehViagem);
    $('rb-evento-bloco').classList.toggle('oculto', !ehEvento);
    $('rb-veic-bloco').classList.toggle('oculto', !ehVeic);
    $('rb-complemento-bloco').classList.toggle('oculto', !ehComp);
    $('rb-pedagio-bloco').classList.toggle('oculto', !(ehViagem || ehVeic));
    // "Outros gastos" existe nos demais tipos; no complemento o próprio valor
    // já é o gasto extra (com justificativa), então não repete o bloco.
    $('rb-outros-bloco').classList.toggle('oculto', !tipoSel || ehComp);
    if (ehEvento) {
      // Só avisa quando a diária de eventos NÃO está configurada no SGP (sem ela
      // o cálculo fica em zero). Com a diária definida, não mostra nada.
      var d = ctx ? (Number(ctx.valores.diaria_evento) || 0) : 0;
      var info = $('rb-evento-info');
      if (d > 0) {
        info.textContent = '';
        info.classList.add('oculto');
      } else {
        info.textContent = '⚠️ A diária de eventos ainda não foi configurada no SGP (Logística → Valores).';
        info.classList.remove('oculto');
      }
    }
  }

  // tecSel = DESIGNADO escolhido (a categoria dele entra no cálculo)
  function atualizarTecSel() {
    tecSel = null;
    if (!campSel) return;
    var nome = $('rb-designado').value;
    var t = campSel.tecnicos.filter(function (x) { return x.nome === nome; })[0];
    if (t) tecSel = { nome: t.nome, tipo: t.tipo, diaria: Number(t.diaria) > 0 ? Number(t.diaria) : 0 };
  }

  // Disponível = 100% − o que ESTE designado já solicitou na campanha (cada
  // técnico tem seu próprio 100%; um não trava o outro).
  function atualizarDisponivel() {
    var ja = 0;
    if (campSel && tecSel) {
      var t = campSel.tecnicos.filter(function (x) { return x.nome === tecSel.nome; })[0];
      ja = t ? (Number(t.jaSolicitado) || 0) : 0;
    }
    // Teto = 50% antes do último dia do serviço (pela data de término
    // informada); 100% a partir do último dia.
    var teto = tetoPercentual();
    dispCampanha = tecSel ? Math.max(0, Math.round((teto - ja) * 100) / 100) : 100;
    var pctInp = $('rb-percentual');
    pctInp.max = Math.max(1, dispCampanha);
    if (tecSel && dispCampanha < 100) pctInp.value = dispCampanha > 0 ? dispCampanha : 0;
    else pctInp.value = 100;
  }

  /* ============ Dados da viagem (sempre da Agenda) ============ */

  function fillViagem(campanha) {
    $('rb-ida').value = (campanha.dataInicio || '').slice(0, 10);
    $('rb-volta').value = (campanha.dataRetorno || '').slice(0, 10);
    $('rb-servico-inicio').value = (campanha.servicoInicio || '').slice(0, 10);
    $('rb-servico-fim').value = (campanha.servicoFim || '').slice(0, 10);
    // As DATAS vêm da Agenda mas ficam editáveis; os DIAS são calculados sozinhos.
    ['rb-ida', 'rb-servico-inicio', 'rb-servico-fim', 'rb-volta']
      .forEach(function (id) { $(id).readOnly = false; });
    ['rb-dias-servico', 'rb-dias-desloc'].forEach(function (id) { $(id).readOnly = true; });
    $('rb-viagem-fonte').textContent = '📅 Datas pré-preenchidas pela Agenda — edite se precisar; os dias se ajustam sozinhos.';
    recalcularDias();
    $('rb-viagem').classList.remove('oculto');
  }

  // Recalcula os campos de dias (serviço PURO, deslocamento) a partir das datas
  // editáveis; mostra aviso se as datas estiverem incoerentes.
  function recalcularDias() {
    var d = diasInfo();
    $('rb-dias-servico').value = d ? d.servicoPuro : '';
    $('rb-dias-desloc').value = d ? d.desloc : '';
    var aviso = $('rb-viagem-erro');
    if (aviso) {
      var temTodas = $('rb-ida').value && $('rb-servico-inicio').value && $('rb-servico-fim').value && $('rb-volta').value;
      aviso.classList.toggle('oculto', !!d || !temTodas);
    }
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
      pedagio: criarAnexos($('rb-anexos-pedagio'), { iniciais: anexosIniciais.pedagio, aoMudar: salvarRascunhoLogo }),
      // Outros gastos (três tipos) + evidências do reembolso de VEÍCULOS
      outros: criarAnexos($('rb-anexos-outros'), { iniciais: anexosIniciais.outros, aoMudar: salvarRascunhoLogo }),
      abastecimento: criarAnexos($('rb-anexos-abastecimento'), { iniciais: anexosIniciais.abastecimento, aoMudar: salvarRascunhoLogo }),
      pecas: criarAnexos($('rb-anexos-pecas'), { iniciais: anexosIniciais.pecas, aoMudar: salvarRascunhoLogo }),
      manutencao: criarAnexos($('rb-anexos-manutencao'), { iniciais: anexosIniciais.manutencao, aoMudar: salvarRascunhoLogo }),
      // Evidências do COMPLEMENTO de gastos (OS já paga)
      complemento: criarAnexos($('rb-anexos-complemento'), { iniciais: anexosIniciais.complemento, aoMudar: salvarRascunhoLogo })
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
    // Eventos, Veículos e Complemento têm cálculo próprio (sem os valores automáticos da viagem).
    if (tipoSel === 'evento' || tipoSel === 'veiculo' || tipoSel === 'complemento') return pintarValoresSimples();
    if (!tipoSel) {
      $('rb-total').classList.add('oculto');
      $('rb-pct-bloco').classList.add('oculto');
      return;
    }

    var blocoCheg = $('rb-chegada-bloco');
    if (blocoCheg) blocoCheg.classList.toggle('oculto', !casoDiaUnico());

    var calc = calcular();
    var pronto = !!calc;
    $('rb-total').classList.toggle('oculto', !pronto);
    $('rb-pct-bloco').classList.toggle('oculto', !pronto);
    if (!pronto) return;

    var v = ctx.valores;
    var dServico = diasServicoVal(), dDesloc = diasDeslocVal(), dViagem = diasViagemVal();
    var dPuro = servicoPuroVal();
    var kmExtra = 5 * dPuro, distTot = distanciaAtual() + kmExtra;
    var ehFreelaSub = tecSel && tecSel.tipo === 'freelancer';
    var datasRef = datasRefeicao();
    var nRef = datasRef.length;
    var nFds = datasRef.filter(ehFimDeSemana).length, nUtil = nRef - nFds;
    // Linha do almoço com a quantidade de dias (freelancer = 1 valor; CLT quebra
    // útil × fim de semana, que têm valores diferentes).
    var almocoSub = ehFreelaSub
      ? moedaBR(v.almoco) + '/dia × ' + nRef + ' dia(s) = ' + moedaBR(calc.almoco)
      : moedaBR(v.almoco_clt_util || 13) + ' × ' + nUtil + ' dia(s) útil' +
        (nFds ? ' + ' + moedaBR(v.almoco) + ' × ' + nFds + ' fim de semana' : '') +
        ' = ' + moedaBR(calc.almoco);
    var alimSub = casoDiaUnico()
      ? 'Foi e voltou no mesmo dia:<br>' +
        'Almoço: ' + moedaBR(calc.almoco) + '<br>' +
        'Jantar: ' + (calc.jantar > 0
          ? moedaBR(calc.jantar) + ' (chegou a partir das 23h)'
          : 'não incluído (chegada antes das 23h ou em branco)') + '<br>' +
        'Lanche: ' + (calc.lanche > 0
          ? moedaBR(calc.lanche) + ' (ida+volta acima de 200 km)'
          : 'não incluído (200 km ou menos)')
      : 'Almoço: ' + almocoSub + '<br>' +
        'Jantar: ' + moedaBR(v.jantar) + '/dia × ' + nRef + ' dia(s) = ' + moedaBR(calc.jantar) + '<br>' +
        'Lanche: ' + moedaBR(v.lanche) + '/dia × ' + dDesloc + ' dia(s) de deslocamento = ' + moedaBR(calc.lanche);
    var sub = {
      transporte: (distTot > 0
        ? distTot + ' km (' + distanciaAtual() + ' ida+volta + ' + kmExtra + ' km entre pontos: 5 km × ' + dPuro + ' dia(s) de serviço) ÷ ' +
          consumoAtual() + ' km/L (' + ($('rb-combustivel').value === 'diesel' ? 'diesel' : 'gasolina') + ') × preço do litro'
        : 'informe a distância e o preço do litro'),
      aluguel: moedaBR(v.aluguel_veiculo_dia) + '/dia × ' + dViagem + ' dia(s) de viagem',
      hospedagem: moedaBR(v.hospedagem_dia) + '/diária × ' + calc.diarias + ' diária(s) — da saída à chegada' +
        (calc.diarias === 0 ? ' (foi e voltou no mesmo dia: sem hospedagem)' : ''),
      mao_obra: (function () {
        var dExc = (tecSel && Number(tecSel.diaria) > 0) ? Number(tecSel.diaria) : 0;
        var sufixo = dExc ? ' (diária própria do ' + tecSel.nome + ')' : '';
        var base = '/dia × ' + dViagem + ' dia(s) da viagem (saída → chegada)';
        return tecSel.tipo === 'freelancer'
          ? moedaBR(dExc || v.diaria_freelancer) + base + sufixo
          : (dViagem >= 2
              ? moedaBR(dExc || v.diaria_clt) + base + sufixo
              : 'CLT com 1 dia de viagem não recebe diária');
      })(),
      alimentacao: alimSub
    };

    // Valor final de cada item = o proposto no ajuste (se pediu) OU o calculado.
    function valorFinalItem(chave) {
      var novo = valorProposto(chave);
      return novo != null ? novo : calc[chave];
    }

    ITENS.forEach(function (it) {
      var novo = valorProposto(it.chave);
      // Ao pedir ajuste, a linha já mostra o NOVO valor (o calculado é ignorado).
      $('rb-val-' + it.chave).textContent = moedaBR(novo != null ? novo : calc[it.chave]);
      $('rb-sub-' + it.chave).innerHTML = (novo != null ? '↺ valor do ajuste (substitui ' + moedaBR(calc[it.chave]) + ')<br>' : '') + (sub[it.chave] || '');
      var esconder = (it.chave === 'aluguel' && veiculo() !== 'proprio') ||
                     (it.chave === 'transporte' && calc.transporte <= 0);
      $('rb-item-' + it.chave).classList.toggle('oculto', esconder);
    });

    var outrosViagem = outrosVal();
    var totalFinal = Math.round((totalComAjustes(calc) + outrosViagem) * 100) / 100;
    // Resumo (pequeno) dos componentes que somam o total — inclui pedágio.
    var comps = [];
    ITENS.forEach(function (it) {
      if ($('rb-item-' + it.chave).classList.contains('oculto')) return;
      var val = valorFinalItem(it.chave);
      if (val > 0) comps.push(it.rotulo + ': ' + moedaBR(val));
    });
    if (calc.pedagio > 0) comps.push('🛣️ Pedágio: ' + moedaBR(calc.pedagio));
    if (outrosViagem > 0) comps.push('💠 Outros gastos: ' + moedaBR(outrosViagem));
    $('rb-total').innerHTML = 'Valor total da logística: <strong>' + moedaBR(totalFinal) + '</strong>' +
      '<span class="rb-total-sub">' + comps.join('<br>') +
      (totalComAjustes(calc) !== calc.total ? '<br><em>(com os valores propostos nos ajustes)</em>' : '') + '</span>';

    // Nota de disponível — POR DESIGNADO + teto de 50% antes do último dia do serviço.
    var info = $('rb-pct-info');
    var quem = (tecSel && tecSel.nome) ? tecSel.nome : 'este designado';
    var semServico = !!tecSel && !servicoTerminou();
    if (dispCampanha <= 0) {
      info.className = 'alerta alerta-vermelho';
      info.textContent = semServico
        ? '🚫 O serviço ainda não chegou ao último dia — o teto é 50% da logística, e ' + quem + ' já o atingiu. O restante libera no último dia do serviço (data de término).'
        : '🚫 ' + quem + ' já teve 100% da logística desta campanha solicitado/pago — não é possível novo reembolso para ele.';
      info.classList.remove('oculto');
    } else if (semServico) {
      info.className = 'alerta alerta-info';
      info.textContent = '⏳ O serviço ainda não chegou ao último dia: o teto agora é 50% da logística (100% libera na data de término). Disponível para ' + quem + ': ' + dispCampanha + '%.';
      info.classList.remove('oculto');
    } else if (dispCampanha < 100) {
      info.className = 'alerta alerta-info';
      info.textContent = 'ℹ️ Disponível para ' + quem + ': ' + dispCampanha + '% (o resto desta campanha já foi solicitado/pago).';
      info.classList.remove('oculto');
    } else {
      info.classList.add('oculto');
    }

    var pct = percentualVal();
    var solicitado = Math.round(totalFinal * pct) / 100;
    var paraDesig = (tecSel && tecSel.nome) ? ' para <strong>' + tecSel.nome + '</strong>' : '';
    $('rb-solicitado').innerHTML = 'Você está solicitando <strong>' + pct + '% = ' + moedaBR(solicitado) + '</strong>' + paraDesig;

    // Adiantamento: mostra os campos e o "valor a pagar". O adiantamento reduz
    // do TOTAL da campanha; ESTA parcela desconta só a fração que cabe a ela
    // (adiantamento × %) — o resto é descontado na(s) parcela(s) seguinte(s).
    $('rb-adiant-campos').classList.toggle('oculto', !adiantamentoAtivo());
    var adiant = adiantamentoVal();
    var pagar = $('rb-pagar');
    if (adiant > 0) {
      var fracao = Math.round(adiant * pct) / 100;
      var liquido = Math.round(solicitado * 100 - adiant * pct) / 100;
      pagar.innerHTML = 'Valor a pagar (após adiantamento): <strong>' + moedaBR(liquido) + '</strong>' +
        '<span class="rb-total-sub">solicitado ' + moedaBR(solicitado) + ' − ' + moedaBR(fracao) +
        (pct < 100 ? ' (parte do adiantamento de ' + moedaBR(adiant) + ' que cabe a esta parcela de ' + pct + '%)' : ' de adiantamento') + '</span>';
      pagar.classList.remove('oculto');
    } else {
      pagar.classList.add('oculto');
    }
  }

  // Total de EVENTOS (dias × diária) e VEÍCULOS (soma dos gastos) — pagamento
  // único (100%), sem percentual/parcelas; adiantamento desconta por inteiro.
  function pintarValoresSimples() {
    var comps = [], total = 0, pronto = false;
    // Complemento não usa o bloco "Outros gastos" (o próprio valor já é o gasto).
    var outros = tipoSel === 'complemento' ? 0 : outrosVal();
    if (tipoSel === 'complemento') {
      // Complemento por quilometragem: valor calculado do combustível dos km a mais.
      var c = calcularComplemento();
      $('rb-comp-kminicial').value = (c.inicial != null ? c.inicial : '');
      var info = $('rb-comp-info'), linhas = [];
      if (c.inicial != null && c.percorrida != null) {
        linhas.push('Quilometragem percorrida: <strong>' + c.percorrida + ' km</strong> (final ' + c.final + ' − inicial ' + c.inicial + ')');
        linhas.push('Distância já paga na viagem: ' + c.efetiva + ' km');
      }
      if (c.ok) {
        linhas.push('➡️ Complemento de combustível: ' + c.extra + ' km a mais = <strong>' + moedaBR(c.valor) + '</strong>');
        info.className = 'alerta alerta-info';
      } else if (c.msg) {
        linhas.push('⚠️ ' + c.msg);
        info.className = 'alerta alerta-amarelo';
      }
      if (linhas.length) { info.innerHTML = linhas.join('<br>'); info.classList.remove('oculto'); }
      else info.classList.add('oculto');
      if (c.ok) comps.push('➕ Complemento de combustível (' + c.extra + ' km a mais): ' + moedaBR(c.valor));
      total = c.valor;
      pronto = !!tecSel && c.ok;
    } else if (tipoSel === 'evento') {
      var dias = parseInt($('rb-evento-dias').value, 10) || 0;
      var diaria = ctx ? (Number(ctx.valores.diaria_evento) || 0) : 0;
      var diarias = Math.round(dias * diaria * 100) / 100;
      if (dias > 0 && diaria > 0) comps.push('🔊 Diárias do evento: ' + dias + ' dia(s) × ' + moedaBR(diaria) + ' = ' + moedaBR(diarias));
      total = Math.round((diarias + outros) * 100) / 100;
      pronto = !!tecSel && dias > 0 && diaria > 0;
    } else {
      var ab = valMon('rb-veic-abastecimento'), pc = valMon('rb-veic-pecas'),
          mn = valMon('rb-veic-manutencao'), pd = valMon('rb-pedagio');
      if (ab > 0) comps.push('⛽ Abastecimento: ' + moedaBR(ab));
      if (pc > 0) comps.push('🔩 Compra de peças: ' + moedaBR(pc));
      if (mn > 0) comps.push('🛠️ Manutenção: ' + moedaBR(mn));
      if (pd > 0) comps.push('🛣️ Pedágio: ' + moedaBR(pd));
      total = Math.round((ab + pc + mn + pd + outros) * 100) / 100;
      pronto = !!tecSel && total > 0;
    }
    if (outros > 0) comps.push('💠 Outros gastos: ' + moedaBR(outros));

    $('rb-total').classList.toggle('oculto', !pronto);
    $('rb-pct-bloco').classList.toggle('oculto', !pronto);
    if (!pronto) return;
    $('rb-total').innerHTML = 'Valor total: <strong>' + moedaBR(total) + '</strong>' +
      '<span class="rb-total-sub">' + comps.join('<br>') + '</span>';

    // Adiantamento (pagamento único = 100%: desconta o adiantamento inteiro).
    $('rb-adiant-campos').classList.toggle('oculto', !adiantamentoAtivo());
    var adiant = adiantamentoVal();
    var pagar = $('rb-pagar');
    if (adiant > 0) {
      var liquido = Math.round((total - adiant) * 100) / 100;
      pagar.innerHTML = 'Valor a pagar (após adiantamento): <strong>' + moedaBR(liquido) + '</strong>' +
        '<span class="rb-total-sub">total ' + moedaBR(total) + ' − adiantamento ' + moedaBR(adiant) + '</span>';
      pagar.classList.remove('oculto');
    } else {
      pagar.classList.add('oculto');
    }
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
      tipo: tipoSel,
      campanha: $('rb-campanha').value,
      designado: $('rb-designado').value,
      veiculo: veiculo(),
      eventoDias: $('rb-evento-dias').value,
      veicAbastecimento: $('rb-veic-abastecimento').value,
      veicPecas: $('rb-veic-pecas').value,
      veicManutencao: $('rb-veic-manutencao').value,
      compKmFinal: $('rb-comp-kmfinal').value,
      outrosValor: $('rb-outros-valor').value,
      outrosJust: $('rb-outros-just').value,
      origemCidade: $('rb-origem-cidade').value, origemUf: $('rb-origem-uf').value,
      destinoCidade: $('rb-destino-cidade').value, destinoUf: $('rb-destino-uf').value,
      distancia: $('rb-distancia').value,
      // datas da viagem (podem ter sido editadas)
      ida: $('rb-ida').value, servicoInicio: $('rb-servico-inicio').value,
      servicoFim: $('rb-servico-fim').value, volta: $('rb-volta').value,
      chegada: $('rb-chegada-casa') ? $('rb-chegada-casa').value : '',
      adiantAtivo: adiantamentoAtivo(), adiantData: $('rb-adiant-data').value, adiantValor: $('rb-adiant-valor').value,
      tipoCombustivel: $('rb-combustivel').value,
      precoLitro: $('rb-preco-litro').value,
      kmAtual: $('rb-km-atual').value,
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
      // tipo do reembolso + campos de Eventos/Veículos/Complemento/Outros
      atualizarBotaoComplemento();
      escolherTipo(r.tipo || 'viagem');
      if (r.eventoDias) $('rb-evento-dias').value = r.eventoDias;
      if (r.veicAbastecimento) $('rb-veic-abastecimento').value = r.veicAbastecimento;
      if (r.veicPecas) $('rb-veic-pecas').value = r.veicPecas;
      if (r.veicManutencao) $('rb-veic-manutencao').value = r.veicManutencao;
      if (r.compKmFinal) $('rb-comp-kmfinal').value = r.compKmFinal;
      if (r.outrosValor) $('rb-outros-valor').value = r.outrosValor;
      if (r.outrosJust) $('rb-outros-just').value = r.outrosJust;
      if (r.veiculo) {
        var radio = document.querySelector('input[name="rb-veiculo"][value="' + r.veiculo + '"]');
        if (radio) { radio.checked = true; }
      }
      if (r.origemCidade) $('rb-origem-cidade').value = r.origemCidade;
      if (r.origemUf) setUF('rb-origem-uf', r.origemUf);
      if (r.destinoCidade) $('rb-destino-cidade').value = r.destinoCidade;
      if (r.destinoUf) setUF('rb-destino-uf', r.destinoUf);
      if (r.distancia && !$('rb-distancia').readOnly) $('rb-distancia').value = r.distancia;
      // datas da viagem (se editadas) — sobrescreve o que veio da Agenda
      if (r.ida) $('rb-ida').value = r.ida;
      if (r.servicoInicio) $('rb-servico-inicio').value = r.servicoInicio;
      if (r.servicoFim) $('rb-servico-fim').value = r.servicoFim;
      if (r.volta) $('rb-volta').value = r.volta;
      recalcularDias();
      atualizarDisponivel(); // teto 50%/100% conforme o término restaurado (o % salvo entra abaixo)
      if (r.chegada && $('rb-chegada-casa')) $('rb-chegada-casa').value = r.chegada;
      // adiantamento
      var radAd = document.querySelector('input[name="rb-adiant"][value="' + (r.adiantAtivo ? 'sim' : 'nao') + '"]');
      if (radAd) radAd.checked = true;
      $('rb-adiant-data').value = r.adiantData || '';
      $('rb-adiant-valor').value = r.adiantValor || '';
      $('rb-combustivel').value = r.tipoCombustivel || '';
      $('rb-preco-litro').value = r.precoLitro || '';
      $('rb-km-atual').value = r.kmAtual || '';
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

  /* ============ Apagar / Editar (enquanto aguarda a Logística) ============ */

  // Liga/desliga o visual do modo edição (aviso, título e rótulo do botão).
  function marcarModoEdicao(on) {
    var aviso = $('rb-editando-aviso');
    if (aviso) aviso.classList.toggle('oculto', !on);
    var h1 = document.querySelector('#tela-reembolso-novo h1');
    if (h1) h1.textContent = on ? '✏️ Editar solicitação' : '💰 Nova solicitação de reembolso';
    var botao = $('rb-enviar');
    if (botao) botao.textContent = on ? 'Salvar alterações ✓' : 'Enviar solicitação ✓';
    if (!on) editando = null;
  }

  // Converte uma solicitação enviada (registro do servidor) no formato de
  // rascunho que aplicarRascunho() entende. As FOTOS não voltam do servidor —
  // ficam vazias e o técnico anexa de novo se o item exigir evidência.
  function pedidoParaRascunho(p) {
    var decis = {}, jus = {}, nov = {};
    (p.ajustes || []).forEach(function (a) {
      if (!a || !a.item) return;
      decis[a.item] = 'ajuste';
      jus[a.item] = a.justificativa || '';
      nov[a.item] = a.valor_proposto != null ? String(a.valor_proposto) : '';
    });
    // Horário de chegada não é gravado no banco; reconstrói pelo caso 1 serviço/
    // 0 deslocamento a partir do jantar computado (só interessa se foi >18h).
    var ehDiaUnico = Number(p.dias_servico) === 1 && Number(p.dias_deslocamento) === 0;
    var chegada = ehDiaUnico ? (Number(p.valor_jantar) > 0 ? '23:30' : '18:00') : '';
    return {
      osId: p.ordem_servico_id,
      campanha: p.campanha_numero != null ? String(p.campanha_numero) : '',
      designado: p.designado || '',
      veiculo: p.veiculo || '',
      origemCidade: p.origem_cidade || '', origemUf: p.origem_uf || '',
      destinoCidade: p.destino_cidade || '', destinoUf: p.destino_uf || '',
      distancia: p.distancia_km != null ? String(p.distancia_km) : '',
      ida: (p.data_inicio || '').slice(0, 10), servicoInicio: (p.servico_inicio || '').slice(0, 10),
      servicoFim: (p.servico_fim || '').slice(0, 10), volta: (p.data_retorno || '').slice(0, 10),
      chegada: chegada,
      adiantAtivo: Number(p.adiantamento_valor) > 0,
      adiantData: (p.adiantamento_data || '').slice(0, 10),
      adiantValor: p.adiantamento_valor != null && Number(p.adiantamento_valor) > 0 ? String(p.adiantamento_valor) : '',
      tipoCombustivel: p.tipo_combustivel || '',
      precoLitro: p.preco_litro != null ? String(p.preco_litro) : '',
      combJustificativa: p.combustivel_justificativa || '',
      pedagio: p.valor_pedagio != null ? String(p.valor_pedagio) : '',
      decisoes: decis, justificativas: jus, novosValores: nov,
      percentual: p.percentual_solicitado != null ? String(p.percentual_solicitado) : '100',
      anexos: {}
    };
  }

  // Reabre o formulário preenchido com uma solicitação já enviada. Ao salvar,
  // a antiga é apagada e uma nova é criada no lugar (ver enviarFormulario).
  async function abrirEdicao(p) {
    await abrirNovo(true); // reseta o formulário e ignora o rascunho salvo
    if ($('rb-form').classList.contains('oculto')) {
      toast('📴 Editar precisa de internet (os dados vêm da Agenda).');
      return;
    }
    if (!aplicarRascunho(pedidoParaRascunho(p))) {
      toast('Não consegui abrir para edição — recarregue a lista e tente de novo.');
      return;
    }
    editando = p.codigo;
    marcarModoEdicao(true);
    window.scrollTo(0, 0);
  }

  // Apaga de vez: da fila do aparelho (ainda não enviada) ou do servidor
  // (enquanto 'aguardando_logistica'). O % volta a ficar livre na campanha.
  async function apagarSolicitacao(p, aguardandoEnvio) {
    var msg = aguardandoEnvio
      ? 'Apagar esta solicitação que ainda não foi enviada? Ela sai da fila do aparelho.'
      : 'Apagar esta solicitação? Ela sai da análise da Logística e o valor volta a ficar disponível na campanha. Não dá para desfazer.';
    if (!confirm(msg)) return;
    try {
      if (aguardandoEnvio) {
        try { await EC.db.remove(LOJA_PENDENTES, p.codigo); } catch (e) { /* ok */ }
      } else {
        await postJson(BASE + '/cancelar', { codigo: p.codigo, solicitante: sessionNome() });
      }
      toast('🗑️ Solicitação apagada.');
      EC.app.mostrarTela('tela-reembolso');
      atualizarListaDoServidor();
      pintarLista();
    } catch (e) {
      toast('⚠️ Não consegui apagar agora' + (e && e.message ? ' (' + e.message + ')' : '') + '. Tente de novo com internet.');
    }
  }

  /* ============ Nova solicitação ============ */

  async function abrirNovo(ignorarRascunho) {
    EC.app.mostrarTela('tela-reembolso-novo');
    $('rb-erro').classList.add('oculto');
    $('rb-rascunho-aviso').classList.add('oculto');
    marcarModoEdicao(false);

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
    $('rb-chegada-casa').value = ''; $('rb-chegada-bloco').classList.add('oculto');
    document.querySelectorAll('input[name="rb-veiculo"]').forEach(function (r) { r.checked = false; });
    $('rb-transporte-campos').classList.add('oculto');
    $('rb-combustivel').value = '';
    $('rb-preco-litro').value = '';
    $('rb-km-atual').value = '';
    $('rb-comb-justificativa').value = '';
    $('rb-teto-alerta').classList.add('oculto');
    $('rb-teto-just').classList.add('oculto');
    $('rb-pedagio').value = '';
    $('rb-percentual').value = '100';
    cacheDesignado = {}; // status de "OS paga" por designado é rebaixado a cada nova solicitação
    $('rb-tipo-complemento').classList.add('oculto');
    escolherTipo(null); // volta para "escolha o tipo" (Viagem/Eventos/Veículos)
    $('rb-evento-dias').value = '';
    $('rb-veic-abastecimento').value = ''; $('rb-veic-pecas').value = ''; $('rb-veic-manutencao').value = '';
    $('rb-comp-kmfinal').value = ''; $('rb-comp-kminicial').value = '';
    if ($('rb-comp-info')) $('rb-comp-info').classList.add('oculto');
    compViagem = null;
    $('rb-outros-valor').value = ''; $('rb-outros-just').value = '';
    var radAdNao = document.querySelector('input[name="rb-adiant"][value="nao"]');
    if (radAdNao) radAdNao.checked = true;
    $('rb-adiant-data').value = ''; $('rb-adiant-valor').value = '';
    $('rb-adiant-campos').classList.add('oculto'); $('rb-pagar').classList.add('oculto');
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
    // Pedido de SALDO: copia a parcela aprovada no servidor; passa pela Logística.
    if (pedido._saldo) {
      return await postJson(BASE + '/saldo', {
        codigo: pedido.codigo, origemCodigo: pedido.origemCodigo, percentualSolicitado: pedido.percentualSolicitado
      });
    }
    var resp = await postJson(BASE + '/enviar', {
      codigo: pedido.codigo, osId: pedido.osId, campanha: pedido.campanha,
      tipo: pedido.tipo || 'viagem',
      diasEvento: pedido.diasEvento,
      valorOutros: pedido.valorOutros, outrosJustificativa: pedido.outrosJustificativa,
      valorAbastecimento: pedido.valorAbastecimento, valorPecas: pedido.valorPecas,
      valorManutencao: pedido.valorManutencao,
      kmFinal: pedido.kmFinal,
      solicitante: pedido.solicitante, designado: pedido.designado, veiculo: pedido.veiculo,
      tipoCombustivel: pedido.tipoCombustivel, precoLitro: pedido.precoLitro,
      combustivelJustificativa: pedido.combustivelJustificativa, kmAtual: pedido.kmAtual,
      valorPedagio: pedido.valorPedagio, distanciaManual: pedido.distanciaManual,
      dataInicio: pedido.dataInicio, dataRetorno: pedido.dataRetorno,
      servicoInicio: pedido.servicoInicio, servicoFim: pedido.servicoFim,
      diasServico: pedido.diasServico, diasDeslocamento: pedido.diasDeslocamento,
      horaChegadaCasa: pedido.horaChegadaCasa,
      origemCidade: pedido.origemCidade, origemUf: pedido.origemUf,
      destinoCidade: pedido.destinoCidade, destinoUf: pedido.destinoUf,
      percentualSolicitado: pedido.percentualSolicitado,
      adiantamentoValor: pedido.adiantamentoValor, adiantamentoData: pedido.adiantamentoData,
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
    if (!tipoSel) return mostrarErro('Escolha o tipo de reembolso: Viagem, Eventos ou Veículos.');
    if (osSel.campanhas.length === 0) {
      return mostrarErro('Esta OS ainda não tem o serviço na Agenda — peça para incluir a programação (dias e técnicos) primeiro.');
    }
    if (!campSel) return mostrarErro('Escolha a campanha.');
    if (campSel.tecnicos.length === 0) {
      return mostrarErro('Esta OS está na Agenda sem técnicos vinculados — peça para incluir os técnicos nos dias primeiro.');
    }
    if (!tecSel) return mostrarErro('Escolha o designado (o técnico do serviço).');
    if (tipoSel !== 'viagem') return enviarFormularioSimples();
    if (!diasInfo()) {
      return mostrarErro('Confira as datas da viagem: ida ≤ início do serviço ≤ término ≤ chegada (e todas preenchidas).');
    }
    var solicitante = sessionNome();
    if (!solicitante) return mostrarErro('Sua sessão expirou — entre de novo no app.');
    if (!veiculo()) return mostrarErro('Responda: o veículo é da ENGEAR ou do colaborador?');

    var preco = parseFloat($('rb-preco-litro').value) || 0;
    var tipoComb = $('rb-combustivel').value;
    if (preco > 0 && !tipoComb) return mostrarErro('Escolha o tipo de combustível (gasolina ou diesel).');
    if (tipoComb && !(preco > 0)) return mostrarErro('Informe o preço por litro do combustível.');
    if (tipoComb && preco > 0 && distanciaCombustivel() <= 0) {
      return mostrarErro('Informe a distância percorrida (km) para calcular o combustível.');
    }
    if (casoDiaUnico() && !$('rb-chegada-casa').value) {
      return mostrarErro('Informe o horário de chegada em casa (foi e voltou no mesmo dia).');
    }
    // Quilometragem atual do carro + foto da quilometragem — obrigatórias na viagem.
    var kmAtualTxt = String($('rb-km-atual').value).trim();
    if (!kmAtualTxt || !(parseFloat(kmAtualTxt.replace(',', '.')) >= 0)) {
      return mostrarErro('Informe a quilometragem atual do carro.');
    }
    if (anexos.combustivel.obter().length === 0) {
      return mostrarErro('Anexe a foto da quilometragem do carro (obrigatória).');
    }
    if (preco > tetoDoCombustivel() && tipoComb) {
      if (!$('rb-comb-justificativa').value.trim()) {
        return mostrarErro('O preço por litro passou do teto — a justificativa é obrigatória.');
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
    if (dispCampanha <= 0) return mostrarErro(!servicoTerminou()
      ? 'O serviço ainda não chegou ao último dia — o teto é 50% e já foi atingido. O restante libera na data de término do serviço.'
      : 'Este designado já teve 100% da logística desta campanha solicitado/pago — não é possível novo reembolso para ele.');
    if (pct > dispCampanha + 0.01) return mostrarErro(!servicoTerminou()
      ? 'O serviço ainda não chegou ao último dia: você pode solicitar no máximo ' + dispCampanha + '% agora (teto de 50% até a data de término).'
      : 'Você pode solicitar no máximo ' + dispCampanha + '% para este designado (o resto já foi solicitado/pago).');
    mostrarErro(null);

    // Anexos da VIAGEM (os blocos de Eventos/Veículos ficam de fora, mesmo se a
    // pessoa mudou de tipo no meio e deixou arquivos lá).
    var todosAnexos = [];
    Object.keys(anexos).forEach(function (bloco) {
      var deViagem = ['combustivel', 'pedagio', 'outros'].indexOf(bloco) !== -1 || bloco.indexOf('ajuste_') === 0;
      if (!deViagem) return;
      anexos[bloco].obter().forEach(function (a) {
        todosAnexos.push({ bloco: bloco, nomeArquivo: a.nomeArquivo, base64: a.base64, mime: a.mime });
      });
    });

    var totalFinal = Math.round(((calc ? totalComAjustes(calc) : 0) + outrosVal()) * 100) / 100;
    var pedido = {
      codigo: 'LG_' + osSel.numero + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      osId: osSel.osId,
      os: osSel.numero,
      tipo: 'viagem',
      valorOutros: outrosVal(),
      outrosJustificativa: $('rb-outros-just').value.trim() || null,
      campanha: campSel ? campSel.numero : null,
      solicitante: solicitante,
      designado: tecSel.nome,
      veiculo: veiculo(),
      tipoCombustivel: tipoComb || null,
      precoLitro: preco > 0 ? preco : null,
      combustivelJustificativa: $('rb-comb-justificativa').value.trim(),
      kmAtual: parseFloat(String($('rb-km-atual').value).replace(',', '.')) || null,
      valorPedagio: parseFloat($('rb-pedagio').value) || 0,
      distanciaManual: distanciaAtual(),
      // trajeto (a distância vem sempre do cálculo origem→destino, nunca da OS)
      origemCidade: $('rb-origem-cidade').value.trim() || null,
      origemUf: $('rb-origem-uf').value || null,
      destinoCidade: $('rb-destino-cidade').value.trim() || null,
      destinoUf: $('rb-destino-uf').value || null,
      // dias/datas informados (o servidor usa só quando a OS não tem viagem na Agenda)
      dataInicio: $('rb-ida').value || null,
      dataRetorno: $('rb-volta').value || null,
      servicoInicio: $('rb-servico-inicio').value || null,
      servicoFim: $('rb-servico-fim').value || null,
      diasServico: diasServicoVal(),
      diasDeslocamento: diasDeslocVal(),
      // horário de chegada em casa — só no caso 1 serviço/0 deslocamento (decide o jantar)
      horaChegadaCasa: casoDiaUnico() ? ($('rb-chegada-casa').value || null) : null,
      percentualSolicitado: pct,
      adiantamentoValor: adiantamentoVal(),
      adiantamentoData: (adiantamentoAtivo() && $('rb-adiant-data').value) ? $('rb-adiant-data').value : null,
      ajustes: ajustes,
      anexos: todosAnexos,
      // só para exibir na fila offline:
      valorTotal: totalFinal,
      valorSolicitado: Math.round(totalFinal * pct) / 100,
      percentual: pct,
      cliente: osSel.cliente,
      criadoEm: new Date().toISOString()
    };

    var eraEdicao = !!editando;
    var botao = $('rb-enviar');
    botao.disabled = true;
    botao.textContent = eraEdicao ? '⏳ Salvando…' : '⏳ Enviando…';
    try {
      // Edição = substituição: apaga a antiga PRIMEIRO (libera o % da campanha),
      // depois cria a nova. Precisa de internet — se falhar, não segue.
      if (editando) {
        try {
          await postJson(BASE + '/cancelar', { codigo: editando, solicitante: solicitante });
        } catch (e0) {
          botao.disabled = false;
          botao.textContent = 'Salvar alterações ✓';
          return mostrarErro('A edição precisa de internet para substituir a solicitação. Tente de novo com conexão.');
        }
        editando = null;
        marcarModoEdicao(false);
      }
      await enviarPedido(pedido);
      toast(eraEdicao
        ? '✅ Alterações enviadas! Aguarde a análise da Logística.'
        : '✅ Solicitação enviada! Agora é aguardar a análise da Logística.');
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

  // Envio de EVENTOS, VEÍCULOS e COMPLEMENTO: pagamento único (100%), sem
  // percentual/parcelas. O servidor recalcula o total (o app nunca manda pronto).
  async function enviarFormularioSimples() {
    var solicitante = sessionNome();
    if (!solicitante) return mostrarErro('Sua sessão expirou — entre de novo no app.');

    var outros = tipoSel === 'complemento' ? 0 : outrosVal();
    var extra = {}, total = 0, blocos = ['outros'];
    if (tipoSel === 'complemento') {
      var c = calcularComplemento();
      if (c.final == null) return mostrarErro('Informe a quilometragem final do carro.');
      if (!c.ok) return mostrarErro(c.msg || 'Não há complemento a pagar.');
      if (anexos.complemento.obter().length === 0) return mostrarErro('Anexe a foto da quilometragem final (obrigatória).');
      total = c.valor;
      extra.kmFinal = c.final; // o servidor puxa a inicial e recalcula o valor
      blocos = ['complemento'];
    } else if (tipoSel === 'evento') {
      var dias = parseInt($('rb-evento-dias').value, 10) || 0;
      if (!(dias >= 1)) return mostrarErro('Informe quantos dias de serviço (1 ou mais).');
      var diaria = ctx ? (Number(ctx.valores.diaria_evento) || 0) : 0;
      if (!(diaria > 0)) return mostrarErro('A diária de eventos ainda não foi configurada no SGP (Logística → Valores).');
      total = Math.round((dias * diaria + outros) * 100) / 100;
      extra.diasEvento = dias;
    } else {
      var ab = valMon('rb-veic-abastecimento'), pc = valMon('rb-veic-pecas'),
          mn = valMon('rb-veic-manutencao'), pd = valMon('rb-pedagio');
      total = Math.round((ab + pc + mn + pd + outros) * 100) / 100;
      if (!(total > 0)) return mostrarErro('Informe pelo menos um valor (abastecimento, peças, manutenção, pedágio ou outros).');
      extra.valorAbastecimento = ab; extra.valorPecas = pc; extra.valorManutencao = mn;
      extra.valorPedagio = pd;
      blocos = ['abastecimento', 'pecas', 'manutencao', 'pedagio', 'outros'];
    }
    mostrarErro(null);

    var todosAnexos = [];
    blocos.forEach(function (b) {
      if (!anexos[b]) return;
      anexos[b].obter().forEach(function (a) {
        todosAnexos.push({ bloco: b, nomeArquivo: a.nomeArquivo, base64: a.base64, mime: a.mime });
      });
    });

    var pedido = {
      codigo: 'LG_' + osSel.numero + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      osId: osSel.osId,
      os: osSel.numero,
      tipo: tipoSel,
      campanha: campSel ? campSel.numero : null,
      solicitante: solicitante,
      designado: tecSel.nome,
      valorOutros: outros,
      outrosJustificativa: $('rb-outros-just').value.trim() || null,
      adiantamentoValor: adiantamentoVal(),
      adiantamentoData: (adiantamentoAtivo() && $('rb-adiant-data').value) ? $('rb-adiant-data').value : null,
      anexos: todosAnexos,
      // só para exibir na fila offline:
      valorTotal: total,
      valorSolicitado: total,
      percentual: 100,
      cliente: osSel.cliente,
      criadoEm: new Date().toISOString()
    };
    Object.keys(extra).forEach(function (k) { pedido[k] = extra[k]; });

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
      if (!pedido || !pedido.codigo || (!pedido.osId && !pedido._saldo)) {
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

  // Card compacto: OS, projeto, nº da parcela e valor (% de total).
  function cartaoPedido(p, aguardandoEnvio, parcelaN, mostrarDesignado) {
    var st = aguardandoEnvio
      ? { txt: '📴 Aguardando envio', cls: 'rb-aguardando' }
      : (STATUS[p.status] || { txt: p.status, cls: 'rb-aguardando' });
    var total = p.valor_total != null ? p.valor_total : p.valorTotal;
    var pct = p.percentual_solicitado != null ? Number(p.percentual_solicitado) : (p.percentual || 100);
    var solicitado = p.valor_solicitado != null ? p.valor_solicitado : p.valorSolicitado;
    // Valor mostrado = o LÍQUIDO que o técnico recebe (parcela − a fração do
    // adiantamento que cabe a ela). Sem adiantamento, é o próprio valor da parcela.
    var adiantC = Number(p.adiantamento_valor) || 0;
    var solC = solicitado != null ? Number(solicitado) : Number(total || 0);
    var liquidoC = Math.round(solC * 100 - adiantC * pct) / 100;
    var valorTxt = adiantC > 0
      ? '<strong>' + moedaBR(liquidoC) + '</strong> <span class="rotulo-apoio">(' + pct + '%, já com o adiantamento)</span>'
      : (pct < 100 && solicitado != null)
        ? '<strong>' + moedaBR(solicitado) + '</strong> (' + pct + '% de ' + moedaBR(total) + ')'
        : '<strong>' + moedaBR(total) + '</strong>';
    var projeto = p.projeto ? '<div class="os-resumo">📁 ' + p.projeto + '</div>'
      : (p.cliente ? '<div class="os-resumo">' + p.cliente + '</div>' : '');
    var obs = (p.status === 'rejeitado' || p.status === 'correcao') && p.observacao_logistica
      ? '<div class="rb-motivo">Observação da Logística: ' + p.observacao_logistica + '</div>' : '';
    var t = p.tipo || 'viagem';
    var tipoTxt = t === 'evento' ? '<span class="rotulo-apoio">🔊 Evento</span> · '
      : t === 'veiculo' ? '<span class="rotulo-apoio">🚗 Veículos</span> · '
      : t === 'complemento' ? '<span class="rotulo-apoio">➕ Complemento</span> · ' : '';
    var parcelaTxt = tipoTxt + (parcelaN ? '<span class="rotulo-apoio">' + parcelaN + 'ª parcela</span> · ' : '');
    return (
      '<button type="button" class="rb-pedido rb-pedido-click" data-codigo="' + (p.codigo || '') + '">' +
      '  <div class="rb-pedido-topo"><span class="os-numero">OS ' + (p.os || '?') + '</span>' +
      '    <span class="rb-status ' + st.cls + '">' + st.txt + '</span></div>' +
      projeto +
      (mostrarDesignado && p.designado ? '<div class="os-resumo">👷 ' + p.designado + '</div>' : '') +
      '  <div class="rb-pedido-linha">' + parcelaTxt + valorTxt + '</div>' +
      obs +
      '</button>'
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
    atualizarSaldoBtn();
    var fila = await pedidosPendentes();
    var enviados = listaEmCache();
    var codigosFila = fila.map(function (p) { return p.codigo; });
    enviados = enviados.filter(function (p) { return codigosFila.indexOf(p.codigo) === -1; });

    if (!fila.length && !enviados.length) {
      area.innerHTML = '<p class="texto-apoio">Nenhuma solicitação ainda. Toque em "Nova solicitação" para começar.</p>';
      ligarBuscaLista();
      return;
    }
    // Numera as parcelas por OS+campanha+designado (a 1ª solicitação = 1ª parcela).
    listaNumParcela = numeraParcelas(enviados);
    listaTodos = fila.map(function (p) { return { p: p, aguardandoEnvio: true }; })
      .concat(enviados.map(function (p) { return { p: p, aguardandoEnvio: false }; }));
    listaPorCodigo = {};
    listaTodos.forEach(function (it) { listaPorCodigo[it.p.codigo] = it; });
    renderListaFiltrada();
    ligarBuscaLista();
  }

  // ---- Minhas solicitações: busca + agrupamento tipo extrato de banco ----
  var listaTodos = [], listaNumParcela = {}, listaPorCodigo = {}, buscaLigada = false;
  var MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  // Texto pesquisável do mês/ano (nome + MM/AAAA) da data de ida.
  function mesAnoBusca(ida) {
    var s = String(ida || '');
    if (s.length < 7) return '';
    var m = parseInt(s.slice(5, 7), 10);
    return (MESES_PT[m - 1] || '') + '/' + s.slice(0, 4) + ' ' + s.slice(5, 7) + '/' + s.slice(0, 4);
  }

  function ligarBuscaLista() {
    var inp = $('rb-busca');
    if (!inp || buscaLigada) return;
    buscaLigada = true;
    inp.addEventListener('input', renderListaFiltrada);
  }

  // Numera as parcelas por OS+campanha+designado (a 1ª solicitação = 1ª parcela).
  function numeraParcelas(pedidos) {
    var grupos = {};
    (pedidos || []).forEach(function (p) {
      // Só a VIAGEM tem parcelas (eventos/veículos são pagamento único).
      if ((p.tipo || 'viagem') !== 'viagem') return;
      var k = p.os + '|' + p.campanha_numero + '|' + (p.designado || '');
      (grupos[k] = grupos[k] || []).push(p);
    });
    var num = {};
    Object.keys(grupos).forEach(function (k) {
      grupos[k].slice().sort(function (a, b) {
        return String(a.created_at || a.criadoEm || '').localeCompare(String(b.created_at || b.criadoEm || ''));
      }).forEach(function (p, i) { num[p.codigo] = i + 1; });
    });
    return num;
  }

  // Data usada para agrupar/ordenar no extrato: a da viagem quando existe;
  // sem ela (Eventos/Veículos, que não têm datas de viagem), a data em que a
  // SOLICITAÇÃO foi feita — nunca fica "Sem data".
  function dataDoExtrato(p) {
    return String(p.data_inicio || p.dataInicio || p.created_at || p.criadoEm || '').slice(0, 10);
  }

  // Carimbo de quando a solicitação foi SALVA (created_at do servidor, ou o
  // criadoEm do aparelho enquanto está na fila) — é por ele que o extrato ordena.
  function carimboSalvo(p) {
    return String(p.created_at || p.criadoEm || p.data_inicio || p.dataInicio || '');
  }
  // Data "AAAA-MM-DD" de um timestamp no horário de Brasília (UTC−3); data pura
  // (sem hora) volta como está. Usada para agrupar o extrato por mês/ano.
  function dataBrasilISO(ts) {
    var s = String(ts || '');
    if (!s) return '';
    if (s.length <= 10 || s.indexOf('T') === -1) return s.slice(0, 10);
    var t = new Date(s).getTime();
    if (isNaN(t)) return s.slice(0, 10);
    var br = new Date(t - 3 * 3600000);
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return br.getUTCFullYear() + '-' + z(br.getUTCMonth() + 1) + '-' + z(br.getUTCDate());
  }

  // Renderiza a lista tipo extrato de banco (ano → mês) num container, com busca.
  // Sempre do MAIS NOVO para o mais antigo (pela data em que foi salva).
  // dados = [{p, aguardandoEnvio}]; onAbrir(item) ao clicar num card.
  function renderBancoLista(area, buscaEl, dados, numParcela, porCodigo, onAbrir, mostrarDesignado) {
    if (!area) return;
    var termo = ((buscaEl && buscaEl.value) || '').toLowerCase().trim();
    var itens = (dados || []).filter(function (it) {
      if (!termo) return true;
      var p = it.p;
      var quando = dataBrasilISO(carimboSalvo(p));
      var alvo = ('os ' + (p.os || '') + ' ' + (p.designado || '') + ' ' + (p.cliente || '') + ' ' + (p.projeto || '') + ' ' + mesAnoBusca(quando) + ' ' + quando + ' ' + dataDoExtrato(p)).toLowerCase();
      return alvo.indexOf(termo) !== -1;
    });
    if (!itens.length) { area.innerHTML = '<p class="texto-apoio">Nada encontrado.</p>'; return; }
    var porAno = {};
    itens.forEach(function (it) {
      var quando = dataBrasilISO(carimboSalvo(it.p));
      var ano = quando.slice(0, 4) || 'Sem data';
      var mk = quando.length >= 7 ? quando.slice(5, 7) : '00';
      porAno[ano] = porAno[ano] || {};
      (porAno[ano][mk] = porAno[ano][mk] || []).push(it);
    });
    var anos = Object.keys(porAno).sort(function (a, b) { return b.localeCompare(a); });
    area.innerHTML = anos.map(function (ano) {
      var meses = Object.keys(porAno[ano]).sort(function (a, b) { return b.localeCompare(a); });
      var mesesHtml = meses.map(function (mk) {
        // Dentro do mês: mais novo primeiro, pelo carimbo COMPLETO de quando foi salva.
        var lista = porAno[ano][mk].slice().sort(function (a, b) {
          return carimboSalvo(b.p).localeCompare(carimboSalvo(a.p));
        });
        var cards = lista.map(function (it) { return cartaoPedido(it.p, it.aguardandoEnvio, numParcela[it.p.codigo], mostrarDesignado); }).join('');
        var nomeM = mk === '00' ? 'Sem data' : (MESES_PT[parseInt(mk, 10) - 1] || mk);
        return '<details class="rb-mes" open><summary><span>' + nomeM + ' <span class="rotulo-apoio">(' + lista.length + ')</span></span></summary>' +
          '<div class="rb-mes-conteudo">' + cards + '</div></details>';
      }).join('');
      return '<details class="rb-ano" open><summary><span>' + ano + '</span></summary>' + mesesHtml + '</details>';
    }).join('');
    area.querySelectorAll('.rb-pedido-click[data-codigo]').forEach(function (el) {
      el.addEventListener('click', function () {
        var item = porCodigo[el.dataset.codigo];
        if (item) onAbrir(item);
      });
    });
  }

  function renderListaFiltrada() {
    renderBancoLista($('rb-lista'), $('rb-busca'), listaTodos, listaNumParcela, listaPorCodigo,
      function (item) { abrirExtrato(item.p, item.aguardandoEnvio); });
  }

  // ---- Extrato geral (Financeiro/Logística): TODAS as solicitações ----
  var egDados = [], egNumParcela = {}, egPorCodigo = {}, egBuscaLigada = false;
  var extratoOrigem = 'tela-reembolso';
  function ehGestor() {
    var p = (sessao().papeis) || [];
    return p.indexOf('financeiro') !== -1 || p.indexOf('logistica') !== -1 || p.indexOf('admin') !== -1;
  }
  function renderExtratoGeral() {
    renderBancoLista($('eg-lista'), $('eg-busca'), egDados, egNumParcela, egPorCodigo,
      function (item) { abrirExtrato(item.p, false, true); }, true);
  }
  async function extratoGeral() {
    iniciar(); // garante a fiação (voltar do extrato/tela geral) mesmo abrindo direto da home
    EC.app.mostrarTela('tela-extrato-geral');
    window.scrollTo(0, 0);
    var area = $('eg-lista');
    if (area) area.innerHTML = '<p class="texto-apoio">Carregando…</p>';
    var cli = (EC.auth && EC.auth.cliente) ? EC.auth.cliente() : null;
    if (!cli) { if (area) area.innerHTML = '<p class="texto-apoio">📡 Sem conexão. Abra com internet para ver o extrato geral.</p>'; return; }
    try {
      var q = await cli.from('logistica_solicitacoes').select('*').order('created_at', { ascending: false });
      if (q.error) throw q.error;
      var rows = q.data || [];
      egDados = rows.map(function (p) { return { p: p, aguardandoEnvio: false }; });
      egNumParcela = numeraParcelas(rows);
      egPorCodigo = {};
      egDados.forEach(function (it) { egPorCodigo[it.p.codigo] = it; });
      renderExtratoGeral();
      var inp = $('eg-busca');
      if (inp && !egBuscaLigada) { egBuscaLigada = true; inp.addEventListener('input', renderExtratoGeral); }
    } catch (e) {
      if (area) area.innerHTML = '<p class="texto-apoio">⚠️ Não consegui carregar: ' + (e.message || 'erro') + '</p>';
    }
  }

  /* ============ Extrato da solicitação (read-only) ============ */

  // Resumo (read-only) de um pedido: quem, datas, transporte e valores.
  // Extrato de EVENTOS e VEÍCULOS: sem datas de viagem/base de cálculo — só
  // quem, valores informados (com a justificativa dos outros gastos) e o total.
  function renderResumoSimples(p, t) {
    function linha(rot, val) { return '<div class="apr-linha"><span>' + rot + '</span><strong>' + val + '</strong></div>'; }
    var cat = p.solicitante_tipo === 'freelancer' ? 'Freelancer' : (p.solicitante_tipo === 'clt' ? 'CLT' : '—');
    var itens = t === 'complemento'
      ? [['➕ Complemento de combustível (km a mais)', p.valor_outros]]
      : t === 'evento'
      ? [['🔊 Diárias do evento' + (p.dias_servico != null ? ' (' + p.dias_servico + ' dia(s))' : ''), p.valor_mao_obra]]
      : [
          ['⛽ Abastecimento', p.valor_combustivel],
          ['🔩 Compra de peças', p.valor_pecas],
          ['🛠️ Manutenção', p.valor_manutencao],
          ['🛣️ Pedágio', p.valor_pedagio]
        ];
    if (t !== 'complemento') itens.push(['💠 Outros gastos', p.valor_outros]);
    var valores = itens.filter(function (l) { return Number(l[1]) > 0; })
      // No complemento, a justificativa vem logo abaixo do valor — sem a linha
      // divisória (border-bottom) da linha de valor.
      .map(function (l) {
        return t === 'complemento'
          ? '<div class="apr-linha" style="border-bottom:none;"><span>' + l[0] + '</span><strong>' + moedaBR(l[1]) + '</strong></div>'
          : linha(l[0], moedaBR(l[1]));
      }).join('');
    // Complemento: quilometragem inicial, final e percorrida.
    var kmLinha = '';
    if (t === 'complemento') {
      if (p.km_atual != null && p.km_atual !== '') kmLinha += linha('Quilometragem inicial', p.km_atual + ' km');
      if (p.km_final != null && p.km_final !== '') kmLinha += linha('Quilometragem final', p.km_final + ' km');
      if (p.km_atual != null && p.km_final != null && p.km_atual !== '' && p.km_final !== '') {
        kmLinha += linha('Quilometragem percorrida', (Math.round((Number(p.km_final) - Number(p.km_atual)) * 100) / 100) + ' km');
      }
    }
    var rotJust = t === 'complemento' ? 'Cálculo do complemento' : '💠 Outros gastos';
    var just = Number(p.valor_outros) > 0 && p.outros_justificativa
      ? '<p class="texto-apoio">' + rotJust + ': ' + p.outros_justificativa + '</p>' : '';
    return (
      // (o banner azul do tipo foi removido a pedido — o extrato começa em "Quem")
      '<p class="dg-secao">Quem</p><div class="rb-resumo-auto">' +
        linha('Solicitante', p.solicitante || '—') + linha('Designado', (p.designado || '—') + ' · ' + cat) +
        kmLinha +
      '</div>' +
      '<p class="dg-secao">Valores</p>' + (valores || '<p class="texto-apoio">—</p>') + just +
      '<div class="apr-linha" style="border-top:2px solid var(--cinza-borda);border-bottom:none;">' +
        '<span><strong>TOTAL</strong></span><strong>' + moedaBR(p.valor_total != null ? p.valor_total : (p.valorTotal || 0)) + '</strong></div>'
    );
  }

  // Reaproveitado pelo extrato e pela tela de saldo pendente.
  function renderResumoPedido(p) {
    var t = p.tipo || 'viagem';
    if (t === 'evento' || t === 'veiculo' || t === 'complemento') return renderResumoSimples(p, t);
    var tipo = p.solicitante_tipo === 'freelancer' ? 'Freelancer' : (p.solicitante_tipo === 'clt' ? 'CLT' : '—');
    var comb = p.tipo_combustivel ? (p.tipo_combustivel === 'diesel' ? 'Diesel' : 'Gasolina') : null;
    var trajeto = (p.origem_cidade || p.destino_cidade)
      ? ((p.origem_cidade || '?') + (p.origem_uf ? '/' + p.origem_uf : '') + ' → ' + (p.destino_cidade || '?') + (p.destino_uf ? '/' + p.destino_uf : ''))
      : (p.origemCidade ? (p.origemCidade + '/' + (p.origemUf || '') + ' → ' + (p.destinoCidade || '') + '/' + (p.destinoUf || '')) : '—');
    var alimentacao = Number(p.valor_almoco || 0) + Number(p.valor_jantar || 0) + Number(p.valor_lanche || 0);
    function linha(rot, val) { return '<div class="apr-linha"><span>' + rot + '</span><strong>' + val + '</strong></div>'; }
    var valores = [
      ['⛽ Transporte (combustível)', p.valor_combustivel],
      ['🚗 Aluguel de veículo', p.valor_aluguel],
      ['🛣️ Pedágio', p.valor_pedagio],
      ['🏨 Hospedagem', p.valor_hospedagem],
      ['👷 Mão de obra', p.valor_mao_obra],
      ['🍽️ Alimentação', alimentacao],
      ['💠 Outros gastos', p.valor_outros]
    ].filter(function (l) { return Number(l[1]) > 0; })
     .map(function (l) { return linha(l[0], moedaBR(l[1])); }).join('');
    if (Number(p.valor_outros) > 0 && p.outros_justificativa) {
      valores += '<p class="texto-apoio">💠 Outros gastos: ' + p.outros_justificativa + '</p>';
    }
    return (
      '<p class="dg-secao">Quem</p><div class="rb-resumo-auto">' +
        linha('Solicitante', p.solicitante || '—') + linha('Designado', (p.designado || '—') + ' · ' + tipo) +
      '</div>' +
      '<p class="dg-secao">Datas da viagem</p><div class="rb-resumo-auto">' +
        linha('Ida', dataBR(p.data_inicio)) + linha('Início do serviço', dataBR(p.servico_inicio)) +
        linha('Término do serviço', dataBR(p.servico_fim)) + linha('Chegada', dataBR(p.data_retorno || p.dataRetorno)) +
        linha('Dias de serviço', p.dias_servico != null ? p.dias_servico : '—') +
        linha('Dias de deslocamento', p.dias_deslocamento != null ? p.dias_deslocamento : '—') +
      '</div>' +
      baseCalculoHtml(p) +
      '<p class="dg-secao">Valores</p>' + (valores || '<p class="texto-apoio">—</p>') +
      '<div class="apr-linha" style="border-top:2px solid var(--cinza-borda);border-bottom:none;">' +
        '<span><strong>TOTAL</strong></span><strong>' + moedaBR(p.valor_total != null ? p.valor_total : (p.valorTotal || 0)) + '</strong></div>'
    );
  }

  // Base de cálculo (igual à da Logística): mesmo layout azul das seções Quem/
  // Datas/Transporte — pares rótulo/valor no rb-resumo-auto.
  function baseCalculoHtml(p) {
    function linha(rot, val) { return '<div class="apr-linha"><span>' + rot + '</span><strong>' + val + '</strong></div>'; }
    var vu = p.valores_usados || {};
    var ehFreela = p.solicitante_tipo === 'freelancer';
    var comb = p.tipo_combustivel ? (p.tipo_combustivel === 'diesel' ? 'Diesel' : 'Gasolina') : null;
    var distKm = Number(p.distancia_km) || 0;
    var diasServ = Number(p.dias_servico) || 0;
    var kmServico = 5 * diasServ;
    var trajeto = (p.origem_cidade || p.destino_cidade)
      ? ((p.origem_cidade || '?') + (p.origem_uf ? '/' + p.origem_uf : '') + ' → ' + (p.destino_cidade || '?') + (p.destino_uf ? '/' + p.destino_uf : ''))
      : '—';
    var itens = [];
    itens.push(['Veículo', p.veiculo === 'proprio' ? 'Próprio' : (p.veiculo === 'engear' ? 'ENGEAR' : '—')]);
    if (p.km_atual != null && p.km_atual !== '') itens.push(['Quilometragem atual do carro', p.km_atual + ' km']);
    itens.push(['Origem → Destino', trajeto]);
    itens.push(['Distância (ida e volta)', distKm ? distKm + ' km' : '—']);
    itens.push(['Dias', (p.dias_servico != null ? p.dias_servico + ' serviço' : '—') +
      (p.dias_deslocamento != null ? ' · ' + p.dias_deslocamento + ' deslocamento' : '')]);
    if (distKm) itens.push(['Combustível (km)', distKm + ' km' +
      (kmServico ? ' + 5×' + diasServ + ' = ' + (distKm + kmServico) + ' km' : '')]);
    if (p.consumo_kml || p.preco_litro) itens.push(['Consumo', (p.consumo_kml ? p.consumo_kml + ' km/L' : '—') +
      (comb ? ' · ' + comb : '') + (p.preco_litro ? ' ' + moedaBR(p.preco_litro) + '/L' : '')]);
    var diasMO = Number(p.dias_viagem) || 0;
    if (Number(p.valor_mao_obra) > 0 && diasMO > 0) itens.push(['Mão de obra', moedaBR(Math.round(Number(p.valor_mao_obra) / diasMO * 100) / 100) + '/dia']);
    if (Number(p.valor_hospedagem) > 0 && vu.hospedagem_dia != null) itens.push(['Hospedagem', moedaBR(vu.hospedagem_dia) + '/diária']);
    if (Number(p.valor_almoco) > 0 && vu.almoco != null) itens.push(['Almoço', ehFreela ? moedaBR(vu.almoco) + '/dia'
      : moedaBR(vu.almoco_clt_util) + ' útil · ' + moedaBR(vu.almoco) + ' fds']);
    if (Number(p.valor_jantar) > 0 && vu.jantar != null) itens.push(['Jantar', moedaBR(vu.jantar) + '/dia']);
    if (Number(p.valor_lanche) > 0 && vu.lanche != null) itens.push(['Lanche', moedaBR(vu.lanche) + '/dia desloc.']);
    return '<p class="dg-secao">Base de cálculo</p><div class="rb-resumo-auto">' +
      itens.map(function (i) { return linha(i[0], i[1]); }).join('') + '</div>';
  }

  function abrirExtrato(p, aguardandoEnvio, soLeitura) {
    EC.app.mostrarTela('tela-reembolso-extrato');
    window.scrollTo(0, 0);
    // De onde veio (para o botão Voltar): extrato geral (gestor) ou minhas solicitações.
    extratoOrigem = soLeitura ? 'tela-extrato-geral' : 'tela-reembolso';
    var total = p.valor_total != null ? p.valor_total : p.valorTotal;
    var pct = p.percentual_solicitado != null ? Number(p.percentual_solicitado) : (p.percentual || 100);
    var solicitado = p.valor_solicitado != null ? p.valor_solicitado : p.valorSolicitado;
    if (solicitado == null) solicitado = Math.round(Number(total || 0) * pct) / 100;
    var st = aguardandoEnvio
      ? { txt: '📴 Aguardando envio', cls: 'rb-aguardando' }
      : (STATUS[p.status] || { txt: p.status, cls: 'rb-aguardando' });
    var obs = (p.status === 'rejeitado' || p.status === 'correcao') && p.observacao_logistica
      ? '<div class="rb-motivo">Observação da Logística: ' + p.observacao_logistica + '</div>' : '';
    var pago = p.status === 'pago'
      ? '<div class="apr-orc apr-orc-verde"><strong>💰 Pago</strong> em ' + dataBR(p.pago_em) + (p.forma_pagamento ? ' · ' + p.forma_pagamento : '') + (p.banco_saida ? ' · ' + p.banco_saida : '') + '</div>' : '';

    var adiant = Number(p.adiantamento_valor || p.adiantamentoValor || 0);
    var adiantData = p.adiantamento_data || p.adiantamentoData || null;
    var aPagar = Math.round((Number(total || 0) - adiant) * 100) / 100;

    // Solicitações de reembolso (parcelas) desta OS+campanha+designado.
    // Eventos/veículos são pagamento único: não se misturam com as parcelas da viagem.
    var parcelas = (p.tipo || 'viagem') !== 'viagem' ? [p] : listaEmCache().filter(function (x) {
      return String(x.os) === String(p.os) &&
        (x.tipo || 'viagem') === 'viagem' &&
        Number(x.campanha_numero) === Number(p.campanha_numero) &&
        (x.designado || '') === (p.designado || '') &&
        ['aguardando_logistica', 'aguardando_pagamento', 'pago'].indexOf(x.status) !== -1;
    }).sort(function (a, b) { return String(a.created_at || a.criadoEm || '').localeCompare(String(b.created_at || b.criadoEm || '')); });
    if (!parcelas.length) parcelas = [p];
    var parcelasHtml = parcelas.map(function (x, i) {
      var xpct = x.percentual_solicitado != null ? Number(x.percentual_solicitado) : 100;
      var xsol = x.valor_solicitado != null ? x.valor_solicitado : Math.round(Number(x.valor_total || 0) * xpct) / 100;
      // Líquido = parcela − a fração do adiantamento que cabe a ela (adiant × %).
      var xadiant = Number(x.adiantamento_valor) || 0;
      var xliq = Math.round(Number(xsol) * 100 - xadiant * xpct) / 100;
      var xnota = xadiant > 0
        ? '<br><span class="rotulo-apoio">' + moedaBR(xsol) + ' − ' + moedaBR(Math.round(xadiant * xpct) / 100) + ' (parte do adiantamento)</span>'
        : '';
      var quando = x.created_at || x.criadoEm;
      var xdata = quando ? dataBR(quando) : '—';
      var pagoP = x.status === 'pago';
      var xstatus = pagoP
        ? '<br>💰 pago em ' + (x.pago_em ? dataBR(x.pago_em) : '—')
        : (STATUS[x.status] ? '<br><span class="rotulo-apoio">' + STATUS[x.status].txt + '</span>' : '');
      return '<div class="apr-orc ' + (pagoP ? 'apr-orc-verde' : 'apr-orc-cinza') + '" style="margin:6px 0;">' +
        '<strong>' + (i + 1) + 'ª parcela:</strong> ' + xpct + '% em ' + xdata + ' = <strong>' + moedaBR(xliq) + '</strong>' + xnota + xstatus + '</div>';
    }).join('');

    $('rb-extrato').innerHTML =
      '<div class="rb-pedido-topo" style="margin-bottom:10px;"><span class="os-numero">OS ' + (p.os || '?') + '</span>' +
      '<span class="rb-status ' + st.cls + '">' + st.txt + '</span></div>' +
      (p.cliente ? '<div class="os-resumo" style="margin-bottom:4px;">' + p.cliente + '</div>' : '') +
      (p.projeto ? '<div class="os-resumo" style="margin-bottom:8px;">📁 ' + p.projeto + '</div>' : '') +
      obs +
      '<p class="dg-secao">Valores da logística</p>' +
      '<div class="rb-resumo-auto">' +
        '<div class="apr-linha"><span>Valor total</span><strong>' + moedaBR(total) + '</strong></div>' +
        '<div class="apr-linha"><span>Adiantamento</span><strong>' + (adiant > 0 ? moedaBR(adiant) + (adiantData ? ' · feito em ' + dataBR(adiantData) : '') : '—') + '</strong></div>' +
        '<div class="apr-linha" style="grid-column:1/-1;"><span>À receber</span><strong style="font-size:1.4rem;">' + moedaBR(aPagar) + '</strong></div>' +
      '</div>' +
      '<p class="dg-secao">Solicitações de reembolso</p>' +
      (parcelasHtml || '<div class="apr-orc apr-orc-cinza">—</div>') +
      renderResumoPedido(p);

    // Comprovantes: das parcelas pagas e, abaixo, do adiantamento (mesma seção,
    // sem título próprio para o adiantamento — os botões já se identificam).
    var pagas = parcelas.map(function (x, i) { return { x: x, n: i + 1 }; })
      .filter(function (o) { return o.x.status === 'pago' && o.x.id; });
    var temAdiant = adiant > 0 && p.id;
    // Reembolso de VEÍCULOS: pode anexar/ver a evidência da solicitação a
    // qualquer momento (inclusive depois de pago) — bloco 'solicitacao'.
    var ehVeiculo = (p.tipo === 'veiculo') && !!p.id;
    if (pagas.length || temAdiant || ehVeiculo) {
      var secComp = document.createElement('div');
      secComp.innerHTML = '<p class="dg-secao">Comprovantes</p>';
      $('rb-extrato').appendChild(secComp);
      pagas.forEach(function (o) {
        var bComp = document.createElement('button');
        bComp.type = 'button'; bComp.className = 'botao botao-secundario';
        bComp.style.marginBottom = '8px'; bComp.style.display = 'block';
        bComp.textContent = '📄 Comprovante da ' + o.n + 'ª parcela';
        bComp.addEventListener('click', function () { verComprovante(o.x.id, bComp, o.n); });
        secComp.appendChild(bComp);
      });
      if (temAdiant) {
        var bVerAdi = document.createElement('button');
        bVerAdi.type = 'button'; bVerAdi.className = 'botao botao-secundario';
        bVerAdi.style.marginBottom = '8px'; bVerAdi.style.display = 'block';
        bVerAdi.textContent = '📄 Comprovante do adiantamento';
        bVerAdi.addEventListener('click', function () { verComprovante(p.id, bVerAdi, null, 'adiantamento'); });
        secComp.appendChild(bVerAdi);
        if (ehGestor()) {
          var bAddAdi = document.createElement('button');
          bAddAdi.type = 'button'; bAddAdi.className = 'botao botao-secundario';
          bAddAdi.style.display = 'block'; bAddAdi.style.marginTop = '16px'; bAddAdi.style.marginBottom = '6px';
          bAddAdi.textContent = '➕ Anexar comprovante do adiantamento';
          bAddAdi.addEventListener('click', function () { anexarComprovanteAdiantamento(p, bAddAdi); });
          secComp.appendChild(bAddAdi);
          var bDelAdi = document.createElement('button');
          bDelAdi.type = 'button';
          bDelAdi.style.cssText = 'display:inline-block;background:none;border:none;color:var(--vermelho);font-size:0.82rem;text-decoration:underline;padding:2px 0;cursor:pointer;';
          bDelAdi.textContent = '🗑️ apagar comprovante do adiantamento';
          bDelAdi.addEventListener('click', function () { apagarComprovantesAdiantamento(p); });
          secComp.appendChild(bDelAdi);
        }
      }
      if (ehVeiculo) {
        // O botão "ver" só aparece se JÁ houver evidência anexada (confere no
        // servidor). Fica oculto até a confirmação; some quando não há nenhuma.
        var bVerSol = document.createElement('button');
        bVerSol.type = 'button'; bVerSol.className = 'botao botao-secundario';
        bVerSol.style.marginBottom = '8px'; bVerSol.style.display = 'none';
        bVerSol.textContent = '📄 Comprovante da solicitação';
        bVerSol.addEventListener('click', function () { verComprovante(p.id, bVerSol, null, 'solicitacao'); });
        secComp.appendChild(bVerSol);
        temComprovanteSolicitacao(p.id).then(function (tem) { if (tem) bVerSol.style.display = 'block'; });
        // O próprio designado (extrato dele) ou o gestor pode anexar — vários.
        if (!soLeitura || ehGestor()) {
          var bAddSol = document.createElement('button');
          bAddSol.type = 'button'; bAddSol.className = 'botao botao-secundario';
          bAddSol.style.display = 'block'; bAddSol.style.marginTop = '6px';
          bAddSol.textContent = '➕ Anexar comprovante da solicitação';
          bAddSol.addEventListener('click', function () { anexarComprovanteSolicitacao(p, bVerSol); });
          secComp.appendChild(bAddSol);
        }
      }
    }

    // Ações só enquanto dá para mexer: apagar (fila do aparelho ou aguardando a
    // Logística) e editar (só as já enviadas que aguardam a Logística).
    // No extrato geral (só leitura) o gestor não edita/apaga solicitação de outro.
    var podeApagar = !soLeitura && (aguardandoEnvio || p.status === 'aguardando_logistica');
    var podeEditar = !soLeitura && !aguardandoEnvio && p.status === 'aguardando_logistica';
    if (podeApagar || podeEditar) {
      var acoes = document.createElement('div');
      acoes.className = 'rb-extrato-acoes';
      acoes.innerHTML =
        (podeEditar ? '<button type="button" class="botao botao-secundario" id="rb-extrato-editar">✏️ Editar</button>' : '') +
        (podeApagar ? '<button type="button" class="botao botao-perigo" id="rb-extrato-apagar">🗑️ Apagar solicitação</button>' : '');
      $('rb-extrato').appendChild(acoes);
      if (podeEditar) $('rb-extrato-editar').addEventListener('click', function () { abrirEdicao(p); });
      if (podeApagar) $('rb-extrato-apagar').addEventListener('click', function () { apagarSolicitacao(p, aguardandoEnvio); });
    }
  }

  // Abre o(s) comprovante(s) de pagamento (URLs assinadas vindas da API) num
  // overlay: imagem inline; PDF vira link "Abrir".
  async function verComprovante(id, botao, parcelaN, bloco) {
    var txt = botao.textContent;
    botao.disabled = true; botao.textContent = '⏳ Abrindo…';
    try {
      var r = await getJson(BASE + '/comprovante?id=' + encodeURIComponent(id) + (bloco ? '&bloco=' + bloco : ''));
      if (!r || !r.ok || !r.comprovantes || !r.comprovantes.length) {
        EC.app.mostrarToast('Comprovante não encontrado.');
        return;
      }
      var html = r.comprovantes.map(function (c) {
        var isPdf = /\.pdf$/i.test(c.nome || '') || c.mime === 'application/pdf';
        return isPdf
          ? '<p style="margin:8px 0;"><a class="botao botao-secundario" href="' + c.url + '" target="_blank" rel="noopener">📄 Abrir ' + (c.nome || 'comprovante') + '</a></p>'
          : '<img src="' + c.url + '" alt="comprovante" style="max-width:100%;border-radius:8px;margin-bottom:8px;">';
      }).join('');
      var titulo = bloco === 'adiantamento' ? '📄 Comprovante do adiantamento'
        : bloco === 'solicitacao' ? '📄 Comprovante da solicitação'
        : '📄 Comprovante' + (parcelaN ? ' da ' + parcelaN + 'ª parcela' : ' de pagamento');
      EC.app.abrirOverlay(titulo, html);
    } catch (e) {
      EC.app.mostrarToast('Não consegui abrir o comprovante.');
    } finally {
      botao.disabled = false; botao.textContent = txt;
    }
  }

  var MAX_ADIANT = 10; // comprovantes de adiantamento por solicitação

  // Gestor (Financeiro/Logística) anexa comprovante(s) do adiantamento (até 10)
  // na solicitação — via cliente Supabase, respeitando as permissões.
  function anexarComprovanteAdiantamento(p, botao) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', async function () {
      var files = input.files ? Array.prototype.slice.call(input.files) : [];
      if (!files.length) return;
      var cli = (EC.auth && EC.auth.cliente) ? EC.auth.cliente() : null;
      if (!cli) { EC.app.mostrarToast('Sem conexão — abra com internet.'); return; }
      var txt = botao.textContent;
      botao.disabled = true; botao.textContent = '⏳ Enviando…';
      try {
        // quantos já existem — o total não pode passar de 10
        var cnt = await cli.from('logistica_anexos').select('id', { count: 'exact', head: true })
          .eq('solicitacao_id', p.id).eq('bloco', 'adiantamento');
        var jaTem = cnt.count || 0;
        var vagas = MAX_ADIANT - jaTem;
        if (vagas <= 0) { EC.app.mostrarToast('Limite de ' + MAX_ADIANT + ' comprovantes de adiantamento atingido.'); return; }
        var aEnviar = files.slice(0, vagas);
        var enviados = 0;
        for (var i = 0; i < aEnviar.length; i++) {
          var file = aEnviar[i];
          var nome = (file.name || ('adiantamento_' + new Date().getTime() + '_' + i + '.jpg')).replace(/[^\w.\-()À-ſ ]+/g, '_');
          var caminho = p.os + '/' + p.codigo + '/adiantamento/' + new Date().getTime() + '_' + i + '_' + nome;
          var up = await cli.storage.from('logistica').upload(caminho, file, { contentType: file.type || 'application/octet-stream', upsert: true });
          if (up.error) throw up.error;
          var ins = await cli.from('logistica_anexos').insert({ solicitacao_id: p.id, bloco: 'adiantamento', arquivo: nome, url: caminho, mime: file.type || null });
          if (ins.error) throw ins.error;
          enviados++;
        }
        var sobraram = files.length - aEnviar.length;
        EC.app.mostrarToast('✅ ' + enviados + ' comprovante(s) anexado(s)' + (sobraram > 0 ? ' — ' + sobraram + ' ignorado(s) (limite ' + MAX_ADIANT + ')' : '') + '.');
      } catch (e) {
        EC.app.mostrarToast('Não consegui anexar: ' + (e.message || 'erro'));
      } finally {
        botao.disabled = false; botao.textContent = txt;
      }
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(function () { input.remove(); }, 120000);
  }

  // Anexar EVIDÊNCIA da solicitação (bloco 'solicitacao') — reembolso de VEÍCULOS,
  // disponível a qualquer momento (inclusive depois de pago). Permite VÁRIOS
  // anexos (câmera/galeria/PDF, via o mesmo componente do formulário). Sobe pelo
  // SERVIDOR (/anexo, token) — funciona para o técnico e para o gestor. Precisa
  // de internet.
  // Há alguma evidência anexada à solicitação? (bloco 'solicitacao', via servidor.)
  async function temComprovanteSolicitacao(id) {
    if (!id) return false;
    try {
      var r = await getJson(BASE + '/comprovante?id=' + encodeURIComponent(id) + '&bloco=solicitacao');
      return !!(r && r.ok && r.comprovantes && r.comprovantes.length);
    } catch (e) { return false; }
  }

  function anexarComprovanteSolicitacao(p, botaoVer) {
    EC.app.abrirOverlay('➕ Comprovante da solicitação',
      '<p class="texto-apoio">Anexe as evidências da solicitação (fotos ou PDF). Pode adicionar mais de uma.</p>' +
      '<div id="cs-anexos"></div>' +
      '<div id="cs-status" class="texto-apoio" style="min-height:18px;"></div>' +
      '<button type="button" class="botao botao-primario" id="cs-enviar" style="margin-top:8px;">Enviar comprovante(s) ✓</button>');
    var comp = criarAnexos($('cs-anexos'), {});
    var btn = $('cs-enviar');
    btn.addEventListener('click', async function () {
      var itens = comp.obter();
      if (!itens.length) { $('cs-status').textContent = '⚠️ Adicione ao menos uma evidência.'; return; }
      btn.disabled = true; btn.textContent = '⏳ Enviando…';
      $('cs-status').textContent = '';
      try {
        for (var i = 0; i < itens.length; i++) {
          var a = itens[i];
          await postJson(BASE + '/anexo', { solicitacao_id: p.id, bloco: 'solicitacao', nomeArquivo: a.nomeArquivo, base64: a.base64, mime: a.mime });
        }
        EC.app.mostrarToast('✅ ' + itens.length + ' comprovante(s) da solicitação anexado(s).');
        if (botaoVer) botaoVer.style.display = 'block'; // agora há o que ver
        if (EC.app.fecharOverlay) EC.app.fecharOverlay();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Enviar comprovante(s) ✓';
        $('cs-status').textContent = '🛑 Não consegui enviar: ' + (e.message || 'sem internet');
      }
    });
  }

  // Gestor apaga comprovante(s) do adiantamento (caso suba errado). Abre um
  // overlay com cada anexo e um botão de apagar individual.
  async function apagarComprovantesAdiantamento(p) {
    var cli = (EC.auth && EC.auth.cliente) ? EC.auth.cliente() : null;
    if (!cli) { EC.app.mostrarToast('Sem conexão — abra com internet.'); return; }
    EC.app.abrirOverlay('🗑️ Comprovantes do adiantamento', '<p class="texto-apoio">Carregando…</p>');
    await pintarApagarAdiant(cli, p);
  }
  async function pintarApagarAdiant(cli, p) {
    var alvo = $('overlay-conteudo');
    if (!alvo) return;
    try {
      var q = await cli.from('logistica_anexos').select('id, arquivo, url, mime')
        .eq('solicitacao_id', p.id).eq('bloco', 'adiantamento').order('created_at', { ascending: true });
      var rows = q.data || [];
      if (!rows.length) { alvo.innerHTML = '<p class="texto-apoio">Nenhum comprovante de adiantamento anexado.</p>'; return; }
      var partes = [];
      for (var i = 0; i < rows.length; i++) {
        var a = rows[i];
        var sg = await cli.storage.from('logistica').createSignedUrl(a.url, 3600);
        var url = sg.data && sg.data.signedUrl;
        var isPdf = /\.pdf$/i.test(a.arquivo || '') || a.mime === 'application/pdf';
        var vis = url
          ? (isPdf
              ? '<a class="botao botao-secundario" href="' + url + '" target="_blank" rel="noopener">📄 Abrir ' + (a.arquivo || '') + '</a>'
              : '<img src="' + url + '" alt="comprovante" style="max-width:100%;border-radius:8px;">')
          : (a.arquivo || '');
        partes.push('<div style="border:1px solid var(--cinza-borda);border-radius:8px;padding:8px;margin-bottom:10px;">' + vis +
          '<button type="button" class="botao botao-perigo apagar-adiant" data-id="' + a.id + '" data-url="' + a.url + '" style="margin-top:6px;">🗑️ Apagar este</button></div>');
      }
      alvo.innerHTML = partes.join('');
      alvo.querySelectorAll('.apagar-adiant').forEach(function (b) {
        b.addEventListener('click', async function () {
          b.disabled = true; b.textContent = '⏳ Apagando…';
          try {
            await cli.storage.from('logistica').remove([b.dataset.url]);
            var del = await cli.from('logistica_anexos').delete().eq('id', b.dataset.id);
            if (del.error) throw del.error;
            await pintarApagarAdiant(cli, p);
          } catch (e) { EC.app.mostrarToast('Não consegui apagar: ' + (e.message || 'erro')); b.disabled = false; b.textContent = '🗑️ Apagar este'; }
        });
      });
    } catch (e) {
      alvo.innerHTML = '<p class="texto-apoio">Erro ao carregar: ' + (e.message || '') + '</p>';
    }
  }

  /* ============ Serviços com saldo pendente ============ */

  var saldoAtual = null; // { os, campanha, cliente, template, jaConsumido, disponivel }

  // Campanhas do usuário que já têm parcela APROVADA e ainda têm % a solicitar.
  function saldosDisponiveis() {
    var grupos = {};
    listaEmCache().forEach(function (p) {
      if ((p.tipo || 'viagem') !== 'viagem') return; // saldo só existe na viagem
      // saldo é por OS+campanha+DESIGNADO (cada técnico tem seu próprio 100%)
      var chave = p.os + '|' + p.campanha_numero + '|' + (p.designado || '');
      if (!grupos[chave]) grupos[chave] = { os: p.os, campanha: p.campanha_numero, cliente: p.cliente, jaConsumido: Number(p.jaConsumido || 0), aprovada: null };
      grupos[chave].jaConsumido = Math.max(grupos[chave].jaConsumido, Number(p.jaConsumido || 0));
      // template = parcela já aprovada mais recente (a lista vem por created_at desc)
      if (!grupos[chave].aprovada && (p.status === 'aguardando_pagamento' || p.status === 'pago')) grupos[chave].aprovada = p;
    });
    var out = [];
    Object.keys(grupos).forEach(function (k) {
      var g = grupos[k];
      var disp = Math.round((100 - g.jaConsumido) * 100) / 100;
      if (g.aprovada && disp > 0) out.push({ os: g.os, campanha: g.campanha, cliente: g.cliente, template: g.aprovada, jaConsumido: g.jaConsumido, disponivel: disp });
    });
    return out;
  }

  function atualizarSaldoBtn() {
    var btn = $('rb-saldo-btn');
    if (!btn) return;
    var n = saldosDisponiveis().length;
    btn.classList.toggle('oculto', n === 0);
    $('rb-saldo-badge').textContent = n > 0 ? '(' + n + ')' : '';
  }

  function pintarSaldoLista() {
    var area = $('rb-saldo-lista');
    var lista = saldosDisponiveis();
    if (!lista.length) { area.innerHTML = '<p class="texto-apoio">Nenhum serviço com saldo pendente. 🎉</p>'; return; }
    area.innerHTML = lista.map(function (s) {
      return '<button type="button" class="rb-pedido rb-pedido-click" data-chave="' + s.os + '|' + s.campanha + '">' +
        '<div class="rb-pedido-topo"><span class="os-numero">OS ' + s.os + '</span>' +
        '<span class="rb-status rb-pendente">faltam ' + s.disponivel + '%</span></div>' +
        (s.cliente ? '<div class="os-resumo">' + s.cliente + '</div>' : '') +
        '<div class="os-resumo">Total da logística: ' + moedaBR(s.template.valor_total) + ' · já solicitado ' + s.jaConsumido + '%</div>' +
        '<div class="rb-ver-extrato">💠 Solicitar saldo ›</div>' +
        '</button>';
    }).join('');
    area.querySelectorAll('.rb-pedido-click[data-chave]').forEach(function (el) {
      el.addEventListener('click', function () {
        var s = lista.filter(function (x) { return (x.os + '|' + x.campanha) === el.dataset.chave; })[0];
        if (s) abrirSaldoDetalhe(s);
      });
    });
  }

  function abrirSaldos() {
    EC.app.mostrarTela('tela-saldo-pendente');
    pintarSaldoLista();
  }

  function saldoErro(msg) {
    var e = $('rb-saldo-erro');
    if (!msg) { e.classList.add('oculto'); return; }
    e.textContent = '🛑 ' + msg; e.classList.remove('oculto');
  }

  function pintarSaldoValor() {
    if (!saldoAtual) return;
    var pct = parseFloat($('rb-saldo-pct').value) || 0;
    var v = Math.round(Number(saldoAtual.template.valor_total || 0) * pct) / 100;
    $('rb-saldo-valor').innerHTML = 'Vai solicitar <strong>' + pct + '% = ' + moedaBR(v) + '</strong>';
  }

  function abrirSaldoDetalhe(s) {
    saldoAtual = s;
    EC.app.mostrarTela('tela-saldo-detalhe');
    window.scrollTo(0, 0);
    saldoErro(null);
    $('rb-saldo-det').innerHTML = renderResumoPedido(s.template);
    $('rb-saldo-info').textContent = 'ℹ️ Já solicitado nesta campanha: ' + s.jaConsumido + '%. Disponível: ' + s.disponivel + '%.';
    var inp = $('rb-saldo-pct');
    inp.max = s.disponivel;
    inp.value = s.disponivel;
    pintarSaldoValor();
  }

  async function enviarSaldo() {
    var s = saldoAtual;
    if (!s) return;
    var pct = parseFloat($('rb-saldo-pct').value);
    if (!(pct > 0)) return saldoErro('Informe o percentual a solicitar.');
    if (pct > s.disponivel + 0.01) return saldoErro('Você pode solicitar no máximo ' + s.disponivel + '% (o resto já foi solicitado/pago).');
    saldoErro(null);
    var pedido = {
      _saldo: true,
      codigo: 'LG_SALDO_' + s.os + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      origemCodigo: s.template.codigo,
      percentualSolicitado: pct,
      os: s.os, cliente: s.cliente,
      valorTotal: s.template.valor_total, percentual: pct,
      valorSolicitado: Math.round(Number(s.template.valor_total || 0) * pct) / 100,
      dataRetorno: s.template.data_retorno, designado: s.template.designado
    };
    var botao = $('rb-saldo-enviar');
    botao.disabled = true; botao.textContent = '⏳ Enviando…';
    try {
      await enviarPedido(pedido);
      toast('✅ Saldo solicitado! Foi para a aprovação da Logística.');
      atualizarListaDoServidor();
    } catch (e) {
      if (e.rejeitado) { botao.disabled = false; botao.textContent = '💰 Solicitar saldo'; return saldoErro(e.message); }
      try { await EC.db.set(LOJA_PENDENTES, pedido.codigo, pedido); } catch (e2) { /* ok */ }
      toast('📴 Sem conexão. Pedido de saldo guardado — será enviado quando a internet voltar.');
    }
    botao.disabled = false; botao.textContent = '💰 Solicitar saldo';
    EC.app.mostrarTela('tela-reembolso');
    pintarLista(); atualizarSaldoBtn();
  }

  // "Preciso alterar algo" → abre a solicitação NORMAL já com a OS/campanha
  // escolhida (editável, passa pela aprovação da Logística).
  async function alterarSaldo() {
    var s = saldoAtual;
    if (!s) return;
    await abrirNovo(true);
    if (!ctx) return;
    var o = (ctx.os || []).filter(function (x) { return x.numero === s.os; })[0];
    if (!o) { toast('Abra pela "Nova solicitação" e busque a OS.'); return; }
    escolherOs(o);
    if ((o.campanhas || []).length > 1) { $('rb-campanha').value = s.campanha; aoEscolherCampanha(); }
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
    $('rb-extrato-voltar').addEventListener('click', function () { EC.app.mostrarTela(extratoOrigem || 'tela-reembolso'); });
    // Extrato geral: voltar da tela geral vai para a home (aberto pela home).
    var egV = $('eg-voltar');
    if (egV) egV.addEventListener('click', function () { EC.app.mostrarTela('tela-acao'); });
    $('rb-saldo-btn').addEventListener('click', abrirSaldos);
    $('rb-saldo-voltar').addEventListener('click', function () { EC.app.mostrarTela('tela-reembolso'); });
    $('rb-saldo-det-voltar').addEventListener('click', abrirSaldos);
    $('rb-saldo-enviar').addEventListener('click', enviarSaldo);
    $('rb-saldo-alterar').addEventListener('click', alterarSaldo);
    $('rb-saldo-pct').addEventListener('input', pintarSaldoValor);
    $('rb-cancelar').addEventListener('click', function () { marcarModoEdicao(false); EC.app.mostrarTela('tela-reembolso'); pintarLista(); });
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
      atualizarDisponivel();
      pintarResumoAuto();
      atualizarBotaoComplemento();
      atualizarTipoUI();
      pintarValores();
    });
    document.querySelectorAll('input[name="rb-veiculo"]').forEach(function (r) {
      r.addEventListener('change', aoMudarVeiculo);
    });
    $('rb-combustivel').addEventListener('change', function () {
      // Preço por litro vem da config da Logística (o R$/litro configurado por
      // combustível). Auto-preenche ao escolher o tipo; segue editável.
      var t = tetoDoCombustivel();
      $('rb-preco-litro').value = ($('rb-combustivel').value && t > 0) ? String(t) : '';
      pintarTeto(); pintarValores();
    });
    $('rb-preco-litro').addEventListener('input', function () { pintarTeto(); pintarValores(); });
    $('rb-distancia').addEventListener('input', pintarValores);
    $('rb-origem-cidade').addEventListener('input', agendarCalculo);
    $('rb-destino-cidade').addEventListener('input', agendarCalculo);
    $('rb-origem-uf').addEventListener('change', calcularDistancia);
    $('rb-destino-uf').addEventListener('change', calcularDistancia);
    $('rb-pedagio').addEventListener('input', pintarValores);
    $('rb-percentual').addEventListener('input', pintarValores);
    // Tipo do reembolso (Viagem / Eventos / Veículos) + campos dos novos tipos
    document.querySelectorAll('.rb-tipo-btn').forEach(function (b) {
      b.addEventListener('click', function () { escolherTipo(b.dataset.tipo); salvarRascunhoLogo(); });
    });
    ['rb-evento-dias', 'rb-veic-abastecimento', 'rb-veic-pecas', 'rb-veic-manutencao', 'rb-outros-valor', 'rb-comp-kmfinal']
      .forEach(function (id) { $(id).addEventListener('input', pintarValores); });
    $('rb-chegada-casa').addEventListener('input', pintarValores);
    document.querySelectorAll('input[name="rb-adiant"]').forEach(function (r) { r.addEventListener('change', pintarValores); });
    $('rb-adiant-valor').addEventListener('input', pintarValores);
    // Datas da viagem editáveis: ao mudar, recalcula os dias e o resumo/valores.
    // O TÉRMINO também refaz o teto 50%/100% (libera 100% no último dia).
    ['rb-ida', 'rb-servico-inicio', 'rb-servico-fim', 'rb-volta'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        recalcularDias();
        if (id === 'rb-servico-fim') atualizarDisponivel();
        pintarResumoAuto(); pintarValores();
      });
    });

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

  return { abrir: abrir, extratoGeral: extratoGeral };
})();
