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
    nome: 'Nome / identificação', horaInicial: 'Hora inicial', horaFinal: 'Hora final',
    horaTermino: 'Hora de término', observacoes: 'Observações', temperatura: 'Temperatura',
    umidade: 'Umidade', vento: 'Vento', objetivo: 'Objetivo', finalidade: 'Finalidade',
    qtdePontos: 'Qtd. de pontos', qtdeVeiculos: 'Qtd. de veículos', qtdeAmbientes: 'Qtd. de ambientes',
    qtdeColetas: 'Qtd. de coletas', justificativaPontos: 'Justificativa dos pontos',
    tipoEquip: 'Tipo de equipamento', numeroEquip: 'Nº do equipamento', instalGeofone: 'Instalação do geofone',
    fonteVibracao: 'Fonte de vibração', intercorrencia: 'Intercorrência', intercorrenciaDesc: 'Descrição da intercorrência',
    placa: 'Placa', ano: 'Ano', endereco: 'Endereço', validadeCalib: 'Validade da calibração',
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
    umid_ini: '%', umid_fim: '%', ur: '%', vento: 'm/s', velar: 'm/s', pressao: 'mmHg',
    pressao_ini: 'mmHg', pressao_fim: 'mmHg', area: 'm²', altura: 'm', co2: 'ppm',
    pm25: 'µg/m³', pm10: 'µg/m³'
  };
  var FOTO_LABELS = {
    fotoPonto: 'Ponto', fotoTela: 'Tela', fotoTelaIni: 'Tela — checagem inicial',
    fotoTelaFim: 'Tela — checagem final', fotoAmbiente: 'Ambiente', foto: 'Evidência'
  };
  // Campos do serviço (geral) já mostrados na seção "Dados do serviço".
  var SKIP = { checks: 1, sala: 1, subtipo: 1, equipamentosManual: 1, qtdePontos: 1 };
  var SKIP_GERAL = { finalidade: 1, justificativaPontos: 1 };
  var PRIO = ['nome', 'placa', 'ano', 'endereco', 'horaInicial', 'hora_ini', 'data_ini',
    'tipoEquip', 'numeroEquip', 'objetivo', 'tipoMonitoramento'];

  function prettify(k) {
    var s = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function rotulo(k) {
    if (LABELS[k]) return LABELS[k];
    var m;
    if ((m = k.match(/^leitura(\d+)$/))) return 'Leitura ' + (parseInt(m[1], 10) + 1);
    if ((m = k.match(/^carta(\d+)_(\d+)(sobe|desce)$/))) return 'Carta ' + m[1] + ' — coluna ' + m[2] + ' ' + m[3];
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
  function diferencaChecagens(p) {
    var ini = parseFloat(String(p.chkIniValor || '').replace(',', '.')) * (p.chkIniSinal === '-' ? -1 : 1);
    var fim = parseFloat(String(p.chkFimValor || '').replace(',', '.')) * (p.chkFimSinal === '-' ? -1 : 1);
    if (isNaN(ini) || isNaN(fim)) return '';
    var d = Math.abs(fim - ini);
    return d.toFixed(2).replace('.', ',') + ' dB' + (d >= 0.5 ? '  (ACIMA de 0,5 dB - fora do limite)' : '  (dentro do limite)');
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
  function gerarSalvar(reg) {
    var Ctor = window.jspdf && window.jspdf.jsPDF;
    if (!Ctor) { if (EC.app) EC.app.mostrarToast('Biblioteca de PDF não carregou.'); return Promise.reject(); }

    return carregarLogo().then(function (logo) {
      var doc = new Ctor({ unit: 'mm', format: 'a4', compress: true });
      var y = MARGEM;

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
      function kv(rotuloTxt, valor) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
        var rot = rotuloTxt + ': ';
        var larguraRot = doc.getTextWidth(rot);
        doc.setFont('helvetica', 'normal');
        var linhas = doc.splitTextToSize(v(valor), LARG - larguraRot - 2);
        garantir(linhas.length * 4.6 + 1);
        doc.setFont('helvetica', 'bold'); doc.text(rot, MARGEM, y);
        doc.setFont('helvetica', 'normal');
        for (var i = 0; i < linhas.length; i++) {
          doc.text(linhas[i], MARGEM + larguraRot, y);
          if (i < linhas.length - 1) y += 4.6;
        }
        y += 5.4;
      }
      // kv que só sai se tiver valor (evita "—" em campos que não existem no subtipo).
      function kvSe(rotuloTxt, valor) {
        if (valor === undefined || valor === null || String(valor).trim() === '' || String(valor) === '—') return;
        kv(rotuloTxt, valor);
      }

      function subtitulo(txt) {
        garantir(7);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]);
        doc.text(txt, MARGEM, y); y += 5.5;
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
      }

      function foto(dataUrl, rotuloTxt) {
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
        doc.text(rotuloTxt, MARGEM, y); y += 3.5;
        try { doc.addImage(dataUrl, 'JPEG', MARGEM, y, w, h); } catch (e) { }
        y += h + 4;
        doc.setTextColor(PRETO[0], PRETO[1], PRETO[2]);
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
          par[1].forEach(function (it, j) { subtitulo(sub + ' ' + (j + 1)); renderCampos(it); });
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
      function pontoRuido(p, n) {
        tituloSecao('Ponto P' + String(n).padStart(2, '0'));
        kv('Equipamentos do ponto', (p.equipamentos && p.equipamentos.length) ? p.equipamentos.join(', ') : '—');
        var temJanelas = p.total && typeof p.total === 'object';
        if (!temJanelas) { medicaoRuido(p); return; } // rascunho antigo (flat)
        subtitulo('Ruído Total (com a fonte)');
        medicaoRuido(p.total || {});
        subtitulo('Ruído Residual (sem a fonte)');
        if (janelaComDados(p.residual)) medicaoRuido(p.residual);
        else kv('Residual não medido', p.justificativaResidual || '—');
      }
      function corpoRuido() {
        var campo = reg.campo || {};
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
            for (var i = 0; i < tp; i++) { gN++; pontoRuido(pts[i] || {}, gN); }
          }
          return;
        }
        var geral = campo.geral || {};
        var pontos = campo.pontos || [];
        var total = Math.min(pontos.length, Math.max(1, parseInt(geral.qtdePontos, 10) || pontos.length));
        for (var k = 0; k < total; k++) pontoRuido(pontos[k] || {}, k + 1);
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
        for (var i = 0; i < qtd; i++) {
          tituloSecao(itens.rotulo + ' ' + (i + 1));
          renderCampos(itens.arr[i] || {});
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
      var nome = nomeArquivo(reg);
      var blob = doc.output('blob');
      salvarPdf(reg, blob, nome); // guarda no aparelho (best-effort, não bloqueia)
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
