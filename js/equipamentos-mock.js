/**
 * equipamentos-mock.js — Lista de equipamentos de EXEMPLO (mock)
 *
 * A lista real virá da planilha F021 (Fase 6: filtro por matriz e status EM USO,
 * com validação de calibração). Até lá, a seleção de equipamentos usa esta lista.
 *
 * As datas de calibração são RELATIVAS À DATA DE HOJE (calculadas no carregamento)
 * para os exemplos não vencerem com o passar do tempo:
 *   - a maioria fica "em dia" (vence daqui a ~10 meses);
 *   - SON-002 fica sempre "vencida" (demonstra o bloqueio de seleção);
 *   - SON-003 fica sempre "vencendo" (< 5 dias — demonstra o alerta amarelo).
 * Esses dois exemplos ficam no Sonômetro, que tem o SON-001 válido — então a
 * categoria nunca trava por causa deles.
 *
 * Interface (namespace global EC.equipamentosMock):
 *   EC.equipamentosMock[tipo] → array de equipamentos, cada um com:
 *     categoria, codigo, descricao, ultimaCal (AAAA-MM-DD), proximaCal (AAAA-MM-DD)
 */
window.EC = window.EC || {};

(function () {
  function isoEmDias(n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  const VALIDA = isoEmDias(300);   // calibração em dia
  const VENCIDA = isoEmDias(-40);  // já vencida → bloqueia a seleção
  const VENCENDO = isoEmDias(3);   // vence em < 5 dias → alerta amarelo (pode usar)
  const ULT = isoEmDias(-65);      // última calibração (genérica)

  EC.equipamentosMock = {
    ruido: [
      { categoria: 'Sonômetro', codigo: 'SON-001', descricao: 'Instrutherm | DOS-600 | nº 123456', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sonômetro', codigo: 'SON-002', descricao: 'Brüel & Kjær | 2250 | nº 789012', ultimaCal: isoEmDias(-405), proximaCal: VENCIDA },
      { categoria: 'Sonômetro', codigo: 'SON-003', descricao: 'Instrutherm | DEC-490 | nº 456789', ultimaCal: ULT, proximaCal: VENCENDO },
      { categoria: 'Calibrador Acústico', codigo: 'CAL-001', descricao: 'Instrutherm | CAL-4000 | nº 345678', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Microfone', codigo: 'MIC-001', descricao: 'GRAS | 46AE | nº 901234', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Termohigroanemômetro', codigo: 'THA-001', descricao: 'Instrutherm | THAR-185 | nº 567890', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Estação Meteorológica', codigo: 'EST-001', descricao: 'Davis | Vantage Pro2 | nº 112233', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Tripé', codigo: 'TRI-001', descricao: 'Greika | WT-3730 | nº 445566', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI-002', descricao: 'Greika | WT-3730 | nº 778899', ultimaCal: '', proximaCal: '' },
      { categoria: 'Trena', codigo: 'TRE-001', descricao: 'Stanley | 30 m | nº 990011', ultimaCal: ULT, proximaCal: VALIDA }
    ],

    // Vibração — equipamentos REAIS da F021 (coluna M = matriz "Sismografia"),
    // apenas os "EM USO". As datas são RELATIVAS, derivadas do status atual de
    // calibração (Vencido → bloqueia; Próximo do vencimento → alerta; A vencer →
    // em dia), para não vencerem com o tempo. Datas reais virão da F021 (Fase 6).
    sismo: [
      // Sismógrafos (ZTEX, modelos S100/S200/S210/S220)
      { categoria: 'Sismógrafo', codigo: 'SIS 002', descricao: 'ZTEX | S210 | 00014', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 003', descricao: 'ZTEX | S100 | 0203', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 004', descricao: 'ZTEX | S100 | 0204', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 005', descricao: 'ZTEX | S100 | 0205', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 006', descricao: 'ZTEX | S220 | 0077', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 007', descricao: 'ZTEX | S100 | 0037', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 008', descricao: 'ZTEX | S220 | 0078', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 0056', descricao: 'ZTEX | S100 | 0056', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 0128', descricao: 'ZTEX | S100 | 0128', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 0129', descricao: 'ZTEX | S100 | 0129', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 0131', descricao: 'ZTEX | S100 | 0131', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 0207', descricao: 'ZTEX | S100 | 0207', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 05 (0077)', descricao: 'ZTEX | S100 | 0077', ultimaCal: ULT, proximaCal: VALIDA },
      { categoria: 'Sismógrafo', codigo: 'AQVI 001', descricao: 'ZTEX | S100 | 0123', ultimaCal: ULT, proximaCal: VENCENDO },
      { categoria: 'Sismógrafo', codigo: 'GEO-SISMOGRAFO-02', descricao: 'ZTEX | S100 | 0102', ultimaCal: ULT, proximaCal: VENCENDO },
      { categoria: 'Sismógrafo', codigo: 'SIS 0080', descricao: 'ZTEX | S100 | 0080', ultimaCal: ULT, proximaCal: VENCENDO },
      { categoria: 'Sismógrafo', codigo: 'AQVI 003', descricao: 'ZTEX | S100 | 0013', ultimaCal: isoEmDias(-405), proximaCal: VENCIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 00010', descricao: 'ZTEX | S200 | 00010', ultimaCal: isoEmDias(-405), proximaCal: VENCIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 0046', descricao: 'ZTEX | S100 | 0046', ultimaCal: isoEmDias(-405), proximaCal: VENCIDA },
      { categoria: 'Sismógrafo', codigo: 'SIS 0147', descricao: 'ZTEX | S100 | 0147', ultimaCal: isoEmDias(-405), proximaCal: VENCIDA },
      // Geofones
      { categoria: 'Geofone', codigo: 'AQGF 001', descricao: 'ZTEX | S100 | 0123', ultimaCal: ULT, proximaCal: VENCENDO },
      { categoria: 'Geofone', codigo: 'AQGF 003', descricao: 'ZTEX | S100 | 0013', ultimaCal: isoEmDias(-405), proximaCal: VENCIDA },
      // Microfones
      { categoria: 'Microfone', codigo: 'AQMI 005', descricao: 'ZTEX | S100 | 0123', ultimaCal: ULT, proximaCal: VENCENDO },
      { categoria: 'Microfone', codigo: 'AQMI 012', descricao: 'ZTEX | S100 | 0013', ultimaCal: isoEmDias(-405), proximaCal: VENCIDA }
    ],

    // QAR Externo — particulados. Os amostradores AGV não estão no F021 (lá há
    // só os equipamentos de apoio); cadastrados à mão. A calibração relevante é
    // a do passo de campo, então não têm data de calibração própria.
    qar: [
      { categoria: 'Amostrador AGV', codigo: 'AGV PTS', descricao: 'Amostrador de Grande Volume — PTS', ultimaCal: '', proximaCal: '' },
      { categoria: 'Amostrador AGV', codigo: 'AGV MP10', descricao: 'Amostrador de Grande Volume — MP10', ultimaCal: '', proximaCal: '' },
      { categoria: 'Amostrador AGV', codigo: 'AGV MP2,5', descricao: 'Amostrador de Grande Volume — MP2,5', ultimaCal: '', proximaCal: '' }
    ],

    // Opacidade — Escala de Ringelmann (F021 matriz "Rilgeman", EM USO).
    opacidade_ringelmann: [
      { categoria: 'Chapa de fundo branco', codigo: 'CFB001', descricao: 'Chapa de Fundo Branco', ultimaCal: '', proximaCal: '' }
    ],

    // Opacidade — Opacímetro (F021 matriz "Opacidade veicular", EM USO). No F021
    // a calibração está vencida; aqui sem data para não travar a seleção (a
    // renovação da calibração é gestão, fora do app).
    opacidade_opacimetro: [
      { categoria: 'Opacímetro', codigo: 'OPC 001', descricao: 'SMOKE CHECK | 2000 | 54.176', ultimaCal: '', proximaCal: '' },
      { categoria: 'Opacímetro', codigo: 'ENG SMOKE 1', descricao: 'ALTANOVA | CHECK 200 | 54.176', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'SMOKE-TRIPE', descricao: 'ALTANOVA | CHECK 200 | Tripé', ultimaCal: '', proximaCal: '' }
    ],

    // QAR Interno (MQAI) — só os principais (F021 matriz "Qualidade do ar
    // interno", EM USO): bomba, medidor de CO₂ e tripés. A bomba e o medidor
    // estão Vencidos no F021; aqui sem data p/ não travar a seleção (gestão).
    qarint: [
      { categoria: 'Bomba de amostragem', codigo: 'BOMB.AERIS 001', descricao: 'CRIFFER | AERIS-2 | 26000047', ultimaCal: '', proximaCal: '' },
      { categoria: 'Medidor de CO2, Temperatura e Umidade', codigo: 'SEM-TEMP.UMD-01', descricao: 'AZ | CO277 | 10575136', ultimaCal: '', proximaCal: '' },
      { categoria: 'Medidor de CO2, Temperatura e Umidade', codigo: 'SEN-CO2-01', descricao: 'AZ | CO277 | 10575136', ultimaCal: '', proximaCal: '' },
      { categoria: 'Termoanemômetro', codigo: 'ANE-TEMP 001', descricao: 'TESTO | Testo 405-V1 | 41576334', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI 005', descricao: 'Criffer', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI 006', descricao: 'Criffer', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI 007', descricao: 'Criffer', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI 008', descricao: 'Criffer', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI 009', descricao: 'Criffer', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI 010', descricao: 'Criffer', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI 011', descricao: 'Criffer', ultimaCal: '', proximaCal: '' },
      { categoria: 'Tripé', codigo: 'TRI 012', descricao: 'Criffer', ultimaCal: '', proximaCal: '' }
    ]
  };
})();
