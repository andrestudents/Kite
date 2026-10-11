#!/usr/bin/env bash
# Sourced by the bash gates (run-all.sh, recon.sh): loads ./.env the way bun
# does — but WITHOUT ever executing a line from it. Handles what plain
# `source .env` chokes on:
#   - CRLF line endings (Windows-edited .env): a trailing \r contaminates every
#     value and makes bash try to run bare "\r" lines as commands
#   - `export KEY=...` prefixes
#   - single/double-quoted values (bun's dotenv strips the quotes)
#   - malformed lines (no `=`) are skipped, never executed
# Values are taken literally: no $ or backtick expansion. Nothing is echoed.
_kite_env_file="${KITE_ENV_FILE:-.env}"
if [ -f "$_kite_env_file" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    _line="${_line%$'\r'}"
    case "$_line" in ''|\#*) continue ;; esac
    case "$_line" in export\ *) _line="${_line#export }" ;; esac
    case "$_line" in
      *=*)
        _key="${_line%%=*}"
        _val="${_line#*=}"
        case "$_val" in
          \"*\") _val="${_val#\"}" ; _val="${_val%\"}" ;;
          \'*\') _val="${_val#\'}" ; _val="${_val%\'}" ;;
        esac
        export "$_key=$_val" 2>/dev/null || true
        ;;
    esac
  done < "$_kite_env_file"
fi
unset _kite_env_file _line _key _val
