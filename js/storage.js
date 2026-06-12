/**
 * storage.js — Utilitários de localStorage do eCamp
 *
 * Convenção de chaves por prefixo:
 *   sessao:    — sessão do técnico logado e senha salva no dispositivo
 *   rascunho:  — rascunhos de preenchimento (snapshot dos formulários)
 *   historico: — registros de monitoramento finalizados
 *   pending:   — fila de registros aguardando sincronização (offline)
 *
 * Interface (namespace global EC.storage):
 *   salvar(chave, valor)  → true/false — serializa `valor` em JSON e grava
 *   ler(chave)            → valor desserializado, ou null se não existir ou der erro
 *   listar(prefixo)       → [{ chave, valor }] de todas as chaves que começam com o prefixo
 *   remover(chave)        → true/false
 *
 * Todas as funções usam try/catch: uma falha do localStorage (cota cheia,
 * modo privado etc.) nunca derruba o app — só registra no console.
 */
window.EC = window.EC || {};

EC.storage = (function () {
  'use strict';

  function salvar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (erro) {
      console.error('storage.salvar falhou para a chave "' + chave + '":', erro);
      return false;
    }
  }

  function ler(chave) {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto === null ? null : JSON.parse(bruto);
    } catch (erro) {
      console.error('storage.ler falhou para a chave "' + chave + '":', erro);
      return null;
    }
  }

  function listar(prefixo) {
    const itens = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const chave = localStorage.key(i);
        if (chave && chave.indexOf(prefixo) === 0) {
          itens.push({ chave: chave, valor: ler(chave) });
        }
      }
    } catch (erro) {
      console.error('storage.listar falhou para o prefixo "' + prefixo + '":', erro);
    }
    return itens;
  }

  function remover(chave) {
    try {
      localStorage.removeItem(chave);
      return true;
    } catch (erro) {
      console.error('storage.remover falhou para a chave "' + chave + '":', erro);
      return false;
    }
  }

  return { salvar: salvar, ler: ler, listar: listar, remover: remover };
})();
