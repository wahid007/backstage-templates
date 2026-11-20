package com.example.demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * End-to-end tests against a real HTTP server on a random port.
 *
 * <p>Uses the JDK {@link HttpClient} (instead of Spring's test HTTP clients) so the
 * test stays independent of Spring Boot's test-client module layout.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApplicationTests {

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    private HttpResponse<String> get(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + port + path))
                .GET()
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void healthEndpointIsUp() throws Exception {
        HttpResponse<String> response = get("/health");

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("UP"), response.body());
    }

    @Test
    void indexReturnsServiceName() throws Exception {
        HttpResponse<String> response = get("/");

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("${{ values.componentId }}"), response.body());
    }
}
