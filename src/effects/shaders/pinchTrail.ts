export const pinchTrailVertexShader = /* glsl */ `
  precision highp float;

  uniform float uTime;

  attribute vec2 aStart;
  attribute vec2 aEnd;
  attribute float aBirthTime;
  attribute float aLifetime;
  attribute float aWidth;
  attribute float aSeed;

  varying float vAcross;
  varying float vAlong;
  varying float vLifeAlpha;
  varying float vSeed;

  void main() {
    float age = max(0.0, uTime - aBirthTime);
    float progress = clamp(age / max(aLifetime, 0.001), 0.0, 1.0);
    vec2 delta = aEnd - aStart;
    float segmentLength = max(length(delta), 0.001);
    vec2 tangent = delta / segmentLength;
    vec2 normal = vec2(-tangent.y, tangent.x);
    float widthScale = mix(1.0, 0.44, progress);
    vec2 worldPosition = mix(aStart, aEnd, position.x)
      + normal * position.y * aWidth * 0.5 * widthScale;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 0.0, 1.0);
    vAcross = abs(position.y);
    vAlong = position.x;
    float fadeIn = smoothstep(0.0, 0.035, age);
    float fadeOut = 1.0 - smoothstep(0.48, 1.0, progress);
    vLifeAlpha = fadeIn * fadeOut * step(progress, 0.9999);
    vSeed = aSeed;
  }
`

export const pinchTrailFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uBrightness;
  uniform vec3 uPrimaryColor;
  uniform vec3 uHighlightColor;

  varying float vAcross;
  varying float vAlong;
  varying float vLifeAlpha;
  varying float vSeed;

  void main() {
    float core = 1.0 - smoothstep(0.0, 0.24, vAcross);
    float glow = 1.0 - smoothstep(0.12, 1.0, vAcross);
    float endSoftness = 0.72 + 0.28
      * smoothstep(0.0, 0.08, vAlong)
      * (1.0 - smoothstep(0.92, 1.0, vAlong));
    float shimmer = 0.88 + 0.12 * sin(uTime * 18.0 + vSeed * 17.31);
    float alpha = (core + glow * 0.72) * vLifeAlpha * endSoftness * shimmer;
    if (alpha < 0.002) discard;

    vec3 color = mix(uPrimaryColor, uHighlightColor, clamp(core * 0.82 + shimmer * 0.08, 0.0, 1.0));
    gl_FragColor = vec4(color * uBrightness * (0.9 + core * 0.52), clamp(alpha, 0.0, 1.0));
  }
`

export const pinchHeadVertexShader = /* glsl */ `
  precision highp float;

  uniform float uPixelRatio;
  uniform float uPointSize;

  attribute float aOpacity;
  attribute float aSeed;

  varying float vOpacity;
  varying float vSeed;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(64.0, max(1.0, uPointSize * uPixelRatio * (0.82 + aOpacity * 0.18)));
    vOpacity = aOpacity;
    vSeed = aSeed;
  }
`

export const pinchHeadFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uBrightness;
  uniform vec3 uPrimaryColor;
  uniform vec3 uHighlightColor;

  varying float vOpacity;
  varying float vSeed;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float radius = length(point);
    if (radius > 1.0) discard;

    float core = 1.0 - smoothstep(0.0, 0.22, radius);
    float glow = 1.0 - smoothstep(0.08, 1.0, radius);
    float pulse = 0.88 + 0.12 * sin(uTime * 15.0 + vSeed * 9.71);
    float alpha = (core + glow * 0.74) * vOpacity * pulse;
    vec3 color = mix(uPrimaryColor, uHighlightColor, core * 0.9);
    gl_FragColor = vec4(color * uBrightness * (1.0 + core * 0.72), clamp(alpha, 0.0, 1.0));
  }
`
