#!/usr/bin/env bash
#
# 通常モード / Express モードのデプロイ時間を計測する補助スクリプト。
#
# 使い方:
#   ./scripts/measure.sh normal    # 通常モードでデプロイして時間を計測
#   ./scripts/measure.sh express   # Express モードでデプロイして時間を計測
#
# 計測結果（壁時計時間）は measurements/ 配下に追記される。
# リソース単位の所要時間は、デプロイ後に stack-events を取得して算出する。
#
# 前提:
#   - AWS 認証情報が設定済みであること
#   - cdk / aws CLI が Express モードに対応したバージョンであること
set -euo pipefail

MODE="${1:-}"
if [[ "${MODE}" != "normal" && "${MODE}" != "express" ]]; then
  echo "usage: $0 {normal|express}" >&2
  exit 1
fi

PREFIX="${MODE}"
STACKS=("${PREFIX}-light" "${PREFIX}-heavy")

OUT_DIR="measurements"
mkdir -p "${OUT_DIR}"
RESULT_FILE="${OUT_DIR}/wallclock.tsv"

# CDK コマンドを組み立てる。Express モードのときだけ --express を付ける。
DEPLOY_ARGS=(deploy --all -c "prefix=${PREFIX}" --require-approval never)
if [[ "${MODE}" == "express" ]]; then
  DEPLOY_ARGS+=(--express)
fi

echo "=== ${MODE} モードでデプロイ開始 ==="
START=$(date +%s)
npx cdk "${DEPLOY_ARGS[@]}"
END=$(date +%s)
ELAPSED=$((END - START))

echo "=== ${MODE} モード: 壁時計 ${ELAPSED} 秒 ==="
if [[ ! -f "${RESULT_FILE}" ]]; then
  printf "mode\tseconds\ttimestamp\n" >>"${RESULT_FILE}"
fi
printf "%s\t%s\t%s\n" "${MODE}" "${ELAPSED}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"${RESULT_FILE}"

# リソース単位の所要時間を stack-events から算出する。
# 各リソースについて CREATE/UPDATE/DELETE の IN_PROGRESS → COMPLETE の差分を秒で出力する。
for STACK in "${STACKS[@]}"; do
  EVENTS_FILE="${OUT_DIR}/${STACK}-events.json"
  echo "--- ${STACK} のスタックイベントを取得 ---"
  aws cloudformation describe-stack-events --stack-name "${STACK}" \
    --query 'StackEvents[].{r:LogicalResourceId,t:ResourceType,s:ResourceStatus,ts:Timestamp}' \
    --output json >"${EVENTS_FILE}" || {
    echo "警告: ${STACK} のイベント取得に失敗（未作成の可能性）" >&2
    continue
  }
  echo "保存: ${EVENTS_FILE}"
done

echo "完了。壁時計結果: ${RESULT_FILE}"
echo "リソース単位の所要時間は ${OUT_DIR}/*-events.json のタイムスタンプ差分から算出してください。"
