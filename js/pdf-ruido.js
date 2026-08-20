/**
 * pdf-ruido.js — Gera o PDF de qualquer monitoramento (na tela de finalizar).
 *
 * Monta no próprio celular (offline), com TUDO preenchido + as fotos + a logo da
 * ENGEAR, e abre a folha de compartilhar (WhatsApp) — ou baixa o arquivo. É
 * chamado na conclusão, quando o registro ainda tem as fotos em memória.
 *
 * Topo (OS/cliente/serviço) e rodapé são iguais para todos os serviços. O CORPO
 * muda por tipo: o RUÍDO tem layout detalhado próprio (2 janelas Total/Residual);
 * os demais (vibração, particulados, opacímetro/Ringelmann, QAR interno, outro)
 * usam um renderizador GENÉRICO que percorre os campos preenchidos de cada item
 * (ponto/veículo/ambiente/coleta) com rótulos amigáveis + as fotos.
 *
 * Usa jsPDF (js/vendor/jspdf.umd.min.js → window.jspdf.jsPDF).
 * ATENÇÃO jsPDF: a fonte padrão só tem Latin-1 (WinAnsi). Evitar "−" (U+2212),
 * emoji, setas (↑↓) e subscritos (₂) — quebram a renderização. Use ASCII/Latin-1.
 *
 * Interface (EC.pdf; alias EC.pdfRuido para compatibilidade):
 *   EC.pdf.suporta(registro) → true (sabe gerar para qualquer serviço)
 *   EC.pdf.gerar(registro)   → Promise; monta e compartilha/baixa o PDF
 */
window.EC = window.EC || {};

EC.pdf = (function () {
  'use strict';

  var A4_W = 210, A4_H = 297, MARGEM = 14;
  var LARG = A4_W - 2 * MARGEM;
  var AZUL = [23, 54, 93], CINZA = [90, 90, 90], PRETO = [30, 30, 30];

  // Título do relatório por tipo de serviço.
  var TITULOS = {
    ruido: 'Ruído Ambiental',
    sismo: 'Vibração',
    qar: 'Qualidade do Ar — Particulados',
    qarint: 'Qualidade do Ar Interno',
    outro: 'Monitoramento'
  };
  function tituloTipo(reg) {
    if (reg.tipo === 'opacidade') {
      return (reg.campo && reg.campo.subtipo === 'ringelmann')
        ? 'Fuligem — Escala de Ringelmann' : 'Fuligem — Opacímetro';
    }
    return TITULOS[reg.tipo] || (reg.servico && reg.servico.escopo) || 'Monitoramento';
  }

  // Rótulo amigável do subtipo (ruído e opacidade têm subtipo; os demais não).
  var SUBTIPO_LABELS = {
    externo: 'Ambiente externo',
    interno10151: 'Ambiente interno (NBR 10151)',
    interno10152: 'Ambiente interno (NBR 10152)',
    ferroviario: 'Ferroviário',
    aeronautico: 'Aeronáutico',
    opacimetro: 'Opacímetro',
    ringelmann: 'Escala de Ringelmann'
  };
  function subtipoLabel(reg) {
    var s = reg.campo && reg.campo.subtipo;
    return s ? (SUBTIPO_LABELS[s] || s) : '';
  }

  // Método pela NORMA do subtipo de ruído (quando houver); senão o método da OS.
  var METODO_SUBTIPO = {
    externo: 'ABNT NBR 10151',
    interno10151: 'ABNT NBR 10151',
    interno10152: 'ABNT NBR 10152',
    ferroviario: 'ABNT NBR 16425-3',
    aeronautico: 'ABNT NBR 16425-2'
  };
  function metodoServico(reg) {
    var s = reg.campo && reg.campo.subtipo;
    return (s && METODO_SUBTIPO[s]) || (reg.servico && reg.servico.metodo) || '';
  }

  // Sempre sabe gerar (o botão aparece em todos os serviços).
  function suporta(reg) { return !!reg; }

  /* ===== Guardar / compartilhar PDFs no aparelho (IndexedDB, loja 'pdfs') ===== */

  // Baixa um Blob como arquivo (fallback quando não há compartilhamento nativo).
  function baixarBlob(blob, nome) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // Abre a folha de compartilhar (WhatsApp etc.) com o PDF; se não der, baixa.
  function compartilharBlob(blob, nome, titulo) {
    var arquivo;
    try { arquivo = new File([blob], nome, { type: 'application/pdf' }); } catch (e) { arquivo = null; }
    if (arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] }) && navigator.share) {
      return navigator.share({ files: [arquivo], title: titulo }).catch(function () { baixarBlob(blob, nome); });
    }
    baixarBlob(blob, nome);
    return Promise.resolve();
  }

  // Guarda o PDF (Blob + metadados) no aparelho. Chave = codificação do registro
  // (regerar o mesmo registro substitui, não duplica). Best-effort.
  function salvarPdf(reg, blob, nome) {
    if (!EC.db || !EC.db.disponivel()) return Promise.resolve();
    var os = reg.os || {};
    var id = reg.codificacao || ('OS_' + (os.numero || 'SEM-OS') + '_' + (reg.salvoEm || ''));
    var rec = {
      id: id, os: os.numero || '', cliente: os.cliente || '', projeto: os.projeto || '',
      tipo: reg.tipo || '', subtipo: (reg.campo && reg.campo.subtipo) || '',
      escopo: (reg.servico && reg.servico.escopo) || '', tecnico: reg.tecnico || '',
      nome: nome, salvoEm: reg.salvoEm || new Date().toISOString(), blob: blob
    };
    return EC.db.set('pdfs', id, rec).catch(function () { });
  }

  // Lista os PDFs salvos (mais recentes primeiro).
  function listarSalvos() {
    if (!EC.db || !EC.db.disponivel()) return Promise.resolve([]);
    return EC.db.getAll('pdfs').then(function (arr) {
      return (arr || []).sort(function (a, b) {
        return String(b.salvoEm || '').localeCompare(String(a.salvoEm || ''));
      });
    }).catch(function () { return []; });
  }
  function abrirSalvo(rec) { return compartilharBlob(rec.blob, rec.nome, 'Monitoramento OS ' + (rec.os || '')); }
  function excluirSalvo(id) { return (EC.db && EC.db.disponivel()) ? EC.db.remove('pdfs', id) : Promise.resolve(); }

  /* ===== Dicionário de rótulos (renderizador genérico) ===== */
  var LABELS = {
    nome: 'Nome / identificação', data: 'Data', horaInicial: 'Hora inicial', horaFinal: 'Hora final',
    horaTermino: 'Hora de término', observacoes: 'Observações', temperatura: 'Temperatura',
    umidade: 'Umidade', vento: 'Vento', objetivo: 'Objetivo', finalidade: 'Finalidade',
    qtdePontos: 'Qtd. de pontos', qtdeVeiculos: 'Qtd. de veículos', qtdeAmbientes: 'Qtd. de ambientes',
    qtdeColetas: 'Qtd. de coletas', primeiraColeta: 'Nº da primeira coleta', justificativaPontos: 'Justificativa dos pontos',
    tipoEquip: 'Tipo de equipamento', numeroEquip: 'Nº do equipamento', instalGeofone: 'Instalação do geofone',
    fonteVibracao: 'Fonte de vibração', intercorrencia: 'Intercorrência', intercorrenciaDesc: 'Descrição da intercorrência',
    placa: 'Placa', ano: 'Ano', endereco: 'Endereço', validadeCalib: 'Validade da calibração (em meses)',
    calibA1: 'Inclinação a1 (certificado do CPV)', calibB1: 'Intercepto b1 (certificado do CPV)',
    equipAGV: 'Amostrador de Grande Volume', equipSeparador: 'Separador inercial', equipKit: 'Kit de calibração (CPV)',
    pressao: 'Pressão', horimetro: 'Horímetro', validade: 'Validade',
    area: 'Área', pontosCalculados: 'Pontos calculados', pessoas: 'Nº de pessoas', janela: 'Janela',
    valorVazao: 'Vazão', co2: 'CO2', temp: 'Temperatura', ur: 'Umidade relativa', velar: 'Velocidade do ar',
    pm25: 'PM2,5', pm10: 'PM10', particulas: 'Partículas', numFiltro: 'Nº do filtro',
    tipoMonitoramento: 'Tipo de monitoramento', medicaoPrincipal: 'Medição principal', unidade: 'Unidade',
    esquadrias: 'Condição das esquadrias', condicao: 'Ocupação do ambiente', mobilia: 'Condição do ambiente',
    altura: 'Altura do sonômetro', condAmbiente: 'Condições do ambiente', eventualidade: 'Eventualidade',
    eventualidadeDesc: 'Descrição da eventualidade', fontesEmpresa: 'Fontes percebidas da EMPRESA',
    fontesAmbiente: 'Fontes percebidas do AMBIENTE'
  };
  var BASE_INI_FIM = {
    data: 'Data', hora: 'Hora', horimetro: 'Horímetro', temp: 'Temperatura', umid: 'Umidade',
    pressao: 'Pressão', col800sobe: 'Coluna 800 sobe', col800desce: 'Coluna 800 desce'
  };
  var UNID = {
    temperatura: '°C', temp: '°C', temp_ini: '°C', temp_fim: '°C', umidade: '%', umid: '%',
    umid_ini: '%', umid_fim: '%', ur: '%', vento: 'm/s', velar: 'm/s', pressao: 'hPa',
    pressao_ini: 'hPa', pressao_fim: 'hPa', area: 'm²', altura: 'm', co2: 'ppm',
    pm25: 'µg/m³', pm10: 'µg/m³'
  };
  var FOTO_LABELS = {
    fotoPonto: 'Ponto', fotoTela: 'Tela', fotoTelaIni: 'Tela — checagem inicial',
    fotoTelaFim: 'Tela — checagem final', fotoAmbiente: 'Ambiente', foto: 'Evidência'
  };
  // Campos do serviço (geral) já mostrados na seção "Dados do serviço".
  var SKIP = { checks: 1, sala: 1, subtipo: 1, equipamentosManual: 1, qtdePontos: 1 };
  var SKIP_GERAL = { finalidade: 1, justificativaPontos: 1 };
  var PRIO = ['nome', 'placa', 'ano', 'endereco', 'data', 'horaInicial', 'hora_ini', 'data_ini',
    'tipoEquip', 'numeroEquip', 'objetivo', 'tipoMonitoramento'];

  function prettify(k) {
    var s = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function rotulo(k) {
    if (LABELS[k]) return LABELS[k];
    var m;
    if ((m = k.match(/^leitura(\d+)$/))) return 'Leitura ' + (parseInt(m[1], 10) + 1);
    if ((m = k.match(/^carta(\d+)_(\d+)(sobe|desce)$/))) return 'Placa de retenção ' + m[1] + ' — coluna ' + (m[2] === '00' ? '400' : m[2]) + ' ' + m[3];
    if ((m = k.match(/^filtro_(\d+)(sobe|desce)$/))) return 'Filtro — coluna ' + m[1] + ' ' + m[2];
    if ((m = k.match(/^(.*)_(ini|fim)$/))) {
      var base = BASE_INI_FIM[m[1]] || prettify(m[1]);
      return base + (m[2] === 'ini' ? ' (início)' : ' (fim)');
    }
    return prettify(k);
  }
  function rotuloFoto(k) { return FOTO_LABELS[k] || 'Foto'; }
  function subRotulo(chave) {
    return { coletas: 'Coleta', pontos: 'Ponto', ambientes: 'Ambiente', veiculos: 'Veículo' }[chave] || 'Item';
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
  function fmtValor(k, val) {
    if (val === undefined || val === null || String(val).trim() === '') return '—';
    var u = UNID[k];
    // Pressão passou a sair em hPa (2026-08-11). Registro antigo guardou mmHg —
    // as faixas físicas não se cruzam (mmHg < ~780; hPa > ~850), então valor
    // abaixo de 800 é mmHg e converte, para o PDF não trocar a unidade do dado.
    if (u === 'hPa') {
      var n = parseFloat(String(val).replace(',', '.'));
      if (!isNaN(n) && n < 800) val = (n * 1.33322).toFixed(1);
    }
    return u ? (val + ' ' + u) : String(val);
  }

  function ehFoto(val) {
    var f = Array.isArray(val) ? val[0] : val;
    return !!(f && typeof f === 'object' && (f.dataUrl || f.base64 || f.nomeArquivo));
  }
  function ehListaItens(val) {
    return Array.isArray(val) && val.length > 0 && val[0] && typeof val[0] === 'object' && !ehFoto(val);
  }

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
    return (sinal === '-' ? '-' : '+') + ' ' + String(valor) + ' dB';
  }
  // Usa a MESMA regra da coleta (EC.checagens): arredonda em 2 casas e reprova só
  // ACIMA de 0,5 dB (0,50 exato está dentro). Sem isso o laudo divergiria do app.
  function diferencaChecagens(p) {
    var vi = parseFloat(String(p.chkIniValor || '').replace(',', '.'));
    var vf = parseFloat(String(p.chkFimValor || '').replace(',', '.'));
    if (isNaN(vi) || isNaN(vf)) return '';
    var r = EC.checagens.calcular(p.chkIniSinal || '+', vi, p.chkFimSinal || '+', vf);
    return r.diff.toFixed(2).replace('.', ',') + ' dB' +
      (r.alerta ? '  (ACIMA de 0,5 dB - fora do limite)' : '  (dentro do limite)');
  }
  function gpsTexto(p) {
    var g = p.gps || {}, u = g.utm || {};
    var utm = [u.zona, u.leste && (u.leste + ' E'), u.norte && (u.norte + ' N')].filter(Boolean).join(' · ');
    return utm || (g.textoUtm) || '—';
  }
  function utmDe(gps) {
    var u = (gps && gps.utm) || {};
    var t = [u.zona, u.leste && (u.leste + ' E'), u.norte && (u.norte + ' N')].filter(Boolean).join(' · ');
    return t || (gps && gps.textoUtm) || '—';
  }

  // Nº da campanha da OS (extrai o número; serviço SEM campanha → 1).
  function numeroCampanha(reg) {
    var c = (reg.servico && reg.servico.campanha) || '';
    var m = String(c).match(/\d+/);
    return m ? m[0] : '1';
  }
  // Quantidade de pontos MONITORADOS (interno = soma dos pontos dos ambientes).
  function contarPontos(reg) {
    var campo = reg.campo || {}, geral = campo.geral || {}, sub = campo.subtipo;
    if (sub === 'interno10151' || sub === 'interno10152') {
      return (campo.ambientes || []).reduce(function (s, a) {
        var n = parseInt((a || {}).pontosCalculados, 10); return s + (isNaN(n) ? 0 : n);
      }, 0);
    }
    var n = parseInt(geral.qtdePontos || geral.qtdeVeiculos || geral.qtdeAmbientes, 10);
    if (n) return n;
    n = parseInt((reg.dadosGerais || {}).qtdePontos, 10);
    if (n) return n;
    return (campo.pontos || []).length;
  }
  // Segmento {método} do código (planilha escopo_metodo_os): só o ruído 10151
  // (interno/externo/longa duração) e o ferro/aéreo (finalidade) têm; os demais
  // escopos (10152, vibração, opacidade, MQAI, outro) ficam sem.
  function metodoCodigo(reg) {
    if (reg.tipo !== 'ruido') return '';
    var campo = reg.campo || {};
    var sub = campo.subtipo || '';
    if (sub === 'interno10151') return 'Ambiente interno';
    if (sub === 'externo') {
      var escopo = (reg.servico && reg.servico.escopo) || '';
      return /longa\s*dura/i.test(escopo) ? 'Longa duração' : 'Ambiente externo';
    }
    if (sub === 'ferroviario' || sub === 'aeronautico') return (campo.geral || {}).finalidade || '';
    return ''; // interno10152: sem método (planilha)
  }
  // Unidade contada por escopo: ruído interno e QAR interno = ambientes;
  // opacidade = veículos; demais = pontos. Devolve { n, singular, plural } para
  // o texto sair no singular quando n === 1 e no plural quando > 1.
  function contagemDetalhe(reg) {
    var campo = reg.campo || {}, geral = campo.geral || {}, sub = campo.subtipo;
    if ((reg.tipo === 'ruido' && (sub === 'interno10151' || sub === 'interno10152')) || reg.tipo === 'qarint') {
      var a = parseInt(geral.qtdeAmbientes, 10) || (campo.ambientes || []).length;
      return { n: a, singular: 'ambiente', plural: 'ambientes' };
    }
    if (reg.tipo === 'opacidade') {
      var v = parseInt(geral.qtdeVeiculos, 10) || (campo.veiculos || []).length;
      return { n: v, singular: 'veículo', plural: 'veículos' };
    }
    return { n: contarPontos(reg), singular: 'ponto', plural: 'pontos' };
  }
  // Contagem do código: ex.: "1 ponto", "3 veículos", "1 ambiente".
  function contagemItens(reg) {
    var d = contagemDetalhe(reg);
    return d.n + ' ' + (d.n === 1 ? d.singular : d.plural);
  }
  // Código do registro (planilha escopo_metodo_os, coluna I — SEM a revisão,
  // que só o servidor conhece; ela fica nas pastas/nomes das fotos, no espelho):
  //   Campo_[NºOS]_[Projeto]_CAMPANHA n_[Escopo]_[método?]_[N pontos|ambientes|veículos]
  function codigoPdf(reg) {
    var os = (reg.os && reg.os.numero) || '';
    var projeto = (reg.os && reg.os.projeto) || '';
    var escopo = (reg.servico && reg.servico.escopo) || '';
    var metodo = metodoCodigo(reg);
    var partes = ['Campo', os, projeto, 'CAMPANHA ' + numeroCampanha(reg)];
    // Particulados (QAR Externo) levam o segmento "QAR externo" antes do escopo.
    if (reg.tipo === 'qar') partes.push('QAR externo');
    partes.push(escopo);
    if (metodo) partes.push(metodo);
    partes.push(contagemItens(reg));
    return partes
      .map(function (s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(); })
      .filter(Boolean)
      .join('_');
  }
  function nomeArquivo(reg) {
    return codigoPdf(reg) + '.pdf';
  }

  // Gera o PDF e o GUARDA (aparelho + SharePoint), sem abrir o compartilhar.
  // Devolve { blob, nome } — o compartilhar precisa de um toque do usuário
  // (restrição do navegador), então fica para o botão da tela.
  //
  // opcoes (usadas pelo PDF PARCIAL automático do "Salvar rascunho"):
  //   nome           — nome fixo do arquivo (sobrescreve o mesmo no SharePoint,
  //                    em vez de acumular um PDF novo a cada salvamento);
  //   semSalvarLocal — não entra na lista local de PDFs do aparelho (é backup
  //                    de servidor, não um PDF que o técnico foi buscar).
  function gerarSalvar(reg, opcoes) {
    var Ctor = window.jspdf && window.jspdf.jsPDF;
    if (!Ctor) { if (EC.app) EC.app.mostrarToast('Biblioteca de PDF não carregou.'); return Promise.reject(); }

    return carregarLogo().then(function (logo) {
      var doc = new Ctor({ unit: 'mm', format: 'a4', compress: true });
      var y = MARGEM;
      // COLUNA ATUAL. Por padrão é a página inteira; o layout de duas colunas
      // (particulados) muda estes três e todos os blocos abaixo (kv, subtítulo,
      // foto, curva) desenham dentro da coluna, sem precisar de uma 2ª versão
      // de cada um. `semQuebra` segura a quebra de página enquanto uma coluna
      // está sendo desenhada — o espaço da linha inteira já foi reservado.
      var colX = MARGEM, colW = LARG, semQuebra = false;

      function novaPagina() { doc.addPage(); y = MARGEM; }
      function garantir(h) { if (semQuebra) return; if (y + h > A4_H - MARGEM - 8) novaPagina(); }

      function tituloSecao(txt) {
        garantir(13);
        doc.setFillColor(AZUL[0], AZUL[1], AZUL[2]);
        doc.rect(MARGEM, y, LARG, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text(txt, MARGEM + 2, y + 4.9);
        y += 12.5; // respiro entre a barra e a primeira linha da seção
      }

      // Título de bloco SEM a barra azul (ex.: "Coletas") — só o texto em
      // negrito escuro, com respiro antes e depois.
      function tituloSimples(txt) {
        garantir(12);
        y += 2;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
        doc.text(txt, colX, y + 3.5);
        y += 8.5;
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      }

      // Linha rótulo: valor (valor pode quebrar em várias linhas)
      function kv(rotuloTxt, valor) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
        var rot = rotuloTxt + ':';
        var larguraRot = doc.getTextWidth(rot) + 1.4;   // +respiro: o espaço final não conta na medida
        doc.setFont('helvetica', 'normal');
        var linhas = doc.splitTextToSize(v(valor), colW - larguraRot - 2);
        garantir(linhas.length * 4.6 + 1);
        doc.setFont('helvetica', 'bold'); doc.text(rot, colX, y);
        doc.setFont('helvetica', 'normal');
        for (var i = 0; i < linhas.length; i++) {
          doc.text(linhas[i], colX + larguraRot, y);
          if (i < linhas.length - 1) y += 4.6;
        }
        y += 5.4;
      }
      // kv que só sai se tiver valor (evita "—" em campos que não existem no subtipo).
      function kvSe(rotuloTxt, valor) {
        if (valor === undefined || valor === null || String(valor).trim() === '' || String(valor) === '—') return;
        kv(rotuloTxt, valor);
      }
      // Veredito enxuto: só APROVADO (verde) ou REPROVADO (vermelho), em negrito.
      function kvVeredito(rotuloTxt, ok) {
        garantir(6);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
        var rot = rotuloTxt + ': ';
        doc.text(rot, colX, y);
        if (ok) doc.setTextColor(15, 123, 61); else doc.setTextColor(180, 35, 24);
        doc.text(ok ? 'APROVADO' : 'REPROVADO', colX + doc.getTextWidth(rot), y);
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]); doc.setFont('helvetica', 'normal');
        y += 5.4;
      }

      function subtitulo(txt) {
        garantir(8);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]);
        doc.text(txt, colX, y); y += 6.6; // respiro antes da 1ª linha do bloco
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
      }

      function foto(dataUrl, rotuloTxt) {
        if (!dataUrl) return;
        var props;
        try { props = doc.getImageProperties(dataUrl); } catch (e) { return; }
        if (!props || !props.width) return;
        var w = Math.min(120, colW);
        var h = props.height * (w / props.width);
        var maxH = 95;
        if (h > maxH) { h = maxH; w = props.width * (h / props.height); }
        garantir(5 + h + 3);
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
        doc.text(rotuloTxt, colX, y); y += 3.5;
        try { doc.addImage(dataUrl, 'JPEG', colX, y, w, h); } catch (e) { }
        y += h + 4;
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
      }
      // Quanto uma foto vai ocupar em mm nesta largura (mesma conta do `foto`),
      // para saber o que ainda cabe na página antes de desenhar.
      function alturaFoto(dataUrl, larg) {
        var props;
        try { props = doc.getImageProperties(dataUrl); } catch (e) { return 0; }
        if (!props || !props.width) return 0;
        var w = Math.min(120, larg), h = props.height * (w / props.width);
        if (h > 95) h = 95;
        return 5 + h + 4;
      }
      function fotosDe(lista, rotuloTxt) {
        (Array.isArray(lista) ? lista : (lista ? [lista] : [])).forEach(function (f, i) {
          if (f && f.dataUrl) foto(f.dataUrl, rotuloTxt + (i > 0 ? ' (' + (i + 1) + ')' : ''));
        });
      }

      /* ---------- Renderizador genérico de um objeto (ponto/veículo/ambiente/coleta) ---------- */
      function renderCampos(obj, skipExtra) {
        skipExtra = skipExtra || {};
        var escal = [], gps = null, fotos = [], listas = [];
        Object.keys(obj).forEach(function (k) {
          if (SKIP[k] || skipExtra[k]) return;
          var val = obj[k];
          if (k === 'gps') { gps = val; return; }
          if (k === 'equipamentos') { if (val && val.length) escal.push([k, Array.isArray(val) ? val.join(', ') : val]); return; }
          if (ehFoto(val)) { fotos.push([k, val]); return; }
          if (ehListaItens(val)) { listas.push([k, val]); return; }
          if (val && typeof val === 'object') return; // objeto desconhecido: ignora
          escal.push([k, val]);
        });
        // identificação primeiro; resto na ordem de inserção (sort estável)
        escal.sort(function (a, b) {
          var ra = PRIO.indexOf(a[0]); var rb = PRIO.indexOf(b[0]);
          return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb);
        });
        escal.forEach(function (par) {
          if (par[0] === 'equipamentos') kv('Equipamentos', par[1]);
          else kv(rotulo(par[0]), fmtValor(par[0], par[1]));
        });
        if (gps) { kv('UTM', utmDe(gps)); kvSe('Endereço (GPS)', gps.endereco); }
        listas.forEach(function (par) {
          var sub = subRotulo(par[0]);
          // Coletas seguem a numeração do revezamento (Nº da primeira coleta):
          // se o técnico começou na 4ª, o PDF mostra "Coleta 4", "Coleta 5"…
          var base = (par[0] === 'coletas') ? (Math.max(1, parseInt(obj.primeiraColeta, 10) || 1) - 1) : 0;
          par[1].forEach(function (it, j) { subtitulo(sub + ' ' + (j + 1 + base)); renderCampos(it); });
        });
        if (fotos.length) {
          subtitulo('Fotos');
          fotos.forEach(function (par) { fotosDe(par[1], rotuloFoto(par[0])); });
        }
      }

      /* ---------- Corpo do RUÍDO (layout detalhado, 2 janelas) ---------- */
      function janelaComDados(j) {
        return !!(j && (j.nome || j.horaInicial || j.gps || j.chkIniValor || j.chkFimValor ||
          j.temperatura || j.observacoes || (j.fotoTelaIni && j.fotoTelaIni.length)));
      }
      function medicaoRuido(j) {
        kv('Nome / identificação', j.nome);
        // Data da medição por ponto: um serviço pode atravessar dias, e é ela que
        // diz se o clima do ponto vale por si ou repete o do ponto 1.
        kvSe('Data', fmtDataBR(j.data));
        kv('Hora inicial', j.horaInicial);
        kvSe('Hora de término', j.horaTermino);
        kvSe('Altura do sonômetro', j.altura != null && j.altura !== '' ? j.altura + ' m' : '');
        kvSe('Condições do ambiente', j.condAmbiente);
        kv('UTM', gpsTexto(j));
        kv('Endereço (GPS)', (j.gps && j.gps.endereco) || '—');
        kv('Checagem inicial', checagemTexto(j.chkIniSinal, j.chkIniValor));
        kv('Checagem final', checagemTexto(j.chkFimSinal, j.chkFimValor));
        var dif = diferencaChecagens(j); if (dif) kv('Diferença entre checagens', dif);
        kvSe('Temperatura', j.temperatura != null && j.temperatura !== '' ? j.temperatura + ' °C' : '');
        kvSe('Umidade', j.umidade != null && j.umidade !== '' ? j.umidade + ' %' : '');
        kvSe('Vento', j.vento != null && j.vento !== '' ? j.vento + ' m/s' : '');
        kvSe('Fontes percebidas da EMPRESA', j.fontesEmpresa);
        kvSe('Fontes percebidas do AMBIENTE', j.fontesAmbiente);
        kvSe('Característica da composição', j.caracteristicaComposicao);
        kvSe('Eventualidade', j.eventualidade);
        kvSe('Descrição da eventualidade', j.eventualidadeDesc);
        kvSe('Observações', j.observacoes);
        subtitulo('Fotos');
        fotosDe(j.fotoTelaIni, 'Tela — checagem inicial');
        fotosDe(j.fotoPonto, 'Ponto');
        fotosDe(j.fotoTelaFim, 'Tela — checagem final');
      }
      // Período (diurno/vespertino/noturno/outro). "Outro" usa o rótulo digitado.
      var PERIODO_ORDEM = ['diurno', 'vespertino', 'noturno', 'outro'];
      var PERIODO_NOME = { diurno: 'Diurno', vespertino: 'Vespertino', noturno: 'Noturno', outro: 'Outro' };
      function rotuloPeriodoPdf(id, geral) {
        if (id === 'outro') { var n = String(((geral || {}).periodoOutroLabel || '')).trim(); return n || 'Outro'; }
        return PERIODO_NOME[id] || id;
      }
      // Renderiza as duas janelas (Total/Residual) de uma medição, com prefixo opcional.
      function janelasDaMedicao(med, pre) {
        subtitulo(pre + 'Ruído Total (com a fonte)');
        medicaoRuido((med && med.total) || {});
        subtitulo(pre + 'Ruído Residual (sem a fonte)');
        if (med && janelaComDados(med.residual)) medicaoRuido(med.residual);
        else kv('Residual não medido', (med && med.justificativaResidual) || '—');
      }
      function pontoRuido(p, n, geral) {
        tituloSecao('Ponto P' + String(n).padStart(2, '0'));
        kv('Equipamentos do ponto', (p.equipamentos && p.equipamentos.length) ? p.equipamentos.join(', ') : '—');
        // Formato novo: p.periodos[periodo] = { total, residual, justificativaResidual }.
        if (p.periodos && typeof p.periodos === 'object') {
          var ids = PERIODO_ORDEM.filter(function (id) { return p.periodos[id]; });
          if (ids.length) {
            var varios = ids.length > 1;
            ids.forEach(function (id) {
              janelasDaMedicao(p.periodos[id], varios ? (rotuloPeriodoPdf(id, geral) + ' — ') : '');
            });
            return;
          }
        }
        // Formato antigo: total/residual no topo do ponto.
        var temJanelas = p.total && typeof p.total === 'object';
        if (!temJanelas) { medicaoRuido(p); return; } // rascunho MUITO antigo (flat)
        janelasDaMedicao(p, '');
      }
      /* ---------- Validação das SÉRIES de checagem ----------
       * A série (inicial do 1º ponto → final do último ponto) é limitada a 10
       * pontos; acima disso os pontos são divididos em blocos equilibrados
       * (EC.checagens.blocosDaSerie — mesma divisão usada na coleta). Se a
       * diferença passar de 0,5 dB, TODAS as medições daquela série devem ser
       * repetidas. Vale POR PERÍODO. No interno, as séries são por ambiente.
       */
      function totalDoPonto(p, id) {
        if (!p) return null;
        if (id !== null && p.periodos && typeof p.periodos === 'object') {
          return (p.periodos[id] && p.periodos[id].total) || null;
        }
        return (p.total && typeof p.total === 'object') ? p.total : null;
      }
      function seriesDeChecagem(pontos, total, geral) {
        var blocos = EC.checagens.blocosDaSerie(total);
        if (!blocos.length) return [];
        var ids = [];
        for (var i = 0; i < total; i++) {
          var pp = pontos[i];
          if (pp && pp.periodos && typeof pp.periodos === 'object') {
            PERIODO_ORDEM.forEach(function (id) { if (pp.periodos[id] && ids.indexOf(id) === -1) ids.push(id); });
          }
        }
        var usaPeriodo = ids.length > 0;
        if (!usaPeriodo) ids = [null];
        var out = [];
        ids.forEach(function (id) {
          blocos.forEach(function (b, bi) {
            var tIni = totalDoPonto(pontos[b.ini - 1], id);
            var tFim = totalDoPonto(pontos[b.fim - 1], id);
            var vi = parseFloat(String((tIni && tIni.chkIniValor) || '').replace(',', '.'));
            var vf = parseFloat(String((tFim && tFim.chkFimValor) || '').replace(',', '.'));
            var rot = EC.checagens.rotuloSerie({ ini: b.ini, fim: b.fim, indice: bi, qtde: blocos.length });
            var pre = usaPeriodo ? (rotuloPeriodoPdf(id, geral) + ' — ') : '';
            var texto;
            if (isNaN(vi) || isNaN(vf)) {
              texto = 'checagem inicial e/ou final não informada';
            } else {
              var r = EC.checagens.calcular((tIni && tIni.chkIniSinal) || '+', vi, (tFim && tFim.chkFimSinal) || '+', vf);
              texto = r.diff.toFixed(2).replace('.', ',') + ' dB — ' + (r.alerta
                ? 'FORA do limite (0,5 dB): repetir as medições dos pontos ' + b.ini + ' a ' + b.fim
                : 'dentro do limite (0,5 dB)');
            }
            out.push({ rotulo: pre + rot, texto: texto });
          });
        });
        return out;
      }
      function secaoSeries(pontos, total, geral) {
        var itens = seriesDeChecagem(pontos, total, geral);
        if (!itens.length) return;
        tituloSecao('Validação das séries de checagem');
        itens.forEach(function (it) { kv(it.rotulo, it.texto); });
      }

      function corpoRuido() {
        var campo = reg.campo || {};
        var geralRuido = campo.geral || {};
        var interno = campo.subtipo === 'interno10151' || campo.subtipo === 'interno10152';
        if (interno) {
          // Um bloco por AMBIENTE (condições da sala) + seus pontos.
          var ambientes = campo.ambientes || [];
          var totalAmb = Math.min(20, Math.max(0, parseInt((campo.geral || {}).qtdeAmbientes, 10) || ambientes.length));
          var gN = 0;
          for (var a = 0; a < totalAmb; a++) {
            var amb = ambientes[a] || {};
            tituloSecao('Ambiente ' + (a + 1) + (amb.nome ? ' - ' + amb.nome : ''));
            kv('Condição das esquadrias', amb.esquadrias);
            kv('Ocupação do ambiente', amb.condicao);
            kv('Condição do ambiente', amb.mobilia);
            kvSe('Área', (amb.area != null && amb.area !== '') ? amb.area + ' m²' : '');
            kvSe('Pontos calculados', amb.pontosCalculados);
            if (amb.layoutFoto && amb.layoutFoto.dataUrl) foto(amb.layoutFoto.dataUrl, 'Layout do ambiente');
            var pts = amb.pontos || [];
            var tp = Math.min(pts.length, Math.max(0, parseInt(amb.pontosCalculados, 10) || pts.length));
            for (var i = 0; i < tp; i++) { gN++; pontoRuido(pts[i] || {}, gN, geralRuido); }
            // No interno a série é por AMBIENTE (igual à coleta).
            secaoSeries(pts, tp, geralRuido);
          }
          return;
        }
        var pontos = campo.pontos || [];
        var total = Math.min(pontos.length, Math.max(1, parseInt(geralRuido.qtdePontos, 10) || pontos.length));
        for (var k = 0; k < total; k++) pontoRuido(pontos[k] || {}, k + 1, geralRuido);
        secaoSeries(pontos, total, geralRuido);
      }

      /* ---------- Particulados: página do ponto em caixas ---------- */

      // Caixa de borda fina com título azul. Desenha só a moldura + o título e
      // devolve o Y de onde o conteúdo começa; a borda é fechada depois, quando
      // se sabe a altura (fecharCaixa) — assim o conteúdo manda na altura.
      var BORDA = [200, 208, 218], ZEBRA = [244, 246, 249], CAB = [62, 92, 138];
      function abrirCaixa(x, yy, w, titulo) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
        doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]);
        doc.text(titulo, x + 5, yy + 8.5);
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]); doc.setFontSize(9);
        return yy + 14;
      }
      function fecharCaixa(x, yy, w, ate) {
        doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.3);
        doc.roundedRect(x, yy, w, Math.max(12, ate - yy), 1.5, 1.5, 'S');
      }

      // Desenha um bloco DENTRO de uma coluna e devolve o Y final. `fn` usa os
      // mesmos kv/subtitulo/foto de sempre — eles respeitam colX/colW.
      function naColuna(x, w, yy, fn) {
        var salvoY = y, salvoX = colX, salvoW = colW, salvoQ = semQuebra;
        y = yy; colX = x; colW = w; semQuebra = true;
        try { fn(); } catch (e) { /* um bloco não derruba o PDF */ }
        var fim = y;
        y = salvoY; colX = salvoX; colW = salvoW; semQuebra = salvoQ;
        return fim;
      }

      // Linhas da tabela "Dados da coleta": rótulo + valor no início e no fim.
      // A coluna de 400 mm só entra quando algum dos dois lados tem leitura (o
      // PTS não usa separador, então costuma vir só a de 800).
      // Ordem preferida das linhas (a do modelo); o que não estiver aqui entra
      // depois, na ordem em que foi preenchido — assim nenhum campo da coleta
      // some do relatório, nem hoje nem quando um campo novo for criado.
      var ORDEM_COLETA = ['hora', 'data', 'codigoFiltro', 'horimetro', 'temp', 'umid',
        'pressao', 'vento', 'col800sobe', 'col800desce', 'col00sobe', 'col00desce', 'tempo'];
      function linhasColeta(col, ponto, escopoOs) {
        var bases = [], vistos = {}, avulsos = [];
        Object.keys(col).forEach(function (k) {
          if (SKIP[k]) return;
          var m = k.match(/^(.*)_(ini|fim)$/);
          if (m) { if (!vistos[m[1]]) { vistos[m[1]] = 1; bases.push(m[1]); } return; }
          if (ehFoto(col[k]) || (col[k] && typeof col[k] === 'object')) return; // foto/objeto: fora da tabela
          avulsos.push(k);
        });
        var ordem = function (k) { var i = ORDEM_COLETA.indexOf(k); return i < 0 ? 99 : i; };
        var todos = bases.map(function (b) { return { chave: b, par: true }; })
          .concat(avulsos.map(function (k) { return { chave: k, par: false }; }))
          .sort(function (a, b) { return ordem(a.chave) - ordem(b.chave); });
        var pares = todos.map(function (t) {
          if (!t.par) return [rotulo(t.chave) + ':', fmtValor(t.chave, col[t.chave]), ''];
          var rot = (BASE_INI_FIM[t.chave] || prettify(t.chave)) + ':';
          var ini = col[t.chave + '_ini'], fim = col[t.chave + '_fim'];
          if (t.chave === 'data') return [rot, fmtDataBR(ini), fmtDataBR(fim)];
          return [rot, fmtValor(t.chave + '_ini', ini), fmtValor(t.chave + '_fim', fim)];
        });
        // Veredito da vazão de cada lado (mesma conta da tela e do Excel).
        var vaz = ['Vazão da coleta:', null, null];
        if (EC.campoQar && EC.campoQar.vazaoColeta) {
          try {
            var vi = EC.campoQar.vazaoColeta(ponto, col, 'ini', escopoOs);
            var vf = EC.campoQar.vazaoColeta(ponto, col, 'fim', escopoOs);
            vaz[1] = (vi && vi.ok !== undefined) ? vi.ok : null;
            vaz[2] = (vf && vf.ok !== undefined) ? vf.ok : null;
          } catch (e) { /* sem veredito */ }
        }
        return { pares: pares, vazao: vaz };
      }

      // Tabela da coleta. Devolve o Y final. `x`/`w` permitem usá-la tanto na
      // coluna da direita (1ª coleta) quanto em largura cheia (demais).
      function tabelaColeta(x, yy, w, titulo, col, ponto, escopoOs) {
        var dados = linhasColeta(col, ponto, escopoOs);
        // A coluna dos rótulos acompanha o MAIOR rótulo (senão "Coluna 800
        // desce:" encostava na divisória na tabela estreita da 1ª coleta).
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
        var wRot = 0;
        dados.pares.concat([dados.vazao]).forEach(function (l) {
          wRot = Math.max(wRot, doc.getTextWidth(l[0]));
        });
        wRot = Math.min(Math.max(wRot + 5, 26), w * 0.46);
        var wVal = (w - wRot) / 2;
        var hLin = 6.4, hCab = 7.6;
        // Coluna estreita (tabela ao lado da foto): fonte e títulos menores, para
        // "Início da coleta" e "REPROVADO" não invadirem a coluna vizinha.
        var estreita = wVal < 27;
        var fCel = estreita ? 7 : 8;
        // cabeçalho
        doc.setFillColor(CAB[0], CAB[1], CAB[2]);
        doc.rect(x, yy, w, hCab, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(estreita ? 7.2 : 8.2); doc.setTextColor(255, 255, 255);
        doc.text(titulo, x + 2.5, yy + 5.2);
        doc.text(estreita ? 'Início' : 'Início da coleta', x + wRot + wVal / 2, yy + 5.2, { align: 'center' });
        doc.text(estreita ? 'Fim' : 'Fim da coleta', x + wRot + wVal + wVal / 2, yy + 5.2, { align: 'center' });
        var ly = yy + hCab, zebra = false;
        function linha(rot, a, b, corA, corB) {
          if (zebra) { doc.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]); doc.rect(x, ly, w, hLin, 'F'); }
          zebra = !zebra;
          doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.2);
          doc.line(x, ly + hLin, x + w, ly + hLin);
          doc.setFontSize(fCel); doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
          doc.text(rot, x + 2.5, ly + 4.4);
          doc.setTextColor(corA ? corA[0] : PRETO[0], corA ? corA[1] : PRETO[1], corA ? corA[2] : PRETO[2]);
          doc.text(v(a), x + wRot + wVal / 2, ly + 4.4, { align: 'center' });
          doc.setTextColor(corB ? corB[0] : PRETO[0], corB ? corB[1] : PRETO[1], corB ? corB[2] : PRETO[2]);
          doc.text(v(b), x + wRot + wVal + wVal / 2, ly + 4.4, { align: 'center' });
          doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
          ly += hLin;
        }
        dados.pares.forEach(function (l) { linha(l[0], l[1], l[2]); });
        var VERDE = [15, 123, 61], VERM = [180, 35, 24];
        if (dados.vazao[1] !== null || dados.vazao[2] !== null) {
          linha(dados.vazao[0],
            dados.vazao[1] === null ? '—' : (dados.vazao[1] ? 'APROVADO' : 'REPROVADO'),
            dados.vazao[2] === null ? '—' : (dados.vazao[2] ? 'APROVADO' : 'REPROVADO'),
            dados.vazao[1] === null ? null : (dados.vazao[1] ? VERDE : VERM),
            dados.vazao[2] === null ? null : (dados.vazao[2] ? VERDE : VERM));
        }
        // moldura + divisórias das colunas
        doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.3);
        doc.rect(x, yy, w, ly - yy, 'S');
        doc.line(x + wRot, yy + hCab, x + wRot, ly);
        doc.line(x + wRot + wVal, yy + hCab, x + wRot + wVal, ly);
        return ly;
      }

      // QAR: campos brutos que NÃO saem no PDF — a curva resume as placas, o
      // filtro e os coeficientes do certificado (pedido da Raisa, 2026-08-11).
      function skipQar(p, semFotos) {
        var skip = { calibA1: 1, calibB1: 1, coletas: 1 };
        if (semFotos) Object.keys(p).forEach(function (k) { if (ehFoto(p[k])) skip[k] = 1; });
        Object.keys(p).forEach(function (k) {
          if (/^carta\d+_\d+(sobe|desce)$/.test(k) || /^filtro_\d+(sobe|desce)$/.test(k)) skip[k] = 1;
        });
        return skip;
      }

      // Tabela simples de grade (cabeçalho azul + zebra), para as leituras da
      // calibração. Devolve o Y final.
      function tabelaGrade(x, yy, w, cabecalhos, linhas) {
        var n = cabecalhos.length;
        var w0 = Math.min(30, w * 0.24), wc = (w - w0) / (n - 1);
        var hLin = 6.4, hCab = 7.6;
        doc.setFillColor(CAB[0], CAB[1], CAB[2]);
        doc.rect(x, yy, w, hCab, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
        doc.text(cabecalhos[0], x + 2.5, yy + 5.2);
        for (var c = 1; c < n; c++) doc.text(cabecalhos[c], x + w0 + wc * (c - 1) + wc / 2, yy + 5.2, { align: 'center' });
        var ly = yy + hCab, zebra = false;
        linhas.forEach(function (l) {
          if (zebra) { doc.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]); doc.rect(x, ly, w, hLin, 'F'); }
          zebra = !zebra;
          doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.2);
          doc.line(x, ly + hLin, x + w, ly + hLin);
          doc.setFontSize(8); doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
          doc.text(String(l[0]), x + 2.5, ly + 4.4);
          for (var k = 1; k < n; k++) doc.text(v(l[k]), x + w0 + wc * (k - 1) + wc / 2, ly + 4.4, { align: 'center' });
          ly += hLin;
        });
        doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.3);
        doc.rect(x, yy, w, ly - yy, 'S');
        for (var d = 1; d < n; d++) doc.line(x + w0 + wc * (d - 1), yy + hCab, x + w0 + wc * (d - 1), ly);
        return ly;
      }

      // Rótulo de cada confirmação da calibração (as caixinhas da tela).
      var CHECKS_QAR = {
        aquec0: 'Motor aquecido', zerar0: 'Manômetro zerado', zerar1: 'Válvulas fechadas',
        vaz0: 'Manômetro 800 mm - vazamento OK', vaz1: 'Manômetro 400 mm - vazamento OK',
        porta0: 'Nenhuma fuga de ar detectada', calib0: 'Calibração aprovada'
      };

      /**
       * Caixa "Leituras da calibração": a1/b1 do certificado, as leituras de
       * cada placa de retenção e do filtro, e as confirmações de cada passo.
       * A curva RESUME esses números, mas não os substitui — tudo o que a tela
       * de Serviços coleta continua no relatório (pedido da Raisa, 2026-08-20).
       */
      function calibracaoParticulados(it) {
        var placas = ['18', '13', '10', '09', '08'];
        var linhas = [];
        placas.forEach(function (c) {
          var p = 'carta' + c + '_';
          var l = ['Placa ' + c, it[p + '800sobe'], it[p + '800desce'], it[p + '00sobe'], it[p + '00desce']];
          if (l.slice(1).some(function (x) { return v(x) !== '—'; })) linhas.push(l);
        });
        var f = ['Com filtro', it.filtro_800sobe, it.filtro_800desce, it.filtro_00sobe, it.filtro_00desce];
        if (f.slice(1).some(function (x) { return v(x) !== '—'; })) linhas.push(f);
        var checks = it.checks || {};
        var chaves = Object.keys(CHECKS_QAR).filter(function (k) { return k in checks; });
        var temA1 = v(it.calibA1) !== '—' || v(it.calibB1) !== '—';
        if (!linhas.length && !chaves.length && !temA1) return;

        garantir(30 + linhas.length * 6.4 + chaves.length * 5.4);
        var topo = y;
        var yy = abrirCaixa(MARGEM, topo, LARG, 'Leituras da calibração');
        yy = naColuna(MARGEM + 5, LARG - 10, yy, function () {
          if (temA1) {
            kv('Inclinação a1 (certificado do CPV)', it.calibA1);
            kv('Intercepto b1 (certificado do CPV)', it.calibB1);
            y += 1;
          }
        });
        if (linhas.length) {
          yy = tabelaGrade(MARGEM + 4, yy, LARG - 8,
            ['Placa de retenção', '800 sobe', '800 desce', '400 sobe', '400 desce'], linhas) + 3;
        }
        if (chaves.length) {
          yy = naColuna(MARGEM + 5, LARG - 10, yy + 2, function () {
            subtitulo('Confirmações da calibração');
            chaves.forEach(function (k) { kv(CHECKS_QAR[k], checks[k] ? 'Sim' : 'Não'); });
          });
        }
        fecharCaixa(MARGEM, topo, LARG, yy + 2);
        y = yy + 10;
      }

      // Uma página por ponto: barra, curva + dados da calibração, foto + coleta.
      function pontoParticulados(it, n) {
        var escopoOs = (reg.servico && reg.servico.escopo) || '';
        if (y > MARGEM + 1) novaPagina();   // cada ponto começa em uma página
        tituloSecao('Ponto ' + n);

        var GAP = 6, wDir = 72, wEsq = LARG - wDir - GAP, xDir = MARGEM + wEsq + GAP;
        var topo = y;

        // Esquerda: curva (números + gráfico + legenda).
        var fimEsq = naColuna(MARGEM, wEsq, topo, function () { curvaQarPdf(it); });
        // Direita: caixa com os dados do ponto (sem as leituras brutas das placas).
        var yConteudo = abrirCaixa(xDir, topo, wDir, 'Dados da calibração do ponto');
        var fimDir = naColuna(xDir + 5, wDir - 10, yConteudo, function () { renderCampos(it, skipQar(it, true)); });
        fecharCaixa(xDir, topo, wDir, fimDir + 4);

        y = Math.max(fimEsq, fimDir + 4) + 8;

        // Linha de baixo: registro fotográfico | dados da 1ª coleta.
        var cols = it.coletas || [];
        var base = Math.max(1, parseInt(it.primeiraColeta, 10) || 1) - 1;
        var topo2 = y;
        // Fotos do ponto: as que couberem na página entram na caixa; o resto sai
        // depois, em largura cheia (a caixa não pode crescer por cima do rodapé).
        var todasFotos = [];
        Object.keys(it).forEach(function (k) {
          if (!ehFoto(it[k])) return;
          (Array.isArray(it[k]) ? it[k] : [it[k]]).forEach(function (f) {
            if (f && f.dataUrl) todasFotos.push({ dataUrl: f.dataUrl, rotulo: rotuloFoto(k) });
          });
        });
        var limiteY = A4_H - MARGEM - 12;
        var sobraram = [];
        var yFoto = abrirCaixa(MARGEM, topo2, wEsq, 'Registro fotográfico');
        var fimFoto = naColuna(MARGEM + 5, wEsq - 10, yFoto, function () {
          if (!todasFotos.length) {
            doc.setFontSize(9); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
            doc.text('Sem foto neste ponto.', colX, y); y += 6;
            doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
            return;
          }
          todasFotos.forEach(function (f, i) {
            var alt = alturaFoto(f.dataUrl, colW);
            if (i > 0 && y + alt + 6 > limiteY) { sobraram.push(f); return; }
            foto(f.dataUrl, f.rotulo + (i > 0 ? ' (' + (i + 1) + ')' : ''));
          });
        });
        var fimColeta = topo2;
        var yTab = 0;
        if (cols.length) {
          yTab = abrirCaixa(xDir, topo2, wDir, 'Dados da coleta');
          fimColeta = tabelaColeta(xDir + 4, yTab, wDir - 8, 'Coleta ' + (1 + base), cols[0] || {}, it, escopoOs) + 4;
        }
        // As duas caixas de baixo fecham na MESMA altura (como no modelo).
        var pe = Math.max(fimFoto + 2, fimColeta);
        fecharCaixa(MARGEM, topo2, wEsq, pe);
        if (cols.length) fecharCaixa(xDir, topo2, wDir, pe);
        y = pe + 8;

        // Leituras e confirmações da calibração (nada do que a tela coleta fica de fora).
        calibracaoParticulados(it);

        if (sobraram.length) {
          // O título desce junto com a 1ª foto (senão fica órfão no pé da página).
          garantir(14 + alturaFoto(sobraram[0].dataUrl, LARG));
          subtitulo('Registro fotográfico (continuação)');
          sobraram.forEach(function (f, i) { foto(f.dataUrl, f.rotulo + ' (' + (i + 2) + ')'); });
          y += 4;
        }

        // Demais coletas: tabela em largura cheia (cabem melhor as 12 linhas).
        for (var c = 1; c < cols.length; c++) {
          garantir(22 + 14 * 6.4);
          var topo3 = y;
          var yT = abrirCaixa(MARGEM, topo3, LARG, 'Dados da coleta');
          var fim = tabelaColeta(MARGEM + 4, yT, LARG - 8, 'Coleta ' + (c + 1 + base), cols[c] || {}, it, escopoOs);
          fecharCaixa(MARGEM, topo3, LARG, fim + 4);
          y = fim + 12;
        }
      }

      /* ---------- Corpo GENÉRICO (demais serviços) ---------- */
      function achaItens(campo) {
        var mapa = [['pontos', 'Ponto'], ['veiculos', 'Veículo'], ['ambientes', 'Ambiente']];
        for (var i = 0; i < mapa.length; i++) {
          var a = campo[mapa[i][0]];
          if (Array.isArray(a) && a.length) return { arr: a, rotulo: mapa[i][1] };
        }
        return null;
      }
      // Curva de calibração do QAR no PDF: números, vereditos e o GRÁFICO da
      // regressão (mesma matemática da tela — EC.campoQar.calcular). O
      // diagnóstico interno de manutenção NÃO entra aqui de propósito: o PDF
      // vai para o cliente; o diagnóstico fica no app e no Excel do SGP.
      function curvaQarPdf(p) {
        if (!(EC.campoQar && EC.campoQar.calcular)) return;
        var c = EC.campoQar.calcular(p, (reg.servico && reg.servico.escopo) || '');
        if (!c || c.falta || !c.pontos) return;
        var f4 = function (x) { return x.toFixed(4).replace('.', ','); };
        // O espaço da curva inteira (números + gráfico + legenda) já foi
        // reservado junto com a barra do ponto, em corpoGenerico.
        subtitulo('Curva de calibração multiponto');
        kv('Inclinação a2', f4(c.a2));
        kv('Intercepto b2', f4(c.b2));
        kv('Correlação r', f4(c.r));
        kvVeredito('Veredito da curva', c.curvaOk);
        if (c.qr !== undefined) {
          kv('Qr operacional', f4(c.qr) + ' m³/min');
          kvVeredito('Veredito da vazão', !!c.vazaoOk);
        }
        // Gráfico (jsPDF, mm): eixos nomeados centrados e colados no quadro,
        // pontos azuis rotulados e a LEGENDA abaixo, começando com "Legenda:".
        var GW = Math.min(120, colW - 14), GH = GW > 100 ? 60 : 46, GX = colX + 12;
        garantir(GH + 24); // gráfico + título do eixo X + legenda ficam juntos
        var xs = c.pontos.map(function (q) { return q.x; });
        var ys = c.pontos.map(function (q) { return q.y; });
        var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
        var fx = (xMax - xMin) * 0.14 || 0.001; xMin -= fx; xMax += fx;
        var yR = [c.a2 * xMin + c.b2, c.a2 * xMax + c.b2];
        var yMin = Math.min(Math.min.apply(null, ys), Math.min.apply(null, yR));
        var yMax = Math.max(Math.max.apply(null, ys), Math.max.apply(null, yR));
        var fy = (yMax - yMin) * 0.14 || 0.001; yMin -= fy; yMax += fy;
        var GY = y + 2;
        function PX(v) { return GX + (v - xMin) / (xMax - xMin) * GW; }
        function PY(v) { return GY + GH - (v - yMin) / (yMax - yMin) * GH; }
        doc.setDrawColor(180, 190, 200); doc.setLineWidth(0.25);
        doc.line(GX, GY + GH, GX + GW, GY + GH); // eixo X
        doc.line(GX, GY, GX, GY + GH);           // eixo Y
        // ajuste linear da curva (reta preta)
        doc.setDrawColor(PRETO[0], PRETO[1], PRETO[2]); doc.setLineWidth(0.5);
        doc.line(PX(xMin), PY(yR[0]), PX(xMax), PY(yR[1]));
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
        c.pontos.forEach(function (q) {
          // o texto do rótulo troca a cor de preenchimento — reafirma o AZUL
          // antes de cada bolinha (senão só a 1ª sai azul).
          doc.setFillColor(47, 128, 224);
          doc.circle(PX(q.x), PY(q.y), 1.1, 'F');
          doc.text('Placa ' + q.placa, PX(q.x) + 2, PY(q.y) - 1.6);
        });
        // títulos dos eixos: centrados e colados no quadro do gráfico
        doc.setFontSize(7.5);
        var tX = 'Coeficiente CPV';
        doc.text(tX, GX + GW / 2 - doc.getTextWidth(tX) / 2, GY + GH + 4.5);
        var tY = 'Coeficiente CVV';
        doc.text(tY, GX - 2.5, GY + GH / 2 + doc.getTextWidth(tY) / 2, { angle: 90 });
        // legenda abaixo do gráfico
        var LY = GY + GH + 9.5;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
        doc.text('Legenda:', GX, LY);
        var lx = GX + doc.getTextWidth('Legenda:') + 4;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
        doc.setFillColor(47, 128, 224);
        doc.circle(lx + 1.3, LY - 1, 1.2, 'F');
        var tLeg1 = 'Pontos de Calibração';
        doc.text(tLeg1, lx + 4, LY);
        var l2 = lx + 4 + doc.getTextWidth(tLeg1) + 6;
        doc.setDrawColor(PRETO[0], PRETO[1], PRETO[2]); doc.setLineWidth(0.5);
        doc.line(l2, LY - 1, l2 + 8, LY - 1);
        doc.text('Ajuste linear da curva', l2 + 10, LY);
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
        y = LY + 7;
      }

      function corpoGenerico() {
        var campo = reg.campo || {};
        var geral = campo.geral || {};
        var temGeral = Object.keys(geral).some(function (k) {
          return !SKIP[k] && !SKIP_GERAL[k] && geral[k] != null && geral[k] !== '' && typeof geral[k] !== 'object';
        });
        if (temGeral) { tituloSecao('Dados do monitoramento'); renderCampos(geral, SKIP_GERAL); }
        var itens = achaItens(campo);
        if (!itens) { tituloSecao('Monitoramento'); kv('Registro', 'sem itens preenchidos'); return; }
        var count = parseInt(geral.qtdePontos || geral.qtdeVeiculos || geral.qtdeAmbientes, 10) || itens.arr.length;
        var qtd = Math.min(itens.arr.length, count);
        // CECAV (vibração) agora pode ter medições por PERÍODO (diurno/noturno).
        var PER_ORDEM = ['diurno', 'noturno'], PER_NOME = { diurno: 'Diurno', noturno: 'Noturno' };
        var ehPontoQar = (reg.tipo === 'qar' && itens.rotulo === 'Ponto');
        // Particulados (PTS, PM10, PM2,5): layout em CAIXAS, conforme o modelo
        // aprovado pela Raisa em 2026-08-20 — cada ponto começa em uma página,
        // com curva + dados da calibração em cima e foto + tabela da coleta
        // embaixo. Os demais serviços seguem no fluxo corrido de sempre.
        if (ehPontoQar) {
          for (var q = 0; q < qtd; q++) pontoParticulados(itens.arr[q] || {}, q + 1);
          return;
        }
        for (var i = 0; i < qtd; i++) {
          tituloSecao(itens.rotulo + ' ' + (i + 1));
          var it = itens.arr[i] || {};
          if (it.periodos && typeof it.periodos === 'object') {
            var ids = PER_ORDEM.filter(function (id) { return it.periodos[id]; });
            if (ids.length) {
              var varios = ids.length > 1;
              ids.forEach(function (id) {
                if (varios) subtitulo('Período: ' + (PER_NOME[id] || id));
                renderCampos(it.periodos[id] || {});
              });
              continue;
            }
          }
          renderCampos(it);
        }
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
      doc.text(tituloTipo(reg), A4_W - MARGEM, y + 12, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
      doc.text(v(reg.servico && reg.servico.escopo), A4_W - MARGEM, y + 17, { align: 'right' });
      y += 24;
      doc.setDrawColor(AZUL[0], AZUL[1], AZUL[2]); doc.setLineWidth(0.4);
      doc.line(MARGEM, y, A4_W - MARGEM, y); y += 6;
      doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);

      // Código do registro de campo — logo abaixo do cabeçalho.
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]);
      doc.splitTextToSize('Registro de campo — Código: ' + codigoPdf(reg), LARG).forEach(function (linha) {
        doc.text(linha, MARGEM, y); y += 4.8;
      });
      y += 3;
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
      var det = contagemDetalhe(reg);
      var noun = det.n === 1 ? det.singular : det.plural;
      var nounItem = noun.charAt(0).toUpperCase() + noun.slice(1); // rótulo: Ponto/Pontos, Veículo/Veículos…
      var contagem = det.n;
      tituloSecao('Dados do serviço');
      kv('Escopo', serv.escopo);
      kv('Método', metodoServico(reg));
      kv('Subtipo', subtipoLabel(reg));
      kv('Período', serv.periodo);
      kv('Frequência', os.frequencia);
      kv('Campanha', serv.campanha);
      kvSe('Finalidade', geral.finalidade);
      kvSe('Objetivo', geral.objetivo);
      kv('Dias de medição', serv.dias);
      kv(nounItem, v(contagem) + (dg.qtdePontosOS != null && String(dg.qtdePontosOS) !== String(contagem) ? '  (previsto na OS: ' + dg.qtdePontosOS + ')' : ''));
      if (geral.justificativaPontos || dg.justificativaPontos) kv('Justificativa dos pontos', geral.justificativaPontos || dg.justificativaPontos);
      kv('Observação do escopo', serv.observacao);
      kv('Observações da OS', os.observacao);
      kv('Início', fmtDataBR(dg.dataInicio) + (dg.horaInicio ? ' às ' + dg.horaInicio : ''));
      // Quem executou o monitoramento em campo (usuário logado no app na hora do
      // preenchimento). Já estava no rodapé, mas em 7,5pt cinza no pé da página —
      // na prática ninguém achava. Aqui fica junto de quando e como foi feito.
      kv('Técnico responsável', reg.tecnico);
      var equips = (reg.equipamentos && reg.equipamentos.length) ? reg.equipamentos.join(', ')
        : (reg.equipamentosManual || '—');
      kv('Equipamentos (serviço)', equips);

      /* ---------- Corpo por tipo ---------- */
      if (reg.tipo === 'ruido') corpoRuido();
      else corpoGenerico();

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

      /* ---------- Salvar no app (o compartilhar fica com o chamador) ---------- */
      var nome = (opcoes && opcoes.nome) || nomeArquivo(reg);
      var blob = doc.output('blob');
      if (!(opcoes && opcoes.semSalvarLocal)) salvarPdf(reg, blob, nome); // guarda no aparelho (best-effort)
      // Sobe para o SharePoint (pasta "PDFs Campo") — em paralelo, best-effort.
      try { if (EC.sync && EC.sync.enviarPdf) EC.sync.enviarPdf(nome, blob); } catch (e) { /* best-effort */ }
      return { blob: blob, nome: nome };
    });
  }

  // Compartilha um PDF já gerado ({ blob, nome }) — WhatsApp etc.; sem folha
  // nativa, baixa o arquivo.
  function compartilharPdf(res, osNumero) {
    return compartilharBlob(res.blob, res.nome, 'Monitoramento OS ' + (osNumero || ''));
  }

  // Gera + guarda + compartilha (usado pelo 🕐 Histórico recente, onde o toque
  // no botão já é o gesto do usuário). Na finalização o app usa gerarSalvar()
  // automaticamente e compartilharPdf() no botão.
  function gerar(reg) {
    return gerarSalvar(reg).then(function (res) {
      return compartilharPdf(res, reg.os && reg.os.numero);
    });
  }

  return {
    suporta: suporta, gerar: gerar, gerarSalvar: gerarSalvar, compartilharPdf: compartilharPdf,
    listarSalvos: listarSalvos, abrirSalvo: abrirSalvo, excluirSalvo: excluirSalvo
  };
})();

// Alias de compatibilidade (fluxo.js antigo referenciava EC.pdfRuido).
EC.pdfRuido = EC.pdf;
