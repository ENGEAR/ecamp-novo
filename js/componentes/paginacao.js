/**
 * paginacao.js — Paginação de pontos (P1, P2, … Pn)
 *
 * Componente que gerencia a navegação entre pontos de monitoramento. Os
 * formulários de campo (Fases 2 e 4) o reutilizam para trocar o conteúdo
 * exibido conforme o ponto ativo.
 *
 * Interface (namespace global EC.paginacao):
 *   EC.paginacao.criar(container, opcoes) → instância
 *     container       : HTMLElement onde o componente é desenhado
 *     opcoes.total    : quantidade de pontos (ex.: 5 → P1…P5)
 *     opcoes.rotulo   : prefixo dos pontos (opcional, padrão 'P')
 *     opcoes.aoMudar  : callback (numero) chamado ao trocar de ponto — numero é
 *                       1-based (P1 = 1). Também é chamado uma vez na criação.
 *   instância.atual()          → número do ponto ativo (1-based)
 *   instância.irPara(n)        → ativa o ponto n (ignora fora do intervalo)
 *   instância.definirTotal(n)  → redesenha com nova quantidade de pontos
 */
window.EC = window.EC || {};

EC.paginacao = (function () {
  'use strict';

  function criar(container, opcoes) {
    opcoes = opcoes || {};
    const rotulo = opcoes.rotulo || 'P';
    let total = Math.max(1, opcoes.total || 1);
    let atual = 1;

    function notificar() {
      if (typeof opcoes.aoMudar === 'function') opcoes.aoMudar(atual);
    }

    function desenhar() {
      let chips = '';
      for (let i = 1; i <= total; i++) {
        chips += '<button type="button" class="pag-chip' + (i === atual ? ' pag-chip-ativo' : '') +
          '" data-ponto="' + i + '">' + rotulo + i + '</button>';
      }
      container.innerHTML =
        '<div class="comp-paginacao">' +
        '  <button type="button" class="pag-seta pag-anterior" title="Ponto anterior"' + (atual === 1 ? ' disabled' : '') + '>‹</button>' +
        '  <div class="pag-chips">' + chips + '</div>' +
        '  <button type="button" class="pag-seta pag-proximo" title="Próximo ponto"' + (atual === total ? ' disabled' : '') + '>›</button>' +
        '</div>';

      container.querySelector('.pag-anterior').addEventListener('click', function () { irPara(atual - 1); });
      container.querySelector('.pag-proximo').addEventListener('click', function () { irPara(atual + 1); });
      container.querySelectorAll('.pag-chip').forEach(function (chip) {
        chip.addEventListener('click', function () { irPara(parseInt(chip.dataset.ponto, 10)); });
      });
    }

    function irPara(n) {
      if (n < 1 || n > total || n === atual) return;
      atual = n;
      desenhar();
      notificar();
    }

    function definirTotal(n) {
      total = Math.max(1, n);
      if (atual > total) atual = total;
      desenhar();
      notificar();
    }

    desenhar();
    notificar();

    return {
      atual: function () { return atual; },
      irPara: irPara,
      definirTotal: definirTotal
    };
  }

  return { criar: criar };
})();
