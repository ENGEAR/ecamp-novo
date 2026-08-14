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
  var proximoNumero = '';  // próximo nº da sequência (o banco é quem manda)

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

  /* ---- Data/hora no formato curto DD/MM/AA HH:MM ----
   * O campo nativo (datetime-local) mostra o ano com 4 dígitos e ocupa duas
   * linhas no celular. Aqui o campo é de TEXTO com máscara: a pessoa digita só
   * números e o traço/os dois-pontos entram sozinhos. O valor GUARDADO segue
   * sendo ISO ('AAAA-MM-DDTHH:MM'), que é o que as contas de 24 h/4 h usam. */
  function isoParaCurto(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1].slice(2) + ' ' + m[4] + ':' + m[5] : '';
  }
  function curtoParaIso(txt) {
    var d = String(txt || '').replace(/\D/g, '');
    if (d.length < 10) return '';                 // DDMMAAHHMM = 10 dígitos
    var dia = d.slice(0, 2), mes = d.slice(2, 4), ano = d.slice(4, 6);
    var hh = d.slice(6, 8), mm = d.slice(8, 10);
    if (+dia < 1 || +dia > 31 || +mes < 1 || +mes > 12 || +hh > 23 || +mm > 59) return '';
    return '20' + ano + '-' + mes + '-' + dia + 'T' + hh + ':' + mm;
  }
  // Vai formatando enquanto digita: 1302 → "13/02", 130226143 → "13/02/26 14:3"
  function mascararDataHora(txt) {
    var d = String(txt || '').replace(/\D/g, '').slice(0, 10);
    var s = d.slice(0, 2);
    if (d.length > 2) s += '/' + d.slice(2, 4);
    if (d.length > 4) s += '/' + d.slice(4, 6);
    if (d.length > 6) s += ' ' + d.slice(6, 8);
    if (d.length > 8) s += ':' + d.slice(8, 10);
    return s;
  }
  // Campo de data/hora pronto (curto, cabe em uma linha).
  function inputDataHora(attr, chave, iso, extra) {
    return '<input type="text" inputmode="numeric" maxlength="14" class="psg-datahora"' +
      ' placeholder="DD/MM/AA HH:MM" ' + attr + '="' + chave + '"' +
      ' data-datahora="1" value="' + esc(isoParaCurto(iso)) + '"' + (extra || '') + '>';
  }
  // Liga a máscara e converte para ISO ao guardar. `guardar(valorIso)` é quem
  // grava no formulário; `aoTerminar` roda no blur (avisos de 24 h/4 h).
  function ligarDataHora(el, guardar, aoTerminar) {
    el.addEventListener('input', function () {
      el.value = mascararDataHora(el.value);
      guardar(curtoParaIso(el.value));
    });
    el.addEventListener('change', function () {
      guardar(curtoParaIso(el.value));
      if (aoTerminar) aoTerminar();
    });
  }
  // Ordem dos filtros. O número é TEXTO ('10-26', '613-26', '405-25'), então
  // comparar como texto colocaria o 10 depois do 9. Aqui vale o NÚMERO; o ano
  // (o que vem depois do traço) só desempata.
  function compararFiltro(a, b) {
    var pa = String(a || '').split('-'), pb = String(b || '').split('-');
    var na = parseInt(pa[0], 10), nb = parseInt(pb[0], 10);
    if (isNaN(na)) na = -1;
    if (isNaN(nb)) nb = -1;
    if (na !== nb) return na - nb;
    return String(pa[1] || '').localeCompare(String(pb[1] || ''));
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
  // F053: o filtro estabiliza por NO MÍNIMO 24 h antes de ser pesado.
  var ESTAB_MIN_H = 24;
  function horasEstab(estab, pesagem) {
    if (!estab || !pesagem) return null;
    var h = (new Date(pesagem).getTime() - new Date(estab).getTime()) / 3600000;
    return isNaN(h) ? null : h;
  }
  function fmtHoras(h) { return h.toFixed(1).replace('.', ','); }
  // Aviso ao vivo entre as duas datas (vazio enquanto não der para calcular).
  function avisoEstab(estab, pesagem) {
    var h = horasEstab(estab, pesagem);
    if (h === null) return '';
    if (h < 0) return '<div class="alerta alerta-vermelho">⚠️ A pesagem está <strong>antes</strong> do início da estabilização — confira as datas.</div>';
    if (h < ESTAB_MIN_H) return '<div class="alerta alerta-vermelho">⏱️ Estabilização de <strong>' + fmtHoras(h) + ' h</strong> — é exigido no mínimo <strong>24 h</strong> entre o início da estabilização e a pesagem. Não dá para salvar assim.</div>';
    return '<div class="alerta alerta-verde">✅ Estabilização de ' + fmtHoras(h) + ' h (mínimo de 24 h atendido).</div>';
  }
  // Trava do salvar: devolve a mensagem de erro, ou '' quando pode salvar.
  function erroEstab(estab, pesagem, rotulo) {
    if (!estab) return 'Informe o início da estabilização ' + rotulo + ' — é exigido no mínimo 24 h antes da pesagem.';
    var h = horasEstab(estab, pesagem);
    if (h === null) return '';
    if (h < 0) return 'A pesagem ' + rotulo + ' está antes do início da estabilização — confira as datas.';
    if (h < ESTAB_MIN_H) return '⏱️ Estabilização ' + rotulo + ' de ' + fmtHoras(h) + ' h — é exigido no mínimo 24 h.';
    return '';
  }

  // F053: a 2ª pesagem (verificação) é feita NO MÍNIMO 4 h depois da 1ª.
  var INTERVALO_MIN_H = 4;
  function intervaloOk(p1em, p2em) {
    var h = horasEstab(p1em, p2em);
    return h !== null && h >= 0 && h + 1e-9 >= INTERVALO_MIN_H;
  }
  function avisoIntervalo(p1em, p2em) {
    var h = horasEstab(p1em, p2em);
    if (h === null) return '';
    if (h < 0) return '<div class="alerta alerta-vermelho">⚠️ A 2ª pesagem está <strong>antes</strong> da 1ª — confira as datas.</div>';
    if (h + 1e-9 < INTERVALO_MIN_H) return '<div class="alerta alerta-vermelho">⏱️ Intervalo de <strong>' + fmtHoras(h) + ' h</strong> desde a 1ª pesagem — a verificação só pode ser feita após <strong>4 h</strong>. O peso da 2ª fica travado até lá.</div>';
    return '<div class="alerta alerta-verde">✅ Intervalo de ' + fmtHoras(h) + ' h entre as pesagens (mínimo de 4 h atendido).</div>';
  }
  function erroIntervalo(p1em, p2em, rotulo) {
    if (!p2em) return 'Informe a data/hora da 2ª pesagem ' + rotulo + ' — a verificação é feita no mínimo 4 h após a 1ª.';
    var h = horasEstab(p1em, p2em);
    if (h === null) return '';
    if (h < 0) return 'A 2ª pesagem ' + rotulo + ' está antes da 1ª — confira as datas.';
    if (h + 1e-9 < INTERVALO_MIN_H) return '⏱️ Intervalo de ' + fmtHoras(h) + ' h entre as pesagens ' + rotulo + ' — é exigido no mínimo 4 h.';
    return '';
  }

  // Pergunta ao servidor qual será o próximo número (só espia, não reserva).
  async function carregarProximo() {
    try {
      var r = await fetch(BASE + '/pesagens?apenas=proximo', { headers: await cabecalhos() });
      var c = await r.json();
      if (c && c.ok && c.proximo) {
        proximoNumero = c.proximo;
        var el = $('psg-proximo');
        if (el) el.value = proximoNumero;
      }
    } catch (e) { /* offline: o servidor numera na hora de salvar */ }
  }

  async function cabecalhos() {
    var h = { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN };
    var t = (EC.auth && EC.auth.tokenValido) ? await EC.auth.tokenValido() : '';
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  /* ===== Formulário da TARA ===== */

  // Peso com EXATAMENTE 4 casas após a vírgula (resolução da balança).
  function casas4(t) { return /^\d+[.,]\d{4}$/.test(String(t == null ? '' : t).trim()); }
  function ord(i) { return (i + 1) + 'ª'; }

  // A série é ABERTA: enquanto o último par preenchido variar mais que
  // 0,0005 g, abre-se a próxima pesagem — só fecha quando duas consecutivas
  // conferem (regra da Raisa, 2026-08-13; sem limite de 3). CADA pesagem
  // carrega data/hora, peso, umidade e temperatura próprios (F053).
  function itemNovo(comAgora) {
    return { em: comAgora ? agoraLocal() : '', g: '', um: '', te: '' };
  }
  function serieDe(alvo, k) {
    if (!Array.isArray(alvo[k.serie])) alvo[k.serie] = [itemNovo(true), itemNovo(false)];
    return alvo[k.serie];
  }
  function ajustarSerie(serie) {
    var precisa = 2;
    for (var i = 1; i < serie.length; i++) {
      var a = numDe(serie[i - 1].g), b = numDe(serie[i].g);
      if (a === null || b === null) break;
      if (Math.abs(a - b) > VARIACAO_MAX) precisa = i + 2; else break;
    }
    while (serie.length > precisa && String(serie[serie.length - 1].g).trim() === '') serie.pop();
    while (serie.length < precisa) serie.push(itemNovo(false));
  }

  // Série F053 completa (estabilização + pesagens com a regra da variação),
  // reutilizada na tara e na final. `attr` é o data-atributo do formulário
  // ('data-psg' | 'data-psgf'); os campos usam a chave composta 'serie.i.campo'.
  function htmlSerie(attr, k, alvo, rotuloEstab) {
    var serie = serieDe(alvo, k);
    ajustarSerie(serie);
    var pode2 = intervaloOk(serie[0].em, serie[1].em);
    function campoData(chave, valor) {
      return inputDataHora(attr, chave, valor);
    }
    function campoDe(i, campo, extra) {
      if (campo === 'em') {
        return inputDataHora(attr, k.serie + '.' + i + '.' + campo, serie[i][campo], extra);
      }
      var passo = campo === 'g' ? ' step="0.0001" placeholder="4 casas — ex.: 2,5860"' : ' step="0.1"';
      return '<input type="number"' + passo + ' inputmode="decimal"' +
        ' ' + attr + '="' + k.serie + '.' + i + '.' + campo + '" value="' + esc(serie[i][campo] || '') + '"' + (extra || '') + '>';
    }
    var html = '<label>' + rotuloEstab + campoData(k.estab, alvo[k.estab]) + '</label>';
    for (var i = 0; i < serie.length; i++) {
      var titulo = i === 0 ? '1ª pesagem'
        : i === 1 ? '2ª pesagem — verificação (mín. 4 h depois)'
        : ord(i) + ' pesagem — obrigatória, a anterior variou';
      html += '<p class="grupo-checks-titulo" style="margin-top:6px;">' + titulo + '</p>' +
        '<div class="grade-2">' +
        '<label>Data/hora' + campoDe(i, 'em') + '</label>' +
        // O peso da 2ª só destrava quando o intervalo de 4 h estiver cumprido.
        '<label>Peso (g)' + campoDe(i, 'g', i === 1 && !pode2 ? ' disabled' : '') + '</label>' +
        '</div>' +
        '<div class="grade-2">' +
        '<label>Umidade (%)' + campoDe(i, 'um') + '</label>' +
        '<label>Temperatura (°C)' + campoDe(i, 'te') + '</label>' +
        '</div>' +
        // Leitura ao vivo do termohigrômetro da sala de balança (eWeLink).
        '<button type="button" class="link-discreto" data-psg-amb="' + k.serie + '.' + i + '" style="margin:-6px 0 10px;">🌡️ Usar a sala de balança</button>';
      if (i === 0) html += avisoEstab(alvo[k.estab], serie[0].em);
      if (i === 1) html += avisoIntervalo(serie[0].em, serie[1].em);
    }
    // Estado do par mais recente: fechou a série, ou pede a próxima.
    var n = serie.length;
    var ua = numDe(serie[n - 2].g), ub = numDe(serie[n - 1].g);
    if (ua != null && ub != null) {
      html += Math.abs(ua - ub) > VARIACAO_MAX
        ? '<div class="alerta alerta-amarelo">⚠️ A ' + ord(n - 1) + ' pesagem variou mais que 0,0005 g da anterior — é exigida a <strong>' + ord(n) + '</strong>.</div>'
        : '<div class="alerta alerta-verde">✅ ' + ord(n - 2) + ' e ' + ord(n - 1) + ' pesagens conferem — série fechada, oficial ' + fmtG(ub) + '.</div>';
    }
    // 4 casas: aponta na hora o peso digitado errado.
    var errados = [];
    serie.forEach(function (it, j) { if (String(it.g || '').trim() !== '' && !casas4(it.g)) errados.push(ord(j)); });
    if (errados.length) {
      html += '<div class="alerta alerta-vermelho">🔢 ' + (errados.length === 1 ? 'A ' + errados[0] + ' pesagem precisa' : 'As pesagens ' + errados.join(', ') + ' precisam') + ' de exatamente 4 casas após a vírgula (ex.: 2,5860).</div>';
    }
    return html;
  }
  var CHAVES_TARA = { estab: 'testab', serie: 'tserie' };
  var CHAVES_FINAL = { estab: 'festab', serie: 'fserie' };

  // Chave composta 'serie.i.campo' → grava no item do array; simples → no objeto.
  function atribuir(alvo, chave, valor) {
    var m = chave.split('.');
    if (m.length === 3 && Array.isArray(alvo[m[0]]) && alvo[m[0]][Number(m[1])]) alvo[m[0]][Number(m[1])][m[2]] = valor;
    else alvo[chave] = valor;
  }

  // 🌡️ Puxa umidade/temperatura AO VIVO do termohigrômetro da sala de balança
  // (Sonoff via eWeLink, rota /ambiente do SGP) para a pesagem tocada.
  async function puxarAmbiente(alvo, chaveSerie, indice, rerender, botao) {
    if (!navigator.onLine) { toast('📡 Ler o termohigrômetro precisa de internet.'); return; }
    var rotulo = botao ? botao.textContent : '';
    if (botao) { botao.disabled = true; botao.textContent = '⏳ Lendo o sensor…'; }
    try {
      var resp = await fetch(BASE + '/ambiente', { headers: await cabecalhos() });
      var corpo = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      var serie = alvo[chaveSerie];
      if (!serie || !serie[indice]) return;
      // Ponto, não vírgula: input type="number" rejeita "54,4" no value.
      serie[indice].um = String(corpo.umidade);
      serie[indice].te = String(corpo.temperatura);
      toast('🌡️ ' + corpo.sensor + ': ' + String(corpo.temperatura).replace('.', ',') + ' °C · ' + String(corpo.umidade).replace('.', ',') + '% UR');
      rerender();
    } catch (e) {
      toast('🛑 Não deu para ler o sensor: ' + (e && e.message ? e.message : e));
      if (botao) { botao.disabled = false; botao.textContent = rotulo; }
    }
  }
  function ligarBotoesAmbiente(container, attrSel, alvo, rerender) {
    container.querySelectorAll('[' + attrSel + ']').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var m = btn.getAttribute(attrSel).split('.');
        puxarAmbiente(alvo, m[0], Number(m[1]), rerender, btn);
      });
    });
  }

  function renderizar() {
    var area = $('pesagens-form');
    if (!area) return;
    var sessao = (EC.storage && EC.storage.ler('sessao:atual')) || {};
    if (dados._novo !== false) {
      dados = {
        _novo: false,
        testab: '',
        balanca: EC.storage.ler(CHAVE_BALANCA) || 'ENG.B.A.01',
        tecnico: sessao.nome || ''
      };
    }

    area.innerHTML =
      '<p class="texto-apoio">O filtro é pesado <strong>por número</strong>, sem OS — o vínculo com o serviço nasce na coleta, quando o técnico usa o filtro. Estabilize (~24 h), faça a 1ª pesagem e confirme com a 2ª (~4 h depois). Com tara e final, o SGP calcula a concentração em <strong>Serviços → Particulados</strong>.</p>' +

      '<p class="grupo-checks-titulo">➕ Tara (filtro limpo)</p>' +
      // O número NÃO é digitado: vem da sequência do banco, a mesma que o SGP
      // usa (migração 0221). Só leitura, para não haver dois donos da régua.
      '<label>Nº do filtro<input type="text" id="psg-proximo" readonly value="' +
        esc(proximoNumero || 'buscando…') + '" title="Numeração automática, igual à do SGP"></label>' +
      htmlSerie('data-psg', CHAVES_TARA, dados, 'Início da estabilização') +
      '<div class="grade-2">' +
      '</div>' +
      '<div class="grade-2">' +
      '<label>Balança<input type="text" data-psg="balanca" value="' + esc(dados.balanca) + '"></label>' +
      '<label>Técnico<input type="text" data-psg="tecnico" value="' + esc(dados.tecnico) + '"></label>' +
      '</div>' +
      '<button type="button" class="botao" id="psg-salvar-tara" style="width:100%;margin-top:12px;">💾 Salvar tara no SGP</button>' +

      '<p class="grupo-checks-titulo" style="margin-top:22px;">⏳ Aguardando pesagem final</p>' +
      '<label class="oculto" id="psg-busca-rotulo">Buscar filtro<input type="search" id="psg-busca" value="' + esc(buscaPend) + '" placeholder="🔎 Nº do filtro ou OS" autocomplete="off"></label>' +
      '<div id="psg-pendentes"><div class="alerta alerta-info">Carregando a lista…</div></div>' +

      '<p class="grupo-checks-titulo" style="margin-top:22px;">✅ Últimas 10 concluídas</p>' +
      '<div id="psg-concluidas"></div>';

    area.querySelectorAll('[data-psg]').forEach(function (el) {
      var c = el.dataset.psg;
      // Os avisos (série/variação, 24 h e 4 h) atualizam no CHANGE (ao sair do
      // campo) — re-renderizar a cada tecla roubaria o foco.
      var recalcula = (c === 'testab' || c.indexOf('tserie.') === 0);
      if (el.dataset.datahora) {
        atribuir(dados, c, curtoParaIso(el.value));
        ligarDataHora(el, function (iso) { atribuir(dados, c, iso); },
          recalcula ? function () { renderizar(); renderizarListas(); } : null);
        return;
      }
      dados[c] = el.value;
      el.addEventListener('input', function () { atribuir(dados, c, el.value); });
      if (recalcula) {
        el.addEventListener('change', function () { atribuir(dados, c, el.value); renderizar(); renderizarListas(); });
      }
    });
    var busca = $('psg-busca');
    if (busca) busca.addEventListener('input', function () { buscaPend = this.value; renderizarListas(); });
    $('psg-salvar-tara').addEventListener('click', salvarTara);
    ligarBotoesAmbiente(area, 'data-psg-amb', dados, function () { renderizar(); renderizarListas(); });
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
        htmlSerie('data-psgf', CHAVES_FINAL, dadosFinal, 'Início da estabilização pós-coleta') +
        '<div class="grade-2">' +
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
    // Do mais recente para o mais antigo: manda a data da tara (quando foi
    // preenchido) e, dentro do mesmo dia, o filtro de maior número — que é o
    // último a ter sido lançado.
    }).sort(function (a, b) {
      var da = String(a.tara_data || ''), db = String(b.tara_data || '');
      if (da !== db) return db.localeCompare(da);
      return -compararFiltro(a.numero_filtro, b.numero_filtro);
    });

    pend.innerHTML = pendentes.length
      ? pendentes.map(itemPendente).join('')
      : '<div class="alerta alerta-info">' + (t ? 'Nenhum filtro encontrado para essa busca.' : 'Nenhum filtro aguardando pesagem final.') + '</div>';

    conc.innerHTML = lista.concluidas.length
      // .slice(10): o servidor já manda 10, mas um app com cache antigo pode
      // ter guardado 30 — a tela mostra 10 de qualquer jeito.
      ? lista.concluidas.slice(0, 10).map(function (p) {
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
        dadosFinal = { festab: '', fserie: [itemNovo(true), itemNovo(false)] };
        renderizarListas();
      });
    });
    pend.querySelectorAll('[data-psgf]').forEach(function (el) {
      var c = el.dataset.psgf;
      // Avisos no CHANGE, pelo mesmo motivo do formulário da tara (foco).
      var recalcula = (c === 'festab' || c.indexOf('fserie.') === 0);
      if (el.dataset.datahora) {
        atribuir(dadosFinal, c, curtoParaIso(el.value));
        ligarDataHora(el, function (iso) { atribuir(dadosFinal, c, iso); },
          recalcula ? function () { renderizarListas(); } : null);
        return;
      }
      dadosFinal[c] = el.value;
      el.addEventListener('input', function () { atribuir(dadosFinal, c, el.value); });
      if (recalcula) {
        el.addEventListener('change', function () { atribuir(dadosFinal, c, el.value); renderizarListas(); });
      }
    });
    var btnF = $('psg-salvar-final');
    if (btnF) btnF.addEventListener('click', salvarFinal);
    ligarBotoesAmbiente(pend, 'data-psg-amb', dadosFinal, renderizarListas);
  }

  /* ===== Salvar (exige internet) ===== */

  // Série completa: cada pesagem com data/hora, peso (4 casas), umidade e
  // temperatura; datas em ordem; o último par conferindo (senão está aberta).
  function erroSerie(rotulo, serie) {
    for (var i = 0; i < serie.length; i++) {
      var it = serie[i] || {};
      if (!String(it.em || '').trim()) return 'Informe a data/hora da ' + ord(i) + ' pesagem ' + rotulo + '.';
      if (!String(it.g || '').trim()) return 'Informe o peso da ' + ord(i) + ' pesagem ' + rotulo + '.';
      if (!casas4(it.g)) return 'A ' + ord(i) + ' pesagem ' + rotulo + ' precisa de exatamente 4 casas após a vírgula (ex.: 2,5860).';
      var v = numDe(it.g);
      if (v === null || v <= 0) return 'A ' + ord(i) + ' pesagem ' + rotulo + ' é inválida.';
      if (numDe(it.um) === null) return 'Informe a umidade da ' + ord(i) + ' pesagem ' + rotulo + '.';
      if (numDe(it.te) === null) return 'Informe a temperatura da ' + ord(i) + ' pesagem ' + rotulo + '.';
      if (i > 0 && new Date(it.em).getTime() < new Date(serie[i - 1].em).getTime()) {
        return 'A ' + ord(i) + ' pesagem ' + rotulo + ' está antes da anterior — confira as datas.';
      }
    }
    var n = serie.length;
    if (Math.abs(numDe(serie[n - 1].g) - numDe(serie[n - 2].g)) > VARIACAO_MAX) {
      return 'A ' + ord(n - 1) + ' pesagem ' + rotulo + ' variou mais que 0,0005 g — a série só fecha quando duas consecutivas conferirem.';
    }
    return '';
  }
  // Série no formato do servidor: {em, g, umidade, temperatura} por pesagem.
  function seriePayload(serie) {
    return serie.map(function (it) {
      return { em: it.em, g: it.g, umidade: it.um, temperatura: it.te };
    });
  }

  async function salvarTara() {
    var btn = $('psg-salvar-tara');
    // Sem número: quem numera é o banco (sequência única com o SGP).
    var serieT = serieDe(dados, CHAVES_TARA);
    var erro = erroSerie('da tara', serieT);
    if (erro) { toast(erro); return; }
    var eEstab = erroEstab(dados.testab, serieT[0].em, 'da tara');
    if (eEstab) { toast(eEstab); return; }
    var eInt = erroIntervalo(serieT[0].em, serieT[1].em, 'da tara');
    if (eInt) { toast(eInt); return; }
    if (!navigator.onLine) { toast('📡 Salvar a pesagem precisa de internet.'); return; }

    btn.disabled = true; btn.textContent = '⏳ Salvando…';
    try {
      var resp = await fetch(BASE + '/pesagens', {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({
          acao: 'tara',
          pesagem: {
            numero_filtro: '',
            tara_estab_inicio: dados.testab || null,
            tara_serie: seriePayload(serieT),
            balanca: dados.balanca || '',
            tara_tecnico: dados.tecnico || ''
          }
        })
      });
      var corpo = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      if (dados.balanca) EC.storage.salvar(CHAVE_BALANCA, String(dados.balanca).trim());
      // O número quem deu foi o banco: avisa qual filtro nasceu.
      toast('✅ Tara do filtro ' + (corpo.numero_filtro || '') + ' salva — oficial ' + fmtG(corpo.tara_oficial) + '.');
      dados = { _novo: true };
      proximoNumero = '';
      renderizar();      // limpa o formulário
      carregarProximo(); // já mostra o número do PRÓXIMO filtro
      carregarLista();   // o filtro aparece em "Aguardando pesagem final"
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
    var serieF = serieDe(dadosFinal, CHAVES_FINAL);
    var erro = erroSerie('final', serieF);
    if (erro) { toast(erro); return; }
    var eEstabF = erroEstab(dadosFinal.festab, serieF[0].em, 'final');
    if (eEstabF) { toast(eEstabF); return; }
    var eIntF = erroIntervalo(serieF[0].em, serieF[1].em, 'final');
    if (eIntF) { toast(eIntF); return; }
    if (!navigator.onLine) { toast('📡 Salvar a pesagem precisa de internet.'); return; }
    // Final menor que a tara = massa negativa. Acontece em branco de campo, mas
    // quase sempre é dedo trocado — confirma antes de gravar.
    var oficialPrevia = numDe(serieF[serieF.length - 1].g); // a última fecha a série
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
            final_serie: seriePayload(serieF),
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
    proximoNumero = '';
    EC.app.mostrarTela('tela-pesagens');
    renderizar();
    carregarProximo();
    carregarLista();
  }

  return { abrir: abrir, abrirMenu: abrir };
})();
