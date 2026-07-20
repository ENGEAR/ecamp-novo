/**
 * campo-ruido.js — Monitoramento em campo: RUÍDO (tipo piloto)
 *
 * Desenha o formulário de coleta do tipo Ruído com os subtipos:
 *   🌳 externo · 🏠 interno (NBR 10151) · 🏠 interno (NBR 10152) ·
 *   🚆 ferroviário · ✈️ aeronáutico
 * Os dois internos são iguais por ora (só muda a nota "com/sem pessoas").
 * Cada subtipo tem campos gerais próprios e campos por ponto (paginados).
 * Regras especiais implementadas:
 *   - interno: condições ambientais só no 1º ponto; checagem final só no último;
 *     cálculo de pontos pela área (1 a cada 30 m²); canvas do layout da sala.
 *   - ferroviário/aeronáutico: checks de instalação conforme a finalidade.
 *   - aeronáutico operacional: sem clima digitado (a estação meteorológica
 *     registra) — confirmado com a Raisa em 12/06/2026.
 *   - alerta de diferença entre checagens ≥ 0,5 dB e de vento ≥ 5 m/s.
 *
 * Interface (namespace global EC.campoRuido):
 *   EC.campoRuido.renderizar(container, ctx)
 *     ctx.estado : estado do fluxo (mutado: ctx.estado.campo = {subtipo, geral, pontos})
 *     ctx.salvar : função que persiste o estado no localStorage
 *   EC.campoRuido.TIPOS_CARIMBO[subtipo] → texto do tipo p/ carimbo de foto
 *     (ex.: 'RUIDOEXTERNO')
 *   EC.campoRuido.SUBTIPOS → [{id, icone, nome}]
 *
 * Depende de: EC.gps, EC.foto, EC.paginacao, EC.alertaVento, EC.checagens,
 * EC.canvasSala, EC.equipamentosMock.
 */
window.EC = window.EC || {};

EC.campoRuido = (function () {
  'use strict';

  const SUBTIPOS = [
    { id: 'externo', icone: '🌳', img: 'Ambiente Externo.png', nome: 'Ambiente Externo' },
    { id: 'interno10151', icone: '🏠', img: 'Ambiente Interno (NBR 10151).png', nome: 'Ambiente Interno (NBR 10151)' },
    { id: 'interno10152', icone: '🏠', img: 'Ambiente Interno (NBR 10152).png', nome: 'Ambiente Interno (NBR 10152)' },
    { id: 'ferroviario', icone: '🚆', nome: 'Ferroviário' },
    { id: 'aeronautico', icone: '✈️', nome: 'Aeronáutico' }
  ];

  // Os dois subtipos internos (10151 e 10152) compartilham o mesmo formulário.
  function ehInterno(sub) { return sub === 'interno10151' || sub === 'interno10152'; }

  // Fotos obrigatórias por subtipo (chave do dado → rótulo). Não se sai do
  // ponto sem todas tiradas.
  const FOTOS_POR_SUBTIPO = {
    externo: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto'], ['fotoTelaFim', 'foto da tela (checagem final)']],
    interno10151: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto']],
    interno10152: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto']],
    ferroviario: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto'], ['fotoTelaFim', 'foto da tela (checagem final)']],
    aeronautico: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto'], ['fotoTelaFim', 'foto da tela (checagem final)']]
  };

  // Finalidades = métodos do SGE (Aéreo / Ferroviário). Mantidas iguais às do
  // SGE para o método da OS pré-selecionar a finalidade no formulário.
  const FINALIDADES_FERRO = ['Passagem de Composição Férrea', 'Pátios / Manobras / Cruzamentos'];
  const FINALIDADES_AERO = ['Monitoramento de Receptores Potencialmente Críticos', 'Monitoramento Operacional no Aeródromo'];
  const FERRO_PASSAGEM = FINALIDADES_FERRO[0];
  const FERRO_PATIOS = FINALIDADES_FERRO[1];
  const AERO_RECEPTORES = FINALIDADES_AERO[0];
  const AERO_OPERACIONAL = FINALIDADES_AERO[1];

  const TIPOS_CARIMBO = {
    externo: 'RUIDOEXTERNO',
    interno10151: 'RUIDOINTERNO10151',
    interno10152: 'RUIDOINTERNO10152',
    ferroviario: 'RUIDOFERROVIARIO',
    aeronautico: 'RUIDOAERONAUTICO'
  };

  /* ===== Textos dos checks (da especificação) ===== */

  // Posicionamento do microfone (ruído externo): a altura muda conforme seja
  // longa duração (≥ 4 m) ou medição comum (1,2 a 1,5 m).
  const POSICIONAMENTO_EXTERNO_PADRAO = [
    'Altura entre 1,2 m e 1,5 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Protetor de vento instalado'
  ];
  const POSICIONAMENTO_EXTERNO_LONGA = [
    'Altura mínima de 4 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Protetor de vento instalado'
  ];

  const CHECKS_MONTAGEM_EXTERNO = [
    'Instalado em tripé estável',
    'Garantida ausência de vibrações',
    'Conferidas as configurações do equipamento (ponderação A, tempo de integração, filtro de 1/3 oitava, áudio)',
    'Verificada a bateria e o funcionamento geral'
  ];

  // Montagem (externo): na LONGA DURAÇÃO a configuração inclui fast (F) e há
  // quatro checks extras (energia, cabo, verificações intermediárias, internet).
  function checksMontagemExterno(longaDuracao) {
    if (!longaDuracao) return CHECKS_MONTAGEM_EXTERNO;
    const base = CHECKS_MONTAGEM_EXTERNO.slice();
    base[2] = 'Conferidas as configurações do equipamento (ponderação A, fast (F), tempo de integração, filtro de 1/3 oitava, áudio)';
    return base.concat([
      'Fonte de energia garantida (bateria/rede)',
      'Cabo de extensão validado (quando aplicável)',
      'Programar "Verificações intermediárias ao longo da campanha (quando aplicável)"',
      'Verificar comunicação com internet (quando online)'
    ]);
  }

  const CHECKS_POSICIONAMENTO_INTERNO = [
    'Distribuir os pontos de forma uniforme no ambiente',
    'Garantir representatividade do campo sonoro',
    'Distância mínima de 0,5 m de paredes, teto e piso',
    'Distância mínima de 1 m de janelas, portas ou aberturas',
    'Garantir distância mínima de 0,7 m entre pontos',
    'Pontos distribuídos de forma representativa no ambiente',
    'Variar a altura do microfone entre os pontos (entre 1,2 e 1,5 m) sempre que possível',
    'Não é obrigatório usar protetor de vento no microfone'
  ];

  // Montagem (interno): a configuração de resposta muda por norma —
  // 10151 usa fast (F); 10152 usa slow (S). O resto é igual (5 itens).
  function checksMontagemInterno(sub) {
    const config = sub === 'interno10151'
      ? 'Conferir configurações do equipamento (ponderação A, fast (F), tempo de medição, áudio)'
      : 'Conferir configurações do equipamento (ponderação A, slow (S), tempo de medição, áudio)';
    return [
      'Instalar em tripé estável',
      'Garantir ausência de vibrações',
      config,
      'Configurar filtro 1/1 de oitava',
      'Verificar bateria e funcionamento geral'
    ];
  }

  const CHECKS_LTOT = [
    'Medir com todas as fontes em operação',
    'Garantir que representa a condição real do ambiente'
  ];

  const CHECKS_LRES = [
    'Medir com a fonte objeto desligada (quando possível)',
    'Garantir ausência da contribuição da fonte avaliada',
    'Caso não seja possível desligar, medir em local equivalente e registrar justificativa'
  ];

  const CHECKS_INSTALACAO_FERRO = [
    'Altura entre 1,2 m e 1,5 m do solo',
    'Para longa duração: microfone preferencialmente ≥ 4 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Uso obrigatório de protetor de vento',
    'Microfone direcionado para a trajetória do tráfego ferroviário',
    'Definir pontos de medição: locais críticos ao longo da linha férrea (casas, escolas, hospitais, etc.)'
  ];

  // Checks do ponto (ferroviário) — iguais nos dois métodos: "curto período"/
  // "longa duração" em negrito; condições ambientais em dois checks (chuva/vento).
  const CHECKS_PONTO_FERRO = [
    '🚃 Som residual — <strong>curto período</strong>: ao menos 15 min de medição (contínua ou não); monitoramento antes ou após a passagem da composição',
    '🚃 Som residual — <strong>longa duração</strong>: instalar equipamento para longa duração; diurno ≥ 60 min (contínua ou não); noturno ≥ 30 min (contínua ou não)',
    '🚂 Som da passagem ferroviária: considerar todo o tempo da passagem; mínimo de 3 passagens monitoradas; pelo menos 1 passagem em cada sentido; se densidade ≤ 3 composições/dia, medir pelo menos uma passagem; ⚠️ NÃO realizar durante cruzamento em linha dupla; sirenes, sinos, buzinas e campainhas são sons intrusivos; registrar características das composições (ex.: trem de carga, passageiro)',
    '🌡️ Condições ambientais: não monitorar com chuva (exceto se aprovação prévia)',
    '🌡️ Condições ambientais: não monitorar com vento > 5 m/s'
  ];

  // Pátios / Manobras / Cruzamentos: requisitos de instalação próprios.
  const CHECKS_INSTALACAO_FERRO_PATIOS = [
    'Altura ≥ 4 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Uso obrigatório de protetor de vento',
    'Microfone direcionado para o tráfego ferroviário'
  ];

  // Checklist de operações em pátios (preparação, abaixo da qtde de pontos).
  // Não bloqueia o salvamento — é orientação de campo. Sub-títulos em negrito.
  const OPERACOES_FERRO_PATIOS = [
    { sub: null, texto: 'Sugerido: monitoramento 24 horas' },
    { sub: 'Manobras:', texto: 'Contemplar pelo menos uma manobra completa típica do local (diurno ou noturno)' },
    { sub: null, texto: 'Sons de passagens durante manobras = sons intrusivos' },
    { sub: 'Composição parada:', texto: 'Medir sem interferência de outras composições, cruzamentos, ultrapassagens ou manobras' },
    { sub: 'Cruzamentos / Ultrapassagens:', texto: 'Uma composição parada e a outra em movimento efetivando o cruzamento/ultrapassagem' },
    { sub: null, texto: 'Sons de manobra = sons intrusivos' },
    { sub: null, texto: 'Pelo menos dois eventos de cruzamento ou ultrapassagem (diurno ou noturno)' },
    { sub: null, texto: 'Mínimo de 30 eventos de operações de engates em período entre 60 min e 240 min — registrar LAFmax de cada evento' }
  ];

  // Pátios — monitoramento do SOM RESIDUAL (janela Residual do ponto).
  const MONITORAMENTO_RESIDUAL_PATIOS = [
    { sub: 'Monitoramento 24 horas (sugerido):', texto: 'Diurno: pelo menos 60 min de medição (contínua ou não)' },
    { sub: null, texto: 'Noturno: pelo menos 30 min de medição (contínua ou não)' },
    { sub: 'Monitoramento pontual:', texto: 'Pelo menos 15 min de medição (contínua ou não)' }
  ];

  const CHECKS_INSTALACAO_AERO_RECEPTORES = [
    'Altura entre 1,2 m e 1,5 m do solo',
    'Para longa duração: microfone preferencialmente ≥ 4 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Uso obrigatório de protetor de vento',
    'Microfone direcionado para a trajetória das aeronaves',
    'Configurar ponderação A e filtro de 1/3 de oitava',
    '✅ Validação: ruído residual ≥ 10 dB abaixo do ruído das aeronaves',
    'Se diferença < 10 dB: acompanhar e anotar influências das aeronaves'
  ];

  const CHECKS_INSTALACAO_AERO_OPERACIONAL = [
    'Altura de 6 m do solo',
    'Distância mínima de 10 m de superfícies refletoras',
    'Uso obrigatório de protetor de vento',
    'Microfone direcionado para a trajetória das aeronaves',
    'Linha de visada livre para operações aéreas',
    'Configurar ponderação A e filtro de 1/3 de oitava',
    'Verificar cabo de extensão (quando aplicável)',
    'Instalar estrutura elevada e estável (quando aplicável)',
    'Conferir autonomia energética',
    'Verificar funcionamento da estação meteorológica',
    'Programar verificações elétricas automáticas',
    'Configurar armazenamento contínuo',
    'Validar sincronismo entre áudio, ruído e meteorologia',
    'Confirmar transmissão/coleta remota de dados',
    '✅ Validação: ruído residual ≥ 10 dB abaixo do ruído das aeronaves',
    'Se diferença < 10 dB: acompanhar e anotar influências das aeronaves'
  ];

  const CHECKS_PONTO_AERO_RECEPTORES = [
    'Não monitorar com chuva (exceto se aprovação prévia)',
    'Não monitorar com vento > 5 m/s'
  ];

  let ctx = null;          // { estado, salvar }
  let raiz = null;         // container
  let pontoExibido = 1;
  let ambienteExibido = 1;     // interno: qual ambiente está aberto (1-based)
  let janelaExibida = 'total'; // janela do ponto em edição (externo): 'total' | 'residual'
  let temporizadorSalvar = null;

  // Cada ponto do ruído tem DUAS janelas de medição: Total (obrigatória) e
  // Residual (opcional, desde que justificada). Cada janela guarda os mesmos
  // campos; equipamentos é do ponto (compartilhado). Por ora só o EXTERNO usa.
  const JANELAS = [
    { id: 'total', icone: '🔊', nome: 'Total', ajuda: 'com a fonte em operação' },
    { id: 'residual', icone: '🔇', nome: 'Residual', ajuda: 'sem a fonte (background)' }
  ];

  function $(seletor) { return raiz.querySelector(seletor); }

  function campo() { return ctx.estado.campo; }

  // Interno usa campo.ambientes[] (cada ambiente com seus próprios pontos); os
  // demais subtipos usam campo.pontos direto. Estes helpers dão o "contexto
  // ativo" de pontos (do ambiente aberto, no interno) para paginador/render.
  function ehInternoAtivo() { return ehInterno(campo().subtipo); }
  function ambienteAtivo() {
    if (!ehInternoAtivo()) return null;
    return (campo().ambientes || [])[ambienteExibido - 1] || null;
  }
  function listaPontos() {
    const a = ambienteAtivo();
    if (a) { if (!a.pontos) a.pontos = []; return a.pontos; }
    return campo().pontos;
  }
  function totalPontosCtx() {
    if (ehInternoAtivo()) {
      const a = ambienteAtivo();
      return Math.min(20, Math.max(1, parseInt(a && a.pontosCalculados, 10) || 0));
    }
    return Math.min(20, Math.max(1, parseInt(campo().geral.qtdePontos, 10) || 0));
  }

  function ehLongaDuracao() {
    const s = ctx.estado.servico || {};
    return /longa\s*dura/i.test((s.metodo || '') + ' ' + (s.periodo || ''));
  }

  // Casa o método da OS com uma das finalidades do formulário, para
  // pré-selecioná-la (no Aéreo/Ferroviário o método do SGE é a finalidade).
  function finalidadePorMetodo(opcoes) {
    const m = ((ctx.estado.servico && ctx.estado.servico.metodo) || '').trim().toLowerCase();
    if (!m) return '';
    for (let i = 0; i < opcoes.length; i++) {
      const o = opcoes[i].toLowerCase();
      if (o === m || o.indexOf(m) === 0 || m.indexOf(o) === 0) return opcoes[i];
    }
    return '';
  }

  // Todos os subtipos de ruído usam 2 janelas (Total/Residual): as fotos ficam
  // dentro de cada janela e são validadas na finalização (itensFaltando), então
  // não bloqueia a troca de ponto aqui.
  function fotosFaltando() {
    return [];
  }

  // Fotos que faltam no ponto exibido no momento (usado pelo "Próximo →" do fluxo).
  function pontoAtualIncompleto() {
    if (!ctx || !campo()) return [];
    return fotosFaltando(listaPontos()[pontoExibido - 1], campo().subtipo);
  }

  // Itens em branco de UMA janela (Total ou Residual), conforme o subtipo.
  // Regra do escopo (2026-07): a checagem INICIAL só é obrigatória no ponto 1 e a
  // FINAL só no último ponto (na janela Total). Nos demais pontos são opcionais; a
  // foto da tela só é cobrada QUANDO a checagem correspondente estiver preenchida.
  // As condições ambientais (clima) só são obrigatórias no ponto 1. Tudo isso vale
  // só na Total — na Residual (ehPonto1/ehUltimo=false) checagem e clima são livres.
  function faltasJanela(subtipo, j, longa, geral, janela, ehPonto1, ehUltimo) {
    j = j || {};
    const falta = [];
    const ehTotal = janela === 'total';
    const iniObrig = ehTotal && ehPonto1;
    const fimObrig = ehTotal && ehUltimo;
    const climaObrig = ehTotal && ehPonto1;
    const reqVal = function (chave, rotulo) {
      const v = j[chave];
      if (v === undefined || v === null || String(v).trim() === '') falta.push(rotulo);
    };
    const preenchido = function (chave) {
      const v = j[chave];
      return v !== undefined && v !== null && String(v).trim() !== '';
    };
    const checks = j.checks || {};
    const grupoChecks = function (prefixo, qtde, rotulo) {
      let n = 0; for (let i = 0; i < qtde; i++) if (!checks[prefixo + i]) n++;
      if (n) falta.push(n + ' confirmação(ões) de ' + rotulo);
    };
    // Só alguns índices de um grupo (ex.: ferroviário clima usa [3,4]).
    const grupoChecksIdx = function (prefixo, indices, rotulo) {
      let n = 0; indices.forEach(function (i) { if (!checks[prefixo + i]) n++; });
      if (n) falta.push(n + ' confirmação(ões) de ' + rotulo);
    };
    // comuns a todas as janelas
    reqVal('nome', 'nome do ponto');
    reqVal('horaInicial', 'hora inicial');
    if (!j.gps) falta.push('GPS');
    // Checagem inicial: obrigatória só no ponto 1 (Total). A foto da tela inicial é
    // cobrada sempre que a checagem inicial estiver preenchida.
    if (iniObrig) reqVal('chkIniValor', 'checagem inicial (ponto 1)');
    if (preenchido('chkIniValor') && !EC.foto.tem(j.fotoTelaIni)) falta.push('foto da tela (checagem inicial)');
    if (!EC.foto.tem(j.fotoPonto)) falta.push('foto do ponto');

    if (ehInterno(subtipo)) {
      reqVal('altura', 'altura do sonômetro');
      grupoChecks('altura', 1, 'altura do sonômetro');
      if (climaObrig) {
        reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento');
        grupoChecks('chuva', 1, 'condições ambientais');
      }
      reqVal('eventualidade', 'eventualidade');
      if (j.eventualidade === 'Sim') reqVal('eventualidadeDesc', 'descrição da eventualidade');
    } else if (subtipo === 'ferroviario') {
      const fin = (geral || {}).finalidade;
      // Som/operação sempre exigidos; o clima [3,4] só no ponto 1.
      // Passagem: Total exige som da passagem [2]; Residual exige som residual [0,1].
      // Pátios: só o clima. Sem finalidade: som [0,1,2].
      if (fin === FERRO_PASSAGEM) {
        grupoChecksIdx('ferro', janela === 'total' ? [2] : [0, 1], 'checks do ponto');
      } else if (fin === FERRO_PATIOS) {
        // sem checks de som obrigatórios aqui (os blocos oper/mres são orientação)
      } else {
        grupoChecksIdx('ferro', [0, 1, 2], 'checks do ponto');
      }
      if (climaObrig) {
        grupoChecksIdx('ferro', [3, 4], 'condições ambientais');
        reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento');
      }
      reqVal('observacoes', 'observações');
    } else if (subtipo === 'aeronautico') {
      if ((geral || {}).finalidade === AERO_OPERACIONAL) {
        grupoChecks('estacao', 1, 'estação meteorológica funcionando');
      } else {
        grupoChecks('aero', CHECKS_PONTO_AERO_RECEPTORES.length, 'checks do ponto');
        if (climaObrig) { reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento'); }
      }
      reqVal('observacoes', 'observações');
    } else {
      // externo
      grupoChecks('pos', POSICIONAMENTO_EXTERNO_PADRAO.length, 'posicionamento do microfone');
      grupoChecks('mont', checksMontagemExterno(longa).length, 'montagem do equipamento');
      if (climaObrig) {
        if (longa) grupoChecks('climacont', 1, 'monitoramento contínuo de temperatura/umidade/vento');
        else { reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento'); }
      }
      reqVal('fontesEmpresa', 'fontes da empresa'); reqVal('fontesAmbiente', 'fontes do ambiente');
      reqVal('observacoes', 'observações');
    }

    // Checagem final: obrigatória só no último ponto (Total). Foto da tela final só
    // é cobrada quando a checagem final estiver preenchida. Uniforme a todos os subtipos.
    if (fimObrig) reqVal('chkFimValor', 'checagem final (último ponto)');
    if (preenchido('chkFimValor') && !EC.foto.tem(j.fotoTelaFim)) falta.push('foto da tela (checagem final)');

    return falta;
  }

  // Itens em branco de um ponto: Total obrigatório; Residual opcional se houver
  // justificativa. NÃO inclui a hora de término (sempre opcional).
  function itensFaltandoDoPonto(ponto, subtipo, indice, total, geral, longaDuracao) {
    ponto = ponto || {};
    const falta = [];
    const ehPonto1 = indice === 0;
    const ehUltimo = indice === (total - 1);
    faltasJanela(subtipo, ponto.total, longaDuracao, geral, 'total', ehPonto1, ehUltimo).forEach(function (x) { falta.push('Total: ' + x); });
    const justif = ponto.justificativaResidual && String(ponto.justificativaResidual).trim();
    if (!justif) {
      if (!janelaTemDados(ponto.residual)) {
        falta.push('Residual: medir OU escrever a justificativa');
      } else {
        // Residual nunca é ponto1/último para efeito de checagem/clima (regra só na Total).
        faltasJanela(subtipo, ponto.residual, longaDuracao, geral, 'residual', false, false).forEach(function (x) { falta.push('Residual: ' + x); });
      }
    }
    return falta;
  }

  // Checks de PREPARAÇÃO do campo (ficam no nível do serviço, não do ponto):
  // posicionamento/montagem (interno) e instalação (ferroviário/aeronáutico).
  function geralChecksFaltando(campo) {
    const g = campo.geral || {};
    const checks = g.checks || {};
    const out = [];
    const grupo = function (prefixo, qtde, rotulo) {
      let n = 0;
      for (let i = 0; i < qtde; i++) if (!checks[prefixo + i]) n++;
      if (n) out.push('Preparação: ' + n + ' confirmação(ões) de ' + rotulo);
    };
    // Interno: posicionamento/montagem são por AMBIENTE (validados em itensFaltandoInterno).
    if (campo.subtipo === 'ferroviario' && g.finalidade === FERRO_PASSAGEM) {
      grupo('instal', CHECKS_INSTALACAO_FERRO.length, 'instalação');
    } else if (campo.subtipo === 'ferroviario' && g.finalidade === FERRO_PATIOS) {
      grupo('instal', CHECKS_INSTALACAO_FERRO_PATIOS.length, 'instalação');
    } else if (campo.subtipo === 'aeronautico') {
      if (g.finalidade === AERO_RECEPTORES) grupo('instal', CHECKS_INSTALACAO_AERO_RECEPTORES.length, 'instalação');
      else if (g.finalidade === AERO_OPERACIONAL) grupo('instal', CHECKS_INSTALACAO_AERO_OPERACIONAL.length, 'instalação');
    }
    return out;
  }

  // Interno: valida por AMBIENTE (nome + condições + área + posicionamento/montagem
  // + os pontos daquele ambiente).
  function itensFaltandoInterno(campo, longaDuracao) {
    const g = campo.geral || {};
    const totalAmb = Math.min(20, Math.max(1, parseInt(g.qtdeAmbientes, 10) || 0));
    if (!totalAmb) return ['a quantidade de ambientes não foi definida'];
    const ambientes = campo.ambientes || [];
    const lista = [];
    const montItens = checksMontagemInterno(campo.subtipo);
    for (let a = 0; a < totalAmb; a++) {
      const amb = ambientes[a] || {};
      const rot = 'Ambiente ' + (a + 1) + (amb.nome ? ' (' + amb.nome + ')' : '') + ': ';
      if (!String(amb.nome || '').trim()) lista.push(rot + 'nome do ambiente');
      if (!amb.esquadrias) lista.push(rot + 'condição das esquadrias');
      if (!amb.condicao) lista.push(rot + 'ocupação do ambiente');
      if (!amb.mobilia) lista.push(rot + 'condição do ambiente');
      if (amb.area === undefined || amb.area === null || String(amb.area).trim() === '') lista.push(rot + 'área do ambiente');
      if (!amb.pontosCalculados) { lista.push(rot + 'calcular os pontos'); continue; }
      const checks = amb.checks || {};
      let np = 0; for (let i = 0; i < CHECKS_POSICIONAMENTO_INTERNO.length; i++) if (!checks['pos' + i]) np++;
      if (np) lista.push(rot + np + ' confirmação(ões) de posicionamento dos pontos');
      let nm = 0; for (let i = 0; i < montItens.length; i++) if (!checks['mont' + i]) nm++;
      if (nm) lista.push(rot + nm + ' confirmação(ões) de montagem do equipamento');
      const totalPts = Math.min(20, Math.max(1, parseInt(amb.pontosCalculados, 10) || 0));
      const pontos = amb.pontos || [];
      for (let p = 0; p < totalPts; p++) {
        itensFaltandoDoPonto(pontos[p], campo.subtipo, p, totalPts, g, longaDuracao).forEach(function (x) {
          lista.push(rot + 'P' + (p + 1) + ': ' + x);
        });
      }
    }
    return lista;
  }

  // Lista "P{n}: falta ..." de TODOS os pontos (usada para travar o salvamento).
  function itensFaltando(estado) {
    const campo = estado && estado.campo;
    if (!campo || !campo.subtipo) return ['o monitoramento em campo não foi iniciado'];
    const s = estado.servico || {};
    const longaDuracao = /longa\s*dura/i.test((s.metodo || '') + ' ' + (s.periodo || ''));
    if (ehInterno(campo.subtipo)) return itensFaltandoInterno(campo, longaDuracao);
    const total = Math.min(20, Math.max(1, parseInt(campo.geral.qtdePontos, 10) || 0));
    if (!total) return ['a quantidade de pontos do campo não foi definida'];
    const lista = [];
    geralChecksFaltando(campo).forEach(function (x) { lista.push(x); });
    // Variação no nº de pontos vs. previsto na OS → exige justificativa
    // (externo, ferroviário e aeronáutico têm o campo de qtd de pontos + OS).
    if (campo.subtipo === 'externo' || campo.subtipo === 'ferroviario' || campo.subtipo === 'aeronautico') {
      const previsto = (estado.dadosGerais || {}).qtdePontos;
      if (previsto != null && previsto !== '' &&
          String(campo.geral.qtdePontos) !== String(previsto) &&
          !String(campo.geral.justificativaPontos || '').trim()) {
        lista.push('justificativa da variação no número de pontos');
      }
    }
    for (let i = 0; i < total; i++) {
      itensFaltandoDoPonto(campo.pontos[i], campo.subtipo, i, total, campo.geral, longaDuracao).forEach(function (x) {
        lista.push('P' + (i + 1) + ': ' + x);
      });
    }
    return lista;
  }

  function salvar() { ctx.salvar(); }

  function salvarDevagar() {
    clearTimeout(temporizadorSalvar);
    temporizadorSalvar = setTimeout(salvar, 400);
  }

  /* ===== Helpers de marcação ===== */

  function htmlChecks(itens, prefixo) {
    return itens.map(function (texto, i) {
      return '<label class="linha-check check-campo"><input type="checkbox" data-check="' + prefixo + i + '"><span>' + texto + '</span></label>';
    }).join('');
  }

  // Renderiza só alguns índices de um grupo, mantendo o índice ORIGINAL no
  // data-check (ex.: [3,4] → ferro3, ferro4) — preserva o vínculo com os dados.
  function htmlChecksIndices(itens, prefixo, indices) {
    return indices.map(function (i) {
      return '<label class="linha-check check-campo"><input type="checkbox" data-check="' + prefixo + i + '"><span>' + itens[i] + '</span></label>';
    }).join('');
  }

  // Checklist com sub-títulos em negrito (pátios: operações e som residual).
  function htmlChecksComSub(itens, prefixo) {
    return itens.map(function (it, i) {
      return (it.sub ? '<p class="subgrupo-titulo">' + it.sub + '</p>' : '') +
        '<label class="linha-check check-campo"><input type="checkbox" data-check="' + prefixo + i + '"><span>' + it.texto + '</span></label>';
    }).join('');
  }

  // Lembretes do escopo de ruído (série de pontos próximos: checagem/clima podem
  // ser feitos uma vez para o conjunto). Textos definidos com a Raisa.
  var LEMBRETE_CHECAGEM =
    '<p class="texto-apoio cr-lembrete">Para uma série de pontos próximos, a checagem inicial e final pode ser realizada para o conjunto de medições, e não necessariamente em cada ponto. Entretanto, se a diferença entre as checagens inicial e final for ≥ 0,5 dB, todas as medições da série deverão ser repetidas. Por precaução, recomenda-se realizar a checagem em cada ponto.</p>' +
    '<div class="cr-alerta-serie"></div>';
  function lembreteClima(ehPonto1) {
    if (ehPonto1) return '';
    return '<p class="texto-apoio cr-lembrete">Se o monitoramento for realizado na mesma data e no mesmo período (diurno, vespertino ou noturno) do ponto 1, <strong>não é necessário registrar novamente as condições ambientais.</strong></p>';
  }

  function htmlChecagem(titulo, prefixo) {
    return (
      '<fieldset class="checagem-bloco">' +
      '  <legend>' + titulo + '</legend>' +
      '  <div class="checagem-linha">' +
      '    <label>Sinal<select data-campo="' + prefixo + 'Sinal"><option value="+">+</option><option value="-">−</option></select></label>' +
      '    <label>Valor (dB)<input type="number" step="0.01" min="0" inputmode="decimal" data-campo="' + prefixo + 'Valor" placeholder="ex.: 0,10"></label>' +
      '  </div>' +
      '</fieldset>'
    );
  }

  function htmlClima(incluirChuva) {
    return (
      '<div class="grade-3">' +
      '  <label>Temperatura<span class="unidade">(°C)</span><input type="number" step="0.1" inputmode="decimal" data-campo="temperatura"></label>' +
      '  <label>Umidade<span class="unidade">(%)</span><input type="number" step="1" min="0" max="100" inputmode="numeric" data-campo="umidade"></label>' +
      '  <label>Vento<span class="unidade">(m/s)</span><input type="number" step="0.1" min="0" inputmode="decimal" data-campo="vento"></label>' +
      '</div>' +
      '<div class="alerta alerta-amarelo cr-alerta-vento oculto">⚠️ Esperar o vento abaixar. Não é aceito monitoramento com vento acima de 5 m/s.</div>' +
      (incluirChuva ? htmlChecks(['Não monitorar com chuva'], 'chuva') : '')
    );
  }

  // Vincula inputs [data-campo] e checks [data-check] de `elemento` ao objeto alvo
  function vincular(elemento, alvo) {
    elemento.querySelectorAll('[data-campo]').forEach(function (el) {
      const c = el.dataset.campo;
      if (alvo[c] !== undefined && alvo[c] !== null) el.value = alvo[c];
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        alvo[c] = el.value;
        salvarDevagar();
      });
    });
    elemento.querySelectorAll('[data-check]').forEach(function (el) {
      const c = el.dataset.check;
      alvo.checks = alvo.checks || {};
      el.checked = !!alvo.checks[c];
      el.addEventListener('change', function () {
        alvo.checks[c] = el.checked;
        salvarDevagar();
      });
    });
  }

  function ativarAlertaVento(elemento, alvo) {
    const entrada = elemento.querySelector('[data-campo="vento"]');
    const alerta = elemento.querySelector('.cr-alerta-vento');
    if (!entrada || !alerta) return;
    function avaliar() {
      const valor = entrada.value === '' ? null : parseFloat(entrada.value.replace(',', '.'));
      alerta.classList.toggle('oculto', !EC.alertaVento.avaliar(valor));
    }
    entrada.addEventListener('input', avaliar);
    avaliar();
  }

  function ativarAlertaChecagens(elemento, alvo) {
    const alerta = elemento.querySelector('.cr-alerta-checagem');
    const resultado = elemento.querySelector('.cr-resultado-checagem');
    if (!alerta) return;
    function avaliar() {
      const vIni = parseFloat(String(alvo.chkIniValor || '').replace(',', '.'));
      const vFim = parseFloat(String(alvo.chkFimValor || '').replace(',', '.'));
      if (isNaN(vIni) || isNaN(vFim)) {
        alerta.classList.add('oculto');
        if (resultado) resultado.textContent = '';
        return;
      }
      const r = EC.checagens.calcular(alvo.chkIniSinal || '+', vIni, alvo.chkFimSinal || '+', vFim);
      const texto = r.diff.toFixed(2).replace('.', ',');
      if (r.alerta) {
        if (resultado) resultado.textContent = '';
        alerta.innerHTML = '🛑 <strong>Diferença entre checagens = ' + texto + ' dB (limite: 0,5 dB).</strong> Verificar o equipamento e repetir o monitoramento do ponto.';
        alerta.classList.remove('oculto');
      } else {
        alerta.classList.add('oculto');
        if (resultado) resultado.innerHTML = '✅ Diferença entre checagens = <strong>' + texto + ' dB</strong> — dentro do limite (0,5 dB).';
      }
    }
    elemento.querySelectorAll('[data-campo^="chk"]').forEach(function (el) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', avaliar);
    });
    avaliar();
  }

  // Validação da SÉRIE: no ÚLTIMO ponto (Total) de uma série com mais de 1 ponto,
  // compara a checagem FINAL deste ponto com a checagem INICIAL do PRIMEIRO ponto.
  // Se a diferença for ≥ 0,5 dB, exibe o alerta (repetir todas as medições da série).
  function ativarAlertaSerie(elemento, ponto, janela, n, total) {
    const cont = elemento.querySelector('.cr-alerta-serie');
    if (!cont) return;
    if (janela !== 'total' || total <= 1 || n !== total) { cont.innerHTML = ''; return; }
    const primeiro = listaPontos()[0];
    const ini = primeiro && primeiro.total ? primeiro.total : null;
    const fimAlvo = ponto.total || {};
    const num = function (v) {
      if (v === undefined || v === null || String(v).trim() === '') return null;
      const x = parseFloat(String(v).replace(',', '.'));
      return isNaN(x) ? null : x;
    };
    function avaliar() {
      const vIni = ini ? num(ini.chkIniValor) : null;
      const vFim = num(fimAlvo.chkFimValor);
      if (vIni === null || vFim === null) { cont.innerHTML = ''; return; }
      const r = EC.checagens.calcular((ini && ini.chkIniSinal) || '+', vIni, fimAlvo.chkFimSinal || '+', vFim);
      const texto = r.diff.toFixed(2).replace('.', ',');
      if (r.alerta) {
        cont.innerHTML = '<div class="alerta alerta-vermelho">🛑 <strong>Diferença da série = ' + texto +
          ' dB (limite: 0,5 dB)</strong> — checagem inicial do ponto 1 → checagem final do último ponto. Será necessário <strong>repetir todas as medições da série</strong>.</div>';
      } else {
        cont.innerHTML = '<div class="alerta alerta-info">✅ Diferença da série (ponto 1 → último ponto) = <strong>' + texto + ' dB</strong> — dentro do limite (0,5 dB).</div>';
      }
    }
    const inpFim = elemento.querySelector('[data-campo="chkFimValor"]');
    const selFim = elemento.querySelector('[data-campo="chkFimSinal"]');
    if (inpFim) inpFim.addEventListener('input', avaliar);
    if (selFim) selFim.addEventListener('change', avaliar);
    avaliar();
  }

  function montarGps(elemento, alvo) {
    const div = elemento.querySelector('.cr-gps');
    if (!div) return null;
    return EC.gps.criar(div, {
      dadosIniciais: alvo.gps || null,
      aoCapturar: function (dados) { alvo.gps = dados; salvar(); }
    });
  }

  function montarFoto(elemento, seletor, alvo, chave, rotulo, instanciaGps, numeroPonto, sufixoJanela) {
    const div = elemento.querySelector(seletor);
    if (!div) return;
    EC.foto.criar(div, {
      os: ctx.estado.os.numero,
      projeto: ctx.estado.os.projeto,
      tipo: TIPOS_CARIMBO[campo().subtipo],
      ponto: 'P' + String(numeroPonto).padStart(2, '0') + (sufixoJanela ? ' ' + sufixoJanela : ''),
      rotulo: rotulo,
      fotoInicial: alvo[chave] || null,
      obterUtm: function () {
        if (instanciaGps && instanciaGps.textoCarimbo()) return instanciaGps.textoCarimbo();
        return (alvo.gps && alvo.gps.textoUtm) || '';
      },
      aoCapturar: function (foto) { alvo[chave] = foto; salvar(); }
    });
  }

  function categoriaDoEquip(codigo) {
    const lista = EC.equipamentosMock[ctx.estado.tipo] || [];
    const e = lista.filter(function (x) { return x.codigo === codigo; })[0];
    return e ? e.categoria : ('__' + codigo); // sem categoria conhecida: trata como única
  }

  // Padrão por ponto: marca só os equipamentos cuja categoria tem UMA unidade
  // selecionada. Categorias com 2+ unidades (ex.: dois sonômetros) vêm
  // DESMARCADAS, para o técnico escolher qual foi usado no ponto.
  function padraoEquipamentosPonto(selecionados) {
    const contagem = {};
    selecionados.forEach(function (c) { const cat = categoriaDoEquip(c); contagem[cat] = (contagem[cat] || 0) + 1; });
    return selecionados.filter(function (c) { return contagem[categoriaDoEquip(c)] === 1; });
  }

  function htmlEquipamentosPonto(alvo) {
    const selecionados = ctx.estado.equipamentos || [];
    if (!selecionados.length) {
      return '<p class="texto-apoio">Nenhum equipamento selecionado no pré-campo — volte à seleção de equipamentos se precisar.</p>';
    }
    if (!alvo.equipamentos) alvo.equipamentos = padraoEquipamentosPonto(selecionados);

    const contagem = {};
    selecionados.forEach(function (c) { const cat = categoriaDoEquip(c); contagem[cat] = (contagem[cat] || 0) + 1; });
    const temMultiplos = Object.keys(contagem).some(function (k) { return contagem[k] > 1; });

    return (temMultiplos ? '<p class="texto-apoio">Onde há mais de uma unidade do mesmo tipo, marque qual foi usada neste ponto.</p>' : '') +
      selecionados.map(function (codigo) {
        const marcado = alvo.equipamentos.indexOf(codigo) !== -1;
        return '<label class="linha-check check-campo"><input type="checkbox" data-equip="' + codigo + '"' + (marcado ? ' checked' : '') + '><span>' + codigo + '</span></label>';
      }).join('');
  }

  function vincularEquipamentos(elemento, alvo) {
    elemento.querySelectorAll('[data-equip]').forEach(function (el) {
      el.addEventListener('change', function () {
        alvo.equipamentos = alvo.equipamentos || [];
        const codigo = el.dataset.equip;
        const indice = alvo.equipamentos.indexOf(codigo);
        if (el.checked && indice === -1) alvo.equipamentos.push(codigo);
        if (!el.checked && indice !== -1) alvo.equipamentos.splice(indice, 1);
        salvarDevagar();
      });
    });
  }

  /* ===== Seleção do subtipo ===== */

  function renderizarSubtipos() {
    const grade = $('#cr-subtipos');
    grade.innerHTML = SUBTIPOS.map(function (s) {
      return '<button type="button" class="card-tipo' + (campo().subtipo === s.id ? ' card-tipo-ativo' : '') + '" data-subtipo="' + s.id + '">' +
        (s.img
          ? '<img class="card-tipo-img" src="' + encodeURI('public/' + s.img) + '" alt="">'
          : '<span class="card-tipo-icone">' + s.icone + '</span>') +
        '<span>' + s.nome + '</span></button>';
    }).join('');

    const serv = ctx.estado.servico || {};
    const det = EC.mapaEscopo && EC.mapaEscopo.subtipoPorEscopo
      ? EC.mapaEscopo.subtipoPorEscopo(serv.escopo, serv.metodo) : null;
    const hint = $('#cr-subtipo-hint');
    if (hint) {
      if (det && campo().subtipo === det) {
        hint.className = 'alerta alerta-info';
        hint.innerHTML = '✓ Subtipo pré-selecionado pelo escopo da OS. Você pode alterar se necessário.';
      } else {
        hint.className = '';
        hint.innerHTML = '';
      }
    }

    grade.querySelectorAll('[data-subtipo]').forEach(function (botao) {
      botao.addEventListener('click', function () {
        const novo = botao.dataset.subtipo;
        if (campo().subtipo === novo) return;
        const temDados = campo().subtipo && (campo().pontos.length || Object.keys(campo().geral).length);
        if (temDados && !confirm('Trocar o subtipo apaga o que já foi preenchido no campo. Continuar?')) return;
        campo().subtipo = novo;
        campo().geral = {};
        campo().pontos = [];
        campo().ambientes = [];
        pontoExibido = 1;
        ambienteExibido = 1;
        salvar();
        renderizarSubtipos();
        renderizarGeral();
      });
    });
  }

  /* ===== Campos gerais por subtipo ===== */

  // Justificativa obrigatória quando a qtd de pontos difere da prevista na OS.
  // Insere/remove o textarea no <div id=divId> e devolve a função atualizadora.
  function ligarJustPontos(area, g, divId) {
    const previsto = ctx.estado.dadosGerais.qtdePontos;
    return function atualizar() {
      const div = area.querySelector('#' + divId);
      if (!div) return;
      const difere = previsto != null && previsto !== '' && String(g.qtdePontos) !== String(previsto);
      if (difere) {
        if (!div.dataset.montado) {
          div.innerHTML = '<label>Justificativa da variação de pontos (obrigatória)' +
            '<textarea rows="2" data-campo="justificativaPontos" placeholder="Por que o número de pontos mudou em relação ao previsto na OS?"></textarea></label>';
          vincular(div, g);
          div.dataset.montado = '1';
        }
      } else {
        div.innerHTML = '';
        div.dataset.montado = '';
        delete g.justificativaPontos;
      }
    };
  }

  function renderizarGeral() {
    const area = $('#cr-geral');
    $('#cr-paginacao').innerHTML = '';
    $('#cr-ponto').innerHTML = '';
    const g = campo().geral;

    if (!campo().subtipo) { area.innerHTML = ''; return; }

    if (campo().subtipo === 'externo') {
      const previstoPontos = ctx.estado.dadosGerais.qtdePontos;
      area.innerHTML =
        '<label>Finalidade do monitoramento<select data-campo="finalidade">' +
        '<option value="">Selecione…</option><option>Laudo PBH</option><option>Obra</option><option>Background</option><option>Operações</option><option>Outros</option>' +
        '</select></label>' +
        '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>' +
        (previstoPontos != null && previstoPontos !== '' ? '<p class="texto-apoio">Previsto na OS: ' + previstoPontos + ' ponto(s).</p>' : '') +
        '<div id="cr-just-pontos"></div>';
      if (g.qtdePontos === undefined) g.qtdePontos = previstoPontos;
      vincular(area, g);

      // Justificativa obrigatória quando a qtd de pontos difere da prevista na OS.
      function atualizarJustPontos() {
        const div = area.querySelector('#cr-just-pontos');
        if (!div) return;
        const difere = previstoPontos != null && previstoPontos !== '' &&
          String(g.qtdePontos) !== String(previstoPontos);
        if (difere) {
          if (!div.dataset.montado) {
            div.innerHTML = '<label>Justificativa da variação de pontos (obrigatória)' +
              '<textarea rows="2" data-campo="justificativaPontos" placeholder="Por que o número de pontos mudou em relação ao previsto na OS?"></textarea></label>';
            vincular(div, g);
            div.dataset.montado = '1';
          }
        } else {
          div.innerHTML = '';
          div.dataset.montado = '';
          delete g.justificativaPontos;
        }
      }
      atualizarJustPontos();

      area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', function () {
        renderizarPontos();
        atualizarJustPontos();
      });
      renderizarPontos();

    } else if (ehInterno(campo().subtipo)) {
      // Interno: vários AMBIENTES; cada um com suas condições + pontos próprios.
      area.innerHTML =
        '<label>Quantos ambientes serão selecionados? (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdeAmbientes"></label>' +
        '<div id="cr-amb-pager" class="cr-paginacao"></div>' +
        '<div id="cr-ambiente"></div>';
      if (g.qtdeAmbientes === undefined) g.qtdeAmbientes = 1;
      vincular(area, g);
      area.querySelector('[data-campo="qtdeAmbientes"]').addEventListener('input', renderizarAmbientes);
      renderizarAmbientes();

    } else if (campo().subtipo === 'ferroviario') {
      const previstoPontos = ctx.estado.dadosGerais.qtdePontos;
      area.innerHTML =
        '<label>Finalidade<select data-campo="finalidade"><option value="">Selecione…</option>' +
        FINALIDADES_FERRO.map(function (o) { return '<option>' + o + '</option>'; }).join('') +
        '</select></label>' +
        '<div id="cr-instalacao"></div>' +
        '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>' +
        (previstoPontos != null && previstoPontos !== '' ? '<p class="texto-apoio">Previsto na OS: ' + previstoPontos + ' ponto(s).</p>' : '') +
        '<div id="cr-just-pontos"></div>' +
        '<div id="cr-ferro-operacoes"></div>';
      if (g.qtdePontos === undefined) g.qtdePontos = previstoPontos;
      if (!g.finalidade) { const f = finalidadePorMetodo(FINALIDADES_FERRO); if (f) { g.finalidade = f; if (ctx.salvar) ctx.salvar(); } }
      vincular(area, g);
      const atualizarJustPontos = ligarJustPontos(area, g, 'cr-just-pontos');
      atualizarJustPontos();

      function instalacaoFerro() {
        const div = area.querySelector('#cr-instalacao');
        const oper = area.querySelector('#cr-ferro-operacoes');
        oper.innerHTML = '';
        if (g.finalidade === FERRO_PASSAGEM) {
          div.innerHTML = '<p class="grupo-checks-titulo">Requisitos de instalação — passagem de composição</p>' + htmlChecks(CHECKS_INSTALACAO_FERRO, 'instal');
          vincular(div, g);
        } else if (g.finalidade === FERRO_PATIOS) {
          div.innerHTML = '<p class="grupo-checks-titulo">Requisitos de instalação — pátios / manobras / cruzamentos</p>' + htmlChecks(CHECKS_INSTALACAO_FERRO_PATIOS, 'instal');
          vincular(div, g);
          // As "Operações em pátios" saíram daqui — agora ficam no ponto (janela Total).
        } else {
          div.innerHTML = '';
        }
      }
      area.querySelector('[data-campo="finalidade"]').addEventListener('change', function () {
        instalacaoFerro();
        renderizarPonto(pontoExibido); // o formulário do ponto muda com a finalidade (Passagem/Total)
      });
      instalacaoFerro();
      area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', function () {
        renderizarPontos();
        atualizarJustPontos();
      });
      renderizarPontos();

    } else if (campo().subtipo === 'aeronautico') {
      const previstoPontos = ctx.estado.dadosGerais.qtdePontos;
      area.innerHTML =
        '<label>Finalidade<select data-campo="finalidade"><option value="">Selecione…</option>' +
        FINALIDADES_AERO.map(function (o) { return '<option>' + o + '</option>'; }).join('') +
        '</select></label>' +
        '<div id="cr-instalacao"></div>' +
        '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>' +
        (previstoPontos != null && previstoPontos !== '' ? '<p class="texto-apoio">Previsto na OS: ' + previstoPontos + ' ponto(s).</p>' : '') +
        '<div id="cr-just-pontos"></div>';
      if (g.qtdePontos === undefined) g.qtdePontos = previstoPontos;
      if (!g.finalidade) { const f = finalidadePorMetodo(FINALIDADES_AERO); if (f) { g.finalidade = f; if (ctx.salvar) ctx.salvar(); } }
      vincular(area, g);
      const atualizarJustPontos = ligarJustPontos(area, g, 'cr-just-pontos');
      atualizarJustPontos();

      function instalacaoAero() {
        const div = area.querySelector('#cr-instalacao');
        if (g.finalidade === AERO_RECEPTORES) {
          div.innerHTML = '<p class="grupo-checks-titulo">Checks de instalação — receptores críticos</p>' + htmlChecks(CHECKS_INSTALACAO_AERO_RECEPTORES, 'instal');
        } else if (g.finalidade === AERO_OPERACIONAL) {
          div.innerHTML = '<p class="grupo-checks-titulo">Checks de instalação — monitoramento operacional</p>' + htmlChecks(CHECKS_INSTALACAO_AERO_OPERACIONAL, 'instal');
        } else {
          div.innerHTML = '';
          return;
        }
        vincular(div, g);
      }
      area.querySelector('[data-campo="finalidade"]').addEventListener('change', function () {
        instalacaoAero();
        renderizarPonto(pontoExibido); // o formulário do ponto muda com a finalidade
      });
      instalacaoAero();
      area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', function () {
        renderizarPontos();
        atualizarJustPontos();
      });
      renderizarPontos();
    }
  }

  // Interno: paginador de AMBIENTES. Garante o array e mostra um ambiente por vez.
  function renderizarAmbientes() {
    const g = campo().geral;
    if (!campo().ambientes) campo().ambientes = [];
    const total = Math.min(20, Math.max(1, parseInt(g.qtdeAmbientes, 10) || 0));
    const pager = $('#cr-amb-pager');
    if (!total) {
      pager.innerHTML = ''; $('#cr-ambiente').innerHTML = '';
      $('#cr-paginacao').innerHTML = ''; $('#cr-ponto').innerHTML = '';
      return;
    }
    while (campo().ambientes.length < total) campo().ambientes.push({ pontos: [] });
    ambienteExibido = Math.min(ambienteExibido, total);
    EC.paginacao.criar(pager, {
      total: total,
      rotulo: 'Ambiente ',
      aoMudar: function (n) {
        ambienteExibido = n;
        pontoExibido = 1;
        janelaExibida = 'total';
        renderizarAmbiente(n);
      }
    });
  }

  // Formulário de UM ambiente: nome + esquadrias/ocupação/condição/área + cálculo.
  function renderizarAmbiente(n) {
    const amb = campo().ambientes[n - 1];
    const area = $('#cr-ambiente');
    if (!amb) { area.innerHTML = ''; return; }
    area.innerHTML =
      '<div class="cartao-ponto">' +
      '  <label>Nome do ambiente<input type="text" data-campo="nome" placeholder="ex.: Sala 101, Recepção…"></label>' +
      '  <div class="grade-2">' +
      '    <label>Condição das esquadrias<select data-campo="esquadrias"><option value="">Selecione…</option><option>Aberta</option><option>Fechada</option></select></label>' +
      '    <label>Ocupação do ambiente<select data-campo="condicao"><option value="">Selecione…</option><option>Sala vazia</option><option>Com pessoas</option></select></label>' +
      '    <label>Condição do ambiente<select data-campo="mobilia"><option value="">Selecione…</option><option>Vazio</option><option>Mobiliado</option></select></label>' +
      '  </div>' +
      '  <p class="texto-apoio">💡 Monitorar, preferencialmente, sem pessoas.</p>' +
      '  <label>Área do ambiente (m²)<input type="number" min="1" step="0.1" inputmode="decimal" data-campo="area"></label>' +
      '  <button type="button" class="botao botao-secundario" id="cr-calcular">Calcular pontos necessários</button>' +
      '  <div id="cr-interno-resultado"></div>' +
      '</div>';
    vincular(area, amb);

    area.querySelector('#cr-calcular').addEventListener('click', function () {
      const m2 = parseFloat(String(amb.area || '').replace(',', '.'));
      if (!m2 || m2 <= 0) { EC.app.mostrarToast('Informe a área do ambiente primeiro.'); return; }
      amb.pontosCalculados = 3 + Math.floor(m2 / 30); // mínimo 3 pontos; +1 a cada 30 m²
      salvar();
      renderizarAmbienteAposCalculo(n);
    });

    if (amb.pontosCalculados) renderizarAmbienteAposCalculo(n);
    else { $('#cr-paginacao').innerHTML = ''; $('#cr-ponto').innerHTML = ''; }
  }

  // Pós-cálculo do ambiente: pontos necessários + posicionamento/montagem +
  // layout da sala + os pontos daquele ambiente.
  function renderizarAmbienteAposCalculo(n) {
    const amb = campo().ambientes[n - 1];
    const div = $('#cr-interno-resultado');
    div.innerHTML =
      '<div class="alerta alerta-info">📐 Pontos necessários: <strong>' + amb.pontosCalculados + '</strong> (mínimo 3; +1 ponto a cada 30 m²)</div>' +
      '<p class="grupo-checks-titulo">Posicionamento dos pontos</p>' + htmlChecks(CHECKS_POSICIONAMENTO_INTERNO, 'pos') +
      '<p class="grupo-checks-titulo">Montagem do equipamento</p>' + htmlChecks(checksMontagemInterno(campo().subtipo), 'mont') +
      '<p class="grupo-checks-titulo">Layout da sala</p>' +
      '<div id="cr-canvas-sala"></div>' +
      '<button type="button" class="botao botao-primario botao-largo" id="cr-ir-pontos">Ir para os pontos →</button>';
    vincular(div, amb);

    const canvas = EC.canvasSala.criar(div.querySelector('#cr-canvas-sala'), {
      dadosIniciais: amb.sala || null,
      aoMudar: function () { capturarLayout(); salvarDevagar(); }
    });

    // Guarda o desenho do layout como IMAGEM (p/ subir como foto e ir ao PDF).
    // Sem desenho (0 objetos) → não gera imagem.
    function capturarLayout() {
      const exp = canvas.exportar(); // { objetos, dataUrl (PNG) }
      amb.sala = { objetos: exp.objetos };
      if (exp.objetos && exp.objetos.length) {
        const nomeAmb = amb.nome || ('Ambiente ' + n);
        const os = (ctx.estado.os && ctx.estado.os.numero) || 'SEM-OS';
        amb.layoutFoto = {
          dataUrl: exp.dataUrl,
          base64: exp.dataUrl.split(',')[1],
          nomeArquivo: ('Layout do ambiente ' + n + ' - ' + nomeAmb + ' - OS ' + os).replace(/[\\/:*?"<>|]+/g, '-') + '.png'
        };
      } else {
        delete amb.layoutFoto;
      }
    }
    capturarLayout(); // captura o que já estava desenhado (rascunho restaurado)

    div.querySelector('#cr-ir-pontos').addEventListener('click', function () {
      capturarLayout();
      salvar();
      renderizarPontos();
      $('#cr-ponto').scrollIntoView({ behavior: 'smooth' });
    });

    renderizarPontos();
  }

  /* ===== Pontos paginados ===== */

  function renderizarPontos() {
    const total = totalPontosCtx();
    const lista = listaPontos();
    if (total < 1) { $('#cr-paginacao').innerHTML = ''; $('#cr-ponto').innerHTML = ''; return; }

    while (lista.length < total) lista.push({});
    // pontos além do total ficam guardados (não exibidos) — nada é apagado

    pontoExibido = Math.min(pontoExibido, total);
    EC.paginacao.criar($('#cr-paginacao'), {
      total: total,
      // Não deixa sair de um ponto sem as fotos obrigatórias dele
      aoSair: function (numero) {
        const faltando = fotosFaltando(lista[numero - 1], campo().subtipo);
        if (faltando.length) {
          EC.app.mostrarToast('Tire a(s) foto(s) do ponto P' + numero + ' antes de sair: ' + faltando.join(', ') + '.');
          return false;
        }
        return true;
      },
      aoMudar: function (n) {
        pontoExibido = n;
        janelaExibida = 'total'; // cada ponto abre na janela Total
        renderizarPonto(n);
      }
    });
    renderizarPonto(pontoExibido);
  }

  // Campos de UMA janela (Total ou Residual) do externo — SEM equipamentos, que
  // é do ponto (compartilhado). É a cópia completa dos campos de medição.
  function htmlCamposJanelaExterno(ehPonto1) {
    return (
      '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      '<div class="cr-gps"></div>' +
      '<p class="grupo-checks-titulo">📍 Posicionamento do microfone</p>' +
      htmlChecks(ehLongaDuracao() ? POSICIONAMENTO_EXTERNO_LONGA : POSICIONAMENTO_EXTERNO_PADRAO, 'pos') +
      htmlChecks(['Se monitoramento em fachada: distância mínima de 1 m da fachada (opcional)'], 'posfachada') +
      '<p class="grupo-checks-titulo">⚙️ Montagem do equipamento</p>' + htmlChecks(checksMontagemExterno(ehLongaDuracao()), 'mont') +
      htmlChecagem('Checagem inicial', 'chkIni') +
      '<div class="cr-foto-tela-ini"></div>' +
      '<div class="cr-foto-ponto"></div>' +
      '<p class="grupo-checks-titulo">🌡️ Condições ambientais</p>' +
      (ehLongaDuracao()
        ? htmlChecks(['Monitorar e registrar temperatura, umidade e vento de forma contínua'], 'climacont')
        : htmlClima(false)) +
      lembreteClima(ehPonto1) +
      '<p class="grupo-checks-titulo">🔊 Fontes percebidas</p>' +
      '<label>Fontes percebidas da EMPRESA<input type="text" data-campo="fontesEmpresa"></label>' +
      '<label>Fontes percebidas do AMBIENTE<input type="text" data-campo="fontesAmbiente"></label>' +
      htmlChecagem('Checagem final', 'chkFim') +
      '<div class="cr-resultado-checagem"></div>' +
      '<div class="alerta alerta-vermelho cr-alerta-checagem oculto"></div>' +
      LEMBRETE_CHECAGEM +
      '<div class="cr-foto-tela-fim"></div>' +
      '<label>Observações do ponto<textarea rows="2" data-campo="observacoes"></textarea></label>' +
      '<label>Hora de término<input type="time" data-campo="horaTermino"></label>'
    );
  }

  // Interno (10151/10152): cada janela é uma medição completa (clima + checagem
  // em cada). Os grupos Ltot/Lres saíram — as janelas Total/Residual já são isso.
  function htmlCamposJanelaInterno(subtipo, ehPonto1) {
    return (
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      '<label>Nome do ponto<input type="text" data-campo="nome"></label>' +
      '<div class="cr-gps"></div>' +
      '<label>Altura do sonômetro (m)<input type="number" step="0.01" inputmode="decimal" data-campo="altura"></label>' +
      htmlChecks(['Monitorar, quando possível, variando a altura do tripé entre 1,2 e 1,5 m'], 'altura') +
      '<p class="grupo-checks-titulo">🌡️ Condições ambientais</p>' + htmlClima(true) +
      lembreteClima(ehPonto1) +
      htmlChecagem('Checagem inicial', 'chkIni') +
      '<div class="cr-foto-tela-ini"></div>' +
      '<div class="cr-foto-ponto"></div>' +
      '<label>Eventualidade<select data-campo="eventualidade"><option value="">Selecione…</option><option>Não</option><option>Sim</option></select></label>' +
      '<div id="cr-eventualidade-desc"></div>' +
      htmlChecagem('Checagem final', 'chkFim') +
      '<div class="cr-resultado-checagem"></div>' +
      '<div class="alerta alerta-vermelho cr-alerta-checagem oculto"></div>' +
      LEMBRETE_CHECAGEM +
      '<label>Hora de término<input type="time" data-campo="horaTermino"></label>'
    );
  }

  function htmlCamposJanelaFerro(janela, ehPonto1) {
    // Checks do ponto por finalidade/janela. CHECKS_PONTO_FERRO: 0/1 som
    // residual, 2 som da passagem, 3/4 condições ambientais (clima).
    //  • PASSAGEM: Total = som da passagem [2] + clima [3,4] + campo caract.;
    //    Residual = som residual [0,1] + clima [3,4].
    //  • PÁTIOS: Total = bloco "Operações em pátios" + clima [3,4];
    //    Residual = bloco "Monitoramento de som residual" + clima [3,4].
    const passagem = campo().geral.finalidade === FERRO_PASSAGEM;
    const patios = campo().geral.finalidade === FERRO_PATIOS;
    const total = janela === 'total';
    let checksPonto;
    if (passagem) {
      checksPonto = htmlChecksIndices(CHECKS_PONTO_FERRO, 'ferro', total ? [2, 3, 4] : [0, 1, 3, 4]);
    } else if (patios) {
      const bloco = total
        ? '<p class="grupo-checks-titulo">🚧 Operações em pátios / manobras / cruzamentos</p>' + htmlChecksComSub(OPERACOES_FERRO_PATIOS, 'oper')
        : '<p class="grupo-checks-titulo">🚆 Monitoramento de som residual</p>' + htmlChecksComSub(MONITORAMENTO_RESIDUAL_PATIOS, 'mres');
      checksPonto = bloco + htmlChecksIndices(CHECKS_PONTO_FERRO, 'ferro', [3, 4]);
    } else {
      checksPonto = htmlChecks(CHECKS_PONTO_FERRO, 'ferro');
    }
    return (
      '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      '<div class="cr-gps"></div>' +
      htmlChecagem('Checagem inicial', 'chkIni') +
      '<div class="cr-foto-tela-ini"></div>' +
      checksPonto +
      (passagem && total
        ? '<label>Característica da composição ferroviária avaliada<input type="text" data-campo="caracteristicaComposicao" placeholder="ex.: trem de carga, passageiro, nº de vagões…"></label>'
        : '') +
      '<div class="cr-foto-ponto"></div>' +
      '<p class="grupo-checks-titulo">🌡️ Condições ambientais</p>' + htmlClima(false) +
      lembreteClima(ehPonto1) +
      htmlChecagem('Checagem final', 'chkFim') +
      '<div class="cr-resultado-checagem"></div>' +
      '<div class="alerta alerta-vermelho cr-alerta-checagem oculto"></div>' +
      LEMBRETE_CHECAGEM +
      '<div class="cr-foto-tela-fim"></div>' +
      '<label>Observações do ponto<textarea rows="2" data-campo="observacoes"></textarea></label>' +
      '<label>Hora de término<input type="time" data-campo="horaTermino"></label>'
    );
  }

  function htmlCamposJanelaAero(ehPonto1) {
    const operacional = campo().geral.finalidade === AERO_OPERACIONAL;
    return (
      '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
      '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
      '<div class="cr-gps"></div>' +
      htmlChecagem('Checagem inicial', 'chkIni') +
      '<div class="cr-foto-tela-ini"></div>' +
      '<div class="cr-foto-ponto"></div>' +
      (operacional
        ? htmlChecks(['Estação meteorológica funcionando'], 'estacao')
        : '<p class="grupo-checks-titulo">🌡️ Condições ambientais</p>' + htmlClima(false) +
          lembreteClima(ehPonto1) +
          htmlChecks(CHECKS_PONTO_AERO_RECEPTORES, 'aero')) +
      htmlChecagem('Checagem final', 'chkFim') +
      '<div class="cr-resultado-checagem"></div>' +
      '<div class="alerta alerta-vermelho cr-alerta-checagem oculto"></div>' +
      LEMBRETE_CHECAGEM +
      '<div class="cr-foto-tela-fim"></div>' +
      '<label>Observações do ponto<textarea rows="2" data-campo="observacoes"></textarea></label>' +
      '<label>Hora de término<input type="time" data-campo="horaTermino"></label>'
    );
  }

  // Campos da janela conforme o subtipo do ruído.
  function htmlCamposJanela(subtipo, janela, ehPonto1) {
    if (ehInterno(subtipo)) return htmlCamposJanelaInterno(subtipo, ehPonto1);
    if (subtipo === 'ferroviario') return htmlCamposJanelaFerro(janela, ehPonto1);
    if (subtipo === 'aeronautico') return htmlCamposJanelaAero(ehPonto1);
    return htmlCamposJanelaExterno(ehPonto1);
  }

  // true se a janela tem algum dado relevante preenchido (para o status da aba
  // e para decidir se o Residual foi "medido" ou apenas pulado com justificativa).
  function janelaTemDados(j) {
    if (!j) return false;
    if (j.nome || j.horaInicial || j.gps || j.chkIniValor || j.chkFimValor ||
        j.altura || j.temperatura || j.umidade || j.vento || j.fontesEmpresa || j.fontesAmbiente ||
        j.observacoes || j.eventualidade || j.condAmbiente ||
        EC.foto.tem(j.fotoTelaIni) || EC.foto.tem(j.fotoPonto) || EC.foto.tem(j.fotoTelaFim)) return true;
    return !!(j.checks && Object.keys(j.checks).some(function (k) { return j.checks[k]; }));
  }

  // Ponto de RUÍDO: equipamentos (compartilhado) + seletor [Total | Residual]
  // + a janela ativa. Cada janela guarda seus próprios campos em ponto[janela].
  function renderizarPontoJanelas(n, ponto) {
    const area = $('#cr-ponto');
    ponto.total = ponto.total || {};
    ponto.residual = ponto.residual || {};

    const abas = JANELAS.map(function (j) {
      const cheia = janelaTemDados(ponto[j.id]);
      const marca = cheia ? ' ✓' : (j.id === 'residual' ? ' (opcional)' : '');
      return '<button type="button" class="card-tipo cr-janela-aba' + (janelaExibida === j.id ? ' card-tipo-ativo' : '') +
        '" data-janela="' + j.id + '"><span class="card-tipo-icone">' + j.icone + '</span><span>' + j.nome + marca + '</span></button>';
    }).join('');

    area.innerHTML =
      '<div class="cartao-ponto"><h2>Ponto P' + n + '</h2>' +
      '<p class="grupo-checks-titulo">Equipamentos utilizados</p><div id="cr-equip-ponto"></div>' +
      '<p class="texto-apoio">Duas medições por ponto: <strong>Total</strong> (com a fonte) e <strong>Residual</strong> (sem a fonte). Comece pela que quiser; o Residual é opcional se você justificar.</p>' +
      '<div class="grade-tipos cr-janelas">' + abas + '</div>' +
      '<div id="cr-janela-form"></div></div>';

    $('#cr-equip-ponto').innerHTML = htmlEquipamentosPonto(ponto);
    vincularEquipamentos($('#cr-equip-ponto'), ponto);

    area.querySelectorAll('.cr-janela-aba').forEach(function (b) {
      b.addEventListener('click', function () {
        if (janelaExibida === b.dataset.janela) return;
        janelaExibida = b.dataset.janela;
        renderizarPontoJanelas(n, ponto);
      });
    });

    renderizarJanela(n, ponto, janelaExibida);
  }

  function renderizarJanela(n, ponto, janela) {
    const wrap = $('#cr-janela-form');
    const alvo = ponto[janela];
    const sub = campo().subtipo;
    let html = '';
    if (janela === 'residual') {
      html += '<div class="alerta alerta-info">🔇 <strong>Residual</strong> — opcional. Se NÃO for medir, escreva a justificativa abaixo e deixe o resto em branco.</div>' +
        '<label>Justificativa (se não medir o residual)<textarea rows="2" data-justif="1" placeholder="Ex.: não foi possível desligar/afastar a fonte."></textarea></label>';
    }
    html += htmlCamposJanela(sub, janela, n === 1);
    wrap.innerHTML = html;

    const taj = wrap.querySelector('[data-justif]');
    if (taj) {
      if (ponto.justificativaResidual) taj.value = ponto.justificativaResidual;
      taj.addEventListener('input', function () { ponto.justificativaResidual = taj.value; salvarDevagar(); });
    }

    vincular(wrap, alvo);
    ativarAlertaVento(wrap, alvo);
    ativarAlertaChecagens(wrap, alvo);
    ativarAlertaSerie(wrap, ponto, janela, n, totalPontosCtx());
    const gps = montarGps(wrap, alvo);
    const suf = janela === 'total' ? 'Total' : 'Residual';
    montarFoto(wrap, '.cr-foto-tela-ini', alvo, 'fotoTelaIni', '📷 Foto da tela após checagem inicial (obrigatória se fizer a checagem)', gps, n, suf);
    montarFoto(wrap, '.cr-foto-ponto', alvo, 'fotoPonto', '📷 Foto do ponto (obrigatória)', gps, n, suf);
    montarFoto(wrap, '.cr-foto-tela-fim', alvo, 'fotoTelaFim', '📷 Foto da tela após checagem final (obrigatória se fizer a checagem)', gps, n, suf);

    // Interno: eventualidade — ligada à janela.
    const seletorEvent = wrap.querySelector('[data-campo="eventualidade"]');
    if (seletorEvent) {
      const divDesc = wrap.querySelector('#cr-eventualidade-desc');
      const descEvent = function () {
        if (seletorEvent.value === 'Sim') {
          divDesc.innerHTML = '<label>Descreva a eventualidade<textarea rows="2" data-campo="eventualidadeDesc"></textarea></label>';
          vincular(divDesc, alvo);
        } else { divDesc.innerHTML = ''; }
      };
      seletorEvent.addEventListener('change', descEvent);
      descEvent();
    }
  }

  function renderizarPonto(n) {
    const ponto = listaPontos()[n - 1];
    if (!ponto) { $('#cr-ponto').innerHTML = ''; return; }
    renderizarPontoJanelas(n, ponto);
  }

  /* ===== Entrada ===== */

  function renderizar(container, contexto) {
    ctx = contexto;
    raiz = container;
    if (!ctx.estado.campo) ctx.estado.campo = { subtipo: null, geral: {}, pontos: [] };
    pontoExibido = 1;
    ambienteExibido = 1;
    janelaExibida = 'total'; // nunca reabrir na Residual (o form do interno é idêntico e confunde)

    // Pré-seleciona o subtipo pelo escopo da OS (o técnico pode trocar)
    if (!campo().subtipo && EC.mapaEscopo && EC.mapaEscopo.subtipoPorEscopo) {
      const serv = ctx.estado.servico || {};
      const sub = EC.mapaEscopo.subtipoPorEscopo(serv.escopo, serv.metodo);
      if (sub) { campo().subtipo = sub; if (ctx.salvar) ctx.salvar(); }
    }

    container.innerHTML =
      '<p class="grupo-checks-titulo">Subtipo do monitoramento</p>' +
      '<div class="grade-tipos" id="cr-subtipos"></div>' +
      '<div id="cr-subtipo-hint"></div>' +
      '<div id="cr-geral"></div>' +
      '<div id="cr-paginacao" class="cr-paginacao"></div>' +
      '<div id="cr-ponto"></div>';

    renderizarSubtipos();
    renderizarGeral();
  }

  return {
    renderizar: renderizar,
    TIPOS_CARIMBO: TIPOS_CARIMBO,
    SUBTIPOS: SUBTIPOS,
    FOTOS_POR_SUBTIPO: FOTOS_POR_SUBTIPO,
    pontoAtualIncompleto: pontoAtualIncompleto,
    itensFaltando: itensFaltando
  };
})();
