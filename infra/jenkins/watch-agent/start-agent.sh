#!/bin/sh
set -eu

# 실제 Secret은 출력하지 않고 watch-builder 노드 접속에만 사용한다.
test -s /run/secrets/watch-builder-secret
export JENKINS_SECRET="$(cat /run/secrets/watch-builder-secret)"
exec /usr/local/bin/jenkins-agent \
  -url http://jenkins:8080/jenkins/ \
  -name watch-builder \
  -webSocket \
  -workDir /home/jenkins/agent
