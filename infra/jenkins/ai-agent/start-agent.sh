#!/bin/sh
set -eu

# 노드 접속 Secret은 Git 밖에서 준비하고 값은 출력하지 않는다.
test -s /run/secrets/ai-builder-secret
export JENKINS_SECRET="$(cat /run/secrets/ai-builder-secret)"

exec /usr/local/bin/jenkins-agent \
  -url http://jenkins:8080/jenkins/ \
  -name ai-builder \
  -webSocket \
  -workDir /home/jenkins/agent
