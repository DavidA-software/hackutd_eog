package com.hackutd.eog.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Lets the React dev server call the API directly (it can also go through the Vite proxy). */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Value("${app.cors-origins}")
    private String[] corsOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**").allowedOrigins(corsOrigins).allowedMethods("GET", "POST", "DELETE");
        registry.addMapping("/data/**").allowedOrigins(corsOrigins).allowedMethods("GET");
    }
}
