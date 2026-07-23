#!/usr/bin/env bash
# =============================================================================
# publicar.sh — publicação SEGURA do e-CAMP (evita os erros que já aconteceram)
#
# TRAVAS que ele FORÇA (não dá pra pular):
#   1) Working tree LIMPO (fora .claude) — obriga commitar tudo no main antes.
#      → nunca deploya "pasta suja" nem trabalho não commitado de outra sessão.
#   2) main NÃO pode estar ATRÁS da produção — senão o deploy REGRIDE (o erro
#      clássico). Aborta e manda trazer a produção pro main primeiro.
#   3) O bump de versão é COMMITADO e empurrado ANTES do deploy.
#   4) Deploy sai da PASTA (= main HEAD), nunca de worktree/estado solto.
#   5) Confirma por curl que a produção ficou na versão nova.
#
# Uso:
#   bash publicar.sh          # bump de patch automático (ex.: 0.57.34 → 0.57.35)
#   bash publicar.sh 0.58.0   # versão explícita
#
# NUNCA use `vercel --prod` direto, nem `git reset --hard`/rebase no main.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

# Endereço OFICIAL do e-CAMP (decisão da Raisa, 2026-07-23). O projeto responde em
# mais de um apelido do Vercel (ecamp-omega, ecamp-engear...), e como o navegador
# guarda os rascunhos SEPARADOS POR ENDEREÇO, técnico que abre pelo apelido errado
# vê o app vazio. Este é o endereço que a equipe usa e que conferimos no deploy.
PROD_URL="https://ecamp-engear.vercel.app"
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
die()  { printf '\033[31m🛑 %s\033[0m\n' "$1" >&2; exit 1; }
ver_de_sw() { grep -oE 'ecamp-v[0-9]+\.[0-9]+\.[0-9]+' "$1" 2>/dev/null | head -1 | sed 's/ecamp-v//'; }

# --- 1) Working tree tem que estar limpo (fora .claude) ----------------------
sujo=$(git status --porcelain | grep -v '^?? \.claude/' || true)
[ -z "$sujo" ] || { printf '%s\n' "$sujo"; die "Working tree SUJO. Commite tudo no main ANTES de publicar (nunca deploye pasta suja)."; }

# --- versões: local (= o que será deployado) e produção ----------------------
local_v=$(ver_de_sw service-worker.js)
[ -n "$local_v" ] || die "Não achei VERSAO_CACHE em service-worker.js."
prod_v=$(curl -s "$PROD_URL/service-worker.js?cb=$RANDOM" | grep -oE 'ecamp-v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/ecamp-v//' || true)

# --- 2) main não pode estar ATRÁS da produção --------------------------------
if [ -n "$prod_v" ] && [ "$local_v" != "$prod_v" ]; then
  maior=$(printf '%s\n%s\n' "$local_v" "$prod_v" | sort -V | tail -1)
  [ "$maior" = "$local_v" ] || die "main está em v$local_v mas a PRODUÇÃO está em v$prod_v (à frente).
Publicar agora REGRIDE a produção (perde o que está no ar). Traga o estado de produção
para o main primeiro (a outra sessão precisa commitar o trabalho dela no main)."
fi

# --- 3) bump (patch automático a partir da MAIOR entre local e produção) -----
base="$local_v"
[ -n "$prod_v" ] && base=$(printf '%s\n%s\n' "$local_v" "$prod_v" | sort -V | tail -1)
if [ -n "${1:-}" ]; then nova="$1"; else
  IFS=. read -r ma mi pa <<< "$base"; nova="$ma.$mi.$((pa+1))"
fi
ok "Versão: local=v$local_v · produção=v${prod_v:-?} → publicando v$nova"

sed -i "s/ecamp-v$local_v/ecamp-v$nova/" service-worker.js
sed -i "s/VERSAO_APP = '$local_v'/VERSAO_APP = '$nova'/" js/app.js

# --- 4) commit + push do bump, depois deploy da PASTA (= HEAD) ----------------
git add service-worker.js js/app.js
git commit -m "Publica e-CAMP v$nova"
git push origin main
vercel --prod --yes

# --- 5) confere que a produção ficou na versão nova --------------------------
sleep 3
no_ar=$(curl -s "$PROD_URL/service-worker.js?cb=$RANDOM" | grep -oE 'ecamp-v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/ecamp-v//' || true)
[ "$no_ar" = "$nova" ] && ok "✅ Publicado — produção agora em v$nova" \
  || die "Produção ficou em v${no_ar:-?}, esperado v$nova. Verifique o deploy."
