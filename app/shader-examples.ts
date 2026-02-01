export interface ShaderExample {
  name: string;
  description: string;
  code: string;
}

export const SHADER_EXAMPLES: ShaderExample[] = [
  {
    name: "Gradient Wave",
    description: "Animated color gradient with wave distortion",
    code: `#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex VertexOut vertex_main(uint vertexID [[vertex_id]]) {
    float2 positions[6] = {
        float2(-1, -1), float2(1, -1), float2(-1, 1),
        float2(-1, 1), float2(1, -1), float2(1, 1)
    };
    
    VertexOut out;
    out.position = float4(positions[vertexID], 0, 1);
    out.uv = positions[vertexID] * 0.5 + 0.5;
    return out;
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
                              constant float &time [[buffer(0)]],
                              constant float2 &mouse [[buffer(1)]]) {
    float2 uv = in.uv;
    
    // Wave distortion
    uv.x += sin(uv.y * 10.0 + time * 2.0) * 0.02;
    uv.y += cos(uv.x * 10.0 + time * 2.0) * 0.02;
    
    // Gradient colors
    float3 col1 = float3(0.1, 0.2, 0.4);
    float3 col2 = float3(0.4, 0.1, 0.3);
    float3 col3 = float3(0.1, 0.3, 0.2);
    
    float t = sin(time * 0.5) * 0.5 + 0.5;
    float3 color = mix(mix(col1, col2, uv.x), col3, uv.y * t);
    
    // Mouse interaction - subtle glow
    float dist = length(uv - mouse);
    color += float3(0.1, 0.15, 0.2) * smoothstep(0.3, 0.0, dist);
    
    return float4(color, 1.0);
}`,
  },
  {
    name: "Metaballs",
    description: "Classic metaball effect with smooth blending",
    code: `#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex VertexOut vertex_main(uint vertexID [[vertex_id]]) {
    float2 positions[6] = {
        float2(-1, -1), float2(1, -1), float2(-1, 1),
        float2(-1, 1), float2(1, -1), float2(1, 1)
    };
    
    VertexOut out;
    out.position = float4(positions[vertexID], 0, 1);
    out.uv = positions[vertexID] * 0.5 + 0.5;
    return out;
}

float metaball(float2 uv, float2 center, float radius) {
    float d = length(uv - center);
    return radius / (d * d + 0.0001);
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
                              constant float &time [[buffer(0)]],
                              constant float2 &mouse [[buffer(1)]]) {
    float2 uv = in.uv;
    float aspect = 800.0 / 600.0;
    uv.x *= aspect;
    
    float2 mousePos = mouse;
    mousePos.x *= aspect;
    
    float v = 0.0;
    
    // Animated metaballs
    v += metaball(uv, float2(0.3 * aspect, 0.3) + float2(sin(time), cos(time * 0.7)) * 0.15, 0.03);
    v += metaball(uv, float2(0.7 * aspect, 0.7) + float2(cos(time * 0.8), sin(time * 1.1)) * 0.15, 0.025);
    v += metaball(uv, float2(0.5 * aspect, 0.5) + float2(sin(time * 1.2), cos(time * 0.9)) * 0.2, 0.035);
    v += metaball(uv, float2(0.4 * aspect, 0.6) + float2(cos(time * 0.6), sin(time * 1.3)) * 0.12, 0.02);
    
    // Mouse-controlled metaball
    v += metaball(uv, mousePos, 0.04);
    
    // Threshold and color
    float threshold = smoothstep(0.9, 1.1, v);
    
    float3 color = float3(0.05, 0.05, 0.08);
    color = mix(color, float3(0.2, 0.4, 0.8), threshold);
    color = mix(color, float3(0.4, 0.8, 1.0), smoothstep(1.1, 1.5, v));
    
    return float4(color, 1.0);
}`,
  },
  {
    name: "Raymarched Sphere",
    description: "Simple raymarched sphere with lighting",
    code: `#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex VertexOut vertex_main(uint vertexID [[vertex_id]]) {
    float2 positions[6] = {
        float2(-1, -1), float2(1, -1), float2(-1, 1),
        float2(-1, 1), float2(1, -1), float2(1, 1)
    };
    
    VertexOut out;
    out.position = float4(positions[vertexID], 0, 1);
    out.uv = positions[vertexID];
    return out;
}

float sdSphere(float3 p, float r) {
    return length(p) - r;
}

float3 calcNormal(float3 p) {
    float2 e = float2(0.001, 0);
    return normalize(float3(
        sdSphere(p + e.xyy, 1.0) - sdSphere(p - e.xyy, 1.0),
        sdSphere(p + e.yxy, 1.0) - sdSphere(p - e.yxy, 1.0),
        sdSphere(p + e.yyx, 1.0) - sdSphere(p - e.yyx, 1.0)
    ));
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
                              constant float &time [[buffer(0)]],
                              constant float2 &mouse [[buffer(1)]]) {
    float2 uv = in.uv;
    uv.x *= 800.0 / 600.0;
    
    // Camera
    float3 ro = float3(0, 0, -3);
    float3 rd = normalize(float3(uv, 1.5));
    
    // Rotate based on mouse
    float angle = (mouse.x - 0.5) * 3.14159;
    float c = cos(angle);
    float s = sin(angle);
    rd.xz = float2(rd.x * c - rd.z * s, rd.x * s + rd.z * c);
    
    // Raymarch
    float t = 0.0;
    float3 p;
    for (int i = 0; i < 64; i++) {
        p = ro + rd * t;
        float d = sdSphere(p, 1.0);
        if (d < 0.001) break;
        t += d;
        if (t > 20.0) break;
    }
    
    float3 color = float3(0.02, 0.02, 0.04);
    
    if (t < 20.0) {
        float3 n = calcNormal(p);
        
        // Animated light
        float3 lightPos = float3(sin(time) * 2.0, 1.5, cos(time) * 2.0 - 3.0);
        float3 l = normalize(lightPos - p);
        
        float diff = max(dot(n, l), 0.0);
        float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 32.0);
        
        float3 baseColor = float3(0.3, 0.4, 0.6);
        color = baseColor * (0.1 + diff * 0.7) + float3(1.0) * spec * 0.5;
    }
    
    return float4(color, 1.0);
}`,
  },
  {
    name: "Fractal Noise",
    description: "Animated fractal brownian motion noise",
    code: `#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex VertexOut vertex_main(uint vertexID [[vertex_id]]) {
    float2 positions[6] = {
        float2(-1, -1), float2(1, -1), float2(-1, 1),
        float2(-1, 1), float2(1, -1), float2(1, 1)
    };
    
    VertexOut out;
    out.position = float4(positions[vertexID], 0, 1);
    out.uv = positions[vertexID] * 0.5 + 0.5;
    return out;
}

float hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + float2(1, 0));
    float c = hash(i + float2(0, 1));
    float d = hash(i + float2(1, 1));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(float2 p) {
    float v = 0.0;
    float a = 0.5;
    float2x2 rot = float2x2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
                              constant float &time [[buffer(0)]],
                              constant float2 &mouse [[buffer(1)]]) {
    float2 uv = in.uv * 3.0;
    
    // Animate noise
    float2 motion = float2(time * 0.1, time * 0.05);
    
    float n1 = fbm(uv + motion);
    float n2 = fbm(uv * 2.0 - motion * 0.5 + n1 * 2.0);
    float n3 = fbm(uv * 0.5 + motion * 0.3 + n2);
    
    // Mouse influence
    float mouseDist = length(in.uv - mouse);
    float mouseInfluence = smoothstep(0.5, 0.0, mouseDist) * 0.3;
    
    float n = mix(n1, n2 * n3, 0.5) + mouseInfluence;
    
    // Color mapping
    float3 col1 = float3(0.05, 0.05, 0.1);
    float3 col2 = float3(0.2, 0.3, 0.5);
    float3 col3 = float3(0.5, 0.4, 0.3);
    
    float3 color = mix(col1, col2, smoothstep(0.2, 0.5, n));
    color = mix(color, col3, smoothstep(0.5, 0.8, n));
    
    return float4(color, 1.0);
}`,
  },
  {
    name: "Voronoi Cells",
    description: "Animated voronoi diagram with cell coloring",
    code: `#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex VertexOut vertex_main(uint vertexID [[vertex_id]]) {
    float2 positions[6] = {
        float2(-1, -1), float2(1, -1), float2(-1, 1),
        float2(-1, 1), float2(1, -1), float2(1, 1)
    };
    
    VertexOut out;
    out.position = float4(positions[vertexID], 0, 1);
    out.uv = positions[vertexID] * 0.5 + 0.5;
    return out;
}

float2 hash2(float2 p) {
    return fract(sin(float2(dot(p, float2(127.1, 311.7)),
                            dot(p, float2(269.5, 183.3)))) * 43758.5453);
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
                              constant float &time [[buffer(0)]],
                              constant float2 &mouse [[buffer(1)]]) {
    float2 uv = in.uv * 5.0;
    
    float2 i_uv = floor(uv);
    float2 f_uv = fract(uv);
    
    float minDist = 10.0;
    float2 minPoint;
    float2 minCell;
    
    // Find closest voronoi point
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            float2 neighbor = float2(x, y);
            float2 cell = i_uv + neighbor;
            float2 point = hash2(cell);
            
            // Animate points
            point = 0.5 + 0.4 * sin(time * 0.5 + 6.2831 * point);
            
            float2 diff = neighbor + point - f_uv;
            float dist = length(diff);
            
            if (dist < minDist) {
                minDist = dist;
                minPoint = point;
                minCell = cell;
            }
        }
    }
    
    // Find distance to edge
    float edgeDist = 10.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            float2 neighbor = float2(x, y);
            float2 cell = i_uv + neighbor;
            float2 point = hash2(cell);
            point = 0.5 + 0.4 * sin(time * 0.5 + 6.2831 * point);
            
            float2 diff = neighbor + point - f_uv;
            
            if (length(diff) > 0.001) {
                float2 toCenter = (minPoint - point + float2(float(x), float(y))) * 0.5;
                float2 toPoint = diff - toCenter;
                float d = dot(toPoint, normalize(toCenter));
                edgeDist = min(edgeDist, d);
            }
        }
    }
    
    // Coloring
    float3 cellColor = float3(hash2(minCell), hash2(minCell + 100.0).x) * 0.3 + 0.1;
    
    // Mouse highlight
    float mouseDist = length(in.uv - mouse);
    cellColor += float3(0.1, 0.15, 0.2) * smoothstep(0.3, 0.0, mouseDist);
    
    // Edge highlight
    float edge = smoothstep(0.02, 0.03, edgeDist);
    float3 color = mix(float3(0.4, 0.5, 0.6), cellColor, edge);
    
    return float4(color, 1.0);
}`,
  },
  {
    name: "Plasma",
    description: "Classic demoscene plasma effect",
    code: `#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex VertexOut vertex_main(uint vertexID [[vertex_id]]) {
    float2 positions[6] = {
        float2(-1, -1), float2(1, -1), float2(-1, 1),
        float2(-1, 1), float2(1, -1), float2(1, 1)
    };
    
    VertexOut out;
    out.position = float4(positions[vertexID], 0, 1);
    out.uv = positions[vertexID] * 0.5 + 0.5;
    return out;
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
                              constant float &time [[buffer(0)]],
                              constant float2 &mouse [[buffer(1)]]) {
    float2 uv = in.uv;
    float t = time * 0.5;
    
    float v1 = sin(uv.x * 10.0 + t);
    float v2 = sin(10.0 * (uv.x * sin(t / 2.0) + uv.y * cos(t / 3.0)) + t);
    
    float cx = uv.x + 0.5 * sin(t / 5.0);
    float cy = uv.y + 0.5 * cos(t / 3.0);
    float v3 = sin(sqrt(100.0 * (cx * cx + cy * cy) + 1.0) + t);
    
    // Mouse influence
    float2 mc = uv - mouse;
    float v4 = sin(sqrt(50.0 * (mc.x * mc.x + mc.y * mc.y) + 1.0));
    
    float v = v1 + v2 + v3 + v4 * 0.5;
    
    float3 color;
    color.r = sin(v * 3.14159) * 0.3 + 0.2;
    color.g = sin(v * 3.14159 + 2.094) * 0.2 + 0.15;
    color.b = sin(v * 3.14159 + 4.188) * 0.3 + 0.35;
    
    return float4(color, 1.0);
}`,
  },
  {
    name: "Reaction Diffusion",
    description: "Gray-Scott reaction diffusion pattern",
    code: `#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex VertexOut vertex_main(uint vertexID [[vertex_id]]) {
    float2 positions[6] = {
        float2(-1, -1), float2(1, -1), float2(-1, 1),
        float2(-1, 1), float2(1, -1), float2(1, 1)
    };
    
    VertexOut out;
    out.position = float4(positions[vertexID], 0, 1);
    out.uv = positions[vertexID] * 0.5 + 0.5;
    return out;
}

float hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
                              constant float &time [[buffer(0)]],
                              constant float2 &mouse [[buffer(1)]]) {
    float2 uv = in.uv;
    
    // Simulate reaction-diffusion pattern using noise
    float scale = 8.0 + sin(time * 0.2) * 2.0;
    float2 p = uv * scale;
    
    float pattern = 0.0;
    float amp = 1.0;
    
    for (int i = 0; i < 5; i++) {
        float2 offset = float2(
            sin(time * 0.1 * float(i + 1)),
            cos(time * 0.1 * float(i + 1))
        ) * 0.5;
        
        float n = hash(floor(p + offset));
        n = sin(n * 50.0 + time) * 0.5 + 0.5;
        
        float2 f = fract(p + offset);
        float d = length(f - 0.5);
        
        pattern += smoothstep(0.3 + n * 0.2, 0.0, d) * amp;
        
        p *= 2.0;
        amp *= 0.5;
    }
    
    // Mouse creates ripple
    float mouseDist = length(uv - mouse);
    float ripple = sin(mouseDist * 30.0 - time * 3.0) * 0.5 + 0.5;
    ripple *= smoothstep(0.4, 0.0, mouseDist);
    pattern += ripple * 0.3;
    
    // Organic coloring
    float3 col1 = float3(0.02, 0.05, 0.08);
    float3 col2 = float3(0.1, 0.2, 0.3);
    float3 col3 = float3(0.2, 0.25, 0.2);
    
    float3 color = mix(col1, col2, smoothstep(0.2, 0.5, pattern));
    color = mix(color, col3, smoothstep(0.6, 0.9, pattern));
    
    return float4(color, 1.0);
}`,
  },
  {
    name: "Tunnel",
    description: "Infinite tunnel with warping",
    code: `#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex VertexOut vertex_main(uint vertexID [[vertex_id]]) {
    float2 positions[6] = {
        float2(-1, -1), float2(1, -1), float2(-1, 1),
        float2(-1, 1), float2(1, -1), float2(1, 1)
    };
    
    VertexOut out;
    out.position = float4(positions[vertexID], 0, 1);
    out.uv = positions[vertexID];
    return out;
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
                              constant float &time [[buffer(0)]],
                              constant float2 &mouse [[buffer(1)]]) {
    float2 uv = in.uv;
    uv.x *= 800.0 / 600.0;
    
    // Mouse offset
    float2 center = (mouse - 0.5) * 0.5;
    uv -= center;
    
    // Polar coordinates
    float r = length(uv);
    float a = atan2(uv.y, uv.x);
    
    // Tunnel mapping
    float z = 1.0 / (r + 0.1);
    float u = a / 3.14159;
    float v = z + time * 0.5;
    
    // Pattern
    float pattern = sin(u * 8.0) * sin(v * 4.0);
    pattern = smoothstep(-0.1, 0.1, pattern);
    
    // Add rings
    float rings = sin(z * 2.0 - time * 2.0) * 0.5 + 0.5;
    
    // Depth fog
    float fog = exp(-r * 0.5);
    
    // Color
    float3 col1 = float3(0.1, 0.15, 0.25);
    float3 col2 = float3(0.25, 0.2, 0.15);
    
    float3 color = mix(col1, col2, pattern);
    color += float3(0.1, 0.12, 0.15) * rings;
    color *= fog;
    
    // Vignette
    float vignette = 1.0 - r * 0.3;
    color *= vignette;
    
    return float4(color, 1.0);
}`,
  },
];
