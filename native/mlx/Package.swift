// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "HonyoMlx",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "honyo-mlx", targets: ["HonyoMlx"])],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift", exact: "0.32.3"),
    ],
    targets: [
        .target(name: "HonyoMlxCore"),
        .executableTarget(name: "HonyoMlx", dependencies: [
            "HonyoMlxCore",
            .product(name: "MLX", package: "mlx-swift"),
        ]),
        .testTarget(name: "HonyoMlxCoreTests", dependencies: ["HonyoMlxCore"]),
    ],
    cxxLanguageStandard: .cxx17
)
