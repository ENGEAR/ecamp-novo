/**
 * foto.js — Componente de foto: câmera OU fototeca + carimbo + base64
 *
 * Permite até 10 fotos por campo, de duas origens:
 *   • 📷 Tirar foto     — abre a CÂMERA (input com capture); carimbo COMPLETO
 *                         (OS, Projeto, UTM, tipo, ponto, data/hora).
 *   • 🖼️ Buscar da fototeca — abre a GALERIA (input sem capture); carimbo SEM
 *                         data/hora (a foto antiga não tem o horário do momento).
 *                         A UTM só entra se o técnico já informou a coordenada do
 *                         ponto (obterUtm com valor) — OS/Projeto/tipo/ponto ficam.
 * Cada foto é redesenhada num canvas, CARIMBADA no canto inferior direito,
 * nomeada e convertida para base64. Galeria de miniaturas com remover em cada.
 *
 * Interface (namespace global EC.foto):
 *   EC.foto.criar(container, opcoes) → instância
 *     opcoes.os/tipo/ponto : compõem o carimbo e o nome do arquivo
 *     opcoes.rotuloPonto   : palavra antes do nº no carimbo (padrão 'Ponto')
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
  // Endereço da imagem: o rascunho guarda só o base64 (metade do tamanho); o
  // dataUrl é montado aqui na hora de mostrar. Fotos antigas ainda têm dataUrl.
  function urlDaFoto(f) {
    if (!f) return '';
    return f.dataUrl || (f.base64 ? 'data:image/jpeg;base64,' + f.base64 : '');
  }


  /* ===== A imagem mora na loja 'fotos' (uma por registro) ===== */

  // Guarda a imagem no aparelho, sozinha. Devolve true/false: quem chama avisa
  // o técnico quando falha — foto sem lugar para ficar é foto que se perde.
  async function guardarImagem(f, contexto) {
    if (!f || !f.nomeArquivo || !f.base64 || !EC.db || !EC.db.disponivel()) return false;
    try {
      await EC.db.set('fotos', f.nomeArquivo, {
        nomeArquivo: f.nomeArquivo,
        base64: f.base64,
        capturadaEm: f.capturadaEm || new Date().toISOString(),
        os: (contexto && contexto.os) || '',
        guardadaEm: new Date().toISOString()
      });
      return true;
    } catch (e) { return false; }
  }
  function esquecerImagem(nome) {
    if (!nome || !EC.db || !EC.db.disponivel()) return;
    EC.db.remove('fotos', nome).catch(function () { /* ok */ });
  }

  // Cópia de qualquer objeto (rascunho, registro) SEM as imagens: fica só o
  // nome do arquivo, que é a chave para achar a foto de volta.
  function semImagens(obj) {
    return JSON.parse(JSON.stringify(obj, function (chave, valor) {
      return (chave === 'base64' || chave === 'dataUrl') ? undefined : valor;
    }));
  }

  // Devolve as imagens para dentro do objeto, lendo a loja 'fotos'. Usado ao
  // continuar um rascunho, ao gerar o PDF do histórico e ao reenviar.
  // Devolve { total, achadas } — quem chama pode avisar o que não voltou.
  async function reidratar(obj) {
    var conta = { total: 0, achadas: 0 };
    if (!obj || !EC.db || !EC.db.disponivel()) return conta;
    var pendentes = [];
    (function varrer(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(varrer); return; }
      if (o.nomeArquivo && !o.base64) { conta.total++; pendentes.push(o); return; }
      if (o.nomeArquivo && o.base64) { conta.total++; conta.achadas++; return; }
      Object.keys(o).forEach(function (k) { varrer(o[k]); });
    })(obj);
    for (var i = 0; i < pendentes.length; i++) {
      try {
        var rec = await EC.db.get('fotos', pendentes[i].nomeArquivo);
        if (rec && rec.base64) { pendentes[i].base64 = rec.base64; conta.achadas++; }
      } catch (e) { /* segue: a que faltar é contada como não achada */ }
    }
    return conta;
  }

  /**
   * Garante que TODA imagem que está dentro de `obj` também exista na loja
   * 'fotos'. É o que torna seguro salvar o rascunho só com as referências — e é
   * a migração dos rascunhos antigos, que guardavam a imagem dentro de si.
   * Devolve { total, guardadas, falhas }: com falha > 0, quem chama NÃO deve
   * remover as imagens do rascunho.
   */
  async function garantirGuardadas(obj, contexto) {
    var r = { total: 0, guardadas: 0, falhas: 0 };
    if (!obj || !EC.db || !EC.db.disponivel()) return r;
    var comImagem = [];
    (function varrer(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(varrer); return; }
      if (o.nomeArquivo) { if (o.base64) comImagem.push(o); return; }
      Object.keys(o).forEach(function (k) { varrer(o[k]); });
    })(obj);
    r.total = comImagem.length;
    for (var i = 0; i < comImagem.length; i++) {
      var f = comImagem[i];
      try {
        var ja = await EC.db.get('fotos', f.nomeArquivo);
        if (ja && ja.base64) { r.guardadas++; continue; }
      } catch (e) { /* tenta gravar mesmo assim */ }
      if (await guardarImagem(f, contexto)) r.guardadas++; else r.falhas++;
    }
    return r;
  }

  // Faxina: imagens mais velhas que `dias` que não pertencem a nenhum rascunho
  // aberto. Best-effort, chamada na abertura do app.
  async function limparAntigas(dias, nomesEmUso) {
    if (!EC.db || !EC.db.disponivel()) return 0;
    var limite = Date.now() - (dias || 30) * 24 * 60 * 60 * 1000;
    var emUso = {};
    (nomesEmUso || []).forEach(function (n) { emUso[n] = 1; });
    var apagadas = 0;
    try {
      var todas = (await EC.db.getAll('fotos')) || [];
      for (var i = 0; i < todas.length; i++) {
        var f = todas[i];
        if (!f || !f.nomeArquivo || emUso[f.nomeArquivo]) continue;
        var t = Date.parse(f.guardadaEm || f.capturadaEm || '');
        if (t && t < limite) { await EC.db.remove('fotos', f.nomeArquivo); apagadas++; }
      }
    } catch (e) { /* ok */ }
    return apagadas;
  }

  /* ===== Levar as fotos para fora do app ===== */

  // ZIP "guardado" (sem compressão): JPEG já vem comprimido, então comprimir de
  // novo só gastaria bateria. Escrito aqui mesmo para não depender de nenhuma
  // biblioteca — são poucos campos, todos de tamanho fixo.
  var TABELA_CRC = null;
  function crc32(bytes) {
    if (!TABELA_CRC) {
      TABELA_CRC = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        TABELA_CRC[n] = c;
      }
    }
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ TABELA_CRC[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }
  function dataDos(d) {
    d = d || new Date();
    var hora = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
    var dia = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    return { hora: hora, dia: dia };
  }
  // arquivos: [{ nome, dados: Uint8Array, quando: Date }] → Blob .zip
  function ziparArquivos(arquivos) {
    var partes = [], central = [], deslocamento = 0;
    var texto = new TextEncoder();
    arquivos.forEach(function (a) {
      var nome = texto.encode(a.nome);
      var crc = crc32(a.dados);
      var t = dataDos(a.quando);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);   // nomes em UTF-8
      local.setUint16(8, 0, true);        // sem compressão
      local.setUint16(10, t.hora, true); local.setUint16(12, t.dia, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, a.dados.length, true);
      local.setUint32(22, a.dados.length, true);
      local.setUint16(26, nome.length, true); local.setUint16(28, 0, true);
      partes.push(local.buffer, nome, a.dados);

      var dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true); dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true); dir.setUint16(10, 0, true);
      dir.setUint16(12, t.hora, true); dir.setUint16(14, t.dia, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, a.dados.length, true); dir.setUint32(24, a.dados.length, true);
      dir.setUint16(28, nome.length, true);
      dir.setUint32(42, deslocamento, true);
      central.push(dir.buffer, nome);
      deslocamento += 30 + nome.length + a.dados.length;
    });
    var tamCentral = central.reduce(function (n, b) { return n + (b.byteLength || b.length); }, 0);
    var fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true);
    fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamCentral, true); fim.setUint32(16, deslocamento, true);
    return new Blob(partes.concat(central, [fim.buffer]), { type: 'application/zip' });
  }

  // Bytes da foto (o rascunho guarda base64).
  function bytesDaFoto(f) {
    var b64 = f.base64 || (f.dataUrl ? String(f.dataUrl).split(',')[1] : '');
    if (!b64) return null;
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function baixarBlob(blob, nome) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
  }

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
      '  <button type="button" class="foto-botao-tec">🖼️ Buscar da fototeca</button>' +
      '  <p class="foto-dica">💡 Opte sempre que possível pela opção de <strong>tirar foto</strong> para ter o registro de coordenada e horário.</p>' +
      // câmera: input com `capture` abre a câmera. fototeca: input SEM `capture`
      // abre a galeria do celular.
      '  <input type="file" accept="image/*" capture="environment" class="foto-entrada" hidden>' +
      '  <input type="file" accept="image/*" class="foto-entrada-tec" hidden>' +
      '  <div class="foto-status"></div>' +
      '</div>';

    const botao = container.querySelector('.foto-botao');
    const botaoTec = container.querySelector('.foto-botao-tec');
    const entrada = container.querySelector('.foto-entrada');
    const entradaTec = container.querySelector('.foto-entrada-tec');
    const status = container.querySelector('.foto-status');
    const galeria = container.querySelector('.foto-galeria');

    function notificar() { if (typeof opcoes.aoCapturar === 'function') opcoes.aoCapturar(fotos.slice()); }

    // Toda foto nova é gravada NA HORA, sozinha, na loja 'fotos'. É o que
    // garante que ela sobrevive a fechar o app — antes ela só existia dentro do
    // rascunho inteiro, que podia falhar de uma vez.
    async function guardarNoAparelho(f) {
      var ok = await guardarImagem(f, { os: opcoes.os });
      if (!ok && EC.app && EC.app.mostrarToast) {
        EC.app.mostrarToast(
          'Não consegui guardar esta foto no aparelho. Envie o rascunho com internet agora ' +
          'ou use "Baixar todas (.zip)" — senão ela pode se perder.',
          'ATENÇÃO — FOTO EM RISCO'
        );
      }
      return ok;
    }

    // O contador "(0/10)" saiu do botão: só poluía — as fotos já aparecem em
    // miniatura logo abaixo, então dá para ver quantas são. O limite só é
    // mencionado quando realmente importa, que é ao atingi-lo (o botão desliga,
    // e sem texto ninguém entenderia por quê).
    function atualizarBotao() {
      const cheio = fotos.length >= MAX_FOTOS;
      botao.textContent = cheio ? rotuloBase + ' — limite de ' + MAX_FOTOS + ' atingido' : rotuloBase;
      botao.disabled = cheio;
      botaoTec.disabled = cheio;
    }

    /**
     * Salva a foto NO APARELHO. Um site não pode gravar na galeria sozinho — não
     * existe permissão web para isso —, então o caminho é entregar o arquivo ao
     * sistema e deixar a pessoa escolher onde guardar:
     *   • iPhone/Android com compartilhamento: abre a folha do sistema, onde
     *     aparece "Salvar Imagem" (vai para Fotos);
     *   • sem esse recurso: baixa o arquivo (no Android a galeria costuma
     *     indexar a pasta Downloads).
     * Vai a versão CARIMBADA, que é a mesma foto com a identificação do serviço.
     */
    async function salvarNoCelular(f) {
      if (!f || !urlDaFoto(f)) return;
      try {
        const blob = await (await fetch(urlDaFoto(f))).blob();
        const arquivo = new File([blob], f.nomeArquivo || 'foto.jpg', { type: blob.type || 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [arquivo] }) && navigator.share) {
          await navigator.share({ files: [arquivo] });
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = arquivo.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast('📥 Foto baixada para o aparelho.');
      } catch (e) {
        // Cancelar a folha de compartilhamento cai aqui: não é erro, é escolha.
        if (e && e.name === 'AbortError') return;
        if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast('🛑 Não consegui salvar a foto no aparelho.');
      }
    }


    /**
     * Levar TODAS as fotos deste ponto para fora do app:
     *   • ENVIAR abre a folha do sistema com as fotos (WhatsApp, e-mail, Fotos);
     *   • BAIXAR gera um .zip com todas, para guardar no aparelho ou no PC.
     * É a rede de segurança do técnico: mesmo que algo dê errado no envio ao
     * servidor, ele tem as fotos na mão (pedido da Raisa, 2026-08-21).
     */
    async function enviarTodas() {
      var arquivos = [];
      fotos.forEach(function (f) {
        var b = bytesDaFoto(f);
        if (b) arquivos.push(new File([b], f.nomeArquivo || 'foto.jpg', { type: 'image/jpeg' }));
      });
      if (!arquivos.length) { toastFoto('Estas fotos não estão mais no aparelho.'); return; }
      try {
        if (navigator.canShare && navigator.canShare({ files: arquivos }) && navigator.share) {
          await navigator.share({ files: arquivos, title: rotuloCurto() });
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return;   // a pessoa cancelou
        // Muitas fotos de uma vez podem ser recusadas: cai no zip.
      }
      baixarTodas();
    }
    function baixarTodas() {
      var arquivos = [];
      fotos.forEach(function (f) {
        var b = bytesDaFoto(f);
        if (b) arquivos.push({ nome: f.nomeArquivo || 'foto.jpg', dados: b, quando: f.capturadaEm ? new Date(f.capturadaEm) : null });
      });
      if (!arquivos.length) { toastFoto('Estas fotos não estão mais no aparelho.'); return; }
      try {
        baixarBlob(ziparArquivos(arquivos), rotuloCurto() + '.zip');
        toastFoto('📥 ' + arquivos.length + ' foto(s) baixadas em um arquivo .zip.');
      } catch (e) {
        toastFoto('🛑 Não consegui montar o arquivo com as fotos.');
      }
    }
    function rotuloCurto() {
      var os = (opcoes.os ? 'OS ' + opcoes.os + ' ' : '') + (opcoes.ponto || '');
      return (os.trim() || 'Fotos').replace(/[\\/:*?"<>|]+/g, '-');
    }
    function toastFoto(m) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(m); }

    function renderGaleria() {
      galeria.innerHTML = fotos.map(function (f, i) {
        return '<div class="foto-item"><img src="' + urlDaFoto(f) + '" alt="Foto ' + (i + 1) + '">' +
          '<button type="button" class="foto-salvar" data-i="' + i + '" title="Salvar esta foto no celular">💾</button>' +
          '<button type="button" class="foto-remover" data-i="' + i + '" title="Remover foto">✕</button></div>';
      }).join('');
      // Linha "levar as fotos daqui" — só aparece quando há foto.
      var acoesDiv = container.querySelector('.foto-acoes');
      if (!acoesDiv) {
        acoesDiv = document.createElement('div');
        acoesDiv.className = 'foto-acoes';
        galeria.insertAdjacentElement('afterend', acoesDiv);
      }
      acoesDiv.innerHTML = fotos.length
        ? '<button type="button" class="botao botao-secundario botao-mini foto-enviar-todas">📤 Enviar as ' +
            fotos.length + ' foto(s) deste ponto</button>' +
          '<button type="button" class="botao botao-secundario botao-mini foto-baixar-todas">⬇️ Baixar todas (.zip)</button>'
        : '';
      if (fotos.length) {
        acoesDiv.querySelector('.foto-enviar-todas').addEventListener('click', enviarTodas);
        acoesDiv.querySelector('.foto-baixar-todas').addEventListener('click', baixarTodas);
      }
      galeria.querySelectorAll('.foto-remover').forEach(function (b) {
        b.addEventListener('click', function () {
          var fora = fotos.splice(parseInt(b.dataset.i, 10), 1)[0];
          if (fora) esquecerImagem(fora.nomeArquivo);
          renderGaleria(); atualizarBotao(); notificar();
        });
      });
      galeria.querySelectorAll('.foto-salvar').forEach(function (b) {
        b.addEventListener('click', function () { salvarNoCelular(fotos[parseInt(b.dataset.i, 10)]); });
      });
      galeria.querySelectorAll('.foto-item img').forEach(function (img, i) {
        img.addEventListener('click', function () { abrirLightbox(urlDaFoto(fotos[i])); });
      });
    }

    botao.addEventListener('click', function () { if (fotos.length < MAX_FOTOS) entrada.click(); });
    botaoTec.addEventListener('click', function () { if (fotos.length < MAX_FOTOS) entradaTec.click(); });

    // Processa UM arquivo (câmera ou fototeca). daFototeca=true → o carimbo sai
    // SEM data/hora (a foto da galeria não tem o horário do momento); a UTM só
    // entra se o técnico já tiver informado a coordenada do ponto. OS, Projeto,
    // tipo e Ponto seguem sempre no carimbo.
    function processarArquivo(arquivo, input, daFototeca) {
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

          const agora = new Date();
          const linhasCarimbo = [];
          linhasCarimbo.push('OS ' + (opcoes.os || '—'));
          if (opcoes.projeto) linhasCarimbo.push('Projeto: ' + opcoes.projeto);
          // UTM no carimbo: na CÂMERA sempre (coordenada do momento, ou aviso).
          // Na FOTOTECA a foto antiga não traz coordenada — mas se o técnico já
          // informou a coordenada do ponto (obterUtm com valor), ela entra
          // (pedido da Raisa, 2026-07-27). Sem coordenada informada, fica de fora.
          const textoUtm = (typeof opcoes.obterUtm === 'function' && opcoes.obterUtm()) || '';
          let utmNoCarimbo = false;
          if (!daFototeca) {
            linhasCarimbo.push('UTM ' + (textoUtm || 'UTM não capturado'));
            utmNoCarimbo = true;
          } else if (textoUtm) {
            linhasCarimbo.push('UTM ' + textoUtm);
            utmNoCarimbo = true;
          }
          linhasCarimbo.push(opcoes.tipo || '—');
          linhasCarimbo.push((opcoes.rotuloPonto || 'Ponto') + ' ' + (opcoes.ponto || '—'));
          if (opcoes.periodo) linhasCarimbo.push('Período: ' + opcoes.periodo);
          if (!daFototeca) linhasCarimbo.push(dataHoraBR(agora));
          desenharCarimbo(ctx, largura, altura, linhasCarimbo);
          desenharMarcaDagua(ctx, largura, altura);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          fotos.push({
            nomeArquivo: 'OS_' + (opcoes.os || 'SEM-OS') + '_' + (opcoes.tipo || 'SEM-TIPO') + '_'
              + (opcoes.ponto || 'P0') + '_'
              + (opcoes.periodo ? String(opcoes.periodo).replace(/\s+/g, '-') + '_' : '')
              + carimboDataHora(agora) + '_F' + doisDigitos(fotos.length + 1) + '.jpg',
            base64: dataUrl.split(',')[1],   // dataUrl NÃO é guardado: é o mesmo
            // conteúdo com um prefixo, e guardar os dois dobrava o rascunho.
            capturadaEm: agora.toISOString(),
            daFototeca: !!daFototeca
          });

          // Grava a imagem sozinha JÁ — antes de qualquer outra coisa. Assim ela
          // sobrevive mesmo que o rascunho inteiro não consiga ser salvo.
          guardarNoAparelho(fotos[fotos.length - 1]);

          renderGaleria();
          atualizarBotao();
          status.textContent = daFototeca
            ? '✅ Foto da fototeca adicionada — carimbo ' + (utmNoCarimbo ? 'com a coordenada informada, ' : '') + 'sem horário' + (utmNoCarimbo ? '' : '/UTM') + ' (' + fotos.length + '/' + MAX_FOTOS + ').'
            : '✅ Foto carimbada e adicionada (' + fotos.length + '/' + MAX_FOTOS + ').';
          input.value = '';
          notificar();
        };
        imagem.onerror = function () { status.innerHTML = '<span class="texto-erro">⚠️ Não foi possível ler a imagem.</span>'; };
        imagem.src = leitor.result;
      };
      leitor.onerror = function () { status.innerHTML = '<span class="texto-erro">⚠️ Falha ao abrir o arquivo da foto.</span>'; };
      leitor.readAsDataURL(arquivo);
    }

    entrada.addEventListener('change', function () { processarArquivo(entrada.files && entrada.files[0], entrada, false); });
    entradaTec.addEventListener('change', function () { processarArquivo(entradaTec.files && entradaTec.files[0], entradaTec, true); });

    renderGaleria();
    atualizarBotao();

    return {
      obterFotos: function () { return fotos.slice(); },
      obterFoto: function () { return fotos[0] || null; } // compatibilidade
    };
  }

  return {
    criar: criar,
    tem: tem,
    guardarImagem: guardarImagem,   // grava UMA foto na loja 'fotos'
    esquecerImagem: esquecerImagem,
    semImagens: semImagens,         // cópia só com as referências
    reidratar: reidratar,           // devolve as imagens ao objeto
    garantirGuardadas: garantirGuardadas,
    limparAntigas: limparAntigas
  };
})();
