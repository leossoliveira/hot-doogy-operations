#!/bin/zsh
set -eu
cd -- "${0:A:h}/.."
umask 077
mkdir -p .secrets
print 'Paste the OpenAI API key below. Input is hidden and saved only on this Mac.'
while true; do
 read -rs 'invoice_api_key?OpenAI API key: '
 print
 invoice_api_key="${invoice_api_key//[$'\r\n\t ']/}"
 if [[ "$invoice_api_key" == sk-* && ${#invoice_api_key} -ge 20 ]]; then break; fi
 print 'Empty or invalid key. Copy the full secret key (starting with sk-) and try again. Ctrl+C cancels.'
done
printf 'OPENAI_API_KEY=%s\nOPENAI_INVOICE_MODEL=gpt-4.1\n' "$invoice_api_key" > .secrets/openai.env
unset invoice_api_key
chmod 600 .secrets/openai.env
print 'Configured. Return to Codex; do not send the key in chat.'
