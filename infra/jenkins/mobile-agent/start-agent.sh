#!/bin/sh
set -eu

# 실제 Secret은 출력하지 않고 에이전트 접속에만 사용한다.
test -s /run/secrets/mobile-builder-secret
export JENKINS_SECRET="$(cat /run/secrets/mobile-builder-secret)"
exec /usr/local/bin/jenkins-agent \
  -url http://jenkins:8080/jenkins/ \
  -name mobile-builder \
  -webSocket \
  -workDir /home/jenkins/agent
