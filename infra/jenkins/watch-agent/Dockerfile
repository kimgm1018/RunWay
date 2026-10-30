FROM eclipse-temurin:25-jdk-jammy AS watchjava
FROM jenkins/inbound-agent:jdk21
USER root

# Jenkins 접속은 Java 21, wear Gradle 실행은 프로젝트 기준 Java 25를 사용한다.
COPY --from=watchjava /opt/java/openjdk /opt/jdk25
ENV JAVA_HOME=/opt/jdk25
ENV JENKINS_JAVA_BIN=/opt/java/openjdk/bin/java
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH="/opt/jdk25/bin:/opt/android-sdk/platform-tools:${PATH}"

ARG ANDROID_TOOLS_BUILD=15859902
ARG ANDROID_TOOLS_SHA256=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# 모바일과 같은 공식 도구를 사용한다. SDK 약관 동의·패키지 설치는 별도로 진행한다.
RUN curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_TOOLS_BUILD}_latest.zip" -o /tmp/android-tools.zip \
    && echo "${ANDROID_TOOLS_SHA256}  /tmp/android-tools.zip" | sha256sum -c - \
    && mkdir -p /opt/android-sdk/cmdline-tools /home/jenkins/.gradle \
    && unzip -q /tmp/android-tools.zip -d /tmp/android-tools \
    && mv /tmp/android-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
    && rm -rf /tmp/android-tools.zip /tmp/android-tools \
    && chown -R jenkins:jenkins /opt/android-sdk /home/jenkins/.gradle

COPY sdkmanager.sh /usr/local/bin/runway-sdkmanager
RUN chmod 0755 /usr/local/bin/runway-sdkmanager && java -version
USER jenkins
