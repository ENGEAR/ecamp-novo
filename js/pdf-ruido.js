/**
 * pdf-ruido.js — Gera o PDF do monitoramento de RUÍDO EXTERNO (modelo piloto).
 *
 * Monta no próprio celular (offline), com TUDO preenchido + as fotos + a logo da
 * ENGEAR, e abre a folha de compartilhar (WhatsApp) — ou baixa o arquivo. É
 * chamado na tela de conclusão, quando o registro ainda tem as fotos em memória.
 *
 * Usa jsPDF (js/vendor/jspdf.umd.min.js → window.jspdf.jsPDF).
 *
 * Interface (EC.pdfRuido):
 *   EC.pdfRuido.suporta(registro) → true se sabe gerar (ruído externo)
 *   EC.pdfRuido.gerar(registro)   → Promise; monta e compartilha/baixa o PDF
 */
window.EC = window.EC || {};

EC.pdfRuido = (function () {
  'use strict';

  var A4_W = 210, A4_H = 297, MARGEM = 14;
  var LARG = A4_W - 2 * MARGEM;
  var AZUL = [23, 54, 93], CINZA = [90, 90, 90], PRETO = [30, 30, 30];

  function suporta(reg) {
    return !!reg && reg.tipo === 'ruido' && reg.campo && reg.campo.subtipo === 'externo';
  }

  function fmtDataBR(iso) {
    if (!iso) return '';
    var p = String(iso).split('T')[0].split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }
  function fmtDataHora(iso) {
    try { return new Date(iso).toLocaleString('pt-BR'); } catch (e) { return fmtDataBR(iso); }
  }
  function v(x) { return (x === undefined || x === null || String(x).trim() === '') ? '—' : String(x); }

  // Logo como dataURL (uma vez).
  var logoCache;
  function carregarLogo() {
    if (logoCache !== undefined) return Promise.resolve(logoCache);
    return fetch('public/logo-recortada.png')
      .then(function (r) { return r.blob(); })
      .then(function (b) {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res(fr.result); };
          fr.onerror = function () { res(''); };
          fr.readAsDataURL(b);
        });
      })
      .then(function (d) { logoCache = d; return d; })
      .catch(function () { logoCache = ''; return ''; });
  }

  function checagemTexto(sinal, valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') return '—';
    // ASCII "-"/"+" (o sinal "−" U+2212 não existe na fonte padrão do PDF).
    return (sinal === '-' ? '-' : '+') + ' ' + String(valor) + ' dB';
  }
  function diferencaChecagens(p) {
    var ini = parseFloat(String(p.chkIniValor || '').replace(',', '.')) * (p.chkIniSinal === '-' ? -1 : 1);
    var fim = parseFloat(String(p.chkFimValor || '').replace(',', '.')) * (p.chkFimSinal === '-' ? -1 : 1);
    if (isNaN(ini) || isNaN(fim)) return '';
    var d = Math.abs(fim - ini);
    // Sem emoji: não existe na fonte padrão do PDF e quebra a renderização da linha.
    return d.toFixed(2).replace('.', ',') + ' dB' + (d >= 0.5 ? '  (ACIMA de 0,5 dB - fora do limite)' : '  (dentro do limite)');
  }
  function gpsTexto(p) {
    var g = p.gps || {}, u = g.utm || {};
    var utm = [u.zona, u.leste && (u.leste + ' E'), u.norte && (u.norte + ' N')].filter(Boolean).join(' · ');
    return utm || '—';
  }

  function nomeArquivo(reg) {
    var proj = (reg.os.projeto || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    return ('Monitoramento_' + (reg.os.numero || '') + (proj ? '_' + proj : '') + '.pdf').replace(/\s+/g, '_');
  }

  function gerar(reg) {
    var Ctor = window.jspdf && window.jspdf.jsPDF;
    if (!Ctor) { if (EC.app) EC.app.mostrarToast('Biblioteca de PDF não carregou.'); return Promise.reject(); }

    return carregarLogo().then(function (logo) {
      var doc = new Ctor({ unit: 'mm', format: 'a4', compress: true });
      var y = MARGEM;

      function rodape() { /* preenchido no fim, em todas as páginas */ }
      function novaPagina() { doc.addPage(); y = MARGEM; }
      function garantir(h) { if (y + h > A4_H - MARGEM - 8) novaPagina(); }

      function tituloSecao(txt) {
        garantir(11);
        doc.setFillColor(AZUL[0], AZUL[1], AZUL[2]);
        doc.rect(MARGEM, y, LARG, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text(txt, MARGEM + 2, y + 4.9);
        y += 10;
      }

      // Linha rótulo: valor (valor pode quebrar em várias linhas)
      function kv(rotulo, valor) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
        var rot = rotulo + ': ';
        var larguraRot = doc.getTextWidth(rot);
        doc.setFont('helvetica', 'normal');
        var linhas = doc.splitTextToSize(v(valor), LARG - larguraRot - 2);
        garantir(linhas.length * 4.6 + 1);
        doc.setFont('helvetica', 'bold'); doc.text(rot, MARGEM, y);
        doc.setFont('helvetica', 'normal');
        for (var i = 0; i < linhas.length; i++) {
          doc.text(linhas[i], MARGEM + (i === 0 ? larguraRot : larguraRot), y);
          if (i < linhas.length - 1) y += 4.6;
        }
        y += 5.4;
      }

      function subtitulo(txt) {
        garantir(7);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]);
        doc.text(txt, MARGEM, y); y += 5.5;
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
      }

      function foto(dataUrl, rotulo) {
        if (!dataUrl) return;
        var props;
        try { props = doc.getImageProperties(dataUrl); } catch (e) { return; }
        if (!props || !props.width) return;
        var w = Math.min(120, LARG);
        var h = props.height * (w / props.width);
        var maxH = 95;
        if (h > maxH) { h = maxH; w = props.width * (h / props.height); }
        garantir(5 + h + 3);
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
        doc.text(rotulo, MARGEM, y); y += 3.5;
        try { doc.addImage(dataUrl, 'JPEG', MARGEM, y, w, h); } catch (e) { }
        y += h + 4;
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
      }
      function fotosDe(lista, rotulo) {
        (Array.isArray(lista) ? lista : (lista ? [lista] : [])).forEach(function (f, i) {
          if (f && f.dataUrl) foto(f.dataUrl, rotulo + (i > 0 ? ' (' + (i + 1) + ')' : ''));
        });
      }

      /* ---------- Cabeçalho ---------- */
      if (logo) {
        try {
          var lp = doc.getImageProperties(logo);
          var lw = 38, lh = lp.height * (lw / lp.width);
          doc.addImage(logo, 'PNG', MARGEM, y, lw, lh);
        } catch (e) { }
      }
      doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
      doc.text('Relatório de Monitoramento', A4_W - MARGEM, y + 6, { align: 'right' });
      doc.setFontSize(11);
      doc.text('Ruído Ambiental', A4_W - MARGEM, y + 12, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
      doc.text(v(reg.servico && reg.servico.escopo), A4_W - MARGEM, y + 17, { align: 'right' });
      y += 24;
      doc.setDrawColor(AZUL[0], AZUL[1], AZUL[2]); doc.setLineWidth(0.4);
      doc.line(MARGEM, y, A4_W - MARGEM, y); y += 6;
      doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);

      var os = reg.os || {}, serv = reg.servico || {}, dg = reg.dadosGerais || {}, geral = (reg.campo && reg.campo.geral) || {};

      /* ---------- Ordem de serviço ---------- */
      tituloSecao('Ordem de serviço');
      kv('Nº da OS', os.numero);
      kv('Código', os.codigo);
      kv('Nome do projeto', os.projeto);
      kv('Emitido por', os.emitidoPor);
      kv('Data de emissão', fmtDataBR(os.dataEmissao));

      /* ---------- Cliente ---------- */
      tituloSecao('Cliente');
      kv('Razão social', os.cliente);
      kv('CNPJ / CPF', os.cnpjCpf);
      kv('Endereço', os.endereco);
      kv('Município / UF', os.municipioUF);
      kv('Contato', os.contato);

      /* ---------- Serviço ---------- */
      tituloSecao('Dados do serviço');
      kv('Escopo', serv.escopo);
      kv('Método', serv.metodo);
      kv('Período', serv.periodo);
      kv('Frequência', os.frequencia);
      kv('Campanha', serv.campanha);
      kv('Finalidade', geral.finalidade);
      kv('Dias de medição', serv.dias);
      var realizados = geral.qtdePontos != null && geral.qtdePontos !== '' ? geral.qtdePontos : dg.qtdePontos;
      kv('Pontos', v(realizados) + (dg.qtdePontosOS != null && String(dg.qtdePontosOS) !== String(realizados) ? '  (previsto na OS: ' + dg.qtdePontosOS + ')' : ''));
      if (geral.justificativaPontos || dg.justificativaPontos) kv('Justificativa dos pontos', geral.justificativaPontos || dg.justificativaPontos);
      kv('Observação do escopo', serv.observacao);
      kv('Observações da OS', os.observacao);
      kv('Início', fmtDataBR(dg.dataInicio) + (dg.horaInicio ? ' às ' + dg.horaInicio : ''));
      kv('Equipamentos (serviço)', (reg.equipamentos && reg.equipamentos.length) ? reg.equipamentos.join(', ') : '—');

      /* ---------- Pontos ---------- */
      var pontos = (reg.campo && reg.campo.pontos) || [];
      var total = Math.min(pontos.length, Math.max(1, parseInt(geral.qtdePontos, 10) || pontos.length));
      for (var i = 0; i < total; i++) {
        var p = pontos[i] || {};
        tituloSecao('Ponto P' + String(i + 1).padStart(2, '0') + (p.nome ? ' — ' + p.nome : ''));
        kv('Nome / identificação', p.nome);
        kv('Equipamentos do ponto', (p.equipamentos && p.equipamentos.length) ? p.equipamentos.join(', ') : '—');
        kv('Hora inicial', p.horaInicial);
        kv('Hora de término', p.horaTermino);
        kv('UTM', gpsTexto(p));
        kv('Endereço (GPS)', (p.gps && p.gps.endereco) || '—');
        kv('Checagem inicial', checagemTexto(p.chkIniSinal, p.chkIniValor));
        kv('Checagem final', checagemTexto(p.chkFimSinal, p.chkFimValor));
        var dif = diferencaChecagens(p); if (dif) kv('Diferença entre checagens', dif);
        kv('Temperatura', p.temperatura != null && p.temperatura !== '' ? p.temperatura + ' °C' : '—');
        kv('Umidade', p.umidade != null && p.umidade !== '' ? p.umidade + ' %' : '—');
        kv('Vento', p.vento != null && p.vento !== '' ? p.vento + ' m/s' : '—');
        kv('Fontes percebidas da EMPRESA', p.fontesEmpresa);
        kv('Fontes percebidas do AMBIENTE', p.fontesAmbiente);
        kv('Observações', p.observacoes);
        subtitulo('Fotos');
        fotosDe(p.fotoTelaIni, 'Tela — checagem inicial');
        fotosDe(p.fotoPonto, 'Ponto');
        fotosDe(p.fotoTelaFim, 'Tela — checagem final');
      }

      /* ---------- Rodapé em todas as páginas ---------- */
      var totalPag = doc.getNumberOfPages();
      var rodapeTxt = 'ENGEAR Laboratório · Técnico: ' + v(reg.tecnico) + ' · Gerado em ' + fmtDataHora(reg.salvoEm || new Date().toISOString());
      for (var pg = 1; pg <= totalPag; pg++) {
        doc.setPage(pg);
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
        doc.line(MARGEM, A4_H - 10, A4_W - MARGEM, A4_H - 10);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
        doc.text(rodapeTxt, MARGEM, A4_H - 6);
        doc.text('Página ' + pg + '/' + totalPag, A4_W - MARGEM, A4_H - 6, { align: 'right' });
      }

      /* ---------- Compartilhar / baixar ---------- */
      var nome = nomeArquivo(reg);
      var blob = doc.output('blob');
      var arquivo;
      try { arquivo = new File([blob], nome, { type: 'application/pdf' }); } catch (e) { arquivo = null; }

      if (arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] }) && navigator.share) {
        return navigator.share({ files: [arquivo], title: 'Monitoramento OS ' + (reg.os.numero || '') })
          .catch(function () { doc.save(nome); }); // cancelou/erro → baixa
      }
      doc.save(nome);
      return Promise.resolve();
    });
  }

  return { suporta: suporta, gerar: gerar };
})();
