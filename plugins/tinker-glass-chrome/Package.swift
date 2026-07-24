// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TinkerGlassChrome",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "TinkerGlassChrome",
            targets: ["GlassChromePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "6.0.0")
    ],
    targets: [
        .target(
            name: "GlassChromePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/GlassChromePlugin")
    ]
)
