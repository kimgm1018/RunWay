FROM docker:29-cli AS dockercli
FROM jenkins/inbound-agent:jdk21

# Java 21은 Jenkins 접속용이다. Python 테스트는 별도 검사 이미지에서 실행한다.
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
RUN java -version && docker --version && git --version
