/**
 * pesagens.js — Pesagens de filtros (restrito à logística de campo).
 *
 * O F053 (Pesagem de filtros) digital, FIEL ao papel (redesenho com a Raisa,
 * 2026-08-13): o laboratório pesa filtros EM LOTE, por número, SEM OS — é um
 * estoque de filtros tarados. O ritual inteiro é capturado:
 *   estabilização (~24 h) → 1ª pesagem → verificação (~4 h) → 2ª pesagem
 *   (a última casa não pode variar mais que 5 = 0,0005 g; variou, exige a 3ª),
 *   com umidade, temperatura e balança — na TARA e na FINAL.
 *
 * O vínculo com a OS NÃO é escolhido aqui: nasce da COLETA — quando o registro
 * de campo cita o número do filtro, o servidor carimba OS/campanha/ponto/
 * poluente na pesagem sozinho.
 *
 * Tudo EXIGE internet (atividade de bancada, sem rascunho offline — mesma
 * decisão da checagem intermediária). Menu só logistica_campo/admin; o servidor
 * confere de novo, fail-closed.
 *
 * Interface (EC.pesagens): abrir(), abrirMenu() (apelido de abrir)
 */
window.EC = window.EC || {};

EC.pesagens = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/monitoramento';
  var TOKEN = '1488d0e2eece92e0796951cb693a4689c95cad0193e91ad2';
  var CHAVE_BALANCA = 'pesagens:balanca'; // última balança usada neste aparelho
  // Regra do F053: a última casa não pode variar mais que 5 (0,0005 g).
  var VARIACAO_MAX = 0.0005 + 1e-9;

  // Estado só em memória (pesagem exige internet).
  var dados = {};          // formulário da tara
  var dadosFinal = {};     // formulário da pesagem final aberta
  var finalAberto = null;  // id da pesagem cujo formulário final está aberto
  var lista = { pendentes: [], concluidas: [] };
  var buscaPend = '';      // busca na lista de aguardando final

  function $(id) { return document.getElementById(id); }
  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }
  function agoraLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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
  // Precisa da 3ª pesagem? (1ª e 2ª variaram mais que 0,0005 g)
  function precisaTerceira(g1, g2) {
    return g1 != null && g2 != null && Math.abs(g1 - g2) > VARIACAO_MAX;
  }

  async function cabecalhos() {
    var h = { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN };
    var t = (EC.auth && EC.auth.tokenValido) ? await EC.auth.tokenValido() : '';
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  /* ===== Formulário da TARA ===== */

  // Bloco de série de pesagens (1ª, 2ª e — quando variar — 3ª) reutilizado na
  // tara e na final. `pfx` é o prefixo do estado ('t' = dados, 'f' = dadosFinal).
  function htmlSerie(pfx, alvo) {
    var g1 = numDe(alvo[pfx + 'g1']), g2 = numDe(alvo[pfx + 'g2']);
    var mostrar3 = precisaTerceira(g1, g2);
    var aviso = '';
    if (g1 != null && g2 != null) {
      aviso = mostrar3
        ? '<div class="alerta alerta-amarelo">⚠️ A 2ª pesagem variou mais que 0,0005 g da 1ª — o F053 exige a <strong>3ª pesagem</strong>.</div>'
        : '<div class="alerta alerta-verde">✅ 1ª e 2ª pesagens conferem (variação ≤ 0,0005 g).</div>';
    }
    return '<div class="grade-2">' +
      '<label>1ª pesagem (g)<input type="number" step="0.0001" inputmode="decimal" data-psg="' + pfx + 'g1" value="' + esc(alvo[pfx + 'g1'] || '') + '" placeholder="ex.: 2,7336"></label>' +
      '<label>2ª pesagem (g) — após ~4 h<input type="number" step="0.0001" inputmode="decimal" data-psg="' + pfx + 'g2" value="' + esc(alvo[pfx + 'g2'] || '') + '" placeholder="ex.: 2,7336"></label>' +
      '</div>' + aviso +
      (mostrar3
        ? '<label>3ª pesagem (g) — obrigatória, a 2ª variou<input type="number" step="0.0001" inputmode="decimal" data-psg="' + pfx + 'g3" value="' + esc(alvo[pfx + 'g3'] || '') + '"></label>'
        : '');
  }

  function renderizar() {
    var area = $('pesagens-form');
    if (!area) return;
    var sessao = (EC.storage && EC.storage.ler('sessao:atual')) || {};
    if (dados._novo !== false) {
      dados = {
        _novo: false,
        testab: '', tpesagem: agoraLocal(),
        balanca: EC.storage.ler(CHAVE_BALANCA) || 'ENG.B.A.01',
        tecnico: sessao.nome || ''
      };
    }

    area.innerHTML =
      '<p class="texto-apoio">O filtro é pesado <strong>por número</strong>, sem OS — o vínculo com o serviço nasce na coleta, quando o técnico usa o filtro. Estabilize (~24 h), faça a 1ª pesagem e confirme com a 2ª (~4 h depois). Com tara e final, o SGP calcula a concentração em <strong>Serviços → Particulados</strong>.</p>' +

      '<p class="grupo-checks-titulo">➕ Tara (filtro limpo)</p>' +
      '<label>Nº do filtro<input type="text" data-psg="numero" autocomplete="off" value="' + esc(dados.numero || '') + '" placeholder="ex.: 181"></label>' +
      '<div class="grade-2">' +
      '<label>Início da estabilização<input type="datetime-local" data-psg="testab" value="' + esc(dados.testab || '') + '"></label>' +
      '<label>Data/hora da pesagem<input type="datetime-local" data-psg="tpesagem" value="' + esc(dados.tpesagem || '') + '"></label>' +
      '</div>' +
      htmlSerie('t', dados) +
      '<div class="grade-2">' +
      '<label>Umidade (%)<input type="number" step="0.1" inputmode="decimal" data-psg="umidade" value="' + esc(dados.umidade || '') + '"></label>' +
      '<label>Temperatura (°C)<input type="number" step="0.1" inputmode="decimal" data-psg="temperatura" value="' + esc(dados.temperatura || '') + '"></label>' +
      '</div>' +
      '<div class="grade-2">' +
      '<label>Balança<input type="text" data-psg="balanca" value="' + esc(dados.balanca) + '"></label>' +
      '<label>Técnico<input type="text" data-psg="tecnico" value="' + esc(dados.tecnico) + '"></label>' +
      '</div>' +
      '<button type="button" class="botao" id="psg-salvar-tara" style="width:100%;margin-top:12px;">💾 Salvar tara no SGP</button>' +

      '<p class="grupo-checks-titulo" style="margin-top:22px;">⏳ Aguardando pesagem final</p>' +
      '<label class="oculto" id="psg-busca-rotulo">Buscar filtro<input type="search" id="psg-busca" value="' + esc(buscaPend) + '" placeholder="🔎 Nº do filtro ou OS" autocomplete="off"></label>' +
      '<div id="psg-pendentes"><div class="alerta alerta-info">Carregando a lista…</div></div>' +

      '<p class="grupo-checks-titulo" style="margin-top:22px;">✅ Últimas concluídas</p>' +
      '<div id="psg-concluidas"></div>';

    area.querySelectorAll('[data-psg]').forEach(function (el) {
      var c = el.dataset.psg;
      dados[c] = el.value;
      el.addEventListener('input', function () {
        dados[c] = el.value;
        // 1ª/2ª pesagem mudou: o aviso da variação e o campo da 3ª acompanham.
        if (c === 'tg1' || c === 'tg2') { renderizar(); renderizarListas(); }
      });
    });
    var busca = $('psg-busca');
    if (busca) busca.addEventListener('input', function () { buscaPend = this.value; renderizarListas(); });
    $('psg-salvar-tara').addEventListener('click', salvarTara);
  }

  /* ===== Listas (GET) ===== */

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

  // Onde o filtro foi usado (carimbado pela coleta) — ou estoque.
  function usoDe(p) {
    if (!p.os) return '';
    return 'OS ' + esc(p.os) + (p.ponto ? ' · ' + esc(p.ponto) : '') +
      (p.poluente ? ' · <strong style="color:var(--azul);">' + esc(p.poluente) + '</strong>' : '');
  }

  function itemPendente(p) {
    var aberto = finalAberto === p.id;
    var html =
      '<div style="border:1px solid #d7dce8;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<strong>Filtro ' + esc(p.numero_filtro) + '</strong>' +
      (p.os
        ? '<span style="font-size:0.8rem;font-weight:700;color:#16276e;background:#e8f3fb;border-radius:999px;padding:1px 8px;">' + usoDe(p) + '</span>'
        : '<span style="font-size:0.8rem;color:#5a6377;background:#f0f2f7;border-radius:999px;padding:1px 8px;">estoque</span>') +
      '<span style="font-size:0.85rem;color:#5a6377;">tara ' + fmtG(p.tara_g) + ' · ' + dataBR(p.tara_data) + '</span>' +
      '<button type="button" class="botao botao-mini" data-psg-final="' + esc(p.id) + '" style="margin-left:auto;">' +
      (aberto ? 'Fechar' : '⚖️ Pesagem final') + '</button>' +
      '</div>';
    if (aberto) {
      html +=
        '<div style="margin-top:10px;">' +
        '<div class="grade-2">' +
        '<label>Início da estabilização pós-coleta<input type="datetime-local" data-psgf="festab" value="' + esc(dadosFinal.festab || '') + '"></label>' +
        '<label>Data/hora da pesagem<input type="datetime-local" data-psgf="fpesagem" value="' + esc(dadosFinal.fpesagem || '') + '"></label>' +
        '</div>' +
        (function () {
          var g1 = numDe(dadosFinal.fg1), g2 = numDe(dadosFinal.fg2);
          var mostrar3 = precisaTerceira(g1, g2);
          var aviso = '';
          if (g1 != null && g2 != null) {
            aviso = mostrar3
              ? '<div class="alerta alerta-amarelo">⚠️ A 2ª pesagem variou mais que 0,0005 g — o F053 exige a <strong>3ª</strong>.</div>'
              : '<div class="alerta alerta-verde">✅ 1ª e 2ª pesagens conferem.</div>';
          }
          return '<div class="grade-2">' +
            '<label>1ª pesagem (g)<input type="number" step="0.0001" inputmode="decimal" data-psgf="fg1" value="' + esc(dadosFinal.fg1 || '') + '"></label>' +
            '<label>2ª pesagem (g) — após ~4 h<input type="number" step="0.0001" inputmode="decimal" data-psgf="fg2" value="' + esc(dadosFinal.fg2 || '') + '"></label>' +
            '</div>' + aviso +
            (mostrar3 ? '<label>3ª pesagem (g) — obrigatória, a 2ª variou<input type="number" step="0.0001" inputmode="decimal" data-psgf="fg3" value="' + esc(dadosFinal.fg3 || '') + '"></label>' : '');
        })() +
        '<div class="grade-2">' +
        '<label>Umidade (%)<input type="number" step="0.1" inputmode="decimal" data-psgf="fumidade" value="' + esc(dadosFinal.fumidade || '') + '"></label>' +
        '<label>Temperatura (°C)<input type="number" step="0.1" inputmode="decimal" data-psgf="ftemperatura" value="' + esc(dadosFinal.ftemperatura || '') + '"></label>' +
        '</div>' +
        '<button type="button" class="botao" id="psg-salvar-final" style="width:100%;margin-top:10px;">💾 Salvar pesagem final</button>' +
        '</div>';
    }
    return html + '</div>';
  }

  function renderizarListas() {
    var pend = $('psg-pendentes'), conc = $('psg-concluidas');
    if (!pend || !conc) return;

    var rotBusca = $('psg-busca-rotulo');
    if (rotBusca) rotBusca.classList.toggle('oculto', lista.pendentes.length <= 8);

    var t = String(buscaPend || '').trim().toLowerCase();
    var pendentes = lista.pendentes.filter(function (p) {
      return !t || (String(p.numero_filtro) + ' ' + String(p.os || '')).toLowerCase().indexOf(t) !== -1;
    });

    pend.innerHTML = pendentes.length
      ? pendentes.map(itemPendente).join('')
      : '<div class="alerta alerta-info">' + (t ? 'Nenhum filtro encontrado para essa busca.' : 'Nenhum filtro aguardando pesagem final.') + '</div>';

    conc.innerHTML = lista.concluidas.length
      ? lista.concluidas.map(function (p) {
          var massa = (p.final_g != null && p.tara_g != null) ? (Number(p.final_g) - Number(p.tara_g)) : null;
          return '<div style="border:1px solid #e2e6ef;border-radius:10px;padding:8px 12px;margin-bottom:6px;background:#f7f9fc;font-size:0.9rem;">' +
            '<strong>Filtro ' + esc(p.numero_filtro) + '</strong>' +
            (p.os ? ' · ' + usoDe(p) : '') +
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
        dadosFinal = { festab: '', fpesagem: agoraLocal(), fg1: '', fg2: '', fg3: '', fumidade: '', ftemperatura: '' };
        renderizarListas();
      });
    });
    pend.querySelectorAll('[data-psgf]').forEach(function (el) {
      var c = el.dataset.psgf;
      dadosFinal[c] = el.value;
      el.addEventListener('input', function () {
        dadosFinal[c] = el.value;
        if (c === 'fg1' || c === 'fg2') renderizarListas(); // aviso/3ª acompanham
      });
    });
    var btnF = $('psg-salvar-final');
    if (btnF) btnF.addEventListener('click', salvarFinal);
  }

  /* ===== Salvar (exige internet) ===== */

  function validarSerie(rotulo, g1, g2, g3) {
    if (g1 === null || g1 <= 0) return 'Informe a 1ª pesagem ' + rotulo + '.';
    if (g2 === null || g2 <= 0) return 'Informe a 2ª pesagem ' + rotulo + ' (verificação após ~4 h).';
    if (precisaTerceira(g1, g2) && (g3 === null || g3 <= 0)) {
      return 'A 2ª pesagem ' + rotulo + ' variou mais que 0,0005 g — a 3ª é obrigatória (F053).';
    }
    return '';
  }

  async function salvarTara() {
    var btn = $('psg-salvar-tara');
    var numero = String(dados.numero || '').trim();
    if (!numero) { toast('Informe o número do filtro.'); return; }
    var g1 = numDe(dados.tg1), g2 = numDe(dados.tg2), g3 = numDe(dados.tg3);
    var erro = validarSerie('da tara', g1, g2, g3);
    if (erro) { toast(erro); return; }
    if (!dados.tpesagem) { toast('Informe a data/hora da pesagem.'); return; }
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
            tara_estab_inicio: dados.testab || null,
            tara_pesagem_em: dados.tpesagem,
            tara_g1: dados.tg1, tara_g2: dados.tg2, tara_g3: dados.tg3 || null,
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
      toast('✅ Tara do filtro ' + numero + ' salva — oficial ' + fmtG(corpo.tara_oficial) + '.');
      dados = { _novo: true };
      renderizar();     // limpa o formulário
      carregarLista();  // o filtro aparece em "Aguardando pesagem final"
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
    var g1 = numDe(dadosFinal.fg1), g2 = numDe(dadosFinal.fg2), g3 = numDe(dadosFinal.fg3);
    var erro = validarSerie('final', g1, g2, g3);
    if (erro) { toast(erro); return; }
    if (!dadosFinal.fpesagem) { toast('Informe a data/hora da pesagem.'); return; }
    if (!navigator.onLine) { toast('📡 Salvar a pesagem precisa de internet.'); return; }
    // Final menor que a tara = massa negativa. Acontece em branco de campo, mas
    // quase sempre é dedo trocado — confirma antes de gravar.
    var oficialPrevia = precisaTerceira(g1, g2) ? g3 : g2;
    if (item.tara_g != null && oficialPrevia != null && oficialPrevia < Number(item.tara_g) &&
        !window.confirm('O peso final (' + fmtG(oficialPrevia) + ') é MENOR que a tara (' + fmtG(item.tara_g) + ') — a massa ficaria negativa.\n\nTem certeza de que os valores estão certos?')) {
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
            final_estab_inicio: dadosFinal.festab || null,
            final_pesagem_em: dadosFinal.fpesagem,
            final_g1: dadosFinal.fg1, final_g2: dadosFinal.fg2, final_g3: dadosFinal.fg3 || null,
            final_umidade: dadosFinal.fumidade || null,
            final_temperatura: dadosFinal.ftemperatura || null,
            final_tecnico: ((EC.storage && EC.storage.ler('sessao:atual')) || {}).nome || ''
          }
        })
      });
      var corpo = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      toast('✅ Pesagem final do filtro ' + item.numero_filtro + ' salva — oficial ' + fmtG(corpo.final_oficial) + '.');
      carregarLista();
    } catch (e) {
      toast('🛑 Não salvou: ' + (e && e.message ? e.message : e));
      if ($('psg-salvar-final')) { $('psg-salvar-final').disabled = false; $('psg-salvar-final').textContent = '💾 Salvar pesagem final'; }
    }
  }

  /* ===== Navegação ===== */

  function abrir() {
    dados = { _novo: true };
    buscaPend = '';
    EC.app.mostrarTela('tela-pesagens');
    renderizar();
    carregarLista();
  }

  return { abrir: abrir, abrirMenu: abrir };
})();
