FROM eclipse-temurin:21-jdk AS java
FROM docker:29-cli AS dockercli

FROM jenkins/inbound-agent:jdk21

COPY --from=java /opt/java/openjdk /opt/jdk21
ENV JAVA_HOME=/opt/jdk21
ENV PATH="/opt/jdk21/bin:${PATH}"

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/

RUN java -version && javac -version && docker --version && git --version
