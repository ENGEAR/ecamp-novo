/**
 * biblioteca.js — Biblioteca de normas e procedimentos (offline).
 *
 * Lista os documentos de `self.ECAMP_BIBLIOTECA` (js/biblioteca-dados.js),
 * agrupados em Normas / Procedimentos → por escopo → por método. Os PDFs são
 * pré-guardados pelo service worker, então abrem SEM internet.
 *
 * Abre no overlay do header (EC.app.abrirOverlay). Tocar num documento abre o
 * PDF numa nova aba (o próprio navegador/visualizador cuida da exibição).
 *
 * Interface (EC.biblioteca): abrir()
 * Depende de: EC.app (abrirOverlay).
 */
window.EC = window.EC || {};

EC.biblioteca = (function () {
  'use strict';

  const TIPOS = [
    { chave: 'norma', titulo: '📘 Normas' },
    { chave: 'procedimento', titulo: '📗 Procedimentos' }
  ];
  // Ordem preferida dos escopos (os não listados vão ao fim, em ordem alfabética).
  const ORDEM_ESCOPO = ['Ruído', 'Vibração', 'QAR Externo', 'QAR Interno', 'Opacidade', 'Outro', 'Geral'];

  function docs() {
    const lista = (typeof self !== 'undefined' && self.ECAMP_BIBLIOTECA) || [];
    return Array.isArray(lista) ? lista.filter(function (d) { return d && d.arquivo && d.titulo; }) : [];
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function normalizar(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function ordenarEscopos(escopos) {
    return escopos.sort(function (a, b) {
      const ia = ORDEM_ESCOPO.indexOf(a); const ib = ORDEM_ESCOPO.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b, 'pt-BR');
    });
  }

  // Monta o HTML de um TIPO (Normas ou Procedimentos): agrupa por escopo e método.
  function htmlTipo(tipo, lista) {
    const doTipo = lista.filter(function (d) { return (d.tipo || '') === tipo.chave; });
    if (!doTipo.length) return '';

    // agrupa: escopo → método → documentos
    const porEscopo = {};
    doTipo.forEach(function (d) {
      const e = (d.escopo || 'Geral').trim() || 'Geral';
      const m = (d.metodo || '').trim();
      porEscopo[e] = porEscopo[e] || {};
      porEscopo[e][m] = porEscopo[e][m] || [];
      porEscopo[e][m].push(d);
    });

    let html = '<h2 class="bib-tipo">' + tipo.titulo + '</h2>';
    ordenarEscopos(Object.keys(porEscopo)).forEach(function (escopo) {
      html += '<p class="bib-escopo">' + escapar(escopo) + '</p>';
      const metodos = Object.keys(porEscopo[escopo]).sort(function (a, b) {
        if (!a) return 1; if (!b) return -1; return a.localeCompare(b, 'pt-BR');
      });
      metodos.forEach(function (metodo) {
        if (metodo) html += '<p class="bib-metodo">' + escapar(metodo) + '</p>';
        porEscopo[escopo][metodo]
          .sort(function (a, b) { return String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'); })
          .forEach(function (d) {
            html += '<a class="bib-doc" href="' + encodeURI(d.arquivo) + '" target="_blank" rel="noopener">' +
              '<span class="bib-doc-icone">📄</span><span class="bib-doc-titulo">' + escapar(d.titulo) + '</span>' +
              '<span class="bib-doc-abrir">Abrir ›</span></a>';
          });
      });
    });
    return html;
  }

  function corpo(filtro) {
    const todos = docs();
    if (!todos.length) {
      return '<p class="overlay-vazio">Nenhum documento na biblioteca ainda.</p>';
    }
    const q = normalizar(filtro).trim();
    const lista = !q ? todos : todos.filter(function (d) {
      return normalizar(d.titulo + ' ' + (d.escopo || '') + ' ' + (d.metodo || '')).indexOf(q) !== -1;
    });
    if (!lista.length) return '<p class="overlay-vazio">Nada encontrado para essa busca.</p>';

    const html = TIPOS.map(function (t) { return htmlTipo(t, lista); }).join('');
    return html || '<p class="overlay-vazio">Nada encontrado para essa busca.</p>';
  }

  function abrir() {
    const total = docs().length;
    EC.app.abrirOverlay('📚 Biblioteca',
      '<p class="texto-apoio">📴 Normas e procedimentos ficam salvos no aparelho — abrem sem internet.</p>' +
      (total ? '<label class="overlay-busca"><input type="search" id="bib-busca" placeholder="🔍 Buscar por título, escopo ou método…" autocomplete="off"></label>' : '') +
      '<div id="bib-lista">' + corpo('') + '</div>');

    const busca = document.getElementById('bib-busca');
    if (busca) busca.addEventListener('input', function () {
      const lista = document.getElementById('bib-lista');
      if (lista) lista.innerHTML = corpo(busca.value);
    });
  }

  return { abrir: abrir };
})();
