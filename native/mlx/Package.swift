// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "HonyoMlx",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "honyo-mlx", targets: ["HonyoMlx"])],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", exact: "3.32.3"),
        .package(url: "https://github.com/huggingface/swift-transformers", exact: "1.3.5"),
    ],
    targets: [
        .target(name: "HonyoMlxCore", dependencies: [
            .product(name: "Tokenizers", package: "swift-transformers"),
            .product(name: "Hub", package: "swift-transformers"),
        ]),
        .executableTarget(name: "HonyoMlx", dependencies: [
            "HonyoMlxCore",
            .product(name: "MLXLLM", package: "mlx-swift-lm"),
            .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
        ]),
        .testTarget(name: "HonyoMlxCoreTests", dependencies: ["HonyoMlxCore"], exclude: ["Fixtures"]),
    ],
    cxxLanguageStandard: .cxx17
)
