# Jenkins가 만든 실행 JAR을 Java 21 환경에서 실행하는 이미지다.
# 빌드 컨텍스트는 backend/build/libs이며, JAR이 하나인지 파이프라인에서 확인한다.
FROM eclipse-temurin:21-jre

WORKDIR /app
COPY *.jar /app/app.jar

USER 10001:10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
