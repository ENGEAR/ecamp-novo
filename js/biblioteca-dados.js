/**
 * biblioteca-dados.js — Manifesto da Biblioteca (normas e procedimentos).
 *
 * FONTE ÚNICA da lista de documentos. É lido em DOIS lugares:
 *   • pelo app (js/biblioteca.js) para montar a tela da Biblioteca;
 *   • pelo service worker, que pré-guarda cada PDF no cache → acesso OFFLINE.
 * Por isso ele se pendura em `self` (funciona tanto na janela quanto no SW),
 * e NÃO depende de window/EC.
 *
 * Para adicionar um documento:
 *   1) coloque o PDF na pasta  normas/
 *   2) adicione uma linha aqui no array (mantendo o modelo abaixo)
 *   3) bump da versão (VERSAO_CACHE no service-worker.js + VERSAO_APP no app.js)
 *
 * Campos de cada item:
 *   tipo    : 'norma' | 'procedimento'
 *   escopo  : 'Ruído' | 'Vibração' | 'QAR Externo' | 'Opacidade' |
 *             'QAR Interno' | 'Outro' | 'Geral'
 *   metodo  : texto livre (ex.: 'NBR 10151', 'Ferroviário', 'Opacímetro') — ''
 *             quando não se aplica
 *   titulo  : nome que aparece na lista
 *   arquivo : caminho relativo do PDF (ex.: 'normas/nbr-10151.pdf')
 *
 * Exemplo:
 *   { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 10151',
 *     titulo: 'ABNT NBR 10151:2019', arquivo: 'normas/nbr-10151.pdf' },
 */
self.ECAMP_BIBLIOTECA = [
  /* ===================== PROCEDIMENTOS (POPs) ===================== */
  // Ruído
  { tipo: 'procedimento', escopo: 'Ruído', metodo: 'NBR 10151', titulo: 'POP 001 — Ruído externo e interno (NBR 10151) — rev.07', arquivo: 'normas/procedimentos/proc_ruido_externo e interno (10151)_POP 001_rev07.pdf' },
  { tipo: 'procedimento', escopo: 'Ruído', metodo: 'NBR 10152', titulo: 'POP 004 — Ruído interno (NBR 10152) — rev.03', arquivo: 'normas/procedimentos/proc_ruido_interno (10152)_POP 004_rev03.pdf' },
  { tipo: 'procedimento', escopo: 'Ruído', metodo: 'Ferroviário e Aeronáutico', titulo: 'POP 015 — Ruído ferroviário e aeronáutico — rev.02', arquivo: 'normas/procedimentos/proc_ruido_ferroviario e aeronautico_POP 015_rev02.pdf' },
  // Vibração
  { tipo: 'procedimento', escopo: 'Vibração', metodo: 'NBR 9653', titulo: 'POP 002 — Sismografia (ABNT NBR 9653) — rev.07', arquivo: 'normas/procedimentos/proc_sismografia_ABNT 9653_POP 002_rev07.pdf' },
  { tipo: 'procedimento', escopo: 'Vibração', metodo: 'CETESB', titulo: 'POP 013 — Sismografia (CETESB) — rev.03', arquivo: 'normas/procedimentos/proc_sismografia_cetesb_POP 013_rev03.pdf' },
  // QAR Externo
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'PTS', titulo: 'POP 005 — PTS — rev.02', arquivo: 'normas/procedimentos/proc_qarext_PTS_POP 005_rev02.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Partículas sedimentáveis', titulo: 'POP 006 — Partículas sedimentáveis — rev.03', arquivo: 'normas/procedimentos/proc_qarext_particulas sedimentaveis_POP 006_rev03.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Poeira sedimentável', titulo: 'POP 010 — Poeira sedimentável — rev.01', arquivo: 'normas/procedimentos/proc_qarext_poeira sedimentável_POP 010_rev01.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Gases (NO2 e SO2)', titulo: 'POP 009 — Gases (NO2 e SO2) — rev.01', arquivo: 'normas/procedimentos/proc_qarext_gases NO2 e SO2_POP 009_rev01.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Analisador contínuo', titulo: 'POP 016 — Analisador contínuo — rev.00', arquivo: 'normas/procedimentos/proc_qarext_analisador continuo_POP 016_rev00.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Calibração de vazão', titulo: 'POP 008 — Calibração de vazão (bolhômetro) — rev.00', arquivo: 'normas/procedimentos/proc_qarest_calibração vazão bolhametro_POP 008_rev00.pdf' },
  // QAR Interno
  { tipo: 'procedimento', escopo: 'QAR Interno', metodo: 'MQAI', titulo: 'POP 007 — Ar interno / MQAI — rev.02', arquivo: 'normas/procedimentos/proc_qarint_ambiente interno_POP 007_rev02.pdf' },
  // Opacidade
  { tipo: 'procedimento', escopo: 'Opacidade', metodo: 'Opacímetro', titulo: 'POP 014 — Fuligem (Opacímetro) — rev.00', arquivo: 'normas/procedimentos/proc_fuligem_opacimetro_POP 014_rev00.pdf' },
  { tipo: 'procedimento', escopo: 'Opacidade', metodo: 'Ringelmann', titulo: 'POP 003 — Fuligem (Ringelmann) — rev.04', arquivo: 'normas/procedimentos/proc_fuligem_ringelmann_POP 003_rev04.pdf' },
  // Geral
  { tipo: 'procedimento', escopo: 'Geral', metodo: '', titulo: 'POP 017 — Cadastros — rev.00', arquivo: 'normas/procedimentos/proc_geral_cadastros_POP017_rev00.pdf' },
  { tipo: 'procedimento', escopo: 'Geral', metodo: '', titulo: 'POP 012 — Normas de direção — rev.00', arquivo: 'normas/procedimentos/proc_geral_normas de direção_POP 012_rev00.pdf' },

  /* ===================== NORMAS ===================== */
  { tipo: 'norma', escopo: 'QAR Externo', metodo: 'NBR 13412', titulo: 'NBR 13412:1995 — Material particulado em suspensão na atmosfera', arquivo: 'normas/normas/ABNT NBR 13412-1995_norma_qarext_Material Particulado em suspensao na atmosfera.pdf' },
  { tipo: 'norma', escopo: 'Vibração', metodo: 'CECAV', titulo: 'CECAV — Patrimônio espeleológico', arquivo: 'normas/normas/CECAV_norma_sismografia_Patrimonio Espeleológico.pdf' },
  { tipo: 'legislacao', escopo: 'QAR Externo', metodo: 'CONAMA 506', titulo: 'CONAMA 506/2024 — Padrões de qualidade do ar', arquivo: 'normas/normas/CONAMA 506-2024_legislação_qarext.pdf' },
  { tipo: 'norma', escopo: 'Vibração', metodo: 'CETESB DD 215/2007', titulo: 'CETESB DD 215/2007 — Vibrações em áreas habitadas', arquivo: 'normas/normas/DD CETESB - 215 de 2007_norma_sismografia.pdf' },
  { tipo: 'legislacao', escopo: 'QAR Externo', metodo: 'Guia MMA', titulo: 'Guia MMA — Monitoramento da qualidade do ar', arquivo: 'normas/normas/Guia MMA_legislação_qarext.pdf' },
  { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 10052', titulo: 'NBR 10052:2020 — Medições em campo de isolamento acústico', arquivo: 'normas/normas/NBR 10052-2020_norma_ruido_ Medições em campo de isolamento a ruido acust.pdf' },
  { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 16032', titulo: 'NBR 16032:2020 — Nível de pressão sonora de equipamentos', arquivo: 'normas/normas/NBR 16032-2020_norma_ruido_Medição de nível de pressão sonora de equipa.pdf' },
  { tipo: 'norma', escopo: 'QAR Externo', metodo: 'NBR 9547', titulo: 'NBR 9547:1997 — MP em suspensão no ar ambiente (método AGV)', arquivo: 'normas/normas/NBR 9547-1997_norma_qarext_MP em suspensão no ar ambiente - método AGV.pdf' },
  { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 10151', titulo: 'NBR 10151:2020 — Níveis de pressão sonora em áreas habitadas', arquivo: 'normas/normas/NBR10151-2020_norma_ruido_ Medição e avaliação de níveis de pressão sonora em áreas habitadas.pdf' },
  { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 10152', titulo: 'NBR 10152:2020 — Níveis de pressão sonora em ambientes internos', arquivo: 'normas/normas/NBR10152-2020_norma_ruido_Níveis de pressão sonora em ambientes internos a edificações.pdf' },
  { tipo: 'norma', escopo: 'QAR Externo', metodo: 'NBR 12065', titulo: 'NBR 12065:1991 — Determinação de poeira sedimentável', arquivo: 'normas/normas/NBR12065-1991_norma_qarext_Determinação de Poeira Sedimentaveis.pdf' },
  { tipo: 'norma', escopo: 'QAR Interno', metodo: 'NBR 12085', titulo: 'NBR 12085:1991 — Aerodispersóides por filtração', arquivo: 'normas/normas/NBR12085-1991_norma_qarint_ Agentes químicos no ar - coleta de aerodispersóides por filtração.pdf' },
  { tipo: 'norma', escopo: 'Opacidade', metodo: 'NBR 12897', titulo: 'NBR 12897:1993 — Emprego do opacímetro', arquivo: 'normas/normas/NBR12897-1993_norma_fuligem_Emprego do opacímetro .pdf' },
  { tipo: 'norma', escopo: 'QAR Externo', metodo: 'NBR 12979', titulo: 'NBR 12979:1993 — Determinação de SO₂ no ar ambiente', arquivo: 'normas/normas/NBR12979-1993_norma_qarext_Determinação de SO2 ar ambiente.pdf' },
  { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 16425-1', titulo: 'NBR 16425-1:2016 — Ruído de sistemas de transporte (geral)', arquivo: 'normas/normas/NBR16425_1-2016_norma_ruido_Ruido Sistema Transporte Geral.pdf' },
  { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 16425-2', titulo: 'NBR 16425-2:2020 — Ruído de sistema de transporte aéreo', arquivo: 'normas/normas/NBR16425_2-2020_norma_ruido_Ruido Sistema Aéreo.pdf' },
  { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 16425-4', titulo: 'NBR 16425-4:2020 — Ruído de sistema de transporte ferroviário', arquivo: 'normas/normas/NBR16425_4-2020_norma_ruido_Ruido Sistema Ferroviario.pdf' },
  { tipo: 'norma', escopo: 'QAR Interno', metodo: 'NBR 17037', titulo: 'NBR 17037:2023 — Qualidade do ar em ambiente climatizado', arquivo: 'normas/normas/NBR17037-2023_norma_qarint_QAr ambiente climatizado.pdf' },
  { tipo: 'norma', escopo: 'Opacidade', metodo: 'NBR 6016', titulo: 'NBR 6016:2015 — Gás de escapamento de motor diesel (avaliação)', arquivo: 'normas/normas/NBR6016-2015_norma_fuligem_Gás de escapamento de motor Diesel — Avaliação.pdf' },
  { tipo: 'norma', escopo: 'Vibração', metodo: 'NBR 9653', titulo: 'NBR 9653:2018 — Avaliação dos efeitos de detonação', arquivo: 'normas/normas/NBR9653-2018_norma_sismografia_Avaliação dos efeitos detonação.pdf' },
  { tipo: 'norma', escopo: 'Geral', metodo: 'ISO/IEC 17025', titulo: 'ISO/IEC 17025:2017 — Competência de laboratórios de ensaio e calibração', arquivo: 'normas/normas/NBRISO_IEC17025-2017_norma_geral_Competência de laboratórios de ensaio e calibração.pdf' },
  { tipo: 'norma', escopo: 'QAR Externo', metodo: 'AS/NZS 3580.9', titulo: 'AS/NZS 3580.9:2013 — Material particulado em suspensão (PM2,5)', arquivo: 'normas/normas/asnzs-3580-9-2013_norma_qarext_Determinação de material particulado em suspensão PM2,5.pdf' },
];
