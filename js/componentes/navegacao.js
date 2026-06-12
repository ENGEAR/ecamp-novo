/**
 * navegacao.js — Botões padrão de navegação das telas de preenchimento
 * (💾 Salvar rascunho · ← Voltar · Próximo →)
 *
 * Interface (namespace global EC.navegacao):
 *   EC.navegacao.criar(container, opcoes) → instância
 *     container            : HTMLElement onde os botões são desenhados
 *     opcoes.aoVoltar      : callback do "← Voltar"   (omitir → botão não aparece)
 *     opcoes.aoProximo     : callback do "Próximo →"  (omitir → botão não aparece)
 *     opcoes.obterDados    : função () → objeto com o snapshot a salvar como rascunho
 *     opcoes.chaveRascunho : identificador do rascunho, na codificação
 *                            OS_[NºOS]_[TIPO]_[PONTO] (o componente acrescenta
 *                            _[AAAAMMDD_HHMMSS] no primeiro salvamento e reutiliza
 *                            a mesma chave nos seguintes, atualizando o conteúdo)
 *
 * Comportamento do "💾 Salvar rascunho": grava { dados, salvoEm } em
 * localStorage com prefixo 'rascunho:' e mostra o feedback verde
 * "✅ Rascunho salvo!" por 2 segundos. Nesta fase é o snapshot básico;
 * a restauração robusta (reabrir e continuar) entra na Fase 5.
 */
window.EC = window.EC || {};

EC.navegacao = (function () {
  'use strict';

  function doisDigitos(n) { return n < 10 ? '0' + n : '' + n; }

  function carimboDataHora(data) {
    return '' + data.getFullYear() + doisDigitos(data.getMonth() + 1) + doisDigitos(data.getDate())
      + '_' + doisDigitos(data.getHours()) + doisDigitos(data.getMinutes()) + doisDigitos(data.getSeconds());
  }

  function criar(container, opcoes) {
    opcoes = opcoes || {};
    let chaveCompleta = null; // definida no primeiro salvamento

    container.innerHTML =
      '<div class="comp-navegacao">' +
      '  <button type="button" class="botao botao-rascunho nav-rascunho">💾 Salvar rascunho</button>' +
      '  <div class="nav-linha">' +
      (opcoes.aoVoltar ? '    <button type="button" class="botao botao-secundario nav-voltar">← Voltar</button>' : '') +
      (opcoes.aoProximo ? '    <button type="button" class="botao botao-primario nav-proximo">Próximo →</button>' : '') +
      '  </div>' +
      '</div>';

    const botaoRascunho = container.querySelector('.nav-rascunho');
    const botaoVoltar = container.querySelector('.nav-voltar');
    const botaoProximo = container.querySelector('.nav-proximo');

    if (botaoVoltar) botaoVoltar.addEventListener('click', function () { opcoes.aoVoltar(); });
    if (botaoProximo) botaoProximo.addEventListener('click', function () { opcoes.aoProximo(); });

    botaoRascunho.addEventListener('click', function () {
      const dados = (typeof opcoes.obterDados === 'function') ? opcoes.obterDados() : {};
      if (!chaveCompleta) {
        const base = opcoes.chaveRascunho || 'rascunho-sem-identificacao';
        chaveCompleta = 'rascunho:' + base + '_' + carimboDataHora(new Date());
      }
      const gravou = EC.storage.salvar(chaveCompleta, {
        dados: dados,
        salvoEm: new Date().toISOString()
      });

      if (gravou) {
        botaoRascunho.textContent = '✅ Rascunho salvo!';
        botaoRascunho.classList.add('botao-rascunho-ok');
        setTimeout(function () {
          botaoRascunho.textContent = '💾 Salvar rascunho';
          botaoRascunho.classList.remove('botao-rascunho-ok');
        }, 2000);
      } else {
        botaoRascunho.textContent = '⚠️ Falha ao salvar';
        setTimeout(function () {
          botaoRascunho.textContent = '💾 Salvar rascunho';
        }, 2000);
      }
    });

    return {
      chaveRascunho: function () { return chaveCompleta; }
    };
  }

  return { criar: criar };
})();
