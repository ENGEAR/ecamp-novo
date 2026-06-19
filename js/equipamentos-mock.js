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
    ]
  };
})();
