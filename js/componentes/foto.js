/**
 * foto.js — Componente de foto: captura MÚLTIPLA + carimbo UTM + base64
 *
 * Permite até 10 fotos por campo. Cada foto: abre a câmera (input file com
 * capture), desenha num canvas e CARIMBA no canto inferior direito (UTM, nº da
 * OS, tipo de escopo e nº do ponto), nomeia o arquivo e converte para base64.
 * Mostra uma galeria de miniaturas com botão de remover em cada uma.
 *
 * Interface (namespace global EC.foto):
 *   EC.foto.criar(container, opcoes) → instância
 *     opcoes.os/tipo/ponto : compõem o carimbo e o nome do arquivo
 *     opcoes.rotuloPonto   : palavra antes do nº no carimbo (padrão 'Ponto';
 *                            ex.: 'Local' no QAR externo)
 *     opcoes.obterUtm      : função () → texto UTM para o carimbo
 *     opcoes.rotulo        : texto base do botão (padrão '📷 Tirar foto')
 *     opcoes.fotoInicial   : ARRAY de fotos salvas (ou uma foto única, p/ rascunho
 *                            antigo) para restaurar
 *     opcoes.aoCapturar    : callback (fotos) — recebe SEMPRE o ARRAY atualizado
 *                            de fotos (a cada captura ou remoção)
 *   instância.obterFotos() → array de fotos { nomeArquivo, base64, dataUrl, capturadaEm }
 *   instância.obterFoto()  → 1ª foto (compatibilidade) ou null
 *
 *   EC.foto.tem(valor) → boolean: há ao menos uma foto? (aceita array, foto
 *     única de rascunho antigo, ou vazio) — usar nas validações.
 */
window.EC = window.EC || {};

EC.foto = (function () {
  'use strict';

  const LADO_MAXIMO = 1600;  // limita a resolução p/ manter o base64 leve
  const MAX_FOTOS = 10;

  function doisDigitos(n) { return n < 10 ? '0' + n : '' + n; }

  function carimboDataHora(data) {
    return '' + data.getFullYear() + doisDigitos(data.getMonth() + 1) + doisDigitos(data.getDate())
      + '_' + doisDigitos(data.getHours()) + doisDigitos(data.getMinutes()) + doisDigitos(data.getSeconds());
  }

  // Data/hora legível para o carimbo: DD/MM/AAAA HH:MM:SS.
  function dataHoraBR(data) {
    return doisDigitos(data.getDate()) + '/' + doisDigitos(data.getMonth() + 1) + '/' + data.getFullYear()
      + ' ' + doisDigitos(data.getHours()) + ':' + doisDigitos(data.getMinutes()) + ':' + doisDigitos(data.getSeconds());
  }

  // Logo da ENGEAR desenhada no carimbo. Usa public/engear-logo.png; se não
  // existir, cai no logo-recortada.png (que já vem no app). Pré-carregada uma vez.
  const logoCarimbo = new Image();
  let logoCarimboOk = false;
  logoCarimbo.onload = function () { logoCarimboOk = true; };
  logoCarimbo.onerror = function () {
    if (logoCarimbo.src.indexOf('engear-logo') !== -1) logoCarimbo.src = 'public/logo-recortada.png';
  };
  logoCarimbo.src = 'public/engear-logo.png';

  function desenharCarimbo(ctx, largura, altura, linhas) {
    const tamanhoFonte = Math.max(14, Math.round(largura * 0.024));
    ctx.font = 'bold ' + tamanhoFonte + 'px Arial, sans-serif';
    const alturaLinha = Math.round(tamanhoFonte * 1.35);
    const margemInterna = Math.round(tamanhoFonte * 0.7);
    const margemBorda = Math.round(tamanhoFonte * 0.8);

    let larguraTexto = 0;
    linhas.forEach(function (linha) { larguraTexto = Math.max(larguraTexto, ctx.measureText(linha).width); });

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

  // Marca d'água: a logo da ENGEAR recolorida para BRANCO, discreta e
  // semitransparente, no canto inferior esquerdo — sem caixa, quase sem ocupar
  // espaço. (recolore a logo colorida via composição source-in.)
  function desenharMarcaDagua(ctx, largura, altura) {
    if (!(logoCarimboOk && logoCarimbo.naturalWidth)) return;
    const w = Math.round(largura * 0.13);
    const h = Math.round(logoCarimbo.naturalHeight * (w / logoCarimbo.naturalWidth));
    let branca;
    try {
      branca = document.createElement('canvas');
      branca.width = w; branca.height = h;
      const bctx = branca.getContext('2d');
      bctx.drawImage(logoCarimbo, 0, 0, w, h);
      bctx.globalCompositeOperation = 'source-in';
      bctx.fillStyle = '#ffffff';
      bctx.fillRect(0, 0, w, h);
    } catch (e) { return; }
    const margem = Math.round(largura * 0.02);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(branca, margem, altura - h - margem, w, h);
    ctx.restore();
  }

  // Abre a foto em tela cheia (para conferir). Toque/clique em qualquer lugar fecha.
  function abrirLightbox(dataUrl) {
    const ov = document.createElement('div');
    ov.className = 'foto-lightbox';
    ov.innerHTML = '<img src="' + dataUrl + '" alt="Foto ampliada">' +
      '<button type="button" class="foto-lightbox-fechar" aria-label="Fechar">✕</button>';
    ov.addEventListener('click', function () { ov.remove(); });
    document.body.appendChild(ov);
  }

  // Há pelo menos uma foto? Aceita array, foto única (rascunho antigo) ou vazio.
  function tem(valor) {
    if (!valor) return false;
    if (Array.isArray(valor)) return valor.length > 0;
    return true;
  }

  function criar(container, opcoes) {
    opcoes = opcoes || {};
    const rotuloBase = opcoes.rotulo || '📷 Tirar foto';
    let fotos = [];
    if (opcoes.fotoInicial) {
      fotos = Array.isArray(opcoes.fotoInicial) ? opcoes.fotoInicial.slice() : [opcoes.fotoInicial];
    }

    container.innerHTML =
      '<div class="comp-foto">' +
      '  <div class="foto-galeria"></div>' +
      '  <button type="button" class="botao botao-secundario foto-botao"></button>' +
      '  <input type="file" accept="image/*" capture="environment" class="foto-entrada" hidden>' +
      '  <div class="foto-status"></div>' +
      '</div>';

    const botao = container.querySelector('.foto-botao');
    const entrada = container.querySelector('.foto-entrada');
    const status = container.querySelector('.foto-status');
    const galeria = container.querySelector('.foto-galeria');

    function notificar() { if (typeof opcoes.aoCapturar === 'function') opcoes.aoCapturar(fotos.slice()); }

    function atualizarBotao() {
      botao.textContent = rotuloBase + ' (' + fotos.length + '/' + MAX_FOTOS + ')';
      botao.disabled = fotos.length >= MAX_FOTOS;
    }

    function renderGaleria() {
      galeria.innerHTML = fotos.map(function (f, i) {
        return '<div class="foto-item"><img src="' + f.dataUrl + '" alt="Foto ' + (i + 1) + '">' +
          '<button type="button" class="foto-remover" data-i="' + i + '" title="Remover foto">✕</button></div>';
      }).join('');
      galeria.querySelectorAll('.foto-remover').forEach(function (b) {
        b.addEventListener('click', function () {
          fotos.splice(parseInt(b.dataset.i, 10), 1);
          renderGaleria(); atualizarBotao(); notificar();
        });
      });
      galeria.querySelectorAll('.foto-item img').forEach(function (img, i) {
        img.addEventListener('click', function () { abrirLightbox(fotos[i].dataUrl); });
      });
    }

    botao.addEventListener('click', function () { if (fotos.length < MAX_FOTOS) entrada.click(); });

    entrada.addEventListener('change', function () {
      const arquivo = entrada.files && entrada.files[0];
      if (!arquivo) return;
      status.textContent = '⏳ Processando a foto…';

      const leitor = new FileReader();
      leitor.onload = function () {
        const imagem = new Image();
        imagem.onload = function () {
          const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
          const largura = Math.round(imagem.width * escala);
          const altura = Math.round(imagem.height * escala);

          const canvas = document.createElement('canvas');
          canvas.width = largura;
          canvas.height = altura;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(imagem, 0, 0, largura, altura);

          const textoUtm = (typeof opcoes.obterUtm === 'function' && opcoes.obterUtm()) || 'UTM não capturado';
          const agora = new Date();
          const linhasCarimbo = [];
          linhasCarimbo.push('OS ' + (opcoes.os || '—'));
          if (opcoes.projeto) linhasCarimbo.push('Projeto: ' + opcoes.projeto);
          linhasCarimbo.push('UTM ' + textoUtm);
          linhasCarimbo.push(opcoes.tipo || '—');
          linhasCarimbo.push((opcoes.rotuloPonto || 'Ponto') + ' ' + (opcoes.ponto || '—'));
          linhasCarimbo.push(dataHoraBR(agora));
          desenharCarimbo(ctx, largura, altura, linhasCarimbo);
          desenharMarcaDagua(ctx, largura, altura);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          fotos.push({
            nomeArquivo: 'OS_' + (opcoes.os || 'SEM-OS') + '_' + (opcoes.tipo || 'SEM-TIPO') + '_'
              + (opcoes.ponto || 'P0') + '_' + carimboDataHora(agora) + '_F' + doisDigitos(fotos.length + 1) + '.jpg',
            base64: dataUrl.split(',')[1],
            dataUrl: dataUrl,
            capturadaEm: agora.toISOString()
          });

          renderGaleria();
          atualizarBotao();
          status.textContent = '✅ Foto carimbada e adicionada (' + fotos.length + '/' + MAX_FOTOS + ').';
          entrada.value = '';
          notificar();
        };
        imagem.onerror = function () { status.innerHTML = '<span class="texto-erro">⚠️ Não foi possível ler a imagem.</span>'; };
        imagem.src = leitor.result;
      };
      leitor.onerror = function () { status.innerHTML = '<span class="texto-erro">⚠️ Falha ao abrir o arquivo da foto.</span>'; };
      leitor.readAsDataURL(arquivo);
    });

    renderGaleria();
    atualizarBotao();

    return {
      obterFotos: function () { return fotos.slice(); },
      obterFoto: function () { return fotos[0] || null; } // compatibilidade
    };
  }

  return { criar: criar, tem: tem };
})();
