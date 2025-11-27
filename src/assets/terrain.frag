uniform sampler2D grassTexture;
uniform sampler2D rockDiffuseTexture;
uniform sampler2D rockDisplacementMap;
uniform float minRockHeight;
uniform float maxRockHeight;
uniform float displacementScale;
uniform float grassRoughness;
uniform float rockRoughness;
uniform vec3 uCameraPosition;

varying vec2 vUv;
varying float vHeight;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main() {
  // Calculate blend factor based on height
  float blendFactor = smoothstep(minRockHeight, maxRockHeight, vHeight);
  
  // Sample textures
  vec4 grassColor = texture2D(grassTexture, vUv);
  vec4 rockColor = texture2D(rockDiffuseTexture, vUv);
  
  // Blend diffuse textures
  vec4 finalColor = mix(grassColor, rockColor, blendFactor);
  
  // Calculate normal with normal mapping for rocky areas
  // Generate normal from displacement map
  vec3 normal = normalize(vWorldNormal);
  if (blendFactor > 0.01) {
    // Calculate texel size based on UV derivatives (accounts for texture repeat)
    vec2 texelSize = vec2(
      length(dFdx(vUv)),
      length(dFdy(vUv))
    );
    
    // Sample displacement map at neighboring UV coordinates to calculate normal
    float hL = texture2D(rockDisplacementMap, vUv + vec2(-texelSize.x, 0.0)).r;
    float hR = texture2D(rockDisplacementMap, vUv + vec2(texelSize.x, 0.0)).r;
    float hD = texture2D(rockDisplacementMap, vUv + vec2(0.0, -texelSize.y)).r;
    float hU = texture2D(rockDisplacementMap, vUv + vec2(0.0, texelSize.y)).r;
    
    // Calculate normal from height differences (Sobel filter approach)
    float dx = (hR - hL) * displacementScale;
    float dy = (hU - hD) * displacementScale;
    
    vec3 rockNormal = normalize(vec3(-dx, 1.0, -dy));
    
    // Create TBN matrix for normal mapping
    vec3 Q1 = dFdx(vWorldPosition);
    vec3 Q2 = dFdy(vWorldPosition);
    vec2 st1 = dFdx(vUv);
    vec2 st2 = dFdy(vUv);
    
    vec3 N = normalize(vWorldNormal);
    vec3 T = normalize(Q1 * st2.t - Q2 * st1.t);
    vec3 B = -normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);
    
    vec3 mappedNormal = normalize(TBN * rockNormal);
    normal = normalize(mix(vWorldNormal, mappedNormal, blendFactor));
  }
  
  // Flatten lighting to remove harsh shading and brighten overall look
  vec3 lighting = vec3(1.35);
  
  // Slightly brighten base color to ensure light appearance
  vec3 brightenedColor = mix(finalColor.rgb, vec3(1.0), 0.15);
  vec3 final = finalColor.rgb * lighting;
  
  gl_FragColor = vec4(final, 1.0);
}

