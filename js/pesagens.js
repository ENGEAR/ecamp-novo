/**
 * pesagens.js — Pesagens de filtros de particulados (restrito à logística de campo).
 *
 * O F053 (Pesagem de filtros) digital, em dois momentos na bancada do laboratório:
 *   1) TARA: antes do campo, o filtro limpo é pesado e ganha o número de
 *      identificação — o MESMO número que o técnico digita na coleta
 *      ("Código do filtro" do QAR Externo).
 *   2) FINAL: depois do campo, o filtro volta com o material e é pesado de novo.
 * Com as duas pesagens, o SGP calcula a concentração (µg/m³) em
 * Serviços → Particulados, cruzando pelo número do filtro.
 *
 * Decisões (Raisa, 2026-08-12):
 *   • fluxo POR FILTRO (como o F053), não por OS — a tara existe antes da coleta;
 *   • tudo EXIGE internet (atividade de bancada, sem rascunho offline — mesma
 *     decisão da checagem intermediária);
 *   • menu visível só para logistica_campo/admin (o servidor confere de novo,
 *     fail-closed).
 *
 * Interface (EC.pesagens): abrir()
 */
window.EC = window.EC || {};

EC.pesagens = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/monitoramento';
  var TOKEN = '1488d0e2eece92e0796951cb693a4689c95cad0193e91ad2';
  var CHAVE_BALANCA = 'pesagens:balanca'; // última balança usada neste aparelho

  // Estado só em memória (pesagem exige internet).
  var dados = {};          // formulário da tara
  var dadosFinal = {};     // formulário da pesagem final aberta
  var finalAberto = null;  // id da pesagem cujo formulário final está aberto
  var lista = { pendentes: [], concluidas: [] };

  function $(id) { return document.getElementById(id); }
  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dataBR(iso) {
    var s = String(iso || '').slice(0, 10).split('-');
    return s.length === 3 ? s[2] + '/' + s[1] + '/' + s[0] : (iso || '—');
  }
  function numDe(v) {
    var n = Number(String(v == null ? '' : v).replace(',', '.'));
    return String(v == null ? '' : v).trim() === '' || isNaN(n) ? null : n;
  }
  function fmtG(v) {
    return v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ' g';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  async function cabecalhos() {
    var h = { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN };
    var t = (EC.auth && EC.auth.tokenValido) ? await EC.auth.tokenValido() : '';
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  /* ===== Tela ===== */

  function renderizar() {
    var area = $('pesagens-form');
    if (!area) return;
    var sessao = (EC.storage && EC.storage.ler('sessao:atual')) || {};
    dados = {
      numero: '', data: hojeISO(),
      balanca: EC.storage.ler(CHAVE_BALANCA) || 'ENG.B.A.01',
      tecnico: sessao.nome || ''
    };

    var html =
      '<p class="texto-apoio">Pese o filtro na balança do laboratório. A <strong>tara</strong> é lançada antes do campo — o número do filtro é o mesmo que o técnico digita na coleta. Depois do campo, lance a <strong>pesagem final</strong> aqui embaixo. Com as duas, o SGP calcula a concentração em <strong>Serviços → Particulados</strong>.</p>' +

      '<p class="grupo-checks-titulo">➕ Pesagem inicial (tara)</p>' +
      '<div class="grade-2">' +
      '<label>Nº do filtro<input type="text" data-psg="numero" autocomplete="off" placeholder="ex.: 1234"></label>' +
      '<label>Data<input type="date" data-psg="data" value="' + dados.data + '"></label>' +
      '</div>' +
      '<label>Tara — filtro limpo (g)<input type="number" step="0.0001" inputmode="decimal" data-psg="tara" placeholder="ex.: 3,4567"></label>' +
      '<div class="grade-2">' +
      '<label>Umidade (%)<input type="number" step="0.1" inputmode="decimal" data-psg="umidade"></label>' +
      '<label>Temperatura (°C)<input type="number" step="0.1" inputmode="decimal" data-psg="temperatura"></label>' +
      '</div>' +
      '<div class="grade-2">' +
      '<label>Balança<input type="text" data-psg="balanca" value="' + esc(dados.balanca) + '"></label>' +
      '<label>Técnico<input type="text" data-psg="tecnico" value="' + esc(dados.tecnico) + '"></label>' +
      '</div>' +
      '<button type="button" class="botao" id="psg-salvar-tara" style="width:100%;margin-top:12px;">💾 Salvar tara no SGP</button>' +

      '<p class="grupo-checks-titulo" style="margin-top:22px;">⏳ Aguardando pesagem final</p>' +
      '<div id="psg-pendentes"><div class="alerta alerta-info">Carregando a lista…</div></div>' +

      '<p class="grupo-checks-titulo" style="margin-top:22px;">✅ Últimas concluídas</p>' +
      '<div id="psg-concluidas"></div>';

    area.innerHTML = html;

    area.querySelectorAll('[data-psg]').forEach(function (el) {
      var c = el.dataset.psg;
      el.addEventListener('input', function () { dados[c] = el.value; });
      dados[c] = el.value;
    });
    $('psg-salvar-tara').addEventListener('click', salvarTara);
  }

  /* ===== Lista (GET) ===== */

  async function carregarLista() {
    if (!navigator.onLine) {
      var alvo = $('psg-pendentes');
      if (alvo) alvo.innerHTML = '<div class="alerta alerta-amarelo">📡 As pesagens precisam de internet. Conecte e abra o menu de novo.</div>';
      return;
    }
    try {
      var resp = await fetch(BASE + '/pesagens', { headers: await cabecalhos() });
      var corpo = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      lista.pendentes = corpo.pendentes || [];
      lista.concluidas = corpo.concluidas || [];
      finalAberto = null;
      renderizarListas();
    } catch (e) {
      var el = $('psg-pendentes');
      if (el) el.innerHTML = '<div class="alerta alerta-vermelho">🛑 Não deu para carregar a lista: ' + esc(e && e.message ? e.message : e) + '</div>';
    }
  }

  function itemPendente(p) {
    var aberto = finalAberto === p.id;
    var html =
      '<div style="border:1px solid #d7dce8;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<strong>Filtro ' + esc(p.numero_filtro) + '</strong>' +
      '<span style="font-size:0.85rem;color:#5a6377;">tara ' + fmtG(p.tara_g) + ' · ' + dataBR(p.tara_data) + '</span>' +
      '<button type="button" class="botao botao-mini" data-psg-final="' + esc(p.id) + '" style="margin-left:auto;">' +
      (aberto ? 'Fechar' : '⚖️ Pesagem final') + '</button>' +
      '</div>';
    if (aberto) {
      html +=
        '<div style="margin-top:10px;">' +
        '<div class="grade-2">' +
        '<label>Peso final (g)<input type="number" step="0.0001" inputmode="decimal" data-psgf="peso" placeholder="ex.: 3,6789"></label>' +
        '<label>Data<input type="date" data-psgf="data" value="' + hojeISO() + '"></label>' +
        '</div>' +
        '<div class="grade-2">' +
        '<label>Umidade (%)<input type="number" step="0.1" inputmode="decimal" data-psgf="umidade"></label>' +
        '<label>Temperatura (°C)<input type="number" step="0.1" inputmode="decimal" data-psgf="temperatura"></label>' +
        '</div>' +
        '<button type="button" class="botao" id="psg-salvar-final" style="width:100%;margin-top:10px;">💾 Salvar pesagem final</button>' +
        '</div>';
    }
    return html + '</div>';
  }

  function renderizarListas() {
    var pend = $('psg-pendentes'), conc = $('psg-concluidas');
    if (!pend || !conc) return;

    pend.innerHTML = lista.pendentes.length
      ? lista.pendentes.map(itemPendente).join('')
      : '<div class="alerta alerta-info">Nenhum filtro aguardando pesagem final.</div>';

    conc.innerHTML = lista.concluidas.length
      ? lista.concluidas.map(function (p) {
          var massa = (p.final_g != null && p.tara_g != null) ? (Number(p.final_g) - Number(p.tara_g)) : null;
          return '<div style="border:1px solid #e2e6ef;border-radius:10px;padding:8px 12px;margin-bottom:6px;background:#f7f9fc;font-size:0.9rem;">' +
            '<strong>Filtro ' + esc(p.numero_filtro) + '</strong>' +
            ' · tara ' + fmtG(p.tara_g) + ' · final ' + fmtG(p.final_g) +
            (massa != null ? ' · <strong>massa ' + fmtG(massa) + '</strong>' : '') +
            ' · ' + dataBR(p.final_data) +
            '</div>';
        }).join('')
      : '<div class="alerta alerta-info">Nenhuma pesagem concluída ainda.</div>';

    pend.querySelectorAll('[data-psg-final]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-psg-final');
        finalAberto = (finalAberto === id) ? null : id;
        dadosFinal = { peso: '', data: hojeISO(), umidade: '', temperatura: '' };
        renderizarListas();
      });
    });
    pend.querySelectorAll('[data-psgf]').forEach(function (el) {
      var c = el.dataset.psgf;
      dadosFinal[c] = el.value;
      el.addEventListener('input', function () { dadosFinal[c] = el.value; });
    });
    var btnF = $('psg-salvar-final');
    if (btnF) btnF.addEventListener('click', salvarFinal);
  }

  /* ===== Salvar (exige internet) ===== */

  async function salvarTara() {
    var btn = $('psg-salvar-tara');
    var numero = String(dados.numero || '').trim();
    var tara = numDe(dados.tara);
    if (!numero) { toast('Informe o número do filtro.'); return; }
    if (tara === null || tara <= 0) { toast('Informe a tara (peso do filtro limpo, em gramas).'); return; }
    if (!dados.data) { toast('Informe a data da pesagem.'); return; }
    if (!navigator.onLine) { toast('📡 Salvar a pesagem precisa de internet.'); return; }

    btn.disabled = true; btn.textContent = '⏳ Salvando…';
    try {
      var resp = await fetch(BASE + '/pesagens', {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({
          acao: 'tara',
          pesagem: {
            numero_filtro: numero,
            tara_g: dados.tara,
            tara_data: dados.data,
            tara_umidade: dados.umidade || null,
            tara_temperatura: dados.temperatura || null,
            balanca: dados.balanca || '',
            tara_tecnico: dados.tecnico || ''
          }
        })
      });
      var corpo = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      if (dados.balanca) EC.storage.salvar(CHAVE_BALANCA, String(dados.balanca).trim());
      toast('✅ Tara do filtro ' + numero + ' salva no SGP.');
      renderizar();       // limpa o formulário
      carregarLista();    // o filtro novo aparece em "Aguardando pesagem final"
    } catch (e) {
      toast('🛑 Não salvou: ' + (e && e.message ? e.message : e));
    } finally {
      if ($('psg-salvar-tara')) { $('psg-salvar-tara').disabled = false; $('psg-salvar-tara').textContent = '💾 Salvar tara no SGP'; }
    }
  }

  async function salvarFinal() {
    var btn = $('psg-salvar-final');
    var item = lista.pendentes.filter(function (p) { return p.id === finalAberto; })[0];
    if (!item) return;
    var peso = numDe(dadosFinal.peso);
    if (peso === null || peso <= 0) { toast('Informe o peso final (filtro com o material, em gramas).'); return; }
    if (!dadosFinal.data) { toast('Informe a data da pesagem.'); return; }
    if (!navigator.onLine) { toast('📡 Salvar a pesagem precisa de internet.'); return; }
    // Final menor que a tara = massa negativa. Acontece em branco de campo, mas
    // quase sempre é dedo trocado — confirma antes de gravar.
    if (item.tara_g != null && peso < Number(item.tara_g) &&
        !window.confirm('O peso final (' + fmtG(peso) + ') é MENOR que a tara (' + fmtG(item.tara_g) + ') — a massa ficaria negativa.\n\nTem certeza de que os valores estão certos?')) {
      return;
    }

    btn.disabled = true; btn.textContent = '⏳ Salvando…';
    try {
      var resp = await fetch(BASE + '/pesagens', {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({
          acao: 'final',
          id: item.id,
          pesagem: {
            final_g: dadosFinal.peso,
            final_data: dadosFinal.data,
            final_umidade: dadosFinal.umidade || null,
            final_temperatura: dadosFinal.temperatura || null,
            final_tecnico: ((EC.storage && EC.storage.ler('sessao:atual')) || {}).nome || ''
          }
        })
      });
      var corpo = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      toast('✅ Pesagem final do filtro ' + item.numero_filtro + ' salva — concentração disponível no SGP.');
      carregarLista();
    } catch (e) {
      toast('🛑 Não salvou: ' + (e && e.message ? e.message : e));
      if ($('psg-salvar-final')) { $('psg-salvar-final').disabled = false; $('psg-salvar-final').textContent = '💾 Salvar pesagem final'; }
    }
  }

  /* ===== Navegação ===== */

  function abrir() {
    EC.app.mostrarTela('tela-pesagens');
    renderizar();
    carregarLista();
  }

  return { abrir: abrir };
})();
