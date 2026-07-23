/**
 * checagens.js — Validação de diferença entre checagens de ruído (seção 12.1)
 *
 * Regra: cada checagem tem um sinal (+/-) e um valor em dB. O sinal é aplicado
 * ao valor, calcula-se diff = round(|fim − ini| × 100) / 100 e, se
 * diff > 0,5 dB, exibe-se o alerta vermelho pedindo para repetir o
 * monitoramento. Dispara ao digitar o valor OU ao alterar o sinal.
 * ATENÇÃO ao limite (definido pela Raisa em 2026-07-22): 0,50 dB EXATO está
 * DENTRO do limite; só ACIMA de 0,5 dB é que reprova (é `>`, não `>=`).
 * Exemplo: ini = −0,10 e fim = +0,45 → diff = 0,55 → ALERTA (0,55 > 0,5).
 *
 * Interface (namespace global EC.checagens):
 *   EC.checagens.calcular(sinalIni, valorIni, sinalFim, valorFim) → { diff, alerta }
 *     sinal : '+' ou '-' ; valor : número em dB (sempre positivo no campo)
 *     diff  : número com 2 casas ; alerta : true se diff > 0,5 (0,50 é aprovado)
 *     (função pura — os formulários podem usá-la com seus próprios campos)
 *   EC.checagens.criar(container, opcoes) → instância
 *     container        : HTMLElement; desenha checagem inicial + final + alerta
 *     opcoes.aoCalcular: callback opcional ({ diff, alerta }) a cada recálculo
 *   instância.obterDados() → {
 *     ini: { sinal, valor }, fim: { sinal, valor }, diff, alerta
 *   } (diff/alerta nulos enquanto os dois valores não estiverem preenchidos)
 */
window.EC = window.EC || {};

EC.checagens = (function () {
  'use strict';

  const LIMITE_DB = 0.5;

  /* ---------- Séries de checagem (blocos de no máximo 10 pontos) ----------
   * Regra da Raisa (2026-07-22): a série "checagem inicial → checagem final" é
   * limitada a 10 pontos. Acima disso os pontos são divididos em blocos
   * EQUILIBRADOS: nº de blocos = arredonda p/ cima total/10, tamanhos o mais
   * iguais possível. Ex.: 14 → 1-7 e 8-14; 21 → 1-7, 8-14, 15-21; 25 → 1-9,
   * 10-17, 18-25. (Preferido ao "10 em 10", que criava bloco órfão de 1 ponto.)
   * FICA AQUI porque a coleta (campo-ruido) e o laudo (pdf-ruido) precisam da
   * MESMA divisão — duplicar a regra faria os dois divergirem.
   * ATENÇÃO: o SGP tem uma cópia equivalente em src/lib/monitoramento/mapear.ts
   * (outro projeto); mudou aqui, mude lá.
   */
  const MAX_PONTOS_SERIE = 10;

  function blocosDaSerie(total) {
    const n = Math.max(0, parseInt(total, 10) || 0);
    if (!n) return [];
    const k = Math.ceil(n / MAX_PONTOS_SERIE);
    const base = Math.floor(n / k);
    const resto = n % k;
    const blocos = [];
    let ini = 1;
    for (let i = 0; i < k; i++) {
      const tam = base + (i < resto ? 1 : 0);
      blocos.push({ ini: ini, fim: ini + tam - 1 });
      ini += tam;
    }
    return blocos;
  }

  // Bloco a que pertence o ponto n (1-based). null se fora do intervalo.
  function blocoDoPonto(n, total) {
    const bs = blocosDaSerie(total);
    for (let i = 0; i < bs.length; i++) {
      if (n >= bs[i].ini && n <= bs[i].fim) return { ini: bs[i].ini, fim: bs[i].fim, indice: i, qtde: bs.length };
    }
    return null;
  }

  // Rótulo curto da série, ex.: "Série 2 de 3 (pontos 8–14)" ou "Série (pontos 1–7)".
  function rotuloSerie(b) {
    if (!b) return '';
    const faixa = 'pontos ' + b.ini + '–' + b.fim;
    return b.qtde > 1 ? 'Série ' + (b.indice + 1) + ' de ' + b.qtde + ' (' + faixa + ')' : 'Série (' + faixa + ')';
  }

  function calcular(sinalIni, valorIni, sinalFim, valorFim) {
    const iniReal = (sinalIni === '-' ? -1 : 1) * valorIni;
    const fimReal = (sinalFim === '-' ? -1 : 1) * valorFim;
    const diff = Math.round(Math.abs(fimReal - iniReal) * 100) / 100;
    return { diff: diff, alerta: diff > LIMITE_DB };
  }

  function blocoChecagem(titulo, classe) {
    return (
      '<fieldset class="checagem-bloco">' +
      '  <legend>' + titulo + '</legend>' +
      '  <div class="checagem-linha">' +
      '    <label>Sinal<select class="' + classe + '-sinal"><option value="+">+</option><option value="-">−</option></select></label>' +
      '    <label>Valor (dB)<input type="number" step="0.01" min="0" inputmode="decimal" class="' + classe + '-valor" placeholder="ex.: 0,10"></label>' +
      '  </div>' +
      '</fieldset>'
    );
  }

  function criar(container, opcoes) {
    opcoes = opcoes || {};

    container.innerHTML =
      '<div class="comp-checagens">' +
      blocoChecagem('Checagem inicial', 'chk-ini') +
      blocoChecagem('Checagem final', 'chk-fim') +
      '  <div class="checagem-resultado"></div>' +
      '  <div class="alerta alerta-vermelho checagem-alerta oculto"></div>' +
      '</div>';

    const sinalIni = container.querySelector('.chk-ini-sinal');
    const valorIni = container.querySelector('.chk-ini-valor');
    const sinalFim = container.querySelector('.chk-fim-sinal');
    const valorFim = container.querySelector('.chk-fim-valor');
    const resultado = container.querySelector('.checagem-resultado');
    const alerta = container.querySelector('.checagem-alerta');

    let estado = { ini: null, fim: null, diff: null, alerta: null };

    function formatarDb(numero) {
      return numero.toFixed(2).replace('.', ',');
    }

    function recalcular() {
      const vIni = valorIni.value === '' ? null : parseFloat(valorIni.value.replace(',', '.'));
      const vFim = valorFim.value === '' ? null : parseFloat(valorFim.value.replace(',', '.'));

      estado.ini = vIni === null ? null : { sinal: sinalIni.value, valor: vIni };
      estado.fim = vFim === null ? null : { sinal: sinalFim.value, valor: vFim };

      if (vIni === null || vFim === null || isNaN(vIni) || isNaN(vFim)) {
        estado.diff = null;
        estado.alerta = null;
        resultado.textContent = '';
        alerta.classList.add('oculto');
        return;
      }

      const calculo = calcular(sinalIni.value, vIni, sinalFim.value, vFim);
      estado.diff = calculo.diff;
      estado.alerta = calculo.alerta;

      if (calculo.alerta) {
        resultado.textContent = '';
        alerta.innerHTML = '🛑 <strong>Diferença entre checagens = ' + formatarDb(calculo.diff) +
          ' dB (limite: 0,5 dB).</strong> Verificar o equipamento e repetir o monitoramento do ponto.';
        alerta.classList.remove('oculto');
      } else {
        alerta.classList.add('oculto');
        resultado.innerHTML = '✅ Diferença entre checagens = <strong>' + formatarDb(calculo.diff) + ' dB</strong> — dentro do limite (0,5 dB).';
      }

      if (typeof opcoes.aoCalcular === 'function') opcoes.aoCalcular({ diff: calculo.diff, alerta: calculo.alerta });
    }

    [sinalIni, sinalFim].forEach(function (el) { el.addEventListener('change', recalcular); });
    [valorIni, valorFim].forEach(function (el) { el.addEventListener('input', recalcular); });

    return {
      obterDados: function () {
        return { ini: estado.ini, fim: estado.fim, diff: estado.diff, alerta: estado.alerta };
      }
    };
  }

  return {
    criar: criar,
    calcular: calcular,
    LIMITE_DB: LIMITE_DB,
    MAX_PONTOS_SERIE: MAX_PONTOS_SERIE,
    blocosDaSerie: blocosDaSerie,
    blocoDoPonto: blocoDoPonto,
    rotuloSerie: rotuloSerie
  };
})();
