/**
 * gps.js — Componente de GPS: captura + conversão UTM + endereço
 *
 * O que faz: desenha o botão "📍 Capturar GPS automaticamente", lê a posição
 * via navigator.geolocation, converte lat/lon para UTM (zona, Leste, Norte —
 * WGS84), mostra a precisão em metros e preenche o campo de endereço completo
 * via geocodificação reversa (MOCK nesta fase; rota /geocode real na Fase 7).
 *
 * Interface (namespace global EC.gps):
 *   EC.gps.criar(container, opcoes) → instância
 *     container          : HTMLElement onde o componente é desenhado
 *     opcoes.aoCapturar  : callback opcional, recebe os dados após captura ok
 *   instância.obterDados() → null ou {
 *     lat, lon, precisao (m),
 *     utm: { zona, hemisferio, leste, norte },
 *     endereco (string, editável pelo usuário),
 *     textoUtm (ex.: "23K 612345 E 7791234 N")
 *   }
 *   instância.textoCarimbo() → texto UTM curto para o carimbo de foto, ou ''
 *
 *   EC.gps.latLonParaUtm(lat, lon) → { zona, hemisferio, leste, norte }
 *   EC.gps.geocodificarReverso(lat, lon) → Promise<string>  *** MOCK na Fase 0 ***
 */
window.EC = window.EC || {};

EC.gps = (function () {
  'use strict';

  /**
   * Conversão lat/lon (graus, WGS84) → UTM, implementação enxuta sem
   * biblioteca (fórmulas clássicas de Snyder / Transverse Mercator).
   * Precisão típica < 1 m, suficiente para os pontos de monitoramento.
   */
  function latLonParaUtm(lat, lon) {
    const a = 6378137.0;                 // semieixo maior WGS84 (m)
    const f = 1 / 298.257223563;         // achatamento WGS84
    const k0 = 0.9996;                   // fator de escala UTM
    const e2 = f * (2 - f);              // excentricidade²
    const ep2 = e2 / (1 - e2);           // excentricidade²'

    const zona = Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1));
    const lon0 = ((zona - 1) * 6 - 180 + 3) * Math.PI / 180; // meridiano central
    const phi = lat * Math.PI / 180;
    const lam = lon * Math.PI / 180;

    const senPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const N = a / Math.sqrt(1 - e2 * senPhi * senPhi);
    const T = Math.tan(phi) * Math.tan(phi);
    const C = ep2 * cosPhi * cosPhi;
    const A = cosPhi * (lam - lon0);

    const M = a * (
      (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
      + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
      - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi)
    );

    const leste = k0 * N * (
      A + (1 - T + C) * Math.pow(A, 3) / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120
    ) + 500000;

    let norte = k0 * (
      M + N * Math.tan(phi) * (
        A * A / 2
        + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
        + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720
      )
    );

    const hemisferio = lat >= 0 ? 'N' : 'S';
    if (lat < 0) norte += 10000000; // falso norte no hemisfério sul

    return {
      zona: zona,
      hemisferio: hemisferio,
      leste: Math.round(leste),
      norte: Math.round(norte)
    };
  }

  /**
   * Geocodificação reversa (lat/lon → endereço).
   * *** MOCK da Fase 0: devolve um endereço de exemplo após pequena espera. ***
   * Na Fase 7, trocar o corpo desta função pela chamada à rota /geocode do
   * Cloudflare Worker — a assinatura (Promise<string>) permanece a mesma.
   */
  function geocodificarReverso(lat, lon) {
    return new Promise(function (resolver) {
      setTimeout(function () {
        resolver('Rua Exemplo, 123 — Bairro Modelo, Belo Horizonte/MG, 30000-000 (endereço de teste — Fase 7 liga o /geocode real)');
      }, 400);
    });
  }

  function criar(container, opcoes) {
    opcoes = opcoes || {};
    let dados = null;

    container.innerHTML =
      '<div class="comp-gps">' +
      '  <button type="button" class="botao botao-secundario gps-botao">📍 Capturar GPS automaticamente</button>' +
      '  <div class="gps-status"></div>' +
      '  <div class="grade-3">' +
      '    <label>Zona<input type="text" class="gps-zona" readonly placeholder="—"></label>' +
      '    <label>Leste (E)<input type="text" class="gps-leste" readonly placeholder="—"></label>' +
      '    <label>Norte (N)<input type="text" class="gps-norte" readonly placeholder="—"></label>' +
      '  </div>' +
      '  <label>Endereço completo<input type="text" class="gps-endereco" placeholder="Rua, número, bairro, cidade/UF"></label>' +
      '</div>';

    const botao = container.querySelector('.gps-botao');
    const status = container.querySelector('.gps-status');
    const campoZona = container.querySelector('.gps-zona');
    const campoLeste = container.querySelector('.gps-leste');
    const campoNorte = container.querySelector('.gps-norte');
    const campoEndereco = container.querySelector('.gps-endereco');

    campoEndereco.addEventListener('input', function () {
      if (dados) dados.endereco = campoEndereco.value;
    });

    botao.addEventListener('click', function () {
      if (!navigator.geolocation) {
        status.innerHTML = '<span class="texto-erro">Este dispositivo não oferece geolocalização.</span>';
        return;
      }
      status.textContent = '⏳ Obtendo posição… (autorize o acesso à localização)';
      botao.disabled = true;

      navigator.geolocation.getCurrentPosition(
        function (posicao) {
          const lat = posicao.coords.latitude;
          const lon = posicao.coords.longitude;
          const precisao = Math.round(posicao.coords.accuracy);
          const utm = latLonParaUtm(lat, lon);

          dados = {
            lat: lat,
            lon: lon,
            precisao: precisao,
            utm: utm,
            endereco: campoEndereco.value,
            textoUtm: utm.zona + utm.hemisferio + ' ' + utm.leste + ' E ' + utm.norte + ' N'
          };

          campoZona.value = utm.zona + utm.hemisferio;
          campoLeste.value = utm.leste + ' m';
          campoNorte.value = utm.norte + ' m';
          status.innerHTML = '✅ GPS capturado — precisão de <strong>' + precisao + ' m</strong>';
          botao.disabled = false;

          geocodificarReverso(lat, lon).then(function (endereco) {
            // só preenche se o usuário ainda não digitou nada
            if (!campoEndereco.value) {
              campoEndereco.value = endereco;
              dados.endereco = endereco;
            }
          });

          if (typeof opcoes.aoCapturar === 'function') opcoes.aoCapturar(dados);
        },
        function (erro) {
          const mensagens = {
            1: 'Permissão de localização negada. Libere o acesso nas configurações do navegador.',
            2: 'Posição indisponível no momento. Tente em local mais aberto.',
            3: 'Tempo esgotado ao obter a posição. Tente novamente.'
          };
          status.innerHTML = '<span class="texto-erro">⚠️ ' + (mensagens[erro.code] || 'Erro ao capturar o GPS.') + '</span>';
          botao.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });

    return {
      obterDados: function () { return dados; },
      textoCarimbo: function () { return dados ? dados.textoUtm : ''; }
    };
  }

  return {
    criar: criar,
    latLonParaUtm: latLonParaUtm,
    geocodificarReverso: geocodificarReverso
  };
})();
