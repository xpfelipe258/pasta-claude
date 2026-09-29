#!/bin/sh
cd "$(dirname "$0")"
if [ ! -f .instalado ]; then
  python3 -m pip install --quiet -r requirements.txt && echo ok > .instalado
fi
exec python3 app.py "$@"
