/**
 * db.js — Armazenamento OFFLINE grande (IndexedDB) para dados pesados.
 *
 * O localStorage é pequeno (~5 MB) e estoura com fotos em base64. O IndexedDB
 * guarda centenas de MB e funciona 100% offline. Usado para:
 *   • 'pending'          — fila de registros (com fotos) esperando enviar ao servidor;
 *   • 'rascunhos'        — rascunhos completos (com fotos) para continuar depois;
 *   • 'pendingReembolso' — fila de pedidos de reembolso (com fotos) esperando enviar;
 *   • 'pdfs'             — PDFs gerados (Blob + metadados) guardados no aparelho.
 *
 * API (todas devolvem Promise):
 *   EC.db.set(loja, chave, valor) · EC.db.get(loja, chave)
 *   EC.db.remove(loja, chave)     · EC.db.keys(loja) · EC.db.getAll(loja)
 *   EC.db.disponivel() → boolean
 */
window.EC = window.EC || {};

EC.db = (function () {
  'use strict';

  var NOME = 'ecamp';
  var VERSAO = 3; // v3: + loja 'pdfs'
  var LOJAS = ['pending', 'rascunhos', 'pendingReembolso', 'pdfs'];
  var bancoP = null;

  function abrir() {
    if (bancoP) return bancoP;
    bancoP = new Promise(function (resolve, reject) {
      var req = indexedDB.open(NOME, VERSAO);
      req.onupgradeneeded = function () {
        var db = req.result;
        LOJAS.forEach(function (loja) {
          if (!db.objectStoreNames.contains(loja)) db.createObjectStore(loja);
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return bancoP;
  }

  // Executa fn(store) dentro de uma transação e resolve com o resultado da operação.
  function operar(loja, modo, fn) {
    return abrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(loja, modo);
        var pedido = fn(t.objectStore(loja));
        var resultado;
        if (pedido) pedido.onsuccess = function () { resultado = pedido.result; };
        t.oncomplete = function () { resolve(resultado); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  return {
    set: function (loja, chave, valor) { return operar(loja, 'readwrite', function (s) { return s.put(valor, chave); }); },
    get: function (loja, chave) { return operar(loja, 'readonly', function (s) { return s.get(chave); }); },
    remove: function (loja, chave) { return operar(loja, 'readwrite', function (s) { return s.delete(chave); }); },
    keys: function (loja) { return operar(loja, 'readonly', function (s) { return s.getAllKeys(); }); },
    getAll: function (loja) { return operar(loja, 'readonly', function (s) { return s.getAll(); }); },
    disponivel: function () { return typeof indexedDB !== 'undefined'; }
  };
})();
