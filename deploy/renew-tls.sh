#!/bin/sh
set -eu
# Run by the dedicated systemd timer on the confirmed deployment host.
# Reuses the existing webroot HTTP-01 route; does not stop or reload mail/Reality services.
docker run --rm \
  -v /opt/mailcow-dockerized/data/web:/var/www/html \
  -v /home/ubuntu/squeek-supply-tls:/etc/letsencrypt \
  certbot/certbot:latest renew --quiet --no-random-sleep-on-renew
docker exec squeek-supply-https-1 nginx -s reload
