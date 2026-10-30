#!/bin/sh
set -eu

test -s /run/secrets/backend-builder-secret
export JENKINS_SECRET="$(cat /run/secrets/backend-builder-secret)"

exec /usr/local/bin/jenkins-agent \
  -url http://jenkins:8080/jenkins/ \
  -name backend-builder \
  -webSocket \
  -workDir /home/jenkins/agent
