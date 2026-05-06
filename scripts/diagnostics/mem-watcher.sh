#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Hydra Memory Watcher
# ──────────────────────────────────────────────────────────────────────────────
#
# Snapshots system RAM, swap, compressor, and per-process Hydra/Chromium/Node
# memory every 1s. Designed to run while you launch Hydra so we can see
# exactly what the app costs.
#
# Usage:
#   ./scripts/diagnostics/mem-watcher.sh                  # 60s default
#   ./scripts/diagnostics/mem-watcher.sh 120              # custom duration
#   DURATION=180 INTERVAL=2 ./scripts/diagnostics/mem-watcher.sh
#
# Output:
#   Live tail to stdout AND saved to ./mem-watch-<timestamp>.log
#
# What we capture per tick:
#   - PhysMem total used / unused (top -l1)
#   - swap used / free (sysctl vm.swapusage)
#   - compressor pages (vm_stat)
#   - Hydra electron procs (count + total RSS)
#   - All Chromium/Chrome for Testing children (count + RSS)  — NOT regular Chrome
#   - All node procs except claude/claude-code (count + RSS)
#   - claude (CLI) procs (count + RSS) for context
#
# Safety:
#   Read-only. Never kills processes. Never touches the user's regular Chrome.
# ──────────────────────────────────────────────────────────────────────────────

DURATION="${1:-${DURATION:-60}}"
INTERVAL="${INTERVAL:-1}"
TS="$(date +%Y%m%d_%H%M%S)"
LOG="mem-watch-${TS}.log"

echo "[mem-watcher] duration=${DURATION}s interval=${INTERVAL}s log=${LOG}"
echo "[mem-watcher] launch Hydra now — readings start in 2s"
sleep 2

# Header — wide because the columns must align after the second decimal.
HDR="$(printf '%-9s %7s %7s %7s %7s %4s%7s %4s%7s %4s%7s %4s%7s' \
  'time' 'phys_used' 'swap_used' 'compr_pg' 'free' \
  'hyd' 'hyd_RSS' 'cft' 'cft_RSS' 'node' 'node_RSS' 'cli' 'cli_RSS')"
echo "$HDR" | tee "$LOG"
echo "----------------------------------------------------------------------------------------------------------" | tee -a "$LOG"

start=$(date +%s)
end=$((start + DURATION))

while [ "$(date +%s)" -lt "$end" ]; do
  now=$(date +%H:%M:%S)

  # PhysMem from top -l1 — line looks like:
  # PhysMem: 47G used (7638M wired, 23G compressor), 461M unused.
  phys_line=$(top -l 1 -n 0 -s 0 | grep "^PhysMem")
  phys_used=$(echo "$phys_line" | awk '{print $2}')
  phys_unused=$(echo "$phys_line" | awk '{for(i=1;i<=NF;i++) if($i ~ /unused/) {print $(i-1); exit}}')

  # Swap used in MB
  swap_used=$(sysctl -n vm.swapusage | awk -F'[= ]+' '{for(i=1;i<=NF;i++) if($i=="used") print $(i+1)}')

  # Compressor pages from vm_stat (page size 16k on Apple Silicon)
  compr=$(vm_stat | awk '/Pages occupied by compressor/ {gsub(/\./,"",$NF); print $NF}')

  # Hydra electron processes (main, renderer, GPU helper) — match path
  hyd_data=$(ps -A -o rss=,command= | awk '
    /Hydra\.app|hydra\/electron\/main|hydra\/server\/standalone/ && !/grep|mem-watcher/ {sum+=$1; n++}
    END {printf "%d %.0f", n+0, sum/1024+0}')
  hyd_n=$(echo "$hyd_data" | awk '{print $1}')
  hyd_rss=$(echo "$hyd_data" | awk '{print $2}')

  # Chromium / Chrome for Testing — Hydra's playwright instances ONLY
  # Conservative match: must be inside Hydra paths or chrome-for-testing
  cft_data=$(ps -A -o rss=,command= | awk '
    /Chrome for Testing|hydra-pw-profile|chromium\/.*hydra/ && !/grep|mem-watcher/ {sum+=$1; n++}
    END {printf "%d %.0f", n+0, sum/1024+0}')
  cft_n=$(echo "$cft_data" | awk '{print $1}')
  cft_rss=$(echo "$cft_data" | awk '{print $2}')

  # Other node processes (not claude CLI)
  node_data=$(ps -A -o rss=,command= | awk '
    /node|Node/ && !/[Cc]laude|grep|mem-watcher/ {sum+=$1; n++}
    END {printf "%d %.0f", n+0, sum/1024+0}')
  node_n=$(echo "$node_data" | awk '{print $1}')
  node_rss=$(echo "$node_data" | awk '{print $2}')

  # claude CLI processes
  cli_data=$(ps -A -o rss=,command= | awk '
    /[c]laude/ && !/Claude\.app/ {sum+=$1; n++}
    END {printf "%d %.0f", n+0, sum/1024+0}')
  cli_n=$(echo "$cli_data" | awk '{print $1}')
  cli_rss=$(echo "$cli_data" | awk '{print $2}')

  # Format: time, phys_used, swap_used MB, compr pg, phys_unused, hyd_n hyd_RSS_mb, cft_n cft_RSS, node_n node_RSS, cli_n cli_RSS
  line=$(printf '%-9s %7s %7s %7s %7s %4d%5dMB %4d%5dMB %4d%5dMB %4d%5dMB' \
    "$now" "$phys_used" "${swap_used}M" "$compr" "$phys_unused" \
    "$hyd_n" "$hyd_rss" "$cft_n" "$cft_rss" "$node_n" "$node_rss" "$cli_n" "$cli_rss")
  echo "$line" | tee -a "$LOG"

  sleep "$INTERVAL"
done

echo "" | tee -a "$LOG"
echo "[mem-watcher] done. log saved to: $LOG" | tee -a "$LOG"
