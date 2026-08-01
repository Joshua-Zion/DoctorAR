export const shockwaveVertexShader = /* glsl */ `
  precision highp float;

  uniform float uTime;

  attribute vec2 aCenter;
  attribute float aBirthTime;
  attribute float aLifetime;
  attribute float aStartRadius;
  attribute float aMaxRadius;
  attribute float aStrength;
  attribute float aSeed;

  varying vec2 vUv;
  varying float vProgress;
  varying float vStrength;
  varying float vSeed;

  void main() {
    float age = max(0.0, uTime - aBirthTime);
    float progress = clamp(age / max(aLifetime, 0.001), 0.0, 1.0);
    float eased = 1.0 - pow(1.0 - progress, 3.0);
    float radius = mix(aStartRadius, aMaxRadius, eased);
    vec2 worldPosition = aCenter + position.xy * radius;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 0.0, 1.0);
    vUv = uv;
    vProgress = progress;
    vStrength = aStrength;
    vSeed = aSeed;
  }
`

export const shockwaveFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uBrightness;
  uniform vec3 uPrimaryColor;
  uniform vec3 uEdgeColor;
  uniform vec3 uHighlightColor;

  varying vec2 vUv;
  varying float vProgress;
  varying float vStrength;
  varying float vSeed;

  const float TAU = 6.283185307179586;

  float ring(float radius, float target, float halfWidth) {
    float antialiasWidth = max(fwidth(radius) * 1.5, 0.0015);
    return 1.0 - smoothstep(
      halfWidth - antialiasWidth,
      halfWidth + antialiasWidth,
      abs(radius - target)
    );
  }

  void main() {
    vec2 point = vUv * 2.0 - 1.0;
    float radius = length(point);
    float angle = atan(point.y, point.x);
    if (radius > 1.0) discard;

    float adaptiveWidth = mix(0.06, 0.009, vProgress);
    float edgeNoise = sin(angle * 23.0 + vSeed * TAU + uTime * 1.8) * mix(0.014, 0.003, vProgress);
    float mainRing = ring(radius + edgeNoise, 0.88, adaptiveWidth);
    float echoDelay = smoothstep(0.08, 0.32, vProgress);
    float echoRing = ring(radius, mix(0.58, 0.76, vProgress), adaptiveWidth * 0.72) * echoDelay;
    float spokes = pow(max(abs(cos(angle * 12.0 + vSeed)), 0.0), 46.0)
      * smoothstep(0.18, 0.3, radius)
      * (1.0 - smoothstep(0.86, 0.94, radius));
    float centerFlash = exp(-11.0 * radius * radius) * (1.0 - smoothstep(0.0, 0.32, vProgress));
    float broadGlow = (1.0 - smoothstep(0.0, 0.105, abs(radius - 0.88))) * 0.34;

    float fadeIn = smoothstep(0.0, 0.035, vProgress);
    float fadeOut = 1.0 - smoothstep(0.58, 1.0, vProgress);
    float pattern = mainRing + echoRing * 0.64 + spokes * 0.42 + centerFlash * 0.82 + broadGlow;
    float alpha = pattern * fadeIn * fadeOut * mix(0.72, 1.0, vStrength);
    if (alpha < 0.002) discard;

    vec3 color = mix(uEdgeColor, uPrimaryColor, clamp(mainRing + echoRing * 0.48 + broadGlow, 0.0, 1.0));
    color = mix(color, uHighlightColor, clamp(centerFlash + mainRing * 0.28, 0.0, 0.9));
    float shimmer = 0.92 + 0.08 * sin(uTime * 21.0 + vSeed * 13.7);
    gl_FragColor = vec4(color * uBrightness * shimmer * (1.0 + mainRing * 0.42), clamp(alpha, 0.0, 1.0));
  }
`
