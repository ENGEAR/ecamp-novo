/**
 * foto.js — Componente de foto: captura + carimbo UTM + nomenclatura + base64
 *
 * O que faz: abre a câmera do celular (input file com capture), desenha a
 * imagem num canvas e CARIMBA no canto inferior direito: coordenada UTM,
 * nº da OS, tipo de escopo e nº do ponto. Nomeia o arquivo com a codificação
 * OS_[NºOS]_[TIPO]_[PONTO]_[AAAAMMDD_HHMMSS].jpg e converte para base64.
 *
 * Interface (namespace global EC.foto):
 *   EC.foto.criar(container, opcoes) → instância
 *     container         : HTMLElement onde o componente é desenhado
 *     opcoes.os         : nº da OS            (ex.: '2026-0158')
 *     opcoes.tipo       : tipo de escopo      (ex.: 'RUIDOEXTERNO')
 *     opcoes.ponto      : nº do ponto         (ex.: 'P03')
 *     opcoes.obterUtm   : função () → texto UTM para o carimbo
 *                         (normalmente instânciaGps.textoCarimbo())
 *     opcoes.rotulo     : texto do botão (opcional, padrão '📷 Tirar foto')
 *     opcoes.aoCapturar : callback opcional, recebe a foto pronta
 *   instância.obterFoto() → null ou {
 *     nomeArquivo  : 'OS_2026-0158_RUIDOEXTERNO_P03_20260612_104530.jpg'
 *     base64       : conteúdo JPEG em base64 (sem o prefixo data:)
 *     dataUrl      : 'data:image/jpeg;base64,...' (para <img> e PDF)
 *     capturadaEm  : ISO 8601
 *   }
 *
 * Na Fase 0 os valores de OS/tipo/ponto chegam mockados; nas próximas fases
 * os formulários passam os valores reais.
 */
window.EC = window.EC || {};

EC.foto = (function () {
  'use strict';

  const LADO_MAXIMO = 1600; // limita a resolução p/ manter o base64 leve

  function doisDigitos(n) { return n < 10 ? '0' + n : '' + n; }

  function carimboDataHora(data) {
    return '' + data.getFullYear() + doisDigitos(data.getMonth() + 1) + doisDigitos(data.getDate())
      + '_' + doisDigitos(data.getHours()) + doisDigitos(data.getMinutes()) + doisDigitos(data.getSeconds());
  }

  function desenharCarimbo(ctx, largura, altura, linhas) {
    const tamanhoFonte = Math.max(14, Math.round(largura * 0.024));
    ctx.font = 'bold ' + tamanhoFonte + 'px Arial, sans-serif';
    const alturaLinha = Math.round(tamanhoFonte * 1.35);
    const margemInterna = Math.round(tamanhoFonte * 0.7);
    const margemBorda = Math.round(tamanhoFonte * 0.8);

    let larguraTexto = 0;
    linhas.forEach(function (linha) {
      larguraTexto = Math.max(larguraTexto, ctx.measureText(linha).width);
    });

    const caixaLargura = larguraTexto + margemInterna * 2;
    const caixaAltura = alturaLinha * linhas.length + margemInterna;
    const x = largura - caixaLargura - margemBorda;
    const y = altura - caixaAltura - margemBorda;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, y, caixaLargura, caixaAltura);

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    linhas.forEach(function (linha, i) {
      ctx.fillText(linha, x + margemInterna, y + margemInterna * 0.6 + i * alturaLinha);
    });
  }

  function criar(container, opcoes) {
    opcoes = opcoes || {};
    let foto = null;

    container.innerHTML =
      '<div class="comp-foto">' +
      '  <button type="button" class="botao botao-secundario foto-botao">' + (opcoes.rotulo || '📷 Tirar foto') + '</button>' +
      '  <input type="file" accept="image/*" capture="environment" class="foto-entrada" hidden>' +
      '  <div class="foto-status"></div>' +
      '  <img class="foto-previa oculto" alt="Prévia da foto carimbada">' +
      '  <div class="foto-nome"></div>' +
      '</div>';

    const botao = container.querySelector('.foto-botao');
    const entrada = container.querySelector('.foto-entrada');
    const status = container.querySelector('.foto-status');
    const previa = container.querySelector('.foto-previa');
    const nome = container.querySelector('.foto-nome');

    botao.addEventListener('click', function () { entrada.click(); });

    entrada.addEventListener('change', function () {
      const arquivo = entrada.files && entrada.files[0];
      if (!arquivo) return;
      status.textContent = '⏳ Processando a foto…';

      const leitor = new FileReader();
      leitor.onload = function () {
        const imagem = new Image();
        imagem.onload = function () {
          // redimensiona mantendo a proporção
          const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
          const largura = Math.round(imagem.width * escala);
          const altura = Math.round(imagem.height * escala);

          const canvas = document.createElement('canvas');
          canvas.width = largura;
          canvas.height = altura;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(imagem, 0, 0, largura, altura);

          const textoUtm = (typeof opcoes.obterUtm === 'function' && opcoes.obterUtm()) || 'UTM não capturado';
          desenharCarimbo(ctx, largura, altura, [
            'UTM ' + textoUtm,
            'OS ' + (opcoes.os || '—'),
            (opcoes.tipo || '—'),
            'Ponto ' + (opcoes.ponto || '—')
          ]);

          const agora = new Date();
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          foto = {
            nomeArquivo: 'OS_' + (opcoes.os || 'SEM-OS') + '_' + (opcoes.tipo || 'SEM-TIPO') + '_'
              + (opcoes.ponto || 'P0') + '_' + carimboDataHora(agora) + '.jpg',
            base64: dataUrl.split(',')[1],
            dataUrl: dataUrl,
            capturadaEm: agora.toISOString()
          };

          previa.src = dataUrl;
          previa.classList.remove('oculto');
          nome.textContent = '📎 ' + foto.nomeArquivo;
          status.textContent = '✅ Foto carimbada e convertida para base64.';
          entrada.value = '';

          if (typeof opcoes.aoCapturar === 'function') opcoes.aoCapturar(foto);
        };
        imagem.onerror = function () {
          status.innerHTML = '<span class="texto-erro">⚠️ Não foi possível ler a imagem.</span>';
        };
        imagem.src = leitor.result;
      };
      leitor.onerror = function () {
        status.innerHTML = '<span class="texto-erro">⚠️ Falha ao abrir o arquivo da foto.</span>';
      };
      leitor.readAsDataURL(arquivo);
    });

    return {
      obterFoto: function () { return foto; }
    };
  }

  return { criar: criar };
})();
