# syntax=docker/dockerfile:1

# 1) Build the fat jar
FROM maven:3.10-eclipse-temurin-25 AS build
WORKDIR /workspace

# Cache dependencies separately from the source code
COPY pom.xml ./
RUN mvn -B -q -ntp dependency:go-offline

COPY src ./src
RUN mvn -B -q -ntp clean package -DskipTests

# 2) Minimal runtime image
FROM eclipse-temurin:25-jre-alpine AS runtime
WORKDIR /app

RUN addgroup -g 10001 -S app && adduser -S -u 10001 -G app app

COPY --from=build --chown=app:app /workspace/target/*.jar /app/application.jar

USER app
EXPOSE 8080

ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0"

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/application.jar"]
