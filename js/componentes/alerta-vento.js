/**
 * alerta-vento.js — Alerta de vento ≥ 5 m/s (seção 12.2 da especificação)
 *
 * Regra: não é aceito monitoramento com vento de 5 m/s ou mais. Quando o
 * valor digitado atinge o limite, aparece o alerta amarelo:
 * "Esperar o vento abaixar. Não é aceito monitoramento com vento acima de 5 m/s."
 *
 * Interface (namespace global EC.alertaVento):
 *   EC.alertaVento.avaliar(valor) → true se deve alertar (valor ≥ 5), false se não
 *     (função pura — os formulários podem usá-la com seus próprios campos)
 *   EC.alertaVento.criar(container, opcoes) → instância
 *     container        : HTMLElement; desenha o campo "Vento (m/s)" + área de alerta
 *     opcoes.aoAvaliar : callback opcional (alerta:boolean, valor:number|null)
 *   instância.obterValor() → número digitado ou null
 *   instância.emAlerta()   → boolean
 */
window.EC = window.EC || {};

EC.alertaVento = (function () {
  'use strict';

  const LIMITE_MS = 5; // m/s

  const MENSAGEM = 'Esperar o vento abaixar. Não é aceito monitoramento com vento acima de 5 m/s.';

  function avaliar(valor) {
    return typeof valor === 'number' && !isNaN(valor) && valor >= LIMITE_MS;
  }

  function criar(container, opcoes) {
    opcoes = opcoes || {};

    container.innerHTML =
      '<div class="comp-vento">' +
      '  <label>Vento (m/s)<input type="number" step="0.1" min="0" inputmode="decimal" class="vento-valor" placeholder="ex.: 3,2"></label>' +
      '  <div class="alerta alerta-amarelo vento-alerta oculto">⚠️ ' + MENSAGEM + '</div>' +
      '</div>';

    const campo = container.querySelector('.vento-valor');
    const alerta = container.querySelector('.vento-alerta');
    let emAlerta = false;

    campo.addEventListener('input', function () {
      const valor = campo.value === '' ? null : parseFloat(campo.value.replace(',', '.'));
      emAlerta = avaliar(valor);
      alerta.classList.toggle('oculto', !emAlerta);
      if (typeof opcoes.aoAvaliar === 'function') opcoes.aoAvaliar(emAlerta, valor);
    });

    return {
      obterValor: function () {
        return campo.value === '' ? null : parseFloat(campo.value.replace(',', '.'));
      },
      emAlerta: function () { return emAlerta; }
    };
  }

  return { criar: criar, avaliar: avaliar };
})();
