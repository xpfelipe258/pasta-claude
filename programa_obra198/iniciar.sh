#!/bin/sh
cd "$(dirname "$0")"
if [ ! -f .instalado ]; then
  python3 -m pip install --quiet -r requirements.txt && echo ok > .instalado
fi
while :; do
  python3 app.py "$@"; codigo=$?
  [ "$codigo" -eq 3 ] || exit "$codigo"
done
