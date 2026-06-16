/**
 * mapa-escopo.js — Mapeia o ESCOPO da OS → TIPO de monitoramento
 *
 * Quando a OS traz o escopo (ex.: "Ruído Ambiental – NBR 10151"), o app já
 * deixa o card de tipo pré-selecionado no Passo "Tipo de monitoramento". O
 * técnico ainda pode trocar manualmente se precisar.
 *
 * Regras (definidas pela Raisa em 13/06/2026):
 *   Ruído      → Ruído Ambiental (NBR 10151), Ruído Interno (NBR 10152),
 *                Transportes Aéreo (NBR 16425-2), Ferroviário (NBR 16425-4)
 *   Vibração   → Sismografia (NBR 9653), Patrimônio Espeleológico (CECAV),
 *                Áreas Habitadas (CETESB DD 215/2007)
 *   QAR Externo→ PTS, PM10, PM2,5, NO2, SO2, CO, Ozônio (O₃), VOC,
 *                Poeira Sedimentável, Monitoramento Automático, ou qualquer
 *                outro poluente de Qualidade do Ar Externo vindo da OS
 *   Opacidade  → Fuligem – Escala de Ringelmann, Fuligem – Opacímetro
 *   QAR Interno→ Ar Interno (MQAI)
 *   Outro      → Outros
 *
 * Interface (namespace global EC.mapaEscopo):
 *   EC.mapaEscopo.tipoPorEscopo(escopo) → 'ruido' | 'sismo' | 'qar' |
 *     'opacidade' | 'qarint' | 'outro' | null  (null = não reconhecido)
 *   EC.mapaEscopo.subtipoPorEscopo(escopo) → subtipo de RUÍDO:
 *     'externo' (NBR 10151) | 'interno' (NBR 10152) |
 *     'ferroviario' (NBR 16425-4) | 'aeronautico' (NBR 16425-2) | null
 */
window.EC = window.EC || {};

EC.mapaEscopo = (function () {
  'use strict';

  // minúsculas, sem acento, espaços normalizados — facilita o reconhecimento
  function normalizar(texto) {
    return (texto || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
      .replace(/\s+/g, ' ').trim();
  }

  function tipoPorEscopo(escopo) {
    const e = normalizar(escopo);
    if (!e) return null;

    // QAR Interno — antes de "ar" genérico e do QAR externo
    if (/(ar interno|mqai|qualidade do ar interno|qualidade do ar interior)/.test(e)) return 'qarint';

    // Ruído (inclui transportes aéreo/ferroviário)
    if (/(ruido|nbr ?10151|nbr ?10152|nbr ?16425|transporte.* aereo|transporte.* ferroviari|aeronautic|ferroviari)/.test(e)) return 'ruido';

    // Vibração
    if (/(sismografi|vibrac|sismo|nbr ?9653|espeleologic|cecav|areas habitadas|cetesb|dd ?215)/.test(e)) return 'sismo';

    // Opacidade
    if (/(opacidad|fuligem|ringelmann|opacimetr)/.test(e)) return 'opacidade';

    // QAR Externo (poluentes e termos do escopo)
    if (/(qualidade do ar externo|ar externo|particulad|\bpts\b|\bpm ?10\b|\bpm ?2[.,]?5\b|\bno2\b|\bso2\b|\bco\b|ozonio|\bo3\b|\bvoc\b|poeira sedimentavel|monitoramento automatico)/.test(e)) return 'qar';

    // Outros
    if (/(outro|outros)/.test(e)) return 'outro';

    return null;
  }

  // Subtipo de RUÍDO. O MÉTODO tem prioridade (no SGE, a NBR 10151 pode ser
  // "Ambiente interno", "Ambiente externo" ou "Longa duração"); na falta de
  // método, decide pelo escopo (transportes antes de ambiental/interno).
  function subtipoPorEscopo(escopo, metodo) {
    const m = normalizar(metodo);
    if (/ambiente interno/.test(m)) return 'interno';
    if (/ambiente externo/.test(m)) return 'externo';
    if (/longa\s*dura/.test(m)) return 'externo';

    const e = normalizar(escopo);
    if (!e) return null;
    if (/16425-4|ferroviari/.test(e)) return 'ferroviario';
    if (/16425-2|aereo|aeronautic/.test(e)) return 'aeronautico';
    if (/10152|interno/.test(e)) return 'interno';
    if (/10151|ambiental|externo/.test(e)) return 'externo';
    return null;
  }

  return { tipoPorEscopo: tipoPorEscopo, subtipoPorEscopo: subtipoPorEscopo };
})();
