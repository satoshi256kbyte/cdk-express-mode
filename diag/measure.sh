#!/usr/bin/env bash
# Express モードの効果計測。ユーザーが手で実行する想定。
#
# 使い方（通常モードと Express モードを別々に、または 2 ターミナルで同時に実行）:
#   ./diag/measure.sh normal
#   ./diag/measure.sh express
#
# 計測する順番（すべて CDK 経由）:
#   1. 各サービスを単独スタックで新規作成（sqs / lambda / sns / ssm / alb / ecs / rds）
#   2. 全サービスを 1 スタックで新規作成（composite）
#   3. その composite に SQS + DLQ をもう 1 セット追加する更新（既存スタックへの小さな追加）
#
# 狙い: 「新規の大きな複合スタックでは効果が薄いが、既存スタックへの小さな追加更新では効く」
#       という仮説を、Express なし・ありの所要時間で比較する。
#
# cdk deploy は同期処理なので、コマンドの開始・終了時刻と所要秒（wall-clock）を
# measurements/results.<mode>.tsv に追記する。各シナリオ後にスタックは破棄する。
set -uo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
case "$MODE" in
  normal)  prefix=n; extra="" ;;
  express) prefix=e; extra="--express" ;;
  *) echo "usage: $0 <normal|express>" >&2; exit 1 ;;
esac

SINGLES="sqs lambda sns ssm alb ecs rds"
APP='npx ts-node diag/single.ts'
OUT="measurements/results.${MODE}.tsv"
OUTDIR="cdk.out.${prefix}"
LOGDIR=measurements/logs
mkdir -p "$LOGDIR"
printf "label\tmode\tdeploy_start\tdeploy_end\twall_seconds\tstatus\n" >"$OUT"

# deploy して所要時間を記録する。 引数: ラベル / スタック名 / service / 追加context / ログ接尾辞
record_deploy() {
  local label="$1" stack="$2" svc="$3" ctx="$4" logsfx="$5"
  local log="$LOGDIR/${stack}${logsfx}.log"
  local start_iso start end end_iso status
  start_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  start=$(date +%s)
  echo "[$MODE] deploy ${label} (${stack}) ... start=${start_iso}"
  if npx cdk --app "$APP" --output "$OUTDIR" deploy "$stack" \
      -c service="$svc" -c prefix="$prefix" $ctx $extra --require-approval never >"$log" 2>&1; then
    status=OK
  else
    status=FAIL
  fi
  end=$(date +%s)
  end_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
    "$label" "$MODE" "$start_iso" "$end_iso" "$((end - start))" "$status" | tee -a "$OUT"
}

destroy_stack() {
  local stack="$1" svc="$2" ctx="$3"
  echo "[$MODE] destroy ${stack} ..."
  npx cdk --app "$APP" --output "$OUTDIR" destroy "$stack" \
    -c service="$svc" -c prefix="$prefix" $ctx --force \
    >"$LOGDIR/${stack}-destroy.log" 2>&1 || echo "  destroy 警告: ${stack} （手動確認してください）"
}

# 1. 各サービスを単独スタックで新規作成 → 破棄
for svc in $SINGLES; do
  stack="${prefix}-${svc}"
  record_deploy "$svc" "$stack" "$svc" "" ""
  destroy_stack "$stack" "$svc" ""
done

# 2. 全サービスを 1 スタックで新規作成（破棄せずに 3 の更新へ）
comp="${prefix}-composite"
record_deploy "composite-create" "$comp" "composite" "" "-create"

# 3. composite に SQS + DLQ をもう 1 セット追加する更新
record_deploy "composite-add-sqs" "$comp" "composite" "-c extraSqs=true" "-update"

# composite を破棄
destroy_stack "$comp" "composite" "-c extraSqs=true"

echo "[$MODE] 完了。結果 -> $OUT"
