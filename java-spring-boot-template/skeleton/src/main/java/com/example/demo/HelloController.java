package com.example.demo;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HelloController {

    @GetMapping("/")
    public Map<String, String> index() {
        return Map.of(
                "message", "Hello from ${{ values.componentId }}",
                "service", "${{ values.componentId }}");
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "UP");
    }
}
