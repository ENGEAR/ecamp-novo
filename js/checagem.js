/**
 * checagem.js — Checagens intermediárias (restrito à logística).
 *
 * Calibração multiponto do AGV feita FORA de serviço, para avaliar o próprio
 * equipamento — mesmo fluxo do 6º passo do QAR (5 placas → curva a2/b2/r → Qr),
 * reaproveitando o motor de cálculo de campo-qar.js (EC.campoQar.calcular/svg/
 * diagnostico). O resultado é salvo direto no SGP (checagens_intermediarias) e
 * aparece na aba "Checagem intermediária" do equipamento.
 *
 * Decisões combinadas com a Raisa (2026-08-12):
 *   • fração (PTS/MP10/MP2,5) é um campo do formulário, pré-adivinhado pelo
 *     nome do AGV — decide a faixa do Qr;
 *   • salvar EXIGE internet (sem rascunho offline — atividade de base/lab);
 *   • menu visível só para logística/logistica_campo/admin (o servidor confere
 *     de novo, fail-closed).
 *
 * Interface (EC.checagem): abrirMenu(), abrirParticulados()
 */
window.EC = window.EC || {};

EC.checagem = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/monitoramento';
  var TOKEN = '1488d0e2eece92e0796951cb693a4689c95cad0193e91ad2';
  var CARTAS = ['18', '13', '10', '09', '08'];

  // Estado do formulário (só em memória — checagem exige internet p/ salvar).
  var dados = {};

  function $(id) { return document.getElementById(id); }
  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }

  function listaQar() {
    return (EC.equip && EC.equip.porVariante) ? (EC.equip.porVariante('qar') || []) : [];
  }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function vencido(e) { return !!(e.proximaCal && e.proximaCal < hojeISO()); }
  function porCategoria(regex) {
    return listaQar().filter(function (e) {
      return regex.test((e.categoria || '').toLowerCase()) && !vencido(e);
    });
  }

  // Fração pré-adivinhada pelo nome/código do AGV (editável no formulário).
  function adivinharFracao(codigo) {
    var n = String(codigo || '').toLowerCase().replace(/\s+/g, '');
    if (/pm2[.,]?5|mp2[.,]?5/.test(n)) return 'MP2,5';
    if (/pm10|mp10/.test(n)) return 'MP10';
    if (/pts/.test(n)) return 'PTS';
    return '';
  }

  function opcoes(itens) {
    return '<option value="">Selecione…</option>' + itens.map(function (e) {
      return '<option value="' + e.codigo + '">' + e.codigo + '</option>';
    }).join('');
  }
  function lblNum(rotulo, campo, passo) {
    return '<label>' + rotulo + '<input type="number" step="' + (passo || '0.01') + '" inputmode="decimal" data-chk="' + campo + '"></label>';
  }

  /* ===== Formulário ===== */

  function renderizar() {
    var area = $('checagem-form');
    if (!area) return;
    var sessao = (EC.storage && EC.storage.ler('sessao:atual')) || {};
    dados = { data: hojeISO(), tecnico: sessao.nome || '' };

    var kits = porCategoria(/kit|calibra/);
    var agvs = porCategoria(/amostrador|grande volume|agv/).filter(function (e) {
      return kits.map(function (k) { return k.codigo; }).indexOf(e.codigo) === -1;
    });
    var seps = porCategoria(/separador/);

    var html =
      '<p class="texto-apoio">Mesma calibração do campo (5 placas), mas para avaliar o equipamento. Ao salvar, o resultado vai para a aba <strong>Checagem intermediária</strong> do AGV no SGP.</p>' +
      '<label>Amostrador de Grande Volume<select data-chk="agv">' + opcoes(agvs) + '</select></label>' +
      '<label>Kit de calibração (CPV)<select data-chk="kit">' + opcoes(kits) + '</select></label>' +
      '<label>Separador inercial (opcional)<select data-chk="separador">' + opcoes(seps) + '</select></label>' +
      '<label>Fração avaliada<select data-chk="fracao"><option value="">Selecione…</option><option>PTS</option><option>MP10</option><option>MP2,5</option></select></label>' +
      '<div class="grade-2">' +
      '<label>Data<input type="date" data-chk="data" value="' + dados.data + '"></label>' +
      '<label>Técnico<input type="text" data-chk="tecnico" value="' + (dados.tecnico || '') + '"></label>' +
      '</div>' +
      '<div class="grade-2">' + lblNum('Temperatura (°C)', 'temperatura') + lblNum('Pressão (hPa)', 'pressao') + '</div>' +
      '<div class="grade-2">' + lblNum('Inclinação a1 (certificado)', 'calibA1', 'any') + lblNum('Intercepto b1 (certificado)', 'calibB1', 'any') + '</div>' +
      CARTAS.map(function (c) {
        return '<p class="grupo-checks-titulo">Placa de retenção ' + c + '</p>' +
          '<p class="cq-sub">Coluna 800 mm (cmH₂O)</p><div class="grade-2">' +
          lblNum('↑ Para cima', 'carta' + c + '_800sobe') + lblNum('↓ Para baixo', 'carta' + c + '_800desce') + '</div>' +
          '<p class="cq-sub">Coluna 400 mm (cmH₂O)</p><div class="grade-2">' +
          lblNum('↑ Para cima', 'carta' + c + '_00sobe') + lblNum('↓ Para baixo', 'carta' + c + '_00desce') + '</div>';
      }).join('') +
      '<p class="grupo-checks-titulo">Leitura com filtro no lugar</p>' +
      '<div class="grade-2">' + lblNum('Coluna 800 mm ↑', 'filtro_800sobe') + lblNum('Coluna 800 mm ↓', 'filtro_800desce') + '</div>' +
      '<p class="grupo-checks-titulo">📈 Curva de calibração</p>' +
      '<div id="checagem-curva"></div>' +
      '<button type="button" class="botao" id="checagem-salvar" style="width:100%;margin-top:12px;">💾 Salvar checagem no SGP</button>';

    area.innerHTML = html;

    area.querySelectorAll('[data-chk]').forEach(function (el) {
      var c = el.dataset.chk;
      if (dados[c] !== undefined && el.value === '') el.value = dados[c];
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        dados[c] = el.value;
        if (c === 'agv') preencherFracao(area);
        if (c === 'kit') preencherKit(area);
        atualizarCurva();
      });
    });
    $('checagem-salvar').addEventListener('click', salvar);
    atualizarCurva();
  }

  // AGV escolhido → adivinha a fração (só se ainda não escolhida à mão).
  function preencherFracao(area) {
    var sel = area.querySelector('[data-chk="fracao"]');
    var chute = adivinharFracao(dados.agv);
    if (sel && chute && !dados.fracao) { sel.value = chute; dados.fracao = chute; }
  }
  // Kit escolhido → a1/b1 do certificado (SGP); campos seguem editáveis.
  function preencherKit(area) {
    var item = listaQar().filter(function (e) { return e.codigo === dados.kit; })[0];
    if (!item || item.a1 == null || item.b1 == null) {
      if (dados.kit) toast('O certificado deste kit não tem a1/b1 no SGP — digite à mão.');
      return;
    }
    dados.calibA1 = String(item.a1);
    dados.calibB1 = String(item.b1);
    var a = area.querySelector('[data-chk="calibA1"]'), b = area.querySelector('[data-chk="calibB1"]');
    if (a) a.value = dados.calibA1;
    if (b) b.value = dados.calibB1;
  }

  // O "ponto" da checagem tem as mesmas chaves do ponto do campo — o motor de
  // cálculo (EC.campoQar) funciona sem mudar nada. Fração vira o "escopo".
  function calcular() {
    return EC.campoQar.calcular(dados, dados.fracao || '');
  }

  function atualizarCurva() {
    var div = $('checagem-curva');
    if (!div) return;
    if (!dados.fracao) {
      div.innerHTML = '<div class="alerta alerta-info">Escolha a fração avaliada (PTS, MP10 ou MP2,5) — ela define a faixa de aprovação do Qr.</div>';
      return;
    }
    var c = calcular();
    if (c.falta) {
      div.innerHTML = '<div class="alerta alerta-info">📈 A curva aparece aqui sozinha quando você preencher ' + c.falta + '.</div>';
      return;
    }
    function fb(v, casas) { return v.toFixed(casas === undefined ? 4 : casas).replace('.', ','); }
    var html = '<div class="cq-curva-resumo">a2 <strong>' + fb(c.a2) + '</strong> · b2 <strong>' + fb(c.b2) + '</strong> · r <strong>' + fb(c.r) + '</strong></div>';
    html += c.curvaOk
      ? '<div class="alerta alerta-verde">✅ Curva APROVADA — r = ' + fb(c.r) + ' (critério: r ≥ 0,990).</div>'
      : '<div class="alerta alerta-vermelho">❌ Curva REPROVADA — r = ' + fb(c.r) + ' &lt; 0,990: desvio de linearidade.</div>';
    if (c.qr === undefined) {
      html += '<div class="alerta alerta-info">Preencha a leitura com filtro no lugar para calcular o Qr operacional.</div>';
    } else if (c.vazaoOk) {
      html += '<div class="alerta alerta-verde">✅ Vazão APROVADA — Qr = ' + fb(c.qr) + ' m³/min, dentro da faixa de ' + fb(c.faixa[0], 2) + ' a ' + fb(c.faixa[1], 2) + ' m³/min (' + c.fracao + ').</div>';
    } else {
      html += '<div class="alerta alerta-vermelho">❌ Vazão REPROVADA — Qr = ' + fb(c.qr) + ' m³/min, fora da faixa de ' + fb(c.faixa[0], 2) + ' a ' + fb(c.faixa[1], 2) + ' m³/min (' + c.fracao + ').</div>';
    }
    var avisos = EC.campoQar.diagnostico(c);
    if (avisos.length) {
      html += '<div class="alerta alerta-amarelo">🔧 <strong>Diagnóstico</strong>:<br>• ' + avisos.join('<br>• ') + '</div>';
    }
    html += EC.campoQar.svg(c);
    div.innerHTML = html;
  }

  /* ===== Salvar (exige internet) ===== */

  function leiturasBrutas() {
    var out = {};
    CARTAS.forEach(function (c) {
      ['_800sobe', '_800desce', '_00sobe', '_00desce'].forEach(function (suf) {
        out['carta' + c + suf] = dados['carta' + c + suf] || '';
      });
    });
    out.filtro_800sobe = dados.filtro_800sobe || '';
    out.filtro_800desce = dados.filtro_800desce || '';
    return out;
  }

  async function salvar() {
    var btn = $('checagem-salvar');
    if (!dados.agv) { toast('Escolha o Amostrador de Grande Volume.'); return; }
    if (!dados.fracao) { toast('Escolha a fração avaliada.'); return; }
    if (!dados.data) { toast('Informe a data.'); return; }
    var c = calcular();
    if (c.falta) { toast('Complete a calibração: falta ' + c.falta + '.'); return; }
    if (c.qr === undefined) { toast('Preencha a leitura com filtro no lugar.'); return; }
    if (!navigator.onLine) { toast('📡 Salvar a checagem precisa de internet.'); return; }

    btn.disabled = true; btn.textContent = '⏳ Salvando…';
    try {
      var headers = { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN };
      var t = (EC.auth && EC.auth.tokenValido) ? await EC.auth.tokenValido() : '';
      if (t) headers['Authorization'] = 'Bearer ' + t;
      var resp = await fetch(BASE + '/checagens', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          checagem: {
            agv_codigo: dados.agv,
            kit_codigo: dados.kit || '',
            separador_codigo: dados.separador || '',
            fracao: dados.fracao,
            data_checagem: dados.data,
            tecnico: dados.tecnico || '',
            a1: dados.calibA1 || null,
            b1: dados.calibB1 || null,
            temperatura_c: dados.temperatura || null,
            pressao_hpa: dados.pressao || null,
            leituras: leiturasBrutas(),
            a2: c.a2, b2: c.b2, r: c.r,
            curva_aprovada: !!c.curvaOk,
            qr: c.qr, faixa_min: c.faixa[0], faixa_max: c.faixa[1],
            vazao_aprovada: !!c.vazaoOk
          }
        })
      });
      var corpo = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      toast('✅ Checagem salva no SGP — veja na aba Checagem intermediária do ' + dados.agv + '.');
      renderizar(); // limpa o formulário para a próxima
    } catch (e) {
      toast('🛑 Não salvou: ' + (e && e.message ? e.message : e));
    } finally {
      if ($('checagem-salvar')) { $('checagem-salvar').disabled = false; $('checagem-salvar').textContent = '💾 Salvar checagem no SGP'; }
    }
  }

  /* ===== Navegação ===== */

  function abrirMenu() {
    // Atualiza a lista de equipamentos em segundo plano (kits com a1/b1 frescos).
    if (EC.equip && EC.equip.carregar) EC.equip.carregar(function () {
      if (!$('tela-checagem-part') || $('tela-checagem-part').classList.contains('oculto')) return;
      renderizar(); // lista fresca chegou com o formulário aberto
    });
    EC.app.mostrarTela('tela-checagem-menu');
  }
  function abrirParticulados() {
    EC.app.mostrarTela('tela-checagem-part');
    renderizar();
  }

  return {
    abrirMenu: abrirMenu,
    abrirParticulados: abrirParticulados
  };
})();
