/**
 * Original procedural magic-circle shaders. The design is built from simple
 * geometry and mathematical fields, so it has no dependency on external or
 * copyrighted artwork.
 */
export const magicCircleVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const magicCircleFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uPhase;
  uniform float uLayer;
  uniform float uOpacity;
  uniform float uBrightness;
  uniform float uGlowStrength;
  uniform vec3 uPrimaryColor;
  uniform vec3 uEdgeColor;
  uniform vec3 uHighlightColor;
  uniform vec3 uCoreColor;

  varying vec2 vUv;

  const float PI = 3.141592653589793;
  const float TAU = 6.283185307179586;

  vec2 rotate2d(vec2 point, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return mat2(cosine, -sine, sine, cosine) * point;
  }

  float stroke(float distanceValue, float halfWidth) {
    float antialiasWidth = max(fwidth(distanceValue) * 1.4, 0.0012);
    return 1.0 - smoothstep(halfWidth - antialiasWidth, halfWidth + antialiasWidth, abs(distanceValue));
  }

  float ring(float radius, float targetRadius, float halfWidth) {
    return stroke(radius - targetRadius, halfWidth);
  }

  float radialWindow(float radius, float innerRadius, float outerRadius) {
    float antialiasWidth = max(fwidth(radius) * 1.5, 0.0015);
    return smoothstep(innerRadius - antialiasWidth, innerRadius + antialiasWidth, radius)
      * (1.0 - smoothstep(outerRadius - antialiasWidth, outerRadius + antialiasWidth, radius));
  }

  float regularPolygonDistance(vec2 point, float sides, float radius) {
    float angle = atan(point.y, point.x) + PI;
    float sector = TAU / sides;
    return cos(floor(0.5 + angle / sector) * sector - angle) * length(point) - radius;
  }

  float spokeMask(float angle, float count, float sharpness) {
    return pow(max(abs(cos(angle * count * 0.5)), 0.0), sharpness);
  }

  void main() {
    vec2 point = vUv * 2.0 - 1.0;
    float radius = length(point);
    float angle = atan(point.y, point.x);
    float pulse = 0.86 + 0.14 * sin(uTime * 2.15 + uLayer * 1.7);

    float lineMask = 0.0;
    float glowMask = 0.0;
    float highlightMask = 0.0;
    float alphaMask = 0.0;

    if (uLayer < 0.5) {
      float edgeNoise = sin(angle * 13.0 + uTime * 1.7)
        + 0.45 * sin(angle * 29.0 - uTime * 2.3);
      float noisyRadius = radius + edgeNoise * 0.0045;
      float outer = ring(noisyRadius, 0.91, 0.010);
      float outerGuide = ring(radius, 0.825, 0.0045);
      float outerTicks = spokeMask(angle + uPhase, 64.0, 26.0)
        * radialWindow(radius, 0.835, 0.895);
      float longTicks = spokeMask(angle - uPhase * 0.37, 16.0, 56.0)
        * radialWindow(radius, 0.735, 0.905);
      float rays = spokeMask(angle + uPhase * 0.21, 8.0, 92.0)
        * radialWindow(radius, 0.54, 0.76);

      lineMask = max(max(outer, outerGuide), max(outerTicks, max(longTicks, rays * 0.72)));
      glowMask = outer * 0.9 + outerTicks * 0.5 + rays * 0.28;
      glowMask += (1.0 - smoothstep(0.0, 0.075, abs(noisyRadius - 0.91))) * 0.24;
      highlightMask = outerTicks * 0.55 + outer * 0.16;
      alphaMask = max(lineMask, glowMask * 0.58);
    } else if (uLayer < 1.5) {
      vec2 rotatingPoint = rotate2d(point, uPhase);
      float innerA = ring(radius, 0.645, 0.008);
      float innerB = ring(radius, 0.505, 0.0045);
      float innerTicks = spokeMask(angle - uPhase * 0.8, 36.0, 30.0)
        * radialWindow(radius, 0.525, 0.625);
      float triangle = stroke(regularPolygonDistance(rotatingPoint, 3.0, 0.44), 0.011);
      float hexagon = stroke(regularPolygonDistance(rotate2d(rotatingPoint, PI / 6.0), 6.0, 0.34), 0.0065);
      float cardinalRays = spokeMask(angle + uPhase * 0.5, 12.0, 72.0)
        * radialWindow(radius, 0.19, 0.48);

      lineMask = max(max(innerA, innerB), max(innerTicks, max(triangle, max(hexagon, cardinalRays * 0.68))));
      glowMask = innerA * 0.68 + triangle * 0.42 + hexagon * 0.32 + cardinalRays * 0.2;
      highlightMask = innerTicks * 0.48 + hexagon * 0.25;
      alphaMask = max(lineMask, glowMask * 0.62);
    } else {
      float energy = exp(-16.0 * radius * radius);
      float softHalo = exp(-5.5 * radius * radius) * 0.48;
      float coreRingA = ring(radius, 0.215 + 0.012 * sin(uTime * 2.8), 0.008);
      float coreRingB = ring(radius, 0.295, 0.004);
      float arcMask = spokeMask(angle + uPhase, 10.0, 18.0)
        * radialWindow(radius, 0.225, 0.305);

      lineMask = max(coreRingA, max(coreRingB * 0.7, arcMask * 0.62));
      glowMask = softHalo + coreRingA * 0.55 + arcMask * 0.18;
      highlightMask = energy + coreRingA * 0.25;
      alphaMask = max(energy * 0.82, max(lineMask, glowMask * 0.72));
    }

    float breathingAlpha = alphaMask * pulse * uOpacity;
    if (breathingAlpha < 0.002) discard;

    vec3 color = mix(uEdgeColor, uPrimaryColor, clamp(lineMask + glowMask * 0.42, 0.0, 1.0));
    color = mix(color, uCoreColor, clamp(glowMask * 0.5, 0.0, 0.65));
    color = mix(color, uHighlightColor, clamp(highlightMask, 0.0, 0.92));
    float luminanceBoost = (0.82 + lineMask * 0.42 + glowMask * uGlowStrength * 0.34) * uBrightness;

    gl_FragColor = vec4(color * luminanceBoost, clamp(breathingAlpha, 0.0, 1.0));
  }
`
