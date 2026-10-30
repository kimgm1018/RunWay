FROM eclipse-temurin:17-jdk-jammy AS androidjava
FROM node:22-bookworm-slim AS node

FROM jenkins/inbound-agent:jdk21
USER root

# 앱 빌드는 Java 17, Jenkins 접속 프로그램은 Java 21을 사용한다.
COPY --from=androidjava /opt/java/openjdk /opt/jdk17
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
ENV JAVA_HOME=/opt/jdk17
ENV JENKINS_JAVA_BIN=/opt/java/openjdk/bin/java
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH="/opt/jdk17/bin:/opt/android-sdk/platform-tools:${PATH}"

ARG PNPM_VERSION=11.28.9
ARG ANDROID_TOOLS_BUILD=15859902
ARG ANDROID_TOOLS_SHA256=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && npm install --global "pnpm@${PNPM_VERSION}"

# 공식 도구를 checksum으로 검사한다. 약관 자동 동의와 SDK 패키지 설치는 하지 않는다.
RUN curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_TOOLS_BUILD}_latest.zip" -o /tmp/android-tools.zip \
    && echo "${ANDROID_TOOLS_SHA256}  /tmp/android-tools.zip" | sha256sum -c - \
    && mkdir -p /opt/android-sdk/cmdline-tools /home/jenkins/.gradle \
    && unzip -q /tmp/android-tools.zip -d /tmp/android-tools \
    && mv /tmp/android-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
    && rm -rf /tmp/android-tools.zip /tmp/android-tools \
    && chown -R jenkins:jenkins /opt/android-sdk /home/jenkins/.gradle

COPY sdkmanager.sh /usr/local/bin/runway-sdkmanager
RUN chmod 0755 /usr/local/bin/runway-sdkmanager \
    && java -version && node --version && pnpm --version
USER jenkins
