import Foundation
import Metal
import MetalKit
import Vapor
import AppKit
import CoreGraphics
import ImageIO

// MARK: - Metal Renderer

class MetalShaderRenderer {
    let device: MTLDevice
    let commandQueue: MTLCommandQueue
    var pipelineState: MTLRenderPipelineState?
    var texture: MTLTexture
    private(set) var width: Int
    private(set) var height: Int
    
    var time: Float = 0
    var mouseX: Float = 0.5
    var mouseY: Float = 0.5
    var targetFps: Int = 60
    
    var currentShaderCode: String = ""
    var compileError: String?
    
    private var timeBuffer: MTLBuffer
    private var mouseBuffer: MTLBuffer
    
    // Shared buffer for zero-copy readback on Apple Silicon
    private var readbackBuffer: MTLBuffer
    
    // Lock to prevent concurrent rendering
    private let renderLock = NSLock()
    
    // Check if we're on Apple Silicon (unified memory)
    private let hasUnifiedMemory: Bool
    
    init(width: Int = 800, height: Int = 600) throws {
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw MetalError.noDevice
        }
        self.device = device
        self.hasUnifiedMemory = device.hasUnifiedMemory
        
        guard let queue = device.makeCommandQueue() else {
            throw MetalError.noCommandQueue
        }
        self.commandQueue = queue
        
        self.width = width
        self.height = height
        
        // Create render target texture
        // Use .private for best GPU performance - we'll blit to shared buffer for readback
        let textureDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm,
            width: width,
            height: height,
            mipmapped: false
        )
        textureDescriptor.usage = [.renderTarget, .shaderRead]
        textureDescriptor.storageMode = hasUnifiedMemory ? .private : .managed
        
        guard let texture = device.makeTexture(descriptor: textureDescriptor) else {
            throw MetalError.noTexture
        }
        self.texture = texture
        
        // Create shared buffer for zero-copy CPU access on Apple Silicon
        let bufferSize = width * height * 4
        guard let readbackBuffer = device.makeBuffer(length: bufferSize, options: .storageModeShared) else {
            throw MetalError.noBuffer
        }
        self.readbackBuffer = readbackBuffer
        
        // Create uniform buffers
        guard let timeBuffer = device.makeBuffer(length: MemoryLayout<Float>.size, options: .storageModeShared),
              let mouseBuffer = device.makeBuffer(length: MemoryLayout<SIMD2<Float>>.size, options: .storageModeShared) else {
            throw MetalError.noBuffer
        }
        self.timeBuffer = timeBuffer
        self.mouseBuffer = mouseBuffer
        
        if hasUnifiedMemory {
            print("Apple Silicon detected - using zero-copy unified memory")
        }
    }
    
    func resize(width newWidth: Int, height newHeight: Int) -> Bool {
        renderLock.lock()
        defer { renderLock.unlock() }
        
        // Clamp to reasonable bounds
        let w = max(100, min(4096, newWidth))
        let h = max(100, min(4096, newHeight))
        
        guard w != width || h != height else { return true }
        
        let textureDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm,
            width: w,
            height: h,
            mipmapped: false
        )
        textureDescriptor.usage = [.renderTarget, .shaderRead]
        textureDescriptor.storageMode = hasUnifiedMemory ? .private : .managed
        
        guard let newTexture = device.makeTexture(descriptor: textureDescriptor) else {
            return false
        }
        
        // Resize readback buffer
        let bufferSize = w * h * 4
        guard let newBuffer = device.makeBuffer(length: bufferSize, options: .storageModeShared) else {
            return false
        }
        
        self.texture = newTexture
        self.readbackBuffer = newBuffer
        self.width = w
        self.height = h
        
        print("Resized renderer to \(w)x\(h)")
        return true
    }
    
    func compileShader(_ code: String) -> String? {
        currentShaderCode = code
        compileError = nil
        
        do {
            let library = try device.makeLibrary(source: code, options: nil)
            
            guard let vertexFunction = library.makeFunction(name: "vertex_main"),
                  let fragmentFunction = library.makeFunction(name: "fragment_main") else {
                compileError = "Could not find vertex_main or fragment_main functions"
                return compileError
            }
            
            let pipelineDescriptor = MTLRenderPipelineDescriptor()
            pipelineDescriptor.vertexFunction = vertexFunction
            pipelineDescriptor.fragmentFunction = fragmentFunction
            pipelineDescriptor.colorAttachments[0].pixelFormat = .rgba8Unorm
            
            pipelineState = try device.makeRenderPipelineState(descriptor: pipelineDescriptor)
            return nil
            
        } catch {
            compileError = error.localizedDescription
            return compileError
        }
    }
    
    func render() -> Data? {
        // Prevent concurrent rendering
        renderLock.lock()
        defer { renderLock.unlock() }
        
        guard let pipelineState = pipelineState else { return nil }
        
        // Update uniforms
        time += 1.0 / Float(targetFps)
        timeBuffer.contents().storeBytes(of: time, as: Float.self)
        mouseBuffer.contents().storeBytes(of: SIMD2<Float>(mouseX, mouseY), as: SIMD2<Float>.self)
        
        guard let commandBuffer = commandQueue.makeCommandBuffer() else { return nil }
        
        let renderPassDescriptor = MTLRenderPassDescriptor()
        renderPassDescriptor.colorAttachments[0].texture = texture
        renderPassDescriptor.colorAttachments[0].loadAction = .clear
        renderPassDescriptor.colorAttachments[0].storeAction = .store
        renderPassDescriptor.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        
        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: renderPassDescriptor) else { return nil }
        
        encoder.setRenderPipelineState(pipelineState)
        encoder.setFragmentBuffer(timeBuffer, offset: 0, index: 0)
        encoder.setFragmentBuffer(mouseBuffer, offset: 0, index: 1)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
        encoder.endEncoding()
        
        // Blit texture to shared buffer for CPU access
        if let blitEncoder = commandBuffer.makeBlitCommandEncoder() {
            let bytesPerRow = width * 4
            blitEncoder.copy(
                from: texture,
                sourceSlice: 0,
                sourceLevel: 0,
                sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
                sourceSize: MTLSize(width: width, height: height, depth: 1),
                to: readbackBuffer,
                destinationOffset: 0,
                destinationBytesPerRow: bytesPerRow,
                destinationBytesPerImage: bytesPerRow * height
            )
            
            // Only sync on non-unified memory (Intel Macs)
            if !hasUnifiedMemory {
                blitEncoder.synchronize(resource: readbackBuffer)
            }
            blitEncoder.endEncoding()
        }
        
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()
        
        // Encode to JPEG directly from shared buffer (zero-copy on Apple Silicon)
        return encodeToJPEG()
    }
    
    private func encodeToJPEG() -> Data? {
        let bytesPerPixel = 4
        let bytesPerRow = width * bytesPerPixel
        let dataSize = width * height * bytesPerPixel
        
        // Read directly from shared buffer - zero copy on Apple Silicon
        // The buffer contents pointer gives us direct access to unified memory
        let pixelData = Data(bytesNoCopy: readbackBuffer.contents(),
                            count: dataSize,
                            deallocator: .none)
        
        // Create CGImage using CGDataProvider
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue)
        
        guard let provider = CGDataProvider(data: pixelData as CFData),
              let cgImage = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: bitmapInfo,
                provider: provider,
                decode: nil,
                shouldInterpolate: false,
                intent: .defaultIntent
              ) else {
            return nil
        }
        
        // Encode to JPEG using ImageIO
        let jpegData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(jpegData as CFMutableData, "public.jpeg" as CFString, 1, nil) else {
            return nil
        }
        
        let options: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: 0.85
        ]
        CGImageDestinationAddImage(destination, cgImage, options as CFDictionary)
        
        guard CGImageDestinationFinalize(destination) else {
            return nil
        }
        
        return jpegData as Data
    }
}

enum MetalError: Error {
    case noDevice
    case noCommandQueue
    case noTexture
    case noBuffer
}

// MARK: - Server State

actor ServerState {
    var renderer: MetalShaderRenderer?
    var isStreaming = false
    var clients: [UUID: AsyncStream<Data>.Continuation] = [:]
    var wsClients: [UUID: WebSocket] = [:]
    
    func setRenderer(_ renderer: MetalShaderRenderer) {
        self.renderer = renderer
    }
    
    func addClient(_ id: UUID, continuation: AsyncStream<Data>.Continuation) {
        clients[id] = continuation
    }
    
    func removeClient(_ id: UUID) {
        clients.removeValue(forKey: id)
    }
    
    func getClients() -> [AsyncStream<Data>.Continuation] {
        Array(clients.values)
    }
    
    func addWebSocket(_ id: UUID, ws: WebSocket) {
        wsClients[id] = ws
    }
    
    func removeWebSocket(_ id: UUID) {
        wsClients.removeValue(forKey: id)
    }
    
    func getWebSockets() -> [WebSocket] {
        Array(wsClients.values)
    }
    
    func getRenderer() -> MetalShaderRenderer? {
        renderer
    }
    
    func setStreaming(_ streaming: Bool) {
        isStreaming = streaming
    }
    
    func getStreaming() -> Bool {
        isStreaming
    }
}

let state = ServerState()

// MARK: - Render Loop

func startRenderLoop() {
    Task {
        while true {
            guard let renderer = await state.getRenderer(),
                  await state.getStreaming() else {
                try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                continue
            }
            
            let frameTime = 1_000_000_000 / UInt64(renderer.targetFps)
            let startTime = DispatchTime.now().uptimeNanoseconds
            
            if let frameData = renderer.render() {
                // Push to MJPEG clients
                let clients = await state.getClients()
                for client in clients {
                    client.yield(frameData)
                }
                
                // Push to WebSocket clients
                let wsClients = await state.getWebSockets()
                for ws in wsClients {
                    var buffer = ByteBufferAllocator().buffer(capacity: frameData.count)
                    buffer.writeBytes(frameData)
                    try? await ws.send(raw: buffer.readableBytesView, opcode: .binary)
                }
            }
            
            let elapsed = DispatchTime.now().uptimeNanoseconds - startTime
            if elapsed < frameTime {
                try? await Task.sleep(nanoseconds: frameTime - elapsed)
            }
        }
    }
}

// MARK: - Vapor Routes

func routes(_ app: Application) throws {
    // CORS middleware - must be first
    let cors = CORSMiddleware(configuration: .init(
        allowedOrigin: .all,
        allowedMethods: [.GET, .POST, .PUT, .OPTIONS, .DELETE, .PATCH],
        allowedHeaders: [.accept, .authorization, .contentType, .origin, .xRequestedWith, .userAgent, .accessControlAllowOrigin],
        allowCredentials: true,
        exposedHeaders: ["X-Width", "X-Height"]
    ))
    app.middleware.use(cors, at: .beginning)
    
    // Health check
    app.get("health") { req -> String in
        "ok"
    }
    
    // Compile and set shader
    app.post("shader") { req -> Response in
        struct ShaderRequest: Content {
            let code: String
        }
        
        let shaderReq = try req.content.decode(ShaderRequest.self)
        
        guard let renderer = await state.getRenderer() else {
            return Response(status: .serviceUnavailable, body: .init(string: "Renderer not initialized"))
        }
        
        if let error = renderer.compileShader(shaderReq.code) {
            return Response(status: .badRequest, body: .init(string: error))
        }
        
        await state.setStreaming(true)
        return Response(status: .ok, body: .init(string: "ok"))
    }
    
    // Update configuration
    app.post("config") { req -> Response in
        struct ConfigRequest: Content {
            let targetFps: Int?
            let width: Int?
            let height: Int?
        }
        
        let configReq = try req.content.decode(ConfigRequest.self)
        
        guard let renderer = await state.getRenderer() else {
            return Response(status: .serviceUnavailable)
        }
        
        if let fps = configReq.targetFps {
            renderer.targetFps = max(1, min(120, fps))
        }
        
        // Resize if dimensions provided
        if let w = configReq.width, let h = configReq.height {
            if !renderer.resize(width: w, height: h) {
                return Response(status: .internalServerError, body: .init(string: "Failed to resize"))
            }
        }
        
        return Response(status: .ok)
    }
    
    // Handle mouse/keyboard events
    app.post("event") { req -> Response in
        struct EventRequest: Content {
            let type: String
            let x: Float?
            let y: Float?
            let key: String?
        }
        
        let eventReq = try req.content.decode(EventRequest.self)
        
        guard let renderer = await state.getRenderer() else {
            return Response(status: .serviceUnavailable)
        }
        
        switch eventReq.type {
        case "mousemove", "click":
            if let x = eventReq.x, let y = eventReq.y {
                renderer.mouseX = x / Float(renderer.width)
                // Flip Y - web has origin top-left, Metal textures have origin bottom-left
                renderer.mouseY = 1.0 - (y / Float(renderer.height))
            }
        default:
            break
        }
        
        return Response(status: .ok)
    }
    
    // MJPEG stream endpoint
    app.get("stream") { req -> Response in
        let clientId = UUID()
        
        let stream = AsyncStream<Data> { continuation in
            Task {
                await state.addClient(clientId, continuation: continuation)
            }
            
            continuation.onTermination = { _ in
                Task {
                    await state.removeClient(clientId)
                }
            }
        }
        
        let body = Response.Body(stream: { writer in
            Task {
                for await frameData in stream {
                    // MJPEG frame format
                    let boundary = "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: \(frameData.count)\r\n\r\n"
                    
                    do {
                        try await writer.write(.buffer(.init(string: boundary)))
                        try await writer.write(.buffer(.init(data: frameData)))
                        try await writer.write(.buffer(.init(string: "\r\n")))
                    } catch {
                        break
                    }
                }
                try? await writer.write(.end)
            }
        })
        
        var headers = HTTPHeaders()
        headers.add(name: .contentType, value: "multipart/x-mixed-replace; boundary=frame")
        headers.add(name: .cacheControl, value: "no-cache")
        headers.add(name: .connection, value: "keep-alive")
        
        return Response(status: .ok, headers: headers, body: body)
    }
    
    // Single frame endpoint (for polling fallback)
    app.get("frame") { req -> Response in
        guard let renderer = await state.getRenderer() else {
            return Response(status: .serviceUnavailable)
        }
        
        guard let frameData = renderer.render() else {
            return Response(status: .internalServerError)
        }
        
        var headers = HTTPHeaders()
        headers.add(name: .contentType, value: "image/jpeg")
        headers.add(name: "X-Width", value: String(renderer.width))
        headers.add(name: "X-Height", value: String(renderer.height))
        
        return Response(status: .ok, headers: headers, body: .init(data: frameData))
    }
    
    // WebSocket streaming endpoint
    app.webSocket("ws") { req, ws in
        let clientId = UUID()
        print("WebSocket client connected: \(clientId)")
        
        Task {
            await state.addWebSocket(clientId, ws: ws)
        }
        
        // Handle incoming messages (for events like mouse/keyboard)
        ws.onText { ws, text in
            guard let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = json["type"] as? String else { return }
            
            Task {
                guard let renderer = await state.getRenderer() else { return }
                
                switch type {
                case "mousemove", "click":
                    if let x = json["x"] as? Double, let y = json["y"] as? Double {
                        renderer.mouseX = Float(x) / Float(renderer.width)
                        renderer.mouseY = 1.0 - (Float(y) / Float(renderer.height))
                    }
                case "shader":
                    if let code = json["code"] as? String {
                        if let error = renderer.compileShader(code) {
                            try? await ws.send("{\"error\": \"\(error.replacingOccurrences(of: "\"", with: "\\\""))\"}")
                        } else {
                            await state.setStreaming(true)
                            try? await ws.send("{\"ok\": true}")
                        }
                    }
                case "config":
                    if let fps = json["targetFps"] as? Int {
                        renderer.targetFps = max(1, min(120, fps))
                    }
                    if let w = json["width"] as? Int, let h = json["height"] as? Int {
                        _ = renderer.resize(width: w, height: h)
                    }
                default:
                    break
                }
            }
        }
        
        ws.onClose.whenComplete { _ in
            print("WebSocket client disconnected: \(clientId)")
            Task {
                await state.removeWebSocket(clientId)
            }
        }
    }
}

// MARK: - Main

@main
struct MetalRendererApp {
    static func main() async throws {
        print("Initializing Metal renderer...")
        
        let renderer = try MetalShaderRenderer(width: 800, height: 600)
        await state.setRenderer(renderer)
        
        // Compile default shader
        let defaultShader = """
        #include <metal_stdlib>
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
            float3 color = float3(uv.x, uv.y, sin(time) * 0.5 + 0.5);
            return float4(color * 0.3, 1.0);
        }
        """
        
        if let error = renderer.compileShader(defaultShader) {
            print("Warning: Failed to compile default shader: \\(error)")
        }
        
        // Start render loop
        startRenderLoop()
        
        // Configure and start Vapor
        var env = try Environment.detect()
        try LoggingSystem.bootstrap(from: &env)
        
        let app = Application(env)
        defer { app.shutdown() }
        
        app.http.server.configuration.hostname = "0.0.0.0"
        app.http.server.configuration.port = 9000
        
        try routes(app)
        
        print("Metal Shader Server running on http://localhost:9000")
        print("Endpoints:")
        print("  WS   /ws      - WebSocket stream (recommended)")
        print("  GET  /stream  - MJPEG video stream")
        print("  GET  /frame   - Single JPEG frame")
        print("  POST /shader  - Upload shader code")
        print("  POST /config  - Update configuration")
        print("  POST /event   - Send mouse/keyboard events")
        
        try app.run()
    }
}
