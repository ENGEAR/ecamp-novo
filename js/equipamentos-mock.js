/**
 * equipamentos-mock.js — Lista de equipamentos de EXEMPLO (mock)
 *
 * A lista real virá da planilha F021 (Fase 6: filtro por matriz na Coluna M e
 * status EM USO na Coluna P, com validação de calibração). Até lá, a seleção
 * de equipamentos usa esta lista fixa, organizada do mesmo jeito que a F021:
 * por CATEGORIA, com código, descrição e datas de calibração.
 *
 * Interface (namespace global EC.equipamentosMock):
 *   EC.equipamentosMock[tipo] → array de equipamentos do tipo, cada um com:
 *     categoria  : nome da categoria (vira o agrupamento na tela)
 *     codigo     : código do equipamento (ex.: 'SON-001')
 *     descricao  : fabricante | modelo | nº de série
 *     ultimaCal  : data da última calibração (AAAA-MM-DD)
 *     proximaCal : data da próxima calibração (AAAA-MM-DD)
 */
window.EC = window.EC || {};

EC.equipamentosMock = {
  ruido: [
    { categoria: 'Sonômetro', codigo: 'SON-001', descricao: 'Instrutherm | DOS-600 | nº 123456', ultimaCal: '2026-03-01', proximaCal: '2027-03-01' },
    { categoria: 'Sonômetro', codigo: 'SON-002', descricao: 'Brüel & Kjær | 2250 | nº 789012', ultimaCal: '2026-01-15', proximaCal: '2027-01-15' },
    { categoria: 'Calibrador Acústico', codigo: 'CAL-001', descricao: 'Instrutherm | CAL-4000 | nº 345678', ultimaCal: '2026-02-10', proximaCal: '2027-02-10' },
    { categoria: 'Microfone', codigo: 'MIC-001', descricao: 'GRAS | 46AE | nº 901234', ultimaCal: '2026-04-05', proximaCal: '2027-04-05' },
    { categoria: 'Termohigroanemômetro', codigo: 'THA-001', descricao: 'Instrutherm | THAR-185 | nº 567890', ultimaCal: '2026-05-20', proximaCal: '2027-05-20' },
    { categoria: 'Estação Meteorológica', codigo: 'EST-001', descricao: 'Davis | Vantage Pro2 | nº 112233', ultimaCal: '2026-01-30', proximaCal: '2027-01-30' },
    { categoria: 'Tripé', codigo: 'TRI-001', descricao: 'Greika | WT-3730 | nº 445566', ultimaCal: '', proximaCal: '' },
    { categoria: 'Tripé', codigo: 'TRI-002', descricao: 'Greika | WT-3730 | nº 778899', ultimaCal: '', proximaCal: '' },
    { categoria: 'Trena', codigo: 'TRE-001', descricao: 'Stanley | 30 m | nº 990011', ultimaCal: '2026-02-01', proximaCal: '2027-02-01' }
  ]
};
