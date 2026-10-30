#!/bin/bash
set -eu

/usr/bin/docker run --rm \
  -v /home/ubuntu/runway/infra/certbot/conf:/etc/letsencrypt \
  -v /home/ubuntu/runway/infra/certbot/www:/var/www/certbot \
  certbot/certbot renew --quiet

/usr/bin/docker compose \
  -f /home/ubuntu/runway/infra/compose.yaml \
  exec -T nginx nginx -t

/usr/bin/docker compose \
  -f /home/ubuntu/runway/infra/compose.yaml \
  exec -T nginx nginx -s reload
